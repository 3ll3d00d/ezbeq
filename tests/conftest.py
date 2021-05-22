import json
import logging
import os
from pathlib import Path

import pytest
from pytest_httpserver import HTTPServer

from ezbeq import main
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
    yield main.create_app(MinidspSpyConfig(httpserver.host, httpserver.port, tmp_path))


@pytest.fixture
def minidsp_client(minidsp_app):
    """A test client for the app."""
    return minidsp_app.test_client()


class MinidspSpy:

    def __init__(self):
        self.history = []
        self.pending = []
        self.status = 'MasterStatus { preset: 0, source: Usb, volume: Gain(-0.0), mute: false }\n' \
                      'Input levels: -131.5, -131.5\n' \
                      'Output levels: -131.5, -131.5, -120.0, -131.5'
        self.commands = []

    def take_commands(self):
        cmds = self.commands
        self.commands = []
        return cmds

    def __getitem__(self, item):
        self.pending.append(item)
        return self

    def __call__(self, *args, **kwargs):
        if self.pending:
            self.history.append(self.pending)
            if len(self.pending[-1]) == 2 and self.pending[-1][0] == '-f':
                with open(self.pending[-1][1]) as f:
                    cmds = f.read().split('\n')
                    self.commands.extend([c for c in cmds if c])
            self.pending = []
            return 0, '', ''
        else:
            return self.status

    def run(self, *args, **kwargs):
        return self(*args, **kwargs)

    def __repr__(self):
        return 'MinidspSpy'


class MinidspSpyConfig(Config):

    def __init__(self, host: str, port: int, tmp_path):
        super().__init__('spy', beqcatalogue_url=f"http://{host}:{port}/")
        self.spy = MinidspSpy()
        self.__tmp_path = tmp_path

    def load_config(self):
        return {
            'debug': False,
            'debugLogging': False,
            'accessLogging': False,
            'port': 8080,
            'host': self.default_hostname,
            'useTwisted': False,
            'iconPath': str(Path.home()),
            'minidspExe': 'minidsp'
        }

    def create_minidsp_runner(self):
        return self.spy

    @property
    def config_path(self):
        return self.__tmp_path
