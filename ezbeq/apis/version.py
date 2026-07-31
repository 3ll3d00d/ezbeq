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
        self.__update_checker = kwargs.get('update_checker')
        self.__python_version = kwargs.get('python_version')
        self.__min_python_version = kwargs.get('min_python_version')
        self.__python_supported = kwargs.get('python_supported')

    def get(self):
        result = {'version': self.__v}
        if self.__branch:
            result['branch'] = self.__branch
        if self.__sha:
            result['sha'] = self.__sha
        if self.__update_checker is not None:
            r = self.__update_checker.result
            if r is not None:
                result['latestVersion'] = r['latest_version']
                result['updateAvailable'] = r['update_available']
        if self.__python_version is not None:
            result['pythonVersion'] = self.__python_version
            result['minPythonVersion'] = self.__min_python_version
            result['pythonSupported'] = self.__python_supported
        return result
