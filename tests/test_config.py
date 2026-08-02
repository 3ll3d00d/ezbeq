import os
import sys

import pytest
from conftest import StubConfig

from ezbeq.config import MIN_SUPPORTED_PYTHON, Config
from ezbeq.device import create_devices

EXAMPLES_DIR = os.path.join(os.path.dirname(__file__), '..', 'examples')


def test_python_version_reports_running_interpreter(tmp_path):
    cfg = StubConfig(tmp_path)
    assert cfg.python_version == '.'.join(str(v) for v in sys.version_info[:3])


def test_min_python_version_reflects_constant(tmp_path):
    cfg = StubConfig(tmp_path)
    assert cfg.min_python_version == '.'.join(str(v) for v in MIN_SUPPORTED_PYTHON)


def test_python_supported_true_when_at_or_above_minimum(tmp_path, monkeypatch):
    monkeypatch.setattr(sys, 'version_info', MIN_SUPPORTED_PYTHON + (0,))
    cfg = StubConfig(tmp_path)
    assert cfg.python_supported is True


def test_python_supported_false_when_below_minimum(tmp_path, monkeypatch):
    below = (MIN_SUPPORTED_PYTHON[0], MIN_SUPPORTED_PYTHON[1] - 1, 0)
    monkeypatch.setattr(sys, 'version_info', below)
    cfg = StubConfig(tmp_path)
    assert cfg.python_supported is False


def test_check_for_updates_and_interval_default_when_unset(tmp_path):
    from ezbeq.config import Config

    class BareConfig(Config):
        def load_config(self):
            return {'devices': {}}

    cfg = BareConfig('bare')
    assert cfg.check_for_updates is True
    assert cfg.update_check_interval == 86400.0


class _ExampleConfig(Config):
    """Loads examples/<name>.yml the same way a real deployment would."""

    def __init__(self, name: str):
        super().__init__(name)

    @property
    def config_path(self):
        return EXAMPLES_DIR

    @property
    def check_for_updates(self):
        return False


def test_composite_example_config_parses():
    cfg = _ExampleConfig('ezbeq_composite')

    bass_array = cfg.devices['bass_array']
    assert bass_array['type'] == 'composite'
    assert bass_array['mode'] == 'mirror'
    assert bass_array['members'] == ['sub1', 'sub2', 'sub3']

    home_theatre = cfg.devices['home_theatre']
    assert home_theatre['type'] == 'composite'
    assert home_theatre['mode'] == 'mapped'
    assert home_theatre['primary'] == 'rear_sub'
    assert home_theatre['exposeMembers'] is True
    assert set(home_theatre['members'].keys()) == {'rear_sub', 'proc'}
    assert home_theatre['members']['proc']['slotMap'] == {'1': 'Movie', '2': 'Music'}
    assert home_theatre['members']['proc']['skipOps'] == ['set_gain']


class _RawDevicesConfig(Config):

    def __init__(self, devices: dict):
        self.__devices = devices
        super().__init__('validate')

    def load_config(self):
        return {'devices': self.__devices, 'port': 8080}

    @property
    def config_path(self):
        return '/tmp'

    @property
    def check_for_updates(self):
        return False


@pytest.mark.parametrize('mutation,match', [
    (lambda d: d['bass_array'].__setitem__('members', ['sub1', 'sub2', 'nope']), "unknown member 'nope'"),
    (lambda d: d['bass_array'].__setitem__('mode', 'bogus'), "invalid mode 'bogus'"),
    (lambda d: d['bass_array'].__setitem__('members', ['sub1', 'proc']), 'differing types'),
])
def test_composite_example_config_rejects_mutations(mutation, match):
    """
    Sanity-checks that create_devices() actually enforces the validation
    rules the composite example config satisfies - by taking a parsed copy
    of examples/ezbeq_composite.yml and breaking bass_array in one specific
    way. home_theatre is dropped first so its own use of 'proc'/'rear_sub'
    can't interact with whatever we just did to bass_array's membership.
    """
    cfg = _ExampleConfig('ezbeq_composite')
    devices = cfg.as_dict()['devices']
    del devices['home_theatre']
    mutation(devices)
    raw_cfg = _RawDevicesConfig(devices)
    with pytest.raises(ValueError, match=match):
        create_devices(raw_cfg, None, None)
