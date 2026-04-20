import faulthandler
import os
import tracemalloc
from os import path

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


def create_app(config: Config, ws: WsServer = AutobahnWsServer()) -> tuple[Flask, WsServer]:
    ws_server = ws
    catalogue = CatalogueProvider(config, ws)
    resource_args = {
        'config': config,
        'ws_server': ws_server,
        'device_bridge': DeviceRepository(config, ws_server, catalogue),
        'catalogue': catalogue,
        'version': config.version,
        'git_info': config.git_info,
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

    # ── Startup summary (logged before anything else so it's at the top) ──────
    # Use WARNING so these lines always appear on the console regardless of the
    # debugLogging setting — they're essential for confirming the right device
    # and mode is active.
    raw = cfg.as_dict()
    logger.warning('=' * 60)
    gi = cfg.git_info
    git_str = f"  git: {gi['branch']}@{gi['sha']}" if gi.get('branch') or gi.get('sha') else ''
    logger.warning(f'  ezbeq  |  port: {cfg.port}  |  config: {cfg.config_path}{git_str}')
    logger.warning(f'  logging: debug={cfg.is_debug_logging}  access={cfg.is_access_logging}')
    for dev_name, dev_cfg in raw.get('devices', {}).items():
        dev_type = dev_cfg.get('type', '?')
        if dev_type == 'minidsp':
            exe = dev_cfg.get('exe', 'minidsp')
            opts = dev_cfg.get('options', '')
            detail = 'STUB (no hardware)' if exe == 'stub' else f'exe={exe}' + (f'  options={opts}' if opts else '')
            logger.warning(f'  device [{dev_name}]  type=minidsp  {detail}')
        elif dev_type == 'camilladsp':
            logger.warning(f'  device [{dev_name}]  type=camilladsp  ip={dev_cfg.get("ip")}:{dev_cfg.get("port")}')
        else:
            logger.warning(f'  device [{dev_name}]  type={dev_type}')
    logger.warning('=' * 60)

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

    class _NoUIPlaceholder(Resource):
        """Served at / when the React app has not been built."""
        isLeaf = True

        def render_GET(self, request):
            request.setHeader(b'Content-Type', b'text/html; charset=utf-8')
            return (
                b'<!DOCTYPE html><html><head><title>ezbeq</title></head><body>'
                b'<h1>ezbeq</h1>'
                b'<p>The React UI has not been built. '
                b'See the <a href="https://github.com/3ll3d00d/ezbeq#installation">README</a> '
                b'for setup instructions.</p>'
                b'<hr>'
                b'<p>API: <a href="/api/1/">/api/1/</a> &nbsp;|&nbsp; '
                b'Swagger: <a href="/api/doc">/api/doc</a></p>'
                b'</body></html>'
            )

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
                if hasattr(self, 'static'):
                    return self.static
            elif path == b'metrics' and cfg.enable_metrics:
                from prometheus_client.twisted import MetricsResource
                if not self.metrics:
                    self.metrics = MetricsResource()
                return self.metrics
            else:
                if hasattr(self, 'react'):
                    return self.react.get_file(path)
                # No UI built — serve a helpful placeholder for the root, 404 for everything else
                if path == b'':
                    return _NoUIPlaceholder()
            from twisted.web.resource import NoResource
            return NoResource('UI not available: the React app has not been built')

        def render(self, request):
            return self.wsgi.render(request)

    # Separate logger for access log lines written to stdout, so they can be
    # filtered independently from the main application log.
    access_logger = logging.getLogger('ezbeq.access')
    # When EZBEQ_ACCESS_LOG_STDOUT=1 each request is also echoed to stdout so
    # it appears in `docker compose logs`.  This is set by default in
    # docker-compose.dev.yaml for local development.
    _access_log_stdout = os.environ.get('EZBEQ_ACCESS_LOG_STDOUT', '0').strip() == '1'

    class SafeSite(server.Site):
        """
        A Site subclass that handles access log write failures gracefully.
        Twisted's DailyLogFile can enter a broken state when the log file is deleted
        externally (e.g. container restart) - the rotation code closes the file handle
        before renaming it, and if the rename fails the handle stays closed. Subsequent
        writes then raise ValueError which propagates through request.finish() and leaves
        HTTP responses in a hung state, locking up the UI.

        When log_to_stdout=True each access log line is also written to the
        'ezbeq.access' Python logger so it appears on stdout / in docker logs.
        """

        def __init__(self, resource, access_log_path=None, log_to_stdout=False, **kwargs):
            super().__init__(resource, **kwargs)
            self._access_log_path = access_log_path
            self._log_to_stdout = log_to_stdout
            if access_log_path is not None:
                self._reopen_log()

        def _reopen_log(self):
            from twisted.python.logfile import DailyLogFile
            try:
                self.logFile = DailyLogFile.fromFullPath(self._access_log_path)
                logger.info(f'Access log opened: {self._access_log_path}')
            except Exception:
                logger.exception(f'Failed to open access log at {self._access_log_path}, access logging disabled')
                self.logFile = None

        def log(self, request):
            try:
                server.Site.log(self, request)
            except (ValueError, FileNotFoundError, OSError):
                logger.warning('Access log write failed, attempting to reopen')
                if self._access_log_path:
                    self._reopen_log()
            if self._log_to_stdout:
                from twisted.web import http
                ts = http.datetimeToString()
                if isinstance(ts, bytes):
                    ts = ts.decode('utf-8', errors='replace')
                line = self._logFormatter(ts, request)
                if isinstance(line, bytes):
                    line = line.decode('utf-8', errors='replace')
                access_logger.info(line)

    if cfg.is_access_logging is True:
        site = SafeSite(FlaskAppWrapper(),
                        access_log_path=path.join(cfg.config_path, 'access.log'),
                        log_to_stdout=_access_log_stdout)
    else:
        site = SafeSite(FlaskAppWrapper(), log_to_stdout=_access_log_stdout)
    endpoint = endpoints.TCP4ServerEndpoint(reactor, cfg.port, interface='0.0.0.0')
    endpoint.listen(site)
    reactor.run()


if __name__ == '__main__':
    main()
