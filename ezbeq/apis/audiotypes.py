from flask_restx import Resource, Namespace

from ezbeq.catalogue import CatalogueProvider

api = Namespace('1/audiotypes', description='Provides access to the audiotypes found in the beq catalogue')


@api.route('')
class Authors(Resource):

    def __init__(self, *args, **kwargs):
        super().__init__(*args, **kwargs)
        self.__provider: CatalogueProvider = kwargs['catalogue']

    def get(self):
        return list(sorted({c for c in self.__provider.audio_types}))
