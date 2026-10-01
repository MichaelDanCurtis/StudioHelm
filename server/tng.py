"""Bounded configuration transport. No performance MIDI or firmware commands.
Derived from the verified read-only research probe; writes are restricted to
the active preset route bitmap through set_routes().
"""
import argparse
import datetime
import json
import pathlib
import secrets
import select
import socket
import struct
import time


def enc(n, size):
    return bytes((n >> (7 * i)) & 127 for i in reversed(range(size)))


def dec(data):
    n = 0
    for b in data:
        n = (n << 7) | b
    return n


def block(kind, data):
    assert len(data) + 2 < 128
    return bytes([len(data) + 2, kind]) + bytes(data)


def parse_sysex(data):
    assert data[:5] == bytes.fromhex('f0 00 01 73 7d') and data[-1] == 247
    assert all(b < 128 for b in data[1:-1])
    assert sum(data[5:-1]) % 128 == 0, 'checksum mismatch'
    size = dec(data[20:22])
    assert len(data) == size + 24, 'size mismatch'
    c = data[22:-2]
    result = {'device_id': data[5:12].hex(), 'session_id': dec(data[12:16]),
              'transaction_id': dec(data[16:20]), 'class': c[0], 'data_class': c[1],
              'raw': data.hex(), 'params': {}, 'definitions': {}, 'blocks': []}
    if c[0] == 64:
        assert len(c) == 5 and c[1] == 0, 'Malformed acknowledgement'
        result['ack'] = {'message_class': c[2], 'data_class': c[3], 'code': c[4]}
        if c[4]:
            result['error'] = c[2:].hex()
        return result
    if len(c) < 3:
        return result
    pos = 3
    for _ in range(c[2]):
        size = c[pos]
        assert size >= 3 and pos + size <= len(c)
        b = c[pos:pos + size]
        result['blocks'].append(b.hex())
        if b[1] == 3:
            j = 3
            for _ in range(b[2]):
                count = b[j]
                assert count >= 2 and j + count <= len(b)
                result['params'][str(b[j + 1])] = list(b[j + 2:j + count])
                j += count
            assert j == len(b)
        elif b[1] == 2:
            assert len(b) == 3 + 2 * b[2]
            result['definitions'].update({str(b[j]): b[j + 1] for j in range(3, len(b), 2)})
        pos += size
    assert pos == len(c)
    return result


class Probe:
    def __init__(self, ip, port, output):
        self.ip, self.port, self.output = ip, port, pathlib.Path(output)
        self.token, self.ssrc, self.session = (secrets.randbits(28) for _ in range(3))
        self.device = enc(14, 2) + bytes(5)
        self.seq, self.tx = secrets.randbelow(65536), 0
        self.log = {'timestamp': datetime.datetime.now().astimezone().isoformat(),
                    'ip': ip, 'control_port': port, 'requests': [], 'transport': []}
        self.control = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        self.data = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        for p in range(42000, 43000, 2):
            try:
                self.control.bind(('', p))
                self.data.bind(('', p + 1))
                break
            except OSError:
                self.control.close(); self.data.close()
                self.control = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
                self.data = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        else:
            raise RuntimeError('No free UDP pair')
        self.joined = False

    def stamp(self):
        return int(time.monotonic() * 10000)

    def command(self, name):
        return b'\xff\xff' + name + struct.pack('!III', 2, self.token, self.ssrc)

    def open(self):
        for sock, port in [(self.control, self.port), (self.data, self.port + 1)]:
            sock.settimeout(2)
            sock.sendto(self.command(b'IN') + b'MioXLplus configuration\0', (self.ip, port))
            msg, addr = sock.recvfrom(65535)
            self.log['transport'].append({'from': list(addr), 'packet': msg.hex()})
            assert addr == (self.ip, port) and msg[:4] == b'\xff\xffOK', 'Invitation was not accepted'
            assert struct.unpack('!I', msg[8:12])[0] == self.token
            self.joined = True
        self.data.sendto(b'\xff\xffCK' + struct.pack('!IB3xQQQ', self.ssrc, 0, self.stamp(), 0, 0), (self.ip, self.port + 1))
        msg, addr = self.data.recvfrom(65535)
        self.log['transport'].append({'from': list(addr), 'packet': msg.hex()})
        assert addr == (self.ip, self.port + 1) and msg[:4] == b'\xff\xffCK'
        _, count, t1, t2, _ = struct.unpack('!IB3xQQQ', msg[4:36])
        assert count == 1
        self.data.sendto(b'\xff\xffCK' + struct.pack('!IB3xQQQ', self.ssrc, 2, t1, t2, self.stamp()), addr)
        time.sleep(0.1)

    def close(self):
        if self.joined:
            self.control.sendto(self.command(b'BY'), (self.ip, self.port))
            self.data.sendto(self.command(b'BY'), (self.ip, self.port + 1))
            self.log['exit_sent'] = True
        self.control.close(); self.data.close()
        self.output.parent.mkdir(parents=True, exist_ok=True)
        self.output.write_text(json.dumps(self.log, indent=2))

    def request(self, mc, dc, blocks=None):
        assert mc in (1, 2, 3, 16), 'Command not permitted'
        if mc == 16:
            assert dc == 6 and len(blocks) == 2
            assert blocks[0][:4] == bytes([5, 4, 1, 5])
            assert blocks[1][1:3] == bytes([3, 1]) and blocks[1][4] == 7
            assert all(v < 16 for v in blocks[1][5:]), 'Invalid route bitmap'
        assert mc != 1 or dc == 1
        self.tx += 1
        content = bytes([mc, dc])
        if blocks is not None:
            content += bytes([len(blocks)]) + b''.join(blocks)
        body = self.device + enc(self.session, 4) + enc(self.tx, 4) + enc(len(content), 2) + content
        sysex = bytes.fromhex('f0 00 01 73 7d') + body + bytes([(-sum(body)) & 127, 247])
        assert len(sysex) <= 512
        self.seq = (self.seq + 1) & 65535
        header = struct.pack('!BBHII', 128, 97, self.seq, self.stamp() & 0xffffffff, self.ssrc)
        midi_header = bytes([128 | (len(sysex) >> 8), len(sysex) & 255])
        self.data.sendto(header + midi_header + sysex, (self.ip, self.port + 1))
        entry = {'tx': self.tx, 'request': sysex.hex()}
        self.log['requests'].append(entry)
        deadline = time.monotonic() + 3
        while time.monotonic() < deadline:
            ready, _, _ = select.select([self.control, self.data], [], [], max(0, deadline - time.monotonic()))
            for sock in ready:
                msg, addr = sock.recvfrom(65535)
                if addr != (self.ip, self.port if sock is self.control else self.port + 1):
                    continue
                self.log['transport'].append({'from': list(addr), 'packet': msg.hex()})
                if msg[:4] == b'\xff\xffCK':
                    remote_ssrc, count, t1, t2, t3 = struct.unpack('!IB3xQQQ', msg[4:36])
                    if count == 1:
                        packet = b'\xff\xffCK' + struct.pack('!IB3xQQQ', self.ssrc, 2, t1, t2, self.stamp())
                        self.data.sendto(packet, (self.ip, self.port + 1))
                    elif count == 0:
                        packet = b'\xff\xffCK' + struct.pack('!IB3xQQQ', self.ssrc, 1, t1, self.stamp(), 0)
                        self.data.sendto(packet, (self.ip, self.port + 1))
                    continue
                if msg[:2] == b'\xff\xff':
                    continue
                if len(msg) < 13 or msg[0] != 128 or (msg[1] & 127) != 97:
                    continue
                seq = struct.unpack('!H', msg[2:4])[0]
                self.control.sendto(b'\xff\xffRS' + struct.pack('!IHH', self.ssrc, seq, 0), (self.ip, self.port))
                start = 12
                flags = msg[start]
                if flags & 128:
                    length = ((flags & 15) << 8) | msg[start + 1]; start += 2
                else:
                    length = flags & 15; start += 1
                midi = msg[start:start + length]
                if flags & 32:
                    j = 0
                    while midi[j] & 128:
                        j += 1
                    midi = midi[j + 1:]
                # Queries are small; reject fragmented or compound MIDI packets.
                if not midi.startswith(bytes.fromhex('f0 00 01 73 7d')) or not midi.endswith(b'\xf7'):
                    entry.setdefault('unparsed_packets', []).append(msg.hex())
                    continue
                response = parse_sysex(midi)
                if response['session_id'] != self.session or response['transaction_id'] != self.tx:
                    continue
                entry['response'] = response
                if 'error' in response:
                    raise RuntimeError('Device error: ' + response['error'])
                assert response['device_id'] == self.device.hex() or mc == 1, 'Unexpected device'
                if mc == 16:
                    assert response.get('ack') == {'message_class': mc, 'data_class': dc, 'code': 0}, 'Invalid acknowledgement'
                else:
                    assert response['class'] == mc + 64 and response['data_class'] == dc
                time.sleep(0.02)
                return response
        raise TimeoutError(f'No matching response for transaction {self.tx}')

    def get(self, dc, ids, args=()):
        blocks = []
        if args:
            blocks.append(block(4, [len(args)] + [v for pair in args for v in pair]))
        blocks.append(block(1, [len(ids)] + list(ids)))
        return self.request(3, dc, blocks)['params']


    def set_routes(self, source, bitmap):
        if not isinstance(source, int) or not 1 <= source <= 127:
            raise ValueError('Invalid source port')
        return self.request(16, 6, [block(4, [1, 5, source]),
            block(3, [1, len(bitmap) + 2, 7, *bitmap])])
