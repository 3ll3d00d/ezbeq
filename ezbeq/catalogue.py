import json
import logging
import os
from datetime import datetime, timedelta
from typing import Optional, List

import requests
from flask_restful import Resource, reqparse

from ezbeq.config import Config

logger = logging.getLogger('ezbeq.catalogue')


class Catalogue:

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
        self.author = vals.get('author', '')
        self.beqc_url = vals.get('catalogue_url', '')
        self.filters = vals.get('filters', {})
        self.images = vals.get('images', [])
        self.episodes = vals.get('episode', '')
        self.content_type = vals.get('content_type', 'film')
        self.avs_url = vals.get('avs', '')
        self.season = vals.get('season', '')
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
            'audioTypes': self.audio_types,
            'beqcUrl': self.beqc_url,
            'images': self.images,
            'author': self.author,
            'season': self.season,
            'episodes': self.episodes,
            'contentType': self.content_type,
            'mvAdjust': self.mv_adjust,
            'avsUrl': self.avs_url
        }
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


class CatalogueProvider:

    def __init__(self, config: Config):
        self.__config = config
        self.__catalogue_file = os.path.join(config.config_path, 'database.json')
        self.__catalogue_version_file = os.path.join(config.config_path, 'version.txt')
        self.__version = None
        self.__loaded_at = None
        self.__catalogue = []
        self.__reload()

    def __reload(self):
        logger.info('Reloading catalogue')
        downloader = DatabaseDownloader(self.__catalogue_file, self.__catalogue_version_file)
        reload_required = downloader.run()
        if reload_required or not self.__catalogue:
            if os.path.exists(self.__catalogue_file):
                with open(self.__catalogue_file, 'r') as infile:
                    self.__catalogue = [Catalogue(f"{downloader.version}_{idx}", c)
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
    def catalogue(self) -> List[Catalogue]:
        self.__refresh_catalogue_if_stale()
        return self.__catalogue

    def __refresh_catalogue_if_stale(self):
        if self.__loaded_at is None or (datetime.now() - self.__loaded_at) > timedelta(minutes=15):
            try:
                self.__reload()
            except Exception as e:
                self.__loaded_at = None
                raise e


class ContentTypes(Resource):

    def __init__(self, **kwargs):
        self.__provider: CatalogueProvider = kwargs['catalogue']

    def get(self):
        catalogue = self.__provider.catalogue
        return list(sorted({c.content_type for c in catalogue}))


class Authors(Resource):

    def __init__(self, **kwargs):
        self.__provider: CatalogueProvider = kwargs['catalogue']

    def get(self):
        catalogue = self.__provider.catalogue
        return list(sorted({c.author for c in catalogue}))


class Years(Resource):

    def __init__(self, **kwargs):
        self.__provider: CatalogueProvider = kwargs['catalogue']

    def get(self):
        catalogue = self.__provider.catalogue
        return list(sorted({c.year for c in catalogue}, reverse=True))


class AudioTypes(Resource):

    def __init__(self, **kwargs):
        self.__provider: CatalogueProvider = kwargs['catalogue']

    def get(self):
        catalogue = self.__provider.catalogue
        return list(sorted({a_t for audio_types in [c.audio_types for c in catalogue] for a_t in audio_types}))


class CatalogueSearch(Resource):

    def __init__(self, **kwargs):
        self.__provider: CatalogueProvider = kwargs['catalogue']
        self.__parser = reqparse.RequestParser()
        self.__parser.add_argument('authors', action='append')
        self.__parser.add_argument('years', action='append')
        self.__parser.add_argument('audiotypes', action='append')
        self.__parser.add_argument('contenttypes', action='append')

    def get(self):
        catalogue = self.__provider.catalogue
        args = self.__parser.parse_args()
        authors = args.get('authors')
        years = args.get('years')
        audio_types = args.get('audiotypes')
        content_types = args.get('contenttypes')
        return [c.for_search for c in catalogue if c.matches(authors, years, audio_types, content_types)]


class CatalogueMeta(Resource):

    def __init__(self, **kwargs):
        self.__provider: CatalogueProvider = kwargs['catalogue']

    def get(self):
        version = self.__provider.version
        loaded_at = self.__provider.loaded_at
        return {
            'version': version,
            'loaded': int(loaded_at.timestamp()) if loaded_at is not None else None,
            'count': len(self.__provider.catalogue)
        }


class DatabaseDownloader:
    DATABASE_CSV = 'http://beqcatalogue.readthedocs.io/en/latest/database.json'
    VERSION_TXT = 'http://beqcatalogue.readthedocs.io/en/latest/version.txt'

    def __init__(self, cached_db_file, cached_version_file):
        self.__cached_db_file = cached_db_file
        self.__cached_version_file = cached_version_file
        if os.path.exists(self.__cached_version_file):
            with open(self.__cached_version_file) as f:
                self.__cached_version = f.read()
        else:
            self.__cached_version = ''

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
            logger.info(f"Reloading from {self.DATABASE_CSV}")
            r = requests.get(self.DATABASE_CSV, allow_redirects=True)
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
                logger.info(f"Downloaded {self.DATABASE_CSV} @ {remote_version}")
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
            r = requests.get(self.VERSION_TXT, allow_redirects=True)
            if r.status_code == 200:
                return r.text
            else:
                logger.warning(f"Unable to get {self.VERSION_TXT}, response was {r.status_code}")
        except:
            logger.exception(f"Failed to get {self.VERSION_TXT}")
        return None
