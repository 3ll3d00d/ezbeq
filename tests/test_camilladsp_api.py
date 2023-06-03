import json

import pytest
from busypie import wait, SECOND, MILLISECOND

from conftest import CamillaDspSpyConfig


@pytest.mark.parametrize("mute_op", [True, False])
def test_mute_master(camilladsp_client, camilladsp_app, mute_op):
    config: CamillaDspSpyConfig = camilladsp_app.config['APP_CONFIG']
    assert isinstance(config, CamillaDspSpyConfig)
    ensure_inited(config)

    call = camilladsp_client.put if mute_op is True else camilladsp_client.delete
    r = call(f"/api/1/devices/master/mute")
    assert r
    assert r.status_code == 200

    def was_muted():
        cmds = config.spy.take_commands()
        assert len(cmds) == 2
        assert cmds[0] == {'SetMute': mute_op}
        assert cmds[1] == 'GetMute'

    wait().at_most(2 * SECOND).poll_interval(10 * MILLISECOND).with_description('was_muted').until_asserted(was_muted)

    def ui_updated():
        device_states = take_device_states(config)
        assert device_states[-1]['mute'] is mute_op

    wait().at_most(2 * SECOND).poll_interval(10 * MILLISECOND).with_description('ui_updated').until_asserted(ui_updated)


@pytest.mark.parametrize("volume", [-10, -15, -20])
def test_set_volume(camilladsp_client, camilladsp_app, volume):
    config: CamillaDspSpyConfig = camilladsp_app.config['APP_CONFIG']
    assert isinstance(config, CamillaDspSpyConfig)
    ensure_inited(config)

    payload = {'gain': volume}
    r = camilladsp_client.put(f"/api/1/devices/master/gain", data=json.dumps(payload), content_type='application/json')
    assert r
    assert r.status_code == 200

    def volume_changed():
        cmds = config.spy.take_commands()
        assert len(cmds) == 2
        assert cmds[0] == {'SetVolume': volume}
        assert cmds[1] == 'GetVolume'

    wait().at_most(2 * SECOND).poll_interval(10 * MILLISECOND).with_description('volume_changed').until_asserted(
        volume_changed)

    def ui_updated():
        device_states = take_device_states(config)
        assert device_states[-1]['masterVolume'] == volume

    wait().at_most(2 * SECOND).poll_interval(10 * MILLISECOND).with_description('ui_updated').until_asserted(ui_updated)


def test_load_known_entry_and_then_clear(camilladsp_client, camilladsp_app):
    config: CamillaDspSpyConfig = camilladsp_app.config['APP_CONFIG']
    assert isinstance(config, CamillaDspSpyConfig)
    ensure_inited(config)

    r = camilladsp_client.put(f"/api/1/devices/master/filter/CamillaDSP", data=json.dumps({'entryId': '123456_0'}),
                              content_type='application/json')
    assert r.status_code == 200

    def beq_loaded():
        cmds = config.spy.take_commands()
        assert len(cmds) == 3
        assert cmds[0] == 'GetConfigJson'
        assert isinstance(cmds[1], dict)
        assert 'SetConfigJson' in cmds[1]
        beq_is_loaded(json.loads(cmds[1]['SetConfigJson']), 0.0)
        assert cmds[2] == 'Reload'

    wait().at_most(2 * SECOND).poll_interval(10 * MILLISECOND).with_description('beq_loaded').until_asserted(beq_loaded)

    def entry_is_shown():
        device_states = take_device_states(config)
        assert device_states[-1]['slots'][0]['last'] == 'Alien Resurrection'

    wait().at_most(2 * SECOND).poll_interval(10 * MILLISECOND).with_description('entry_is_shown').until_asserted(
        entry_is_shown)

    r = camilladsp_client.delete(f"/api/1/devices/master/filter/CamillaDSP")
    assert r.status_code == 200

    def beq_unloaded():
        cmds = config.spy.take_commands()
        assert len(cmds) == 3
        assert cmds[0] == 'GetConfigJson'
        assert isinstance(cmds[1], dict)
        assert 'SetConfigJson' in cmds[1]
        beq_is_unloaded(json.loads(cmds[1]['SetConfigJson']))
        assert cmds[2] == 'Reload'

    wait().at_most(2 * SECOND).poll_interval(10 * MILLISECOND).with_description('beq_unloaded').until_asserted(
        beq_unloaded)

    def entry_is_removed():
        device_states = take_device_states(config)
        assert device_states[-1]['slots'][0]['last'] == 'Empty'

    wait().at_most(2 * SECOND).poll_interval(10 * MILLISECOND).with_description('entry_is_removed').until_asserted(
        entry_is_removed)


def test_load_known_entry_with_gain_and_then_clear(camilladsp_client, camilladsp_app):
    config: CamillaDspSpyConfig = camilladsp_app.config['APP_CONFIG']
    assert isinstance(config, CamillaDspSpyConfig)
    ensure_inited(config)

    payload = {"slots": [{"id": "CamillaDSP", "gains": [{"id": "0", "value": -1.5}], "mutes": [], "entry": "123456_0"}]}
    r = camilladsp_client.patch(f"/api/2/devices/master", data=json.dumps(payload), content_type='application/json')
    assert r.status_code == 200

    def beq_loaded():
        cmds = config.spy.take_commands()
        assert len(cmds) == 3
        assert cmds[0] == 'GetConfigJson'
        assert isinstance(cmds[1], dict)
        assert 'SetConfigJson' in cmds[1]
        beq_is_loaded(json.loads(cmds[1]['SetConfigJson']), -1.5)
        assert cmds[2] == 'Reload'

    wait().at_most(2 * SECOND).poll_interval(10 * MILLISECOND).with_description('beq_loaded').until_asserted(beq_loaded)

    def entry_is_shown():
        device_states = take_device_states(config)
        assert device_states[-1]['slots'][0]['last'] == 'Alien Resurrection'
        assert device_states[-1]['slots'][0]['gains'] == [{'id': 1, 'value': -1.5}]
        assert device_states[-1]['slots'][0]['mutes'] == [{'id': 1, 'value': False}]

    wait().at_most(2 * SECOND).poll_interval(10 * MILLISECOND).with_description('entry_is_shown').until_asserted(
        entry_is_shown)

    r = camilladsp_client.delete(f"/api/1/devices/master/filter/CamillaDSP")
    assert r.status_code == 200

    def beq_unloaded():
        cmds = config.spy.take_commands()
        assert len(cmds) == 3
        assert cmds[0] == 'GetConfigJson'
        assert isinstance(cmds[1], dict)
        assert 'SetConfigJson' in cmds[1]
        beq_is_unloaded(json.loads(cmds[1]['SetConfigJson']))
        assert cmds[2] == 'Reload'

    wait().at_most(2 * SECOND).poll_interval(10 * MILLISECOND).with_description('beq_unloaded').until_asserted(
        beq_unloaded)

    def entry_is_removed():
        device_states = take_device_states(config)
        assert device_states[-1]['slots'][0]['last'] == 'Empty'
        assert device_states[-1]['slots'][0]['gains'] == [{'id': 1, 'value': 0.0}]
        assert device_states[-1]['slots'][0]['mutes'] == [{'id': 1, 'value': False}]

    wait().at_most(2 * SECOND).poll_interval(10 * MILLISECOND).with_description('entry_is_removed').until_asserted(
        entry_is_removed)


def test_input_gain_and_mute(camilladsp_client, camilladsp_app):
    config: CamillaDspSpyConfig = camilladsp_app.config['APP_CONFIG']
    assert isinstance(config, CamillaDspSpyConfig)
    ensure_inited(config)

    payload = {"slots": [{"id": "CamillaDSP", "gains": [{"id": "1", "value": -1.5}], "mutes": [{"id": "1", "value": True}]}]}
    r = camilladsp_client.patch(f"/api/2/devices/master", data=json.dumps(payload), content_type='application/json')
    assert r.status_code == 200

    def gain_changed():
        cmds = config.spy.take_commands()
        assert len(cmds) == 3
        assert cmds[0] == 'GetConfigJson'
        assert isinstance(cmds[1], dict)
        assert 'SetConfigJson' in cmds[1]
        new_config = json.loads(cmds[1]['SetConfigJson'])
        assert next(f for f in new_config['pipeline'] if f['type'] == 'Filter' and f['channel'] == 1)['names'] == [
            "vol",
            "BEQ_Gain_1"
        ]
        new_filters = new_config['filters']
        assert 'vol' in new_filters
        assert 'BEQ_Gain_1' in new_filters
        assert new_filters['BEQ_Gain_1'] == {'parameters': {'gain': -1.5, 'inverted': False, 'mute': True},
                                             'type': 'Gain'}
        assert len(list(new_filters.keys())) == 2
        assert cmds[2] == 'Reload'

    wait().at_most(2 * SECOND).poll_interval(10 * MILLISECOND).with_description('beq_loaded').until_asserted(gain_changed)

    def entry_is_shown():
        device_states = take_device_states(config)
        assert device_states[-1]['slots'][0]['last'] == 'Empty'
        assert device_states[-1]['slots'][0]['gains'] == [{'id': 1, 'value': -1.5}]
        assert device_states[-1]['slots'][0]['mutes'] == [{'id': 1, 'value': True}]

    wait().at_most(2 * SECOND).poll_interval(10 * MILLISECOND).with_description('entry_is_shown').until_asserted(
        entry_is_shown)


def test_input_gain_and_mute_on_unsupported_channel(camilladsp_client, camilladsp_app):
    config: CamillaDspSpyConfig = camilladsp_app.config['APP_CONFIG']
    assert isinstance(config, CamillaDspSpyConfig)
    ensure_inited(config)

    payload = {"slots": [{"id": "CamillaDSP", "gains": [{"id": "0", "value": -1.5}], "mutes": [{"id": "0", "value": True}]}]}
    r = camilladsp_client.patch(f"/api/2/devices/master", data=json.dumps(payload), content_type='application/json')
    assert r.status_code == 500


def take_device_states(config):
    msgs = config.msg_spy.take_messages()
    assert len(msgs) != 0
    payloads = [json.loads(m) for m in msgs]
    device_states = [p['data'] for p in payloads if p['message'] == 'DeviceState']
    assert len(device_states) != 0
    return device_states


def ensure_inited(config):
    def inited():
        assert config.spy.inited
        cmds = config.spy.take_commands()
        assert cmds
        assert len(cmds) == 4
        assert cmds[0] == 'GetConfigJson'
        assert cmds[1] == 'GetVolume'
        assert cmds[2] == 'GetMute'
        assert cmds[3] == 'SetUpdateInterval'

    wait().at_most(2 * SECOND).poll_interval(10 * MILLISECOND).with_description('inited').until_asserted(inited)
    config.msg_spy.take_messages()


def beq_is_loaded(new_config, expected_gain):
    assert next(f for f in new_config['pipeline'] if f['type'] == 'Filter' and f['channel'] == 1)['names'] == [
        "vol",
        "BEQ_Gain_1",
        "BEQ_0_abcdefghijklm",
        "BEQ_1_abcdefghijklm",
        "BEQ_2_abcdefghijklm",
        "BEQ_3_abcdefghijklm",
        "BEQ_4_abcdefghijklm"
    ]
    new_filters = new_config['filters']
    assert 'vol' in new_filters
    assert 'BEQ_Gain_1' in new_filters
    assert new_filters['BEQ_Gain_1'] == {'parameters': {'gain': expected_gain, 'inverted': False, 'mute': False},
                                         'type': 'Gain'}
    assert 'BEQ_0_abcdefghijklm' in new_filters
    assert new_filters['BEQ_0_abcdefghijklm'] == {
        'parameters': {'freq': 33.0, 'gain': 5.0, 'q': 0.9, 'type': 'Lowshelf'}, 'type': 'Biquad'}
    assert 'BEQ_1_abcdefghijklm' in new_filters
    assert new_filters['BEQ_1_abcdefghijklm'] == {
        'parameters': {'freq': 33.0, 'gain': 5.0, 'q': 0.9, 'type': 'Lowshelf'}, 'type': 'Biquad'}
    assert 'BEQ_2_abcdefghijklm' in new_filters
    assert new_filters['BEQ_2_abcdefghijklm'] == {
        'parameters': {'freq': 33.0, 'gain': 5.0, 'q': 0.9, 'type': 'Lowshelf'}, 'type': 'Biquad'}
    assert 'BEQ_3_abcdefghijklm' in new_filters
    assert new_filters['BEQ_3_abcdefghijklm'] == {
        'parameters': {'freq': 33.0, 'gain': 5.0, 'q': 0.9, 'type': 'Lowshelf'}, 'type': 'Biquad'}
    assert 'BEQ_4_abcdefghijklm' in new_filters
    assert new_filters['BEQ_4_abcdefghijklm'] == {
        'parameters': {'freq': 33.0, 'gain': 5.0, 'q': 0.9, 'type': 'Lowshelf'}, 'type': 'Biquad'}
    assert len(list(new_filters.keys())) == 7


def beq_is_unloaded(new_config):
    assert next(f for f in new_config['pipeline'] if f['type'] == 'Filter' and f['channel'] == 1)['names'] == ["vol"]
    new_filters = new_config['filters']
    assert 'vol' in new_filters
    assert 'BEQ_Gain_1' not in new_filters
    assert 'BEQ_0_abcdefghijklm' not in new_filters
    assert 'BEQ_1_abcdefghijklm' not in new_filters
    assert 'BEQ_2_abcdefghijklm' not in new_filters
    assert 'BEQ_3_abcdefghijklm' not in new_filters
    assert 'BEQ_4_abcdefghijklm' not in new_filters
    assert len(list(new_filters.keys())) == 1
