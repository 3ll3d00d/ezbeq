import json
import logging
import os
from typing import List, Optional

from flask import request
from flask_restful import Resource

from ezbeq.catalogue import Catalogue, CatalogueProvider
from ezbeq.config import Config

logger = logging.getLogger('ezbeq.minidsp')


class MinidspState:

    def __init__(self, cfg: Config):
        self.__state = [{'id': id, 'last': 'Empty'} for id in range(4)]
        self.__file_name = os.path.join(cfg.config_path, 'minidsp.json')
        if os.path.exists(self.__file_name):
            with open(self.__file_name, 'r') as f:
                self.__state = json.load(f)
                logger.info(f"Loaded {self.__state} from {self.__file_name}")

    def put(self, slot, entry: Catalogue):
        self.__update(slot, entry.title)

    def __update(self, slot, value: str):
        logger.info(f"Storing {value} in slot {slot}")
        self.__state[int(slot)]['last'] = value
        with open(self.__file_name, 'w') as f:
            json.dump(self.__state, f, sort_keys=True)

    def error(self, slot: int):
        self.__update(slot, 'ERROR')

    def clear(self, slot: int):
        self.__update(slot, 'Empty')

    def get(self):
        return self.__state


class Minidsps(Resource):

    def __init__(self, **kwargs):
        self.__state: MinidspState = kwargs['minidsp_state']

    def get(self):
        return self.__state.get()


class MinidspSender(Resource):

    def __init__(self, **kwargs):
        self.__bridge: MinidspBridge = kwargs['minidsp_bridge']
        self.__catalogue_provider: CatalogueProvider = kwargs['catalogue']
        self.__state: MinidspState = kwargs['minidsp_state']

    def put(self, slot):
        payload = request.get_json()
        if 'id' in payload:
            id = payload['id']
            logger.info(f"Sending {id} to Slot {slot}")
            match: Catalogue = next(c for c in self.__catalogue_provider.catalogue if c.idx == int(id))
            try:
                self.__bridge.send(match, int(slot))
                self.__state.put(slot, match)
            except Exception as e:
                logger.exception(f"Failed to write {id} to Slot {slot}")
                self.__state.error(slot)
            return self.__state.get(), 200
        elif 'command' in payload:
            cmd = payload['command']
            if cmd == 'activate':
                logger.info(f"Activating Slot {slot}")
                try:
                    self.__bridge.activate(int(slot))
                except Exception as e:
                    logger.exception(f"Failed to activate Slot {slot}")
                    self.__state.error(slot)
                return self.__state.get(), 200
        return self.__state.get(), 404

    def delete(self, slot):
        logger.info(f"Clearing Slot {slot}")
        try:
            self.__bridge.send(None, int(slot))
            self.__state.clear(slot)
        except Exception as e:
            logger.exception(f"Failed to clear Slot {slot}")
            self.__state.error(slot)
        return self.__state.get(), 200


class MinidspBridge:

    def __init__(self, cfg: Config):
        from plumbum import local
        self.__ignore_retcode = cfg.ignore_retcode
        cmd = local[cfg.minidsp_exe]
        if cfg.minidsp_options:
            self.__runner = cmd[cfg.minidsp_options.split(' ')]
        else:
            self.__runner = cmd

    def activate(self, slot: int):
        self.__send_config(slot)

    def send(self, entry: Optional[Catalogue], slot: int):
        self.__send_config(slot)
        for c in range(2):
            idx = 0
            if entry:
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

    def __do_run(self, cmd):
        kwargs = {'retcode': None} if self.__ignore_retcode else {}
        cmd.run(timeout=5, **kwargs)

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
