import json

import pytest
from busypie import wait, SECOND, MILLISECOND

from conftest import CamillaDspSpyConfig, CamillaDspSpy


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

    wait().at_most(2 * SECOND).poll_interval(10 * MILLISECOND).with_description('volume_changed').until_asserted(volume_changed)

    def ui_updated():
        device_states = take_device_states(config)
        assert device_states[-1]['masterVolume'] == volume

    wait().at_most(2 * SECOND).poll_interval(10 * MILLISECOND).with_description('ui_updated').until_asserted(ui_updated)


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
