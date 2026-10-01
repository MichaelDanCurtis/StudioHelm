import copy
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch
from . import device
from .tng import parse_sysex, enc


def fixture():
    snapshot = copy.deepcopy(device.REFERENCE)
    snapshot['preset']['scene'] = 1
    for p in snapshot['ports']:
        p.update(active=True, enabled_input=p['supports_input'], enabled_output=p['supports_output'])
    snapshot['revision'] = device.revision(snapshot)
    return snapshot


class FakeProbe:
    def __init__(self, snapshot):
        self.snapshot = copy.deepcopy(snapshot)
        self.writes = []
        self.fail_source = None
        self.external_change = False

    def read(self):
        result = copy.deepcopy(self.snapshot)
        result['revision'] = device.revision(result)
        return result

    def get(self, dc, ids, args=()):
        if dc == 3: return {'1': [self.snapshot['preset']['number']], '4': [self.snapshot['preset']['scene']]}
        port = next(p for p in self.snapshot['ports'] if p['id'] == args[0][1])
        return {'7': device.encode_routes(port['preset_destinations'], len(self.snapshot['ports']))}

    def set_routes(self, source, bitmap):
        self.writes.append(source)
        port = next(p for p in self.snapshot['ports'] if p['id'] == source)
        port['preset_destinations'] = device.decode_routes(bitmap, len(self.snapshot['ports']))
        if source == self.fail_source:
            self.fail_source = None
            if self.external_change: port['preset_destinations'].append(12)
            raise TimeoutError('Lost acknowledgement')


class DeviceTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.snapshot = fixture()
        self.probe = FakeProbe(self.snapshot)
        self.journal = Path(self.tmp.name) / 'record.json'

    def prepared(self, additions=None):
        additions = additions or ['in-2__out-13']
        return {'revision': self.snapshot['revision'], 'additions': additions, 'removals': [],
                'changes': device.make_changes(self.snapshot, additions, [])}

    def execute(self, prepared):
        with patch.object(device, 'read_snapshot', lambda probe: probe.read()):
            return device.execute_plan(self.probe, prepared, self.journal)

    def test_unconfigured_device_refuses_session_before_network(self):
        with patch.object(device, 'SERIAL', ''), patch.object(device, 'HOST', ''), \
             patch.object(device.socket, 'gethostbyname') as lookup:
            with self.assertRaisesRegex(ValueError, 'MIOXLPLUS_DEVICE_SERIAL'):
                with device.session():
                    pass
            lookup.assert_not_called()

    def test_bitmap_roundtrip_padding(self):
        bitmap = device.encode_routes([1, 4, 5, 61], 61)
        self.assertEqual(len(bitmap), 16)
        self.assertEqual(bitmap[0], 9)
        self.assertEqual(device.decode_routes(bitmap, 61), [1, 4, 5, 61])
        with self.assertRaises(ValueError): device.encode_routes([62], 61)
        with self.assertRaises(ValueError): device.decode_routes([16] * 16, 61)

    def test_rejects_global_disabled_and_invalid_endpoints(self):
        for routes in [['osc-1__out-13'], ['in-2__out-99'], ['in-2__out-13'] * 2]:
            with self.assertRaises(ValueError): device.make_changes(self.snapshot, routes, [])
        self.snapshot['ports'][1]['global_destinations'] = [13]
        with self.assertRaisesRegex(ValueError, 'global'): device.make_changes(self.snapshot, [], ['in-2__out-13'])
        self.snapshot['ports'][1]['global_destinations'] = []
        self.snapshot['ports'][1]['enabled_input'] = False
        with self.assertRaisesRegex(ValueError, 'disabled'): device.make_changes(self.snapshot, ['in-2__out-13'], [])

    def test_verified_write_has_durable_before_and_after(self):
        result = self.execute(self.prepared())
        self.assertIn(13, result['ports'][1]['preset_destinations'])
        saved = json.loads(self.journal.read_text())
        self.assertEqual(saved['status'], 'verified')
        self.assertNotIn(13, saved['before']['ports'][1]['preset_destinations'])
        self.assertEqual(self.probe.writes, [2])

    def test_stale_review_sends_no_writes(self):
        self.probe.snapshot['ports'][1]['preset_destinations'].append(12)
        with self.assertRaisesRegex(ValueError, 'changed after review'): self.execute(self.prepared())
        self.assertEqual(self.probe.writes, [])

    def test_lost_ack_rolls_back_current_and_previous_source(self):
        self.probe.fail_source = 3
        with self.assertRaisesRegex(ValueError, 'Recovery: restored'):
            self.execute(self.prepared(['in-2__out-13', 'in-3__out-13']))
        self.assertEqual(self.probe.read()['revision'], self.snapshot['revision'])
        self.assertEqual(self.probe.writes, [2, 3, 3, 2])

    def test_recovery_does_not_overwrite_external_edit(self):
        self.probe.fail_source = 2
        self.probe.external_change = True
        with self.assertRaisesRegex(ValueError, 'recovery-needed'): self.execute(self.prepared())
        self.assertEqual(self.probe.writes, [2])
        self.assertIn(12, self.probe.snapshot['ports'][1]['preset_destinations'])

    def test_expired_and_reused_plans_never_open_device(self):
        token = 'a' * 48
        with patch.object(device, 'RUNTIME', Path(self.tmp.name)), patch.object(device, 'session') as session:
            path = Path(self.tmp.name) / 'plans' / f'{token}.json'
            for value in [{'status': 'used', 'expiresAt': 9999999999}, {'status': 'prepared', 'expiresAt': 0}]:
                device.save(path, value)
                with self.assertRaisesRegex(ValueError, 'expired'): device.apply({'id': token})
            session.assert_not_called()

    def test_checksum_and_ack_error_validation(self):
        def packet(error):
            content = bytes([64, 0, 16, 6, error])
            body = bytes(7) + enc(1,4) + enc(2,4) + enc(len(content),2) + content
            return bytes.fromhex('f0 00 01 73 7d') + body + bytes([(-sum(body)) & 127, 247])
        self.assertEqual(parse_sysex(packet(0))['ack']['code'], 0)
        self.assertIn('error', parse_sysex(packet(11)))
        bad = bytearray(packet(0)); bad[-2] ^= 1
        with self.assertRaises(AssertionError): parse_sysex(bad)


if __name__ == '__main__': unittest.main()
