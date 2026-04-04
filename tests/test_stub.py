"""
Smoke tests for the stub device mode.

Fast tests use the Flask test client (no Twisted, no subprocess).
Integration tests (marked 'integration') start the real Twisted server
as a subprocess and make actual HTTP requests to it.
"""
import json
import os
import socket
import subprocess
import sys
import time

import pytest
import requests
import yaml


# ---------------------------------------------------------------------------
# Fast API smoke tests (Flask test client)
# ---------------------------------------------------------------------------

def test_stub_device_initial_state(stub_client):
    r = stub_client.get('/api/1/devices')
    assert r.status_code == 200
    devices = r.json
    assert devices['name'] == 'master'
    assert devices['mute'] is False
    assert float(devices['masterVolume']) == 0.0
    slots = devices['slots']
    assert len(slots) == 4
    assert slots[0]['active'] is True
    assert all(s['last'] == 'Empty' for s in slots)


def test_stub_mute_unmute(stub_client):
    r = stub_client.put('/api/1/devices/master/mute')
    assert r.status_code == 200
    assert r.json['mute'] is True

    r = stub_client.delete('/api/1/devices/master/mute')
    assert r.status_code == 200
    assert r.json['mute'] is False


def test_stub_activate_slot(stub_client):
    r = stub_client.put('/api/1/devices/master/config/2/active')
    assert r.status_code == 200
    slots = r.json['slots']
    assert slots[1]['active'] is True
    assert slots[0]['active'] is False


# ---------------------------------------------------------------------------
# Integration smoke test (real Twisted server, subprocess)
# ---------------------------------------------------------------------------

def _free_port() -> int:
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
        s.bind(('127.0.0.1', 0))
        return s.getsockname()[1]


@pytest.fixture(scope='module')
def live_stub_server(tmp_path_factory):
    port = _free_port()
    config_dir = tmp_path_factory.mktemp('live_stub')
    config = {
        'port': port,
        'accessLogging': False,
        'debugLogging': False,
        'devices': {'master': {'type': 'minidsp', 'exe': 'stub', 'cmdTimeout': 10}}
    }
    (config_dir / 'ezbeq.yml').write_text(yaml.dump(config))

    env = {**os.environ, 'EZBEQ_CONFIG_HOME': str(config_dir)}
    proc = subprocess.Popen(
        [sys.executable, '-m', 'ezbeq.main'],
        env=env,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
    )

    base_url = f'http://127.0.0.1:{port}'
    deadline = time.monotonic() + 15
    while time.monotonic() < deadline:
        try:
            requests.get(f'{base_url}/api/1/devices', timeout=1)
            break
        except requests.ConnectionError:
            time.sleep(0.2)
    else:
        proc.terminate()
        pytest.fail('Stub server did not become ready within 15 seconds')

    yield base_url

    proc.terminate()
    proc.wait(timeout=5)


@pytest.mark.integration
def test_live_stub_api(live_stub_server):
    r = requests.get(f'{live_stub_server}/api/1/devices')
    assert r.status_code == 200
    assert r.json()['name'] == 'master'


@pytest.mark.integration
def test_live_stub_root_no_error(live_stub_server):
    """Root path should return a clean 404, not Twisted's 'Processing Failed' error page."""
    r = requests.get(f'{live_stub_server}/')
    assert 'Processing Failed' not in r.text
