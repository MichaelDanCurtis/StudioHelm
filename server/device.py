"""mioXL configuration adapter and recoverable, compare-before-write route edits."""
import contextlib
import copy
import datetime as dt
import hashlib
import ipaddress
import json
import os
from pathlib import Path
import re
import secrets
import socket
import time
from .tng import Probe, block

ROOT = Path(__file__).resolve().parents[1]
RUNTIME = ROOT / '.runtime'
REFERENCE = json.loads((ROOT / 'src/data/demo-inventory.json').read_text())
# A real device must be selected locally; the checked-in fixture is never an identity target.
SERIAL = os.environ.get('MIOXLPLUS_DEVICE_SERIAL', '').strip()
HOST = os.environ.get('MIOXLPLUS_DEVICE_HOST', '').strip()


def now():
    return dt.datetime.now().astimezone().isoformat()


def save(path, value):
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_suffix('.tmp')
    with temporary.open('w') as file:
        json.dump(value, file, indent=2)
        file.flush()
        os.fsync(file.fileno())
    temporary.replace(path)


def ascii_value(value):
    return bytes(value).decode('ascii').rstrip('\0')


def encode_routes(destinations, count):
    bitmap = [0] * (((count + 7) // 8) * 2)
    for destination in destinations:
        if type(destination) is not int or not 1 <= destination <= count:
            raise ValueError('Invalid MIDI destination')
        bitmap[(destination - 1) // 4] |= 1 << ((destination - 1) % 4)
    return bitmap


def decode_routes(bitmap, count):
    if len(bitmap) != ((count + 7) // 8) * 2 or any(v < 0 or v > 15 for v in bitmap):
        raise ValueError('Invalid device route bitmap')
    return [i + 1 for i in range(count) if bitmap[i // 4] & (1 << (i % 4))]


def revision(snapshot):
    # Connection flags change as this adapter opens and closes its RTP session.
    content = [snapshot['device'], snapshot['preset'], [
        {k: port[k] for k in ('id', 'type', 'input_name', 'output_name',
          'supports_input', 'supports_output', 'preset_destinations', 'global_destinations',
          'active', 'enabled_input', 'enabled_output')}
        for port in snapshot['ports']]]
    return hashlib.sha256(json.dumps(content, sort_keys=True).encode()).hexdigest()


@contextlib.contextmanager
def session():
    if not SERIAL or not HOST:
        raise ValueError('Set MIOXLPLUS_DEVICE_SERIAL and MIOXLPLUS_DEVICE_HOST locally before reading a device')
    # Resolve only the explicitly configured local host, then verify its serial.
    try:
        ip = socket.gethostbyname(HOST)
    except OSError as error:
        raise ValueError('Configured device host could not be resolved') from error
    address = ipaddress.ip_address(ip)
    if not (address.is_private or address.is_link_local) or address.is_loopback:
        raise ValueError('Device must be on the local network')
    probe = Probe(ip, 5046, RUNTIME / 'logs' / f'{time.time_ns()}.json')
    try:
        probe.open()
        result = probe.request(1, 1, [block(3, [1, 4, 1, 4, 0])])
        probe.device = bytes.fromhex(result['device_id'])
        if ascii_value(probe.get(2, [4])['4']) != SERIAL:
            raise ValueError('The discovered device serial does not match this workspace')
        definitions = probe.request(2, 6)['definitions']
        if definitions.get('7') != 13:
            raise ValueError('Unexpected route capability flags; refusing configuration access')
        yield probe
    finally:
        probe.close()


def read_snapshot(probe):
    info = probe.get(2, [1, 2, 4, 5, 6, 64])
    if ascii_value(info['4']) != SERIAL:
        raise ValueError('Device identity changed')
    preset_before = probe.get(3, [1, 2, 4])
    count = probe.get(5, [1])['1'][0]
    if not 1 <= count <= 127:
        raise ValueError('Unsupported port count')
    ports = []
    for number in range(1, count + 1):
        raw = probe.get(6, [1, 2, 3, 4, 5, 6, 10, 11], [(5, number)])
        kind = raw['1'][0]
        identifiers = raw['2']
        label = {1: 'DIN', 2: 'USB DAW', 3: 'USB HOST', 4: 'RTP', 5: 'CONTROL'}.get(kind)
        if label is None:
            raise ValueError('Unknown port type')
        inp, out = bool(raw['5'][0] & 1), bool(raw['5'][0] & 2)
        routing = probe.get(6, [7, 24], [(5, number)]) if inp else {'7': encode_routes([], count), '24': encode_routes([], count)}
        hardware_number = (identifiers[0] or identifiers[1]) if kind == 1 else identifiers[1]
        ports.append({'id': number, 'hardware': f'{label} {hardware_number}', 'type': kind,
            'input_name': ascii_value(raw['10']), 'output_name': ascii_value(raw['11']),
            'supports_input': inp, 'supports_output': out,
            'connection_flag': bool(raw['3'][0] & 1),
            'connection_meaning': 'Not cable detection' if kind == 1 else 'Connection at read time',
            'active': bool(raw['4'][0] & 1),
            'enabled_input': bool(raw['6'][0] & 1), 'enabled_output': bool(raw['6'][0] & 2),
            'preset_destinations': decode_routes(routing['7'], count),
            'global_destinations': decode_routes(routing['24'], count)})
    preset_after = probe.get(3, [1, 2, 4])
    if preset_before != preset_after:
        raise ValueError('The active preset changed during the read. Refresh again.')
    # All fields exposed here were read in this session; no old capability details are promoted to live.
    result = {'captured_at': now(), 'device': {'manufacturer': ascii_value(info['2']),
        'model': ascii_value(info['1']), 'serial': ascii_value(info['4']),
        'firmware': '.'.join(map(str, info['5'][:3])),
        'hardware_version': '.'.join(map(str, info['6'])), 'device_name': ascii_value(info['64'])},
        'network': {'hostname': HOST, 'address': probe.ip},
        'preset': {'number': preset_after['1'][0], 'name': ascii_value(preset_after['2']),
                   'scene': preset_after['4'][0], 'unchanged_at_end': True},
        'ports': ports}
    result['revision'] = revision(result)
    return result


def refresh():
    with session() as probe:
        snapshot = read_snapshot(probe)
    save(RUNTIME / 'latest.json', snapshot)
    return {'snapshot': snapshot}


def make_changes(snapshot, additions, removals):
    if not isinstance(additions, list) or not isinstance(removals, list) or len(additions) + len(removals) > 2000:
        raise ValueError('Invalid route change list')
    ports = {p['id']: p for p in snapshot['ports']}
    pending = {}
    seen = set()
    for operation, routes in [('add', additions), ('remove', removals)]:
        for route in routes:
            match = re.fullmatch(r'in-(\d+)__out-(\d+)', route) if isinstance(route, str) else None
            if not match or route in seen:
                raise ValueError('Only unique direct mioXL routes can be applied')
            seen.add(route)
            source, target = map(int, match.groups())
            p, q = ports.get(source), ports.get(target)
            if not p or not q or not p['supports_input'] or not q['supports_output']:
                raise ValueError('Unsupported port direction')
            if not p['active'] or not q['active'] or not p['enabled_input'] or not q['enabled_output']:
                raise ValueError('Route uses a disabled port')
            if target in p['global_destinations']:
                raise ValueError('This route is global. Global routing cannot be edited here.')
            before = p['preset_destinations']
            if (operation == 'add') == (target in before):
                raise ValueError('This route no longer matches the proposed change. Refresh first.')
            destinations = pending.setdefault(source, set(before))
            if operation == 'add': destinations.add(target)
            else: destinations.remove(target)
    return [{'source': source, 'before': ports[source]['preset_destinations'], 'after': sorted(after)}
            for source, after in sorted(pending.items())]


def plan(payload):
    with session() as probe:
        snapshot = read_snapshot(probe)
    if payload.get('revision') != snapshot['revision']:
        raise ValueError('The mioXL has changed since your last read. Refresh before reviewing this draft.')
    changes = make_changes(snapshot, payload.get('additions'), payload.get('removals'))
    if not changes:
        raise ValueError('There are no direct hardware routes to apply')
    token = secrets.token_hex(24)
    result = {'id': token, 'createdAt': now(), 'expiresAt': time.time() + 120,
              'revision': snapshot['revision'], 'device': snapshot['device'],
              'preset': snapshot['preset'], 'changes': changes,
              'additions': payload['additions'], 'removals': payload['removals'],
              'snapshot': snapshot, 'status': 'prepared'}
    save(RUNTIME / 'plans' / f'{token}.json', result)
    return result


def execute_plan(probe, prepared, journal_path):
    """Read, journal, write, acknowledge and read back. On failure recover only known values."""
    current = read_snapshot(probe)
    if current['revision'] != prepared['revision']:
        raise ValueError('Device state changed after review. Nothing was written; refresh and review again.')
    changes = make_changes(current, prepared['additions'], prepared['removals'])
    if changes != prepared['changes']:
        raise ValueError('Prepared plan does not match its operations')
    count = len(current['ports'])
    journal = {'kind': 'mioxlplus-route-recovery', 'at': now(), 'before': current,
               'changes': changes, 'attempted': [], 'confirmed': [], 'status': 'writing'}
    save(journal_path, journal)
    try:
        for change in changes:
            if probe.get(3, [1, 4]) != {'1': [current['preset']['number']], '4': [current['preset']['scene']]}:
                raise ValueError('Preset changed during apply')
            source = change['source']
            actual = probe.get(6, [7], [(5, source)])['7']
            if actual != encode_routes(change['before'], count):
                raise ValueError('Routing changed during apply')
            journal['attempted'].append(source)
            save(journal_path, journal)
            probe.set_routes(source, encode_routes(change['after'], count))
            if probe.get(6, [7], [(5, source)])['7'] != encode_routes(change['after'], count):
                raise ValueError('The mioXL did not confirm the requested route bitmap')
            journal['confirmed'].append(source)
            save(journal_path, journal)
        after = read_snapshot(probe)
        expected = copy.deepcopy(current)
        for change in changes:
            next(p for p in expected['ports'] if p['id'] == change['source'])['preset_destinations'] = change['after']
        if after['revision'] != revision(expected):
            raise ValueError('Final device state differs from the reviewed changes')
        journal.update(status='verified', after=after)
        save(journal_path, journal)
        return after
    except Exception as error:
        journal.update(status='recovery-needed', error=str(error), recovery=[])
        for change in reversed(changes):
            source = change['source']
            if source not in journal['attempted']: continue
            try:
                if probe.get(3, [1, 4]) != {'1': [current['preset']['number']], '4': [current['preset']['scene']]}:
                    raise ValueError('Preset changed; recovery cannot write to a different preset')
                actual = probe.get(6, [7], [(5, source)])['7']
                before, after = (encode_routes(change[k], count) for k in ['before', 'after'])
                if actual == after:
                    probe.set_routes(source, before)
                elif actual != before:
                    raise ValueError('Concurrent edit detected; left this port unchanged')
                if probe.get(6, [7], [(5, source)])['7'] != before:
                    raise ValueError('Recovery read-back failed')
                journal['recovery'].append({'source': source, 'restored': True})
            except Exception as recovery_error:
                journal['recovery'].append({'source': source, 'restored': False, 'error': str(recovery_error)})
            save(journal_path, journal)
        if all(item['restored'] for item in journal['recovery']): journal['status'] = 'restored'
        save(journal_path, journal)
        raise ValueError(f"Apply failed: {error}. Recovery: {journal['status']}. Record: {journal_path.name}") from error


def apply(payload):
    token = payload.get('id', '')
    if not re.fullmatch('[a-f0-9]{48}', token): raise ValueError('Invalid review token')
    path = RUNTIME / 'plans' / f'{token}.json'
    prepared = json.loads(path.read_text())
    if prepared['status'] != 'prepared' or time.time() > prepared['expiresAt']:
        raise ValueError('This review expired or was already used. Review the draft again.')
    prepared['status'] = 'used'
    save(path, prepared)
    journal = RUNTIME / 'backups' / f'routes-{time.time_ns()}.json'
    with session() as probe:
        snapshot = execute_plan(probe, prepared, journal)
    save(RUNTIME / 'latest.json', snapshot)
    return {'snapshot': snapshot, 'backup': journal.name, 'verified': True,
            'persistence': 'Working preset only; not saved to flash'}
