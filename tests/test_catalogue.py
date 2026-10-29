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
    FILTER_AUTHOR,
    TWO_WEEKS_AGO_SECONDS,
    Catalogue,
    Catalogues,
    CatalogueSourcesDownloader,
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

    def test_digest_prefers_latest_but_old_ids_remain_available(self, tmp_path):
        cat = self._load(tmp_path)
        write_catalogue_json(cat._Catalogues__catalogue_file, [dict(SAMPLE_ENTRIES[0], title='Updated')])
        cat._Catalogues__catalogues.append(cat._Catalogues__insert_catalogue('v2'))
        assert cat.find_by_digest('digest-1').title == 'Updated'
        assert cat.find_by_id('v1_0').title == 'Alpha One'


class TestFilterAuthor:

    def _load(self, tmp_path, entries, version='v1'):
        cat = make_catalogues(tmp_path)
        write_catalogue_json(cat._Catalogues__catalogue_file, entries)
        catalogue = cat._Catalogues__insert_catalogue(version)
        cat._Catalogues__catalogues = [catalogue]
        return cat, catalogue

    def test_filter_author_is_parsed_onto_the_entry(self, tmp_path):
        cat, _ = self._load(tmp_path, [
            {'title': 'Alpha One', 'year': '2001', 'audioTypes': ['DTS-HD MA 5.1'], 'content_type': 'film',
             'author': 'authorA', 'filterAuthor': 'groupA', 'digest': 'digest-1'},
        ])
        entry = cat.find_by_id('v1_0')
        assert entry.filter_author == 'groupA'

    def test_filter_author_defaults_to_empty_string_when_absent(self, tmp_path):
        cat, _ = self._load(tmp_path, [
            {'title': 'Alpha One', 'year': '2001', 'audioTypes': ['DTS-HD MA 5.1'], 'content_type': 'film',
             'author': 'authorA', 'digest': 'digest-1'},
        ])
        entry = cat.find_by_id('v1_0')
        assert entry.filter_author == ''

    def test_filter_author_meta_collects_distinct_values(self, tmp_path):
        _, catalogue = self._load(tmp_path, [
            {'title': 'Alpha One', 'year': '2001', 'audioTypes': ['DTS-HD MA 5.1'], 'content_type': 'film',
             'author': 'authorA', 'filterAuthor': 'groupA', 'digest': 'digest-1'},
            {'title': 'Beta Two', 'year': '2010', 'audioTypes': ['TrueHD 7.1'], 'content_type': 'film',
             'author': 'authorB', 'filterAuthor': 'groupB', 'digest': 'digest-2'},
            {'title': 'Gamma Three', 'year': '2015', 'audioTypes': ['DTS-HD MA 5.1'], 'content_type': 'TV',
             'author': 'authorA', 'digest': 'digest-3', 'season': '1', 'episode': '1,2,3'},
        ])
        assert catalogue.meta[FILTER_AUTHOR] == {'groupA', 'groupB'}


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


class TestSendChunkedCatalogue:

    @staticmethod
    def _cat(tmp_path, monkeypatch, entries):
        from twisted.internet import defer, threads
        monkeypatch.setattr(threads, 'deferToThread', lambda f: defer.succeed(f()))
        cat = make_catalogues(tmp_path)
        cat._Catalogues__chunk_sizes = (1, 2)
        write_catalogue_json(cat._Catalogues__catalogue_file, entries)
        cat._Catalogues__catalogues = [cat._Catalogues__insert_catalogue('v1')]
        return cat

    def test_sends_every_entry_in_chunks(self, tmp_path, monkeypatch):
        cat = self._cat(tmp_path, monkeypatch, SAMPLE_ENTRIES)
        sent = []

        cat._Catalogues__send_chunked_catalogue(lambda msg: sent.append(json.loads(msg)) or True)

        assert [len(m['data']) for m in sent] == [1, 2]
        assert all(m['message'] == 'CatalogueEntries' for m in sent)
        assert sorted(e['title'] for m in sent for e in m['data']) == ['Alpha One', 'Beta Two', 'Gamma Three']

    def test_stops_once_the_client_has_gone(self, tmp_path, monkeypatch):
        cat = self._cat(tmp_path, monkeypatch, SAMPLE_ENTRIES)
        sent = []

        cat._Catalogues__send_chunked_catalogue(lambda msg: sent.append(msg) and False)

        assert len(sent) == 1

    def test_sends_nothing_for_an_empty_catalogue(self, tmp_path, monkeypatch):
        cat = self._cat(tmp_path, monkeypatch, [])
        sent = []

        cat._Catalogues__send_chunked_catalogue(lambda msg: sent.append(msg) or True)

        assert sent == []


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
        c = Catalogue(count=1, version='v1', loaded_at=datetime.now() - timedelta(minutes=10))
        assert c.stale is True

    def test_not_stale_with_naive_loaded_at(self):
        c = Catalogue(count=1, version='v1', loaded_at=datetime.now())
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


class TestCatalogueSourcesDownloader:

    def downloader(self, tmp_path, sources):
        cache = tmp_path / 'cache'
        cache.mkdir(exist_ok=True)
        return CatalogueSourcesDownloader(sources, str(cache / 'database.json'), str(cache / 'version.txt'))

    def test_combines_remote_and_local_and_deduplicates(self, httpserver, tmp_path):
        httpserver.expect_request('/extra/version.txt').respond_with_data('v1')
        httpserver.expect_request('/extra/database.json').respond_with_json(SAMPLE_ENTRIES[:2])
        local = tmp_path / 'local.json'
        write_catalogue_json(local, [dict(SAMPLE_ENTRIES[1], title='Duplicate'), SAMPLE_ENTRIES[2]])
        sources = [httpserver.url_for('/extra/'), str(local)]
        downloader = self.downloader(tmp_path, sources)
        assert downloader.run()
        assert json.loads(downloader.database.read_text()) == SAMPLE_ENTRIES
        version = downloader.version
        assert not self.downloader(tmp_path, sources).run()
        write_catalogue_json(local, [dict(SAMPLE_ENTRIES[2], title='Edited')])
        assert downloader.run()
        assert downloader.version != version
        assert json.loads(downloader.database.read_text())[-1]['title'] == 'Edited'
        # Remote content stays cached when its version has not changed.
        assert len([r for r, _ in httpserver.log if r.path == '/extra/database.json']) == 1

    def test_remote_without_version_and_outage(self, httpserver, tmp_path):
        httpserver.expect_request('/unversioned/version.txt').respond_with_data('', status=404)
        httpserver.expect_request('/unversioned/database.json').respond_with_json(SAMPLE_ENTRIES[:1])
        sources = [httpserver.url_for('/unversioned/')]
        downloader = self.downloader(tmp_path, sources)
        assert downloader.run()
        httpserver.clear()
        httpserver.expect_request('/unversioned/version.txt').respond_with_data('', status=404)
        httpserver.expect_request('/unversioned/database.json').respond_with_json(SAMPLE_ENTRIES[1:])
        assert downloader.run()
        assert json.loads(downloader.database.read_text()) == SAMPLE_ENTRIES[1:]
        httpserver.clear()
        httpserver.expect_request('/unversioned/version.txt').respond_with_data('', status=503)
        httpserver.expect_request('/unversioned/database.json').respond_with_data('', status=503)
        downloader = self.downloader(tmp_path, sources)
        assert not downloader.run()
        assert json.loads(downloader.database.read_text()) == SAMPLE_ENTRIES[1:]

    def test_entries_without_digest_are_retained(self, tmp_path):
        local = tmp_path / 'local.json'
        entries = [{'title': 'First'}, {'title': 'Second'}]
        write_catalogue_json(local, entries)
        downloader = self.downloader(tmp_path, [str(local)])
        assert downloader.run()
        assert json.loads(downloader.database.read_text()) == entries

    def test_local_deletions_and_empty_catalogue(self, tmp_path):
        local = tmp_path / 'local.json'
        write_catalogue_json(local, SAMPLE_ENTRIES)
        downloader = self.downloader(tmp_path, [local.as_uri()])
        assert downloader.run()
        write_catalogue_json(local, SAMPLE_ENTRIES[:1])
        assert downloader.run()
        assert json.loads(downloader.database.read_text()) == SAMPLE_ENTRIES[:1]
        write_catalogue_json(local, [])
        assert downloader.run()
        assert json.loads(downloader.database.read_text()) == []

    @pytest.mark.parametrize('failure', ['missing', 'malformed', 'wrong-shape'])
    def test_failure_retains_last_good_source_while_others_refresh(self, tmp_path, failure):
        first = tmp_path / 'first.json'
        second = tmp_path / 'second.json'
        write_catalogue_json(first, SAMPLE_ENTRIES[:1])
        write_catalogue_json(second, SAMPLE_ENTRIES[1:2])
        sources = [str(first), str(second)]
        assert self.downloader(tmp_path, sources).run()
        if failure == 'missing':
            first.unlink()
        else:
            first.write_text('broken' if failure == 'malformed' else '{}')
        write_catalogue_json(second, SAMPLE_ENTRIES[2:])
        downloader = self.downloader(tmp_path, sources)
        assert downloader.run()
        assert json.loads(downloader.database.read_text()) == [SAMPLE_ENTRIES[0], SAMPLE_ENTRIES[2]]

    def test_relative_directory_and_source_removal(self, tmp_path):
        downloader = self.downloader(tmp_path, ['local', str(tmp_path / 'second.json')])
        directory = downloader.database.parent / 'local'
        directory.mkdir()
        write_catalogue_json(directory / 'database.json', SAMPLE_ENTRIES[:1])
        write_catalogue_json(tmp_path / 'second.json', SAMPLE_ENTRIES[1:])
        assert downloader.run()
        downloader = self.downloader(tmp_path, ['local'])
        assert downloader.run()
        assert json.loads(downloader.database.read_text()) == SAMPLE_ENTRIES[:1]

    def test_merged_catalogue_search_and_lookup(self, tmp_path):
        first = tmp_path / 'first.json'
        second = tmp_path / 'second.json'
        write_catalogue_json(first, SAMPLE_ENTRIES[:1])
        write_catalogue_json(second, SAMPLE_ENTRIES[1:])
        downloader = CatalogueSourcesDownloader([str(first), str(second)],
                                                str(tmp_path / 'database.json'), str(tmp_path / 'version.txt'))
        assert downloader.run()
        cat = make_catalogues(tmp_path)
        catalogue = cat._Catalogues__insert_catalogue(downloader.version)
        cat._Catalogues__catalogues = [catalogue]
        assert catalogue.count == 3
        assert catalogue.meta['author'] == {'authorA', 'authorB'}
        assert cat.find_by_digest('digest-3').title == 'Gamma Three'

    def test_reverted_content_does_not_duplicate_entries(self, tmp_path):
        cat = make_catalogues(tmp_path)
        write_catalogue_json(tmp_path / 'database.json', SAMPLE_ENTRIES)
        cat._Catalogues__insert_catalogue('original')
        cat._Catalogues__insert_catalogue('edited')
        cat._Catalogues__insert_catalogue('original')
        with db_ops(cat._Catalogues__db) as cur:
            assert cur.execute("SELECT count(*) FROM catalogue_entry WHERE version = 'original'").fetchone()[0] == 3

    def test_startup_loads_changed_cached_version_and_empty_catalogue(self, tmp_path):
        cat = make_catalogues(tmp_path)
        write_catalogue_json(tmp_path / 'database.json', SAMPLE_ENTRIES)
        cat._Catalogues__insert_catalogue('original')
        cat._Catalogues__schedule_prune = lambda version: None
        write_catalogue_json(tmp_path / 'database.json', SAMPLE_ENTRIES[:1])
        (tmp_path / 'version.txt').write_text('changed')
        loaded = cat._Catalogues__load_catalogues()
        assert loaded[-1].version == 'changed'
        assert loaded[-1].count == 1
        with db_ops(cat._Catalogues__db) as cur:
            assert cur.execute("SELECT count(*) FROM catalogue_entry WHERE version = 'changed'").fetchone()[0] == 1
        write_catalogue_json(tmp_path / 'database.json', [])
        (tmp_path / 'version.txt').write_text('empty')
        cat._Catalogues__catalogues = cat._Catalogues__load_catalogues()
        assert cat.loaded
        assert cat.latest.version == 'empty'
        assert cat.latest.count == 0
