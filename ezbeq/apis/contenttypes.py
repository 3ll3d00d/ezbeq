from flask_restx import Resource, Namespace

from ezbeq.catalogue import CatalogueProvider

api = Namespace('1/contenttypes', description='Provides access to the content types in the beq catalogue')


@api.route('')
class ContentTypes(Resource):

    def __init__(self, *args, **kwargs):
        super().__init__(*args, **kwargs)
        self.__provider: CatalogueProvider = kwargs['catalogue']

    def get(self):
        catalogue = self.__provider.catalogue
        return list(sorted({c.content_type for c in catalogue}))
