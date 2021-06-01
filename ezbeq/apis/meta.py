from flask_restx import Resource, Namespace

from ezbeq.catalogue import CatalogueProvider

api = Namespace('1/meta', description='Provides access to metadata about the beq catalogue')


@api.route('')
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
