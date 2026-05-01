import logging
import os

import pytest

from conftest import MinidspSpyConfig


_UNSET = object()


class VersionedConfig(MinidspSpyConfig):
    """MinidspSpyConfig with controllable version and git_info."""

    def __init__(self, host, port, tmp_path, version='1.2.3', git_info=_UNSET):
        self.__version = version
        self.__git_info = git_info
        super().__init__(host, port, tmp_path)

    @property
    def version(self):
        return self.__version

    @property
    def git_info(self):
        if self.__git_info is _UNSET:
            return super().git_info
        return self.__git_info


@pytest.fixture
def version_client_no_git(httpserver, tmp_path):
    from ezbeq import main
    app, _ = main.create_app(VersionedConfig(httpserver.host, httpserver.port, tmp_path,
                                              version='1.2.3',
                                              git_info={'branch': None, 'sha': None}))
    return app.test_client()


@pytest.fixture
def version_client_with_git(httpserver, tmp_path):
    from ezbeq import main
    app, _ = main.create_app(VersionedConfig(httpserver.host, httpserver.port, tmp_path,
                                              version='1.2.3',
                                              git_info={'branch': 'feats/my-feature', 'sha': 'abc1234'}))
    return app.test_client()


@pytest.fixture
def version_client_unknown(httpserver, tmp_path):
    from ezbeq import main
    app, _ = main.create_app(VersionedConfig(httpserver.host, httpserver.port, tmp_path,
                                              version='UNKNOWN',
                                              git_info={'branch': 'main', 'sha': 'deadbee'}))
    return app.test_client()


def test_version_returns_version(version_client_no_git):
    r = version_client_no_git.get('/api/1/version')
    assert r.status_code == 200
    assert r.json['version'] == '1.2.3'


def test_version_no_git_info_omits_branch_and_sha(version_client_no_git):
    r = version_client_no_git.get('/api/1/version')
    assert r.status_code == 200
    assert 'branch' not in r.json
    assert 'sha' not in r.json


def test_version_with_git_info_includes_branch_and_sha(version_client_with_git):
    r = version_client_with_git.get('/api/1/version')
    assert r.status_code == 200
    assert r.json['version'] == '1.2.3'
    assert r.json['branch'] == 'feats/my-feature'
    assert r.json['sha'] == 'abc1234'


def test_version_unknown_with_git_still_returns_git_info(version_client_unknown):
    r = version_client_unknown.get('/api/1/version')
    assert r.status_code == 200
    assert r.json['version'] == 'UNKNOWN'
    assert r.json['branch'] == 'main'
    assert r.json['sha'] == 'deadbee'


def test_version_env_vars_take_priority(httpserver, tmp_path, monkeypatch):
    """GIT_BRANCH/GIT_SHA env vars (set by Docker) are used when present."""
    monkeypatch.setenv('GIT_BRANCH', 'feats/docker-branch')
    monkeypatch.setenv('GIT_SHA', 'cafebabe')
    from ezbeq import main
    from ezbeq.config import Config
    cfg = Config.__new__(Config)
    info = cfg.git_info
    assert info['branch'] == 'feats/docker-branch'
    assert info['sha'] == 'cafebabe'


def test_version_env_vars_surfaced_in_api(httpserver, tmp_path, monkeypatch):
    """GIT_BRANCH/GIT_SHA env vars appear in /api/1/version response."""
    monkeypatch.setenv('GIT_BRANCH', 'feats/docker-branch')
    monkeypatch.setenv('GIT_SHA', 'cafebabe')
    from ezbeq import main
    app, _ = main.create_app(VersionedConfig(httpserver.host, httpserver.port, tmp_path,
                                              version='1.2.3'))
    r = app.test_client().get('/api/1/version')
    assert r.status_code == 200
    assert r.json['branch'] == 'feats/docker-branch'
    assert r.json['sha'] == 'cafebabe'


# ─── Config.version fallback chain ──────────────────────────────────────────
# These tests exercise the actual fallback logic (VERSION file → pyproject.toml
# → importlib.metadata → 'UNKNOWN'). They sidestep the VersionedConfig stub
# above, which overrides `version` entirely.

def _make_fake_root(tmp_path, version_content=None, pyproject_content=None):
    """Stand up a fake ezbeq package directory under tmp_path.

    Mirrors the on-disk layout that Config.version reads:
      <root>/ezbeq/__init__.py     ← config.py's __file__ is patched here
      <root>/ezbeq/VERSION         ← optional VERSION file
      <root>/pyproject.toml        ← optional pyproject.toml
    """
    fake_ezbeq = tmp_path / 'ezbeq'
    fake_ezbeq.mkdir()
    (fake_ezbeq / '__init__.py').write_text('')
    if version_content is not None:
        (fake_ezbeq / 'VERSION').write_text(version_content)
    if pyproject_content is not None:
        (tmp_path / 'pyproject.toml').write_text(pyproject_content)
    return fake_ezbeq


def _bare_config(monkeypatch, fake_root):
    """Build a Config instance whose `version` property reads from fake_root.

    Skips Config.__init__ entirely; we only care about the `version` property.
    """
    from ezbeq import config as config_module
    monkeypatch.setattr(config_module, '__file__', str(fake_root / '__init__.py'))
    cfg = config_module.Config.__new__(config_module.Config)
    cfg.logger = logging.getLogger('test.config')
    return cfg


def test_version_from_VERSION_file(tmp_path, monkeypatch):
    fake = _make_fake_root(tmp_path, version_content='9.8.7\n')
    cfg = _bare_config(monkeypatch, fake)
    assert cfg.version == '9.8.7'


def test_version_strips_VERSION_file_whitespace(tmp_path, monkeypatch):
    # Ensure trailing newline / surrounding whitespace doesn't bleed into
    # consumers like the API response or the banner.
    fake = _make_fake_root(tmp_path, version_content='  1.2.3  \n')
    cfg = _bare_config(monkeypatch, fake)
    assert cfg.version == '1.2.3'


def test_version_from_pyproject_project_version(tmp_path, monkeypatch):
    pyproject = '[project]\nname = "ezbeq"\nversion = "5.4.3"\n'
    fake = _make_fake_root(tmp_path, pyproject_content=pyproject)
    cfg = _bare_config(monkeypatch, fake)
    assert cfg.version == '5.4.3'


def test_version_from_pyproject_legacy_poetry_section(tmp_path, monkeypatch):
    # Older pyproject.toml put the version under [tool.poetry] rather than
    # [project]. Keep the legacy arm working so a downstream fork that hasn't
    # migrated still resolves a sane version.
    pyproject = '[tool.poetry]\nname = "ezbeq"\nversion = "4.3.2"\n'
    fake = _make_fake_root(tmp_path, pyproject_content=pyproject)
    cfg = _bare_config(monkeypatch, fake)
    assert cfg.version == '4.3.2'


def test_version_falls_back_to_metadata_when_no_VERSION_or_pyproject(tmp_path, monkeypatch):
    # Production Docker image case: ezbeq is pip-installed, source tree is
    # absent. importlib.metadata is the source of truth.
    fake = _make_fake_root(tmp_path)
    cfg = _bare_config(monkeypatch, fake)
    v = cfg.version
    assert v != 'UNKNOWN'
    assert v
    # Should look like a real version string (starts with a digit).
    assert v[0].isdigit()


def test_version_unknown_when_nothing_resolves(tmp_path, monkeypatch):
    # Defensive: VERSION absent, pyproject absent, package not installed under
    # this name. Fallback returns the literal 'UNKNOWN' rather than raising.
    fake = _make_fake_root(tmp_path)
    cfg = _bare_config(monkeypatch, fake)
    import importlib.metadata as md
    def _missing(name):
        raise md.PackageNotFoundError(name)
    monkeypatch.setattr(md, 'version', _missing)
    assert cfg.version == 'UNKNOWN'


def test_version_recovers_from_corrupt_pyproject(tmp_path, monkeypatch, caplog):
    # A malformed pyproject.toml shouldn't be a silent failure: it should log
    # a warning and continue down the chain.
    fake = _make_fake_root(tmp_path, pyproject_content='this is [ not valid toml')
    cfg = _bare_config(monkeypatch, fake)
    with caplog.at_level(logging.WARNING, logger='test.config'):
        v = cfg.version
    assert v != 'UNKNOWN'  # falls through to importlib.metadata
    assert any('pyproject.toml' in record.message for record in caplog.records)
