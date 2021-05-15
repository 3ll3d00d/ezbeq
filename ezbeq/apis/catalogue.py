import logging

from flask_restx import Resource, reqparse, Namespace

from catalogue import CatalogueProvider

logger = logging.getLogger('ezbeq.catalogue')

api = Namespace('', description='Provides access to the beq catalogue')


@api.route('/contenttypes')
class ContentTypes(Resource):

    def __init__(self, *args, **kwargs):
        super().__init__(*args, **kwargs)
        self.__provider: CatalogueProvider = kwargs['catalogue']

    def get(self):
        catalogue = self.__provider.catalogue
        return list(sorted({c.content_type for c in catalogue}))


@api.route('/authors')
class Authors(Resource):

    def __init__(self, *args, **kwargs):
        super().__init__(*args, **kwargs)
        self.__provider: CatalogueProvider = kwargs['catalogue']

    def get(self):
        catalogue = self.__provider.catalogue
        return list(sorted({c.author for c in catalogue}))


@api.route('/years')
class Years(Resource):

    def __init__(self, *args, **kwargs):
        super().__init__(*args, **kwargs)
        self.__provider: CatalogueProvider = kwargs['catalogue']

    def get(self):
        catalogue = self.__provider.catalogue
        return list(sorted({c.year for c in catalogue}, reverse=True))


@api.route('/audiotypes')
class AudioTypes(Resource):

    def __init__(self, *args, **kwargs):
        super().__init__(*args, **kwargs)
        self.__provider: CatalogueProvider = kwargs['catalogue']

    def get(self):
        catalogue = self.__provider.catalogue
        return list(sorted({a_t for audio_types in [c.audio_types for c in catalogue] for a_t in audio_types}))


@api.route('/search')
class CatalogueSearch(Resource):

    def __init__(self, *args, **kwargs):
        super().__init__(*args, **kwargs)
        self.__provider: CatalogueProvider = kwargs['catalogue']
        self.__parser = reqparse.RequestParser()
        self.__parser.add_argument('authors', action='append')
        self.__parser.add_argument('years', action='append')
        self.__parser.add_argument('audiotypes', action='append')
        self.__parser.add_argument('contenttypes', action='append')
        self.__parser.add_argument('fields', action='append')

    def get(self):
        catalogue = self.__provider.catalogue
        args = self.__parser.parse_args()
        authors = args.get('authors')
        years = args.get('years')
        audio_types = args.get('audiotypes')
        content_types = args.get('contenttypes')
        fields = args.get('fields')
        return [self.__filter_fields(c.for_search, fields)
                for c in catalogue if c.matches(authors, years, audio_types, content_types)]

    @staticmethod
    def __filter_fields(entry: dict, fields: list):
        if fields:
            return {k: v for k, v in entry.items() if k in fields}
        else:
            return entry


@api.route('/meta')
class CatalogueMeta(Resource):

    def __init__(self, *args, **kwargs):
        super().__init__(*args, **kwargs)
        self.__provider: CatalogueProvider = kwargs['catalogue']

    def get(self):
        version = self.__provider.version
        loaded_at = self.__provider.loaded_at
        return {
            'version': version,
            'loaded': int(loaded_at.timestamp()) if loaded_at is not None else None,
            'count': len(self.__provider.catalogue)
        }


