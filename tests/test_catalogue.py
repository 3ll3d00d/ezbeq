import json
import logging
import sqlite3
import threading
import time
import types
from datetime import UTC, datetime, timedelta

import pytest
from pytest_httpserver import HTTPServer

from ezbeq.catalogue import (
    DB_BUSY_TIMEOUT_MILLIS,
    TWO_WEEKS_AGO_SECONDS,
    Catalogue,
    Catalogues,
    DatabaseDownloader,
    compute_freshness,
    db_ops,
)


def make_catalogues(tmp_path, mmap_mb: int = 0) -> Catalogues:
    """
    Build a Catalogues instance without going through __init__, which requires a live
    WsServer, network access and a running reactor. Tests exercise the private SQL/threading
    methods directly instead.
    """
    cat = Catalogues.__new__(Catalogues)
    cat._Catalogues__db = str(tmp_path / 'ezbeq.db')
    cat._Catalogues__catalogue_file = str(tmp_path / 'database.json')
    cat._Catalogues__version_file = str(tmp_path / 'version.txt')
    cat._Catalogues__mmap_mb = mmap_mb
    cat._Catalogues__chunk_sizes = (100, 100)
    cat._Catalogues__catalogues = []
    cat._Catalogues__prune_pool = None
    cat._Catalogues__ensure_db()
    return cat


def write_catalogue_json(path, entries):
    with open(path, 'w') as f:
        json.dump(entries, f)


SAMPLE_ENTRIES = [
    {
        'title': 'Alpha One', 'year': '2001', 'audioTypes': ['DTS-HD MA 5.1'],
        'content_type': 'film', 'author': 'authorA', 'digest': 'digest-1',
        'theMovieDB': 'tt001'
    },
    {
        'title': 'Beta Two', 'year': '2010', 'audioTypes': ['TrueHD 7.1'],
        'content_type': 'film', 'author': 'authorB', 'digest': 'digest-2',
        'theMovieDB': 'tt002'
    },
    {
        'title': 'Gamma Three', 'year': '2015', 'audioTypes': ['DTS-HD MA 5.1'],
        'content_type': 'TV', 'author': 'authorA', 'digest': 'digest-3',
        'season': '1', 'episode': '1,2,3'
    },
]


class TestEnsureDb:

    def test_creates_expected_indexes(self, tmp_path):
        cat = make_catalogues(tmp_path)
        with db_ops(cat._Catalogues__db) as cur:
            names = {r[0] for r in cur.execute(
                "SELECT name FROM sqlite_master WHERE type='index'").fetchall()}
        assert 'entry_digest' in names
        assert 'entry_version' in names
        assert 'meta_key' in names

    def test_is_idempotent(self, tmp_path):
        cat = make_catalogues(tmp_path)
        cat._Catalogues__ensure_db()


class TestDbOps:

    def test_sets_busy_timeout(self, tmp_path):
        db_file = str(tmp_path / 'x.db')
        with db_ops(db_file) as cur:
            val = cur.execute('PRAGMA busy_timeout;').fetchone()[0]
        assert val == DB_BUSY_TIMEOUT_MILLIS

    def test_commits_on_success(self, tmp_path):
        db_file = str(tmp_path / 'x.db')
        with db_ops(db_file) as cur:
            cur.execute('CREATE TABLE t(a INT)')
            cur.execute('INSERT INTO t VALUES (1)')
        with db_ops(db_file) as cur:
            assert cur.execute('SELECT COUNT(*) FROM t').fetchone()[0] == 1

    def test_rolls_back_on_error(self, tmp_path):
        db_file = str(tmp_path / 'x.db')
        with db_ops(db_file) as cur:
            cur.execute('CREATE TABLE t(a INT)')
        with pytest.raises(sqlite3.OperationalError), db_ops(db_file) as cur:
            cur.execute('INSERT INTO t VALUES (1)')
            cur.execute('INSERT INTO not_a_table VALUES (1)')
        with db_ops(db_file) as cur:
            assert cur.execute('SELECT COUNT(*) FROM t').fetchone()[0] == 0


class TestInsertAndFind:

    def _load(self, tmp_path, version='v1', entries=SAMPLE_ENTRIES):
        cat = make_catalogues(tmp_path)
        write_catalogue_json(cat._Catalogues__catalogue_file, entries)
        catalogue = cat._Catalogues__insert_catalogue(version)
        cat._Catalogues__catalogues = [catalogue]
        return cat

    def test_insert_returns_catalogue_with_count(self, tmp_path):
        cat = self._load(tmp_path)
        assert cat._Catalogues__catalogues[0].count == 3
        assert cat._Catalogues__catalogues[0].version == 'v1'

    def test_find_by_digest(self, tmp_path):
        cat = self._load(tmp_path)
        entry = cat.find_by_digest('digest-2')
        assert entry is not None
        assert entry.title == 'Beta Two'

    def test_find_by_digest_missing(self, tmp_path):
        cat = self._load(tmp_path)
        assert cat.find_by_digest('does-not-exist') is None

    def test_find_by_id(self, tmp_path):
        cat = self._load(tmp_path)
        entry = cat.find_by_id('v1_0')
        assert entry.title == 'Alpha One'


class TestSearch:

    def _load(self, tmp_path, version='v1', entries=SAMPLE_ENTRIES):
        cat = make_catalogues(tmp_path)
        write_catalogue_json(cat._Catalogues__catalogue_file, entries)
        catalogue = cat._Catalogues__insert_catalogue(version)
        cat._Catalogues__catalogues = [catalogue]
        return cat

    @staticmethod
    def _search(cat, authors=None, years=None, audio_types=None, content_types=None,
                tmdb_id=None, text=None, audio_codecs=None, audio_channel_counts=None):
        return cat.search(authors or [], years or [], audio_types or [], content_types or [],
                          tmdb_id, text, audio_codecs or [], audio_channel_counts or [], None, None)

    def test_no_filters_returns_all(self, tmp_path):
        cat = self._load(tmp_path)
        results = self._search(cat)
        assert len(results) == 3

    def test_filter_by_author(self, tmp_path):
        cat = self._load(tmp_path)
        results = self._search(cat, authors=['authorA'])
        assert {r['title'] for r in results} == {'Alpha One', 'Gamma Three'}

    def test_filter_by_year(self, tmp_path):
        cat = self._load(tmp_path)
        results = self._search(cat, years=[2010])
        assert [r['title'] for r in results] == ['Beta Two']

    def test_filter_by_text(self, tmp_path):
        cat = self._load(tmp_path)
        results = self._search(cat, text='beta')
        assert [r['title'] for r in results] == ['Beta Two']

    def test_filter_by_tmdb_id(self, tmp_path):
        cat = self._load(tmp_path)
        results = self._search(cat, tmdb_id='tt002')
        assert [r['title'] for r in results] == ['Beta Two']

    def test_filter_by_content_type(self, tmp_path):
        cat = self._load(tmp_path)
        results = self._search(cat, content_types=['TV'])
        assert [r['title'] for r in results] == ['Gamma Three']

    def test_scopes_to_latest_version_only(self, tmp_path):
        cat = self._load(tmp_path, version='v1', entries=SAMPLE_ENTRIES)
        write_catalogue_json(cat._Catalogues__catalogue_file, SAMPLE_ENTRIES[:1])
        catalogue2 = cat._Catalogues__insert_catalogue('v2')
        cat._Catalogues__catalogues.append(catalogue2)
        results = self._search(cat)
        assert len(results) == 1
        assert results[0]['title'] == 'Alpha One'


class TestPruneEntries:

    def _load_two_versions(self, tmp_path):
        cat = make_catalogues(tmp_path)
        write_catalogue_json(cat._Catalogues__catalogue_file, SAMPLE_ENTRIES)
        cat._Catalogues__insert_catalogue('old-version')
        write_catalogue_json(cat._Catalogues__catalogue_file, SAMPLE_ENTRIES[:1])
        cat._Catalogues__insert_catalogue('new-version')
        return cat

    @staticmethod
    def _versions(cat, table):
        with db_ops(cat._Catalogues__db) as cur:
            return {r[0] for r in cur.execute(f'SELECT DISTINCT version FROM {table}').fetchall()}

    def test_removes_entries_past_retention(self, tmp_path):
        cat = self._load_two_versions(tmp_path)
        old_loaded_at = int((datetime.now(UTC) - timedelta(days=2)).timestamp() * 1000)
        with db_ops(cat._Catalogues__db) as cur:
            cur.execute("UPDATE catalogue_entry SET loaded_at = ? WHERE version = 'old-version'",
                       (old_loaded_at,))
        cat._Catalogues__prune_entries('new-version')
        assert self._versions(cat, 'catalogue_entry') == {'new-version'}

    def test_keeps_entries_within_retention(self, tmp_path):
        cat = self._load_two_versions(tmp_path)
        cat._Catalogues__prune_entries('new-version')
        assert self._versions(cat, 'catalogue_entry') == {'old-version', 'new-version'}

    def test_meta_for_non_kept_versions_is_always_pruned(self, tmp_path):
        # catalogue_meta has no age condition - it is pruned for any version
        # other than keep_version, regardless of how recently it loaded.
        cat = self._load_two_versions(tmp_path)
        cat._Catalogues__prune_entries('new-version')
        assert self._versions(cat, 'catalogue_meta') == {'new-version'}


class TestPruneEntriesSafe:

    def test_swallows_and_logs_exceptions(self, tmp_path, caplog):
        cat = make_catalogues(tmp_path)

        def boom(keep_version):
            raise RuntimeError('boom')

        cat._Catalogues__prune_entries = boom
        with caplog.at_level(logging.ERROR, logger='ezbeq.catalogue'):
            cat._Catalogues__prune_entries_safe('v1')  # must not raise
        assert any('Failed to prune entries' in r.message for r in caplog.records)

    def test_delegates_to_prune_entries_on_success(self, tmp_path):
        cat = make_catalogues(tmp_path)
        received = {}

        def fake_prune(keep_version):
            received['version'] = keep_version

        cat._Catalogues__prune_entries = fake_prune
        cat._Catalogues__prune_entries_safe('some-version')
        assert received['version'] == 'some-version'


class TestPrunePool:

    def test_pool_created_lazily_and_uses_daemon_threads(self, tmp_path):
        cat = make_catalogues(tmp_path)
        assert cat._Catalogues__prune_pool is None
        pool = cat._Catalogues__get_prune_pool()
        try:
            assert cat._Catalogues__prune_pool is pool
            done = threading.Event()
            pool.callInThread(done.set)
            assert done.wait(timeout=2)
            assert pool.threads
            assert all(t.daemon for t in pool.threads)
        finally:
            pool.stop()

    def test_get_prune_pool_reuses_existing_pool(self, tmp_path):
        cat = make_catalogues(tmp_path)
        pool = cat._Catalogues__get_prune_pool()
        try:
            assert cat._Catalogues__get_prune_pool() is pool
        finally:
            pool.stop()

    def test_stop_is_safe_when_pool_never_created(self, tmp_path):
        cat = make_catalogues(tmp_path)
        cat._Catalogues__reload_task = types.SimpleNamespace(running=False, stop=lambda: None)
        cat.stop()  # must not raise even though the prune pool was never created

    def test_schedule_prune_dispatches_to_prune_entries_safe(self, tmp_path):
        cat = make_catalogues(tmp_path)
        done = threading.Event()
        received = {}

        def fake_prune_safe(keep_version):
            received['version'] = keep_version
            done.set()

        cat._Catalogues__prune_entries_safe = fake_prune_safe
        try:
            cat._Catalogues__schedule_prune('v9')
            assert done.wait(timeout=2)
            assert received['version'] == 'v9'
        finally:
            cat._Catalogues__get_prune_pool().stop()


class TestOnCatalogueUpdate:

    @staticmethod
    def _cat_with_ws(tmp_path):
        cat = make_catalogues(tmp_path)
        cat._Catalogues__ws = types.SimpleNamespace(broadcast=lambda msg: None)
        return cat

    def test_schedules_prune_when_a_stale_version_collapses_the_in_memory_list(self, tmp_path):
        # A single, already-day-old catalogue in memory is exactly the case that needs a DB
        # prune - but it also gets dropped from __catalogues by the same call, so the count
        # check must be taken before that drop, not after.
        cat = self._cat_with_ws(tmp_path)
        old = Catalogue(count=1, version='old-version', loaded_at=datetime.now(UTC) - timedelta(days=2))
        cat._Catalogues__catalogues = [old]
        received = {}
        cat._Catalogues__schedule_prune = lambda keep_version: received.setdefault('version', keep_version)

        new = Catalogue(count=1, version='new-version', loaded_at=datetime.now(UTC))
        cat._Catalogues__on_catalogue_update(new)

        assert [c.version for c in cat._Catalogues__catalogues] == ['new-version']
        assert received.get('version') == 'new-version'

    def test_does_not_schedule_prune_for_the_first_catalogue(self, tmp_path):
        cat = self._cat_with_ws(tmp_path)
        cat._Catalogues__catalogues = []
        received = {}
        cat._Catalogues__schedule_prune = lambda keep_version: received.setdefault('version', keep_version)

        new = Catalogue(count=1, version='v1', loaded_at=datetime.now(UTC))
        cat._Catalogues__on_catalogue_update(new)

        assert 'version' not in received

    def test_schedules_prune_when_a_recent_version_is_still_in_memory(self, tmp_path):
        cat = self._cat_with_ws(tmp_path)
        recent = Catalogue(count=1, version='recent-version', loaded_at=datetime.now(UTC))
        cat._Catalogues__catalogues = [recent]
        received = {}
        cat._Catalogues__schedule_prune = lambda keep_version: received.setdefault('version', keep_version)

        new = Catalogue(count=1, version='new-version', loaded_at=datetime.now(UTC))
        cat._Catalogues__on_catalogue_update(new)

        assert [c.version for c in cat._Catalogues__catalogues] == ['recent-version', 'new-version']
        assert received.get('version') == 'new-version'


class TestCatalogueStale:
    """
    All production code now builds Catalogue.loaded_at as timezone-aware UTC,
    but `stale` also tolerates a naive loaded_at defensively - these guard
    that fallback path explicitly.
    """

    def test_stale_with_naive_loaded_at(self):
        c = Catalogue(count=1, version='v1', loaded_at=datetime.now() - timedelta(minutes=10))  # noqa: DTZ005
        assert c.stale is True

    def test_not_stale_with_naive_loaded_at(self):
        c = Catalogue(count=1, version='v1', loaded_at=datetime.now())  # noqa: DTZ005
        assert c.stale is False

    def test_stale_with_aware_loaded_at(self):
        c = Catalogue(count=1, version='v1', loaded_at=datetime.now(UTC) - timedelta(minutes=10))
        assert c.stale is True

    def test_not_stale_with_aware_loaded_at(self):
        c = Catalogue(count=1, version='v1', loaded_at=datetime.now(UTC))
        assert c.stale is False


class TestComputeFreshness:

    def test_fresh(self):
        now = time.time()
        assert compute_freshness(now, now) == 'Fresh'

    def test_updated(self):
        now = time.time()
        old = now - TWO_WEEKS_AGO_SECONDS - 1000
        assert compute_freshness(old, now) == 'Updated'

    def test_stale(self):
        now = time.time()
        old = now - TWO_WEEKS_AGO_SECONDS - 1000
        assert compute_freshness(old, old) == 'Stale'


class TestDatabaseDownloader:

    def test_downloads_when_version_changes(self, httpserver: HTTPServer, tmp_path):
        cached_db = tmp_path / 'database.json'
        cached_version = tmp_path / 'version.txt'
        downloader = DatabaseDownloader(f'http://{httpserver.host}:{httpserver.port}/',
                                        str(cached_db), str(cached_version))
        assert downloader.run() is True
        assert downloader.version == '123456'
        assert cached_db.exists()
        assert cached_version.read_text() == '123456'

    def test_skips_when_version_unchanged(self, httpserver: HTTPServer, tmp_path):
        cached_db = tmp_path / 'database.json'
        cached_version = tmp_path / 'version.txt'
        cached_db.write_text('[]')
        cached_version.write_text('123456')
        downloader = DatabaseDownloader(f'http://{httpserver.host}:{httpserver.port}/',
                                        str(cached_db), str(cached_version))
        assert downloader.run() is False
