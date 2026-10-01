"""Read-only mDNS discovery and MOTU datastore inventory. No audio writes."""
import concurrent.futures
import http.client
import ipaddress
import json
import re
import socket
import subprocess
from .device import RUNTIME, now, save


def local_address(value):
    address = ipaddress.ip_address(value)
    if address.version != 4 or not (address.is_private or address.is_link_local) or address.is_loopback or address.is_multicast or address.is_unspecified:
        raise ValueError('Enter a private or link-local IPv4 address')
    return str(address)


def dns(args, seconds=3):
    process = subprocess.Popen(['/usr/bin/dns-sd', *args], stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True)
    try: return process.communicate(timeout=seconds)[0]
    except subprocess.TimeoutExpired:
        process.terminate()
        return process.communicate()[0]


def services(kind):
    output = dns(['-B', kind, 'local.'])
    names = set()
    for line in output.splitlines():
        if ' Add ' in line and kind + '.' in line:
            names.add(line.split(kind + '.', 1)[1].strip())
    return sorted(names)


def resolve(pair):
    kind, name = pair
    output = dns(['-L', name, kind, 'local.'], 2)
    match = re.search(r'can be reached at ([^\s:]+):(\d+)', output)
    if not match: return None
    host, port = match.group(1), int(match.group(2))
    try: address = socket.gethostbyname(host)
    except OSError: return None
    vendor = re.search(r'\bmf=([^\s]+)', output)
    return {'name': name, 'service': kind, 'hostname': host, 'address': address,
            'port': port, 'manufacturer': vendor.group(1) if vendor else None,
            'identity': output.split('can be reached at', 1)[-1][-1500:]}


def get_json(ip, path, port=80):
    connection = http.client.HTTPConnection(local_address(ip), port, timeout=2)
    try:
        connection.request('GET', path, headers={'Accept': 'application/json'})
        response = connection.getresponse()
        body = response.read(2_000_001)
        if response.status != 200 or len(body) > 2_000_000:
            raise ValueError('Device did not return a bounded JSON response')
        return json.loads(body), response.getheader('ETag')
    finally: connection.close()


def inspect_motu(ip):
    ip = local_address(ip)
    data, etag = get_json(ip, '/datastore')
    if not isinstance(data, dict): raise ValueError('Not a MOTU datastore')
    uid = data.get('uid', '')
    if not isinstance(uid, str) or not re.fullmatch('[a-fA-F0-9]{16}', uid):
        raise ValueError('No MOTU AVB device identity at this address')
    vendor = data.get(f'avb/{uid}/vendor_name', '')
    if 'motu' not in str(vendor).lower():
        raise ValueError('The datastore does not identify this unit as MOTU')
    snapshot = {'at': now(), 'address': ip, 'uid': uid, 'etag': etag, 'datastore': data}
    save(RUNTIME / 'motu' / f'{uid}.json', snapshot)
    controls = [{'path': key, 'value': value} for key,value in data.items()
                if re.fullmatch(r'mix/(chan|aux|main|group)/\d+/(matrix/(fader|mute|pan)|name)', key)]
    return {'uid': uid, 'address': ip, 'name': data.get(f'avb/{uid}/entity_name', 'MOTU'),
            'model': data.get(f'avb/{uid}/model_name', 'AVB interface'), 'at': snapshot['at'],
            'etag': etag, 'controlCount': len(controls), 'controls': controls,
            'capabilities': {k:v for k,v in data.items() if k.startswith('ext/caps/')},
            'parameterCount': len(data)}


def inspect_switch(ip):
    ip = local_address(ip)
    connection = http.client.HTTPConnection(ip, 80, timeout=2)
    try:
        connection.request('GET', '/')
        response = connection.getresponse()
        html = response.read(16000).decode('utf-8', 'replace')
        if response.status != 200 or '<title>MOTU AVB Switch Management</title>' not in html:
            raise ValueError('No MOTU switch identity')
    finally: connection.close()
    params, _ = get_json(ip, '/params')
    result = {'address': ip, 'name': str(params['name']), 'firmware': str(params['version']),
              'mac': str(params['mac']), 'avbPorts': params['avbports'], 'at': now()}
    save(RUNTIME / 'motu' / ('switch-' + ip + '.json'), result)
    return result


def motu_neighbors():
    # ARP is a local cache read. MOTU's OUI narrows HTTP probes to its own devices.
    try: table = subprocess.check_output(['/usr/sbin/arp', '-an'], text=True, timeout=3)
    except (OSError, subprocess.SubprocessError): return set()
    return set(re.findall(r'\(([0-9.]+)\) at (?:0:1:f2|00:01:f2):', table, re.I))


def discover(payload):
    kinds = ['_http._tcp', '_apple-midi._udp', '_netaudio-cmc._udp', '_motu-avb._tcp']
    with concurrent.futures.ThreadPoolExecutor(4) as pool:
        batches = list(pool.map(services, kinds))
        pairs = [(kind, name) for kind,names in zip(kinds,batches) for name in names]
        # One RTP session per device is enough; don't occupy any session during discovery.
        pairs = [pair for pair in pairs if pair[0] != '_apple-midi._udp' or pair[1].endswith('-22')][:40]
        found = [item for item in pool.map(resolve, pairs) if item]
    candidates = {s['address'] for s in found if 'motu' in (s['name'] + s['hostname']).lower() or s['service'] == '_http._tcp'}
    candidates.update(motu_neighbors())
    if payload.get('address'): candidates.add(local_address(payload['address']))
    motu, failures, switches = [], [], []
    for ip in sorted(candidates):
        try: motu.append(inspect_motu(ip))
        except Exception as error:
            try: switches.append(inspect_switch(ip))
            except Exception: failures.append({'address': ip, 'error': str(error)})
    result = {'at': now(), 'services': found, 'motu': motu, 'switches': switches, 'checks': failures,
              'scope': 'Local Bonjour advertisements, cached MOTU network neighbors, and an optional supplied IPv4 address',
              'mode': 'read-only'}
    save(RUNTIME / 'network.json', result)
    return result
