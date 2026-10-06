import hashlib
import json

import pytest
from conftest import MinidspSpyConfig
from pytest_httpserver import HTTPServer

from ezbeq import main
from ezbeq.catalogue import DeviceCatalogues, ProfileRequirement, to_coefficients
from ezbeq.composite import CompositeDeviceState, MemberSpec
from ezbeq.device import DeviceState, SlotState

DIGEST = 'abcdefghijklm'
OPT_BQ = {'b': ['1.1', '-1.2', '0.3'], 'a': ['1.4', '-0.5']}
OPT_CMD = '1.1 -1.2 0.3 1.4 -0.5'


def make_profile(profile_id: str, rate: int, entries: dict, schema_version: int = 1,
                 loading_model: str = 'additive-feedback-decimal17-v1', header_rate: int | None = None) -> bytes:
    return json.dumps({
        'schema_version': schema_version,
        'profile': profile_id,
        'revision': 1,
        'rate': header_rate if header_rate is not None else rate,
        'storage': 'float32',
        'transport': 'float32',
        'loading_model': loading_model,
        'entries': entries
    }, sort_keys=True).encode('utf-8')


def index_entry(profile_id: str, rate: int, content: bytes, storage: str = 'float32', sha256: str | None = None) -> dict:
    return {
        'id': profile_id,
        'label': f'{storage} @ {rate // 1000} kHz',
        'file': f'{profile_id}.json',
        'rate': rate,
        'storage': storage,
        'transport': storage,
        'revision': 1,
        'entries': 1,
        'sha256': sha256 if sha256 else hashlib.sha256(content).hexdigest()
    }


def serve(httpserver: HTTPServer, profiles: dict[str, tuple[int, bytes]], **index_overrides):
    """
    :param profiles: profile id -> (rate, file content).
    """
    index = {
        'schema_version': 1,
        'profiles': [index_entry(p, rate, content, **index_overrides.get(p, {})) for p, (rate, content) in
                     profiles.items()]
    }
    httpserver.expect_request('/devices/index.json').respond_with_json(index)
    for p, (_, content) in profiles.items():
        httpserver.expect_request(f'/devices/{p}.json').respond_with_data(content, content_type='application/json')


def standard_profiles(digest: str = DIGEST, count: int = 5) -> dict[str, tuple[int, bytes]]:
    return {
        'float32-96k': (96000, make_profile('float32-96k', 96000, {digest: [OPT_BQ] * count})),
        'float32-48k': (48000, make_profile('float32-48k', 48000, {digest: [OPT_BQ] * count})),
    }


def downloads(httpserver: HTTPServer, path: str) -> int:
    return sum(1 for req, _ in httpserver.log if req.path == path)


def make_dc(httpserver: HTTPServer, tmp_path) -> DeviceCatalogues:
    return DeviceCatalogues(str(tmp_path / 'ezbeq.db'), f'http://{httpserver.host}:{httpserver.port}/', True)


REQ_96K = ProfileRequirement('float32-96k', 96000, 'float32')


class TestDeviceCatalogues:

    def test_loads_only_required_profiles(self, httpserver, tmp_path):
        serve(httpserver, standard_profiles())
        dc = make_dc(httpserver, tmp_path)
        dc.require(REQ_96K)
        assert [p.id for p in dc.loaded] == ['float32-96k']
        assert downloads(httpserver, '/devices/float32-96k.json') == 1
        assert downloads(httpserver, '/devices/float32-48k.json') == 0
        assert dc.optimised_biquads('float32-96k', DIGEST, 5) == [['1.1', '-1.2', '0.3', '1.4', '-0.5']] * 5

    def test_miss_and_count_mismatch_return_none(self, httpserver, tmp_path):
        serve(httpserver, standard_profiles())
        dc = make_dc(httpserver, tmp_path)
        dc.require(REQ_96K)
        assert dc.optimised_biquads('float32-96k', 'unknown', 5) is None
        assert dc.optimised_biquads('float32-96k', DIGEST, 4) is None
        assert dc.optimised_biquads('float32-48k', DIGEST, 5) is None
        assert dc.optimised_biquads('float32-96k', '', 5) is None

    def test_sha_mismatch_is_rejected(self, httpserver, tmp_path):
        serve(httpserver, standard_profiles(), **{'float32-96k': {'sha256': 'deadbeef'}})
        dc = make_dc(httpserver, tmp_path)
        dc.require(REQ_96K)
        assert dc.loaded == []
        assert dc.resolve(REQ_96K) is None

    @pytest.mark.parametrize('kwargs', [
        {'schema_version': 2},
        {'loading_model': 'something-else'},
        {'header_rate': 48000},
    ], ids=['schema', 'loading_model', 'rate'])
    def test_invalid_header_is_rejected(self, httpserver, tmp_path, kwargs):
        content = make_profile('float32-96k', 96000, {DIGEST: [OPT_BQ] * 5}, **kwargs)
        serve(httpserver, {'float32-96k': (96000, content)})
        dc = make_dc(httpserver, tmp_path)
        dc.require(REQ_96K)
        assert dc.loaded == []

    def test_unsupported_index_schema_is_ignored(self, httpserver, tmp_path):
        httpserver.expect_request('/devices/index.json').respond_with_json({'schema_version': 2, 'profiles': []})
        dc = make_dc(httpserver, tmp_path)
        dc.require(REQ_96K)
        assert dc.loaded == []

    def test_malformed_entries_are_skipped(self, httpserver, tmp_path):
        content = make_profile('float32-96k', 96000, {DIGEST: [OPT_BQ] * 5, 'bad': [{'b': ['1'], 'a': []}]})
        serve(httpserver, {'float32-96k': (96000, content)})
        dc = make_dc(httpserver, tmp_path)
        dc.require(REQ_96K)
        assert dc.optimised_biquads('float32-96k', DIGEST, 5)
        assert dc.optimised_biquads('float32-96k', 'bad', 1) is None

    def test_unchanged_sha_is_not_downloaded_again(self, httpserver, tmp_path):
        serve(httpserver, standard_profiles())
        dc = make_dc(httpserver, tmp_path)
        dc.require(REQ_96K)
        dc.refresh()
        assert downloads(httpserver, '/devices/index.json') == 2
        assert downloads(httpserver, '/devices/float32-96k.json') == 1

    def test_changed_sha_replaces_entries(self, httpserver, tmp_path):
        serve(httpserver, standard_profiles())
        dc = make_dc(httpserver, tmp_path)
        dc.require(REQ_96K)
        httpserver.clear_all_handlers()
        serve(httpserver, standard_profiles(digest='other', count=2))
        dc.refresh()
        assert dc.optimised_biquads('float32-96k', DIGEST, 5) is None
        assert dc.optimised_biquads('float32-96k', 'other', 2)

    def test_failed_download_keeps_loaded_data(self, httpserver, tmp_path):
        serve(httpserver, standard_profiles())
        dc = make_dc(httpserver, tmp_path)
        dc.require(REQ_96K)
        httpserver.clear_all_handlers()
        content = make_profile('float32-96k', 96000, {'other': [OPT_BQ]})
        serve(httpserver, {'float32-96k': (96000, content)}, **{'float32-96k': {'sha256': 'deadbeef'}})
        dc.refresh()
        assert dc.optimised_biquads('float32-96k', DIGEST, 5)

    def test_withdrawn_profile_is_removed(self, httpserver, tmp_path):
        serve(httpserver, standard_profiles())
        dc = make_dc(httpserver, tmp_path)
        dc.require(REQ_96K)
        httpserver.clear_all_handlers()
        httpserver.expect_request('/devices/index.json').respond_with_json({'schema_version': 1, 'profiles': []})
        dc.refresh()
        assert dc.loaded == []
        assert dc.optimised_biquads('float32-96k', DIGEST, 5) is None

    def test_loaded_profiles_survive_restart_without_network(self, httpserver, tmp_path):
        serve(httpserver, standard_profiles())
        make_dc(httpserver, tmp_path).require(REQ_96K)
        httpserver.clear_all_handlers()
        dc = make_dc(httpserver, tmp_path)
        dc.require(REQ_96K)
        assert [p.id for p in dc.loaded] == ['float32-96k']
        assert dc.optimised_biquads('float32-96k', DIGEST, 5)

    def test_requirement_by_format(self, httpserver, tmp_path):
        serve(httpserver, standard_profiles())
        dc = make_dc(httpserver, tmp_path)
        req = ProfileRequirement(None, 48000, 'float32')
        dc.require(req)
        assert dc.resolve(req).id == 'float32-48k'
        assert dc.resolve(ProfileRequirement(None, 48000, 'fixed')) is None
        assert dc.resolve(ProfileRequirement(None, 48000, None)) is None


def test_to_coefficients():
    assert to_coefficients([OPT_BQ]) == [['1.1', '-1.2', '0.3', '1.4', '-0.5']]
    assert to_coefficients([]) is None
    assert to_coefficients([{'b': ['1', '2'], 'a': ['1', '2']}]) is None
    assert to_coefficients([{'b': ['1', '2', '3']}]) is None
    assert to_coefficients(None) is None


class OptimisedMinidspConfig(MinidspSpyConfig):

    def __init__(self, host: str, port: int, tmp_path, device_type: str | None = None, extra: dict | None = None):
        # load_config is called from the base constructor so this has to be set first
        self.__extra = extra or {}
        super().__init__(host, port, tmp_path, device_type=device_type)

    def load_config(self):
        vals = super().load_config()
        vals['devices']['master'].update(self.__extra)
        return vals


def make_client(httpserver: HTTPServer, tmp_path, device_type: str | None = None, extra: dict | None = None):
    cfg = OptimisedMinidspConfig(httpserver.host, httpserver.port, tmp_path, device_type=device_type, extra=extra)
    app, _ = main.create_app(cfg)
    return app.test_client(), cfg


def load_slot_1(client) -> dict:
    r = client.put('/api/1/devices/master/filter/1', data=json.dumps({'entryId': '123456_0'}),
                   content_type='application/json')
    assert r.status_code == 200
    return next(s for s in r.json['slots'] if s['id'] == '1')


def get_optimisation(client) -> dict:
    r = client.get('/api/2/devices')
    assert r.status_code == 200
    return r.json['master']['optimisation']


def test_24hd_loads_optimised_coefficients(httpserver, tmp_path):
    serve(httpserver, standard_profiles())
    client, cfg = make_client(httpserver, tmp_path)
    assert get_optimisation(client) == {'profile': 'float32-96k', 'label': 'float32 @ 96 kHz', 'enabled': True,
                                        'available': True, 'reason': None}
    slot = load_slot_1(client)
    assert slot['coefficients'] == 'optimised'
    assert slot['profile'] == 'float32-96k'
    cmds = cfg.spy.take_commands()
    peq_cmds = [c for c in cmds if ' set -- ' in c]
    assert len(peq_cmds) == 10
    assert all(c.endswith(f'set -- {OPT_CMD}') for c in peq_cmds)


def test_ddrc24_uses_48k_profile(httpserver, tmp_path):
    serve(httpserver, standard_profiles())
    client, _cfg = make_client(httpserver, tmp_path, device_type='DDRC24')
    assert get_optimisation(client)['profile'] == 'float32-48k'
    assert load_slot_1(client)['coefficients'] == 'optimised'
    assert downloads(httpserver, '/devices/float32-96k.json') == 0


def test_entry_without_optimisation_is_standard(httpserver, tmp_path):
    serve(httpserver, standard_profiles(digest='other'))
    client, cfg = make_client(httpserver, tmp_path)
    slot = load_slot_1(client)
    assert slot['coefficients'] == 'standard'
    assert slot['profile'] == 'float32-96k'
    assert not any(OPT_CMD in c for c in cfg.spy.take_commands())


def test_unavailable_profile_is_unoptimised(httpserver, tmp_path):
    client, _cfg = make_client(httpserver, tmp_path)
    assert get_optimisation(client) == {'profile': 'float32-96k', 'label': None, 'enabled': True,
                                        'available': False, 'reason': 'profile_unavailable'}
    slot = load_slot_1(client)
    assert slot['coefficients'] == 'unoptimised'
    assert slot['profile'] is None


@pytest.mark.parametrize('device_type', ['4x10', '10x10', '8x12CDSP'])
def test_devices_without_a_profile(httpserver, tmp_path, device_type):
    serve(httpserver, standard_profiles())
    client, _cfg = make_client(httpserver, tmp_path, device_type=device_type)
    assert get_optimisation(client) == {'profile': None, 'label': None, 'enabled': True, 'available': False,
                                        'reason': 'no_profile'}
    assert downloads(httpserver, '/devices/index.json') == 0
    assert load_slot_1(client)['coefficients'] == 'unoptimised'


def test_fixed_point_override_is_refused(httpserver, tmp_path):
    serve(httpserver, standard_profiles())
    client, cfg = make_client(httpserver, tmp_path, device_type='4x10', extra={'optimisationProfile': 'float32-96k'})
    opt = get_optimisation(client)
    assert opt['reason'] == 'precision_mismatch'
    assert opt['available'] is False
    slot = load_slot_1(client)
    assert slot['coefficients'] == 'unoptimised'
    assert not any(OPT_CMD in c for c in cfg.spy.take_commands())


def test_rate_mismatch_override_is_refused(httpserver, tmp_path):
    serve(httpserver, standard_profiles())
    client, _cfg = make_client(httpserver, tmp_path, device_type='DDRC24', extra={'optimisationProfile': 'float32-96k'})
    assert get_optimisation(client)['reason'] == 'rate_mismatch'
    assert load_slot_1(client)['coefficients'] == 'unoptimised'


@pytest.mark.parametrize('value', ['none', None, False])
def test_override_to_none(httpserver, tmp_path, value):
    serve(httpserver, standard_profiles())
    client, _cfg = make_client(httpserver, tmp_path, extra={'optimisationProfile': value})
    assert get_optimisation(client)['reason'] == 'no_profile'


def custom_descriptor(**kwargs) -> dict:
    return {'descriptor': {
        'name': 'custom',
        'fs': 48000,
        'routes': [{'name': 'input', 'biquads': 10, 'channels': [0, 1], 'slots': list(range(10))}],
        **kwargs
    }}


def test_custom_descriptor_with_precision_matches_by_format(httpserver, tmp_path):
    serve(httpserver, standard_profiles())
    client, _cfg = make_client(httpserver, tmp_path, extra=custom_descriptor(precision='float32'))
    assert get_optimisation(client)['profile'] == 'float32-48k'
    assert load_slot_1(client)['coefficients'] == 'optimised'


def test_custom_descriptor_with_explicit_profile(httpserver, tmp_path):
    serve(httpserver, standard_profiles())
    client, _cfg = make_client(httpserver, tmp_path,
                              extra={**custom_descriptor(), 'optimisationProfile': 'float32-48k'})
    assert get_optimisation(client)['reason'] is None
    assert load_slot_1(client)['coefficients'] == 'optimised'


def test_custom_descriptor_without_precision_has_no_profile(httpserver, tmp_path):
    serve(httpserver, standard_profiles())
    client, _cfg = make_client(httpserver, tmp_path, extra=custom_descriptor())
    assert get_optimisation(client)['reason'] == 'no_profile'


def test_custom_descriptor_rejects_unknown_precision(httpserver, tmp_path):
    with pytest.raises(ValueError):
        make_client(httpserver, tmp_path, extra=custom_descriptor(precision='float64'))


def test_clear_resets_slot_coefficients(httpserver, tmp_path):
    serve(httpserver, standard_profiles())
    client, _cfg = make_client(httpserver, tmp_path)
    load_slot_1(client)
    r = client.delete('/api/1/devices/master/filter/1')
    assert r.status_code == 200
    slot = next(s for s in r.json['slots'] if s['id'] == '1')
    assert 'coefficients' not in slot


def test_slot_coefficients_are_persisted(httpserver, tmp_path):
    serve(httpserver, standard_profiles())
    client, _cfg = make_client(httpserver, tmp_path)
    load_slot_1(client)
    with open(tmp_path / 'master.json') as f:
        cached = json.load(f)
    slot = next(s for s in cached['slots'] if s['id'] == '1')
    assert slot['coefficients'] == 'optimised'
    assert slot['profile'] == 'float32-96k'


def test_meta_lists_loaded_profiles(httpserver, tmp_path):
    serve(httpserver, standard_profiles())
    client, _cfg = make_client(httpserver, tmp_path)
    r = client.get('/api/1/meta')
    assert r.status_code == 200
    assert [p['id'] for p in r.json['deviceProfiles']] == ['float32-96k']


def test_slot_state_merges_old_cache_without_coefficients():
    s = SlotState('1')
    s.merge_with({'last': 'Something', 'active': True})
    assert s.coefficients is None
    assert 'coefficients' not in s.as_dict()
    s.merge_with({'last': 'Something', 'coefficients': 'optimised', 'profile': 'float32-96k'})
    assert s.as_dict()['coefficients'] == 'optimised'
    assert s.as_dict()['profile'] == 'float32-96k'


class FixedState(DeviceState):

    def __init__(self, vals: dict):
        self.vals = vals

    def serialise(self) -> dict:
        return self.vals


def composite_state(members: dict[str, dict]) -> dict:
    return CompositeDeviceState('c', 'a', {n: MemberSpec() for n in members},
                                {n: FixedState(v) for n, v in members.items()}).serialise()


OK = {'profile': 'float32-96k', 'label': 'x', 'enabled': True, 'available': True, 'reason': None}
NOT_OK = {'profile': None, 'label': None, 'enabled': True, 'available': False, 'reason': 'no_profile'}


def test_composite_reports_least_optimised_member():
    s = composite_state({'a': {'optimisation': OK}, 'b': {'optimisation': NOT_OK}})
    assert s['optimisation'] == {**NOT_OK, 'member': 'b'}


def test_composite_reports_primary_when_all_optimised():
    s = composite_state({'a': {'optimisation': OK}, 'b': {'optimisation': {**OK, 'profile': 'float32-48k'}}})
    assert s['optimisation'] == OK


def test_composite_of_parametric_devices_has_no_optimisation():
    s = composite_state({'a': {'slots': []}, 'b': {'slots': []}})
    assert 'optimisation' not in s


def test_composite_ignores_parametric_members():
    s = composite_state({'a': {'slots': []}, 'b': {'optimisation': OK}})
    assert s['optimisation'] == OK
