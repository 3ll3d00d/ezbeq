import json


def test_patch_v3_fans_out_to_every_member_and_members_stay_addressable(composite_mirror_client, composite_mirror_cfg):
    payload = {
        'masterVolume': -6.0,
        'slots': [
            {'id': '1', 'entry': '123456_0', 'active': True}
        ]
    }
    r = composite_mirror_client.patch('/api/3/devices/bass_array', data=json.dumps(payload),
                                      content_type='application/json')
    assert r.status_code == 200
    state = r.json
    assert state['type'] == 'composite'
    assert state['masterVolume'] == -6.0
    assert state['slots'][0]['active'] is True
    assert state['slots'][0]['last'] == 'Alien Resurrection'
    assert set(state['members'].keys()) == {'sub1', 'sub2'}
    for member_state in state['members'].values():
        assert member_state['masterVolume'] == -6.0
        assert member_state['slots'][0]['active'] is True
        assert member_state['slots'][0]['last'] == 'Alien Resurrection'

    for name, spy in composite_mirror_cfg.spies.items():
        cmds = spy.take_commands()
        assert cmds, f'member {name} should have received commands from the composite PATCH'

    # each member is still independently addressable by its own name, even
    # though it's hidden from the /api/2/devices listing by default.
    r = composite_mirror_client.patch('/api/3/devices/sub1', data=json.dumps({'masterVolume': -2.0}),
                                      content_type='application/json')
    assert r.status_code == 200
    assert r.json['masterVolume'] == -2.0
    assert r.json['name'] == 'sub1'

    # and sub2 (untouched by the direct sub1 PATCH above) keeps its own state.
    r = composite_mirror_client.get('/api/1/devices/sub2/levels')
    assert r.status_code == 200


def test_patch_v3_reports_500_and_partial_state_on_member_failure(composite_mirror_client, composite_mirror_cfg):
    # force initial hydration so fail_next lands on the PATCH command itself.
    assert composite_mirror_client.get('/api/2/devices').status_code == 200
    composite_mirror_cfg.spies['sub1'].fail_next = True

    payload = {'mute': True}
    r = composite_mirror_client.patch('/api/3/devices/bass_array', data=json.dumps(payload),
                                      content_type='application/json')
    assert r.status_code == 500
    assert 'sub1' in r.json['message']
    assert composite_mirror_cfg.spies['sub2'].take_commands() == ['mute on']
