import json
import logging
import os
import re
import threading
import time
from collections.abc import Callable
from queue import Empty, SimpleQueue
from threading import Thread
from time import sleep

import pytest
import yaml
from pytest_httpserver import HTTPServer

from ezbeq import main
from ezbeq.apis.ws import WsServer, WsServerFactory
from ezbeq.config import Config

__location__ = os.path.realpath(os.path.join(os.getcwd(), os.path.dirname(__file__)))


@pytest.fixture
def beqc() -> dict:
    with open(os.path.join(__location__, 'catalogue.json')) as json_file:
        return json.load(json_file)


@pytest.fixture(autouse=True)
def configure_downloader(httpserver: HTTPServer, beqc: dict):
    httpserver.expect_request("/version.txt").respond_with_data("123456", content_type="text/plain")
    httpserver.expect_request("/database.json").respond_with_json(beqc)


@pytest.fixture(scope="session", autouse=True)
def logger():
    logger = logging.getLogger()
    logger.setLevel(logging.DEBUG)
    ch = logging.StreamHandler()
    formatter = logging.Formatter('%(asctime)s - %(name)s - %(levelname)s - %(funcName)s - %(message)s')
    ch.setFormatter(formatter)
    logger.addHandler(ch)


@pytest.fixture
def minidsp_app(httpserver: HTTPServer, tmp_path):
    """Create and configure a new app instance for each test."""
    app, _ws = main.create_app(MinidspSpyConfig(httpserver.host, httpserver.port, tmp_path))
    yield app


@pytest.fixture
def minidsp_client(minidsp_app):
    """A test client for the app."""
    return minidsp_app.test_client()


@pytest.fixture
def reaper_app(httpserver: HTTPServer, tmp_path):
    """
    Create and configure a new app instance for each test, wired up to
    talk to the SAME fake httpserver used for catalogue downloads
    (configure_downloader above) - reaper.py's HTTP calls to REAPER's Web
    Control interface land on this same fake server, so we can use
    httpserver.log to inspect exactly what was sent, the same way the
    real REAPER machine would receive it.
    """
    app, _ws = main.create_app(ReaperSpyConfig(httpserver.host, httpserver.port, tmp_path))
    yield app


@pytest.fixture
def reaper_client(reaper_app):
    """A test client for the app."""
    return reaper_app.test_client()


@pytest.fixture
def minidsp_ddrc24_app(httpserver: HTTPServer, tmp_path):
    """Create and configure a new app instance for each test."""
    app, _ws = main.create_app(MinidspSpyConfig(httpserver.host, httpserver.port, tmp_path, device_type='DDRC24'))
    yield app


@pytest.fixture
def minidsp_ddrc24_client(minidsp_ddrc24_app):
    """A test client for the app."""
    return minidsp_ddrc24_app.test_client()


@pytest.fixture
def minidsp_ddrc88_app(httpserver: HTTPServer, tmp_path):
    """Create and configure a new app instance for each test."""
    app, _ws = main.create_app(MinidspSpyConfig(httpserver.host, httpserver.port, tmp_path, device_type='DDRC88'))
    yield app


@pytest.fixture
def minidsp_ddrc88_client(minidsp_ddrc88_app):
    """A test client for the app."""
    return minidsp_ddrc88_app.test_client()


@pytest.fixture
def minidsp_4x10_app(httpserver: HTTPServer, tmp_path):
    """Create and configure a new app instance for each test."""
    app, _ws = main.create_app(MinidspSpyConfig(httpserver.host, httpserver.port, tmp_path, device_type='4x10'))
    yield app


@pytest.fixture
def minidsp_4x10_client(minidsp_4x10_app):
    """A test client for the app."""
    return minidsp_4x10_app.test_client()


@pytest.fixture
def minidsp_10x10_app(httpserver: HTTPServer, tmp_path):
    """Create and configure a new app instance for each test."""
    app, _ws = main.create_app(MinidspSpyConfig(httpserver.host, httpserver.port, tmp_path, device_type='10x10'))
    yield app


@pytest.fixture
def minidsp_10x10_client(minidsp_10x10_app):
    """A test client for the app."""
    return minidsp_10x10_app.test_client()


@pytest.fixture
def minidsp_10x10xo0_app(httpserver: HTTPServer, tmp_path):
    """Create and configure a new app instance for each test."""
    app, _ws = main.create_app(MinidspSpyConfig(httpserver.host, httpserver.port, tmp_path, device_type='10x10xo0'))
    yield app


@pytest.fixture
def minidsp_10x10xo0_client(minidsp_10x10xo0_app):
    """A test client for the app."""
    return minidsp_10x10xo0_app.test_client()


@pytest.fixture
def minidsp_10x10xo1_app(httpserver: HTTPServer, tmp_path):
    """Create and configure a new app instance for each test."""
    app, _ws = main.create_app(MinidspSpyConfig(httpserver.host, httpserver.port, tmp_path, device_type='10x10xo1'))
    yield app


@pytest.fixture
def minidsp_10x10xo1_client(minidsp_10x10xo1_app):
    """A test client for the app."""
    return minidsp_10x10xo1_app.test_client()


@pytest.fixture
def minidsp_shd_app(httpserver: HTTPServer, tmp_path):
    """Create and configure a new app instance for each test."""
    app, _ws = main.create_app(MinidspSpyConfig(httpserver.host, httpserver.port, tmp_path, device_type='SHD'))
    yield app


@pytest.fixture
def minidsp_shd_client(minidsp_shd_app):
    """A test client for the app."""
    return minidsp_shd_app.test_client()


@pytest.fixture
def minidsp_htx_app(httpserver: HTTPServer, tmp_path):
    """Create and configure a new app instance for each test."""
    app, _ws = main.create_app(MinidspSpyConfig(httpserver.host, httpserver.port, tmp_path, device_type='HTx', version=''))
    yield app


@pytest.fixture
def minidsp_htx_client(minidsp_htx_app):
    """A test client for the app."""
    return minidsp_htx_app.test_client()


@pytest.fixture
def minidsp_htx_inputs_app(httpserver: HTTPServer, tmp_path):
    """Create and configure a new app instance for each test."""
    app, _ws = main.create_app(MinidspSpyConfig(httpserver.host, httpserver.port, tmp_path, device_type='HTx', version='0.1.13'))
    yield app


@pytest.fixture
def minidsp_htx_inputs_client(minidsp_htx_inputs_app):
    """A test client for the app."""
    return minidsp_htx_inputs_app.test_client()


@pytest.fixture
def single_camilladsp3_app(httpserver: HTTPServer, tmp_path):
    """Create and configure a new app instance for each test."""
    cfg = CamillaDspSpyConfig(httpserver.host, httpserver.port, tmp_path, cfg_name='single3.yaml', version=3, channels=[1])
    app, _ws = main.create_app(cfg, cfg.msg_spy)
    yield app


@pytest.fixture
def single_camilladsp3_client(single_camilladsp3_app):
    """A test client for the app."""
    return single_camilladsp3_app.test_client()


@pytest.fixture
def multi_camilladsp3_app(httpserver: HTTPServer, tmp_path):
    """Create and configure a new app instance for each test."""
    cfg = CamillaDspSpyConfig(httpserver.host, httpserver.port, tmp_path, cfg_name='multi3.yaml', version=3, channels=[2,3])
    app, _ws = main.create_app(cfg, cfg.msg_spy)
    yield app


@pytest.fixture
def multi_camilladsp3_client(multi_camilladsp3_app):
    """A test client for the app."""
    return multi_camilladsp3_app.test_client()


@pytest.fixture
def stormaudio_app(httpserver: HTTPServer, tmp_path):
    """Create and configure a new StormAudio app instance for each test."""
    app, _ws = main.create_app(StormAudioSpyConfig(httpserver.host, httpserver.port, tmp_path))
    yield app


@pytest.fixture
def stormaudio_client(stormaudio_app):
    """A test client for the app."""
    return stormaudio_app.test_client()


@pytest.fixture
def stub_app(tmp_path):
    """App instance using MinidspStubRunner - no hardware required."""
    app, _ws = main.create_app(StubConfig(tmp_path))
    yield app


@pytest.fixture
def stub_client(stub_app):
    """Test client for the stub app."""
    return stub_app.test_client()


CONFIG_PATTERN = re.compile(r'config ([0-3])')
GAIN_PATTERN = re.compile(r'gain -- ([-+]?\d*\.\d+|\d+)')


class MinidspSpy:

    def __init__(self, version_str: str = ''):
        self.history = []
        self.pending = []
        self.__slot = 1
        self.__gain = 0.0
        self.__mute = False
        self.commands = []
        self._version_str = version_str

    def __make_status(self) -> str:
        mute_str = f"{self.__mute}".lower()
        return '{"master":{"preset":' + str(self.__slot - 1) + \
               ',"source":"Usb","volume":' + f"{self.__gain:.1f}" + \
               ',"mute":' + mute_str + \
               '},"input_levels":[-15.814797,-15.652734],"output_levels":[-120.0,-15.861839,-15.661137,-15.661137]}'

    def take_commands(self):
        cmds = self.commands
        self.commands = []
        return cmds

    def __getitem__(self, item):
        if item == ('-o', 'jsonline'):
            return self
        else:
            self.pending.append(item)
            return self

    def __call__(self, *args, **kwargs):
        if args and args[0] == '-V':
            return self._version_str
        if self.pending:
            self.history.append(self.pending)
            if len(self.pending[-1]) == 2 and self.pending[-1][0] == '-f':
                with open(self.pending[-1][1]) as f:
                    new_cmds = [c for c in f.read().split('\n') if c]
                for c in new_cmds:
                    if c == 'mute on':
                        self.__mute = True
                    elif c == 'mute off':
                        self.__mute = False
                    else:
                        m = GAIN_PATTERN.match(c)
                        if m:
                            self.__gain = float(m.group(1))
                        else:
                            m = CONFIG_PATTERN.match(c)
                            if m:
                                self.__slot = int(m.group(1)) + 1
                self.commands.extend(new_cmds)
            self.pending = []
            return 0, '', ''
        else:
            return self.__make_status()

    def run(self, *args, **kwargs):
        return self(*args, **kwargs)

    def __repr__(self):
        return 'MinidspSpy'


class MinidspSpyConfig(Config):

    def __init__(self, host: str, port: int, tmp_path, device_type: str | None = None, version: str = ''):
        if device_type and device_type[-3:-1] == 'xo':
            self.device_type = device_type[:-3]
            self.use_xo = device_type[-1]
        else:
            self.device_type = device_type
            self.use_xo = False
        super().__init__('spy', beqcatalogue_url=f"http://{host}:{port}/")
        self.spy = MinidspSpy(version_str=version)
        self.__tmp_path = tmp_path

    @property
    def load_catalogue_at_startup(self):
        return True

    def load_config(self):
        vals = {
            'debugLogging': False,
            'accessLogging': False,
            'port': 8080,
            'devices': {
                'master': {
                    'type': 'minidsp',
                    'exe': 'minidsp',
                    'cmdTimeout': 10,
                    'make_runner': self.create_minidsp_runner
                }
            }
        }
        if self.device_type:
            vals['devices']['master']['device_type'] = self.device_type
        if self.use_xo is not False:
            vals['devices']['master']['use_xo'] = self.use_xo
        return vals

    def create_minidsp_runner(self, exe: str, options: str):
        return self.spy

    @property
    def config_path(self):
        return self.__tmp_path

    @property
    def version(self):
        return '1.2.3'

    @property
    def check_for_updates(self):
        # Spy configs must never make live network calls to GitHub during tests.
        return False


class ReaperSpyConfig(Config):
    """
    Test double for the Reaper device's config. Unlike MinidspSpyConfig
    (which fakes the minidsp CLI process) or CamillaDspSpyConfig (which
    fakes a websocket server), Reaper's device talks plain HTTP - so this
    just points reaper.py's 'ip' config value at the SAME fake httpserver
    already used for catalogue downloads, letting tests inspect exactly
    what reaper.py sent via httpserver.log rather than needing a custom
    spy/mock object.
    """

    def __init__(self, host: str, port: int, tmp_path):
        self.__host = host
        self.__port = port
        self.__tmp_path = tmp_path
        super().__init__('spy', beqcatalogue_url=f"http://{host}:{port}/")

    @property
    def load_catalogue_at_startup(self):
        return True

    def load_config(self):
        return {
            'debugLogging': False,
            'accessLogging': False,
            'port': 8080,
            'devices': {
                'reaper1': {
                    'type': 'reaper',
                    'ip': f'{self.__host}:{self.__port}',
                    # short timeout so a test that deliberately doesn't stub
                    # a response (if any) fails fast rather than hanging
                    'timeout': 2,
                }
            }
        }

    @property
    def config_path(self):
        return self.__tmp_path

    @property
    def version(self):
        return '1.2.3'

    @property
    def check_for_updates(self):
        # Spy configs must never make live network calls to GitHub during tests.
        return False


class CamillaDspSpy:

    def __init__(self, base_cfg: dict):
        from ezbeq.camilladsp import CamillaDsp
        self.__listener: CamillaDsp | None = None
        self.__inited = threading.Event()
        self.__inited.clear()
        self.__slot = 1
        self.__mv = 0.0
        self.__mmute = False
        self.__gain = 0.0
        self.__mute = False
        self.__current_cfg = base_cfg
        self.__cmd_queue = SimpleQueue()

    @property
    def inited(self) -> bool:
        return self.__inited.is_set()

    def take_commands(self):
        cmds = []
        while True:
            try:
                cmd = self.__cmd_queue.get(block=False)
                if cmd:
                    cmds.append(cmd)
                else:
                    break
            except Empty:
                break
        return cmds

    @property
    def listener(self):
        return self.__listener

    @listener.setter
    def listener(self, listener):
        self.__listener = listener
        thread = Thread(target=self.__do_init)
        thread.start()

    def __do_init(self):
        sleep(0.5)
        self.__listener.on_open()
        self.__inited.set()

    def send(self, msg: str):
        payload = json.loads(msg)
        if payload == 'GetConfigJson':
            self.__cmd_queue.put('GetConfigJson')
            self.listener.on_get_config({'result': 'Ok', 'value': json.dumps(self.__current_cfg)})
        elif payload == 'GetVolume':
            self.__cmd_queue.put('GetVolume')
            self.listener.on_get_volume({'result': 'Ok', 'value': self.__mv})
        elif payload == 'GetMute':
            self.__cmd_queue.put('GetMute')
            self.listener.on_get_mute({'result': 'Ok', 'value': self.__mmute})
        elif payload == 'Reload':
            self.__cmd_queue.put('Reload')
            self.listener.on_reload('Ok')
        elif 'SetMute' in payload:
            self.__cmd_queue.put(payload)
            self.__mmute = payload['SetMute']
        elif 'SetVolume' in payload:
            self.__cmd_queue.put(payload)
            self.__mv = payload['SetVolume']
        elif 'SetConfigJson' in payload:
            self.__cmd_queue.put(payload)
            self.__current_cfg = json.loads(payload['SetConfigJson'])
            self.listener.on_set_config('Ok')
        elif 'SetUpdateInterval' in payload:
            self.__cmd_queue.put('SetUpdateInterval')

    def __repr__(self):
        return 'CamillaDspSpy'


class CamillaDspSpyConfig(Config):

    def __init__(self, host: str, port: int, tmp_path, cfg_name: str, version: int, channels: list[int] | None = None):
        self.channels = channels if channels else [3]
        self.__version = version
        super().__init__('spy', beqcatalogue_url=f"http://{host}:{port}/")
        with open(os.path.join(__location__, cfg_name), 'r') as yml:
            self.spy = CamillaDspSpy(yaml.load(yml, Loader=yaml.FullLoader))
        self.msg_spy = CapturingWsServer()
        self.__tmp_path = tmp_path

    @property
    def load_catalogue_at_startup(self):
        return True

    def load_config(self):
        v = {'version': 2} if self.__version < 3 else {}
        vals = {
            'debugLogging': False,
            'accessLogging': False,
            'port': 8080,
            'devices': {
                'master': {
                    'type': 'camilladsp',
                    'ip': '127.0.0.1',
                    'port': 5432,
                    'channels': self.channels,
                    'make_wsclient': self.create_ws_client
                } | v
            }
        }
        return vals

    def create_ws_client(self, ip: str, port: int, listener):
        self.spy.listener = listener
        return self.spy

    @property
    def config_path(self):
        return self.__tmp_path

    @property
    def version(self):
        return '1.2.3'

    @property
    def check_for_updates(self):
        # Spy configs must never make live network calls to GitHub during tests.
        return False


class StormAudioSpyConfig(Config):

    def __init__(self, host: str, port: int, tmp_path):
        self.__host = host
        self.__port = port
        self.__tmp_path = tmp_path
        super().__init__('spy', beqcatalogue_url=f"http://{host}:{port}/")

    @property
    def load_catalogue_at_startup(self):
        return True

    def load_config(self):
        return {
            'debugLogging': False,
            'accessLogging': False,
            'port': 8080,
            'devices': {
                'master': {
                    'type': 'stormaudio',
                    'url': f"http://{self.__host}:{self.__port}/mso.php",
                    'profileName': 'New Profile 1',
                    'subCount': 2,
                    'timeout': 5,
                    'ratio': {
                        'default': {
                            'gain': 1.0,
                            'q': 1.0,
                        },
                        'byType': {
                            'LowShelf': {
                                'gain': 0.5,
                                'q': 2.0,
                            }
                        }
                    }
                }
            }
        }

    @property
    def config_path(self):
        return self.__tmp_path

    @property
    def version(self):
        return '1.2.3'

    @property
    def check_for_updates(self):
        # Spy configs must never make live network calls to GitHub during tests.
        return False


class CapturingWsServerFactory(WsServerFactory):

    def __init__(self, msg_queue: SimpleQueue):
        self.__msg_queue = msg_queue

    def init_state_provider(self, state_provider: Callable[[], str]):
        pass

    def init_meta_provider(self, meta_provider: Callable[[], str]):
        pass

    def init_catalogue_loader(self, loader: Callable[[Callable[[str], None]], None]):
        pass

    def broadcast(self, msg: str):
        self.__msg_queue.put(msg)

    def has_levels_client(self, device: str) -> bool:
        pass

    def set_levels_provider(self, name: str, broadcaster: Callable[[], None]):
        pass


class StubConfig(Config):
    """Config that uses MinidspStubRunner - no hardware or minidsp binary required."""

    def __init__(self, tmp_path):
        self.__tmp_path = tmp_path
        super().__init__('stub')

    def load_config(self):
        return {
            'debugLogging': False,
            'accessLogging': False,
            'port': 8080,
            'devices': {
                'master': {
                    'type': 'minidsp',
                    'exe': 'stub',
                    'cmdTimeout': 10,
                    'make_runner': self.create_minidsp_runner
                }
            }
        }

    @property
    def config_path(self):
        return str(self.__tmp_path)

    @property
    def version(self):
        return '1.2.3'

    @property
    def check_for_updates(self):
        # Spy configs must never make live network calls to GitHub during tests.
        return False

    @property
    def load_catalogue_at_startup(self):
        return False


class CapturingWsServer(WsServer[CapturingWsServerFactory]):

    def __init__(self):
        self.__msg_queue = SimpleQueue()
        super().__init__(CapturingWsServerFactory(self.__msg_queue))

    def take_messages(self):
        msgs = []
        while True:
            try:
                cmd = self.__msg_queue.get(block=False)
                if cmd:
                    msgs.append(cmd)
                else:
                    break
            except Empty:
                break
        return msgs


class FlakyMinidspSpy(MinidspSpy):
    """
    A MinidspSpy that can be told, via fail_next, to raise on its very next
    invocation - used to simulate one member of a composite device going
    offline/erroring while its siblings keep working. Can also be given an
    artificial delay (and records each invocation's start time) to prove a
    composite device's fan-out is parallel, not sequential.
    """

    def __init__(self):
        super().__init__()
        self.fail_next = False
        self.delay = 0.0
        self.call_starts: list[float] = []

    def __call__(self, *args, **kwargs):
        self.call_starts.append(time.time())
        if self.delay:
            sleep(self.delay)
        if self.fail_next:
            self.fail_next = False
            self.pending = []
            raise RuntimeError('simulated member failure')
        return super().__call__(*args, **kwargs)


class CompositeMirrorSpyConfig(Config):
    """
    Config for a mirror-mode composite ('bass_array') over N MinidspSpy-backed
    minidsp members - the easy-mode path: identical member type, no
    per-member slot/channel translation.
    """

    def __init__(self, host: str, port: int, tmp_path, member_count: int = 2, expose_members: bool = False):
        self.spies: dict[str, FlakyMinidspSpy] = {f'sub{i + 1}': FlakyMinidspSpy() for i in range(member_count)}
        self.__expose_members = expose_members
        super().__init__('spy', beqcatalogue_url=f"http://{host}:{port}/")
        self.__tmp_path = tmp_path

    @property
    def load_catalogue_at_startup(self):
        return True

    def load_config(self):
        devices = {
            name: {
                'type': 'minidsp',
                'exe': 'minidsp',
                'cmdTimeout': 10,
                'make_runner': self.__runner_factory(name)
            }
            for name in self.spies
        }
        devices['bass_array'] = {
            'type': 'composite',
            'mode': 'mirror',
            'members': list(self.spies.keys()),
            'exposeMembers': self.__expose_members
        }
        return {
            'debugLogging': False,
            'accessLogging': False,
            'port': 8080,
            'devices': devices
        }

    def __runner_factory(self, name: str):
        def _make(exe: str, options: str):
            return self.spies[name]
        return _make

    @property
    def config_path(self):
        return self.__tmp_path

    @property
    def version(self):
        return '1.2.3'

    @property
    def check_for_updates(self):
        return False


class CompositeMappedSpyConfig(Config):
    """
    Config for a mapped-mode composite ('home_theatre') over two genuinely
    different device types - a MinidspSpy-backed minidsp ('sub1') and an
    HTTP-backed reaper ('reaper1', sharing the fake httpserver already used
    for catalogue downloads) - the complex-mode path. sub1's slots '1'/'2'
    both map onto reaper1's single 'REAPER' slot via slotMap, and reaper1
    opts out of mute/unmute/set_gain via skipOps since Reaper doesn't
    support them (see ezbeq/reaper.py).
    """

    def __init__(self, host: str, port: int, tmp_path, expose_members: bool = False):
        self.spy = FlakyMinidspSpy()
        self.__host = host
        self.__port = port
        self.__expose_members = expose_members
        super().__init__('spy', beqcatalogue_url=f"http://{host}:{port}/")
        self.__tmp_path = tmp_path

    @property
    def load_catalogue_at_startup(self):
        return True

    def load_config(self):
        return {
            'debugLogging': False,
            'accessLogging': False,
            'port': 8080,
            'devices': {
                'sub1': {
                    'type': 'minidsp',
                    'exe': 'minidsp',
                    'cmdTimeout': 10,
                    'make_runner': lambda exe, options: self.spy
                },
                'reaper1': {
                    'type': 'reaper',
                    'ip': f'{self.__host}:{self.__port}',
                    'timeout': 2
                },
                'home_theatre': {
                    'type': 'composite',
                    'mode': 'mapped',
                    'primary': 'sub1',
                    'exposeMembers': self.__expose_members,
                    'members': {
                        'sub1': {},
                        'reaper1': {
                            'slotMap': {'1': 'REAPER', '2': 'REAPER'},
                            'skipOps': ['mute', 'unmute', 'set_gain']
                        }
                    }
                }
            }
        }

    @property
    def config_path(self):
        return self.__tmp_path

    @property
    def version(self):
        return '1.2.3'

    @property
    def check_for_updates(self):
        return False


@pytest.fixture
def composite_mirror_cfg(httpserver: HTTPServer, tmp_path):
    return CompositeMirrorSpyConfig(httpserver.host, httpserver.port, tmp_path)


@pytest.fixture
def composite_mirror_app(composite_mirror_cfg):
    app, _ws = main.create_app(composite_mirror_cfg)
    yield app


@pytest.fixture
def composite_mirror_client(composite_mirror_app):
    return composite_mirror_app.test_client()


@pytest.fixture
def composite_mapped_cfg(httpserver: HTTPServer, tmp_path):
    return CompositeMappedSpyConfig(httpserver.host, httpserver.port, tmp_path)


@pytest.fixture
def composite_mapped_app(composite_mapped_cfg):
    app, _ws = main.create_app(composite_mapped_cfg)
    yield app


@pytest.fixture
def composite_mapped_client(composite_mapped_app):
    return composite_mapped_app.test_client()
