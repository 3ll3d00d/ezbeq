from flask_restx import Resource, Namespace

from ezbeq.catalogue import CatalogueProvider

api = Namespace('1/years', description='Provides access to the years found in the beq catalogue')


@api.route('')
class Years(Resource):

    def __init__(self, *args, **kwargs):
        super().__init__(*args, **kwargs)
        self.__provider: CatalogueProvider = kwargs['catalogue']

    def get(self):
        catalogue = self.__provider.catalogue
        return list(sorted({c.year for c in catalogue}, reverse=True))
