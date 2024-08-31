import json

import pytest
from busypie import wait, SECOND, MILLISECOND

from conftest import CamillaDspSpyConfig


@pytest.mark.parametrize("mute_op", [True, False])
def test_mute_master(single_camilladsp_client, single_camilladsp_app, mute_op):
    config: CamillaDspSpyConfig = single_camilladsp_app.config['APP_CONFIG']
    assert isinstance(config, CamillaDspSpyConfig)
    ensure_inited(config)

    call = single_camilladsp_client.put if mute_op is True else single_camilladsp_client.delete
    r = call(f"/api/1/devices/master/mute")
    assert r
    assert r.status_code == 200

    def was_muted():
        cmds = config.spy.take_commands()
        assert cmds
        assert cmds.pop(0) == {'SetMute': mute_op}
        assert cmds
        assert cmds.pop(0) == 'GetMute'
        assert not cmds

    wait().at_most(2 * SECOND).poll_interval(10 * MILLISECOND).with_description('was_muted').until_asserted(was_muted)

    def ui_updated():
        device_states = take_device_states(config)
        assert device_states[-1]['mute'] is mute_op

    wait().at_most(2 * SECOND).poll_interval(10 * MILLISECOND).with_description('ui_updated').until_asserted(ui_updated)


@pytest.mark.parametrize("volume", [-10, -15, -20])
def test_set_volume(single_camilladsp_client, single_camilladsp_app, volume):
    config: CamillaDspSpyConfig = single_camilladsp_app.config['APP_CONFIG']
    assert isinstance(config, CamillaDspSpyConfig)
    ensure_inited(config)

    payload = {'gain': volume}
    r = single_camilladsp_client.put(f"/api/1/devices/master/gain", data=json.dumps(payload), content_type='application/json')
    assert r
    assert r.status_code == 200

    def volume_changed():
        cmds = config.spy.take_commands()
        assert cmds
        assert cmds.pop(0) == {'SetVolume': volume}
        assert cmds
        assert cmds.pop(0) == 'GetVolume'
        assert not cmds

    wait().at_most(2 * SECOND).poll_interval(10 * MILLISECOND).with_description('volume_changed').until_asserted(
        volume_changed)

    def ui_updated():
        device_states = take_device_states(config)
        assert device_states[-1]['masterVolume'] == volume

    wait().at_most(2 * SECOND).poll_interval(10 * MILLISECOND).with_description('ui_updated').until_asserted(ui_updated)


def test_load_known_entry_and_then_clear(single_camilladsp_client, single_camilladsp_app):
    config: CamillaDspSpyConfig = single_camilladsp_app.config['APP_CONFIG']
    assert isinstance(config, CamillaDspSpyConfig)
    ensure_inited(config)

    r = single_camilladsp_client.put(f"/api/1/devices/master/filter/CamillaDSP", data=json.dumps({'entryId': '123456_0'}),
                              content_type='application/json')
    assert r.status_code == 200

    def beq_loaded():
        cmds = config.spy.take_commands()
        assert cmds
        assert cmds.pop(0) == 'GetConfigJson'
        assert cmds
        n = cmds.pop(0)
        assert isinstance(n, dict)
        assert 'SetConfigJson' in n
        beq_is_loaded(json.loads(n['SetConfigJson']), 0.0)
        has_one_filter(json.loads(n['SetConfigJson']), 0, 1)
        assert not cmds

    wait().at_most(2 * SECOND).poll_interval(10 * MILLISECOND).with_description('beq_loaded').until_asserted(beq_loaded)

    def entry_is_shown():
        device_states = take_device_states(config)
        assert device_states[-1]['slots'][0]['last'] == 'Alien Resurrection'

    wait().at_most(2 * SECOND).poll_interval(10 * MILLISECOND).with_description('entry_is_shown').until_asserted(
        entry_is_shown)

    r = single_camilladsp_client.delete(f"/api/1/devices/master/filter/CamillaDSP")
    assert r.status_code == 200

    def beq_unloaded():
        cmds = config.spy.take_commands()
        assert cmds
        assert cmds.pop(0) == 'GetConfigJson'
        assert cmds
        n = cmds.pop(0)
        assert isinstance(n, dict)
        assert 'SetConfigJson' in n
        beq_is_unloaded(json.loads(n['SetConfigJson']))
        has_one_filter(json.loads(n['SetConfigJson']), 0, 1)
        assert not cmds

    wait().at_most(2 * SECOND).poll_interval(10 * MILLISECOND).with_description('beq_unloaded').until_asserted(
        beq_unloaded)

    def entry_is_removed():
        device_states = take_device_states(config)
        assert device_states[-1]['slots'][0]['last'] == 'Empty'

    wait().at_most(2 * SECOND).poll_interval(10 * MILLISECOND).with_description('entry_is_removed').until_asserted(
        entry_is_removed)


def test_load_known_entry_with_gain_and_then_clear(single_camilladsp_client, single_camilladsp_app):
    config: CamillaDspSpyConfig = single_camilladsp_app.config['APP_CONFIG']
    assert isinstance(config, CamillaDspSpyConfig)
    ensure_inited(config)

    payload = {"slots": [{"id": "CamillaDSP", "gains": [{"id": "1", "value": -1.5}], "mutes": [], "entry": "123456_0"}]}
    r = single_camilladsp_client.patch(f"/api/3/devices/master", data=json.dumps(payload), content_type='application/json')
    assert r.status_code == 200

    def beq_loaded():
        cmds = config.spy.take_commands()
        assert cmds
        assert cmds.pop(0) == 'GetConfigJson'
        assert cmds
        n = cmds.pop(0)
        assert isinstance(n, dict)
        assert 'SetConfigJson' in n
        beq_is_loaded(json.loads(n['SetConfigJson']), -1.5)
        has_one_filter(json.loads(n['SetConfigJson']), 0, 1)
        assert not cmds

    wait().at_most(2 * SECOND).poll_interval(10 * MILLISECOND).with_description('beq_loaded').until_asserted(beq_loaded)

    def entry_is_shown():
        device_states = take_device_states(config)
        assert device_states[-1]['slots'][0]['last'] == 'Alien Resurrection'
        assert device_states[-1]['slots'][0]['gains'] == [{'id': 1, 'value': -1.5}]
        assert device_states[-1]['slots'][0]['mutes'] == [{'id': 1, 'value': False}]

    wait().at_most(2 * SECOND).poll_interval(10 * MILLISECOND).with_description('entry_is_shown').until_asserted(
        entry_is_shown)

    r = single_camilladsp_client.delete(f"/api/1/devices/master/filter/CamillaDSP")
    assert r.status_code == 200

    def beq_unloaded():
        cmds = config.spy.take_commands()
        assert cmds
        assert cmds.pop(0) == 'GetConfigJson'
        assert cmds
        n = cmds.pop(0)
        assert isinstance(n, dict)
        assert 'SetConfigJson' in n
        beq_is_unloaded(json.loads(n['SetConfigJson']))
        has_one_filter(json.loads(n['SetConfigJson']), 0, 1)
        assert not cmds

    wait().at_most(2 * SECOND).poll_interval(10 * MILLISECOND).with_description('beq_unloaded').until_asserted(
        beq_unloaded)

    def entry_is_removed():
        device_states = take_device_states(config)
        assert device_states[-1]['slots'][0]['last'] == 'Empty'
        assert device_states[-1]['slots'][0]['gains'] == [{'id': 1, 'value': 0.0}]
        assert device_states[-1]['slots'][0]['mutes'] == [{'id': 1, 'value': False}]

    wait().at_most(2 * SECOND).poll_interval(10 * MILLISECOND).with_description('entry_is_removed').until_asserted(
        entry_is_removed)


def test_load_known_entry_then_load_gain_and_then_clear(single_camilladsp_client, single_camilladsp_app):
    config: CamillaDspSpyConfig = single_camilladsp_app.config['APP_CONFIG']
    assert isinstance(config, CamillaDspSpyConfig)
    ensure_inited(config)

    payload = {"slots": [{"id": "CamillaDSP", "entry": "123456_0"}]}
    r = single_camilladsp_client.patch(f"/api/3/devices/master", data=json.dumps(payload), content_type='application/json')
    assert r.status_code == 200

    def beq_loaded():
        cmds = config.spy.take_commands()
        assert cmds
        assert cmds.pop(0) == 'GetConfigJson'
        assert cmds
        n = cmds.pop(0)
        assert isinstance(n, dict)
        assert 'SetConfigJson' in n
        beq_is_loaded(json.loads(n['SetConfigJson']), 0.0)
        has_one_filter(json.loads(n['SetConfigJson']), 0, 1)
        assert not cmds

    wait().at_most(2 * SECOND).poll_interval(10 * MILLISECOND).with_description('beq_loaded').until_asserted(beq_loaded)

    def entry_is_shown():
        device_states = take_device_states(config)
        assert device_states[-1]['slots'][0]['last'] == 'Alien Resurrection'
        assert device_states[-1]['slots'][0]['gains'] == [{'id': 1, 'value': 0.0}]
        assert device_states[-1]['slots'][0]['mutes'] == [{'id': 1, 'value': False}]

    wait().at_most(2 * SECOND).poll_interval(10 * MILLISECOND).with_description('entry_is_shown').until_asserted(
        entry_is_shown)

    payload = {"slots": [{"id": "CamillaDSP", "gains": [{"id": "1", "value": -1.5}]}]}
    r = single_camilladsp_client.patch(f"/api/3/devices/master", data=json.dumps(payload), content_type='application/json')
    assert r.status_code == 200

    def gain_changed():
        cmds = config.spy.take_commands()
        assert cmds
        assert cmds.pop(0) == 'GetConfigJson'
        assert cmds
        n = cmds.pop(0)
        assert isinstance(n, dict)
        assert 'SetConfigJson' in n
        beq_is_loaded(json.loads(n['SetConfigJson']), -1.5)
        has_one_filter(json.loads(n['SetConfigJson']), 0, 1)
        assert not cmds

    wait().at_most(2 * SECOND).poll_interval(10 * MILLISECOND).with_description('beq_loaded').until_asserted(gain_changed)

    r = single_camilladsp_client.delete(f"/api/1/devices/master/filter/CamillaDSP")
    assert r.status_code == 200

    def beq_unloaded():
        cmds = config.spy.take_commands()
        assert cmds
        assert cmds.pop(0) == 'GetConfigJson'
        assert cmds
        n = cmds.pop(0)
        assert isinstance(n, dict)
        assert 'SetConfigJson' in n
        beq_is_unloaded(json.loads(n['SetConfigJson']))
        assert not cmds

    wait().at_most(2 * SECOND).poll_interval(10 * MILLISECOND).with_description('beq_unloaded').until_asserted(
        beq_unloaded)

    def entry_is_removed():
        device_states = take_device_states(config)
        assert device_states[-1]['slots'][0]['last'] == 'Empty'
        assert device_states[-1]['slots'][0]['gains'] == [{'id': 1, 'value': 0.0}]
        assert device_states[-1]['slots'][0]['mutes'] == [{'id': 1, 'value': False}]

    wait().at_most(2 * SECOND).poll_interval(10 * MILLISECOND).with_description('entry_is_removed').until_asserted(
        entry_is_removed)


def test_input_gain_and_mute(single_camilladsp_client, single_camilladsp_app):
    config: CamillaDspSpyConfig = single_camilladsp_app.config['APP_CONFIG']
    assert isinstance(config, CamillaDspSpyConfig)
    ensure_inited(config)

    payload = {"slots": [{"id": "CamillaDSP", "gains": [{"id": "1", "value": -1.5}], "mutes": [{"id": "1", "value": True}]}]}
    r = single_camilladsp_client.patch(f"/api/3/devices/master", data=json.dumps(payload), content_type='application/json')
    assert r.status_code == 200

    def gain_changed():
        cmds = config.spy.take_commands()
        assert cmds
        assert cmds.pop(0) == 'GetConfigJson'
        assert cmds
        n = cmds.pop(0)
        assert isinstance(n, dict)
        assert 'SetConfigJson' in n
        new_config = json.loads(n['SetConfigJson'])
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
        has_one_filter(json.loads(n['SetConfigJson']), 0, 1)
        assert not cmds

    wait().at_most(2 * SECOND).poll_interval(10 * MILLISECOND).with_description('beq_loaded').until_asserted(gain_changed)

    def entry_is_shown():
        device_states = take_device_states(config)
        assert device_states[-1]['slots'][0]['last'] == 'Empty'
        assert device_states[-1]['slots'][0]['gains'] == [{'id': 1, 'value': -1.5}]
        assert device_states[-1]['slots'][0]['mutes'] == [{'id': 1, 'value': True}]

    wait().at_most(2 * SECOND).poll_interval(10 * MILLISECOND).with_description('entry_is_shown').until_asserted(
        entry_is_shown)


def test_input_gain_and_mute_on_unsupported_channel(single_camilladsp_client, single_camilladsp_app):
    config: CamillaDspSpyConfig = single_camilladsp_app.config['APP_CONFIG']
    assert isinstance(config, CamillaDspSpyConfig)
    ensure_inited(config)

    payload = {"slots": [{"id": "CamillaDSP", "gains": [{"id": "0", "value": -1.5}], "mutes": [{"id": "0", "value": True}]}]}
    r = single_camilladsp_client.patch(f"/api/3/devices/master", data=json.dumps(payload), content_type='application/json')
    assert r.status_code == 500


def test_load_known_entry_to_multiple_channels_with_gain_and_then_clear(multi_camilladsp_client, multi_camilladsp_app):
    config: CamillaDspSpyConfig = multi_camilladsp_app.config['APP_CONFIG']
    assert isinstance(config, CamillaDspSpyConfig)
    ensure_inited(config)

    payload = {"slots": [
        {
            "id": "CamillaDSP",
            "gains": [{"id": "2", "value": -1.5}, {"id": "3", "value": -1.5}],
            "mutes": [],
            "entry": "123456_0"
        }
    ]}
    r = multi_camilladsp_client.patch(f"/api/3/devices/master", data=json.dumps(payload), content_type='application/json')
    assert r.status_code == 200

    def beq_loaded():
        cmds = config.spy.take_commands()
        assert cmds
        assert cmds.pop(0) == 'GetConfigJson'
        assert cmds
        n = cmds.pop(0)
        assert isinstance(n, dict)
        assert 'SetConfigJson' in n
        cfg = json.loads(n['SetConfigJson'])
        beq_is_loaded(cfg, -1.5, target_channel=2, extra_filters=1)
        beq_is_loaded(cfg, -1.5, target_channel=3, extra_filters=1)
        has_no_filter(json.loads(n['SetConfigJson']), 0, 1)
        has_one_filter(json.loads(n['SetConfigJson']), 2, 3)
        assert not cmds

    wait().at_most(2 * SECOND).poll_interval(10 * MILLISECOND).with_description('beq_loaded').until_asserted(beq_loaded)

    def entry_is_shown():
        device_states = take_device_states(config)
        assert device_states[-1]['slots'][0]['last'] == 'Alien Resurrection'
        assert device_states[-1]['slots'][0]['gains'] == [{'id': 2, 'value': -1.5}, {'id': 3, 'value': -1.5}]
        assert device_states[-1]['slots'][0]['mutes'] == [{'id': 2, 'value': False}, {'id': 3, 'value': False}]

    wait().at_most(2 * SECOND).poll_interval(10 * MILLISECOND).with_description('entry_is_shown').until_asserted(
        entry_is_shown)

    r = multi_camilladsp_client.delete(f"/api/1/devices/master/filter/CamillaDSP")
    assert r.status_code == 200

    def beq_unloaded():
        cmds = config.spy.take_commands()
        assert cmds
        assert cmds.pop(0) == 'GetConfigJson'
        assert cmds
        n = cmds.pop(0)
        assert isinstance(n, dict)
        assert 'SetConfigJson' in n
        beq_is_unloaded(json.loads(n['SetConfigJson']), target_channel=2)
        beq_is_unloaded(json.loads(n['SetConfigJson']), target_channel=3)
        has_no_filter(json.loads(n['SetConfigJson']), 0, 1)
        has_one_filter(json.loads(n['SetConfigJson']), 2, 3)
        assert not cmds

    wait().at_most(2 * SECOND).poll_interval(10 * MILLISECOND).with_description('beq_unloaded').until_asserted(
        beq_unloaded)

    def entry_is_removed():
        device_states = take_device_states(config)
        assert device_states[-1]['slots'][0]['last'] == 'Empty'
        assert device_states[-1]['slots'][0]['gains'] == [{'id': 2, 'value': 0.0}, {'id': 3, 'value': 0.0}]
        assert device_states[-1]['slots'][0]['mutes'] == [{'id': 2, 'value': False}, {'id': 3, 'value': False}]

    wait().at_most(2 * SECOND).poll_interval(10 * MILLISECOND).with_description('entry_is_removed').until_asserted(
        entry_is_removed)


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
        assert cmds.pop(0) == 'GetConfigJson'
        assert cmds
        assert cmds.pop(0) == 'GetVolume'
        assert cmds
        assert cmds.pop(0) == 'GetMute'
        assert cmds
        assert cmds.pop(0) == 'SetUpdateInterval'
        assert not cmds

    wait().at_most(2 * SECOND).poll_interval(10 * MILLISECOND).with_description('inited').until_asserted(inited)
    config.msg_spy.take_messages()


def beq_is_loaded(new_config, expected_gain, target_channel: int = 1, extra_filters: int = 0):
    gain_filter_name = f'BEQ_Gain_{target_channel}'
    assert next(f for f in new_config['pipeline'] if f['type'] == 'Filter' and f['channel'] == target_channel)['names'] == [
        "vol",
        gain_filter_name,
        "BEQ_0_abcdefghijklm",
        "BEQ_1_abcdefghijklm",
        "BEQ_2_abcdefghijklm",
        "BEQ_3_abcdefghijklm",
        "BEQ_4_abcdefghijklm"
    ]
    new_filters = new_config['filters']
    assert 'vol' in new_filters
    assert gain_filter_name in new_filters
    assert new_filters[gain_filter_name] == {'parameters': {'gain': expected_gain, 'inverted': False, 'mute': False},
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
    assert len(list(new_filters.keys())) == 7 + extra_filters


def beq_is_unloaded(new_config, target_channel: int = 1):
    gain_filter_name = f'BEQ_Gain_{target_channel}'
    assert next(f for f in new_config['pipeline'] if f['type'] == 'Filter' and f['channel'] == target_channel)['names'] == ["vol"]
    new_filters = new_config['filters']
    assert 'vol' in new_filters
    assert gain_filter_name not in new_filters
    assert 'BEQ_0_abcdefghijklm' not in new_filters
    assert 'BEQ_1_abcdefghijklm' not in new_filters
    assert 'BEQ_2_abcdefghijklm' not in new_filters
    assert 'BEQ_3_abcdefghijklm' not in new_filters
    assert 'BEQ_4_abcdefghijklm' not in new_filters
    assert len(list(new_filters.keys())) == 1


def has_one_filter(new_config: dict, *channels: int):
    pipeline_filters = [f for f in new_config['pipeline'] if f['type'] == 'Filter']
    for c in channels:
        assert len([f for f in pipeline_filters if f['channel'] == c]) == 1


def has_no_filter(new_config: dict, *channels: int):
    pipeline_filters = [f for f in new_config['pipeline'] if f['type'] == 'Filter']
    for c in channels:
        assert len([f for f in pipeline_filters if f['channel'] == c]) == 0
