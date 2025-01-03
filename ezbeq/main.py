import faulthandler
import os
import tracemalloc
from os import path
from typing import Tuple

from autobahn.twisted.resource import WebSocketResource
from flask import Flask
from flask_compress import Compress
from flask_restx import Api

from ezbeq.apis import search, version, devices, authors, audiotypes, years, contenttypes, languages, meta, \
    catalogue as cat_api, diagnostics, load
from ezbeq.apis.ws import WsServer, AutobahnWsServer
from ezbeq.catalogue import CatalogueProvider, LoadTester
from ezbeq.config import Config
from ezbeq.device import DeviceRepository

faulthandler.enable()
if hasattr(faulthandler, 'register'):
    import signal

    faulthandler.register(signal.SIGUSR2, all_threads=True)


def create_app(config: Config, ws: WsServer = AutobahnWsServer()) -> Tuple[Flask, WsServer]:
    ws_server = ws
    catalogue = CatalogueProvider(config, ws)
    resource_args = {
        'config': config,
        'ws_server': ws_server,
        'device_bridge': DeviceRepository(config, ws_server, catalogue),
        'catalogue': catalogue,
        'version': config.version,
        'load': LoadTester(os.path.join(config.config_path, 'ezbeq.db'))
    }
    app = Flask('ezbeq')
    app.config['APP_CONFIG'] = config
    Compress(app)
    api = Api(app, prefix='/api', doc='/api/doc/', version=resource_args['version'], title='ezbeq',
              description='Backend api for ezbeq')

    def decorate_ns(ns, p=None):
        for r in ns.resources:
            r.kwargs['resource_class_kwargs'] = resource_args
        api.add_namespace(ns, path=p)

    decorate_ns(devices.device_api)
    decorate_ns(devices.v1_api)
    decorate_ns(devices.v2_api)
    decorate_ns(devices.v3_api)
    decorate_ns(search.api)
    decorate_ns(version.api)
    decorate_ns(authors.api)
    decorate_ns(audiotypes.api)
    decorate_ns(load.api)
    decorate_ns(years.api)
    decorate_ns(contenttypes.api)
    decorate_ns(languages.api)
    decorate_ns(meta.api)
    decorate_ns(cat_api.api)
    if tracemalloc.is_tracing():
        decorate_ns(diagnostics.api)
    return app, ws_server


def main(args=None):
    """ The main routine. """
    cfg = Config('ezbeq')
    logger = cfg.configure_logger()
    app, ws_server = create_app(cfg)

    import logging
    logger = logging.getLogger('twisted')
    from twisted.internet import reactor
    from twisted.web.resource import Resource
    from twisted.web import static, server
    from twisted.web.wsgi import WSGIResource
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
                uiRoot = os.path.join(os.path.dirname(__file__), 'ui')
            if os.path.exists(uiRoot):
                logger.info(f'Serving ui from {uiRoot}')
                self.react = ReactApp(uiRoot)
                self.static = static.File(os.path.join(uiRoot, 'static'))
            else:
                logger.error(f'No UI available in {uiRoot}')
            self.metrics = None
            ws_server.factory.startFactory()
            self.ws_resource = WebSocketResource(ws_server.factory)

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
            if path == b'ws':
                return self.ws_resource
            if path == b'api' or path == b'doc' or path == b'swaggerui':
                request.prepath.pop()
                request.postpath.insert(0, path)
                return self.wsgi
            elif path == b'static':
                return self.static
            elif path == b'metrics' and cfg.enable_metrics:
                from prometheus_client.twisted import MetricsResource
                if not self.metrics:
                    self.metrics = MetricsResource()
                return self.metrics
            else:
                return self.react.get_file(path)

        def render(self, request):
            return self.wsgi.render(request)

    if cfg.is_access_logging is True:
        site = server.Site(FlaskAppWrapper(), logPath=path.join(cfg.config_path, 'access.log').encode())
    else:
        site = server.Site(FlaskAppWrapper())
    endpoint = endpoints.TCP4ServerEndpoint(reactor, cfg.port, interface='0.0.0.0')
    endpoint.listen(site)
    logger.info(f'Listening on port: {cfg.port}')
    reactor.run()


if __name__ == '__main__':
    main()
