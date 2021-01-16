import logging
import os
from logging import handlers
from os import environ
from os import path

import yaml


class Config:
    def __init__(self, name, default_port=8080):
        self._name = name
        self.logger = logging.getLogger(name + '.config')
        self.config = self.__load_config()
        self.icon_path = self.config.get('iconPath')
        self.__hostname = self.config.get('host', self.default_hostname)
        self.__port = self.config.get('port', default_port)
        self.__service_url = f"http://{self.hostname}:{self.port}"
        self.minidsp_exe = self.config.get('minidspExe', 'minidsp')
        self.minidsp_options = self.config.get('minidspOptions', None)
        self.webapp_path = self.config.get('webappPath', None)
        self.use_twisted = self.config.get('useTwisted', True)

    @staticmethod
    def ensure_dir_exists(dir):
        if not os.path.exists(dir):
            os.makedirs(dir)

    @property
    def default_hostname(self):
        import socket
        return socket.getfqdn()

    @property
    def run_in_debug(self):
        """
        :return: if debug mode is on, defaults to False.
        """
        return self.config.get('debug', False)

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
    def hostname(self):
        """
        :return: the host the device is running on, defaults to that found by a call to socket.getfqdn()
        """
        return self.__hostname

    @property
    def port(self):
        """
        :return: the port to listen on, defaults to 8080
        """
        return self.__port

    @property
    def service_url(self):
        """
        :return: the address on which this service is listening.
        """
        return self.__service_url

    @property
    def ignore_retcode(self):
        return self.config.get('ignoreRetcode', False)

    def __load_config(self):
        """
        loads configuration from some predictable locations.
        :return: the config.
        """
        config_path = path.join(self.config_path, self._name + ".yml")
        if os.path.exists(config_path):
            self.logger.warning("Loading config from " + config_path)
            with open(config_path, 'r') as yml:
                return yaml.load(yml, Loader=yaml.FullLoader)
        default_config = self.load_default_config()
        self.__store_config(default_config, config_path)
        return default_config

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
        :return:
        """
        from pathlib import Path
        return {
            'debug': True,
            'debugLogging': True,
            'accessLogging': False,
            'port': 8080,
            'host': self.default_hostname,
            'useTwisted': True,
            'iconPath': str(Path.home())
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
        base_log_level = logging.DEBUG if self.is_debug_logging else logging.INFO
        console_log_level = logging.INFO if self.is_debug_logging else logging.WARN
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
        formatter = logging.Formatter('%(asctime)s - %(name)s - %(levelname)s - %(funcName)s - %(message)s')
        fh.setFormatter(formatter)
        ch.setFormatter(formatter)
        # add the handlers to the logger
        logger.addHandler(fh)
        logger.addHandler(ch)
        return logger
