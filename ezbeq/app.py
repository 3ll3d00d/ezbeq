import faulthandler
import os
from os import path

from flask import Flask
from flask_restful import Api

from ezbeq.catalogue import CatalogueProvider, Authors, Years, AudioTypes, CatalogueSearch, CatalogueMeta, ContentTypes
from ezbeq.config import Config, Version
from ezbeq.device import DeviceSender, Minidsp, Devices, DeviceState, DeviceBridge

API_PREFIX = '/api/1'

faulthandler.enable()
if hasattr(faulthandler, 'register'):
    import signal

    faulthandler.register(signal.SIGUSR2, all_threads=True)

app = Flask(__name__)
api = Api(app)
cfg = Config('ezbeq')
resource_args = {
    'config': cfg,
    'device_state': DeviceState(cfg),
    'device_bridge': DeviceBridge(cfg),
    'catalogue': CatalogueProvider(cfg)
}

# GET: slot state
api.add_resource(Devices, f"{API_PREFIX}/devices", resource_class_kwargs=resource_args)
# PUT: set config
# DELETE: remove config
api.add_resource(DeviceSender, f"{API_PREFIX}/device/<slot>", resource_class_kwargs=resource_args)
# GET: distinct authors in the catalogue
api.add_resource(Authors, f"{API_PREFIX}/authors", resource_class_kwargs=resource_args)
# GET: distinct years in the catalogue
api.add_resource(Years, f"{API_PREFIX}/years", resource_class_kwargs=resource_args)
# GET: distinct audio types in the catalogue
api.add_resource(AudioTypes, f"{API_PREFIX}/audiotypes", resource_class_kwargs=resource_args)
# GET: distinct content types in the catalogue
api.add_resource(ContentTypes, f"{API_PREFIX}/contenttypes", resource_class_kwargs=resource_args)
# GET: catalogue entries
api.add_resource(CatalogueSearch, f"{API_PREFIX}/search", resource_class_kwargs=resource_args)
# GET: catalogue meta
api.add_resource(CatalogueMeta, f"{API_PREFIX}/meta", resource_class_kwargs=resource_args)
# GET: app meta
api.add_resource(Version, f"{API_PREFIX}/version", resource_class_kwargs=resource_args)


def main(args=None):
    """ The main routine. """
    logger = cfg.configure_logger()

    if cfg.use_twisted:
        import logging
        logger = logging.getLogger('twisted')
        from twisted.internet import reactor
        from twisted.web.resource import Resource
        from twisted.web import static, server
        from twisted.web.wsgi import WSGIResource
        from twisted.application import service
        from twisted.internet import endpoints

        class ReactApp:
            """
            Handles the react app (excluding the static dir).
            """

            def __init__(self, path):
                # TODO allow this to load when in debug mode even if the files don't exist
                self.publicFiles = {f: static.File(os.path.join(path, f)) for f in os.listdir(path) if
                                    os.path.exists(os.path.join(path, f))}
                self.indexHtml = ReactIndex(os.path.join(path, 'index.html'))

            def get_file(self, path):
                """
                overrides getChild so it always just serves index.html unless the file does actually exist (i.e. is an
                icon or something like that)
                """
                return self.publicFiles.get(path.decode('utf-8'), self.indexHtml)

        class ReactIndex(static.File):
            """
            a twisted File which overrides getChild so it always just serves index.html (NB: this is a bit of a hack,
            there is probably a more correct way to do this but...)
            """

            def getChild(self, path, request):
                return self

        class FlaskAppWrapper(Resource):
            """
            wraps the flask app as a WSGI resource while allow the react index.html (and its associated static content)
            to be served as the default page.
            """

            def __init__(self):
                super().__init__()
                self.wsgi = WSGIResource(reactor, reactor.getThreadPool(), app)
                import sys
                if getattr(sys, 'frozen', False):
                    # pyinstaller lets you copy files to arbitrary locations under the _MEIPASS root dir
                    uiRoot = os.path.join(sys._MEIPASS, 'ui')
                elif cfg.webapp_path is not None:
                    uiRoot = cfg.webapp_path
                else:
                    # release script moves the ui under the analyser package because setuptools doesn't seem to include
                    # files from outside the package
                    uiRoot = os.path.join(os.path.dirname(__file__), 'ui')
                logger.info('Serving ui from ' + str(uiRoot))
                self.react = ReactApp(uiRoot)
                self.static = static.File(os.path.join(uiRoot, 'static'))
                self.icons = static.File(cfg.icon_path)

            def getChild(self, path, request):
                """
                Overrides getChild to allow the request to be routed to the wsgi app (i.e. flask for the rest api
                calls), the static dir (i.e. for the packaged css/js etc), the various concrete files (i.e. the public
                dir from react-app), the command icons or to index.html (i.e. the react app) for everything else.
                :param path:
                :param request:
                :return:
                """
                # allow CORS (CROSS-ORIGIN RESOURCE SHARING) for debug purposes
                request.setHeader('Access-Control-Allow-Origin', '*')
                request.setHeader('Access-Control-Allow-Methods', 'GET, PUT')
                request.setHeader('Access-Control-Allow-Headers', 'x-prototype-version,x-requested-with')
                request.setHeader('Access-Control-Max-Age', '2520')  # 42 hours
                logger.debug(f"Handling {path}")
                if path == b'api':
                    request.prepath.pop()
                    request.postpath.insert(0, path)
                    return self.wsgi
                elif path == b'static':
                    return self.static
                elif path == b'icons':
                    return self.icons
                else:
                    return self.react.get_file(path)

            def render(self, request):
                return self.wsgi.render(request)

        application = service.Application('ezbeq')
        if cfg.is_access_logging is True:
            site = server.Site(FlaskAppWrapper(), logPath=path.join(cfg.config_path, 'access.log').encode())
        else:
            site = server.Site(FlaskAppWrapper())
        endpoint = endpoints.TCP4ServerEndpoint(reactor, cfg.port, interface='0.0.0.0')
        endpoint.listen(site)
        reactor.run()
    else:
        logger.error('Icons are not available in debug mode')
        # get config from a flask standard place not our config yml
        app.run(debug=cfg.run_in_debug, host='0.0.0.0', port=cfg.port, use_reloader=False)


if __name__ == '__main__':
    main()
