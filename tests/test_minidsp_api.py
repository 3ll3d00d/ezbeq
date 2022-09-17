import json
import os
from typing import List

import pytest

from conftest import MinidspSpyConfig, MinidspSpy


def verify_slot(slot: dict, idx: int, active: bool = False, gain = (0.0, 0.0), mute = (False, False), last: str = 'Empty'):
    assert slot['id'] == str(idx)
    assert slot['active'] == active
    if gain:
        assert len(slot['gains']) == len(gain)
        for idx, g in enumerate(gain):
            assert slot['gains'][idx] == g
    else:
        assert len(slot['gains']) == 0
    if mute:
        assert len(slot['mutes']) == len(mute)
        for idx, g in enumerate(mute):
            assert slot['mutes'][idx] == g
    else:
        assert len(slot['mutes']) == 0
    assert slot['last'] == last
    assert slot['canActivate'] is True


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
    r = minidsp_client.put(f"/api/1/devices/master/gain/{slot}", data=json.dumps(payload),
                           content_type='application/json')
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
    r = minidsp_client.put(f"/api/1/devices/master/gain/{slot}/{channel}", data=json.dumps(payload),
                           content_type='application/json')
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
        if idx + 1 == slot:
            verify_slot(s, idx + 1, active=True, gain=(5.10, 6.10))
        else:
            verify_slot(s, idx + 1)


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
input 1 peq 0 set -- 1.0003468763586854 -1.9979191385126602 0.9975784764805841 1.9979204983896346 -0.9979239929622952
input 1 peq 0 bypass off
input 0 peq 1 set -- 1.0003468763586854 -1.9979191385126602 0.9975784764805841 1.9979204983896346 -0.9979239929622952
input 0 peq 1 bypass off
input 1 peq 1 set -- 1.0003468763586854 -1.9979191385126602 0.9975784764805841 1.9979204983896346 -0.9979239929622952
input 1 peq 1 bypass off
input 0 peq 2 set -- 1.0003468763586854 -1.9979191385126602 0.9975784764805841 1.9979204983896346 -0.9979239929622952
input 0 peq 2 bypass off
input 1 peq 2 set -- 1.0003468763586854 -1.9979191385126602 0.9975784764805841 1.9979204983896346 -0.9979239929622952
input 1 peq 2 bypass off
input 0 peq 3 set -- 1.0003468763586854 -1.9979191385126602 0.9975784764805841 1.9979204983896346 -0.9979239929622952
input 0 peq 3 bypass off
input 1 peq 3 set -- 1.0003468763586854 -1.9979191385126602 0.9975784764805841 1.9979204983896346 -0.9979239929622952
input 1 peq 3 bypass off
input 0 peq 4 set -- 1.0003468763586854 -1.9979191385126602 0.9975784764805841 1.9979204983896346 -0.9979239929622952
input 0 peq 4 bypass off
input 1 peq 4 set -- 1.0003468763586854 -1.9979191385126602 0.9975784764805841 1.9979204983896346 -0.9979239929622952
input 1 peq 4 bypass off
input 0 peq 5 bypass on
input 1 peq 5 bypass on
input 0 peq 6 bypass on
input 1 peq 6 bypass on
input 0 peq 7 bypass on
input 1 peq 7 bypass on
input 0 peq 8 bypass on
input 1 peq 8 bypass on
input 0 peq 9 bypass on
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
input 1 peq 0 bypass on
input 0 peq 1 bypass on
input 1 peq 1 bypass on
input 0 peq 2 bypass on
input 1 peq 2 bypass on
input 0 peq 3 bypass on
input 1 peq 3 bypass on
input 0 peq 4 bypass on
input 1 peq 4 bypass on
input 0 peq 5 bypass on
input 1 peq 5 bypass on
input 0 peq 6 bypass on
input 1 peq 6 bypass on
input 0 peq 7 bypass on
input 1 peq 7 bypass on
input 0 peq 8 bypass on
input 1 peq 8 bypass on
input 0 peq 9 bypass on
input 1 peq 9 bypass on
input 0 mute off
input 0 gain -- 0.00
input 1 mute off
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
input 1 peq 0 set -- 1.0003468763586854 -1.9979191385126602 0.9975784764805841 1.9979204983896346 -0.9979239929622952
input 1 peq 0 bypass off
input 0 peq 1 set -- 1.0003468763586854 -1.9979191385126602 0.9975784764805841 1.9979204983896346 -0.9979239929622952
input 0 peq 1 bypass off
input 1 peq 1 set -- 1.0003468763586854 -1.9979191385126602 0.9975784764805841 1.9979204983896346 -0.9979239929622952
input 1 peq 1 bypass off
input 0 peq 2 set -- 1.0003468763586854 -1.9979191385126602 0.9975784764805841 1.9979204983896346 -0.9979239929622952
input 0 peq 2 bypass off
input 1 peq 2 set -- 1.0003468763586854 -1.9979191385126602 0.9975784764805841 1.9979204983896346 -0.9979239929622952
input 1 peq 2 bypass off
input 0 peq 3 set -- 1.0003468763586854 -1.9979191385126602 0.9975784764805841 1.9979204983896346 -0.9979239929622952
input 0 peq 3 bypass off
input 1 peq 3 set -- 1.0003468763586854 -1.9979191385126602 0.9975784764805841 1.9979204983896346 -0.9979239929622952
input 1 peq 3 bypass off
input 0 peq 4 set -- 1.0003468763586854 -1.9979191385126602 0.9975784764805841 1.9979204983896346 -0.9979239929622952
input 0 peq 4 bypass off
input 1 peq 4 set -- 1.0003468763586854 -1.9979191385126602 0.9975784764805841 1.9979204983896346 -0.9979239929622952
input 1 peq 4 bypass off
input 0 peq 5 bypass on
input 1 peq 5 bypass on
input 0 peq 6 bypass on
input 1 peq 6 bypass on
input 0 peq 7 bypass on
input 1 peq 7 bypass on
input 0 peq 8 bypass on
input 1 peq 8 bypass on
input 0 peq 9 bypass on
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
input 1 peq 0 bypass on
input 0 peq 1 bypass on
input 1 peq 1 bypass on
input 0 peq 2 bypass on
input 1 peq 2 bypass on
input 0 peq 3 bypass on
input 1 peq 3 bypass on
input 0 peq 4 bypass on
input 1 peq 4 bypass on
input 0 peq 5 bypass on
input 1 peq 5 bypass on
input 0 peq 6 bypass on
input 1 peq 6 bypass on
input 0 peq 7 bypass on
input 1 peq 7 bypass on
input 0 peq 8 bypass on
input 1 peq 8 bypass on
input 0 peq 9 bypass on
input 1 peq 9 bypass on
input 0 mute off
input 0 gain -- 0.00
input 1 mute off
input 1 gain -- 0.00"""
        assert '\n'.join(cmds) == expected_commands
        slots = verify_master_device_state(r.json)
        for idx, s in enumerate(slots):
            slot_is_active = idx + 1 == slot if is_valid else idx == 0
            verify_slot(s, idx + 1, active=slot_is_active)


@pytest.mark.parametrize("slot,is_valid", [(0, False), (1, True), (2, True), (3, True), (4, True), (5, False)])
def test_load_known_entry_to_ddrc24_and_then_clear(minidsp_ddrc24_client, minidsp_ddrc24_app, slot, is_valid):
    config: MinidspSpyConfig = minidsp_ddrc24_app.config['APP_CONFIG']
    assert isinstance(config, MinidspSpyConfig)

    r = minidsp_ddrc24_client.put(f"/api/1/devices/master/filter/{slot}", data=json.dumps({'entryId': '123456_0'}),
                                  content_type='application/json')
    if is_valid:
        assert r.status_code == 200
        cmds = verify_cmd_count(config.spy, slot, 60)
        expected_commands = f"""output 0 peq 0 set -- 1.0006943908064445 -1.9958328996351784 0.9951633403527971 1.9958383335011358 -0.9958522972932842
output 0 peq 0 bypass off
output 1 peq 0 set -- 1.0006943908064445 -1.9958328996351784 0.9951633403527971 1.9958383335011358 -0.9958522972932842
output 1 peq 0 bypass off
output 2 peq 0 set -- 1.0006943908064445 -1.9958328996351784 0.9951633403527971 1.9958383335011358 -0.9958522972932842
output 2 peq 0 bypass off
output 3 peq 0 set -- 1.0006943908064445 -1.9958328996351784 0.9951633403527971 1.9958383335011358 -0.9958522972932842
output 3 peq 0 bypass off
output 0 peq 1 set -- 1.0006943908064445 -1.9958328996351784 0.9951633403527971 1.9958383335011358 -0.9958522972932842
output 0 peq 1 bypass off
output 1 peq 1 set -- 1.0006943908064445 -1.9958328996351784 0.9951633403527971 1.9958383335011358 -0.9958522972932842
output 1 peq 1 bypass off
output 2 peq 1 set -- 1.0006943908064445 -1.9958328996351784 0.9951633403527971 1.9958383335011358 -0.9958522972932842
output 2 peq 1 bypass off
output 3 peq 1 set -- 1.0006943908064445 -1.9958328996351784 0.9951633403527971 1.9958383335011358 -0.9958522972932842
output 3 peq 1 bypass off
output 0 peq 2 set -- 1.0006943908064445 -1.9958328996351784 0.9951633403527971 1.9958383335011358 -0.9958522972932842
output 0 peq 2 bypass off
output 1 peq 2 set -- 1.0006943908064445 -1.9958328996351784 0.9951633403527971 1.9958383335011358 -0.9958522972932842
output 1 peq 2 bypass off
output 2 peq 2 set -- 1.0006943908064445 -1.9958328996351784 0.9951633403527971 1.9958383335011358 -0.9958522972932842
output 2 peq 2 bypass off
output 3 peq 2 set -- 1.0006943908064445 -1.9958328996351784 0.9951633403527971 1.9958383335011358 -0.9958522972932842
output 3 peq 2 bypass off
output 0 peq 3 set -- 1.0006943908064445 -1.9958328996351784 0.9951633403527971 1.9958383335011358 -0.9958522972932842
output 0 peq 3 bypass off
output 1 peq 3 set -- 1.0006943908064445 -1.9958328996351784 0.9951633403527971 1.9958383335011358 -0.9958522972932842
output 1 peq 3 bypass off
output 2 peq 3 set -- 1.0006943908064445 -1.9958328996351784 0.9951633403527971 1.9958383335011358 -0.9958522972932842
output 2 peq 3 bypass off
output 3 peq 3 set -- 1.0006943908064445 -1.9958328996351784 0.9951633403527971 1.9958383335011358 -0.9958522972932842
output 3 peq 3 bypass off
output 0 peq 4 set -- 1.0006943908064445 -1.9958328996351784 0.9951633403527971 1.9958383335011358 -0.9958522972932842
output 0 peq 4 bypass off
output 1 peq 4 set -- 1.0006943908064445 -1.9958328996351784 0.9951633403527971 1.9958383335011358 -0.9958522972932842
output 1 peq 4 bypass off
output 2 peq 4 set -- 1.0006943908064445 -1.9958328996351784 0.9951633403527971 1.9958383335011358 -0.9958522972932842
output 2 peq 4 bypass off
output 3 peq 4 set -- 1.0006943908064445 -1.9958328996351784 0.9951633403527971 1.9958383335011358 -0.9958522972932842
output 3 peq 4 bypass off
output 0 peq 5 bypass on
output 1 peq 5 bypass on
output 2 peq 5 bypass on
output 3 peq 5 bypass on
output 0 peq 6 bypass on
output 1 peq 6 bypass on
output 2 peq 6 bypass on
output 3 peq 6 bypass on
output 0 peq 7 bypass on
output 1 peq 7 bypass on
output 2 peq 7 bypass on
output 3 peq 7 bypass on
output 0 peq 8 bypass on
output 1 peq 8 bypass on
output 2 peq 8 bypass on
output 3 peq 8 bypass on
output 0 peq 9 bypass on
output 1 peq 9 bypass on
output 2 peq 9 bypass on
output 3 peq 9 bypass on"""
        assert '\n'.join(cmds) == expected_commands
    else:
        assert r.status_code == 400
        cmds = config.spy.take_commands()
        assert not cmds
    slots = verify_master_device_state(r.json)
    for idx, s in enumerate(slots):
        slot_is_active = idx + 1 == slot if is_valid else idx == 0
        if is_valid and idx + 1 == slot:
            verify_slot(s, idx + 1, active=slot_is_active, last='Alien Resurrection', gain=None, mute=None)
        else:
            verify_slot(s, idx + 1, active=slot_is_active, gain=None, mute=None)

    if is_valid:
        r = minidsp_ddrc24_client.delete(f"/api/1/devices/master/filter/{slot}")
        assert r.status_code == 200
        cmds = config.spy.take_commands()
        assert len(cmds) == 40
        expected_commands = f"""output 0 peq 0 bypass on
output 1 peq 0 bypass on
output 2 peq 0 bypass on
output 3 peq 0 bypass on
output 0 peq 1 bypass on
output 1 peq 1 bypass on
output 2 peq 1 bypass on
output 3 peq 1 bypass on
output 0 peq 2 bypass on
output 1 peq 2 bypass on
output 2 peq 2 bypass on
output 3 peq 2 bypass on
output 0 peq 3 bypass on
output 1 peq 3 bypass on
output 2 peq 3 bypass on
output 3 peq 3 bypass on
output 0 peq 4 bypass on
output 1 peq 4 bypass on
output 2 peq 4 bypass on
output 3 peq 4 bypass on
output 0 peq 5 bypass on
output 1 peq 5 bypass on
output 2 peq 5 bypass on
output 3 peq 5 bypass on
output 0 peq 6 bypass on
output 1 peq 6 bypass on
output 2 peq 6 bypass on
output 3 peq 6 bypass on
output 0 peq 7 bypass on
output 1 peq 7 bypass on
output 2 peq 7 bypass on
output 3 peq 7 bypass on
output 0 peq 8 bypass on
output 1 peq 8 bypass on
output 2 peq 8 bypass on
output 3 peq 8 bypass on
output 0 peq 9 bypass on
output 1 peq 9 bypass on
output 2 peq 9 bypass on
output 3 peq 9 bypass on"""
        assert '\n'.join(cmds) == expected_commands
        slots = verify_master_device_state(r.json)
        for idx, s in enumerate(slots):
            slot_is_active = idx + 1 == slot if is_valid else idx == 0
            verify_slot(s, idx + 1, active=slot_is_active, gain=None, mute=None)


@pytest.mark.parametrize("slot,is_valid", [(0, False), (1, True), (2, True), (3, True), (4, True), (5, False)])
def test_load_known_entry_to_ddrc88_and_then_clear(minidsp_ddrc88_client, minidsp_ddrc88_app, slot, is_valid):
    config: MinidspSpyConfig = minidsp_ddrc88_app.config['APP_CONFIG']
    assert isinstance(config, MinidspSpyConfig)

    r = minidsp_ddrc88_client.put(f"/api/1/devices/master/filter/{slot}", data=json.dumps({'entryId': '123456_0'}),
                                  content_type='application/json')
    if is_valid:
        assert r.status_code == 200
        cmds = verify_cmd_count(config.spy, slot, 15)
        expected_commands = f"""output 3 peq 0 set -- 1.0006943908064445 -1.9958328996351784 0.9951633403527971 1.9958383335011358 -0.9958522972932842
output 3 peq 0 bypass off
output 3 peq 1 set -- 1.0006943908064445 -1.9958328996351784 0.9951633403527971 1.9958383335011358 -0.9958522972932842
output 3 peq 1 bypass off
output 3 peq 2 set -- 1.0006943908064445 -1.9958328996351784 0.9951633403527971 1.9958383335011358 -0.9958522972932842
output 3 peq 2 bypass off
output 3 peq 3 set -- 1.0006943908064445 -1.9958328996351784 0.9951633403527971 1.9958383335011358 -0.9958522972932842
output 3 peq 3 bypass off
output 3 peq 4 set -- 1.0006943908064445 -1.9958328996351784 0.9951633403527971 1.9958383335011358 -0.9958522972932842
output 3 peq 4 bypass off
output 3 peq 5 bypass on
output 3 peq 6 bypass on
output 3 peq 7 bypass on
output 3 peq 8 bypass on
output 3 peq 9 bypass on"""
        assert '\n'.join(cmds) == expected_commands
    else:
        assert r.status_code == 400
        cmds = config.spy.take_commands()
        assert not cmds
    slots = verify_master_device_state(r.json)
    for idx, s in enumerate(slots):
        slot_is_active = idx + 1 == slot if is_valid else idx == 0
        if is_valid and idx + 1 == slot:
            verify_slot(s, idx + 1, active=slot_is_active, last='Alien Resurrection', gain=None, mute=None)
        else:
            verify_slot(s, idx + 1, active=slot_is_active, gain=None, mute=None)

    if is_valid:
        r = minidsp_ddrc88_client.delete(f"/api/1/devices/master/filter/{slot}")
        assert r.status_code == 200
        cmds = config.spy.take_commands()
        assert len(cmds) == 10
        expected_commands = f"""output 3 peq 0 bypass on
output 3 peq 1 bypass on
output 3 peq 2 bypass on
output 3 peq 3 bypass on
output 3 peq 4 bypass on
output 3 peq 5 bypass on
output 3 peq 6 bypass on
output 3 peq 7 bypass on
output 3 peq 8 bypass on
output 3 peq 9 bypass on"""
        assert '\n'.join(cmds) == expected_commands
        slots = verify_master_device_state(r.json)
        for idx, s in enumerate(slots):
            slot_is_active = idx + 1 == slot if is_valid else idx == 0
            verify_slot(s, idx + 1, active=slot_is_active, gain=None, mute=None)


@pytest.mark.parametrize("slot,is_valid", [(0, False), (1, True), (2, True), (3, True), (4, True), (5, False)])
def test_load_known_entry_to_4x10_and_then_clear(minidsp_4x10_client, minidsp_4x10_app, slot, is_valid):
    config: MinidspSpyConfig = minidsp_4x10_app.config['APP_CONFIG']
    assert isinstance(config, MinidspSpyConfig)

    r = minidsp_4x10_client.put(f"/api/1/devices/master/filter/{slot}", data=json.dumps({'entryId': '123456_0'}),
                                content_type='application/json')
    if is_valid:
        assert r.status_code == 200
        cmds = verify_cmd_count(config.spy, slot, 60)
        expected_commands = f"""input 0 peq 0 set -- 1.0003468763586854 -1.9979191385126602 0.9975784764805841 1.9979204983896346 -0.9979239929622952
input 0 peq 0 bypass off
input 1 peq 0 set -- 1.0003468763586854 -1.9979191385126602 0.9975784764805841 1.9979204983896346 -0.9979239929622952
input 1 peq 0 bypass off
input 0 peq 1 set -- 1.0003468763586854 -1.9979191385126602 0.9975784764805841 1.9979204983896346 -0.9979239929622952
input 0 peq 1 bypass off
input 1 peq 1 set -- 1.0003468763586854 -1.9979191385126602 0.9975784764805841 1.9979204983896346 -0.9979239929622952
input 1 peq 1 bypass off
input 0 peq 2 set -- 1.0003468763586854 -1.9979191385126602 0.9975784764805841 1.9979204983896346 -0.9979239929622952
input 0 peq 2 bypass off
input 1 peq 2 set -- 1.0003468763586854 -1.9979191385126602 0.9975784764805841 1.9979204983896346 -0.9979239929622952
input 1 peq 2 bypass off
input 0 peq 3 set -- 1.0003468763586854 -1.9979191385126602 0.9975784764805841 1.9979204983896346 -0.9979239929622952
input 0 peq 3 bypass off
input 1 peq 3 set -- 1.0003468763586854 -1.9979191385126602 0.9975784764805841 1.9979204983896346 -0.9979239929622952
input 1 peq 3 bypass off
input 0 peq 4 set -- 1.0003468763586854 -1.9979191385126602 0.9975784764805841 1.9979204983896346 -0.9979239929622952
input 0 peq 4 bypass off
input 1 peq 4 set -- 1.0003468763586854 -1.9979191385126602 0.9975784764805841 1.9979204983896346 -0.9979239929622952
input 1 peq 4 bypass off
output 0 peq 0 bypass on
output 1 peq 0 bypass on
output 2 peq 0 bypass on
output 3 peq 0 bypass on
output 4 peq 0 bypass on
output 5 peq 0 bypass on
output 6 peq 0 bypass on
output 7 peq 0 bypass on
output 0 peq 1 bypass on
output 1 peq 1 bypass on
output 2 peq 1 bypass on
output 3 peq 1 bypass on
output 4 peq 1 bypass on
output 5 peq 1 bypass on
output 6 peq 1 bypass on
output 7 peq 1 bypass on
output 0 peq 2 bypass on
output 1 peq 2 bypass on
output 2 peq 2 bypass on
output 3 peq 2 bypass on
output 4 peq 2 bypass on
output 5 peq 2 bypass on
output 6 peq 2 bypass on
output 7 peq 2 bypass on
output 0 peq 3 bypass on
output 1 peq 3 bypass on
output 2 peq 3 bypass on
output 3 peq 3 bypass on
output 4 peq 3 bypass on
output 5 peq 3 bypass on
output 6 peq 3 bypass on
output 7 peq 3 bypass on
output 0 peq 4 bypass on
output 1 peq 4 bypass on
output 2 peq 4 bypass on
output 3 peq 4 bypass on
output 4 peq 4 bypass on
output 5 peq 4 bypass on
output 6 peq 4 bypass on
output 7 peq 4 bypass on"""
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
        r = minidsp_4x10_client.delete(f"/api/1/devices/master/filter/{slot}")
        assert r.status_code == 200
        cmds = config.spy.take_commands()
        assert len(cmds) == 54
        expected_commands = f"""input 0 peq 0 bypass on
input 1 peq 0 bypass on
input 0 peq 1 bypass on
input 1 peq 1 bypass on
input 0 peq 2 bypass on
input 1 peq 2 bypass on
input 0 peq 3 bypass on
input 1 peq 3 bypass on
input 0 peq 4 bypass on
input 1 peq 4 bypass on
output 0 peq 0 bypass on
output 1 peq 0 bypass on
output 2 peq 0 bypass on
output 3 peq 0 bypass on
output 4 peq 0 bypass on
output 5 peq 0 bypass on
output 6 peq 0 bypass on
output 7 peq 0 bypass on
output 0 peq 1 bypass on
output 1 peq 1 bypass on
output 2 peq 1 bypass on
output 3 peq 1 bypass on
output 4 peq 1 bypass on
output 5 peq 1 bypass on
output 6 peq 1 bypass on
output 7 peq 1 bypass on
output 0 peq 2 bypass on
output 1 peq 2 bypass on
output 2 peq 2 bypass on
output 3 peq 2 bypass on
output 4 peq 2 bypass on
output 5 peq 2 bypass on
output 6 peq 2 bypass on
output 7 peq 2 bypass on
output 0 peq 3 bypass on
output 1 peq 3 bypass on
output 2 peq 3 bypass on
output 3 peq 3 bypass on
output 4 peq 3 bypass on
output 5 peq 3 bypass on
output 6 peq 3 bypass on
output 7 peq 3 bypass on
output 0 peq 4 bypass on
output 1 peq 4 bypass on
output 2 peq 4 bypass on
output 3 peq 4 bypass on
output 4 peq 4 bypass on
output 5 peq 4 bypass on
output 6 peq 4 bypass on
output 7 peq 4 bypass on
input 0 mute off
input 0 gain -- 0.00
input 1 mute off
input 1 gain -- 0.00"""
        assert '\n'.join(cmds) == expected_commands
        slots = verify_master_device_state(r.json)
        for idx, s in enumerate(slots):
            slot_is_active = idx + 1 == slot if is_valid else idx == 0
            verify_slot(s, idx + 1, active=slot_is_active)


@pytest.mark.parametrize("slot,is_valid", [(0, False), (1, True), (2, True), (3, True), (4, True), (5, False)])
def test_load_known_entry_to_10x10_and_then_clear(minidsp_10x10_client, minidsp_10x10_app, slot, is_valid):
    config: MinidspSpyConfig = minidsp_10x10_app.config['APP_CONFIG']
    assert isinstance(config, MinidspSpyConfig)

    r = minidsp_10x10_client.put(f"/api/1/devices/master/filter/{slot}", data=json.dumps({'entryId': '123456_0'}),
                                 content_type='application/json')
    if is_valid:
        assert r.status_code == 200
        cmds = verify_cmd_count(config.spy, slot, 120)
        expected_commands = f"""input 0 peq 0 set -- 1.0006943908064445 -1.9958328996351784 0.9951633403527971 1.9958383335011358 -0.9958522972932842
input 0 peq 0 bypass off
input 1 peq 0 set -- 1.0006943908064445 -1.9958328996351784 0.9951633403527971 1.9958383335011358 -0.9958522972932842
input 1 peq 0 bypass off
input 2 peq 0 set -- 1.0006943908064445 -1.9958328996351784 0.9951633403527971 1.9958383335011358 -0.9958522972932842
input 2 peq 0 bypass off
input 3 peq 0 set -- 1.0006943908064445 -1.9958328996351784 0.9951633403527971 1.9958383335011358 -0.9958522972932842
input 3 peq 0 bypass off
input 4 peq 0 set -- 1.0006943908064445 -1.9958328996351784 0.9951633403527971 1.9958383335011358 -0.9958522972932842
input 4 peq 0 bypass off
input 5 peq 0 set -- 1.0006943908064445 -1.9958328996351784 0.9951633403527971 1.9958383335011358 -0.9958522972932842
input 5 peq 0 bypass off
input 6 peq 0 set -- 1.0006943908064445 -1.9958328996351784 0.9951633403527971 1.9958383335011358 -0.9958522972932842
input 6 peq 0 bypass off
input 7 peq 0 set -- 1.0006943908064445 -1.9958328996351784 0.9951633403527971 1.9958383335011358 -0.9958522972932842
input 7 peq 0 bypass off
input 0 peq 1 set -- 1.0006943908064445 -1.9958328996351784 0.9951633403527971 1.9958383335011358 -0.9958522972932842
input 0 peq 1 bypass off
input 1 peq 1 set -- 1.0006943908064445 -1.9958328996351784 0.9951633403527971 1.9958383335011358 -0.9958522972932842
input 1 peq 1 bypass off
input 2 peq 1 set -- 1.0006943908064445 -1.9958328996351784 0.9951633403527971 1.9958383335011358 -0.9958522972932842
input 2 peq 1 bypass off
input 3 peq 1 set -- 1.0006943908064445 -1.9958328996351784 0.9951633403527971 1.9958383335011358 -0.9958522972932842
input 3 peq 1 bypass off
input 4 peq 1 set -- 1.0006943908064445 -1.9958328996351784 0.9951633403527971 1.9958383335011358 -0.9958522972932842
input 4 peq 1 bypass off
input 5 peq 1 set -- 1.0006943908064445 -1.9958328996351784 0.9951633403527971 1.9958383335011358 -0.9958522972932842
input 5 peq 1 bypass off
input 6 peq 1 set -- 1.0006943908064445 -1.9958328996351784 0.9951633403527971 1.9958383335011358 -0.9958522972932842
input 6 peq 1 bypass off
input 7 peq 1 set -- 1.0006943908064445 -1.9958328996351784 0.9951633403527971 1.9958383335011358 -0.9958522972932842
input 7 peq 1 bypass off
input 0 peq 2 set -- 1.0006943908064445 -1.9958328996351784 0.9951633403527971 1.9958383335011358 -0.9958522972932842
input 0 peq 2 bypass off
input 1 peq 2 set -- 1.0006943908064445 -1.9958328996351784 0.9951633403527971 1.9958383335011358 -0.9958522972932842
input 1 peq 2 bypass off
input 2 peq 2 set -- 1.0006943908064445 -1.9958328996351784 0.9951633403527971 1.9958383335011358 -0.9958522972932842
input 2 peq 2 bypass off
input 3 peq 2 set -- 1.0006943908064445 -1.9958328996351784 0.9951633403527971 1.9958383335011358 -0.9958522972932842
input 3 peq 2 bypass off
input 4 peq 2 set -- 1.0006943908064445 -1.9958328996351784 0.9951633403527971 1.9958383335011358 -0.9958522972932842
input 4 peq 2 bypass off
input 5 peq 2 set -- 1.0006943908064445 -1.9958328996351784 0.9951633403527971 1.9958383335011358 -0.9958522972932842
input 5 peq 2 bypass off
input 6 peq 2 set -- 1.0006943908064445 -1.9958328996351784 0.9951633403527971 1.9958383335011358 -0.9958522972932842
input 6 peq 2 bypass off
input 7 peq 2 set -- 1.0006943908064445 -1.9958328996351784 0.9951633403527971 1.9958383335011358 -0.9958522972932842
input 7 peq 2 bypass off
input 0 peq 3 set -- 1.0006943908064445 -1.9958328996351784 0.9951633403527971 1.9958383335011358 -0.9958522972932842
input 0 peq 3 bypass off
input 1 peq 3 set -- 1.0006943908064445 -1.9958328996351784 0.9951633403527971 1.9958383335011358 -0.9958522972932842
input 1 peq 3 bypass off
input 2 peq 3 set -- 1.0006943908064445 -1.9958328996351784 0.9951633403527971 1.9958383335011358 -0.9958522972932842
input 2 peq 3 bypass off
input 3 peq 3 set -- 1.0006943908064445 -1.9958328996351784 0.9951633403527971 1.9958383335011358 -0.9958522972932842
input 3 peq 3 bypass off
input 4 peq 3 set -- 1.0006943908064445 -1.9958328996351784 0.9951633403527971 1.9958383335011358 -0.9958522972932842
input 4 peq 3 bypass off
input 5 peq 3 set -- 1.0006943908064445 -1.9958328996351784 0.9951633403527971 1.9958383335011358 -0.9958522972932842
input 5 peq 3 bypass off
input 6 peq 3 set -- 1.0006943908064445 -1.9958328996351784 0.9951633403527971 1.9958383335011358 -0.9958522972932842
input 6 peq 3 bypass off
input 7 peq 3 set -- 1.0006943908064445 -1.9958328996351784 0.9951633403527971 1.9958383335011358 -0.9958522972932842
input 7 peq 3 bypass off
input 0 peq 4 set -- 1.0006943908064445 -1.9958328996351784 0.9951633403527971 1.9958383335011358 -0.9958522972932842
input 0 peq 4 bypass off
input 1 peq 4 set -- 1.0006943908064445 -1.9958328996351784 0.9951633403527971 1.9958383335011358 -0.9958522972932842
input 1 peq 4 bypass off
input 2 peq 4 set -- 1.0006943908064445 -1.9958328996351784 0.9951633403527971 1.9958383335011358 -0.9958522972932842
input 2 peq 4 bypass off
input 3 peq 4 set -- 1.0006943908064445 -1.9958328996351784 0.9951633403527971 1.9958383335011358 -0.9958522972932842
input 3 peq 4 bypass off
input 4 peq 4 set -- 1.0006943908064445 -1.9958328996351784 0.9951633403527971 1.9958383335011358 -0.9958522972932842
input 4 peq 4 bypass off
input 5 peq 4 set -- 1.0006943908064445 -1.9958328996351784 0.9951633403527971 1.9958383335011358 -0.9958522972932842
input 5 peq 4 bypass off
input 6 peq 4 set -- 1.0006943908064445 -1.9958328996351784 0.9951633403527971 1.9958383335011358 -0.9958522972932842
input 6 peq 4 bypass off
input 7 peq 4 set -- 1.0006943908064445 -1.9958328996351784 0.9951633403527971 1.9958383335011358 -0.9958522972932842
input 7 peq 4 bypass off
input 0 peq 5 bypass on
input 1 peq 5 bypass on
input 2 peq 5 bypass on
input 3 peq 5 bypass on
input 4 peq 5 bypass on
input 5 peq 5 bypass on
input 6 peq 5 bypass on
input 7 peq 5 bypass on
output 0 peq 0 bypass on
output 1 peq 0 bypass on
output 2 peq 0 bypass on
output 3 peq 0 bypass on
output 4 peq 0 bypass on
output 5 peq 0 bypass on
output 6 peq 0 bypass on
output 7 peq 0 bypass on
output 0 peq 1 bypass on
output 1 peq 1 bypass on
output 2 peq 1 bypass on
output 3 peq 1 bypass on
output 4 peq 1 bypass on
output 5 peq 1 bypass on
output 6 peq 1 bypass on
output 7 peq 1 bypass on
output 0 peq 2 bypass on
output 1 peq 2 bypass on
output 2 peq 2 bypass on
output 3 peq 2 bypass on
output 4 peq 2 bypass on
output 5 peq 2 bypass on
output 6 peq 2 bypass on
output 7 peq 2 bypass on
output 0 peq 3 bypass on
output 1 peq 3 bypass on
output 2 peq 3 bypass on
output 3 peq 3 bypass on
output 4 peq 3 bypass on
output 5 peq 3 bypass on
output 6 peq 3 bypass on
output 7 peq 3 bypass on"""
        assert '\n'.join(cmds) == expected_commands
    else:
        assert r.status_code == 400
        cmds = config.spy.take_commands()
        assert not cmds
    slots = verify_master_device_state(r.json)
    for idx, s in enumerate(slots):
        slot_is_active = idx + 1 == slot if is_valid else idx == 0
        if is_valid and idx + 1 == slot:
            verify_slot(s, idx + 1, active=slot_is_active, last='Alien Resurrection', gain=[0.0] * 8, mute=[False] * 8)
        else:
            verify_slot(s, idx + 1, active=slot_is_active, gain=[0.0] * 8, mute=[False] * 8)

    if is_valid:
        r = minidsp_10x10_client.delete(f"/api/1/devices/master/filter/{slot}")
        assert r.status_code == 200
        cmds = config.spy.take_commands()
        assert len(cmds) == 96
        expected_commands = f"""input 0 peq 0 bypass on
input 1 peq 0 bypass on
input 2 peq 0 bypass on
input 3 peq 0 bypass on
input 4 peq 0 bypass on
input 5 peq 0 bypass on
input 6 peq 0 bypass on
input 7 peq 0 bypass on
input 0 peq 1 bypass on
input 1 peq 1 bypass on
input 2 peq 1 bypass on
input 3 peq 1 bypass on
input 4 peq 1 bypass on
input 5 peq 1 bypass on
input 6 peq 1 bypass on
input 7 peq 1 bypass on
input 0 peq 2 bypass on
input 1 peq 2 bypass on
input 2 peq 2 bypass on
input 3 peq 2 bypass on
input 4 peq 2 bypass on
input 5 peq 2 bypass on
input 6 peq 2 bypass on
input 7 peq 2 bypass on
input 0 peq 3 bypass on
input 1 peq 3 bypass on
input 2 peq 3 bypass on
input 3 peq 3 bypass on
input 4 peq 3 bypass on
input 5 peq 3 bypass on
input 6 peq 3 bypass on
input 7 peq 3 bypass on
input 0 peq 4 bypass on
input 1 peq 4 bypass on
input 2 peq 4 bypass on
input 3 peq 4 bypass on
input 4 peq 4 bypass on
input 5 peq 4 bypass on
input 6 peq 4 bypass on
input 7 peq 4 bypass on
input 0 peq 5 bypass on
input 1 peq 5 bypass on
input 2 peq 5 bypass on
input 3 peq 5 bypass on
input 4 peq 5 bypass on
input 5 peq 5 bypass on
input 6 peq 5 bypass on
input 7 peq 5 bypass on
output 0 peq 0 bypass on
output 1 peq 0 bypass on
output 2 peq 0 bypass on
output 3 peq 0 bypass on
output 4 peq 0 bypass on
output 5 peq 0 bypass on
output 6 peq 0 bypass on
output 7 peq 0 bypass on
output 0 peq 1 bypass on
output 1 peq 1 bypass on
output 2 peq 1 bypass on
output 3 peq 1 bypass on
output 4 peq 1 bypass on
output 5 peq 1 bypass on
output 6 peq 1 bypass on
output 7 peq 1 bypass on
output 0 peq 2 bypass on
output 1 peq 2 bypass on
output 2 peq 2 bypass on
output 3 peq 2 bypass on
output 4 peq 2 bypass on
output 5 peq 2 bypass on
output 6 peq 2 bypass on
output 7 peq 2 bypass on
output 0 peq 3 bypass on
output 1 peq 3 bypass on
output 2 peq 3 bypass on
output 3 peq 3 bypass on
output 4 peq 3 bypass on
output 5 peq 3 bypass on
output 6 peq 3 bypass on
output 7 peq 3 bypass on
input 0 mute off
input 0 gain -- 0.00
input 1 mute off
input 1 gain -- 0.00
input 2 mute off
input 2 gain -- 0.00
input 3 mute off
input 3 gain -- 0.00
input 4 mute off
input 4 gain -- 0.00
input 5 mute off
input 5 gain -- 0.00
input 6 mute off
input 6 gain -- 0.00
input 7 mute off
input 7 gain -- 0.00"""
        assert '\n'.join(cmds) == expected_commands
        slots = verify_master_device_state(r.json)
        for idx, s in enumerate(slots):
            slot_is_active = idx + 1 == slot if is_valid else idx == 0
            verify_slot(s, idx + 1, active=slot_is_active, gain=[0.0] * 8, mute=[False] * 8)


@pytest.mark.parametrize("slot,is_valid", [(0, False), (1, True), (2, True), (3, True), (4, True), (5, False)])
def test_load_known_entry_to_10x10xo0_and_then_clear(minidsp_10x10xo0_client, minidsp_10x10xo0_app, slot, is_valid):
    config: MinidspSpyConfig = minidsp_10x10xo0_app.config['APP_CONFIG']
    assert isinstance(config, MinidspSpyConfig)

    r = minidsp_10x10xo0_client.put(f"/api/1/devices/master/filter/{slot}", data=json.dumps({'entryId': '123456_0'}),
                                   content_type='application/json')
    if is_valid:
        assert r.status_code == 200
        cmds = verify_cmd_count(config.spy, slot, 120)
        expected_commands = f"""input 0 peq 0 set -- 1.0006943908064445 -1.9958328996351784 0.9951633403527971 1.9958383335011358 -0.9958522972932842
input 0 peq 0 bypass off
input 1 peq 0 set -- 1.0006943908064445 -1.9958328996351784 0.9951633403527971 1.9958383335011358 -0.9958522972932842
input 1 peq 0 bypass off
input 2 peq 0 set -- 1.0006943908064445 -1.9958328996351784 0.9951633403527971 1.9958383335011358 -0.9958522972932842
input 2 peq 0 bypass off
input 3 peq 0 set -- 1.0006943908064445 -1.9958328996351784 0.9951633403527971 1.9958383335011358 -0.9958522972932842
input 3 peq 0 bypass off
input 4 peq 0 set -- 1.0006943908064445 -1.9958328996351784 0.9951633403527971 1.9958383335011358 -0.9958522972932842
input 4 peq 0 bypass off
input 5 peq 0 set -- 1.0006943908064445 -1.9958328996351784 0.9951633403527971 1.9958383335011358 -0.9958522972932842
input 5 peq 0 bypass off
input 6 peq 0 set -- 1.0006943908064445 -1.9958328996351784 0.9951633403527971 1.9958383335011358 -0.9958522972932842
input 6 peq 0 bypass off
input 7 peq 0 set -- 1.0006943908064445 -1.9958328996351784 0.9951633403527971 1.9958383335011358 -0.9958522972932842
input 7 peq 0 bypass off
input 0 peq 1 set -- 1.0006943908064445 -1.9958328996351784 0.9951633403527971 1.9958383335011358 -0.9958522972932842
input 0 peq 1 bypass off
input 1 peq 1 set -- 1.0006943908064445 -1.9958328996351784 0.9951633403527971 1.9958383335011358 -0.9958522972932842
input 1 peq 1 bypass off
input 2 peq 1 set -- 1.0006943908064445 -1.9958328996351784 0.9951633403527971 1.9958383335011358 -0.9958522972932842
input 2 peq 1 bypass off
input 3 peq 1 set -- 1.0006943908064445 -1.9958328996351784 0.9951633403527971 1.9958383335011358 -0.9958522972932842
input 3 peq 1 bypass off
input 4 peq 1 set -- 1.0006943908064445 -1.9958328996351784 0.9951633403527971 1.9958383335011358 -0.9958522972932842
input 4 peq 1 bypass off
input 5 peq 1 set -- 1.0006943908064445 -1.9958328996351784 0.9951633403527971 1.9958383335011358 -0.9958522972932842
input 5 peq 1 bypass off
input 6 peq 1 set -- 1.0006943908064445 -1.9958328996351784 0.9951633403527971 1.9958383335011358 -0.9958522972932842
input 6 peq 1 bypass off
input 7 peq 1 set -- 1.0006943908064445 -1.9958328996351784 0.9951633403527971 1.9958383335011358 -0.9958522972932842
input 7 peq 1 bypass off
input 0 peq 2 set -- 1.0006943908064445 -1.9958328996351784 0.9951633403527971 1.9958383335011358 -0.9958522972932842
input 0 peq 2 bypass off
input 1 peq 2 set -- 1.0006943908064445 -1.9958328996351784 0.9951633403527971 1.9958383335011358 -0.9958522972932842
input 1 peq 2 bypass off
input 2 peq 2 set -- 1.0006943908064445 -1.9958328996351784 0.9951633403527971 1.9958383335011358 -0.9958522972932842
input 2 peq 2 bypass off
input 3 peq 2 set -- 1.0006943908064445 -1.9958328996351784 0.9951633403527971 1.9958383335011358 -0.9958522972932842
input 3 peq 2 bypass off
input 4 peq 2 set -- 1.0006943908064445 -1.9958328996351784 0.9951633403527971 1.9958383335011358 -0.9958522972932842
input 4 peq 2 bypass off
input 5 peq 2 set -- 1.0006943908064445 -1.9958328996351784 0.9951633403527971 1.9958383335011358 -0.9958522972932842
input 5 peq 2 bypass off
input 6 peq 2 set -- 1.0006943908064445 -1.9958328996351784 0.9951633403527971 1.9958383335011358 -0.9958522972932842
input 6 peq 2 bypass off
input 7 peq 2 set -- 1.0006943908064445 -1.9958328996351784 0.9951633403527971 1.9958383335011358 -0.9958522972932842
input 7 peq 2 bypass off
input 0 peq 3 set -- 1.0006943908064445 -1.9958328996351784 0.9951633403527971 1.9958383335011358 -0.9958522972932842
input 0 peq 3 bypass off
input 1 peq 3 set -- 1.0006943908064445 -1.9958328996351784 0.9951633403527971 1.9958383335011358 -0.9958522972932842
input 1 peq 3 bypass off
input 2 peq 3 set -- 1.0006943908064445 -1.9958328996351784 0.9951633403527971 1.9958383335011358 -0.9958522972932842
input 2 peq 3 bypass off
input 3 peq 3 set -- 1.0006943908064445 -1.9958328996351784 0.9951633403527971 1.9958383335011358 -0.9958522972932842
input 3 peq 3 bypass off
input 4 peq 3 set -- 1.0006943908064445 -1.9958328996351784 0.9951633403527971 1.9958383335011358 -0.9958522972932842
input 4 peq 3 bypass off
input 5 peq 3 set -- 1.0006943908064445 -1.9958328996351784 0.9951633403527971 1.9958383335011358 -0.9958522972932842
input 5 peq 3 bypass off
input 6 peq 3 set -- 1.0006943908064445 -1.9958328996351784 0.9951633403527971 1.9958383335011358 -0.9958522972932842
input 6 peq 3 bypass off
input 7 peq 3 set -- 1.0006943908064445 -1.9958328996351784 0.9951633403527971 1.9958383335011358 -0.9958522972932842
input 7 peq 3 bypass off
input 0 peq 4 set -- 1.0006943908064445 -1.9958328996351784 0.9951633403527971 1.9958383335011358 -0.9958522972932842
input 0 peq 4 bypass off
input 1 peq 4 set -- 1.0006943908064445 -1.9958328996351784 0.9951633403527971 1.9958383335011358 -0.9958522972932842
input 1 peq 4 bypass off
input 2 peq 4 set -- 1.0006943908064445 -1.9958328996351784 0.9951633403527971 1.9958383335011358 -0.9958522972932842
input 2 peq 4 bypass off
input 3 peq 4 set -- 1.0006943908064445 -1.9958328996351784 0.9951633403527971 1.9958383335011358 -0.9958522972932842
input 3 peq 4 bypass off
input 4 peq 4 set -- 1.0006943908064445 -1.9958328996351784 0.9951633403527971 1.9958383335011358 -0.9958522972932842
input 4 peq 4 bypass off
input 5 peq 4 set -- 1.0006943908064445 -1.9958328996351784 0.9951633403527971 1.9958383335011358 -0.9958522972932842
input 5 peq 4 bypass off
input 6 peq 4 set -- 1.0006943908064445 -1.9958328996351784 0.9951633403527971 1.9958383335011358 -0.9958522972932842
input 6 peq 4 bypass off
input 7 peq 4 set -- 1.0006943908064445 -1.9958328996351784 0.9951633403527971 1.9958383335011358 -0.9958522972932842
input 7 peq 4 bypass off
input 0 peq 5 bypass on
input 1 peq 5 bypass on
input 2 peq 5 bypass on
input 3 peq 5 bypass on
input 4 peq 5 bypass on
input 5 peq 5 bypass on
input 6 peq 5 bypass on
input 7 peq 5 bypass on
output 0 crossover 0 0 bypass on
output 1 crossover 0 0 bypass on
output 2 crossover 0 0 bypass on
output 3 crossover 0 0 bypass on
output 4 crossover 0 0 bypass on
output 5 crossover 0 0 bypass on
output 6 crossover 0 0 bypass on
output 7 crossover 0 0 bypass on
output 0 crossover 0 1 bypass on
output 1 crossover 0 1 bypass on
output 2 crossover 0 1 bypass on
output 3 crossover 0 1 bypass on
output 4 crossover 0 1 bypass on
output 5 crossover 0 1 bypass on
output 6 crossover 0 1 bypass on
output 7 crossover 0 1 bypass on
output 0 crossover 0 2 bypass on
output 1 crossover 0 2 bypass on
output 2 crossover 0 2 bypass on
output 3 crossover 0 2 bypass on
output 4 crossover 0 2 bypass on
output 5 crossover 0 2 bypass on
output 6 crossover 0 2 bypass on
output 7 crossover 0 2 bypass on
output 0 crossover 0 3 bypass on
output 1 crossover 0 3 bypass on
output 2 crossover 0 3 bypass on
output 3 crossover 0 3 bypass on
output 4 crossover 0 3 bypass on
output 5 crossover 0 3 bypass on
output 6 crossover 0 3 bypass on
output 7 crossover 0 3 bypass on"""
        assert '\n'.join(cmds) == expected_commands
    else:
        assert r.status_code == 400
        cmds = config.spy.take_commands()
        assert not cmds
    slots = verify_master_device_state(r.json)
    for idx, s in enumerate(slots):
        slot_is_active = idx + 1 == slot if is_valid else idx == 0
        if is_valid and idx + 1 == slot:
            verify_slot(s, idx + 1, active=slot_is_active, last='Alien Resurrection', gain=[0.0] * 8, mute=[False] * 8)
        else:
            verify_slot(s, idx + 1, active=slot_is_active, gain=[0.0] * 8, mute=[False] * 8)

    if is_valid:
        r = minidsp_10x10xo0_client.delete(f"/api/1/devices/master/filter/{slot}")
        assert r.status_code == 200
        cmds = config.spy.take_commands()
        assert len(cmds) == 96
        expected_commands = f"""input 0 peq 0 bypass on
input 1 peq 0 bypass on
input 2 peq 0 bypass on
input 3 peq 0 bypass on
input 4 peq 0 bypass on
input 5 peq 0 bypass on
input 6 peq 0 bypass on
input 7 peq 0 bypass on
input 0 peq 1 bypass on
input 1 peq 1 bypass on
input 2 peq 1 bypass on
input 3 peq 1 bypass on
input 4 peq 1 bypass on
input 5 peq 1 bypass on
input 6 peq 1 bypass on
input 7 peq 1 bypass on
input 0 peq 2 bypass on
input 1 peq 2 bypass on
input 2 peq 2 bypass on
input 3 peq 2 bypass on
input 4 peq 2 bypass on
input 5 peq 2 bypass on
input 6 peq 2 bypass on
input 7 peq 2 bypass on
input 0 peq 3 bypass on
input 1 peq 3 bypass on
input 2 peq 3 bypass on
input 3 peq 3 bypass on
input 4 peq 3 bypass on
input 5 peq 3 bypass on
input 6 peq 3 bypass on
input 7 peq 3 bypass on
input 0 peq 4 bypass on
input 1 peq 4 bypass on
input 2 peq 4 bypass on
input 3 peq 4 bypass on
input 4 peq 4 bypass on
input 5 peq 4 bypass on
input 6 peq 4 bypass on
input 7 peq 4 bypass on
input 0 peq 5 bypass on
input 1 peq 5 bypass on
input 2 peq 5 bypass on
input 3 peq 5 bypass on
input 4 peq 5 bypass on
input 5 peq 5 bypass on
input 6 peq 5 bypass on
input 7 peq 5 bypass on
output 0 crossover 0 0 bypass on
output 1 crossover 0 0 bypass on
output 2 crossover 0 0 bypass on
output 3 crossover 0 0 bypass on
output 4 crossover 0 0 bypass on
output 5 crossover 0 0 bypass on
output 6 crossover 0 0 bypass on
output 7 crossover 0 0 bypass on
output 0 crossover 0 1 bypass on
output 1 crossover 0 1 bypass on
output 2 crossover 0 1 bypass on
output 3 crossover 0 1 bypass on
output 4 crossover 0 1 bypass on
output 5 crossover 0 1 bypass on
output 6 crossover 0 1 bypass on
output 7 crossover 0 1 bypass on
output 0 crossover 0 2 bypass on
output 1 crossover 0 2 bypass on
output 2 crossover 0 2 bypass on
output 3 crossover 0 2 bypass on
output 4 crossover 0 2 bypass on
output 5 crossover 0 2 bypass on
output 6 crossover 0 2 bypass on
output 7 crossover 0 2 bypass on
output 0 crossover 0 3 bypass on
output 1 crossover 0 3 bypass on
output 2 crossover 0 3 bypass on
output 3 crossover 0 3 bypass on
output 4 crossover 0 3 bypass on
output 5 crossover 0 3 bypass on
output 6 crossover 0 3 bypass on
output 7 crossover 0 3 bypass on
input 0 mute off
input 0 gain -- 0.00
input 1 mute off
input 1 gain -- 0.00
input 2 mute off
input 2 gain -- 0.00
input 3 mute off
input 3 gain -- 0.00
input 4 mute off
input 4 gain -- 0.00
input 5 mute off
input 5 gain -- 0.00
input 6 mute off
input 6 gain -- 0.00
input 7 mute off
input 7 gain -- 0.00"""
        assert '\n'.join(cmds) == expected_commands
        slots = verify_master_device_state(r.json)
        for idx, s in enumerate(slots):
            slot_is_active = idx + 1 == slot if is_valid else idx == 0
            verify_slot(s, idx + 1, active=slot_is_active, gain=[0.0] * 8, mute=[False] * 8)


@pytest.mark.parametrize("slot,is_valid", [(0, False), (1, True), (2, True), (3, True), (4, True), (5, False)])
def test_load_known_entry_to_10x10xo1_and_then_clear(minidsp_10x10xo1_client, minidsp_10x10xo1_app, slot, is_valid):
    config: MinidspSpyConfig = minidsp_10x10xo1_app.config['APP_CONFIG']
    assert isinstance(config, MinidspSpyConfig)

    r = minidsp_10x10xo1_client.put(f"/api/1/devices/master/filter/{slot}", data=json.dumps({'entryId': '123456_0'}),
                                   content_type='application/json')
    if is_valid:
        assert r.status_code == 200
        cmds = verify_cmd_count(config.spy, slot, 120)
        expected_commands = f"""input 0 peq 0 set -- 1.0006943908064445 -1.9958328996351784 0.9951633403527971 1.9958383335011358 -0.9958522972932842
input 0 peq 0 bypass off
input 1 peq 0 set -- 1.0006943908064445 -1.9958328996351784 0.9951633403527971 1.9958383335011358 -0.9958522972932842
input 1 peq 0 bypass off
input 2 peq 0 set -- 1.0006943908064445 -1.9958328996351784 0.9951633403527971 1.9958383335011358 -0.9958522972932842
input 2 peq 0 bypass off
input 3 peq 0 set -- 1.0006943908064445 -1.9958328996351784 0.9951633403527971 1.9958383335011358 -0.9958522972932842
input 3 peq 0 bypass off
input 4 peq 0 set -- 1.0006943908064445 -1.9958328996351784 0.9951633403527971 1.9958383335011358 -0.9958522972932842
input 4 peq 0 bypass off
input 5 peq 0 set -- 1.0006943908064445 -1.9958328996351784 0.9951633403527971 1.9958383335011358 -0.9958522972932842
input 5 peq 0 bypass off
input 6 peq 0 set -- 1.0006943908064445 -1.9958328996351784 0.9951633403527971 1.9958383335011358 -0.9958522972932842
input 6 peq 0 bypass off
input 7 peq 0 set -- 1.0006943908064445 -1.9958328996351784 0.9951633403527971 1.9958383335011358 -0.9958522972932842
input 7 peq 0 bypass off
input 0 peq 1 set -- 1.0006943908064445 -1.9958328996351784 0.9951633403527971 1.9958383335011358 -0.9958522972932842
input 0 peq 1 bypass off
input 1 peq 1 set -- 1.0006943908064445 -1.9958328996351784 0.9951633403527971 1.9958383335011358 -0.9958522972932842
input 1 peq 1 bypass off
input 2 peq 1 set -- 1.0006943908064445 -1.9958328996351784 0.9951633403527971 1.9958383335011358 -0.9958522972932842
input 2 peq 1 bypass off
input 3 peq 1 set -- 1.0006943908064445 -1.9958328996351784 0.9951633403527971 1.9958383335011358 -0.9958522972932842
input 3 peq 1 bypass off
input 4 peq 1 set -- 1.0006943908064445 -1.9958328996351784 0.9951633403527971 1.9958383335011358 -0.9958522972932842
input 4 peq 1 bypass off
input 5 peq 1 set -- 1.0006943908064445 -1.9958328996351784 0.9951633403527971 1.9958383335011358 -0.9958522972932842
input 5 peq 1 bypass off
input 6 peq 1 set -- 1.0006943908064445 -1.9958328996351784 0.9951633403527971 1.9958383335011358 -0.9958522972932842
input 6 peq 1 bypass off
input 7 peq 1 set -- 1.0006943908064445 -1.9958328996351784 0.9951633403527971 1.9958383335011358 -0.9958522972932842
input 7 peq 1 bypass off
input 0 peq 2 set -- 1.0006943908064445 -1.9958328996351784 0.9951633403527971 1.9958383335011358 -0.9958522972932842
input 0 peq 2 bypass off
input 1 peq 2 set -- 1.0006943908064445 -1.9958328996351784 0.9951633403527971 1.9958383335011358 -0.9958522972932842
input 1 peq 2 bypass off
input 2 peq 2 set -- 1.0006943908064445 -1.9958328996351784 0.9951633403527971 1.9958383335011358 -0.9958522972932842
input 2 peq 2 bypass off
input 3 peq 2 set -- 1.0006943908064445 -1.9958328996351784 0.9951633403527971 1.9958383335011358 -0.9958522972932842
input 3 peq 2 bypass off
input 4 peq 2 set -- 1.0006943908064445 -1.9958328996351784 0.9951633403527971 1.9958383335011358 -0.9958522972932842
input 4 peq 2 bypass off
input 5 peq 2 set -- 1.0006943908064445 -1.9958328996351784 0.9951633403527971 1.9958383335011358 -0.9958522972932842
input 5 peq 2 bypass off
input 6 peq 2 set -- 1.0006943908064445 -1.9958328996351784 0.9951633403527971 1.9958383335011358 -0.9958522972932842
input 6 peq 2 bypass off
input 7 peq 2 set -- 1.0006943908064445 -1.9958328996351784 0.9951633403527971 1.9958383335011358 -0.9958522972932842
input 7 peq 2 bypass off
input 0 peq 3 set -- 1.0006943908064445 -1.9958328996351784 0.9951633403527971 1.9958383335011358 -0.9958522972932842
input 0 peq 3 bypass off
input 1 peq 3 set -- 1.0006943908064445 -1.9958328996351784 0.9951633403527971 1.9958383335011358 -0.9958522972932842
input 1 peq 3 bypass off
input 2 peq 3 set -- 1.0006943908064445 -1.9958328996351784 0.9951633403527971 1.9958383335011358 -0.9958522972932842
input 2 peq 3 bypass off
input 3 peq 3 set -- 1.0006943908064445 -1.9958328996351784 0.9951633403527971 1.9958383335011358 -0.9958522972932842
input 3 peq 3 bypass off
input 4 peq 3 set -- 1.0006943908064445 -1.9958328996351784 0.9951633403527971 1.9958383335011358 -0.9958522972932842
input 4 peq 3 bypass off
input 5 peq 3 set -- 1.0006943908064445 -1.9958328996351784 0.9951633403527971 1.9958383335011358 -0.9958522972932842
input 5 peq 3 bypass off
input 6 peq 3 set -- 1.0006943908064445 -1.9958328996351784 0.9951633403527971 1.9958383335011358 -0.9958522972932842
input 6 peq 3 bypass off
input 7 peq 3 set -- 1.0006943908064445 -1.9958328996351784 0.9951633403527971 1.9958383335011358 -0.9958522972932842
input 7 peq 3 bypass off
input 0 peq 4 set -- 1.0006943908064445 -1.9958328996351784 0.9951633403527971 1.9958383335011358 -0.9958522972932842
input 0 peq 4 bypass off
input 1 peq 4 set -- 1.0006943908064445 -1.9958328996351784 0.9951633403527971 1.9958383335011358 -0.9958522972932842
input 1 peq 4 bypass off
input 2 peq 4 set -- 1.0006943908064445 -1.9958328996351784 0.9951633403527971 1.9958383335011358 -0.9958522972932842
input 2 peq 4 bypass off
input 3 peq 4 set -- 1.0006943908064445 -1.9958328996351784 0.9951633403527971 1.9958383335011358 -0.9958522972932842
input 3 peq 4 bypass off
input 4 peq 4 set -- 1.0006943908064445 -1.9958328996351784 0.9951633403527971 1.9958383335011358 -0.9958522972932842
input 4 peq 4 bypass off
input 5 peq 4 set -- 1.0006943908064445 -1.9958328996351784 0.9951633403527971 1.9958383335011358 -0.9958522972932842
input 5 peq 4 bypass off
input 6 peq 4 set -- 1.0006943908064445 -1.9958328996351784 0.9951633403527971 1.9958383335011358 -0.9958522972932842
input 6 peq 4 bypass off
input 7 peq 4 set -- 1.0006943908064445 -1.9958328996351784 0.9951633403527971 1.9958383335011358 -0.9958522972932842
input 7 peq 4 bypass off
input 0 peq 5 bypass on
input 1 peq 5 bypass on
input 2 peq 5 bypass on
input 3 peq 5 bypass on
input 4 peq 5 bypass on
input 5 peq 5 bypass on
input 6 peq 5 bypass on
input 7 peq 5 bypass on
output 0 crossover 1 0 bypass on
output 1 crossover 1 0 bypass on
output 2 crossover 1 0 bypass on
output 3 crossover 1 0 bypass on
output 4 crossover 1 0 bypass on
output 5 crossover 1 0 bypass on
output 6 crossover 1 0 bypass on
output 7 crossover 1 0 bypass on
output 0 crossover 1 1 bypass on
output 1 crossover 1 1 bypass on
output 2 crossover 1 1 bypass on
output 3 crossover 1 1 bypass on
output 4 crossover 1 1 bypass on
output 5 crossover 1 1 bypass on
output 6 crossover 1 1 bypass on
output 7 crossover 1 1 bypass on
output 0 crossover 1 2 bypass on
output 1 crossover 1 2 bypass on
output 2 crossover 1 2 bypass on
output 3 crossover 1 2 bypass on
output 4 crossover 1 2 bypass on
output 5 crossover 1 2 bypass on
output 6 crossover 1 2 bypass on
output 7 crossover 1 2 bypass on
output 0 crossover 1 3 bypass on
output 1 crossover 1 3 bypass on
output 2 crossover 1 3 bypass on
output 3 crossover 1 3 bypass on
output 4 crossover 1 3 bypass on
output 5 crossover 1 3 bypass on
output 6 crossover 1 3 bypass on
output 7 crossover 1 3 bypass on"""
        assert '\n'.join(cmds) == expected_commands
    else:
        assert r.status_code == 400
        cmds = config.spy.take_commands()
        assert not cmds
    slots = verify_master_device_state(r.json)
    for idx, s in enumerate(slots):
        slot_is_active = idx + 1 == slot if is_valid else idx == 0
        if is_valid and idx + 1 == slot:
            verify_slot(s, idx + 1, active=slot_is_active, last='Alien Resurrection', gain=[0.0] * 8, mute=[False] * 8)
        else:
            verify_slot(s, idx + 1, active=slot_is_active, gain=[0.0] * 8, mute=[False] * 8)

    if is_valid:
        r = minidsp_10x10xo1_client.delete(f"/api/1/devices/master/filter/{slot}")
        assert r.status_code == 200
        cmds = config.spy.take_commands()
        assert len(cmds) == 96
        expected_commands = f"""input 0 peq 0 bypass on
input 1 peq 0 bypass on
input 2 peq 0 bypass on
input 3 peq 0 bypass on
input 4 peq 0 bypass on
input 5 peq 0 bypass on
input 6 peq 0 bypass on
input 7 peq 0 bypass on
input 0 peq 1 bypass on
input 1 peq 1 bypass on
input 2 peq 1 bypass on
input 3 peq 1 bypass on
input 4 peq 1 bypass on
input 5 peq 1 bypass on
input 6 peq 1 bypass on
input 7 peq 1 bypass on
input 0 peq 2 bypass on
input 1 peq 2 bypass on
input 2 peq 2 bypass on
input 3 peq 2 bypass on
input 4 peq 2 bypass on
input 5 peq 2 bypass on
input 6 peq 2 bypass on
input 7 peq 2 bypass on
input 0 peq 3 bypass on
input 1 peq 3 bypass on
input 2 peq 3 bypass on
input 3 peq 3 bypass on
input 4 peq 3 bypass on
input 5 peq 3 bypass on
input 6 peq 3 bypass on
input 7 peq 3 bypass on
input 0 peq 4 bypass on
input 1 peq 4 bypass on
input 2 peq 4 bypass on
input 3 peq 4 bypass on
input 4 peq 4 bypass on
input 5 peq 4 bypass on
input 6 peq 4 bypass on
input 7 peq 4 bypass on
input 0 peq 5 bypass on
input 1 peq 5 bypass on
input 2 peq 5 bypass on
input 3 peq 5 bypass on
input 4 peq 5 bypass on
input 5 peq 5 bypass on
input 6 peq 5 bypass on
input 7 peq 5 bypass on
output 0 crossover 1 0 bypass on
output 1 crossover 1 0 bypass on
output 2 crossover 1 0 bypass on
output 3 crossover 1 0 bypass on
output 4 crossover 1 0 bypass on
output 5 crossover 1 0 bypass on
output 6 crossover 1 0 bypass on
output 7 crossover 1 0 bypass on
output 0 crossover 1 1 bypass on
output 1 crossover 1 1 bypass on
output 2 crossover 1 1 bypass on
output 3 crossover 1 1 bypass on
output 4 crossover 1 1 bypass on
output 5 crossover 1 1 bypass on
output 6 crossover 1 1 bypass on
output 7 crossover 1 1 bypass on
output 0 crossover 1 2 bypass on
output 1 crossover 1 2 bypass on
output 2 crossover 1 2 bypass on
output 3 crossover 1 2 bypass on
output 4 crossover 1 2 bypass on
output 5 crossover 1 2 bypass on
output 6 crossover 1 2 bypass on
output 7 crossover 1 2 bypass on
output 0 crossover 1 3 bypass on
output 1 crossover 1 3 bypass on
output 2 crossover 1 3 bypass on
output 3 crossover 1 3 bypass on
output 4 crossover 1 3 bypass on
output 5 crossover 1 3 bypass on
output 6 crossover 1 3 bypass on
output 7 crossover 1 3 bypass on
input 0 mute off
input 0 gain -- 0.00
input 1 mute off
input 1 gain -- 0.00
input 2 mute off
input 2 gain -- 0.00
input 3 mute off
input 3 gain -- 0.00
input 4 mute off
input 4 gain -- 0.00
input 5 mute off
input 5 gain -- 0.00
input 6 mute off
input 6 gain -- 0.00
input 7 mute off
input 7 gain -- 0.00"""
        assert '\n'.join(cmds) == expected_commands
        slots = verify_master_device_state(r.json)
        for idx, s in enumerate(slots):
            slot_is_active = idx + 1 == slot if is_valid else idx == 0
            verify_slot(s, idx + 1, active=slot_is_active, gain=[0.0] * 8, mute=[False] * 8)


@pytest.mark.parametrize("v", [1, 2])
def test_patch_multiple_fields(minidsp_client, minidsp_app, v):
    config: MinidspSpyConfig = minidsp_app.config['APP_CONFIG']
    assert isinstance(config, MinidspSpyConfig)
    # when: set master gain
    # and: set input gains
    gains = {'gain1': 5.1, 'gain2': 6.1} if v == 1 else {'gains': [5.1, 6.1]}
    payload = {
        'masterVolume': -10.2,
        'mute': True,
        'slots': [
            {
                'id': '2',
                **gains
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
        if idx + 1 == 2:
            verify_slot(s, idx + 1, active=True, gain=(5.10, 6.10))
        else:
            verify_slot(s, idx + 1)


@pytest.mark.parametrize("v", [1, 2])
def test_patch_multiple_slots(minidsp_client, minidsp_app, v):
    config: MinidspSpyConfig = minidsp_app.config['APP_CONFIG']
    assert isinstance(config, MinidspSpyConfig)
    # when: set master gain
    # and: set input gains
    g1 = {'gain1': 5.1, 'gain2': 6.1} if v == 1 else {'gains': [5.1, 6.1]}
    g2 = {'gain1': -1.1, 'gain2': -1.1, 'mute1': False, 'mute2': False} if v == 1 else {'gains': [-1.1, -1.1], 'mutes': [False]*2}
    payload = {
        'masterVolume': -10.2,
        'slots': [
            {
                'id': '2',
                **g1
            },
            {
                'id': '3',
                'entry': '123456_0',
                **g2
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
input 1 peq 0 set -- 1.0003468763586854 -1.9979191385126602 0.9975784764805841 1.9979204983896346 -0.9979239929622952
input 1 peq 0 bypass off
input 0 peq 1 set -- 1.0003468763586854 -1.9979191385126602 0.9975784764805841 1.9979204983896346 -0.9979239929622952
input 0 peq 1 bypass off
input 1 peq 1 set -- 1.0003468763586854 -1.9979191385126602 0.9975784764805841 1.9979204983896346 -0.9979239929622952
input 1 peq 1 bypass off
input 0 peq 2 set -- 1.0003468763586854 -1.9979191385126602 0.9975784764805841 1.9979204983896346 -0.9979239929622952
input 0 peq 2 bypass off
input 1 peq 2 set -- 1.0003468763586854 -1.9979191385126602 0.9975784764805841 1.9979204983896346 -0.9979239929622952
input 1 peq 2 bypass off
input 0 peq 3 set -- 1.0003468763586854 -1.9979191385126602 0.9975784764805841 1.9979204983896346 -0.9979239929622952
input 0 peq 3 bypass off
input 1 peq 3 set -- 1.0003468763586854 -1.9979191385126602 0.9975784764805841 1.9979204983896346 -0.9979239929622952
input 1 peq 3 bypass off
input 0 peq 4 set -- 1.0003468763586854 -1.9979191385126602 0.9975784764805841 1.9979204983896346 -0.9979239929622952
input 0 peq 4 bypass off
input 1 peq 4 set -- 1.0003468763586854 -1.9979191385126602 0.9975784764805841 1.9979204983896346 -0.9979239929622952
input 1 peq 4 bypass off
input 0 peq 5 bypass on
input 1 peq 5 bypass on
input 0 peq 6 bypass on
input 1 peq 6 bypass on
input 0 peq 7 bypass on
input 1 peq 7 bypass on
input 0 peq 8 bypass on
input 1 peq 8 bypass on
input 0 peq 9 bypass on
input 1 peq 9 bypass on
gain -- -10.20"""
    assert '\n'.join(cmds) == expected_commands

    # and: device state is accurate
    slots = verify_master_device_state(r.json, gain=-10.2)
    for idx, s in enumerate(slots):
        if idx == 1:
            verify_slot(s, idx + 1, gain=(5.10, 6.10))
        elif idx == 2:
            verify_slot(s, idx + 1, active=True, gain=(-1.1, -1.1), last='Alien Resurrection')
        else:
            verify_slot(s, idx + 1)


def test_reload_from_cache(minidsp_client, tmp_path):
    from ezbeq.minidsp import MinidspState, Minidsp24HD
    expected = MinidspState('master', Minidsp24HD())
    expected.update_master_state(True, -5.4)
    slot = expected.get_slot('2')
    slot.mute(None)
    slot.gains[0] = 4.8
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
            verify_slot(s, idx + 1, active=True, gain=(4.8, 0.0), mute=(True, True), last='Testing')
        else:
            verify_slot(s, idx + 1)


@pytest.mark.parametrize("outputs",
                         [[], [1], [2], [3], [4], [1, 2], [1, 3], [1, 4], [2, 3], [2, 4], [3, 4], [1, 2, 3], [1, 2, 4],
                          [1, 3, 4], [2, 3, 4], [1, 2, 3, 4]], ids=str)
@pytest.mark.parametrize("inputs", [[], [1], [2], [1, 2]], ids=str)
@pytest.mark.parametrize("slot,is_valid", [(0, False), (1, True), (2, True), (3, True), (4, True), (5, False)])
def test_load_custom_biquads(minidsp_client, minidsp_app, slot, is_valid, inputs, outputs):
    config: MinidspSpyConfig = minidsp_app.config['APP_CONFIG']
    assert isinstance(config, MinidspSpyConfig)
    # when: load biquads
    biquads = """
biquad1,
b0=1.0002465879245352,
b1=-1.9989127232747768,
b2=0.9986691478494831,
a1=1.9989135168404932,
a2=-0.998914942208302,
biquad2,
b0=1.0002465879245352,
b1=-1.9989127232747768,
b2=0.9986691478494831,
a1=1.9989135168404932,
a2=-0.998914942208302,
biquad3,
b0=1.0002465879245352,
b1=-1.9989127232747768,
b2=0.9986691478494831,
a1=1.9989135168404932,
a2=-0.998914942208302,
biquad4,
b0=1.0002465879245352,
b1=-1.9989127232747768,
b2=0.9986691478494831,
a1=1.9989135168404932,
a2=-0.998914942208302,
biquad5,
b0=1.0002465879245352,
b1=-1.9989127232747768,
b2=0.9986691478494831,
a1=1.9989135168404932,
a2=-0.998914942208302,
biquad6,
b0=1.0005426820797225,
b1=-1.9979198828450513,
b2=0.9973892456913641,
a1=1.9979233065003874,
a2=-0.9979285041157505,
biquad7,
b0=1.0005426820797225,
b1=-1.9979198828450513,
b2=0.9973892456913641,
a1=1.9979233065003874,
a2=-0.9979285041157505,
biquad8,
b0=1.0008712609026622,
b1=-1.996065923472451,
b2=0.9952168257035099,
a1=1.996065923472451,
a2=-0.9960880866061722,
biquad9,
b0=1.0,
b1=0.0,
b2=0.0,
a1=-0.0,
a2=-0.0,
biquad10,
b0=1.0,
b1=0.0,
b2=0.0,
a1=-0.0,
a2=-0.0"""
    payload = {
        'overwrite': False,
        'inputs': inputs,
        'outputs': outputs,
        'slot': str(slot),
        'biquads': biquads
    }
    r = minidsp_client.put(f"/api/1/devices/master/biquads", data=json.dumps(payload), content_type='application/json')
    if is_valid:
        assert r.status_code == 200
        single_channel_cmds = [
            'peq 0 set -- 1.0002465879245352 -1.9989127232747768 0.9986691478494831 1.9989135168404932 -0.998914942208302',
            'peq 0 bypass off',
            'peq 1 set -- 1.0002465879245352 -1.9989127232747768 0.9986691478494831 1.9989135168404932 -0.998914942208302',
            'peq 1 bypass off',
            'peq 2 set -- 1.0002465879245352 -1.9989127232747768 0.9986691478494831 1.9989135168404932 -0.998914942208302',
            'peq 2 bypass off',
            'peq 3 set -- 1.0002465879245352 -1.9989127232747768 0.9986691478494831 1.9989135168404932 -0.998914942208302',
            'peq 3 bypass off',
            'peq 4 set -- 1.0002465879245352 -1.9989127232747768 0.9986691478494831 1.9989135168404932 -0.998914942208302',
            'peq 4 bypass off',
            'peq 5 set -- 1.0005426820797225 -1.9979198828450513 0.9973892456913641 1.9979233065003874 -0.9979285041157505',
            'peq 5 bypass off',
            'peq 6 set -- 1.0005426820797225 -1.9979198828450513 0.9973892456913641 1.9979233065003874 -0.9979285041157505',
            'peq 6 bypass off',
            'peq 7 set -- 1.0008712609026622 -1.996065923472451 0.9952168257035099 1.996065923472451 -0.9960880866061722',
            'peq 7 bypass off',
            'peq 8 set -- 1.0 0.0 0.0 -0.0 -0.0',
            'peq 8 bypass off',
            'peq 9 set -- 1.0 0.0 0.0 -0.0 -0.0',
            'peq 9 bypass off'
        ]

        def expand(prefix, channels):
            return [f"{prefix} {c - 1} {l}" for c in channels for l in single_channel_cmds]

        expected_commands = []
        if inputs:
            expected_commands += expand('input', inputs)
        if outputs:
            expected_commands += expand('output', outputs)

        total_channel_count = len(inputs) + len(outputs)
        # then: expected commands are sent
        cmds = verify_cmd_count(config.spy, slot, 20 * total_channel_count)
        assert cmds == expected_commands

        # and: device state is accurate
        slots = verify_master_device_state(r.json)
        for idx, s in enumerate(slots):
            if idx == slot - 1:
                if inputs:
                    verify_slot(s, idx + 1, active=True, last='CUSTOM')
                else:
                    verify_slot(s, idx + 1, active=True)
            else:
                verify_slot(s, idx + 1)
    else:
        assert r.status_code == 400


def test_load_single_biquad(minidsp_client, minidsp_app):
    config: MinidspSpyConfig = minidsp_app.config['APP_CONFIG']
    assert isinstance(config, MinidspSpyConfig)
    # when: load biquads
    biquads = """
biquad1,
b0=1.0002465879245352,
b1=-1.9989127232747768,
b2=0.9986691478494831,
a1=1.9989135168404932,
a2=-0.998914942208302,
"""
    payload = {
        'overwrite': True,
        'inputs': [],
        'outputs': [1],
        'slot': '1',
        'biquads': biquads
    }
    r = minidsp_client.put(f"/api/1/devices/master/biquads", data=json.dumps(payload), content_type='application/json')
    assert r.status_code == 200
    single_channel_cmds = [
        'peq 0 set -- 1.0002465879245352 -1.9989127232747768 0.9986691478494831 1.9989135168404932 -0.998914942208302',
        'peq 0 bypass off',
        'peq 1 bypass on',
        'peq 2 bypass on',
        'peq 3 bypass on',
        'peq 4 bypass on',
        'peq 5 bypass on',
        'peq 6 bypass on',
        'peq 7 bypass on',
        'peq 8 bypass on',
        'peq 9 bypass on'
    ]

    expected_commands = [f"output 0 {l}" for l in single_channel_cmds]
    # then: expected commands are sent
    cmds = verify_cmd_count(config.spy, 1, 11)
    assert cmds == expected_commands

    # and: device state is accurate
    slots = verify_master_device_state(r.json)
    for idx, s in enumerate(slots):
        if idx == 0:
            verify_slot(s, idx + 1, active=True)
        else:
            verify_slot(s, idx + 1)


@pytest.mark.parametrize('filter_idx', range(1, 11, 1))
def test_load_single_filter(minidsp_client, minidsp_app, filter_idx):
    config: MinidspSpyConfig = minidsp_app.config['APP_CONFIG']
    assert isinstance(config, MinidspSpyConfig)
    # when: load filter
    filters = f"Filter {filter_idx}: ON PK Fc 250.0 Hz Gain -3.2 dB Q 1.4"
    payload = {
        'overwrite': False,
        'inputs': [],
        'outputs': [2],
        'slot': '1',
        'commandType': 'filt',
        'commands': filters
    }
    r = minidsp_client.put(f"/api/1/devices/master/commands", data=json.dumps(payload), content_type='application/json')
    assert r.status_code == 200
    single_channel_cmds = [
        f"peq {filter_idx-1} set -- 0.9978500923871526 -1.9857813617501132 0.9881971257952954 1.9857813617501132 -0.9860472181824479",
        f"peq {filter_idx-1} bypass off"
    ]

    expected_commands = [f"output 1 {l}" for l in single_channel_cmds]
    # then: expected commands are sent
    cmds = verify_cmd_count(config.spy, 1, 2)
    assert cmds == expected_commands

    # and: device state is accurate
    slots = verify_master_device_state(r.json)
    for idx, s in enumerate(slots):
        if idx == 0:
            verify_slot(s, idx + 1, active=True)
        else:
            verify_slot(s, idx + 1)


def test_load_single_command(minidsp_client, minidsp_app):
    config: MinidspSpyConfig = minidsp_app.config['APP_CONFIG']
    assert isinstance(config, MinidspSpyConfig)
    # when: load command
    commands = f"gain -- -20"
    payload = {
        'overwrite': False,
        'inputs': [],
        'outputs': [2],
        'slot': '1',
        'commandType': 'rs',
        'commands': commands
    }
    r = minidsp_client.put(f"/api/1/devices/master/commands", data=json.dumps(payload), content_type='application/json')
    assert r.status_code == 200

    expected_commands = f"output 1 {commands}"
    # then: expected commands are sent
    cmds = verify_cmd_count(config.spy, 1, 1)
    assert cmds == [expected_commands]

    # and: device state is accurate
    slots = verify_master_device_state(r.json)
    for idx, s in enumerate(slots):
        if idx == 0:
            verify_slot(s, idx + 1, active=True)
        else:
            verify_slot(s, idx + 1)


def test_load_multi_command(minidsp_client, minidsp_app):
    config: MinidspSpyConfig = minidsp_app.config['APP_CONFIG']
    assert isinstance(config, MinidspSpyConfig)
    # when: load command
    commands = ['gain -- -20', 'mute off', 'delay 15']
    payload = {
        'overwrite': False,
        'inputs': [],
        'outputs': [2],
        'slot': '1',
        'commandType': 'rs',
        'commands': '\n'.join(commands)
    }
    r = minidsp_client.put(f"/api/1/devices/master/commands", data=json.dumps(payload), content_type='application/json')
    assert r.status_code == 200

    expected_commands = [f"output 1 {l}" for l in commands]
    # then: expected commands are sent
    cmds = verify_cmd_count(config.spy, 1, 3)
    assert cmds == expected_commands

    # and: device state is accurate
    slots = verify_master_device_state(r.json)
    for idx, s in enumerate(slots):
        if idx == 0:
            verify_slot(s, idx + 1, active=True)
        else:
            verify_slot(s, idx + 1)


def test_load_multi_filter(minidsp_client, minidsp_app):
    config: MinidspSpyConfig = minidsp_app.config['APP_CONFIG']
    assert isinstance(config, MinidspSpyConfig)
    # when: load filter
    payload = {
        'overwrite': False,
        'inputs': [],
        'outputs': [2],
        'slot': '1',
        'commandType': 'filt',
        'commands': """Filter 4: ON PK Fc 250.0 Hz Gain -3.2 dB Q 1.4
Filter 9: OFF LS Fc 15.1 Hz Gain -3.2 dB Q 0.7
Filter 1: ON HS Fc 25.1 Hz Gain 4.2 dB Q 0.8
"""
    }
    r = minidsp_client.put(f"/api/1/devices/master/commands", data=json.dumps(payload), content_type='application/json')
    assert r.status_code == 200
    single_channel_cmds = [
        f"peq 0 set -- 1.6214064557154642 -3.2398617384986976 1.6184587156869308 1.9976818965843317 -0.997685329488029",
        f"peq 0 bypass off",
        f"peq 3 set -- 0.9978500923871526 -1.9857813617501132 0.9881971257952954 1.9857813617501132 -0.9860472181824479",
        f"peq 3 bypass off",
        f"peq 8 set -- 0.9998697905301912 -1.9984521459514417 0.9985831671951465 1.9984519651532529 -0.998453138523527",
        f"peq 8 bypass on",
    ]

    expected_commands = [f"output 1 {l}" for l in single_channel_cmds]
    # then: expected commands are sent
    cmds = verify_cmd_count(config.spy, 1, 6)
    assert cmds == expected_commands

    # and: device state is accurate
    slots = verify_master_device_state(r.json)
    for idx, s in enumerate(slots):
        if idx == 0:
            verify_slot(s, idx + 1, active=True)
        else:
            verify_slot(s, idx + 1)


def test_load_multi_filter_overwrite(minidsp_client, minidsp_app):
    config: MinidspSpyConfig = minidsp_app.config['APP_CONFIG']
    assert isinstance(config, MinidspSpyConfig)
    # when: load filter
    payload = {
        'overwrite': True,
        'inputs': [],
        'outputs': [2],
        'slot': '1',
        'commandType': 'filt',
        'commands': """Filter 4: ON PK Fc 250.0 Hz Gain -3.2 dB Q 1.4
Filter 9: ON LS Fc 15.1 Hz Gain -3.2 dB Q 0.7
Filter 1: ON HS Fc 25.1 Hz Gain 4.2 dB Q 0.8
"""
    }
    r = minidsp_client.put(f"/api/1/devices/master/commands", data=json.dumps(payload), content_type='application/json')
    assert r.status_code == 200
    single_channel_cmds = [
        f"peq 0 set -- 1.6214064557154642 -3.2398617384986976 1.6184587156869308 1.9976818965843317 -0.997685329488029",
        f"peq 0 bypass off",
        f"peq 1 bypass on",
        f"peq 2 bypass on",
        f"peq 3 set -- 0.9978500923871526 -1.9857813617501132 0.9881971257952954 1.9857813617501132 -0.9860472181824479",
        f"peq 3 bypass off",
        f"peq 4 bypass on",
        f"peq 5 bypass on",
        f"peq 6 bypass on",
        f"peq 7 bypass on",
        f"peq 8 set -- 0.9998697905301912 -1.9984521459514417 0.9985831671951465 1.9984519651532529 -0.998453138523527",
        f"peq 8 bypass off",
        f"peq 9 bypass on"
    ]

    expected_commands = [f"output 1 {l}" for l in single_channel_cmds]
    # then: expected commands are sent
    cmds = verify_cmd_count(config.spy, 1, 13)
    assert cmds == expected_commands

    # and: device state is accurate
    slots = verify_master_device_state(r.json)
    for idx, s in enumerate(slots):
        if idx == 0:
            verify_slot(s, idx + 1, active=True)
        else:
            verify_slot(s, idx + 1)


@pytest.mark.parametrize('endpoint', ['details', 'filters'])
def test_get_by_digest(minidsp_client, minidsp_app, endpoint):
    r = minidsp_client.get(f"/api/1/catalogue/abcdefghijklm/{endpoint}")
    assert r.status_code == 200
    entry = r.json
    assert entry
    assert entry['digest'] == 'abcdefghijklm'
    assert entry['title'] == 'Alien Resurrection'


@pytest.mark.parametrize('endpoint', ['details', 'filters'])
def test_get_by_digest_404(minidsp_client, minidsp_app, endpoint):
    r = minidsp_client.get(f"/api/1/catalogue/abcdefghijkl/{endpoint}")
    assert r.status_code == 404


@pytest.mark.parametrize('dt,exp', [
    ('24HD', 'Minidsp24HD'),
    ('DDRC24', 'MinidspDDRC24'),
    ('DDRC88', 'MinidspDDRC88'),
    ('4x10', 'Minidsp410'),
    ('10x10', 'Minidsp1010'),
    ('10x10xo', 'Minidsp1010'),
    ('SHD', 'MinidspDDRC24'),
])
def test_cfg_makes_known_minidsp(dt, exp):
    cfg = {'device_type': dt}
    if dt == '10x10xo':
        cfg['device_type'] = '10x10'
        cfg['use_xo'] = True
    desc = import_md().make_peq_layout(cfg)
    assert desc
    assert desc.__class__.__name__ == exp


def import_md():
    import importlib
    try:
        md = importlib.import_module('minidsp')
    except ModuleNotFoundError:
        md = importlib.import_module('ezbeq.minidsp')
    return md


def test_cfg_customise_ddrc88_sw():
    cfg = {'device_type': 'DDRC88', 'sw_channels': [1, 2, 6]}
    desc = import_md().make_peq_layout(cfg)
    assert desc
    assert desc.__class__.__name__ == 'MinidspDDRC88'
    allocator = desc.to_allocator()
    assert len(allocator) == 10
    for i in range(0, 10):
        s = allocator.pop()
        assert s
        assert s.name == 'output'
        assert s.idx == i
        assert s.channels == [1, 2, 6]
        assert s.group is None


def test_cfg_makes_custom_minidsp():
    cfg = {'descriptor': {
        'name': 'mine',
        'fs': 48000,
        'routes': [
            {
                'name': 'input',
                'biquads': 5,
                'channels': [1, 2, 8],
                'slots': [0, 1, 2]
            },
            {
                'name': 'output',
                'biquads': 2,
                'channels': [1, 2, 3],
                'slots': [0, 1]
            },
            {
                'name': 'crossover',
                'biquads': 4,
                'channels': [1],
                'slots': [1, 2],
                'groups': [0, 1]
            }
        ]
    }}
    desc = import_md().make_peq_layout(cfg)
    assert desc
    assert desc.__class__.__name__ == 'MinidspDescriptor'
    assert desc.name == 'mine'
    assert desc.fs == '48000'
    assert len(desc.peq_routes) == 3
    assert desc.peq_routes[0].name == 'input'
    assert desc.peq_routes[0].biquads == 5
    assert desc.peq_routes[0].channels == [1, 2, 8]
    assert desc.peq_routes[0].beq_slots == [0, 1, 2]
    assert not desc.peq_routes[0].groups
    assert desc.peq_routes[1].name == 'crossover'
    assert desc.peq_routes[1].biquads == 4
    assert desc.peq_routes[1].channels == [1]
    assert desc.peq_routes[1].beq_slots == [1, 2]
    assert desc.peq_routes[1].groups == [0, 1]
    assert desc.peq_routes[2].name == 'output'
    assert desc.peq_routes[2].biquads == 2
    assert desc.peq_routes[2].channels == [1, 2, 3]
    assert desc.peq_routes[2].beq_slots == [0, 1]
    assert not desc.peq_routes[2].groups
