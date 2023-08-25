import logging

from flask_restx import Resource, reqparse, Namespace

from ezbeq.catalogue import CatalogueProvider

logger = logging.getLogger('ezbeq.catalogue')

api = Namespace('1/search', description='Provides ability to search the beq catalogue')


@api.route('')
class CatalogueSearch(Resource):

    def __init__(self, *args, **kwargs):
        super().__init__(*args, **kwargs)
        self.__provider: CatalogueProvider = kwargs['catalogue']
        self.__parser = reqparse.RequestParser()
        self.__parser.add_argument('authors', action='append')
        self.__parser.add_argument('years', type=int, action='append')
        self.__parser.add_argument('audiotypes', action='append')
        self.__parser.add_argument('contenttypes', action='append')
        self.__parser.add_argument('fields', action='append')
        self.__parser.add_argument('text')
        self.__parser.add_argument('tmdbid')

    @api.param('authors', 'The author of the BEQ filter, if multiple values provided any match will be returned')
    @api.param('years', 'The production year of the entry, if multiple values provided any match will be returned')
    @api.param('audiotypes', 'The audio type of the entry, if multiple values provided any match will be returned')
    @api.param('authors', 'The content type of the entry, if multiple values provided any match will be returned')
    @api.param('text', 'Provides a case insensitive search against the following fields: formattedTitle, altTitle, collection. Value is returned if the supplied text is contained in any of those fields.')
    @api.param('fields', 'The entry fields to return in the output')
    @api.param('tmdbid', 'TheMovieDB id')
    def get(self):
        catalogue = self.__provider.catalogue_entries
        args = self.__parser.parse_args()
        authors = args.get('authors')
        years = args.get('years')
        audio_types = args.get('audiotypes')
        content_types = args.get('contenttypes')
        text = args.get('text')
        tmdb_id = args.get('tmdbid')
        fields = args.get('fields')
        return [self.__filter_fields(c.for_search, fields)
                for c in catalogue if c.matches(authors, years, audio_types, content_types, tmdb_id, text)]

    @staticmethod
    def __filter_fields(entry: dict, fields: list):
        if fields:
            return {k: v for k, v in entry.items() if k in fields}
        else:
            return entry

