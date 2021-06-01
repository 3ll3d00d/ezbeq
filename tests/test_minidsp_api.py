import json
import os
from typing import Tuple, List

import pytest

from conftest import MinidspSpyConfig, MinidspSpy


def verify_slot(slot: dict, idx: int, active: bool = False, gain: Tuple[float, float] = (0.0, 0.0),
                mute: Tuple[bool, bool] = (False, False), last: str = 'Empty'):
    assert slot['id'] == str(idx)
    assert slot['active'] == active
    assert slot['gain1'] == gain[0]
    assert slot['gain2'] == gain[1]
    assert slot['mute1'] == mute[0]
    assert slot['mute2'] == mute[1]
    assert slot['last'] == last


def verify_default_device_state(devices: dict):
    slots = verify_master_device_state(devices)
    for idx, s in enumerate(slots):
        verify_slot(s, idx + 1, active=idx == 0)


def verify_master_device_state(devices, mute: bool = False, gain: float = 0.0):
    assert devices
    assert devices['mute'] == mute
    assert float(devices['masterVolume']) == gain
    slots = devices['slots']
    assert slots
    assert len(slots) == 4
    return slots


def test_devices(minidsp_client, minidsp_app):
    assert isinstance(minidsp_app.config['APP_CONFIG'], MinidspSpyConfig)
    r = minidsp_client.get("/api/1/devices")
    assert r
    assert r.status_code == 200
    verify_default_device_state(r.json)


@pytest.mark.parametrize("slot", [1, 2, 3, 4])
@pytest.mark.parametrize("mute_op", ['on', 'off'])
def test_legacy_mute_both_inputs(minidsp_client, minidsp_app, slot, mute_op):
    config: MinidspSpyConfig = minidsp_app.config['APP_CONFIG']
    assert isinstance(config, MinidspSpyConfig)
    payload = {
        'channel': '0',
        'value': mute_op,
        'command': 'mute'
    }
    r = minidsp_client.put(f"/api/1/device/{slot}", data=json.dumps(payload), content_type='application/json')
    verify_mute_both_inputs(config, mute_op, r, slot)


@pytest.mark.parametrize("slot", [1, 2, 3, 4])
@pytest.mark.parametrize("mute_op", ['on', 'off'])
def test_mute_both_inputs(minidsp_client, minidsp_app, slot, mute_op):
    config: MinidspSpyConfig = minidsp_app.config['APP_CONFIG']
    assert isinstance(config, MinidspSpyConfig)
    call = minidsp_client.put if mute_op == 'on' else minidsp_client.delete
    r = call(f"/api/1/devices/master/mute/{slot}")
    verify_mute_both_inputs(config, mute_op, r, slot)


def verify_mute_both_inputs(config, mute_op, r, slot):
    assert r
    assert r.status_code == 200
    cmds = verify_cmd_count(config.spy, slot, 2)
    assert cmds[0] == f"input 0 mute {mute_op}"
    assert cmds[1] == f"input 1 mute {mute_op}"
    slots = verify_master_device_state(r.json)
    for idx, s in enumerate(slots):
        if idx == slot - 1:
            verify_slot(s, idx + 1, active=True, mute=(True, True) if mute_op == 'on' else (False, False))
        else:
            verify_slot(s, idx + 1)


def verify_cmd_count(spy: MinidspSpy, slot: int, expected_cmd_count: int, initial_slot=1) -> List[str]:
    cmds = spy.take_commands()
    if slot == initial_slot:
        assert len(cmds) == expected_cmd_count
        return cmds
    else:
        assert len(cmds) == expected_cmd_count + 1
        assert cmds[0] == f"config {slot - 1}"
        return cmds[1:] if expected_cmd_count > 0 else []


@pytest.mark.parametrize("slot", [1, 2, 3, 4])
@pytest.mark.parametrize("channel", [1, 2])
@pytest.mark.parametrize("mute_op", ['on', 'off'])
def test_legacy_mute_single_input(minidsp_client, minidsp_app, slot, channel, mute_op):
    config: MinidspSpyConfig = minidsp_app.config['APP_CONFIG']
    assert isinstance(config, MinidspSpyConfig)
    payload = {
        'channel': f"{channel}",
        'value': mute_op,
        'command': 'mute'
    }
    r = minidsp_client.put(f"/api/1/device/{slot}", data=json.dumps(payload), content_type='application/json')
    verify_mute_single_input(channel, config, mute_op, r, slot)


@pytest.mark.parametrize("slot", [1, 2, 3, 4])
@pytest.mark.parametrize("channel", [1, 2])
@pytest.mark.parametrize("mute_op", ['on', 'off'])
def test_mute_single_input(minidsp_client, minidsp_app, slot, channel, mute_op):
    config: MinidspSpyConfig = minidsp_app.config['APP_CONFIG']
    assert isinstance(config, MinidspSpyConfig)
    call = minidsp_client.put if mute_op == 'on' else minidsp_client.delete
    r = call(f"/api/1/devices/master/mute/{slot}/{channel}")
    verify_mute_single_input(channel, config, mute_op, r, slot)


def verify_mute_single_input(channel, config, mute_op, r, slot):
    assert r
    assert r.status_code == 200
    cmds = verify_cmd_count(config.spy, slot, 1)
    assert cmds[0] == f"input {channel - 1} mute {mute_op}"
    slots = verify_master_device_state(r.json)
    if mute_op == 'on':
        mute = (True, False) if channel == 1 else (False, True)
    else:
        mute = (False, False)
    for idx, s in enumerate(slots):
        if idx == slot - 1:
            verify_slot(s, idx + 1, active=True, mute=mute)
        else:
            verify_slot(s, idx + 1)


@pytest.mark.parametrize("mute_op", ['on', 'off'])
def test_legacy_mute_master(minidsp_client, minidsp_app, mute_op):
    config: MinidspSpyConfig = minidsp_app.config['APP_CONFIG']
    assert isinstance(config, MinidspSpyConfig)
    payload = {
        'channel': 'master',
        'value': mute_op,
        'command': 'mute'
    }
    r = minidsp_client.put(f"/api/1/device/0", data=json.dumps(payload), content_type='application/json')
    verify_mute_master(config, mute_op, r)


@pytest.mark.parametrize("mute_op", ['on', 'off'])
def test_mute_master(minidsp_client, minidsp_app, mute_op):
    config: MinidspSpyConfig = minidsp_app.config['APP_CONFIG']
    assert isinstance(config, MinidspSpyConfig)
    call = minidsp_client.put if mute_op == 'on' else minidsp_client.delete
    r = call(f"/api/1/devices/master/mute")
    verify_mute_master(config, mute_op, r)


def verify_mute_master(config, mute_op, r):
    assert r
    assert r.status_code == 200
    cmds = config.spy.take_commands()
    assert len(cmds) == 1
    assert cmds[0] == f"mute {mute_op}"
    slots = verify_master_device_state(r.json, mute=True if mute_op == 'on' else False)
    for idx, s in enumerate(slots):
        verify_slot(s, idx + 1, active=idx == 0)


@pytest.mark.parametrize("slot", [1, 2, 3, 4])
@pytest.mark.parametrize("gain,is_valid", [(-14.2, True), (-49.1, True), (-72.1, False), (0.5, True), (12.4, False)])
def test_legacy_set_input_gain(minidsp_client, minidsp_app, slot, gain, is_valid):
    config: MinidspSpyConfig = minidsp_app.config['APP_CONFIG']
    assert isinstance(config, MinidspSpyConfig)
    payload = {
        'channel': '0',
        'value': gain,
        'command': 'gain'
    }
    r = minidsp_client.put(f"/api/1/device/{slot}", data=json.dumps(payload), content_type='application/json')
    verify_set_input_gain(config, gain, is_valid, r, slot)


@pytest.mark.parametrize("slot", [1, 2, 3, 4])
@pytest.mark.parametrize("gain,is_valid", [(-14.2, True), (-49.1, True), (-72.1, False), (0.5, True), (12.4, False)])
def test_set_input_gain(minidsp_client, minidsp_app, slot, gain, is_valid):
    config: MinidspSpyConfig = minidsp_app.config['APP_CONFIG']
    assert isinstance(config, MinidspSpyConfig)
    payload = {'gain': gain}
    r = minidsp_client.put(f"/api/1/devices/master/gain/{slot}", data=json.dumps(payload), content_type='application/json')
    verify_set_input_gain(config, gain, is_valid, r, slot)


def verify_set_input_gain(config, gain, is_valid, r, slot):
    assert r
    if is_valid:
        expected_gain = (gain, gain)
        assert r.status_code == 200
        cmds = verify_cmd_count(config.spy, slot, 2)
        assert cmds[0] == f"input 0 gain -- {gain:.2f}"
        assert cmds[1] == f"input 1 gain -- {gain:.2f}"
    else:
        expected_gain = (0.0, 0.0)
        assert r.status_code == 400
        cmds = config.spy.take_commands()
        assert len(cmds) == 0
    slots = verify_master_device_state(r.json)
    for idx, s in enumerate(slots):
        slot_is_active = idx == slot - 1 if is_valid else idx == 0
        if idx == slot - 1:
            verify_slot(s, idx + 1, active=slot_is_active, gain=expected_gain)
        else:
            verify_slot(s, idx + 1, active=slot_is_active)


@pytest.mark.parametrize("slot", [1, 2, 3, 4])
@pytest.mark.parametrize("channel", [1, 2])
@pytest.mark.parametrize("gain,is_valid", [(-14.2, True), (-49.1, True), (-72.1, False), (0.5, True), (12.4, False)])
def test_legacy_set_input_gain_single_input(minidsp_client, minidsp_app, slot, channel, gain, is_valid):
    config: MinidspSpyConfig = minidsp_app.config['APP_CONFIG']
    assert isinstance(config, MinidspSpyConfig)
    payload = {
        'channel': channel,
        'value': gain,
        'command': 'gain'
    }
    r = minidsp_client.put(f"/api/1/device/{slot}", data=json.dumps(payload), content_type='application/json')
    verify_set_input_gain_single_input(channel, config, gain, is_valid, r, slot)


@pytest.mark.parametrize("slot", [1, 2, 3, 4])
@pytest.mark.parametrize("channel", [1, 2])
@pytest.mark.parametrize("gain,is_valid", [(-14.2, True), (-49.1, True), (-72.1, False), (0.5, True), (12.4, False)])
def test_set_input_gain_single_input(minidsp_client, minidsp_app, slot, channel, gain, is_valid):
    config: MinidspSpyConfig = minidsp_app.config['APP_CONFIG']
    assert isinstance(config, MinidspSpyConfig)
    payload = {'gain': gain}
    r = minidsp_client.put(f"/api/1/devices/master/gain/{slot}/{channel}", data=json.dumps(payload), content_type='application/json')
    verify_set_input_gain_single_input(channel, config, gain, is_valid, r, slot)


def verify_set_input_gain_single_input(channel, config, gain, is_valid, r, slot):
    assert r
    if is_valid:
        expected_gain = (gain, 0.0) if channel == 1 else (0.0, gain)
        assert r.status_code == 200
        cmds = verify_cmd_count(config.spy, slot, 1)
        assert cmds[0] == f"input {channel - 1} gain -- {gain:.2f}"
    else:
        expected_gain = (0.0, 0.0)
        assert r.status_code == 400
        cmds = config.spy.take_commands()
        assert len(cmds) == 0
    slots = verify_master_device_state(r.json)
    for idx, s in enumerate(slots):
        slot_is_active = idx == slot - 1 if is_valid else idx == 0
        if idx == slot - 1:
            verify_slot(s, idx + 1, active=slot_is_active, gain=expected_gain)
        else:
            verify_slot(s, idx + 1, active=slot_is_active)


@pytest.mark.parametrize("gain,is_valid", [(-14.2, True), (-49.1, True), (-72.1, True), (0.5, False), (-128.0, False)])
def test_legacy_set_master_gain(minidsp_client, minidsp_app, gain, is_valid):
    config: MinidspSpyConfig = minidsp_app.config['APP_CONFIG']
    assert isinstance(config, MinidspSpyConfig)
    payload = {
        'channel': 'master',
        'value': gain,
        'command': 'gain'
    }
    r = minidsp_client.put(f"/api/1/device/0", data=json.dumps(payload), content_type='application/json')
    verify_set_master_gain(config, gain, is_valid, r)


@pytest.mark.parametrize("gain,is_valid", [(-14.2, True), (-49.1, True), (-72.1, True), (0.5, False), (-128.0, False)])
def test_set_master_gain(minidsp_client, minidsp_app, gain, is_valid):
    config: MinidspSpyConfig = minidsp_app.config['APP_CONFIG']
    assert isinstance(config, MinidspSpyConfig)
    payload = {'gain': gain}
    r = minidsp_client.put(f"/api/1/devices/master/gain", data=json.dumps(payload), content_type='application/json')
    verify_set_master_gain(config, gain, is_valid, r)


def verify_set_master_gain(config, gain, is_valid, r):
    assert r
    if is_valid:
        assert r.status_code == 200
        cmds = config.spy.take_commands()
        assert len(cmds) == 1
        assert cmds[0] == f"gain -- {gain:.2f}"
    else:
        assert r.status_code == 400
        cmds = config.spy.take_commands()
        assert len(cmds) == 0
    slots = verify_master_device_state(r.json, gain=gain if is_valid else 0.0)
    for idx, s in enumerate(slots):
        verify_slot(s, idx + 1, active=idx == 0)


@pytest.mark.parametrize("slot,is_valid", [(0, False), (1, True), (2, True), (3, True), (4, True), (5, False)])
def test_legacy_activate_slot(minidsp_client, minidsp_app, slot, is_valid):
    config: MinidspSpyConfig = minidsp_app.config['APP_CONFIG']
    assert isinstance(config, MinidspSpyConfig)
    payload = {
        'command': 'activate'
    }
    r = minidsp_client.put(f"/api/1/device/{slot}", data=json.dumps(payload), content_type='application/json')
    verify_activate_slot(config, is_valid, r, slot)


@pytest.mark.parametrize("slot,is_valid", [(0, False), (1, True), (2, True), (3, True), (4, True), (5, False)])
def test_activate_slot(minidsp_client, minidsp_app, slot, is_valid):
    config: MinidspSpyConfig = minidsp_app.config['APP_CONFIG']
    assert isinstance(config, MinidspSpyConfig)
    r = minidsp_client.put(f"/api/1/devices/master/config/{slot}/active")
    verify_activate_slot(config, is_valid, r, slot)


def verify_activate_slot(config, is_valid, r, slot):
    assert r
    if is_valid:
        assert r.status_code == 200
        cmds = verify_cmd_count(config.spy, slot, 0)
    else:
        assert r.status_code == 400
        cmds = config.spy.take_commands()
    assert len(cmds) == 0
    slots = verify_master_device_state(r.json)
    for idx, s in enumerate(slots):
        if is_valid:
            verify_slot(s, idx + 1, active=idx + 1 == slot)
        else:
            verify_slot(s, idx + 1, active=idx == 0)


def test_legacy_state_maintained_over_multiple_updates(minidsp_client, minidsp_app):
    config: MinidspSpyConfig = minidsp_app.config['APP_CONFIG']
    assert isinstance(config, MinidspSpyConfig)
    # when: activate slot 2
    r = minidsp_client.put(f"/api/1/device/2", data=json.dumps({'command': 'activate'}),
                           content_type='application/json')
    assert r.status_code == 200
    # and: set master gain
    gain_payload = {
        'channel': 'master',
        'value': -10.2,
        'command': 'gain'
    }
    r = minidsp_client.put(f"/api/1/device/0", data=json.dumps(gain_payload), content_type='application/json')
    assert r.status_code == 200
    # and: set input gain on slot 3
    gain_payload = {
        'channel': '0',
        'value': 5.1,
        'command': 'gain'
    }
    r = minidsp_client.put(f"/api/1/device/3", data=json.dumps(gain_payload), content_type='application/json')
    assert r.status_code == 200
    # and: set input gain on one channel on slot 3
    gain_payload = {
        'channel': '2',
        'value': 6.1,
        'command': 'gain'
    }
    r = minidsp_client.put(f"/api/1/device/3", data=json.dumps(gain_payload), content_type='application/json')
    assert r.status_code == 200

    # then: expected commands are sent
    cmds = config.spy.take_commands()
    assert len(cmds) == 6
    assert cmds[0] == "config 1"
    assert cmds[1] == "gain -- -10.20"
    assert cmds[2] == "config 2"
    assert cmds[3] == "input 0 gain -- 5.10"
    assert cmds[4] == "input 1 gain -- 5.10"
    assert cmds[5] == "input 1 gain -- 6.10"

    # and: device state is accurate
    slots = verify_master_device_state(r.json, gain=-10.2)
    verify_slot(slots[0], 1)
    verify_slot(slots[1], 2)
    verify_slot(slots[2], 3, active=True, gain=(5.10, 6.10))
    verify_slot(slots[3], 4)


@pytest.mark.parametrize("slot", [1, 2, 3, 4])
def test_legacy_multiple_updates_in_one_payload(minidsp_client, minidsp_app, slot):
    config: MinidspSpyConfig = minidsp_app.config['APP_CONFIG']
    assert isinstance(config, MinidspSpyConfig)
    # when: activate slot
    # and: set master gain
    # and: set input gain
    payload = [
        {
            'command': 'activate'
        },
        {
            'channel': 'master',
            'value': -10.2,
            'command': 'gain'
        },
        {
            'channel': '0',
            'value': 5.1,
            'command': 'gain'
        },
        {
            'channel': '2',
            'value': 6.1,
            'command': 'gain'
        }
    ]
    r = minidsp_client.put(f"/api/1/device/{slot}", data=json.dumps(payload), content_type='application/json')
    assert r.status_code == 200

    # then: expected commands are sent
    cmds = verify_cmd_count(config.spy, slot, 4)
    assert cmds[0] == "gain -- -10.20"
    assert cmds[1] == "input 0 gain -- 5.10"
    assert cmds[2] == "input 1 gain -- 5.10"
    assert cmds[3] == "input 1 gain -- 6.10"

    # and: device state is accurate
    slots = verify_master_device_state(r.json, gain=-10.2)
    for idx, s in enumerate(slots):
        if idx+1 == slot:
            verify_slot(s, idx+1, active=True, gain=(5.10, 6.10))
        else:
            verify_slot(s, idx+1)


def test_legacy_load_unknown_entry(minidsp_client, minidsp_app):
    config: MinidspSpyConfig = minidsp_app.config['APP_CONFIG']
    assert isinstance(config, MinidspSpyConfig)

    r = minidsp_client.put(f"/api/1/device/1", data=json.dumps({'command': 'load', 'id': 'super'}),
                           content_type='application/json')
    assert r.status_code == 404
    cmds = config.spy.take_commands()
    assert len(cmds) == 0


def test_load_unknown_entry(minidsp_client, minidsp_app):
    config: MinidspSpyConfig = minidsp_app.config['APP_CONFIG']
    assert isinstance(config, MinidspSpyConfig)
    r = minidsp_client.put(f"/api/1/devices/master/filter/1/super")
    assert r.status_code == 404
    cmds = config.spy.take_commands()
    assert len(cmds) == 0


def test_search_all(minidsp_client, minidsp_app):
    r = minidsp_client.get(f"/api/1/search")
    assert r.status_code == 200
    catalogue = r.json
    assert catalogue
    assert len(catalogue) == 1
    entry = catalogue[0]
    assert entry['id'] == '123456_0'
    assert entry['title'] == 'Alien Resurrection'


def test_search_no_match(minidsp_client, minidsp_app):
    r = minidsp_client.get(f"/api/1/search", query_string={'authors': 'me'})
    assert r.status_code == 200
    catalogue = r.json
    assert len(catalogue) == 0


def test_authors(minidsp_client):
    r = minidsp_client.get(f"/api/1/authors")
    assert r.status_code == 200
    data = r.json
    assert data
    assert len(data) == 1
    assert data[0] == 'aron7awol'


def test_contenttypes(minidsp_client):
    r = minidsp_client.get(f"/api/1/contenttypes")
    assert r.status_code == 200
    data = r.json
    assert data
    assert len(data) == 1
    assert data[0] == 'film'


def test_years(minidsp_client):
    r = minidsp_client.get(f"/api/1/years")
    assert r.status_code == 200
    data = r.json
    assert data
    assert len(data) == 1
    assert data[0] == 1997


def test_audiotypes(minidsp_client):
    r = minidsp_client.get(f"/api/1/audiotypes")
    assert r.status_code == 200
    data = r.json
    assert data
    assert len(data) == 1
    assert data[0] == 'DTS-HD MA 5.1'


def test_metadata(minidsp_client):
    r = minidsp_client.get(f"/api/1/meta")
    assert r.status_code == 200
    data = r.json
    assert data
    assert data['version'] == '123456'
    assert data['loaded']
    assert data['count'] == 1


def test_version(minidsp_client):
    r = minidsp_client.get(f"/api/1/version")
    assert r.status_code == 200
    data = r.json
    assert data
    assert data['version'] == '1.2.3'


@pytest.mark.parametrize("slot,is_valid", [(0, False), (1, True), (2, True), (3, True), (4, True), (5, False)])
def test_legacy_load_known_entry_and_then_clear(minidsp_client, minidsp_app, slot, is_valid):
    config: MinidspSpyConfig = minidsp_app.config['APP_CONFIG']
    assert isinstance(config, MinidspSpyConfig)

    r = minidsp_client.put(f"/api/1/device/{slot}", data=json.dumps({'command': 'load', 'id': '123456_0'}),
                           content_type='application/json')
    if is_valid:
        assert r.status_code == 200
        cmds = verify_cmd_count(config.spy, slot, 30)
        expected_commands = f"""input 0 peq 0 set -- 1.0003468763586854 -1.9979191385126602 0.9975784764805841 1.9979204983896346 -0.9979239929622952
input 0 peq 0 bypass off
input 0 peq 1 set -- 1.0003468763586854 -1.9979191385126602 0.9975784764805841 1.9979204983896346 -0.9979239929622952
input 0 peq 1 bypass off
input 0 peq 2 set -- 1.0003468763586854 -1.9979191385126602 0.9975784764805841 1.9979204983896346 -0.9979239929622952
input 0 peq 2 bypass off
input 0 peq 3 set -- 1.0003468763586854 -1.9979191385126602 0.9975784764805841 1.9979204983896346 -0.9979239929622952
input 0 peq 3 bypass off
input 0 peq 4 set -- 1.0003468763586854 -1.9979191385126602 0.9975784764805841 1.9979204983896346 -0.9979239929622952
input 0 peq 4 bypass off
input 0 peq 5 bypass on
input 0 peq 6 bypass on
input 0 peq 7 bypass on
input 0 peq 8 bypass on
input 0 peq 9 bypass on
input 1 peq 0 set -- 1.0003468763586854 -1.9979191385126602 0.9975784764805841 1.9979204983896346 -0.9979239929622952
input 1 peq 0 bypass off
input 1 peq 1 set -- 1.0003468763586854 -1.9979191385126602 0.9975784764805841 1.9979204983896346 -0.9979239929622952
input 1 peq 1 bypass off
input 1 peq 2 set -- 1.0003468763586854 -1.9979191385126602 0.9975784764805841 1.9979204983896346 -0.9979239929622952
input 1 peq 2 bypass off
input 1 peq 3 set -- 1.0003468763586854 -1.9979191385126602 0.9975784764805841 1.9979204983896346 -0.9979239929622952
input 1 peq 3 bypass off
input 1 peq 4 set -- 1.0003468763586854 -1.9979191385126602 0.9975784764805841 1.9979204983896346 -0.9979239929622952
input 1 peq 4 bypass off
input 1 peq 5 bypass on
input 1 peq 6 bypass on
input 1 peq 7 bypass on
input 1 peq 8 bypass on
input 1 peq 9 bypass on"""
        assert '\n'.join(cmds) == expected_commands
    else:
        assert r.status_code == 400
        cmds = config.spy.take_commands()
        assert not cmds
    slots = verify_master_device_state(r.json)
    for idx, s in enumerate(slots):
        slot_is_active = idx + 1 == slot if is_valid else idx == 0
        if is_valid and idx + 1 == slot:
            verify_slot(s, idx + 1, active=slot_is_active, last='Alien Resurrection')
        else:
            verify_slot(s, idx + 1, active=slot_is_active)

    if is_valid:
        r = minidsp_client.delete(f"/api/1/device/{slot}")
        assert r.status_code == 200
        cmds = config.spy.take_commands()
        assert len(cmds) == 24
        expected_commands = f"""input 0 peq 0 bypass on
input 0 peq 1 bypass on
input 0 peq 2 bypass on
input 0 peq 3 bypass on
input 0 peq 4 bypass on
input 0 peq 5 bypass on
input 0 peq 6 bypass on
input 0 peq 7 bypass on
input 0 peq 8 bypass on
input 0 peq 9 bypass on
input 1 peq 0 bypass on
input 1 peq 1 bypass on
input 1 peq 2 bypass on
input 1 peq 3 bypass on
input 1 peq 4 bypass on
input 1 peq 5 bypass on
input 1 peq 6 bypass on
input 1 peq 7 bypass on
input 1 peq 8 bypass on
input 1 peq 9 bypass on
input 0 mute off
input 1 mute off
input 0 gain -- 0.00
input 1 gain -- 0.00"""
        assert '\n'.join(cmds) == expected_commands
        slots = verify_master_device_state(r.json)
        for idx, s in enumerate(slots):
            slot_is_active = idx + 1 == slot if is_valid else idx == 0
            verify_slot(s, idx + 1, active=slot_is_active)


@pytest.mark.parametrize("slot,is_valid", [(0, False), (1, True), (2, True), (3, True), (4, True), (5, False)])
def test_load_known_entry_and_then_clear(minidsp_client, minidsp_app, slot, is_valid):
    config: MinidspSpyConfig = minidsp_app.config['APP_CONFIG']
    assert isinstance(config, MinidspSpyConfig)

    r = minidsp_client.put(f"/api/1/devices/master/filter/{slot}", data=json.dumps({'entryId': '123456_0'}),
                           content_type='application/json')
    if is_valid:
        assert r.status_code == 200
        cmds = verify_cmd_count(config.spy, slot, 30)
        expected_commands = f"""input 0 peq 0 set -- 1.0003468763586854 -1.9979191385126602 0.9975784764805841 1.9979204983896346 -0.9979239929622952
input 0 peq 0 bypass off
input 0 peq 1 set -- 1.0003468763586854 -1.9979191385126602 0.9975784764805841 1.9979204983896346 -0.9979239929622952
input 0 peq 1 bypass off
input 0 peq 2 set -- 1.0003468763586854 -1.9979191385126602 0.9975784764805841 1.9979204983896346 -0.9979239929622952
input 0 peq 2 bypass off
input 0 peq 3 set -- 1.0003468763586854 -1.9979191385126602 0.9975784764805841 1.9979204983896346 -0.9979239929622952
input 0 peq 3 bypass off
input 0 peq 4 set -- 1.0003468763586854 -1.9979191385126602 0.9975784764805841 1.9979204983896346 -0.9979239929622952
input 0 peq 4 bypass off
input 0 peq 5 bypass on
input 0 peq 6 bypass on
input 0 peq 7 bypass on
input 0 peq 8 bypass on
input 0 peq 9 bypass on
input 1 peq 0 set -- 1.0003468763586854 -1.9979191385126602 0.9975784764805841 1.9979204983896346 -0.9979239929622952
input 1 peq 0 bypass off
input 1 peq 1 set -- 1.0003468763586854 -1.9979191385126602 0.9975784764805841 1.9979204983896346 -0.9979239929622952
input 1 peq 1 bypass off
input 1 peq 2 set -- 1.0003468763586854 -1.9979191385126602 0.9975784764805841 1.9979204983896346 -0.9979239929622952
input 1 peq 2 bypass off
input 1 peq 3 set -- 1.0003468763586854 -1.9979191385126602 0.9975784764805841 1.9979204983896346 -0.9979239929622952
input 1 peq 3 bypass off
input 1 peq 4 set -- 1.0003468763586854 -1.9979191385126602 0.9975784764805841 1.9979204983896346 -0.9979239929622952
input 1 peq 4 bypass off
input 1 peq 5 bypass on
input 1 peq 6 bypass on
input 1 peq 7 bypass on
input 1 peq 8 bypass on
input 1 peq 9 bypass on"""
        assert '\n'.join(cmds) == expected_commands
    else:
        assert r.status_code == 400
        cmds = config.spy.take_commands()
        assert not cmds
    slots = verify_master_device_state(r.json)
    for idx, s in enumerate(slots):
        slot_is_active = idx + 1 == slot if is_valid else idx == 0
        if is_valid and idx + 1 == slot:
            verify_slot(s, idx + 1, active=slot_is_active, last='Alien Resurrection')
        else:
            verify_slot(s, idx + 1, active=slot_is_active)

    if is_valid:
        r = minidsp_client.delete(f"/api/1/devices/master/filter/{slot}")
        assert r.status_code == 200
        cmds = config.spy.take_commands()
        assert len(cmds) == 24
        expected_commands = f"""input 0 peq 0 bypass on
input 0 peq 1 bypass on
input 0 peq 2 bypass on
input 0 peq 3 bypass on
input 0 peq 4 bypass on
input 0 peq 5 bypass on
input 0 peq 6 bypass on
input 0 peq 7 bypass on
input 0 peq 8 bypass on
input 0 peq 9 bypass on
input 1 peq 0 bypass on
input 1 peq 1 bypass on
input 1 peq 2 bypass on
input 1 peq 3 bypass on
input 1 peq 4 bypass on
input 1 peq 5 bypass on
input 1 peq 6 bypass on
input 1 peq 7 bypass on
input 1 peq 8 bypass on
input 1 peq 9 bypass on
input 0 mute off
input 1 mute off
input 0 gain -- 0.00
input 1 gain -- 0.00"""
        assert '\n'.join(cmds) == expected_commands
        slots = verify_master_device_state(r.json)
        for idx, s in enumerate(slots):
            slot_is_active = idx + 1 == slot if is_valid else idx == 0
            verify_slot(s, idx + 1, active=slot_is_active)


def test_patch_multiple_fields(minidsp_client, minidsp_app):
    config: MinidspSpyConfig = minidsp_app.config['APP_CONFIG']
    assert isinstance(config, MinidspSpyConfig)
    # when: set master gain
    # and: set input gains
    payload = {
        'masterVolume': -10.2,
        'mute': True,
        'slots': [
            {
                'id': '2',
                'gain1': 5.1,
                'gain2': 6.1
            }
        ]
    }
    r = minidsp_client.patch(f"/api/1/devices/master", data=json.dumps(payload), content_type='application/json')
    assert r.status_code == 200

    # then: expected commands are sent
    cmds = verify_cmd_count(config.spy, 2, 4)
    assert cmds[0] == "input 0 gain -- 5.10"
    assert cmds[1] == "input 1 gain -- 6.10"
    assert cmds[2] == "mute on"
    assert cmds[3] == "gain -- -10.20"

    # and: device state is accurate
    slots = verify_master_device_state(r.json, mute=True, gain=-10.2)
    for idx, s in enumerate(slots):
        if idx+1 == 2:
            verify_slot(s, idx+1, active=True, gain=(5.10, 6.10))
        else:
            verify_slot(s, idx+1)


def test_patch_multiple_slots(minidsp_client, minidsp_app):
    config: MinidspSpyConfig = minidsp_app.config['APP_CONFIG']
    assert isinstance(config, MinidspSpyConfig)
    # when: set master gain
    # and: set input gains
    payload = {
        'masterVolume': -10.2,
        'slots': [
            {
                'id': '2',
                'gain1': 5.1,
                'gain2': 6.1
            },
            {
                'id': '3',
                'gain1': -1.1,
                'gain2': -1.1,
                'entry': '123456_0',
                'mute1': False,
                'mute2': False
            }
        ]
    }
    r = minidsp_client.patch(f"/api/1/devices/master", data=json.dumps(payload), content_type='application/json')
    assert r.status_code == 200

    # then: expected commands are sent
    cmds = verify_cmd_count(config.spy, 2, 38)
    expected_commands = f"""input 0 gain -- 5.10
input 1 gain -- 6.10
config 2
input 0 gain -- -1.10
input 1 gain -- -1.10
input 0 mute off
input 1 mute off
input 0 peq 0 set -- 1.0003468763586854 -1.9979191385126602 0.9975784764805841 1.9979204983896346 -0.9979239929622952
input 0 peq 0 bypass off
input 0 peq 1 set -- 1.0003468763586854 -1.9979191385126602 0.9975784764805841 1.9979204983896346 -0.9979239929622952
input 0 peq 1 bypass off
input 0 peq 2 set -- 1.0003468763586854 -1.9979191385126602 0.9975784764805841 1.9979204983896346 -0.9979239929622952
input 0 peq 2 bypass off
input 0 peq 3 set -- 1.0003468763586854 -1.9979191385126602 0.9975784764805841 1.9979204983896346 -0.9979239929622952
input 0 peq 3 bypass off
input 0 peq 4 set -- 1.0003468763586854 -1.9979191385126602 0.9975784764805841 1.9979204983896346 -0.9979239929622952
input 0 peq 4 bypass off
input 0 peq 5 bypass on
input 0 peq 6 bypass on
input 0 peq 7 bypass on
input 0 peq 8 bypass on
input 0 peq 9 bypass on
input 1 peq 0 set -- 1.0003468763586854 -1.9979191385126602 0.9975784764805841 1.9979204983896346 -0.9979239929622952
input 1 peq 0 bypass off
input 1 peq 1 set -- 1.0003468763586854 -1.9979191385126602 0.9975784764805841 1.9979204983896346 -0.9979239929622952
input 1 peq 1 bypass off
input 1 peq 2 set -- 1.0003468763586854 -1.9979191385126602 0.9975784764805841 1.9979204983896346 -0.9979239929622952
input 1 peq 2 bypass off
input 1 peq 3 set -- 1.0003468763586854 -1.9979191385126602 0.9975784764805841 1.9979204983896346 -0.9979239929622952
input 1 peq 3 bypass off
input 1 peq 4 set -- 1.0003468763586854 -1.9979191385126602 0.9975784764805841 1.9979204983896346 -0.9979239929622952
input 1 peq 4 bypass off
input 1 peq 5 bypass on
input 1 peq 6 bypass on
input 1 peq 7 bypass on
input 1 peq 8 bypass on
input 1 peq 9 bypass on
gain -- -10.20"""
    assert '\n'.join(cmds) == expected_commands

    # and: device state is accurate
    slots = verify_master_device_state(r.json, gain=-10.2)
    for idx, s in enumerate(slots):
        if idx == 1:
            verify_slot(s, idx+1, gain=(5.10, 6.10))
        elif idx == 2:
            verify_slot(s, idx+1, active=True, gain=(-1.1, -1.1), last='Alien Resurrection')
        else:
            verify_slot(s, idx+1)


def test_reload_from_cache(minidsp_client, tmp_path):
    from minidsp import MinidspState
    expected = MinidspState()
    expected.update_master_state(True, -5.4)
    slot = expected.get_slot('2')
    slot.mute(None)
    slot.gain1 = 4.8
    slot.active = True
    slot.last = 'Testing'
    with open(os.path.join(tmp_path, 'master.json'), 'w') as f:
        json.dump(expected.serialise(), f, sort_keys=True)

    r = minidsp_client.get("/api/1/devices")
    assert r.status_code == 200
    # master state is not restored
    slots = verify_master_device_state(r.json)
    for idx, s in enumerate(slots):
        if idx == 1:
            verify_slot(s, idx+1, active=True, gain=(4.8, 0.0), mute=(True, True), last='Testing')
        else:
            verify_slot(s, idx+1)

