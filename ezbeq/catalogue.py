import json
import logging
import os
import time
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timedelta
from typing import Optional, List

import requests

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
        self.altTitle = vals.get('altTitle', '')
        self.created_at = vals.get('created_at', 0)
        self.updated_at = vals.get('updated_at', 0)
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
            'freshness': self.freshness
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
        if self.altTitle:
            self.for_search['altTitle'] = self.altTitle
        self.short_search = {
            'id': self.idx,
            'title': self.title,
            'year': self.year,
            'contentType': self.content_type
        }

    def matches(self, authors, years, audio_types, content_types):
        if not authors or self.author in authors:
            if not years or self.year in years:
                if not audio_types or any(a_t in audio_types for a_t in self.audio_types):
                    return not content_types or self.content_type in content_types
        return False

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
                        if  last_value == current - 1:
                            working.append(ep)
                            last_value = current
                        else:
                            formatted += self.__format_episodes(formatted, working)
                            working = []
                if len(working) > 0:
                    formatted += self.__format_episodes(formatted, working)
            else:
                formatted += f"{self.episodes}"
            return f"{season} {formatted}"
        return season

    @property
    def formatted_title(self) -> str:
        if self.content_type == 'TV':
            return f"{self.title} {self.__format_tv_meta()}"
        return self.title


class CatalogueProvider:

    def __init__(self, config: Config):
        self.__config = config
        self.__catalogue_file = os.path.join(config.config_path, 'database.json')
        self.__catalogue_version_file = os.path.join(config.config_path, 'version.txt')
        self.__executor = ThreadPoolExecutor(max_workers=1)
        self.__version = None
        self.__loaded_at = None
        self.__catalogue = []
        self.__executor.submit(self.__reload).result(timeout=60)

    def find(self, entry_id: str) -> Optional[CatalogueEntry]:
        return next((c for c in self.catalogue if c.idx == entry_id), None)

    def __reload(self):
        logger.info('Reloading catalogue')
        downloader = DatabaseDownloader(self.__config.beqcatalogue_url, self.__catalogue_file, self.__catalogue_version_file)
        reload_required = downloader.run()
        if reload_required or not self.__catalogue:
            if os.path.exists(self.__catalogue_file):
                with open(self.__catalogue_file, 'r') as infile:
                    self.__catalogue = [CatalogueEntry(f"{downloader.version}_{idx}", c)
                                        for idx, c in enumerate(json.load(infile))]
                    self.__loaded_at = datetime.now()
                    self.__version = downloader.version
            else:
                raise ValueError(f"No catalogue available at {self.__catalogue_file}")
        else:
            logger.debug(f"No reload required")

    @property
    def loaded_at(self) -> Optional[datetime]:
        return self.__loaded_at

    @property
    def version(self) -> Optional[str]:
        return self.__version

    @property
    def catalogue(self) -> List[CatalogueEntry]:
        self.__executor.submit(self.__refresh_catalogue_if_stale).result(timeout=60)
        return self.__catalogue

    def __refresh_catalogue_if_stale(self):
        if self.__loaded_at is None or (datetime.now() - self.__loaded_at) > timedelta(minutes=15):
            try:
                self.__reload()
            except Exception as e:
                self.__loaded_at = None
                raise e


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
        return self.__cached_version

    def run(self) -> bool:
        '''
        Hit the BEQ Catalogue database and compare to the local cached version.
        if there is an updated database then download it.
        '''
        remote_version = self.__get_remote_catalogue_version()
        if remote_version is None or self.__cached_version is None or remote_version != self.__cached_version:
            logger.info(f"Reloading from {self.__db_url}")
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
                return r.text
            else:
                logger.warning(f"Unable to get {self.__version_url}, response was {r.status_code}")
        except:
            logger.exception(f"Failed to get {self.__version_url}")
        return None
