from flask_restx import Resource, Namespace

from ezbeq.catalogue import CatalogueProvider

api = Namespace('1/meta', description='Provides access to metadata about the beq catalogue')


@api.route('')
class CatalogueMeta(Resource):

    def __init__(self, *args, **kwargs):
        super().__init__(*args, **kwargs)
        self.__provider: CatalogueProvider = kwargs['catalogue']

    def get(self):
        catalogue = self.__provider.catalogue
        return {
            'version': catalogue.version,
            'loaded': int(catalogue.loaded_at.timestamp()),
            'count': catalogue.count
        } if catalogue else {
            'version': 'N/A',
            'loaded': None,
            'count': 0
        }
