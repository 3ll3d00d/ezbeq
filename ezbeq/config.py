import logging
import os
import sys
from logging import handlers
from os import environ
from os import path

import yaml


class Config:

    def __init__(self, name, default_port=8080, beqcatalogue_url='https://raw.githubusercontent.com/3ll3d00d/beqcatalogue/master/docs/'):
        self._name = name
        self.logger = logging.getLogger(name + '.config')
        self.config = self.load_config()
        self.__port = self.config.get('port', default_port)
        self.__enable_metrics = self.config.get('metrics', False)
        self.__beqcatalogue_url = beqcatalogue_url
        self.__catalogue_refresh_interval = self.config.get('catalogueRefreshSeconds', 300.0)
        if 'catalogueUrl' in self.config:
            self.__beqcatalogue_url = self.config['catalogueUrl']
            self.logger.warning(f"Loading catalogue from custom location {self.__beqcatalogue_url}")
        self.devices = self.config['devices']
        self.webapp_path = self.config.get('webappPath', None)

    @staticmethod
    def ensure_dir_exists(d) -> None:
        if not os.path.exists(d):
            os.makedirs(d)

    @property
    def enable_metrics(self) -> bool:
        return self.__enable_metrics

    @property
    def chunk_size(self) -> int:
        return max(self.config.get('chunk_size', 4000), 1)

    @property
    def first_chunk_size(self) -> int:
        return max(self.config.get('first_chunk_size', self.chunk_size), 1)

    @property
    def beqcatalogue_url(self) -> str:
        return self.__beqcatalogue_url

    @property
    def catalogue_refresh_interval(self) -> float:
        return self.__catalogue_refresh_interval

    @property
    def is_debug_logging(self):
        """
        :return: if debug logging mode is on, defaults to False.
        """
        return self.config.get('debugLogging', False)

    @property
    def is_access_logging(self):
        """
        :return: if access logging mode is on, defaults to False.
        """
        return self.config.get('accessLogging', False)

    @property
    def port(self):
        """
        :return: the port to listen on, defaults to 8080
        """
        return self.__port

    @property
    def ignore_retcode(self):
        return self.config.get('ignoreRetcode', False)

    def load_config(self):
        """
        loads configuration from some predictable locations.
        :return: the config.
        """
        config_path = path.join(self.config_path, self._name + ".yml")
        cfg = None
        if os.path.exists(config_path):
            self.logger.warning("Loading config from " + config_path)
            with open(config_path, 'r') as yml:
                cfg, changed = self.__migrate(yaml.load(yml, Loader=yaml.FullLoader))
                if changed:
                    import shutil
                    shutil.copyfile(config_path, path.join(self.config_path, self._name + ".yml.bak"))
                    self.__store_config(cfg, config_path)
        if cfg is None:
            cfg = self.load_default_config()
            self.__store_config(cfg, config_path)
        for name, device in cfg['devices'].items():
            if device['type'] == 'minidsp':
                device['make_runner'] = self.create_minidsp_runner
            elif device['type'] == 'camilladsp':
                device['make_wsclient'] = self.create_ws_client

        return cfg

    def __store_config(self, config, config_path):
        """
        Writes the config to the configPath.
        :param config a dict of config.
        :param config_path the path to the file to write to, intermediate dirs will be created as necessary.
        """
        self.logger.info(f"Writing to {config_path}")
        os.makedirs(os.path.dirname(config_path), exist_ok=True)
        with (open(config_path, 'w')) as yml:
            yaml.dump(config, yml, default_flow_style=False)

    def load_default_config(self):
        """
        Creates a default config bundle.
        :return: the bundle.
        """
        return {
            'debugLogging': True,
            'accessLogging': False,
            'port': 8080,
            'devices': {
                'master': {
                    'type': 'minidsp',
                    'exe': 'minidsp',
                    'cmdTimeout': 10,
                    'ignoreRetcode': False
                }
            }
        }

    @property
    def config_path(self):
        """
        Gets the currently configured config path.
        :return: the path, raises ValueError if it doesn't exist.
        """
        conf_home = environ.get('EZBEQ_CONFIG_HOME')
        return conf_home if conf_home is not None else path.join(path.expanduser("~"), '.ezbeq')

    @property
    def default_command_dir(self):
        return os.path.join(self.config_path, 'cmd')

    def configure_logger(self):
        """
        Configures the python logging system to log to a debug file and to stdout for warn and above.
        :return: the base logger.
        """
        base_log_level = logging.DEBUG if self.is_debug_logging is True else logging.INFO
        console_log_level = logging.INFO if self.is_debug_logging is True else logging.WARN
        # create root logger
        logger = logging.getLogger()
        logger.setLevel(base_log_level)
        # file handler
        fh = handlers.RotatingFileHandler(path.join(self.config_path, self._name + '.log'),
                                          maxBytes=10 * 1024 * 1024, backupCount=10)
        fh.setLevel(base_log_level)
        # create console handler with a higher log level
        ch = logging.StreamHandler()
        ch.setLevel(console_log_level)
        # create formatter and add it to the handlers
        formatter = logging.Formatter('%(asctime)s - %(process)d - %(threadName)s - %(name)s - %(levelname)s - %(funcName)s - %(message)s')
        fh.setFormatter(formatter)
        ch.setFormatter(formatter)
        # add the handlers to the logger
        logger.addHandler(fh)
        logger.addHandler(ch)
        return logger

    def create_minidsp_runner(self, exe: str, options: str):
        from plumbum import local
        cmd = local[exe]
        return cmd[options.split(' ')] if options else cmd

    def create_ws_client(self, ip: str, port: int, listener):
        from ezbeq.camilladsp import CamillaDspClient
        return CamillaDspClient(ip, port, listener)

    @property
    def version(self):
        if getattr(sys, 'frozen', False):
            # pyinstaller lets you copy files to arbitrary locations under the _MEIPASS root dir
            root = os.path.join(sys._MEIPASS)
        else:
            root = os.path.dirname(__file__)
        v_name = os.path.join(root, 'VERSION')
        v = 'UNKNOWN'
        if os.path.exists(v_name):
            with open(v_name, 'r') as f:
                v = f.read()
        return v

    @property
    def load_catalogue_at_startup(self):
        return False

    @property
    def db_mmap_mb(self) -> int:
        mmap_mb = 0
        try:
            import psutil
            t = psutil.virtual_memory().total / (1024 * 1024 * 1024)
            if t >= 0.8:
                mmap_mb = 150
            elif t >= 0.4:
                mmap_mb = 50
            else:
                mmap_mb = 0
        except:
            self.logger.exception(f'Unable to get total physical memory, will default to 0')
        return self.config.get('db_mmap_mb', mmap_mb)

    @staticmethod
    def __migrate(cfg):
        changed = False
        if 'devices' not in cfg:
            if not cfg.get('minidspExe', None) and not cfg.get('htp1', None) and not cfg.get('jriver', None):
                cfg['minidspExe'] = 'minidsp'
            cfg['devices'] = {}
            if 'minidspExe' in cfg:
                cfg['devices'] = {
                    'master': {
                        'type': 'minidsp',
                        'exe': cfg['minidspExe'],
                        'cmdTimeout': cfg.get('minidspCmdTimeout', 10),
                        'options': cfg.get('minidspOptions', ''),
                        'ignoreRetcode': cfg.get('ignoreRetcode', False)
                    }
                }
                excluded = ['minidspExe', 'minidspCmdTimeout', 'minidspOptions', 'ignoreRetcode']
                cfg = {k: v for k, v in cfg.items() if k not in excluded}
            elif 'htp1' in cfg:
                cfg['devices'] = {
                    'master': {
                        **cfg['htp1'],
                        'type': 'htp1'
                    }
                }
                del cfg['htp1']
            elif 'jriver' in cfg:
                cfg['devices'] = {
                    'master': {
                        **cfg['jriver'],
                        'type': 'jriver'
                    }
                }
                del cfg['jriver']
            changed = True
        return cfg, changed

