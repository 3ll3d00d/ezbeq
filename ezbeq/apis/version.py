from flask_restx import Namespace, Resource

api = Namespace('1/version', description='Provides access to the ezbeq version')


@api.route('')
class Version(Resource):

    def __init__(self, *args, **kwargs):
        super().__init__(*args, **kwargs)
        self.__v = kwargs['version']

    def get(self):
        return {'version': self.__v}
