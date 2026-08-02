"""
Frontend/backend contract check.

ui/src/services/ezbeq.js hand-builds the JSON payloads sent to PATCH /api/3/devices/<name> -
buildTargetedPayload and createPatchPayload duplicate the field names of this API's
slot_model_v3/device_model_v3 (ezbeq/apis/devices.py) by hand, with nothing that cross-checks
the two ever agree. ui/src/services/ezbeq.test.js asserts those builders produce these exact
shapes, but only against the JS's own expectations - it never touches this backend, so a field
rename on either side would leave both test suites green.

Each payload below is copied verbatim from a ui/src/services/ezbeq.test.js case and sent
through the real Flask app (minidsp_client - the same fixture the rest of this file's sibling
tests use), so a schema drift shows up here even though the two languages' test suites can't
see each other.
"""
import json

from conftest import MinidspSpyConfig


def test_master_gain_payload(minidsp_client, minidsp_app):
    """buildTargetedPayload('master', 'mv', '-15.5', '1') -> {masterVolume: -15.5}"""
    payload = {'masterVolume': -15.5}
    r = minidsp_client.patch('/api/3/devices/master', data=json.dumps(payload), content_type='application/json')
    assert r.status_code == 200
    assert r.json['masterVolume'] == -15.5


def test_master_mute_payload(minidsp_client, minidsp_app):
    """buildTargetedPayload('master', 'mute', true, '1') -> {mute: true}"""
    payload = {'mute': True}
    r = minidsp_client.patch('/api/3/devices/master', data=json.dumps(payload), content_type='application/json')
    assert r.status_code == 200
    assert r.json['mute'] is True


def test_input_channel_gain_payload(minidsp_client, minidsp_app):
    """buildTargetedPayload('2', 'mv', '-3.5', '1') -> {slots: [{id: '1', gains: [{id: '2', value: -3.5}]}]}"""
    payload = {'slots': [{'id': '1', 'gains': [{'id': '2', 'value': -3.5}]}]}
    r = minidsp_client.patch('/api/3/devices/master', data=json.dumps(payload), content_type='application/json')
    assert r.status_code == 200
    slot = next(s for s in r.json['slots'] if s['id'] == '1')
    assert next(g for g in slot['gains'] if g['id'] == '2')['value'] == -3.5


def test_input_channel_mute_payload(minidsp_client, minidsp_app):
    """buildTargetedPayload('2', 'mute', true, '1') -> {slots: [{id: '1', mutes: [{id: '2', value: true}]}]}"""
    payload = {'slots': [{'id': '1', 'mutes': [{'id': '2', 'value': True}]}]}
    r = minidsp_client.patch('/api/3/devices/master', data=json.dumps(payload), content_type='application/json')
    assert r.status_code == 200
    slot = next(s for s in r.json['slots'] if s['id'] == '1')
    assert next(m for m in slot['mutes'] if m['id'] == '2')['value'] is True


def test_output_channel_gain_payload(minidsp_client, minidsp_app):
    """buildTargetedPayload('out_3', 'mv', '-6', '1') -> {slots: [{id: '1', outputGains: [{id: '3', value: -6}]}]}"""
    payload = {'slots': [{'id': '1', 'outputGains': [{'id': '3', 'value': -6}]}]}
    r = minidsp_client.patch('/api/3/devices/master', data=json.dumps(payload), content_type='application/json')
    assert r.status_code == 200
    slot = next(s for s in r.json['slots'] if s['id'] == '1')
    assert next(g for g in slot['outputGains'] if g['id'] == '3')['value'] == -6


def test_output_channel_mute_payload(minidsp_client, minidsp_app):
    """buildTargetedPayload('out_3', 'mute', true, '1') -> {slots: [{id: '1', outputMutes: [{id: '3', value: true}]}]}"""
    payload = {'slots': [{'id': '1', 'outputMutes': [{'id': '3', 'value': True}]}]}
    r = minidsp_client.patch('/api/3/devices/master', data=json.dumps(payload), content_type='application/json')
    assert r.status_code == 200
    slot = next(s for s in r.json['slots'] if s['id'] == '1')
    assert next(m for m in slot['outputMutes'] if m['id'] == '3')['value'] is True


def test_full_slot_gains_and_mutes_payload(minidsp_client, minidsp_app):
    """createPatchPayload(...) with both gains and mutes for a slot in a single request"""
    payload = {'slots': [{
        'id': '1',
        'gains': [{'id': '1', 'value': 0}],
        'mutes': [{'id': '1', 'value': False}]
    }]}
    r = minidsp_client.patch('/api/3/devices/master', data=json.dumps(payload), content_type='application/json')
    assert r.status_code == 200
    slot = next(s for s in r.json['slots'] if s['id'] == '1')
    assert next(g for g in slot['gains'] if g['id'] == '1')['value'] == 0
    assert next(m for m in slot['mutes'] if m['id'] == '1')['value'] is False


def test_output_gains_and_mutes_together_payload(minidsp_client, minidsp_app):
    """createPatchPayload(...) only sets outputGains/outputMutes when they're non-empty"""
    payload = {'slots': [{
        'id': '1',
        'outputGains': [{'id': '1', 'value': -2}],
        'outputMutes': [{'id': '1', 'value': True}]
    }]}
    r = minidsp_client.patch('/api/3/devices/master', data=json.dumps(payload), content_type='application/json')
    assert r.status_code == 200
    slot = next(s for s in r.json['slots'] if s['id'] == '1')
    assert next(g for g in slot['outputGains'] if g['id'] == '1')['value'] == -2
    assert next(m for m in slot['outputMutes'] if m['id'] == '1')['value'] is True


def test_master_only_payload_omits_slots_key(minidsp_client, minidsp_app):
    """createPatchPayload(null, {master_mv: -10}) omits `slots` entirely - the server must accept
    a payload with no slots key at all, not just an empty list"""
    config: MinidspSpyConfig = minidsp_app.config['APP_CONFIG']
    assert isinstance(config, MinidspSpyConfig)
    payload = {'masterVolume': -10}
    r = minidsp_client.patch('/api/3/devices/master', data=json.dumps(payload), content_type='application/json')
    assert r.status_code == 200
    assert r.json['masterVolume'] == -10
    # and nothing was sent to the device for any slot - a master-only change stays master-only
    assert config.spy.take_commands() == ['gain -- -10.00']
