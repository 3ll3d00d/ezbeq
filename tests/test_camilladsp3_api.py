import json

import pytest
from busypie import wait, SECOND, MILLISECOND

from camilladsp import NOP_LS
from conftest import CamillaDspSpyConfig


@pytest.mark.parametrize("mute_op", [True, False])
def test_mute_master(single_camilladsp3_client, single_camilladsp3_app, mute_op):
    config: CamillaDspSpyConfig = single_camilladsp3_app.config['APP_CONFIG']
    assert isinstance(config, CamillaDspSpyConfig)
    ensure_inited(config)

    call = single_camilladsp3_client.put if mute_op is True else single_camilladsp3_client.delete
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
def test_set_volume(single_camilladsp3_client, single_camilladsp3_app, volume):
    config: CamillaDspSpyConfig = single_camilladsp3_app.config['APP_CONFIG']
    assert isinstance(config, CamillaDspSpyConfig)
    ensure_inited(config)

    payload = {'gain': volume}
    r = single_camilladsp3_client.put(f"/api/1/devices/master/gain", data=json.dumps(payload),
                                      content_type='application/json')
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


def test_load_known_entry_and_then_clear(single_camilladsp3_client, single_camilladsp3_app):
    config: CamillaDspSpyConfig = single_camilladsp3_app.config['APP_CONFIG']
    assert isinstance(config, CamillaDspSpyConfig)
    ensure_inited(config)

    r = single_camilladsp3_client.put(f"/api/1/devices/master/filter/CamillaDSP",
                                      data=json.dumps({'entryId': '123456_0'}),
                                      content_type='application/json')
    assert r.status_code == 200

    set_config_response = None

    def beq_loaded():
        nonlocal set_config_response
        cmds = config.spy.take_commands()
        assert cmds
        assert cmds.pop(0) == 'GetConfigJson'
        assert cmds
        n = cmds.pop(0)
        assert isinstance(n, dict)
        assert 'SetConfigJson' in n
        set_config_response = json.loads(n['SetConfigJson'])
        assert not cmds

    wait().at_most(2 * SECOND).poll_interval(10 * MILLISECOND).with_description('beq_loaded').until_asserted(beq_loaded)

    assert set_config_response
    beq_is_loaded(set_config_response, 0.0, has_vol=True)

    def entry_is_shown():
        device_states = take_device_states(config)
        assert device_states[-1]['slots'][0]['last'] == 'Alien Resurrection'

    wait().at_most(2 * SECOND).poll_interval(10 * MILLISECOND).with_description('entry_is_shown').until_asserted(
        entry_is_shown)

    r = single_camilladsp3_client.delete(f"/api/1/devices/master/filter/CamillaDSP")
    assert r.status_code == 200

    set_config_response = None

    def beq_unloaded():
        nonlocal set_config_response
        cmds = config.spy.take_commands()
        assert cmds
        assert cmds.pop(0) == 'GetConfigJson'
        assert cmds
        n = cmds.pop(0)
        assert isinstance(n, dict)
        assert 'SetConfigJson' in n
        set_config_response = json.loads(n['SetConfigJson'])
        assert not cmds

    wait().at_most(2 * SECOND).poll_interval(10 * MILLISECOND).with_description('beq_unloaded').until_asserted(
        beq_unloaded)

    beq_is_unloaded(set_config_response, has_vol=True)

    def entry_is_removed():
        assert take_device_states(config)[-1]['slots'][0]['last'] == 'Empty'

    wait().at_most(2 * SECOND).poll_interval(10 * MILLISECOND).with_description('entry_is_removed').until_asserted(
        entry_is_removed)


def test_load_known_entry_with_gain_and_then_clear(single_camilladsp3_client, single_camilladsp3_app):
    config: CamillaDspSpyConfig = single_camilladsp3_app.config['APP_CONFIG']
    assert isinstance(config, CamillaDspSpyConfig)
    ensure_inited(config)

    payload = {"slots": [{"id": "CamillaDSP", "gains": [{"id": "1", "value": -1.5}], "mutes": [], "entry": "123456_0"}]}
    r = single_camilladsp3_client.patch(f"/api/3/devices/master", data=json.dumps(payload),
                                        content_type='application/json')
    assert r.status_code == 200

    set_config_response = None

    def beq_loaded():
        nonlocal set_config_response
        cmds = config.spy.take_commands()
        assert cmds
        assert cmds.pop(0) == 'GetConfigJson'
        assert cmds
        n = cmds.pop(0)
        assert isinstance(n, dict)
        assert 'SetConfigJson' in n
        set_config_response = json.loads(n['SetConfigJson'])
        assert not cmds

    wait().at_most(2 * SECOND).poll_interval(10 * MILLISECOND).with_description('beq_loaded').until_asserted(beq_loaded)
    beq_is_loaded(set_config_response, -1.5, has_vol=True)

    def entry_is_shown():
        device_states = take_device_states(config)
        assert device_states[-1]['slots'][0]['last'] == 'Alien Resurrection'
        assert device_states[-1]['slots'][0]['gains'] == [{'id': 1, 'value': -1.5}]
        assert device_states[-1]['slots'][0]['mutes'] == [{'id': 1, 'value': False}]

    wait().at_most(2 * SECOND).poll_interval(10 * MILLISECOND).with_description('entry_is_shown').until_asserted(
        entry_is_shown)

    r = single_camilladsp3_client.delete(f"/api/1/devices/master/filter/CamillaDSP")
    assert r.status_code == 200

    set_config_response = None

    def beq_unloaded():
        nonlocal set_config_response
        cmds = config.spy.take_commands()
        assert cmds
        assert cmds.pop(0) == 'GetConfigJson'
        assert cmds
        n = cmds.pop(0)
        assert isinstance(n, dict)
        assert 'SetConfigJson' in n
        set_config_response = json.loads(n['SetConfigJson'])
        assert not cmds

    wait().at_most(2 * SECOND).poll_interval(10 * MILLISECOND).with_description('beq_unloaded').until_asserted(
        beq_unloaded)
    beq_is_unloaded(set_config_response, has_vol=True)

    def entry_is_removed():
        device_states = take_device_states(config)
        assert device_states[-1]['slots'][0]['last'] == 'Empty'
        assert device_states[-1]['slots'][0]['gains'] == [{'id': 1, 'value': 0.0}]
        assert device_states[-1]['slots'][0]['mutes'] == [{'id': 1, 'value': False}]

    wait().at_most(2 * SECOND).poll_interval(10 * MILLISECOND).with_description('entry_is_removed').until_asserted(
        entry_is_removed)


def test_load_known_entry_then_load_gain_and_then_clear(single_camilladsp3_client, single_camilladsp3_app):
    config: CamillaDspSpyConfig = single_camilladsp3_app.config['APP_CONFIG']
    assert isinstance(config, CamillaDspSpyConfig)
    ensure_inited(config)

    payload = {"slots": [{"id": "CamillaDSP", "entry": "123456_0"}]}
    r = single_camilladsp3_client.patch(f"/api/3/devices/master", data=json.dumps(payload),
                                        content_type='application/json')
    assert r.status_code == 200

    set_config_response = None

    def beq_loaded():
        nonlocal set_config_response
        cmds = config.spy.take_commands()
        assert cmds
        assert cmds.pop(0) == 'GetConfigJson'
        assert cmds
        n = cmds.pop(0)
        assert isinstance(n, dict)
        assert 'SetConfigJson' in n
        set_config_response = json.loads(n['SetConfigJson'])
        assert not cmds

    wait().at_most(2 * SECOND).poll_interval(10 * MILLISECOND).with_description('beq_loaded').until_asserted(beq_loaded)
    beq_is_loaded(set_config_response, 0.0, has_vol=True)

    def entry_is_shown():
        device_states = take_device_states(config)
        assert device_states[-1]['slots'][0]['last'] == 'Alien Resurrection'
        assert device_states[-1]['slots'][0]['gains'] == [{'id': 1, 'value': 0.0}]
        assert device_states[-1]['slots'][0]['mutes'] == [{'id': 1, 'value': False}]

    wait().at_most(2 * SECOND).poll_interval(10 * MILLISECOND).with_description('entry_is_shown').until_asserted(
        entry_is_shown)

    payload = {"slots": [{"id": "CamillaDSP", "gains": [{"id": "1", "value": -1.5}]}]}
    r = single_camilladsp3_client.patch(f"/api/3/devices/master", data=json.dumps(payload),
                                        content_type='application/json')
    assert r.status_code == 200

    set_config_response = None

    def gain_changed():
        nonlocal set_config_response
        cmds = config.spy.take_commands()
        assert cmds
        assert cmds.pop(0) == 'GetConfigJson'
        assert cmds
        n = cmds.pop(0)
        assert isinstance(n, dict)
        assert 'SetConfigJson' in n
        set_config_response = json.loads(n['SetConfigJson'])
        assert not cmds

    wait().at_most(2 * SECOND).poll_interval(10 * MILLISECOND).with_description('beq_loaded').until_asserted(
        gain_changed)
    beq_is_loaded(set_config_response, -1.5, has_vol=True)

    r = single_camilladsp3_client.delete(f"/api/1/devices/master/filter/CamillaDSP")
    assert r.status_code == 200

    set_config_response = None

    def beq_unloaded():
        nonlocal set_config_response
        cmds = config.spy.take_commands()
        assert cmds
        assert cmds.pop(0) == 'GetConfigJson'
        assert cmds
        n = cmds.pop(0)
        assert isinstance(n, dict)
        assert 'SetConfigJson' in n
        set_config_response = json.loads(n['SetConfigJson'])
        assert not cmds

    wait().at_most(2 * SECOND).poll_interval(10 * MILLISECOND).with_description('beq_unloaded').until_asserted(
        beq_unloaded)
    beq_is_unloaded(set_config_response, has_vol=True)

    def entry_is_removed():
        device_states = take_device_states(config)
        assert device_states[-1]['slots'][0]['last'] == 'Empty'
        assert device_states[-1]['slots'][0]['gains'] == [{'id': 1, 'value': 0.0}]
        assert device_states[-1]['slots'][0]['mutes'] == [{'id': 1, 'value': False}]

    wait().at_most(2 * SECOND).poll_interval(10 * MILLISECOND).with_description('entry_is_removed').until_asserted(
        entry_is_removed)


def test_input_gain_and_mute(single_camilladsp3_client, single_camilladsp3_app):
    config: CamillaDspSpyConfig = single_camilladsp3_app.config['APP_CONFIG']
    assert isinstance(config, CamillaDspSpyConfig)
    ensure_inited(config)

    payload = {
        "slots": [{"id": "CamillaDSP", "gains": [{"id": "1", "value": -1.5}], "mutes": [{"id": "1", "value": True}]}]}
    r = single_camilladsp3_client.patch(f"/api/3/devices/master", data=json.dumps(payload),
                                        content_type='application/json')
    assert r.status_code == 200

    set_config_response = None

    def gain_changed():
        nonlocal set_config_response
        cmds = config.spy.take_commands()
        assert cmds
        assert cmds.pop(0) == 'GetConfigJson'
        assert cmds
        n = cmds.pop(0)
        assert isinstance(n, dict)
        assert 'SetConfigJson' in n
        set_config_response = json.loads(n['SetConfigJson'])
        assert not cmds

    wait().at_most(2 * SECOND).poll_interval(10 * MILLISECOND).with_description('beq_loaded').until_asserted(
        gain_changed)

    assert next(f for f in set_config_response['pipeline'] if f['type'] == 'Filter' and f['channels'] == [1])[
               'names'] == ["BEQ_Gain_1"]
    new_filters = set_config_response['filters']
    assert 'vol' in new_filters
    assert 'BEQ_Gain_1' in new_filters
    assert new_filters['BEQ_Gain_1'] == {'parameters': {'gain': -1.5, 'inverted': False, 'mute': True},
                                         'type': 'Gain',
                                         'description': 'ezbeq specified gain'}
    assert len(list(new_filters.keys())) == 2

    def entry_is_shown():
        device_states = take_device_states(config)
        assert device_states[-1]['slots'][0]['last'] == 'Empty'
        assert device_states[-1]['slots'][0]['gains'] == [{'id': 1, 'value': -1.5}]
        assert device_states[-1]['slots'][0]['mutes'] == [{'id': 1, 'value': True}]

    wait().at_most(2 * SECOND).poll_interval(10 * MILLISECOND).with_description('entry_is_shown').until_asserted(
        entry_is_shown)


def test_input_gain_and_mute_on_unsupported_channel(single_camilladsp3_client, single_camilladsp3_app):
    config: CamillaDspSpyConfig = single_camilladsp3_app.config['APP_CONFIG']
    assert isinstance(config, CamillaDspSpyConfig)
    ensure_inited(config)

    payload = {
        "slots": [{"id": "CamillaDSP", "gains": [{"id": "0", "value": -1.5}], "mutes": [{"id": "0", "value": True}]}]}
    r = single_camilladsp3_client.patch(f"/api/3/devices/master", data=json.dumps(payload),
                                        content_type='application/json')
    assert r.status_code == 500


def test_load_known_entry_to_multiple_channels_with_gain_and_then_clear(multi_camilladsp3_client,
                                                                        multi_camilladsp3_app):
    config: CamillaDspSpyConfig = multi_camilladsp3_app.config['APP_CONFIG']
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
    r = multi_camilladsp3_client.patch(f"/api/3/devices/master", data=json.dumps(payload),
                                       content_type='application/json')
    assert r.status_code == 200

    cfg = None

    def beq_loaded():
        nonlocal cfg
        cmds = config.spy.take_commands()
        assert cmds
        assert cmds.pop(0) == 'GetConfigJson'
        assert cmds
        n = cmds.pop(0)
        assert isinstance(n, dict)
        assert 'SetConfigJson' in n
        cfg = json.loads(n['SetConfigJson'])
        assert not cmds

    wait().at_most(2 * SECOND).poll_interval(10 * MILLISECOND).with_description('beq_loaded').until_asserted(beq_loaded)
    beq_is_loaded(cfg, -1.5, target_channels=[2, 3])
    has_no_filter(cfg, 0, 1)

    def entry_is_shown():
        device_states = take_device_states(config)
        assert device_states

        slot = device_states[-1]['slots'][0]
        assert slot['last'] == 'Alien Resurrection'
        assert slot['gains'] == [{'id': 2, 'value': -1.5}, {'id': 3, 'value': -1.5}]
        assert slot['mutes'] == [{'id': 2, 'value': False}, {'id': 3, 'value': False}]

    wait().at_most(2 * SECOND).poll_interval(10 * MILLISECOND).with_description('entry_is_shown').until_asserted(
        entry_is_shown)

    r = multi_camilladsp3_client.delete(f"/api/1/devices/master/filter/CamillaDSP")
    assert r.status_code == 200

    cfg = None

    def beq_unloaded():
        nonlocal cfg
        cmds = config.spy.take_commands()
        assert cmds
        assert cmds.pop(0) == 'GetConfigJson'
        assert cmds
        n = cmds.pop(0)
        assert isinstance(n, dict)
        assert 'SetConfigJson' in n
        cfg = json.loads(n['SetConfigJson'])
        assert not cmds

    wait().at_most(2 * SECOND).poll_interval(10 * MILLISECOND).with_description('beq_unloaded').until_asserted(
        beq_unloaded)
    beq_is_unloaded(cfg, target_channels=[2, 3])
    has_no_filter(cfg, 0, 1)

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


def beq_is_loaded(new_config, expected_gain, target_channels=None, has_vol: bool = False):
    if target_channels is None:
        target_channels = [1]

    gain_filter_names = [f'BEQ_Gain_{c}' for c in target_channels]
    for i, c in enumerate(target_channels):
        gain_filters = [f for f in new_config['pipeline'] if f['type'] == 'Filter' and f['channels'] == [c] and f['names'] == [gain_filter_names[i]]]
        assert gain_filters

    beq_filters = [f for f in [f for f in new_config['pipeline'] if f['type'] == 'Filter' and f['channels'] == target_channels] if f['names'] == [f'BEQ_{i}' for i in range(10)]]
    assert beq_filters

    new_filters = new_config['filters']
    if has_vol:
        assert 'vol' in new_filters
    else:
        assert 'vol' not in new_filters

    for n in gain_filter_names:
        assert n in new_filters
        assert new_filters[n] == {'parameters': {'gain': expected_gain, 'inverted': False, 'mute': False},
                                  'type': 'Gain'}
    assert 'BEQ_0' in new_filters
    filter_description = 'ezbeq filter abcdefghijklm - Alien Resurrection'
    assert new_filters['BEQ_0'] == {
        'parameters': {'freq': 33.0, 'gain': 5.0, 'q': 0.9, 'type': 'Lowshelf'}, 'type': 'Biquad',
        'description': filter_description}
    assert 'BEQ_1' in new_filters
    assert new_filters['BEQ_1'] == {
        'parameters': {'freq': 33.0, 'gain': 5.0, 'q': 0.9, 'type': 'Lowshelf'}, 'type': 'Biquad',
        'description': filter_description}
    assert 'BEQ_2' in new_filters
    assert new_filters['BEQ_2'] == {
        'parameters': {'freq': 33.0, 'gain': 5.0, 'q': 0.9, 'type': 'Lowshelf'}, 'type': 'Biquad',
        'description': filter_description}
    assert 'BEQ_3' in new_filters
    assert new_filters['BEQ_3'] == {
        'parameters': {'freq': 33.0, 'gain': 5.0, 'q': 0.9, 'type': 'Lowshelf'}, 'type': 'Biquad',
        'description': filter_description}
    assert 'BEQ_4' in new_filters
    assert new_filters['BEQ_4'] == {
        'parameters': {'freq': 33.0, 'gain': 5.0, 'q': 0.9, 'type': 'Lowshelf'}, 'type': 'Biquad',
        'description': filter_description}
    for i in range(5, 10):
        assert f'BEQ_{i}' in new_filters
        assert new_filters[f'BEQ_{i}'] == {'parameters': NOP_LS, 'description': filter_description, 'type': 'Biquad'}
    assert len(list(new_filters.keys())) == (1 if has_vol else 0) + len(gain_filter_names) + 10


def beq_is_unloaded(new_config, target_channels=None, has_vol: bool = False):
    if target_channels is None:
        target_channels = [1]
    gain_filter_names = [f'BEQ_Gain_{c}' for c in target_channels]
    new_filters = new_config['filters']
    if has_vol:
        assert 'vol' in new_filters
    else:
        assert 'vol' not in new_filters
    for n in gain_filter_names:
        assert n in new_filters
        assert new_filters[n] == {'parameters': {'gain': 0.0, 'inverted': False, 'mute': False}, 'type': 'Gain'}
    for i in range(5, 10):
        assert f'BEQ_{i}' in new_filters
        assert new_filters[f'BEQ_{i}'] == {'parameters': NOP_LS, 'description': 'ezbeq default filter',
                                           'type': 'Biquad'}
    assert len(list(new_filters.keys())) == (1 if has_vol else 0) + len(gain_filter_names) + 10


def has_no_filter(new_config: dict, *channels: int):
    pipeline_filters = [f for f in new_config['pipeline'] if f['type'] == 'Filter']
    c = [c for c in channels]
    assert not [f for f in pipeline_filters if f['channels'] == c]
