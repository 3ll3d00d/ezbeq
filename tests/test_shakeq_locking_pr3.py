"""PR3 concurrency regression tests. Run with: uv run pytest -q tests/test_shakeq_locking_pr3.py"""
import threading
import time
from concurrent.futures import ThreadPoolExecutor

from test_shakeq import device, service  # shared fixtures
from test_shakeq import entry


def test_state_is_immediate_during_blocked_load(device, monkeypatch):
    original = device._ShakEQ__request
    entered, release = threading.Event(), threading.Event()

    def slow(route, body=None):
        if body is not None:
            entered.set()
            assert release.wait(5)
        return original(route, body)

    monkeypatch.setattr(device, '_ShakEQ__request', slow)
    device.state()  # establish the published state
    with ThreadPoolExecutor(max_workers=2) as pool:
        load = pool.submit(device.load_filter, 'BEQ', entry())
        assert entered.wait(3)
        started = time.monotonic()
        state = pool.submit(device.state).result(timeout=0.5).serialise()
        assert time.monotonic() - started < 0.5
        assert state['beq'] is None
        release.set()
        load.result(timeout=5)
    assert device.state().serialise()['beq']['digest'] == 'digest-1'


def test_parallel_loads_are_serialised(device, monkeypatch):
    original = device._ShakEQ__request
    entered, release = threading.Event(), threading.Event()
    active = 0
    maximum = 0
    guard = threading.Lock()

    def slow(route, body=None):
        nonlocal active, maximum
        if body is not None:
            with guard:
                active += 1
                maximum = max(maximum, active)
            entered.set()
            if not release.wait(5):
                raise AssertionError('First request not released')
            try:
                return original(route, body)
            finally:
                with guard:
                    active -= 1
        return original(route, body)

    monkeypatch.setattr(device, '_ShakEQ__request', slow)
    with ThreadPoolExecutor(max_workers=2) as pool:
        a = pool.submit(device.load_filter, 'BEQ', entry())
        assert entered.wait(3)
        b = pool.submit(device.clear_filter, 'BEQ')
        time.sleep(0.05)
        assert maximum == 1
        release.set()
        a.result(timeout=5)
        b.result(timeout=5)
    assert maximum == 1
    assert device.state().serialise()['beq'] is None


def test_stale_get_cannot_overwrite_load(device, monkeypatch):
    original = device._ShakEQ__request
    entered, release = threading.Event(), threading.Event()

    def delayed_get(route, body=None):
        if route == 'state':
            snapshot = original(route, body)
            entered.set()
            assert release.wait(5)
            return snapshot
        return original(route, body)

    monkeypatch.setattr(device, '_ShakEQ__request', delayed_get)
    with ThreadPoolExecutor(max_workers=2) as pool:
        read = pool.submit(device.state, True)
        assert entered.wait(3)
        device.load_filter('BEQ', entry())
        release.set()
        read.result(timeout=5)
    assert device.state().serialise()['beq']['digest'] == 'digest-1'


def test_missing_token_preserves_confirmed_entry(device, tmp_path):
    device.load_filter('BEQ', entry())
    before = device.state().serialise()
    (tmp_path / 'token').unlink()
    import pytest
    from ezbeq.shakeq import ShakEQNotSentError
    with pytest.raises(ShakEQNotSentError):
        device.clear_filter('BEQ')
    after = device.state().serialise()
    assert after['beq'] == before['beq']
    assert after['slots'] == before['slots']
    assert after['status'] == before['status']
    assert not after['serviceOnline']


def test_bad_token_preserves_confirmed_entry(device, tmp_path):
    device.load_filter('BEQ', entry())
    before = device.state().serialise()
    (tmp_path / 'token').write_text('short')
    import pytest
    from ezbeq.shakeq import ShakEQNotSentError
    with pytest.raises(ShakEQNotSentError):
        device.clear_filter('BEQ')
    assert device.state().serialise()['beq'] == before['beq']


def test_rejected_config_is_not_invalid_request(device, service):
    import pytest
    from ezbeq.shakeq import ShakEQRejectedError
    from ezbeq.device import InvalidRequestError
    device.load_filter('BEQ', entry())
    service.beq_status = 401
    with pytest.raises(ShakEQRejectedError) as exc:
        device.clear_filter('BEQ')
    assert not isinstance(exc.value, InvalidRequestError)
    assert device.state().serialise()['beq'] is not None


def test_trickling_response_exceeds_elapsed_deadline(device, monkeypatch):
    import pytest
    from unittest.mock import Mock
    from ezbeq.shakeq import ShakEQResponseError
    import ezbeq.shakeq as mod
    real_monotonic = mod.time.monotonic
    tick = [100.0]
    monkeypatch.setattr(mod.time, 'monotonic', lambda: tick[0])

    class FakeResponse:
        status_code = 200
        def __enter__(self): return self
        def __exit__(self, *args): return False
        def iter_content(self, size):
            tick[0] += 1.1
            yield b' '
            tick[0] += 1.1
            yield b' '

    monkeypatch.setattr(device._ShakEQ__session, 'request', lambda *a, **k: FakeResponse())
    with pytest.raises(ShakEQResponseError, match='deadline'):
        device._ShakEQ__request('state')
    monkeypatch.setattr(mod.time, 'monotonic', real_monotonic)


def test_recursion_error_from_state_is_contained(device, monkeypatch):
    def deeply_nested(route, body=None):
        raise RecursionError('deep JSON')
    monkeypatch.setattr(device, '_ShakEQ__request', deeply_nested)
    assert device.state(refresh=True).serialise()['status'] == 'unknown'


def test_failed_state_backoff_increases(device, monkeypatch):
    import requests
    clock = [100.0]
    monkeypatch.setattr('ezbeq.shakeq.time.monotonic', lambda: clock[0])
    hits = []
    def fail(*args, **kwargs):
        hits.append(clock[0]); raise requests.Timeout()
    monkeypatch.setattr(device._ShakEQ__session, 'request', fail)
    device.state()
    assert len(hits) == 1
    clock[0] += 3
    device.state()
    assert len(hits) == 1
    clock[0] += 1.1
    device.state()
    assert len(hits) == 2
    clock[0] += 7
    device.state()
    assert len(hits) == 2
    clock[0] += 1.1
    device.state()
    assert len(hits) == 3
