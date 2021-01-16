import json
import logging
import os
from datetime import datetime
import time
from typing import Optional, List

from dateutil.parser import parse as parsedate

import requests
from flask_restful import Resource, reqparse

from app.config import Config

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


class CatalogueProvider:

    def __init__(self, config: Config):
        self.__config = config
        self.__catalogue_file = os.path.join(config.config_path, 'database.json')
        # TODO schedule a run every hour
        DatabaseDownloader(self.__catalogue_file).run()
        self.__catalogue = []
        if os.path.exists(self.__catalogue_file):
            with open(self.__catalogue_file, 'r') as infile:
                self.__catalogue = [Catalogue(idx, c) for idx, c in enumerate(json.load(infile))]
        else:
            raise ValueError(f"No catalogue available at {self.__catalogue_file}")

    @property
    def catalogue(self) -> List[Catalogue]:
        return self.__catalogue


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


class DatabaseDownloader:
    DATABASE_CSV = 'http://beqcatalogue.readthedocs.io/en/latest/database.json'

    def __init__(self, cached_file):
        self.__cached = cached_file

    def run(self):
        '''
        Hit the BEQ Catalogue database and compare to the local cached version.
        if there is an updated database then download it.
        '''
        mod_date = self.__get_mod_date()
        cached_date = datetime.fromtimestamp(os.path.getmtime(self.__cached)).astimezone() if os.path.exists(self.__cached) else None
        if mod_date is None or cached_date is None or mod_date > cached_date:
            logger.info(f"Loading {self.DATABASE_CSV}")
            r = requests.get(self.DATABASE_CSV, allow_redirects=True)
            if r.status_code == 200:
                with open(self.__cached, 'wb') as f:
                    f.write(r.content)
                if mod_date is not None:
                    modified = time.mktime(mod_date.timetuple())
                    now = time.mktime(datetime.today().timetuple())
                    os.utime(self.__cached, (now, modified))
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
