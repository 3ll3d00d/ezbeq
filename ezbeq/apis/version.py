from flask_restx import Namespace, Resource

api = Namespace('1/version', description='Provides access to the ezbeq version')


@api.route('')
class Version(Resource):

    def __init__(self, *args, **kwargs):
        super().__init__(*args, **kwargs)
        self.__v = kwargs['version'].strip()
        gi = kwargs.get('git_info', {})
        self.__branch = gi.get('branch')
        self.__sha = gi.get('sha')

    def get(self):
        result = {'version': self.__v}
        if self.__branch:
            result['branch'] = self.__branch
        if self.__sha:
            result['sha'] = self.__sha
        return result
