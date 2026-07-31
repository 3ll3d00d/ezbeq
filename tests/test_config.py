import sys

from conftest import StubConfig

from ezbeq.config import MIN_SUPPORTED_PYTHON


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
