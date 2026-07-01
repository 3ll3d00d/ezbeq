import json

import pytest
from werkzeug import Response

from ezbeq.catalogue import CatalogueEntry
from ezbeq.device import InvalidRequestError
from ezbeq.stormaudio import RatioConfig, SLOT_ID, StormAudio, make_mso_payload


def test_devices(stormaudio_client):
    r = stormaudio_client.get("/api/1/devices")
    assert r
    assert r.status_code == 200
    assert r.json == {
        'type': 'stormaudio',
        'name': 'master',
        'slots': [
            {
                'id': SLOT_ID,
                'last': 'Empty',
                'active': True,
                'author': None
            }
        ]
    }


def test_load_known_entry_posts_mso_payload(stormaudio_client, httpserver):
    requests = expect_mso_post(httpserver, {'ok': True})

    r = stormaudio_client.put(f"/api/1/devices/master/filter/{SLOT_ID}",
                              data=json.dumps({'entryId': '123456_0'}),
                              content_type='application/json')

    assert r.status_code == 200
    assert r.json['slots'][0]['last'] == 'Alien Resurrection'
    assert r.json['slots'][0]['author'] == 'aron7awol'
    assert len(requests) == 1

    payload = requests[0]
    assert payload['global']['profile_name'] == 'New Profile 1'
    assert payload['global']['beq_title'] == 'Alien Resurrection'
    assert payload['global']['beq_year'] == 1997
    assert payload['global']['beq_author'] == 'aron7awol'
    assert payload['global']['beq_digest'] == 'abcdefghijklm'
    assert payload['global']['beq_mv'] == 3.0
    assert len(payload['Sub']) == 2

    eq = payload['Sub'][0]['eq']
    assert len(eq) == 5
    assert eq[0] == {
        'ftype': 'Low Shelf',
        'f': 33.0,
        'g': 2.5,
        'q': 1.8,
    }
    assert payload['Sub'][1]['eq'] == eq


def test_patch_loads_known_entry(stormaudio_client, httpserver):
    requests = expect_mso_post(httpserver, {'ok': True})

    r = stormaudio_client.patch("/api/3/devices/master",
                                data=json.dumps({'slots': [{'id': SLOT_ID, 'entry': '123456_0'}]}),
                                content_type='application/json')

    assert r.status_code == 200
    assert r.json['slots'][0]['last'] == 'Alien Resurrection'
    assert r.json['slots'][0]['author'] == 'aron7awol'
    assert len(requests) == 1


def test_activate_slot(stormaudio_client):
    r = stormaudio_client.put(f"/api/1/devices/master/config/{SLOT_ID}/active")

    assert r.status_code == 200
    assert r.json['slots'][0]['active'] is True


def test_accepts_successful_import_response(stormaudio_client, httpserver):
    requests = expect_mso_post(httpserver, {
        'ok': False,
        'parser': {
            'exit_code': -1,
            'stdout': 'Modifications commitées.',
            'stderr': '',
        }
    })

    r = stormaudio_client.put(f"/api/1/devices/master/filter/{SLOT_ID}",
                              data=json.dumps({'entryId': '123456_0'}),
                              content_type='application/json')

    assert r.status_code == 200
    assert r.json['slots'][0]['last'] == 'Alien Resurrection'
    assert len(requests) == 1


def test_rejects_response_without_ok(stormaudio_client, httpserver):
    requests = expect_mso_post(httpserver, {'error': 'Invalid JSON.'})

    r = stormaudio_client.put(f"/api/1/devices/master/filter/{SLOT_ID}",
                              data=json.dumps({'entryId': '123456_0'}),
                              content_type='application/json')

    assert r.status_code == 500
    assert r.json['slots'][0]['last'] == 'ERROR'
    assert len(requests) == 1


def test_rejects_failed_import_response(stormaudio_client, httpserver):
    requests = expect_mso_post(httpserver, {
        'ok': False,
        'parser': {
            'exit_code': 1,
            'stdout': 'Commit failed: modifications were rejected.',
            'stderr': '',
        }
    })

    r = stormaudio_client.put(f"/api/1/devices/master/filter/{SLOT_ID}",
                              data=json.dumps({'entryId': '123456_0'}),
                              content_type='application/json')

    assert r.status_code == 500
    assert r.json['slots'][0]['last'] == 'ERROR'
    assert len(requests) == 1


def test_rejects_http_error_response(stormaudio_client, httpserver):
    requests = expect_mso_post(httpserver, {'error': 'Request failed.'}, status=500)

    r = stormaudio_client.put(f"/api/1/devices/master/filter/{SLOT_ID}",
                              data=json.dumps({'entryId': '123456_0'}),
                              content_type='application/json')

    assert r.status_code == 500
    assert r.json['slots'][0]['last'] == 'ERROR'
    assert len(requests) == 1


def test_rejects_non_json_response(stormaudio_client, httpserver):
    requests = expect_mso_post_text(httpserver, 'Request failed.')

    r = stormaudio_client.put(f"/api/1/devices/master/filter/{SLOT_ID}",
                              data=json.dumps({'entryId': '123456_0'}),
                              content_type='application/json')

    assert r.status_code == 500
    assert r.json['slots'][0]['last'] == 'ERROR'
    assert len(requests) == 1


def test_patch_rejects_unknown_entry(stormaudio_client):
    r = stormaudio_client.patch("/api/3/devices/master",
                                data=json.dumps({'slots': [{'id': SLOT_ID, 'entry': 'missing'}]}),
                                content_type='application/json')

    assert r.status_code == 400
    assert r.json == {'message': 'Update failed : Unknown catalogue entry missing'}


def test_clear_only_updates_local_state(stormaudio_client, httpserver):
    expect_mso_post(httpserver, {'ok': True})
    r = stormaudio_client.put(f"/api/1/devices/master/filter/{SLOT_ID}",
                              data=json.dumps({'entryId': '123456_0'}),
                              content_type='application/json')
    assert r.status_code == 200

    r = stormaudio_client.delete(f"/api/1/devices/master/filter/{SLOT_ID}")

    assert r.status_code == 200
    assert r.json['slots'][0]['last'] == 'Empty'


def test_make_mso_payload_maps_supported_filter_types_with_ratios():
    entry = CatalogueEntry('manual', {
        'title': 'Manual',
        'year': '2024',
        'audioTypes': ['Atmos'],
        'author': 'tester',
        'catalogue_url': 'https://example.test/beq',
        'digest': 'digest',
        'filters': [
            {'type': 'PeakingEQ', 'freq': 10, 'gain': 2, 'q': 1},
            {'type': 'LowShelf', 'freq': 20, 'gain': 4, 'q': 0.7},
            {'type': 'HighShelf', 'freq': 30, 'gain': -6, 'q': 1.2},
        ],
    })
    ratio = RatioConfig({
        'default': {
            'gain': 2.0,
            'q': 0.5,
        },
        'byType': {
            'LowShelf': {
                'gain': 0.25,
                'q': 2.0,
            },
            'HighShelf': {
                'gain': 0.5,
            }
        }
    })

    payload = make_mso_payload(entry, 'ezBEQ', 3, ratio)

    assert len(payload['Sub']) == 3
    assert payload['Sub'][0]['eq'] == [
        {'ftype': 'Bell', 'f': 10.0, 'g': 4.0, 'q': 0.5},
        {'ftype': 'Low Shelf', 'f': 20.0, 'g': 1.0, 'q': 1.4},
        {'ftype': 'High Shelf', 'f': 30.0, 'g': -3.0, 'q': 0.6},
    ]


def test_make_mso_payload_includes_runtime_mv_adjust():
    entry = CatalogueEntry('manual', {
        'title': 'Manual',
        'mv': '1.5',
        'filters': [
            {'type': 'PeakingEQ', 'freq': 10, 'gain': 0, 'q': 1},
        ],
    })

    payload = make_mso_payload(entry, 'ezBEQ', 1, RatioConfig({}), mv_adjust=2.0)

    assert payload['global']['beq_mv'] == 3.5


def test_filter_boundaries():
    entry = CatalogueEntry('manual', {
        'title': 'Manual',
        'filters': [
            {'type': 'PeakingEQ', 'freq': 1, 'gain': -96, 'q': 0.05},
            {'type': 'PeakingEQ', 'freq': 20000, 'gain': 48, 'q': 32},
        ],
    })

    payload = make_mso_payload(entry, 'ezBEQ', 1, RatioConfig({}))

    assert payload['Sub'][0]['eq'] == [
        {'ftype': 'Bell', 'f': 1.0, 'g': -96.0, 'q': 0.05},
        {'ftype': 'Bell', 'f': 20000.0, 'g': 48.0, 'q': 32.0},
    ]


@pytest.mark.parametrize('field,value', [
    ('freq', 0),
    ('freq', 20001),
    ('gain', -97),
    ('gain', 49),
    ('q', 0.04),
    ('q', 32.1),
])
def test_rejects_filter_values_outside_boundaries(field, value):
    filter_values = {'type': 'PeakingEQ', 'freq': 10, 'gain': 0, 'q': 1}
    filter_values[field] = value
    entry = CatalogueEntry('manual', {
        'title': 'Manual',
        'filters': [filter_values],
    })

    with pytest.raises(InvalidRequestError, match='out of range'):
        make_mso_payload(entry, 'ezBEQ', 1, RatioConfig({}))


def test_rejects_unsupported_filter_type():
    entry = CatalogueEntry('manual', {
        'title': 'Manual',
        'filters': [
            {'type': 'AllPass', 'freq': 10, 'gain': 0, 'q': 1},
        ],
    })

    with pytest.raises(InvalidRequestError):
        make_mso_payload(entry, 'ezBEQ', 1, RatioConfig({}))


def test_rejects_malformed_filter_values():
    entry = CatalogueEntry('manual', {
        'title': 'Manual',
        'filters': [
            {'type': 'PeakingEQ', 'gain': 0, 'q': 1},
        ],
    })

    with pytest.raises(InvalidRequestError, match='invalid values'):
        make_mso_payload(entry, 'ezBEQ', 1, RatioConfig({}))


def test_rejects_too_many_filters():
    entry = CatalogueEntry('manual', {
        'title': 'Manual',
        'filters': [
            {'type': 'PeakingEQ', 'freq': 10 + idx, 'gain': 0, 'q': 1}
            for idx in range(21)
        ],
    })

    with pytest.raises(InvalidRequestError, match='at most 20'):
        make_mso_payload(entry, 'ezBEQ', 1, RatioConfig({}))


def test_rejects_bad_ratio_config():
    with pytest.raises(ValueError, match='greater than 0'):
        RatioConfig({'default': {'q': 0}})

    with pytest.raises(ValueError, match='greater than or equal to 0'):
        RatioConfig({'default': {'gain': -1}})

    with pytest.raises(ValueError, match='Unknown StormAudio ratio filter type'):
        RatioConfig({'byType': {'Gain': {'gain': 1}}})


def test_resolves_url_from_ip_config():
    assert StormAudio._StormAudio__resolve_url({'ip': 'processor.example/'}) == \
        'http://processor.example/mso.php'
    assert StormAudio._StormAudio__resolve_url({'ip': 'https://processor.example/'}) == \
        'https://processor.example/mso.php'
    assert StormAudio._StormAudio__resolve_url({'url': 'http://processor.example/custom'}) == \
        'http://processor.example/custom'


def expect_mso_post(httpserver, body: dict, status: int = 200):
    requests = []

    def handler(request):
        requests.append(request.get_json())
        return Response(json.dumps(body), status=status, content_type='application/json')

    httpserver.expect_request("/mso.php", method="POST").respond_with_handler(handler)
    return requests


def expect_mso_post_text(httpserver, body: str, status: int = 200):
    requests = []

    def handler(request):
        requests.append(request.get_json())
        return Response(body, status=status, content_type='text/plain')

    httpserver.expect_request("/mso.php", method="POST").respond_with_handler(handler)
    return requests
