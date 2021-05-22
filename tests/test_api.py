import json
from typing import Tuple

import pytest

from conftest import MinidspSpyConfig


def verify_slot(slot: dict, idx: int, active: bool = False, gain: Tuple[str, str] = ('0.0', '0.0'),
                mute: Tuple[bool, bool] = (False, False), last: str = 'Empty', can_activate: bool = True):
    assert slot['id'] == str(idx)
    assert slot['active'] == active
    assert slot['gain1'] == gain[0]
    assert slot['gain2'] == gain[1]
    assert slot['mute1'] == mute[0]
    assert slot['mute2'] == mute[1]
    assert slot['last'] == last
    assert slot['canActivate'] == can_activate


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
    assert r
    assert r.status_code == 200
    cmds = config.spy.take_commands()
    assert len(cmds) == 3
    assert cmds[0] == f"config {slot - 1}"
    assert cmds[1] == f"input 0 mute {mute_op}"
    assert cmds[2] == f"input 1 mute {mute_op}"
    slots = verify_master_device_state(r.json)
    for idx, s in enumerate(slots):
        if idx == slot - 1:
            verify_slot(s, idx + 1, active=True, mute=(True, True) if mute_op == 'on' else (False, False))
        else:
            verify_slot(s, idx + 1)


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
    assert r
    assert r.status_code == 200
    cmds = config.spy.take_commands()
    assert len(cmds) == 2
    assert cmds[0] == f"config {slot - 1}"
    assert cmds[1] == f"input {channel - 1} mute {mute_op}"
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
    assert r
    assert r.status_code == 200
    cmds = config.spy.take_commands()
    assert len(cmds) == 1
    assert cmds[0] == f"mute {mute_op}"
    slots = verify_master_device_state(r.json, mute=True if mute_op == 'on' else False)
    for idx, s in enumerate(slots):
        verify_slot(s, idx + 1)

