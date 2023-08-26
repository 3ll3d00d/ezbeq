import json
import logging
import os
import time
from dataclasses import dataclass
from datetime import datetime, timedelta
from typing import Optional, List

import requests

from ezbeq.apis.ws import WsServer
from ezbeq.config import Config

TWO_WEEKS_AGO_SECONDS = 2 * 7 * 24 * 60 * 60

logger = logging.getLogger('ezbeq.catalogue')


class CatalogueEntry:

    def __init__(self, idx: str, vals: dict):
        self.idx = idx
        self.title = vals.get('title', '')
        y = 0
        try:
            y = int(vals.get('year', 0))
        except:
            logger.error(f"Invalid year {vals.get('year', 0)} in {self.title}")
        self.year = y
        self.audio_types = vals.get('audioTypes', [])
        self.content_type = vals.get('content_type', 'film')
        self.author = vals.get('author', '')
        self.beqc_url = vals.get('catalogue_url', '')
        self.filters: List[dict] = vals.get('filters', [])
        self.images = vals.get('images', [])
        self.warning = vals.get('warning', [])
        self.season = vals.get('season', '')
        self.episodes = vals.get('episode', '')
        self.avs_url = vals.get('avs', '')
        self.sort_title = vals.get('sortTitle', '')
        self.edition = vals.get('edition', '')
        self.note = vals.get('note', '')
        self.language = vals.get('language', '')
        self.source = vals.get('source', '')
        self.overview = vals.get('overview', '')
        self.the_movie_db = vals.get('theMovieDB', '')
        self.rating = vals.get('rating', '')
        self.genres = vals.get('genres', [])
        self.alt_title = vals.get('altTitle', '')
        self.created_at = vals.get('created_at', 0)
        self.updated_at = vals.get('updated_at', 0)
        self.digest = vals.get('digest', '')
        self.collection = vals.get('collection', {})
        self.formatted_title = self.__format_title()
        now = time.time()
        if self.created_at >= (now - TWO_WEEKS_AGO_SECONDS):
            self.freshness = 'Fresh'
        elif self.updated_at >= (now - TWO_WEEKS_AGO_SECONDS):
            self.freshness = 'Updated'
        else:
            self.freshness = 'Stale'
        try:
            r = int(vals.get('runtime', 0))
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
                pass
        self.for_search = {
            'id': self.idx,
            'title': self.title,
            'year': self.year,
            'sortTitle': self.sort_title,
            'audioTypes': self.audio_types,
            'contentType': self.content_type,
            'author': self.author,
            'created_at': self.created_at,
            'updated_at': self.updated_at,
            'freshness': self.freshness,
            'digest': self.digest,
            'formattedTitle': self.formatted_title
        }
        if self.beqc_url:
            self.for_search['beqcUrl'] = self.beqc_url
        if self.images:
            self.for_search['images'] = self.images
        if self.warning:
            self.for_search['warning'] = self.warning
        if self.season:
            self.for_search['season'] = self.season
        if self.episodes:
            self.for_search['episodes'] = self.episodes
        if self.mv_adjust:
            self.for_search['mvAdjust'] = self.mv_adjust
        if self.avs_url:
            self.for_search['avsUrl'] = self.avs_url
        if self.edition:
            self.for_search['edition'] = self.edition
        if self.note:
            self.for_search['note'] = self.note
        if self.language:
            self.for_search['language'] = self.language
        if self.source:
            self.for_search['source'] = self.source
        if self.overview:
            self.for_search['overview'] = self.overview
        if self.the_movie_db:
            self.for_search['theMovieDB'] = self.the_movie_db
        if self.rating:
            self.for_search['rating'] = self.rating
        if self.runtime:
            self.for_search['runtime'] = self.runtime
        if self.genres:
            self.for_search['genres'] = self.genres
        if self.alt_title:
            self.for_search['altTitle'] = self.alt_title
        if self.note:
            self.for_search['note'] = self.note
        if self.warning:
            self.for_search['warning'] = self.warning
        if self.collection and 'name' in self.collection:
            self.for_search['collection'] = self.collection['name']

    def matches(self, authors: List[str], years: List[int], audio_types: List[str], content_types: List[str],
                tmdb_id: str, text: Optional[str]):
        if not tmdb_id or self.the_movie_db == tmdb_id:
            if not authors or self.author in authors:
                if not years or self.year in years:
                    if not audio_types or any(a_t in audio_types for a_t in self.audio_types):
                        if not content_types or self.content_type in content_types:
                            return not text or self.__text_match(text)
        return False

    def __text_match(self, text: str):
        t = text.lower()
        return t in self.formatted_title.lower() \
            or t in self.alt_title \
            or t in self.for_search.get('collection', '').lower()

    def __repr__(self):
        return f"[{self.content_type}] {self.title} / {self.audio_types} / {self.year}"

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


@dataclass(frozen=True)
class Catalogue:
    entries: List[CatalogueEntry]
    version: str
    loaded_at: datetime = None

    def __len__(self):
        return len(self.entries)

    @property
    def stale(self):
        return (datetime.now() - self.loaded_at) > timedelta(minutes=1)

    def json(self) -> dict:
        return {
            'version': self.version,
            'loaded': int(self.loaded_at.timestamp()),
            'count': len(self)
        }

    @property
    def meta_msg(self) -> str:
        return json.dumps({'message': 'Catalogue', 'data': self.json()})


class Catalogues:
    def __init__(self, catalogue_file: str, version_file: str, catalogue_url: str, ws: WsServer,
                 refresh_seconds: float):
        self.__catalogue_url = catalogue_url
        self.__version_file = version_file
        self.__catalogue_file = catalogue_file
        self.__catalogues: List[Catalogue] = []
        self.__refresh_interval = refresh_seconds
        self.__ws = ws
        self.__ws.factory.init_meta_provider(lambda: self.latest.meta_msg if self.latest else None)
        try:
            if os.path.exists(self.__catalogue_file) and os.path.exists(self.__version_file):
                with open(self.__version_file) as f:
                    self.__load_cached_catalogue(f.read().strip())
        except:
            logger.exception(f'Failed to load catalogue at startup from {self.__catalogue_file}')
        from twisted.internet.task import LoopingCall
        logger.info(f'Scheduling reload to run every {self.__refresh_interval}s')
        from twisted.internet import task
        self.__reload_task = task.LoopingCall(self.__reload)
        self.__reload_task.start(self.__refresh_interval, now=True)

    @property
    def latest(self) -> Optional[Catalogue]:
        return self.__catalogues[-1] if self.loaded else None

    def find_version(self, version: str) -> Optional[Catalogue]:
        return next((i for i in self.__catalogues if i.version == version), None)

    def append(self, catalogue: Catalogue):
        one_day_ago = datetime.now() - timedelta(days=1)
        if self.__catalogues:
            self.__catalogues = [i for i in self.__catalogues if i.loaded_at and i.loaded_at >= one_day_ago]
        self.__on_catalogue_update(catalogue)

    def find_entry(self, entry_id: str, match_on_idx: Optional[bool] = None) -> Optional[CatalogueEntry]:
        if match_on_idx is None:
            m = self.find_entry(entry_id, True)
            if not m:
                m = self.find_entry(entry_id, False)
            return m
        else:
            target_version = None
            if match_on_idx is True:
                m = lambda ce: ce.idx == entry_id
                target_version = entry_id.split('_')[0]
            else:
                m = lambda ce: ce.digest == entry_id
            for catalogue in reversed(self.__catalogues):
                if catalogue and (target_version is None or catalogue.version == target_version):
                    return next((c for c in catalogue.entries if m(c)), None)
        return None
    @property
    def loaded(self) -> bool:
        if not self.__catalogues:
            return False
        current = self.__catalogues[-1]
        return current.version != '' and current.entries

    def __reload(self):
        prefix = 'Rel' if self.loaded else 'L'
        logger.debug(f'{prefix}oading catalogue')
        downloader = DatabaseDownloader(self.__catalogue_url, self.__catalogue_file, self.__version_file)
        reload_required = downloader.run()
        if reload_required or not self.loaded:
            if os.path.exists(self.__catalogue_file):
                self.__load_cached_catalogue(downloader.version)
            else:
                raise ValueError(f"No catalogue available at {self.__catalogue_file}")
        else:
            logger.debug(f"No {prefix.lower()}oad required")

    def __load_cached_catalogue(self, version: str):
        with open(self.__catalogue_file, 'r') as infile:
            entries = [CatalogueEntry(f"{version}_{idx}", c) for idx, c in enumerate(json.load(infile))]
            catalogue = Catalogue(entries, version, datetime.now())
            self.__on_catalogue_update(catalogue)
            logger.info(f'Loaded {len(catalogue)} entries from version {version}')

    def __on_catalogue_update(self, catalogue: Catalogue):
        self.__catalogues.append(catalogue)
        self.__ws.broadcast(catalogue.meta_msg)

    def refresh_if_stale(self):
        if not self.loaded or self.latest.stale:
            try:
                self.__reload()
            except Exception as e:
                logger.exception(f"Failed to refresh catalogue", e)


class CatalogueProvider:

    def __init__(self, config: Config, ws: WsServer):
        self.__catalogues: Catalogues = Catalogues(os.path.join(config.config_path, 'database.json'),
                                                   os.path.join(config.config_path, 'version.txt'),
                                                   config.beqcatalogue_url,
                                                   ws,
                                                   config.catalogue_refresh_interval)

    def find(self, entry_id: str, match_on_idx: Optional[bool] = None) -> Optional[CatalogueEntry]:
        return self.__catalogues.find_entry(entry_id, match_on_idx)

    @property
    def catalogue(self) -> Optional[Catalogue]:
        return self.__catalogues.latest

    @property
    def catalogue_entries(self) -> List[CatalogueEntry]:
        from twisted.internet import reactor
        reactor.callLater(0, self.__catalogues.refresh_if_stale)
        latest = self.__catalogues.latest
        return latest.entries if latest else []


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
