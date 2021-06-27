import logging

from flask_restx import Resource, Namespace

from ezbeq.catalogue import CatalogueProvider

logger = logging.getLogger('ezbeq.catalogue')

api = Namespace('1/catalogue', description='Provides ability to get a specific entry from the beq catalogue')


@api.route('/<string:entry_id>/details')
@api.doc(params={
    'entry_id': 'The entry id (digest from beqcatalogue)'
})
class EntryLoad(Resource):

    def __init__(self, *args, **kwargs):
        super().__init__(*args, **kwargs)
        self.__provider: CatalogueProvider = kwargs['catalogue']

    def get(self, entry_id: str):
        entry = self.__provider.find(entry_id, False)
        if entry:
            return {**entry.for_search, 'filters': entry.filters}, 200
        else:
            return None, 404


@api.route('/<string:entry_id>/filters')
@api.doc(params={
    'entry_id': 'The entry id (digest from beqcatalogue)'
})
class FilterLoad(Resource):

    def __init__(self, *args, **kwargs):
        super().__init__(*args, **kwargs)
        self.__provider: CatalogueProvider = kwargs['catalogue']

    def get(self, entry_id: str):
        entry = self.__provider.find(entry_id, False)
        if entry:
            return {
                'digest': entry.digest,
                'title': entry.formatted_title,
                'year': entry.year,
                'filters': [{k: v for k, v in f.items() if k != 'biquads'} for f in entry.filters],
                'theMovieDB': entry.the_movie_db
            }, 200
        else:
            return None, 404
