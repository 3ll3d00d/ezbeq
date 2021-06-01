from flask_restx import Resource, Namespace

from ezbeq.catalogue import CatalogueProvider

api = Namespace('1/audiotypes', description='Provides access to the audiotypes found in the beq catalogue')


@api.route('')
class Authors(Resource):

    def __init__(self, *args, **kwargs):
        super().__init__(*args, **kwargs)
        self.__provider: CatalogueProvider = kwargs['catalogue']

    def get(self):
        catalogue = self.__provider.catalogue
        return list(sorted({a_t for audio_types in [c.audio_types for c in catalogue] for a_t in audio_types}))
