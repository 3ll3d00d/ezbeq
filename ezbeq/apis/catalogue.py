import logging

from flask_restx import Namespace, Resource, reqparse

from ezbeq.catalogue import CatalogueProvider

logger = logging.getLogger('ezbeq.catalogue')

api = Namespace('1/catalogue', description='Provides ability to get a specific entry from the beq catalogue')

# bounds the batch lookup so a single request can't ask for the whole catalogue
MAX_FILTER_IDS = 50


def filter_params(entry) -> list[dict]:
    return [{k: v for k, v in f.items() if k != 'biquads'} for f in entry.filters]


@api.route('/<string:entry_id>/details')
@api.doc(params={
    'entry_id': 'The entry id (digest from beqcatalogue)'
})
class EntryLoad(Resource):

    def __init__(self, *args, **kwargs):
        super().__init__(*args, **kwargs)
        self.__provider: CatalogueProvider = kwargs['catalogue']

    def get(self, entry_id: str):
        entry = self.__provider.find(entry_id, match_on_idx=False, as_dict=True)
        if entry:
            return entry, 200
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
        entry = self.__provider.find(entry_id, match_on_idx=False)
        if entry:
            return {
                'digest': entry.digest,
                'title': entry.formatted_title,
                'year': entry.year,
                'filters': filter_params(entry),
                'theMovieDB': entry.the_movie_db
            }, 200
        else:
            return None, 404


@api.route('/filters')
class BatchFilterLoad(Resource):

    def __init__(self, *args, **kwargs):
        super().__init__(*args, **kwargs)
        self.__provider: CatalogueProvider = kwargs['catalogue']
        self.__parser = reqparse.RequestParser()
        self.__parser.add_argument('ids', action='append', required=True)

    @api.param('ids', f'The entry ids to get filters for, at most {MAX_FILTER_IDS} per request')
    def get(self):
        ids = list(dict.fromkeys(self.__parser.parse_args()['ids']))
        if len(ids) > MAX_FILTER_IDS:
            return f'At most {MAX_FILTER_IDS} ids can be requested at once', 400
        results = []
        for entry_id in ids:
            entry = self.__provider.find_by_id(entry_id)
            if entry:
                results.append({'id': entry_id, 'filters': filter_params(entry)})
        return results, 200
