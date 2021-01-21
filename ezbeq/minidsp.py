from contextlib import contextmanager

import time
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
        self.__active_slot = None
        if os.path.exists(self.__file_name):
            with open(self.__file_name, 'r') as f:
                self.__state = json.load(f)
                logger.info(f"Loaded {self.__state} from {self.__file_name}")

    def activate(self, slot: int):
        self.__active_slot = slot

    def put(self, slot, entry: Catalogue):
        self.__update(slot, entry.title)

    def __update(self, slot, value: str):
        logger.info(f"Storing {value} in slot {slot}")
        self.__state[int(slot)]['last'] = value
        with open(self.__file_name, 'w') as f:
            json.dump(self.__state, f, sort_keys=True)
        self.activate(int(slot))

    def error(self, slot: int):
        self.__update(slot, 'ERROR')

    def clear(self, slot: int):
        self.__update(slot, 'Empty')

    def get(self):
        return {'slots': self.__state, 'active': self.__active_slot}


class Minidsps(Resource):

    def __init__(self, **kwargs):
        self.__state: MinidspState = kwargs['minidsp_state']
        self.__bridge: MinidspBridge = kwargs['minidsp_bridge']

    def get(self):
        self.__state.activate(self.__bridge.state())
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
                self.__bridge.send(MinidspBeqCommandGenerator.filt(match, int(slot), self.__bridge.state()))
                self.__state.put(int(slot), match)
            except Exception as e:
                logger.exception(f"Failed to write {id} to Slot {slot}")
                self.__state.error(slot)
            return self.__state.get(), 200
        elif 'command' in payload:
            cmd = payload['command']
            if cmd == 'activate':
                logger.info(f"Activating Slot {slot}")
                try:
                    self.__bridge.send(MinidspBeqCommandGenerator.activate(int(slot)))
                    self.__state.activate(int(slot))
                except Exception as e:
                    logger.exception(f"Failed to activate Slot {slot}")
                    self.__state.error(slot)
                return self.__state.get(), 200
        return self.__state.get(), 404

    def delete(self, slot):
        logger.info(f"Clearing Slot {slot}")
        try:
            self.__bridge.send(MinidspBeqCommandGenerator.filt(None, int(slot), self.__bridge.state()))
            self.__state.clear(slot)
        except Exception as e:
            logger.exception(f"Failed to clear Slot {slot}")
            self.__state.error(slot)
        return self.__state.get(), 200


class MinidspBeqCommandGenerator:

    @staticmethod
    def activate(slot: int):
        return [f"config {slot}"]

    @staticmethod
    def filt(entry: Optional[Catalogue], slot: int, active_slot: Optional[int]):
        # config <slot>
        # input <channel> peq <index> set -- <b0> <b1> <b2> <a1> <a2>
        # input <channel> peq <index> bypass [on|off]
        if active_slot is None or active_slot != slot:
            cmds = MinidspBeqCommandGenerator.activate(slot)
        else:
            cmds = []
        for c in range(2):
            idx = 0
            if entry:
                for f in entry.filters:
                    bq: dict = f['biquads']['96000']
                    coeffs: List[str] = bq['b'] + bq['a']
                    if len(coeffs) != 5:
                        raise ValueError(f"Invalid coeff count {len(coeffs)} at idx {idx}")
                    else:
                        cmds.append(MinidspBeqCommandGenerator.bq(c, idx, coeffs))
                        cmds.append(MinidspBeqCommandGenerator.bypass(c, idx, False))
                        idx += 1
            for i in range(idx, 10):
                cmds.append(MinidspBeqCommandGenerator.bypass(c, i, True))
        return cmds

    @staticmethod
    def bq(channel: int, idx: int, coeffs):
        return f"input {channel} peq {idx} set -- {' '.join(coeffs)}"

    @staticmethod
    def bypass(channel: int, idx: int, bypass: bool):
        return f"input {channel} peq {idx} bypass {'on' if bypass else 'off'}"


class MinidspBridge:

    def __init__(self, cfg: Config):
        from plumbum import local
        from threading import Lock
        self.__lock = Lock()
        self.__ignore_retcode = cfg.ignore_retcode
        cmd = local[cfg.minidsp_exe]
        if cfg.minidsp_options:
            self.__runner = cmd[cfg.minidsp_options.split(' ')]
        else:
            self.__runner = cmd

    def state(self) -> Optional[int]:
        with acquire_timeout(self.__lock, 10) as acquired:
            if acquired:
                active_slot = None
                lines = None
                try:
                    lines = self.__runner(timeout=5)
                    for line in lines.split('\n'):
                        if line.startswith('MasterStatus'):
                            idx = line.find('{ ')
                            if idx > -1:
                                vals = line[idx+2:-2].split(', ')
                                for v in vals:
                                    if v.startswith('preset: '):
                                        active_slot = int(v[8:])
                except:
                    logger.exception(f"Unable to locate active preset in {lines}")
                return active_slot
            else:
                raise OSError(f"Failed to acquire lock on minidsp")

    def send(self, cmds: List[str]):
        with tmp_file(cmds) as file_name:
            self.__do_run(self.__runner['-f', file_name], len(cmds))

    def __do_run(self, cmd, count: int):
        with acquire_timeout(self.__lock, 10) as acquired:
            if acquired:
                kwargs = {'retcode': None} if self.__ignore_retcode else {}
                logger.info(f"Sending {count} via {cmd} {kwargs if kwargs else ''}")
                start = time.time()
                code, stdout, stderr = cmd.run(timeout=5, **kwargs)
                end = time.time()
                logger.info(f"Sent {count} commands in {to_millis(start, end)}ms - result is {code}")
            else:
                raise OSError(f"Failed to acquire lock on minidsp")


def to_millis(start, end, precision=1):
    '''
    Calculates the differences in time in millis.
    :param start: start time in seconds.
    :param end: end time in seconds.
    :return: delta in millis.
    '''
    return round((end - start) * 1000, precision)


@contextmanager
def acquire_timeout(lock, timeout):
    logger.debug("Acquiring LOCK")
    result = lock.acquire(timeout=timeout)
    yield result
    if result:
        logger.debug("Releasing LOCK")
        lock.release()


@contextmanager
def tmp_file(cmds: List[str]):
    import tempfile
    tmp_name = None
    try:
        f = tempfile.NamedTemporaryFile(mode='w+', delete=False)
        for cmd in cmds:
            f.write(cmd)
            f.write('\n')
        tmp_name = f.name
        f.close()
        yield tmp_name
    finally:
        if tmp_name:
            os.unlink(tmp_name)
