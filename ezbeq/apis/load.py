from flask_restx import Resource, Namespace

from ezbeq.catalogue import CatalogueProvider, LoadTester

api = Namespace('1/load', description='Allows access to a load testing function for checking sqlite db performance')


@api.route('')
class LoadTest(Resource):

    def __init__(self, *args, **kwargs):
        super().__init__(*args, **kwargs)
        self.__load: LoadTester = kwargs['load']

    def get(self):
        return self.__load.run()
