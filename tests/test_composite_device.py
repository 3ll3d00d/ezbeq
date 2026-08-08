import json
import re

import pytest
from conftest import CapturingWsServer, CompositeMirrorSpyConfig, MinidspSpy
from pytest_httpserver import HTTPServer

from ezbeq.config import Config
from ezbeq.device import create_devices
from ezbeq.minidsp import MinidspStubRunner

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
    # make_runner is normally injected by Config.load_config(); _RawConfig
    # bypasses that, so tests that need create_devices() to actually
    # instantiate a Minidsp (rather than fail validation first) must supply
    # one themselves.
    return {'type': 'minidsp', 'exe': exe, 'cmdTimeout': 10, 'make_runner': lambda exe, options: MinidspStubRunner()}


def _reaper_entry():
    return {'type': 'reaper', 'ip': '127.0.0.1:1', 'timeout': 1}


def _minidsp_entry_with_spy(spy: MinidspSpy):
    return {'type': 'minidsp', 'exe': 'stub', 'cmdTimeout': 10, 'make_runner': lambda exe, options: spy}


class TestCompositeChannelTranslation:
    """
    load_biquads/send_commands take raw input/output channel index lists tied to a specific
    device's own hardware layout (see 'Custom Layouts' in the README) - unlike mute/unmute/
    set_gain's single channel, these were being forwarded to every member unchanged, regardless of
    that member's channelMap. That's fine for a mirror-mode array of identical units, but breaks a
    mapped composite spanning two different minidsp models (e.g. a 2x4HD and a 4x10): the raw
    channel indices that make sense for one model don't necessarily mean anything on the other.
    """

    def test_send_commands_translates_input_channels_per_member(self):
        plain_spy = MinidspSpy()
        mapped_spy = MinidspSpy()
        cfg = _RawConfig({
            'plain': _minidsp_entry_with_spy(plain_spy),
            'mapped': _minidsp_entry_with_spy(mapped_spy),
            'combo': {
                'type': 'composite', 'mode': 'mapped', 'primary': 'plain',
                'members': {
                    'plain': {},
                    'mapped': {'channelMap': {'1': '3'}}
                }
            }
        })
        devices = {d.name: d for d in create_devices(cfg, CapturingWsServer(), None)}
        devices['combo'].send_commands('1', [1], [], ['mute on'])

        assert any('input 0 mute on' in c for c in plain_spy.take_commands()), \
            "member with no channelMap should receive the composite-level channel unchanged (1 -> index 0)"
        assert any('input 2 mute on' in c for c in mapped_spy.take_commands()), \
            "member with channelMap {'1': '3'} should receive its own channel 3 (-> index 2), not composite channel 1"

    def test_load_biquads_translates_output_channels_per_member(self):
        plain_spy = MinidspSpy()
        mapped_spy = MinidspSpy()
        cfg = _RawConfig({
            'plain': _minidsp_entry_with_spy(plain_spy),
            'mapped': _minidsp_entry_with_spy(mapped_spy),
            'combo': {
                'type': 'composite', 'mode': 'mapped', 'primary': 'plain',
                'members': {
                    'plain': {},
                    'mapped': {'channelMap': {'2': '4'}}
                }
            }
        })
        devices = {d.name: d for d in create_devices(cfg, CapturingWsServer(), None)}
        biquad = {'b0': '1.0', 'b1': '0.0', 'b2': '0.0', 'a1': '0.0', 'a2': '0.0'}
        devices['combo'].load_biquads('1', True, [], [2], [biquad])

        assert any('output 1 peq' in c for c in plain_spy.take_commands()), \
            "member with no channelMap should receive the composite-level channel unchanged (2 -> index 1)"
        assert any('output 3 peq' in c for c in mapped_spy.take_commands()), \
            "member with channelMap {'2': '4'} should receive its own channel 4 (-> index 3), not composite channel 2"


class TestCompositeDeviceOrdering:

    def test_devices_are_returned_in_yaml_order_even_with_a_composite_in_the_middle(self):
        # create_devices() necessarily builds composites in a second pass (they need their
        # members to already exist as real Device instances) - this checks that second pass
        # doesn't leave composites trailing after every non-composite regardless of where they
        # were actually declared.
        cfg = _RawConfig({
            'sub1': _minidsp_entry(),
            'sub2': _minidsp_entry(),
            'bass_array': {'type': 'composite', 'mode': 'mirror', 'members': ['sub1', 'sub2']},
            'sub3': _minidsp_entry(),
        })
        names = [d.name for d in create_devices(cfg, CapturingWsServer(), None)]
        assert names == ['sub1', 'sub2', 'bass_array', 'sub3']

    def test_composite_declared_before_its_members_still_preserves_yaml_order(self):
        cfg = _RawConfig({
            'bass_array': {'type': 'composite', 'mode': 'mirror', 'members': ['sub1', 'sub2']},
            'sub1': _minidsp_entry(),
            'sub2': _minidsp_entry(),
        })
        names = [d.name for d in create_devices(cfg, CapturingWsServer(), None)]
        assert names == ['bass_array', 'sub1', 'sub2']


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

    def test_structurally_mixed_gain_support_blocked_without_allow_partial_gain(self):
        # sub1 (minidsp) supports set_gain/mute/unmute; reaper1 structurally
        # doesn't (see Reaper.SUPPORTED_OPS) - applying set_gain to the
        # composite would only affect sub1, silently skewing the array.
        cfg = _RawConfig({
            'sub1': _minidsp_entry(),
            'reaper1': _reaper_entry(),
            'home_theatre': {
                'type': 'composite', 'mode': 'mapped', 'primary': 'sub1',
                'members': {'sub1': {}, 'reaper1': {}}
            }
        })
        with pytest.raises(ValueError, match="would apply 'set_gain' to some members but not others"):
            create_devices(cfg, None, None)

    def test_structurally_mixed_gain_support_allowed_with_flag(self):
        cfg = _RawConfig({
            'sub1': _minidsp_entry(),
            'reaper1': _reaper_entry(),
            'home_theatre': {
                'type': 'composite', 'mode': 'mapped', 'primary': 'sub1', 'allowPartialGain': True,
                'members': {'sub1': {}, 'reaper1': {}}
            }
        })
        create_devices(cfg, CapturingWsServer(), None)  # should not raise

    def test_explicit_skip_op_on_capable_device_also_counts_as_mixed(self):
        # sub2 could do set_gain (it's a minidsp) but this config opts it out
        # anyway - deliberate or not, the composite would still only apply
        # set_gain to sub1, so the same guard applies.
        cfg = _RawConfig({
            'sub1': _minidsp_entry(),
            'sub2': _minidsp_entry(),
            'bass_array': {
                'type': 'composite', 'mode': 'mapped', 'primary': 'sub1',
                'members': {'sub1': {}, 'sub2': {'skipOps': ['set_gain']}}
            }
        })
        with pytest.raises(ValueError, match="would apply 'set_gain' to some members but not others"):
            create_devices(cfg, None, None)

    def test_uniformly_unsupported_op_is_not_treated_as_mixed(self):
        # both members are reaper - neither supports set_gain/mute/unmute, so
        # there's no partial application to guard against.
        cfg = _RawConfig({
            'reaper1': _reaper_entry(),
            'reaper2': _reaper_entry(),
            'av': {
                'type': 'composite', 'mode': 'mapped', 'primary': 'reaper1',
                'members': {'reaper1': {}, 'reaper2': {}}
            }
        })
        create_devices(cfg, CapturingWsServer(), None)  # should not raise

    def test_mirror_mode_never_needs_allow_partial_gain(self):
        # mirror mode already requires identical member types, so support is
        # always uniform - no allowPartialGain flag needed or accepted.
        cfg = _RawConfig({
            'sub1': _minidsp_entry(),
            'sub2': _minidsp_entry(),
            'bass_array': {'type': 'composite', 'mode': 'mirror', 'members': ['sub1', 'sub2']}
        })
        create_devices(cfg, CapturingWsServer(), None)  # should not raise


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
