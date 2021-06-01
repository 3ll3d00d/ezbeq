from flask_restx import Resource, Namespace

from ezbeq.catalogue import CatalogueProvider

api = Namespace('1/authors', description='Provides access to the authors found in the beq catalogue')


@api.route('')
class Authors(Resource):

    def __init__(self, *args, **kwargs):
        super().__init__(*args, **kwargs)
        self.__provider: CatalogueProvider = kwargs['catalogue']

    def get(self):
        catalogue = self.__provider.catalogue
        return list(sorted({c.author for c in catalogue}))
