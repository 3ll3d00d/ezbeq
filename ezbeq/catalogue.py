import json
import logging
import os
from datetime import datetime, timedelta
import time
from typing import Optional, List

from dateutil.parser import parse as parsedate

import requests
from flask_restful import Resource, reqparse

from ezbeq.config import Config

logger = logging.getLogger('ezbeq.catalogue')


class Catalogue:

    def __init__(self, idx: int, vals: dict):
        self.idx = idx
        self.title = vals.get('title', '')
        self.year = int(vals.get('year', 0))
        self.audio_types = vals.get('audioTypes', [])
        self.author = vals.get('author', '')
        self.url = vals.get('catalogue_url', '')
        self.filters = vals.get('filters', {})
        self.images = vals.get('images', [])
        self.for_search = {
            'id': self.idx,
            'title': self.title,
            'year': self.year,
            'audioTypes': self.audio_types,
            'url': self.url,
            'images': self.images,
            'author': self.author
        }
        self.short_search = {
            'id': self.idx,
            'title': self.title,
            'year': self.year,
        }

    def matches(self, authors, years, audio_types):
        if not authors or self.author in authors:
            if not years or self.year in years:
                return not audio_types or any(a_t in audio_types for a_t in self.audio_types)
        return False

    def __repr__(self):
        return f"{self.title} / {self.audio_types} / {self.year}"


class CatalogueProvider:

    def __init__(self, config: Config):
        self.__config = config
        self.__catalogue_file = os.path.join(config.config_path, 'database.json')
        self.__last_load = None
        self.__created_at = None
        self.__catalogue = []
        self.__reload()

    def __reload(self):
        logger.info('Reloading catalogue')
        downloader = DatabaseDownloader(self.__catalogue_file)
        downloader.run()
        if os.path.exists(self.__catalogue_file):
            with open(self.__catalogue_file, 'r') as infile:
                base = int(downloader.cached_date.timestamp())
                self.__catalogue = [Catalogue(base + idx, c) for idx, c in enumerate(json.load(infile))]
                self.__created_at = downloader.cached_date
                self.__last_load = datetime.now()
        else:
            raise ValueError(f"No catalogue available at {self.__catalogue_file}")

    @property
    def loaded_at(self):
        return self.__last_load

    @property
    def created_at(self):
        return self.__created_at

    @property
    def catalogue(self) -> List[Catalogue]:
        self.__refresh_catalogue_if_stale()
        return self.__catalogue

    def __refresh_catalogue_if_stale(self):
        previous_load_time = self.__last_load
        self.__last_load = datetime.now()
        if previous_load_time is None or (datetime.now() - previous_load_time) > timedelta(hours=1):
            try:
                self.__reload()
            except Exception as e:
                self.__last_load = previous_load_time
                raise e


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

    def get(self):
        catalogue = self.__provider.catalogue
        args = self.__parser.parse_args()
        authors = args.get('authors')
        years = args.get('years')
        audio_types = args.get('audiotypes')
        return [c.for_search for c in catalogue if c.matches(authors, years, audio_types)]


class CatalogueMeta(Resource):

    def __init__(self, **kwargs):
        self.__provider: CatalogueProvider = kwargs['catalogue']

    def get(self):
        created_at = self.__provider.created_at
        loaded_at = self.__provider.loaded_at
        return {
            'created': int(created_at.timestamp()) if created_at is not None else None,
            'loaded': int(loaded_at.timestamp()) if loaded_at is not None else None,
            'count': len(self.__provider.catalogue)
        }


class DatabaseDownloader:
    DATABASE_CSV = 'http://beqcatalogue.readthedocs.io/en/latest/database.json'

    def __init__(self, cached_file):
        self.__cached = cached_file
        self.cached_date = self.__load_cached_date()

    def __load_cached_date(self):
        return datetime.fromtimestamp(os.path.getmtime(self.__cached)).astimezone() if os.path.exists(self.__cached) else None

    def run(self):
        '''
        Hit the BEQ Catalogue database and compare to the local cached version.
        if there is an updated database then download it.
        '''
        mod_date = self.__get_mod_date()
        if mod_date is None or self.cached_date is None or mod_date > self.cached_date:
            logger.info(f"Loading {self.DATABASE_CSV}")
            r = requests.get(self.DATABASE_CSV, allow_redirects=True)
            if r.status_code == 200:
                with open(self.__cached, 'wb') as f:
                    f.write(r.content)
                if mod_date is not None:
                    modified = time.mktime(mod_date.timetuple())
                    now = time.mktime(datetime.today().timetuple())
                    os.utime(self.__cached, (now, modified))
                    self.cached_date = self.__load_cached_date()
                    logger.info(f"Downloaded {self.DATABASE_CSV} with moddate {modified}")
                else:
                    logger.warning("Downloaded catalogue but moddate was not available")
            else:
                logger.warning(f"Unable to download catalogue, response is {r.status_code}")

    def __get_mod_date(self) -> Optional[datetime]:
        '''
        HEADs the database.csv to find the last modified date.
        :return: the date.
        '''
        try:
            r = requests.head(self.DATABASE_CSV, allow_redirects=True)
            if r.status_code == 200:
                if 'Last-Modified' in r.headers:
                    return parsedate(r.headers['Last-Modified']).astimezone()
            else:
                logger.warning(f"Unable to hit BEQCatalogue, response was {r.status_code}")
        except:
            logger.exception('Failed to hit BEQCatalogue')
        return None
