import json
import logging
import os
import re
import threading
from pathlib import Path
from queue import SimpleQueue
from threading import Thread
from time import sleep
from typing import List, Optional, Callable

import pytest
import yaml
from pytest_httpserver import HTTPServer

from ezbeq import main
from ezbeq.config import Config
from ezbeq.apis.ws import WsServer, WsServerFactory

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
    app, ws = main.create_app(MinidspSpyConfig(httpserver.host, httpserver.port, tmp_path))
    yield app


@pytest.fixture
def minidsp_client(minidsp_app):
    """A test client for the app."""
    return minidsp_app.test_client()


@pytest.fixture
def minidsp_ddrc24_app(httpserver: HTTPServer, tmp_path):
    """Create and configure a new app instance for each test."""
    app, ws = main.create_app(MinidspSpyConfig(httpserver.host, httpserver.port, tmp_path, device_type='DDRC24'))
    yield app


@pytest.fixture
def minidsp_ddrc24_client(minidsp_ddrc24_app):
    """A test client for the app."""
    return minidsp_ddrc24_app.test_client()


@pytest.fixture
def minidsp_ddrc88_app(httpserver: HTTPServer, tmp_path):
    """Create and configure a new app instance for each test."""
    app, ws = main.create_app(MinidspSpyConfig(httpserver.host, httpserver.port, tmp_path, device_type='DDRC88'))
    yield app


@pytest.fixture
def minidsp_ddrc88_client(minidsp_ddrc88_app):
    """A test client for the app."""
    return minidsp_ddrc88_app.test_client()


@pytest.fixture
def minidsp_4x10_app(httpserver: HTTPServer, tmp_path):
    """Create and configure a new app instance for each test."""
    app, ws = main.create_app(MinidspSpyConfig(httpserver.host, httpserver.port, tmp_path, device_type='4x10'))
    yield app


@pytest.fixture
def minidsp_4x10_client(minidsp_4x10_app):
    """A test client for the app."""
    return minidsp_4x10_app.test_client()


@pytest.fixture
def minidsp_10x10_app(httpserver: HTTPServer, tmp_path):
    """Create and configure a new app instance for each test."""
    app, ws = main.create_app(MinidspSpyConfig(httpserver.host, httpserver.port, tmp_path, device_type='10x10'))
    yield app


@pytest.fixture
def minidsp_10x10_client(minidsp_10x10_app):
    """A test client for the app."""
    return minidsp_10x10_app.test_client()


@pytest.fixture
def minidsp_10x10xo0_app(httpserver: HTTPServer, tmp_path):
    """Create and configure a new app instance for each test."""
    app, ws = main.create_app(MinidspSpyConfig(httpserver.host, httpserver.port, tmp_path, device_type='10x10xo0'))
    yield app


@pytest.fixture
def minidsp_10x10xo0_client(minidsp_10x10xo0_app):
    """A test client for the app."""
    return minidsp_10x10xo0_app.test_client()


@pytest.fixture
def minidsp_10x10xo1_app(httpserver: HTTPServer, tmp_path):
    """Create and configure a new app instance for each test."""
    app, ws = main.create_app(MinidspSpyConfig(httpserver.host, httpserver.port, tmp_path, device_type='10x10xo1'))
    yield app


@pytest.fixture
def minidsp_10x10xo1_client(minidsp_10x10xo1_app):
    """A test client for the app."""
    return minidsp_10x10xo1_app.test_client()


@pytest.fixture
def minidsp_shd_app(httpserver: HTTPServer, tmp_path):
    """Create and configure a new app instance for each test."""
    app, ws = main.create_app(MinidspSpyConfig(httpserver.host, httpserver.port, tmp_path, device_type='SHD'))
    yield app


@pytest.fixture
def minidsp_shd_client(minidsp_shd_app):
    """A test client for the app."""
    return minidsp_shd_app.test_client()


@pytest.fixture
def camilladsp_app(httpserver: HTTPServer, tmp_path):
    """Create and configure a new app instance for each test."""
    cfg = CamillaDspSpyConfig(httpserver.host, httpserver.port, tmp_path, channels=[1])
    app, ws = main.create_app(cfg, cfg.msg_spy)
    yield app


@pytest.fixture
def camilladsp_client(camilladsp_app):
    """A test client for the app."""
    return camilladsp_app.test_client()


CONFIG_PATTERN = re.compile(r'config ([0-3])')
GAIN_PATTERN = re.compile(r'gain -- ([-+]?\d*\.\d+|\d+)')


class MinidspSpy:

    def __init__(self):
        self.history = []
        self.pending = []
        self.__slot = 1
        self.__gain = 0.0
        self.__mute = False
        self.commands = []

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

    def __init__(self, host: str, port: int, tmp_path, device_type: str = None):
        if device_type and device_type[-3:-1] == 'xo':
            self.device_type = device_type[:-3]
            self.use_xo = device_type[-1]
        else:
            self.device_type = device_type
            self.use_xo = False
        super().__init__('spy', beqcatalogue_url=f"http://{host}:{port}/")
        self.spy = MinidspSpy()
        self.__tmp_path = tmp_path

    def load_config(self):
        vals = {
            'debug': False,
            'debugLogging': False,
            'accessLogging': False,
            'port': 8080,
            'host': self.default_hostname,
            'useTwisted': False,
            'iconPath': str(Path.home()),
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


class CamillaDspSpy:

    def __init__(self, base_cfg: dict):
        from ezbeq.camilladsp import CamillaDsp
        self.__listener: Optional[CamillaDsp] = None
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
            except:
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

    def __init__(self, host: str, port: int, tmp_path, cfg_name: str = 'simple.yaml', channels: List[int] = None):
        self.channels = channels if channels else [3]
        super().__init__('spy', beqcatalogue_url=f"http://{host}:{port}/")
        with open(os.path.join(__location__, cfg_name), 'r') as yml:
            self.spy = CamillaDspSpy(yaml.load(yml, Loader=yaml.FullLoader))
        self.msg_spy = CapturingWsServer()
        self.__tmp_path = tmp_path

    def load_config(self):
        vals = {
            'debug': False,
            'debugLogging': False,
            'accessLogging': False,
            'port': 8080,
            'host': self.default_hostname,
            'useTwisted': False,
            'iconPath': str(Path.home()),
            'devices': {
                'master': {
                    'type': 'camilladsp',
                    'ip': '127.0.0.1',
                    'port': 5432,
                    'channels': self.channels,
                    'make_wsclient': self.create_ws_client
                }
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


class CapturingWsServerFactory(WsServerFactory):

    def __init__(self, msg_queue: SimpleQueue):
        self.__msg_queue = msg_queue

    def init(self, state_provider: Callable[[], str]):
        pass

    def broadcast(self, msg: str):
        self.__msg_queue.put(msg)

    def has_levels_client(self, device: str) -> bool:
        pass

    def set_levels_provider(self, name: str, broadcaster: Callable[[], None]):
        pass


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
            except:
                break
        return msgs
