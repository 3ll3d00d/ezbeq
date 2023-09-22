import json
import logging
import os
import sqlite3
import time
from contextlib import contextmanager
from dataclasses import dataclass, field
from datetime import datetime, timedelta
from typing import Optional, List, Callable, Union, Set

import ijson
import requests

from ezbeq.apis.ws import WsServer
from ezbeq.config import Config
from ezbeq import to_millis

logger = logging.getLogger('ezbeq.catalogue')

ID = 'id'
TITLE = 'title'
YEAR = 'year'
AUDIO_TYPES = 'audioTypes'
CONTENT_TYPE = 'content_type'
AUTHOR = 'author'
CATALOGUE_URL = 'catalogue_url'
FILTERS = 'filters'
IMAGES = 'images'
WARNING = 'warning'
SEASON = 'season'
EPISODE = 'episode'
AVS_URL = 'avs'
SORT_TITLE = 'sortTitle'
EDITION = 'edition'
NOTE = 'note'
LANGUAGE = 'language'
SOURCE = 'source'
OVERVIEW = 'overview'
THE_MOVIE_DB = 'theMovieDB'
RATING = 'rating'
GENRES = 'genres'
ALT_TITLE = 'altTitle'
CREATED_AT = 'created_at'
UPDATED_AT = 'updated_at'
DIGEST = 'digest'
COLLECTION_ID = 'collection_id'
COLLECTION = 'collection'
FORMATTED_TITLE = 'formattedTitle'
RUNTIME = 'runtime'
MV_ADJUST = 'mv'
FRESHNESS = 'freshness'

TWO_WEEKS_AGO_SECONDS = 2 * 7 * 24 * 60 * 60

FIELDS = [
    ID,
    TITLE,
    YEAR,
    AUDIO_TYPES,
    CONTENT_TYPE,
    AUTHOR,
    CATALOGUE_URL,
    FILTERS,
    IMAGES,
    WARNING,
    SEASON,
    EPISODE,
    AVS_URL,
    SORT_TITLE,
    EDITION,
    NOTE,
    LANGUAGE,
    SOURCE,
    OVERVIEW,
    THE_MOVIE_DB,
    RATING,
    GENRES,
    ALT_TITLE,
    CREATED_AT,
    UPDATED_AT,
    DIGEST,
    COLLECTION_ID,
    COLLECTION,
    RUNTIME,
    MV_ADJUST,
    FORMATTED_TITLE
]

IGNORE_FIELDS = [FILTERS, DIGEST]

UI_FIELDS = [x for x in FIELDS if x not in IGNORE_FIELDS]

META_FIELDS = [
    AUDIO_TYPES,
    AUTHOR,
    CONTENT_TYPE,
    LANGUAGE,
    YEAR
]

FIELDS_STR = ','.join(FIELDS)
UI_FIELDS_STR = ','.join(UI_FIELDS)


class CatalogueEntry:

    def __init__(self, idx: str, vals: dict):
        self.id = idx
        self.title = vals.get(TITLE, '')
        y = 0
        try:
            y = int(vals.get(YEAR, 0))
        except:
            logger.error(f"Invalid year {vals.get(YEAR, 0)} in {self.title}")
        self.year = y

        def split_list(v):
            return v[1:-1].split('|') if isinstance(v, str) else v

        self.audio_types = split_list(vals.get(AUDIO_TYPES, []))
        self.content_type = vals.get(CONTENT_TYPE, 'film')
        self.author = vals.get(AUTHOR, '')
        self.catalogue_url = vals.get(CATALOGUE_URL, '')
        f = vals.get(FILTERS, [])
        self.filters = json.loads(f) if isinstance(f, str) else f
        self.images = split_list(vals.get(IMAGES, []))
        self.warning = split_list(vals.get(WARNING, []))
        self.season = vals.get(SEASON, '')
        self.episodes = vals.get(EPISODE, '')
        self.avs_url = vals.get(AVS_URL, '')
        self.sort_title = vals.get(SORT_TITLE, '')
        self.edition = vals.get(EDITION, '')
        self.note = vals.get(NOTE, '')
        self.language = vals.get(LANGUAGE, '')
        self.source = vals.get(SOURCE, '')
        self.overview = vals.get(OVERVIEW, '')
        self.the_movie_db = vals.get(THE_MOVIE_DB, '')
        self.rating = vals.get(RATING, '')
        self.genres = split_list(vals.get(GENRES, []))
        self.alt_title = vals.get(ALT_TITLE, '')
        self.created_at = vals.get(CREATED_AT, 0)
        self.updated_at = vals.get(UPDATED_AT, 0)
        self.digest = vals.get(DIGEST, '')
        c = vals.get(COLLECTION, None)
        if isinstance(c, dict):
            self.collection_id = c.get('id', None)
            self.collection_name = c.get('name', None)
        elif isinstance(c, str):
            self.collection_id = vals.get(COLLECTION_ID)
            self.collection_name = c
        else:
            self.collection_id = None
            self.collection_name = None
        self.formatted_title = self.__format_title()
        try:
            r = int(vals.get(RUNTIME, 0))
        except:
            logger.error(f"Invalid runtime {vals.get('runtime', 0)} in {self.title}")
            r = 0
        self.runtime = r
        self.mv_adjust = 0.0
        if 'mv' in vals:
            v = vals['mv']
            try:
                self.mv_adjust = float(v)
            except:
                logger.error(f"Unknown mv_adjust value in {self.title} - {vals['mv']}")
        self.freshness = compute_freshness(self.created_at, self.updated_at)

    @staticmethod
    def __format_episodes(formatted, working):
        val = ''
        if len(formatted) > 1:
            val += ', '
        if len(working) == 1:
            val += working[0]
        else:
            val += f"{working[0]}-{working[-1]}"
        return val

    def __format_tv_meta(self):
        season = f"S{self.season}" if self.season else ''
        episodes = self.episodes.split(',') if self.episodes else None
        if episodes:
            formatted = 'E'
            if len(episodes) > 1:
                working = []
                last_value = 0
                for ep in episodes:
                    if len(working) == 0:
                        working.append(ep)
                        last_value = int(ep)
                    else:
                        current = int(ep)
                        if last_value == current - 1:
                            working.append(ep)
                        else:
                            formatted += self.__format_episodes(formatted, working)
                            working = [ep]
                        last_value = current
                if len(working) > 0:
                    formatted += self.__format_episodes(formatted, working)
            else:
                formatted += f"{self.episodes}"
            return f"{season}{formatted}"
        return season

    def __format_title(self) -> str:
        if self.content_type == 'TV':
            return f"{self.title} {self.__format_tv_meta()}"
        return self.title

    @property
    def values(self) -> tuple:
        def format_list(vals) -> str:
            return "|" + '|'.join(vals) + "|" if vals else ""

        return (
            self.id,
            self.title,
            self.year,  # int
            format_list(self.audio_types),
            self.content_type,  # 5
            self.author,
            self.catalogue_url,
            json.dumps(self.filters),  # json
            format_list(self.images),
            format_list(self.warning),  # 10
            self.season,
            self.episodes,
            self.avs_url,
            self.sort_title,
            self.edition,  # 15
            self.note,
            self.language,
            self.source,
            self.overview,
            self.the_movie_db,  # 20
            self.rating,
            format_list(self.genres),
            self.alt_title,
            self.created_at,  # int
            self.updated_at,  # 25 int
            self.digest,
            self.collection_id,
            self.collection_name,
            self.runtime,  # int
            self.mv_adjust,  # 30 float
            self.formatted_title
        )

    def __repr__(self):
        return f"[{self.content_type}] {self.title} / {self.audio_types} / {self.year}"


@dataclass
class Catalogue:
    count: int
    version: str
    meta: dict = None
    loaded_at: datetime = None

    @property
    def stale(self):
        return (datetime.now() - self.loaded_at) > timedelta(minutes=5)

    def json(self) -> dict:
        return {
            'version': self.version,
            'loaded': int(self.loaded_at.timestamp()),
            'count': self.count
        }

    @property
    def meta_msg(self) -> str:
        return json.dumps({'message': 'Catalogue', 'data': self.json()})


class Catalogues:
    def __init__(self, config_path: str, catalogue_url: str, ws: WsServer, refresh_seconds: float,
                 first_chunk_size: int, chunk_size: int, sync_load: bool):
        self.__catalogue_url = catalogue_url
        self.__version_file = os.path.join(config_path, 'version.txt')
        self.__catalogue_file = os.path.join(config_path, 'database.json')
        self.__db = os.path.join(config_path, 'ezbeq.db')
        self.__chunk_sizes = (first_chunk_size, chunk_size)
        logger.info(f'Using database at {self.__db}')
        self.__ensure_db()
        self.__refresh_interval = refresh_seconds
        self.__last_refresh_check: float = 0
        self.__ws = ws
        self.__ws.factory.init_meta_provider(lambda: self.latest.meta_msg if self.latest else None)
        self.__ws.factory.init_catalogue_loader(self.__send_chunked_catalogue)
        if sync_load:
            self.__download()
        self.__catalogues = self.__load_catalogues()
        if self.__catalogues:
            self.__ws.broadcast(self.__catalogues[-1].meta_msg)
        logger.info(f'Scheduling reload to run every {self.__refresh_interval}s')
        from twisted.internet import task
        self.__reload_task = task.LoopingCall(self.__reload)
        self.__reload_task.start(self.__refresh_interval, now=True)

    def __send_chunked_catalogue(self, sender: Callable[[str], None]):
        catalogue = self.latest
        if not catalogue:
            return
        vals = {'count': catalogue.count, 'limit': self.__chunk_sizes[0], 'offset': 0, 'start': time.time()}
        from twisted.internet import threads
        threads.deferToThread(lambda: self.__load_next_chunk(sender, catalogue.version, **vals)).addCallback(sender)

    def __load_next_chunk(self, publisher: Callable[[str], None], version: str, count: int = 100, limit: int = 500,
                          offset: int = 0, start: float = 0) -> str:
        if offset >= count:
            logger.info(f'Load complete for {version} in {to_millis(start, time.time())}ms')
        else:
            begin = time.time()
            next_offset = offset + limit
            select = f"SELECT {UI_FIELDS_STR} FROM catalogue_entry WHERE version = '{version}'"
            msg = json.dumps({
                'message': 'CatalogueEntries',
                'data': self.__fetch_entries(select, UI_FIELDS, limit, offset)
            }, ensure_ascii=False)
            end = time.time()
            logger.info(f'Loaded chunk from {offset} to {next_offset} in {to_millis(begin, end)}ms')
            vals = {'count': count, 'limit': self.__chunk_sizes[1], 'offset': next_offset, 'start': start}
            from twisted.internet import threads
            threads.deferToThread(lambda: self.__load_next_chunk(publisher, version, **vals)).addCallback(publisher)
            return msg

    def __ensure_db(self):
        with db_ops(self.__db) as cur:
            cur.execute("CREATE TABLE IF NOT EXISTS catalogue_entry("
                        f"{ID} TEXT PRIMARY KEY, "
                        f"{TITLE} TEXT, "
                        f"{YEAR} INT, "
                        f"{AUDIO_TYPES} TEXT, "
                        f"{CONTENT_TYPE} TEXT, "
                        f"{AUTHOR} TEXT, "
                        f"{CATALOGUE_URL} TEXT, "
                        f"{FILTERS} TEXT, "
                        f"{IMAGES} TEXT, "
                        f"{WARNING} TEXT, "
                        f"{SEASON} TEXT, "
                        f"{EPISODE} TEXT, "
                        f"{AVS_URL} TEXT, "
                        f"{SORT_TITLE} TEXT, "
                        f"{EDITION} TEXT, "
                        f"{NOTE} TEXT, "
                        f"{LANGUAGE} TEXT, "
                        f"{SOURCE} TEXT, "
                        f"{OVERVIEW} TEXT, "
                        f"{THE_MOVIE_DB} TEXT, "
                        f"{RATING} TEXT, "
                        f"{GENRES} TEXT, "
                        f"{ALT_TITLE} TEXT, "
                        f"{CREATED_AT} INT, "
                        f"{UPDATED_AT} INT, "
                        f"{DIGEST} TEXT NOT NULL, "
                        f"{COLLECTION_ID} TEXT, "
                        f"{COLLECTION} TEXT, "
                        f"{FORMATTED_TITLE} TEXT, "
                        f"{RUNTIME} INT, "
                        f"{MV_ADJUST} FLOAT, "
                        f"version TEXT NOT NULL, "
                        f"loaded_at INT NOT NULL"
                        ");")
            cur.execute(f"CREATE INDEX IF NOT EXISTS entry_digest ON catalogue_entry ({DIGEST});")
            cur.execute("CREATE TABLE IF NOT EXISTS catalogue_meta("
                        "meta_type TEXT NOT NULL, "
                        "value TEXT NOT NULL, "
                        "version TEXT NOT NULL"
                        ");")
            cur.execute("CREATE INDEX IF NOT EXISTS meta_key ON catalogue_meta (meta_type, version);")

    def __get_latest_catalogue_version(self):
        with db_ops(self.__db) as cur:
            res = cur.execute("SELECT DISTINCT version "
                              "FROM catalogue_entry "
                              "WHERE loaded_at = (SELECT max(loaded_at) FROM catalogue_entry);").fetchone()
            return res[0] if res else None

    def __load_catalogues(self) -> List[Catalogue]:
        with db_ops(self.__db) as cur:
            res = cur.execute("SELECT version, MAX(loaded_at), COUNT(id) FROM catalogue_entry GROUP BY version")
            catalogues = [Catalogue(row[2], row[0], loaded_at=datetime.utcfromtimestamp(row[1] / 1000)) for row in
                          res.fetchall()]
            loaded = 0
            if catalogues:
                loaded = 1
                logger.info(f"{len(catalogues)} versions available in {self.__db}")
                v = catalogues[-1].version
                catalogues[-1].meta = {t: self.load_meta(v, t) for t in META_FIELDS}
                if len(catalogues) > 1:
                    self.__prune_entries(catalogues[-1].version)
                for f, vals in catalogues[-1].meta.items():
                    if not vals:
                        logger.warning(f'No meta values found for {f} in catalogue {v}, will reload from disk')
                        loaded = 2
            if loaded != 1:
                try:
                    if os.path.exists(self.__catalogue_file) and os.path.exists(self.__version_file):
                        with open(self.__version_file) as f:
                            catalogue = self.__insert_catalogue(f.read().strip(), meta_only=loaded == 2)
                            if catalogue:
                                catalogues.append(catalogue)
                except:
                    logger.exception(
                        f'Failed to load catalogue at startup from {self.__catalogue_file} into {self.__db}')
        return catalogues

    def __insert_catalogue(self, version: str, meta_only: bool = False) -> Optional[Catalogue]:
        now = int(datetime.now().timestamp() * 1000)
        audio_types = set()
        authors = set()
        contenttypes = set()
        languages = set()
        years = set()
        extra_vals: tuple = (version, now)
        with open(self.__catalogue_file, 'rb') as infile:
            with db_ops(self.__db) as cur:
                values = []
                count = 0
                insert_sql = f"INSERT INTO catalogue_entry({FIELDS_STR},version,loaded_at) VALUES({', '.join(['?'] * (len(FIELDS) + 2))})"
                start = time.time()
                for idx, c in enumerate(ijson.items(infile, 'item', use_float=True)):
                    count = count + 1
                    entry = CatalogueEntry(f"{version}_{idx}", c)
                    for v in entry.audio_types:
                        audio_types.add(v)
                    if entry.author:
                        authors.add(entry.author)
                    if entry.content_type:
                        contenttypes.add(entry.content_type)
                    if entry.language:
                        languages.add(entry.language)
                    if entry.year:
                        years.add(entry.year)
                    values.append(entry.values + extra_vals)
                    if len(values) % 100 == 0 and not meta_only:
                        cur.executemany(insert_sql, values)
                        cur.connection.commit()
                        values = []
                if values and not meta_only:
                    cur.executemany(insert_sql, values)
                    cur.connection.commit()
                if not meta_only:
                    logger.info(
                        f'Inserted {count} entries into {self.__db} for version {version} in {to_millis(start, time.time())}ms')

                def insert_if(meta_type: str, vals: set):
                    if vals:
                        cur.executemany("INSERT INTO catalogue_meta VALUES(?, ?, ?)",
                                        [(meta_type, v, version) for v in vals])
                        logger.info(f'Inserted {len(vals)} {meta_type} entries into {self.__db} for version {version}')
                        cur.connection.commit()

                insert_if(AUDIO_TYPES, audio_types)
                insert_if(AUTHOR, authors)
                insert_if(CONTENT_TYPE, contenttypes)
                insert_if(LANGUAGE, languages)
                insert_if(YEAR, years)

                return Catalogue(count, version, {AUDIO_TYPES: audio_types, AUTHOR: authors, CONTENT_TYPE: contenttypes,
                                                  LANGUAGE: languages, YEAR: years},
                                 datetime.utcfromtimestamp(now / 1000)) if count else None

    def load_meta(self, version: str, meta_type: str) -> List[str]:
        with db_ops(self.__db) as cur:
            before = time.time()
            res = cur.execute(
                f"SELECT DISTINCT value FROM catalogue_meta WHERE version = '{version}' AND meta_type = '{meta_type}';")
            values = [row[0] for row in res.fetchmany(size=1000)]
            after = time.time()
            logger.info(f'Loaded {len(values)} {meta_type} entries from db in {to_millis(before, after)} ms')
            return values

    @property
    def latest(self) -> Optional[Catalogue]:
        return self.__catalogues[-1] if self.loaded else None

    def find_version(self, version: str) -> Optional[Catalogue]:
        return next((i for i in self.__catalogues if i.version == version), None)

    @property
    def loaded(self) -> bool:
        if not self.__catalogues:
            return False
        current = self.__catalogues[-1]
        return current.version != '' and current.count

    def __download(self):
        downloader = DatabaseDownloader(self.__catalogue_url, self.__catalogue_file, self.__version_file)
        reload_required = downloader.run()
        return downloader.version, reload_required

    def __reload(self):
        now = time.time()
        since_last = now - self.__last_refresh_check
        if since_last < 60:
            logger.debug(f'Suppressing reload check, {since_last:.3g}s since last check')
            return

        prefix = 'Rel' if self.loaded else 'L'
        logger.debug(f'{prefix}oading catalogue')
        version, reload_required = self.__download()
        if reload_required or not self.loaded:
            if os.path.exists(self.__catalogue_file):

                def on_cat(c):
                    if c:
                        self.__on_catalogue_update(c)

                from twisted.internet import threads
                threads.deferToThread(lambda: self.__insert_catalogue(version)).addCallback(on_cat)
            else:
                raise ValueError(f"No catalogue available at {self.__catalogue_file}")
        else:
            logger.debug(f"No {prefix.lower()}oad required")
        self.__last_refresh_check = now

    def __on_catalogue_update(self, catalogue: Catalogue):
        logger.info(f'Caching fresh catalogue {catalogue.version}')
        self.__catalogues.append(catalogue)
        one_day_ago = datetime.now() - timedelta(days=1)
        old_versions = [c.version for c in self.__catalogues if c.loaded_at and c.loaded_at < one_day_ago]
        self.__catalogues = [i for i in self.__catalogues if i.version not in old_versions]
        self.__ws.broadcast(catalogue.meta_msg)
        if len(self.__catalogues) > 1:
            self.__prune_entries(self.__catalogues[-1].version)

    def __prune_entries(self, keep_version: str):
        min_loaded_at = int((datetime.now() - timedelta(days=1)).timestamp() * 1000)
        logger.info(f'Pruning catalogues older than {datetime.fromtimestamp(min_loaded_at / 1000).strftime("%c")} except version {keep_version}')
        with db_ops(self.__db) as cur:
            before = time.time()
            cur.execute(f"DELETE FROM catalogue_entry WHERE loaded_at <= {min_loaded_at} AND version <> '{keep_version}';")
            entries_deleted = cur.rowcount
            cur.connection.commit()
            cur.execute(
                f"DELETE FROM catalogue_meta WHERE version <> '{keep_version}';")
            meta_deleted = cur.rowcount
            cur.connection.commit()
            end = time.time()
            if entries_deleted or meta_deleted:
                logger.info(f'Pruned {entries_deleted} entries and {meta_deleted} meta in {to_millis(before, end)}ms')
            else:
                logger.info(f'Nothing to prune')

    def refresh_if_stale(self):
        if not self.loaded or self.latest.stale:
            try:
                self.__reload()
            except Exception as e:
                logger.exception(f"Failed to refresh catalogue", e)

    def find_by_id(self, entry_id: str, as_dict: bool = False) -> Optional[Union[CatalogueEntry, dict]]:
        return self.__find(f"{ID} = '{entry_id}'", as_dict)

    def find_by_digest(self, digest: str, as_dict: bool = False) -> Optional[Union[CatalogueEntry, dict]]:
        return self.__find(f"{DIGEST} = '{digest}'", as_dict)

    def __find(self, clause: str, as_dict: bool) -> Optional[Union[CatalogueEntry, dict]]:
        catalogue = self.latest
        if not catalogue:
            return None
        sql = f"SELECT {FIELDS_STR} FROM catalogue_entry WHERE {clause}"
        results = self.__fetch_entries(sql, FIELDS, 1)
        if results:
            return results[0] if as_dict else CatalogueEntry(results[0][ID], results[0])
        else:
            return None

    def search(self, authors: List[str], years: List[int], audio_types: List[str], content_types: List[str],
               tmdb_id: str, text: Optional[str], fields: List[str], limit: Optional[int]) -> List[dict]:
        catalogue = self.latest
        if not catalogue:
            return []
        if fields:
            fields_str = ','.join(fields)
        else:
            fields = FIELDS
            fields_str = FIELDS_STR

        sql = f"SELECT {fields_str} FROM catalogue_entry WHERE version = '{catalogue.version}'"

        def in_clause(vals: List[str], field: str) -> str:
            filt = '"' + '","'.join(vals) + '"'
            return f'{field} IN ({filt})'

        if authors:
            sql = f'{sql} AND {in_clause(authors, AUTHOR)}'
        if years:
            sql = f'{sql} AND {YEAR} IN ({",".join([str(y) for y in years])})'
        if audio_types:
            if len(audio_types) == 1:
                sql = f'{sql} AND {AUDIO_TYPES} LIKE "%|{audio_types[0]}|%"'
            else:
                sql = f'{sql} AND ('
                for idx, audio_type in enumerate(audio_types):
                    prefix = ' OR ' if idx != 0 else ' '
                    sql = f'{sql}{prefix}{AUDIO_TYPES} LIKE "%|{audio_type}|%"'
                sql = f'{sql})'
        if content_types:
            sql = f'{sql} AND {in_clause(content_types, CONTENT_TYPE)}'
        if tmdb_id:
            sql = f'{sql} AND {THE_MOVIE_DB} = "{tmdb_id}"'
        if text:
            t = text.lower()
            sql = (f'{sql} AND ('
                   f'LOWER({FORMATTED_TITLE}) LIKE "%{t}%" OR '
                   f'LOWER({ALT_TITLE}) LIKE "%{t}%" OR '
                   f'LOWER({COLLECTION}) LIKE "%{t}%"'
                   ')')
        return self.__fetch_entries(sql, fields, limit)

    def __fetch_entries(self, select: str, fields: List[str], limit: Optional[int], offset: Optional[int] = None) -> \
            List[dict]:
        if limit:
            select = f'{select} LIMIT {limit}'
        if offset:
            select = f'{select} OFFSET {offset}'

        def reformat(i, v):
            f = fields[i]
            is_list = f == AUDIO_TYPES or f == IMAGES or f == WARNING or f == GENRES
            if is_list:
                return [x for x in v[1:-1].split('|') if x] if v else []
            elif f == FILTERS:
                return json.loads(v)
            else:
                return v if v is not None else ''

        with db_ops(self.__db) as cur:
            before = time.time()
            logger.debug(f'>>> {select}')
            entries: List[dict] = []
            res = cur.execute(select)
            for row in res.fetchmany(size=limit if limit else 20000):
                vals = {k: v for k, v in {fields[i]: reformat(i, r) for i, r in enumerate(row)}.items() if v}
                if UPDATED_AT in vals and CREATED_AT in vals:
                    vals[FRESHNESS] = compute_freshness(vals[CREATED_AT], vals[UPDATED_AT])
                else:
                    vals[FRESHNESS] = 'Unknown'
                # compatibility hacks
                if CONTENT_TYPE in vals:
                    vals['contentType'] = vals[CONTENT_TYPE]
                if MV_ADJUST in vals:
                    vals['mvAdjust'] = vals[MV_ADJUST]
                entries.append(vals)
            after = time.time()
            logger.info(f'Loaded {len(entries)} entries from db in {to_millis(before, after)} ms')
            return entries


class CatalogueProvider:

    def __init__(self, config: Config, ws: WsServer):
        self.__catalogues: Catalogues = Catalogues(config.config_path,
                                                   config.beqcatalogue_url,
                                                   ws,
                                                   config.catalogue_refresh_interval,
                                                   config.first_chunk_size,
                                                   config.chunk_size,
                                                   config.load_catalogue_at_startup)

    def find(self, entry_id: str, match_on_idx: Optional[bool] = None, as_dict: bool = False) -> Optional[
        Union[CatalogueEntry, dict]]:
        v = None
        if match_on_idx is None or match_on_idx is True:
            v = self.__catalogues.find_by_id(entry_id, as_dict)
        if not v:
            v = self.__catalogues.find_by_digest(entry_id, as_dict)
        return v

    @property
    def catalogue(self) -> Optional[Catalogue]:
        return self.__catalogues.latest

    @property
    def authors(self) -> List[str]:
        return self.__load_meta_if_present(AUTHOR)

    @property
    def audio_types(self) -> List[str]:
        return self.__load_meta_if_present(AUDIO_TYPES)

    @property
    def content_types(self) -> List[str]:
        return self.__load_meta_if_present(CONTENT_TYPE)

    @property
    def languages(self) -> List[str]:
        return self.__load_meta_if_present(LANGUAGE)

    @property
    def years(self) -> List[str]:
        return self.__load_meta_if_present(YEAR)

    def search(self, authors: List[str], years: List[int], audio_types: List[str], content_types: List[str],
               tmdb_id: str, text: Optional[str], fields: List[str], limit: Optional[int] = 100) -> List[dict]:
        from twisted.internet import reactor
        reactor.callInThread(self.__catalogues.refresh_if_stale)
        return self.__catalogues.search(authors, years, audio_types, content_types, tmdb_id, text, fields, limit)

    def find_by_id(self, entry_id: str) -> Optional[CatalogueEntry]:
        return self.__find_by(entry_id, self.__catalogues.find_by_id)

    def find_by_digest(self, digest: str) -> Optional[CatalogueEntry]:
        return self.__find_by(digest, self.__catalogues.find_by_digest)

    def __find_by(self, val: str, finder: Callable[[str], Optional[CatalogueEntry]]) -> Optional[CatalogueEntry]:
        from twisted.internet import reactor
        reactor.callInThread(self.__catalogues.refresh_if_stale)
        return finder(val)

    def __load_meta_if_present(self, meta_type: str):
        logger.info(f'Loading meta for {meta_type}')
        from twisted.internet import reactor
        reactor.callInThread(self.__catalogues.refresh_if_stale)
        latest = self.__catalogues.latest
        return latest.meta[meta_type]


class DatabaseDownloader:

    def __init__(self, download_url: str, cached_db_file, cached_version_file):
        self.__download_url = download_url
        if download_url[-1] != '/':
            self.__download_url = f"{download_url}/"
        self.__db_url = f"{self.__download_url}database.json"
        self.__version_url = f"{self.__download_url}version.txt"
        self.__cached_db_file = cached_db_file
        self.__cached_version_file = cached_version_file
        self.__cached_version = ''
        if os.path.exists(self.__cached_version_file):
            if os.path.exists(self.__cached_db_file):
                with open(self.__cached_version_file) as f:
                    self.__cached_version = f.read()

    @property
    def version(self) -> Optional[str]:
        return self.__cached_version.rstrip('\n') if self.__cached_version else self.__cached_version

    def run(self) -> bool:
        '''
        Hit the BEQ Catalogue database and compare to the local cached version.
        if there is an updated database then download it.
        '''
        remote_version = self.__get_remote_catalogue_version()
        if remote_version is None or self.__cached_version is None or remote_version != self.__cached_version:
            logger.info(f"Reloading from {self.__db_url}")
            try:
                r = requests.get(self.__db_url, allow_redirects=True)
                if r.status_code == 200:
                    logger.info(f"Writing database to {self.__cached_db_file}")
                    with open(self.__cached_db_file, 'wb') as f:
                        f.write(r.content)
                    if remote_version:
                        logger.info(f"Writing version {remote_version} to {self.__cached_version_file}")
                        with open(self.__cached_version_file, 'w') as f:
                            f.write(remote_version)
                    else:
                        logger.warning(f"No remote version to write")
                    self.__cached_version = remote_version
                    logger.info(f"Downloaded {self.__db_url} @ {remote_version}")
                    return True
                else:
                    logger.warning(f"Unable to download catalogue, response is {r.status_code}")
            except:
                logger.exception(f"Unable to download catalogue, unexpected error")
        else:
            logger.info(f"No reload required {remote_version} vs {self.__cached_version}")
        return False

    def __get_remote_catalogue_version(self) -> Optional[str]:
        '''
        gets version.txt to discover the remote catalogue version.
        :return: the version, if any.
        '''
        try:
            r = requests.get(self.__version_url, allow_redirects=True)
            if r.status_code == 200:
                txt = r.text
                return txt.strip() if txt else txt
            else:
                logger.warning(f"Unable to get {self.__version_url}, response was {r.status_code}")
        except:
            logger.exception(f"Failed to get {self.__version_url}")
        return None


@contextmanager
def db_ops(db_name):
    conn = sqlite3.connect(db_name)
    try:
        cur = conn.cursor()
        yield cur
    except Exception as e:
        conn.rollback()
        raise e
    else:
        conn.commit()
    finally:
        conn.close()


def compute_freshness(created_at, updated_at):
    now = time.time()
    if created_at >= (now - TWO_WEEKS_AGO_SECONDS):
        return 'Fresh'
    elif updated_at >= (now - TWO_WEEKS_AGO_SECONDS):
        return 'Updated'
    else:
        return 'Stale'
