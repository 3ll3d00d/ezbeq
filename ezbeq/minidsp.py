import logging
from typing import List

from flask_restful import Resource

from catalogue import Catalogue, CatalogueProvider
from config import Config

logger = logging.getLogger('ezbeq.minidsp')


class Minidsp(Resource):

    def __init__(self, **kwargs):
        self.__bridge: MinidspBridge = kwargs['minidsp_bridge']
        self.__catalogue_provider: CatalogueProvider = kwargs['catalogue']

    def get(self, id, slot):
        logger.info(f"Sending {id} to Slot {slot}")
        match: Catalogue = next(c for c in self.__catalogue_provider.catalogue if c.idx == int(id))
        self.__bridge.send(match, int(slot))
        return match.short_search, 200


class MinidspBridge:

    def __init__(self, cfg: Config):
        from plumbum import local
        cmd = local[cfg.minidsp_exe]
        if cfg.minidsp_options:
            self.__runner = cmd[cfg.minidsp_options.split(' ')]
        else:
            self.__runner = cmd

    def send(self, entry: Catalogue, slot: int):
        self.__send_config(slot)
        for c in range(2):
            idx = 0
            for f in entry.filters:
                bq: dict = f['biquads']['96000']
                coeffs: List[str] = bq['b'] + bq['a']
                if len(coeffs) != 5:
                    raise ValueError(f"Invalid coeff count {len(coeffs)} at idx {idx}")
                else:
                    self.__send_biquad(str(c), str(idx), coeffs)
                    idx += 1
            for i in range(idx, 10):
                self.__send_bypass(str(c), str(i), True)

    def __send_config(self, slot):
        # minidsp config <slot>
        cmd = self.__runner['config', str(slot)]
        logger.info(f"Executing {cmd}")
        self.__do_run(cmd)

    @staticmethod
    def __do_run(cmd):
        cmd.run(timeout=5)

    def __send_biquad(self, channel: str, idx: str, coeffs: List[str]):
        # minidsp input <channel> peq <index> set -- <b0> <b1> <b2> <a1> <a2>
        cmd = self.__runner['input', channel, 'peq', idx, 'set', '--', coeffs]
        logger.info(f"Executing {cmd}")
        self.__do_run(cmd)
        self.__send_bypass(channel, idx, False)

    def __send_bypass(self, channel: str, idx: str, bypass: bool):
        # minidsp input <channel> bypass on
        cmd = self.__runner['input', channel, 'peq', idx, 'bypass', 'on' if bypass else 'off']
        logger.info(f"Executing {cmd}")
        self.__do_run(cmd)
