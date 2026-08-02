import json
import re

import pytest
from conftest import CompositeMirrorSpyConfig, MinidspSpy
from pytest_httpserver import HTTPServer

from ezbeq.config import Config
from ezbeq.device import create_devices

EXTSTATE_URI_PATTERN = re.compile(r"^/_/SET/EXTSTATE/.*")


class _RawConfig(Config):
    """Minimal Config for exercising create_devices()' validation directly, without needing real hardware for every device referenced."""

    def __init__(self, devices: dict):
        self.__devices = devices
        super().__init__('validate')

    def load_config(self):
        return {'devices': self.__devices, 'port': 8080}

    @property
    def config_path(self):
        return '/tmp'

    @property
    def check_for_updates(self):
        return False


def _minidsp_entry(exe='stub'):
    return {'type': 'minidsp', 'exe': exe, 'cmdTimeout': 10}


class TestCompositeConfigValidation:

    def test_missing_member_reference_rejected(self):
        cfg = _RawConfig({
            'sub1': _minidsp_entry(),
            'bass_array': {'type': 'composite', 'mode': 'mirror', 'members': ['sub1', 'sub2']}
        })
        with pytest.raises(ValueError, match="unknown member 'sub2'"):
            create_devices(cfg, None, None)

    def test_nested_composite_rejected(self):
        cfg = _RawConfig({
            'sub1': _minidsp_entry(),
            'inner': {'type': 'composite', 'mode': 'mirror', 'members': ['sub1']},
            'outer': {'type': 'composite', 'mode': 'mirror', 'members': ['inner']}
        })
        with pytest.raises(ValueError, match='itself a composite'):
            create_devices(cfg, None, None)

    def test_mirror_mode_requires_identical_member_types(self):
        cfg = _RawConfig({
            'sub1': _minidsp_entry(),
            'reaper1': {'type': 'reaper', 'ip': '127.0.0.1:1'},
            'bass_array': {'type': 'composite', 'mode': 'mirror', 'members': ['sub1', 'reaper1']}
        })
        with pytest.raises(ValueError, match='mirror mode but its members have differing types'):
            create_devices(cfg, None, None)

    def test_mapped_mode_requires_primary(self):
        cfg = _RawConfig({
            'sub1': _minidsp_entry(),
            'sub2': _minidsp_entry(),
            'bass_array': {'type': 'composite', 'mode': 'mapped', 'members': {'sub1': {}, 'sub2': {}}}
        })
        with pytest.raises(ValueError, match="no 'primary' member set"):
            create_devices(cfg, None, None)

    def test_mapped_mode_primary_must_be_a_member(self):
        cfg = _RawConfig({
            'sub1': _minidsp_entry(),
            'sub2': _minidsp_entry(),
            'bass_array': {
                'type': 'composite', 'mode': 'mapped', 'primary': 'sub3',
                'members': {'sub1': {}, 'sub2': {}}
            }
        })
        with pytest.raises(ValueError, match="not one of its members"):
            create_devices(cfg, None, None)

    def test_invalid_mode_rejected(self):
        cfg = _RawConfig({
            'sub1': _minidsp_entry(),
            'bass_array': {'type': 'composite', 'mode': 'bogus', 'members': ['sub1']}
        })
        with pytest.raises(ValueError, match="invalid mode 'bogus'"):
            create_devices(cfg, None, None)

    def test_device_cannot_belong_to_two_composites(self):
        cfg = _RawConfig({
            'sub1': _minidsp_entry(),
            'array_a': {'type': 'composite', 'mode': 'mirror', 'members': ['sub1']},
            'array_b': {'type': 'composite', 'mode': 'mirror', 'members': ['sub1']}
        })
        with pytest.raises(ValueError, match='cannot be a member of more than one composite'):
            create_devices(cfg, None, None)


class TestCompositeVisibility:

    def test_members_hidden_from_listing_by_default(self, composite_mirror_client):
        r = composite_mirror_client.get('/api/2/devices')
        assert r.status_code == 200
        assert set(r.json.keys()) == {'bass_array'}

    def test_members_addressable_directly_even_when_hidden(self, composite_mirror_client):
        r = composite_mirror_client.get('/api/2/devices')
        assert r.status_code == 200
        r = composite_mirror_client.put('/api/1/devices/sub1/config/1/active')
        assert r.status_code == 200

    def test_expose_members_opts_back_in(self, httpserver: HTTPServer, tmp_path):
        from ezbeq import main
        cfg = CompositeMirrorSpyConfig(httpserver.host, httpserver.port, tmp_path, expose_members=True)
        app, _ws = main.create_app(cfg)
        client = app.test_client()
        r = client.get('/api/2/devices')
        assert r.status_code == 200
        assert set(r.json.keys()) == {'bass_array', 'sub1', 'sub2'}


class TestCompositeMirrorFanOut:

    def test_activate_dispatches_to_every_member(self, composite_mirror_client, composite_mirror_cfg):
        r = composite_mirror_client.put('/api/1/devices/bass_array/config/2/active')
        assert r.status_code == 200
        for spy in composite_mirror_cfg.spies.values():
            cmds = spy.take_commands()
            assert cmds, 'expected the member to have received the activate command'

    def test_load_filter_dispatches_identical_commands_to_every_member(self, composite_mirror_client, composite_mirror_cfg):
        r = composite_mirror_client.put('/api/1/devices/bass_array/filter/1', data=json.dumps({'entryId': '123456_0'}),
                                        content_type='application/json')
        assert r.status_code == 200
        member_cmds = [spy.take_commands() for spy in composite_mirror_cfg.spies.values()]
        assert all(cmds for cmds in member_cmds)
        assert len({tuple(cmds) for cmds in member_cmds}) == 1, 'every member should receive identical commands'

    def test_mute_and_gain_dispatch_to_every_member(self, composite_mirror_client, composite_mirror_cfg):
        r = composite_mirror_client.put('/api/1/devices/bass_array/mute')
        assert r.status_code == 200
        for spy in composite_mirror_cfg.spies.values():
            assert spy.take_commands() == ['mute on']

        r = composite_mirror_client.put('/api/1/devices/bass_array/gain', data=json.dumps({'gain': -3.0}),
                                        content_type='application/json')
        assert r.status_code == 200
        for spy in composite_mirror_cfg.spies.values():
            cmds = spy.take_commands()
            assert any('gain -- -3.0' in c for c in cmds)

    def test_composite_state_mirrors_primary_member(self, composite_mirror_client):
        r = composite_mirror_client.get('/api/2/devices')
        assert r.status_code == 200
        state = r.json['bass_array']
        assert state['type'] == 'composite'
        assert state['name'] == 'bass_array'
        assert 'masterVolume' in state
        assert set(state['members'].keys()) == {'sub1', 'sub2'}


class TestCompositeMappedFanOut:

    def test_slot_translation_and_skip_ops(self, composite_mapped_client, composite_mapped_cfg, httpserver: HTTPServer):
        httpserver.expect_request(EXTSTATE_URI_PATTERN).respond_with_data('ok', content_type='text/plain')

        r = composite_mapped_client.put('/api/1/devices/home_theatre/mute')
        assert r.status_code == 200
        assert composite_mapped_cfg.spy.take_commands() == ['mute on'], 'sub1 should still receive mute'

        r = composite_mapped_client.put('/api/1/devices/home_theatre/filter/1', data=json.dumps({'entryId': '123456_0'}),
                                        content_type='application/json')
        assert r.status_code == 200
        assert composite_mapped_cfg.spy.take_commands(), 'sub1 should receive the filter load on its own slot 1'
        reaper_reqs = [req for req, _ in httpserver.log if EXTSTATE_URI_PATTERN.match(req.path)]
        assert reaper_reqs, "reaper1 should have received the filter load, translated onto its 'REAPER' slot"

    def test_primary_drives_displayed_state(self, composite_mapped_client):
        r = composite_mapped_client.get('/api/2/devices')
        assert r.status_code == 200
        state = r.json['home_theatre']
        assert state['type'] == 'composite'
        assert 'masterVolume' in state, 'sub1 is primary and has a masterVolume; reaper1 does not'
        assert set(state['members'].keys()) == {'sub1', 'reaper1'}


class TestCompositePartialFailure:

    def test_other_members_still_applied_when_one_fails(self, composite_mirror_client, composite_mirror_cfg):
        # force initial hydration of every member first - otherwise the first
        # spy invocation fail_next would trigger on is the lazy hydration
        # read, not the mute command we actually want to fail.
        assert composite_mirror_client.get('/api/2/devices').status_code == 200

        failing_spy: MinidspSpy = composite_mirror_cfg.spies['sub1']
        healthy_spy: MinidspSpy = composite_mirror_cfg.spies['sub2']
        failing_spy.fail_next = True

        r = composite_mirror_client.put('/api/1/devices/bass_array/mute')
        assert r.status_code == 500
        assert healthy_spy.take_commands() == ['mute on'], 'the healthy member should still have applied the command'

    def test_concurrent_dispatch_is_parallel_not_sequential(self, composite_mirror_client, composite_mirror_cfg):
        # force initial hydration first so the timed call below only measures
        # the fan-out of the mute command itself.
        assert composite_mirror_client.get('/api/2/devices').status_code == 200
        start_index = {name: len(spy.call_starts) for name, spy in composite_mirror_cfg.spies.items()}

        for spy in composite_mirror_cfg.spies.values():
            spy.delay = 0.3

        r = composite_mirror_client.put('/api/1/devices/bass_array/mute')
        assert r.status_code == 200

        # __fan_out dispatches the mute command to every member before it
        # dispatches anything else (state refreshes etc), so each spy's next
        # invocation after hydration is the mute command itself. What matters
        # here is whether that call started at roughly the same time across
        # members (parallel) rather than one after another (sequential).
        mute_call_starts = [spy.call_starts[start_index[name]] for name, spy in composite_mirror_cfg.spies.items()]
        assert max(mute_call_starts) - min(mute_call_starts) < 0.15, 'members were dispatched to serially, not in parallel'


class TestCompositeBroadcast:

    def test_broadcasts_after_successful_op(self, httpserver: HTTPServer, tmp_path):
        from conftest import CapturingWsServer

        from ezbeq import main

        cfg = CompositeMirrorSpyConfig(httpserver.host, httpserver.port, tmp_path)
        ws = CapturingWsServer()
        app, _ws = main.create_app(cfg, ws)
        client = app.test_client()

        ws.take_messages()  # drain any startup noise
        r = client.put('/api/1/devices/bass_array/mute')
        assert r.status_code == 200

        msgs = [json.loads(m) for m in ws.take_messages()]
        composite_msgs = [m for m in msgs if m.get('message') == 'DeviceState' and m['data'].get('name') == 'bass_array']
        assert composite_msgs, 'expected a DeviceState broadcast for the composite device'


class TestCompositeStateResilience:

    def test_one_members_state_timeout_does_not_break_the_whole_listing(self, httpserver: HTTPServer, tmp_path):
        from ezbeq import main

        cfg = CompositeMirrorSpyConfig(httpserver.host, httpserver.port, tmp_path)
        # sub1's own cmdTimeout is tiny, and its spy is made to hang well past
        # it, so sub1.state() genuinely raises concurrent.futures.TimeoutError
        # (this is a real Minidsp behaviour, not a test artifact - see
        # Minidsp.__load_state()). Before the fix, one member's state read
        # timing out during __read_all_states() propagated uncaught, which
        # would 500 the *entire* /api/2/devices response, including every
        # other unrelated device.
        cfg.devices['sub1']['cmdTimeout'] = 0.05
        app, _ws = main.create_app(cfg)
        client = app.test_client()

        assert client.get('/api/2/devices').status_code == 200  # hydrate both members while healthy
        cfg.spies['sub1'].delay = 0.3  # now exceeds sub1's own (tiny) cmdTimeout

        r = client.get('/api/2/devices')
        assert r.status_code == 200, 'sub1 timing out should not break the whole listing'
        members = r.json['bass_array']['members']
        assert 'sub1' in members, "sub1 should keep showing its last known state, not disappear or 500"
        assert 'sub2' in members
