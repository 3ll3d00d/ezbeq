"""ShakEQ HTTP adapter tests; no serial port or external ShakEQ service required."""
import json
from types import SimpleNamespace

import pytest
from conftest import CapturingWsServer, ReaperSpyConfig
from werkzeug.wrappers import Response

from ezbeq import main
from ezbeq.catalogue import CatalogueEntry
from ezbeq.device import (
    InvalidRequestError,
    UnableToPatchDeviceError,
    _device_class_for_type,
)
from ezbeq.shakeq import ShakEQ

TOKEN = 'test-token-' + 'x' * 48


def entry(filters=None, title='Test Film'):
    return CatalogueEntry('test-id', {
        'title': title, 'author': 'tester', 'digest': 'digest-1', 'mv': '-3',
        'filters': filters if filters is not None else [
            {'type': 'PeakingEQ', 'freq': 20.5, 'gain': 4, 'q': .7},
            {'type': 'LowShelf', 'freq': 33, 'gain': -2, 'q': .9},
        ],
    })


class HttpServiceSpy:
    """Only the documented BEQ/state HTTP contract, not the service implementation."""

    def __init__(self, httpserver, name='shakeq1'):
        self.name = name
        self.posts = []
        self.state_reads = 0
        self.beq_status = 200
        self.state_status = 200
        self.state_override = None
        self.snapshot = {
            'type': 'shakeq', 'name': name, 'status': 'unknown', 'beq': None,
            'consoleBusy': False,
            'slots': [{'id': 'BEQ', 'active': True, 'last': 'Empty', 'author': None}],
        }
        headers = {'Authorization': 'Bearer ' + TOKEN}
        base = '/api/1/shakeq/' + name
        httpserver.expect_request(base + '/beq', method='POST', headers=headers).respond_with_handler(self.beq)
        httpserver.expect_request(base + '/state', method='GET', headers=headers).respond_with_handler(self.state)

    def state(self, request):
        self.state_reads += 1
        result = self.state_override if self.state_override is not None else self.snapshot
        return Response(json.dumps(result), status=self.state_status, mimetype='application/json')

    def beq(self, request):
        body = request.get_json()
        self.posts.append(body)
        if self.beq_status != 200:
            return Response('{}', status=self.beq_status, mimetype='application/json')
        item = body.get('entry') if body['action'] == 'load' else None
        self.snapshot.update(status='sent', beq=item)
        self.snapshot['slots'][0].update(
            last=item['formatted_title'] if item else 'Empty',
            author=item['author'] if item else None,
        )
        return Response(json.dumps(self.snapshot), mimetype='application/json')


@pytest.fixture
def service(httpserver):
    return HttpServiceSpy(httpserver)


@pytest.fixture
def device(tmp_path, httpserver, service):
    (tmp_path / 'token').write_text(TOKEN)
    return ShakEQ('shakeq1', str(tmp_path), {
        'url': httpserver.url_for('/'), 'tokenFile': 'token',
        'requestTimeout': 3, 'stateTimeout': 1,
    }, CapturingWsServer(), SimpleNamespace(find=lambda key: entry() if key == 'test-id' else None))


def test_registration_load_metadata_state_and_clear(device, service):
    assert _device_class_for_type('shakeq') is ShakEQ
    assert device.SUPPORTED_OPS == {'activate', 'load_filter', 'clear_filter'}
    item = entry(title='Ääni 🎬')
    device.load_filter('BEQ', item, mv_adjust=99)
    assert service.posts == [{'action': 'load', 'entry': {
        'id': item.id, 'digest': item.digest, 'title': item.title,
        'author': item.author, 'formatted_title': item.formatted_title,
        'filters': item.filters, 'mv_adjust': -3.0,
    }}]
    state = device.state().serialise()
    assert state['status'] == 'sent' and state['serviceOnline']
    assert state['stateSource'] == 'service'
    assert state['beq']['title'] == 'Ääni 🎬'
    assert state['slots'][0]['author'] == 'tester'
    messages = [json.loads(message) for message in device.ws_server.take_messages()]
    assert messages[-1]['message'] == 'DeviceState'
    assert messages[-1]['data']['beq']['digest'] == item.digest
    device.clear_filter('BEQ')
    assert service.posts[-1] == {'action': 'clear'}
    state = device.state().serialise()
    assert state['beq'] is None and state['slots'][0]['last'] == 'Empty'


def test_state_only_reads_service_and_activate_is_local(device, service):
    device.state(refresh=True)
    assert service.state_reads == 1 and service.posts == []
    device.activate('BEQ')
    assert device.levels() == {}
    assert service.state_reads == 1 and service.posts == []


def test_restart_reconciles_service_and_persists(device, service, tmp_path, httpserver):
    device.load_filter('BEQ', entry())
    restarted = ShakEQ('shakeq1', str(tmp_path), {
        'url': httpserver.url_for('/'), 'tokenFile': 'token',
    }, CapturingWsServer(), None)
    assert restarted.state().serialise()['beq']['digest'] == 'digest-1'
    assert len(service.posts) == 1
    cached = json.loads((tmp_path / 'shakeq1.json').read_text())
    assert cached['beq']['digest'] == 'digest-1'


@pytest.mark.parametrize('filters', [
    [], [{'type': 'HighShelf', 'freq': 20, 'gain': 1, 'q': 1}],
    [None], [{'type': 1}], [{'type': 'PeakingEQ', 'freq': 20, 'gain': 1}],
    [{'type': 'PeakingEQ', 'freq': False, 'gain': 1, 'q': 1}],
    [{'type': 'PeakingEQ', 'freq': float('nan'), 'gain': 1, 'q': 1}],
    [{'type': 'PeakingEQ', 'freq': 20, 'gain': float('inf'), 'q': 1}],
    [{'type': 'PeakingEQ', 'freq': 20, 'gain': 1, 'q': 0}],
    [{'type': 'PeakingEQ', 'freq': -1, 'gain': 1, 'q': 1}],
])
def test_invalid_filter_never_posts(device, service, filters):
    with pytest.raises(InvalidRequestError):
        device.load_filter('BEQ', entry(filters))
    assert service.posts == []


@pytest.mark.parametrize('operation', ['load', 'clear'])
def test_busy_preserves_previous_beq_without_retry(device, service, operation):
    device.load_filter('BEQ', entry())
    old_state = device.state().serialise()
    service.beq_status = 423
    service.snapshot['consoleBusy'] = True
    with pytest.raises(InvalidRequestError, match='console is busy'):
        if operation == 'load':
            device.load_filter('BEQ', entry(title='Another film'))
        else:
            device.clear_filter('BEQ')
    assert len(service.posts) == 2
    state = device.state().serialise()
    assert state['consoleBusy'] and state['beq'] == old_state['beq']
    assert state['slots'][0]['last'] == old_state['slots'][0]['last']


@pytest.mark.parametrize('status', [401, 500, 503])
def test_service_error_marks_state_unknown_and_does_not_replay(device, service, status):
    service.beq_status = status
    with pytest.raises(OSError, match='no automatic replay'):
        device.load_filter('BEQ', entry())
    assert len(service.posts) == 1
    service.state_status = 503
    state = device.state().serialise()
    assert state['status'] == 'unknown' and not state['serviceOnline']
    assert state['slots'][0]['last'] == 'ERROR'


def test_http_timeout_is_not_replayed(device, monkeypatch):
    calls = []

    def timeout(request, **kwargs):
        calls.append(kwargs['timeout'])
        raise TimeoutError()

    monkeypatch.setattr(device._ShakEQ__opener, 'open', timeout)
    with pytest.raises(OSError, match='no automatic replay'):
        device.clear_filter('BEQ')
    assert calls == [3]
    assert device.state().serialise()['status'] == 'unknown'
    assert calls == [3, 1]


@pytest.mark.parametrize('snapshot', [
    [], {'type': 'other'},
    {'type': 'shakeq', 'name': 'wrong', 'status': 'sent'},
    {'type': 'shakeq', 'name': 'shakeq1', 'status': 'unexpected'},
    {'type': 'shakeq', 'name': 'shakeq1', 'status': 'sent', 'slots': []},
    {'type': 'shakeq', 'name': 'shakeq1', 'status': 'sent', 'slots': [None]},
    {'type': 'shakeq', 'name': 'shakeq1', 'status': 'sent', 'slots': [{'id': 'wrong'}]},
])
def test_invalid_state_response_is_offline(device, service, snapshot):
    service.state_override = snapshot
    state = device.state().serialise()
    assert state['status'] == 'unknown' and not state['serviceOnline']
    assert service.posts == []


def test_different_digest_confirmation_is_an_error(device, service, monkeypatch):
    request = device._ShakEQ__request

    def wrong_digest(route, body=None):
        result = request(route, body)
        if body is not None:
            result['beq']['digest'] = 'another-digest'
        return result

    monkeypatch.setattr(device, '_ShakEQ__request', wrong_digest)
    with pytest.raises(OSError, match='different BEQ'):
        device.load_filter('BEQ', entry())
    assert len(service.posts) == 1


@pytest.mark.parametrize('params', [
    {'mute': False}, {'slots': [{'id': '1', 'entry': 'test-id'}]},
    {'slots': [{'id': 'BEQ', 'active': False}]},
    {'slots': [{'id': 'BEQ', 'entry': 'missing'}]},
    {'slots': [{'id': 'BEQ', 'gain': 1}]},
    {'slots': [{'id': 'BEQ'}, {'id': 'BEQ'}]},
])
def test_unsupported_patch(device, service, params):
    with pytest.raises(UnableToPatchDeviceError) as error:
        device.update(params)
    assert error.value.code == 400 and service.posts == []


def test_patch_load_and_clear(device, service):
    assert device.update({'slots': [{'id': 'BEQ', 'entry': 'test-id'}]})
    assert service.posts[-1]['action'] == 'load'
    assert device.update({'slots': [{'id': 'BEQ', 'entry': ''}]})
    assert service.posts[-1] == {'action': 'clear'}
    assert not device.update({})


@pytest.mark.parametrize('method,args', [
    ('mute', ('BEQ', None)), ('unmute', ('BEQ', None)),
    ('set_gain', ('BEQ', None, 1)),
    ('load_biquads', ('BEQ', False, [], [], [])),
    ('send_commands', ('BEQ', [], [], [])), ('activate', ('wrong',)),
])
def test_unsupported_control_never_posts(device, service, method, args):
    with pytest.raises(InvalidRequestError):
        getattr(device, method)(*args)
    assert service.posts == []


@pytest.mark.parametrize('url', [
    'file:///tmp/service', 'http://user:pass@localhost',
    'http://localhost/api', 'http://localhost?query=1', 'http://localhost#fragment',
])
def test_invalid_service_url(tmp_path, url):
    with pytest.raises(ValueError):
        ShakEQ('shakeq1', str(tmp_path), {'url': url}, CapturingWsServer(), None)


@pytest.mark.parametrize('timeout', [0, -1, float('nan'), float('inf')])
def test_invalid_timeout(tmp_path, httpserver, timeout):
    (tmp_path / 'token').write_text(TOKEN)
    with pytest.raises(ValueError):
        ShakEQ('shakeq1', str(tmp_path), {
            'url': httpserver.url_for('/'), 'tokenFile': 'token', 'requestTimeout': timeout,
        }, CapturingWsServer(), None)


def test_short_token_rejected(tmp_path, httpserver):
    (tmp_path / 'token').write_text('short')
    with pytest.raises(ValueError, match='token'):
        ShakEQ('shakeq1', str(tmp_path), {
            'url': httpserver.url_for('/'), 'tokenFile': 'token',
        }, CapturingWsServer(), None)


def test_redirect_does_not_forward_token_or_replay(device, service, httpserver):
    httpserver.expect_request('/redirect-target').respond_with_json(service.snapshot)
    httpserver.clear_all_handlers()
    httpserver.expect_request('/api/1/shakeq/shakeq1/beq', method='POST').respond_with_data(
        '', status=307, headers={'Location': httpserver.url_for('/redirect-target')})
    with pytest.raises(OSError, match='HTTP 307'):
        device.clear_filter('BEQ')
    assert len(httpserver.log) == 1


@pytest.fixture
def client(tmp_path, httpserver, service):
    (tmp_path / 'token').write_text(TOKEN)

    class Config(ReaperSpyConfig):
        def load_config(self):
            cfg = super().load_config()
            cfg['devices'] = {'shakeq1': {
                'type': 'shakeq', 'url': httpserver.url_for('/'), 'tokenFile': 'token',
            }}
            return cfg

    app, _ = main.create_app(Config(httpserver.host, httpserver.port, tmp_path))
    return app.test_client()


def test_existing_filter_api_load_clear_and_busy(client, service):
    response = client.put('/api/1/devices/shakeq1/filter/BEQ', json={'entryId': '123456_0'})
    assert response.status_code == 200, response.json
    assert response.json['slots'][0]['last'] == 'Alien Resurrection'
    assert service.posts[-1]['entry']['mv_adjust'] == 3.0
    service.beq_status = 423
    service.snapshot['consoleBusy'] = True
    response = client.patch('/api/3/devices/shakeq1', json={'slots': [{'id': 'BEQ', 'entry': '123456_0'}]})
    assert response.status_code == 400 and 'console is busy' in response.json['message']
    response = client.delete('/api/1/devices/shakeq1/filter/BEQ')
    assert response.status_code == 500 and response.json['consoleBusy']
    assert response.json['beq']['title'] == 'Alien Resurrection'
    service.beq_status = 200
    service.snapshot['consoleBusy'] = False
    assert client.delete('/api/1/devices/shakeq1/filter/BEQ').status_code == 200
    assert client.get('/shakeq/shakeq1').status_code == 404
    assert client.post('/api/1/shakeq/shakeq1/console', json={'action': 'open'}).status_code == 404


def test_existing_patch_api_handles_transfer_error(client, service):
    service.beq_status = 503
    response = client.patch('/api/3/devices/shakeq1', json={'slots': [{'id': 'BEQ', 'entry': '123456_0'}]})
    assert response.status_code == 500
    assert len(service.posts) == 1


def test_multiple_device_names_route_independently(tmp_path, httpserver, service):
    other = HttpServiceSpy(httpserver, 'shakeq2')
    (tmp_path / 'token').write_text(TOKEN)
    device = ShakEQ('shakeq2', str(tmp_path), {
        'url': httpserver.url_for('/'), 'tokenFile': 'token',
    }, CapturingWsServer(), None)
    device.clear_filter('BEQ')
    assert other.posts == [{'action': 'clear'}] and service.posts == []
