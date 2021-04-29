import json
import logging
import os
import time
from abc import ABC, abstractmethod
from concurrent.futures.thread import ThreadPoolExecutor
from contextlib import contextmanager
from typing import List, Optional, Union

import semver
from flask import request
from flask_restful import Resource

from ezbeq.catalogue import Catalogue, CatalogueProvider
from ezbeq.config import Config

logger = logging.getLogger('ezbeq.minidsp')


def get_channels(cfg: Config) -> List[str]:
    if cfg.minidsp_exe:
        return [str(i + 1) for i in range(4)]
    else:
        return ['HTP1']


class DeviceState:

    def __init__(self, cfg: Config):
        self.__state = [{'id': id, 'last': 'Empty', 'gain1': '0.0', 'gain2': '0.0', 'mute1': False, 'mute2': False} for
                        id in get_channels(cfg)]
        self.__can_activate = cfg.minidsp_exe is not None
        self.__file_name = os.path.join(cfg.config_path, 'device.json')
        self.__active_slot = None
        self.__master_volume = None
        self.__mute = None
        if os.path.exists(self.__file_name):
            with open(self.__file_name, 'r') as f:
                j = json.load(f)
                saved_ids = {v['id'] for v in j}
                current_ids = {v['id'] for v in self.__state}
                if saved_ids == current_ids:
                    self.__state = j
                    logger.info(f"Loaded {self.__state} from {self.__file_name}")
                else:
                    logger.warning(f"Discarded {j} from {self.__file_name}, does not match {self.__state}")

    def activate(self, slot: str):
        self.__active_slot = slot

    def put(self, slot: str, entry: Catalogue):
        self.__update(slot, 'last', entry.formatted_title)

    def __update(self, slot: str, key: str, value: Union[str, bool]):
        logger.info(f"Storing {value} in slot {slot} key {key}")
        for s in self.__state:
            if s['id'] == slot:
                s[key] = value
        with open(self.__file_name, 'w') as f:
            json.dump(self.__state, f, sort_keys=True)
        self.activate(slot)

    def error(self, slot: str):
        self.__update(slot, 'last', 'ERROR')

    def clear(self, slot: str):
        self.__update(slot, 'last', 'Empty')

    def gain(self, slot: str, channel: Optional[str], value: str):
        if slot == '0' or channel is None:
            self.__master_volume = value
        else:
            self.__update(slot, f'gain{channel}', value)

    def mute(self, slot: str, channel: Optional[str], value: str):
        if slot == '0' or channel is None:
            self.__mute = value
        else:
            self.__update(slot, f'mute{channel}', value)

    def get(self):
        values = {'slots': [{
            **s,
            'canActivate': self.__can_activate,
            'active': True if self.__active_slot is not None and s['id'] == self.__active_slot else False
        } for s in self.__state]}
        if self.__mute is not None:
            values['mute'] = self.__mute
        if self.__master_volume is not None:
            values['masterVolume'] = self.__master_volume
        return values


class Devices(Resource):

    def __init__(self, **kwargs):
        self.__state: DeviceState = kwargs['device_state']
        self.__bridge: DeviceBridge = kwargs['device_bridge']

    def get(self):
        state = self.__bridge.state()
        self.__state.activate(state['active_slot'])
        self.__state.mute('0', '0', state['mute'])
        self.__state.gain('0', '0', state['volume'])
        return self.__state.get()


class DeviceSender(Resource):

    def __init__(self, **kwargs):
        self.__bridge: DeviceBridge = kwargs['device_bridge']
        self.__catalogue_provider: CatalogueProvider = kwargs['catalogue']
        self.__state: DeviceState = kwargs['device_state']

    def put(self, slot):
        payload = request.get_json()
        if 'command' in payload:
            cmd = payload['command']
            if cmd == 'load':
                if 'id' in payload:
                    return self.__handle_load(payload, slot)
            elif cmd == 'activate':
                return self.__handle_activate(slot)
            elif cmd == 'mute':
                if 'value' in payload:
                    return self.__handle_mute(payload, slot, cmd)
            elif cmd == 'gain':
                if 'value' in payload:
                    return self.__handle_gain(payload, slot, cmd)
        return self.__state.get(), 404

    def __handle_gain(self, payload, slot, cmd):
        value = payload['value']
        channel = payload['channel'] if 'channel' in payload else None
        float_value = round(float(value), 2)
        if slot == '0':
            if not -127.0 <= float_value <= 0.0:
                logger.exception(f"Invalid value for gain: {value}")
                return {'message': f"Invalid value for gain: {value}"}, 400
        else:
            if not -72.0 <= float_value <= 12.0:
                logger.exception(f"Invalid value for gain: {value}")
                return {'message': f"Invalid value for gain: {value}"}, 400
        try:
            self.__bridge.send(slot, payload, cmd)
            self.__state.gain(slot, channel, value)
            return self.__state.get(), 200
        except Exception as e:
            logger.exception(f"Failed to set gain on channel {slot}")
            return self.__state.get(), 500

    def __handle_activate(self, slot):
        logger.info(f"Activating Slot {slot}")
        try:
            self.__bridge.send(slot, True, 'activate')
            self.__state.activate(slot)
        except Exception as e:
            logger.exception(f"Failed to activate Slot {slot}")
            self.__state.error(slot)
        return self.__state.get(), 200

    def __handle_load(self, payload, slot):
        payload_id = payload['id']
        logger.info(f"Sending {payload_id} to Slot {slot}")
        match: Catalogue = next((c for c in self.__catalogue_provider.catalogue if c.idx == payload_id), None)
        if not match:
            logger.warning(f"No title with ID {payload_id} in catalogue {self.__catalogue_provider.version}")
            return {'message': 'Title not found, please refresh.'}, 400
        try:
            self.__bridge.send(slot, match, 'load')
            self.__state.put(slot, match)
        except Exception as e:
            logger.exception(f"Failed to write {payload_id} to Slot {slot}")
            self.__state.error(slot)
        return self.__state.get(), 200

    def __handle_mute(self, payload, slot, cmd):
        value = payload['value']
        channel = payload['channel'] if 'channel' in payload else None
        if value != 'on' and value != 'off':
            logger.exception(f"Invalid value for mute: {value}")
            return {'message': f"Invalid value for mute: {value}"}, 400
        try:
            self.__bridge.send(slot, payload, cmd)
            self.__state.mute(slot, channel, value == 'on')
            return self.__state.get(), 200
        except Exception as e:
            logger.exception(f"Failed mute channel {slot}")
            return self.__state.get(), 500

    def delete(self, slot):
        logger.info(f"Clearing Slot {slot}")
        try:
            self.__bridge.send(slot, None, 'clear')
            self.__state.clear(slot)
        except Exception as e:
            logger.exception(f"Failed to clear Slot {slot}")
            self.__state.error(slot)
        return self.__state.get(), 200


class Bridge(ABC):

    @abstractmethod
    def state(self) -> Optional[str]:
        pass

    @abstractmethod
    def send(self, slot: str, entry: Union[Optional[Catalogue], bool, dict], command: str):
        pass


class DeviceBridge(Bridge):

    def __init__(self, cfg: Config):
        self.__bridge = Minidsp(cfg) if cfg.minidsp_exe else Htp1(cfg) if cfg.htp1_options else None
        if self.__bridge is None:
            raise ValueError('Must have minidsp or HTP1 in confi')

    def state(self) -> Optional[dict]:
        return self.__bridge.state()

    def send(self, slot: str, entry: Union[Optional[Catalogue], bool, dict], command: str):
        return self.__bridge.send(slot, entry, command)


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

    @staticmethod
    def mute(state: bool, slot: int, channel: Optional[int], active_slot: Optional[int]):
        if slot < 0:
            return [f"mute {state}"]
        elif channel is not None:
            if active_slot is None or active_slot != slot:
                cmds = MinidspBeqCommandGenerator.activate(slot)
            else:
                cmds = []
            if channel == -1:
                cmds.append(f"input 0 mute {state}")
                cmds.append(f"input 1 mute {state}")
            else:
                cmds.append(f"input {channel} mute {state}")
            return cmds

    @staticmethod
    def volume(gain: str, slot: int, channel: Optional[int], active_slot: Optional[int]):
        if slot < 0:
            return [f"gain -- {gain}"]
        elif channel is not None:
            if active_slot is None or active_slot != slot:
                cmds = MinidspBeqCommandGenerator.activate(slot)
            else:
                cmds = []
            if channel == -1:
                cmds.append(f"input 0 gain -- {gain}")
                cmds.append(f"input 1 gain -- {gain}")
            else:
                cmds.append(f"input {channel} gain -- {gain}")
            return cmds


class Minidsp(Bridge):

    def __init__(self, cfg: Config):
        from plumbum import local
        self.__executor = ThreadPoolExecutor(max_workers=1)
        self.__ignore_retcode = cfg.ignore_retcode
        cmd = local[cfg.minidsp_exe]
        if cfg.minidsp_options:
            self.__runner = cmd[cfg.minidsp_options.split(' ')]
        else:
            self.__runner = cmd

    def state(self) -> Optional[dict]:
        return self.__executor.submit(self.__get_state).result(timeout=60)

    def __get_state(self) -> Optional[dict]:
        values = {}
        lines = None
        try:
            kwargs = {'retcode': None} if self.__ignore_retcode else {}
            lines = self.__runner(timeout=5, **kwargs)
            for line in lines.split('\n'):
                if line.startswith('MasterStatus'):
                    idx = line.find('{ ')
                    if idx > -1:
                        vals = line[idx + 2:-2].split(', ')
                        for v in vals:
                            if v.startswith('preset: '):
                                values['active_slot'] = str(int(v[8:]) + 1)
                            elif v.startswith('mute: '):
                                values['mute'] = v[6:] == 'true'
                            elif v.startswith('volume: Gain('):
                                values['volume'] = v[13:-1]
        except:
            logger.exception(f"Unable to locate active preset in {lines}")
        return values

    def send(self, slot: str, entry: Union[Optional[Catalogue], bool, dict], command: str):
        target_slot_idx = int(slot) - 1
        state = self.state()
        active_slot = int(state['active_slot']) - 1 if state['active_slot'] else None
        channel = int(entry['channel']) - 1 if isinstance(entry, dict) and 'channel' in entry else None
        if command == 'load' or command == 'clear':
            cmds = MinidspBeqCommandGenerator.filt(entry, target_slot_idx, active_slot)
        elif command == 'activate':
            cmds = MinidspBeqCommandGenerator.activate(target_slot_idx)
        elif command == 'mute':
            cmds = MinidspBeqCommandGenerator.mute(entry['value'], target_slot_idx, channel, active_slot)
        elif command == 'gain':
            cmds = MinidspBeqCommandGenerator.volume(entry['value'], target_slot_idx, channel, active_slot)
        else:
            cmds = []
        with tmp_file(cmds) as file_name:
            return self.__executor.submit(self.__do_run, self.__runner['-f', file_name], len(cmds),
                                          target_slot_idx).result(timeout=60)

    def __do_run(self, cmd, count: int, slot: int):
        kwargs = {'retcode': None} if self.__ignore_retcode else {}
        logger.info(f"Sending {count} commands to slot {slot} via {cmd} {kwargs if kwargs else ''}")
        start = time.time()
        code, stdout, stderr = cmd.run(timeout=5, **kwargs)
        end = time.time()
        logger.info(f"Sent {count} commands to slot {slot} in {to_millis(start, end)}ms - result is {code}")


def to_millis(start, end, precision=1):
    '''
    Calculates the differences in time in millis.
    :param start: start time in seconds.
    :param end: end time in seconds.
    :return: delta in millis.
    '''
    return round((end - start) * 1000, precision)


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


class Htp1(Bridge):

    def __init__(self, cfg: Config):
        self.__ip = cfg.htp1_options['ip']
        self.__channels = cfg.htp1_options['channels']
        self.__peq = {}
        self.__supports_shelf = True
        if not self.__channels:
            raise ValueError('No channels supplied for HTP-1')
        from ezbeq.htp1 import Htp1Client
        self.__client = Htp1Client(self.__ip, self)

    def state(self) -> Optional[dict]:
        pass

    def send(self, slot: str, entry: Union[Optional[Catalogue], bool, dict], command: str):
        if entry is None or isinstance(entry, Catalogue):
            if entry is not None:
                to_load = [PEQ(idx, fc=f['freq'], q=f['q'], gain=f['gain'], filter_type_name=f['type'])
                           for idx, f in enumerate(entry.filters)]
            else:
                to_load = []
            while len(to_load) < 16:
                peq = PEQ(len(to_load), fc=100, q=1, gain=0, filter_type_name='PeakingEQ')
                to_load.append(peq)
            ops = [peq.as_ops(c, use_shelf=self.__supports_shelf) for peq in to_load for c in self.__peq.keys()]
            ops = [op for slot_ops in ops for op in slot_ops if op]
            if ops:
                self.__client.send(f"changemso {json.dumps(ops)}")
            else:
                logger.warning(f"Nothing to send to {slot}")
        else:
            raise ValueError('Activation not supported')

    def on_mso(self, mso: dict):
        logger.info(f"Received {mso}")
        version = mso['versions']['swVer']
        version = version[1:] if version[0] == 'v' or version[0] == 'V' else version
        try:
            self.__supports_shelf = semver.parse_version_info(version) > semver.parse_version_info('1.4.0')
        except:
            logger.error(f"Unable to parse version {mso['versions']['swVer']}, will not send shelf filters")
            self.__supports_shelf = False
        if not self.__supports_shelf:
            logger.error(f"Device version {mso['versions']['swVer']} too old, lacks shelf filter support")

        speakers = mso['speakers']['groups']
        channels = ['lf', 'rf']
        for group in [s for s, v in speakers.items() if 'present' in v and v['present'] is True]:
            if group[0:2] == 'lr' and len(group) > 2:
                channels.append('l' + group[2:])
                channels.append('r' + group[2:])
            else:
                channels.append(group)

        peq_slots = mso['peq']['slots']

        filters = {c: [] for c in channels}
        unknown_channels = set()
        for idx, s in enumerate(peq_slots):
            for c in channels:
                if c in s['channels']:
                    filters[c].append(PEQ(idx, s['channels'][c]))
                else:
                    unknown_channels.add(c)
        if unknown_channels:
            peq_channels = peq_slots[0]['channels'].keys()
            logger.error(f"Unknown channels encountered [peq channels: {peq_channels}, unknown: {unknown_channels}]")
        for c in filters.keys():
            if c in self.__channels:
                logger.info(f"Updating PEQ channel {c} with {filters[c]}")
                self.__peq[c] = filters[c]
            else:
                logger.info(f"Discarding filter channel {c} - {filters[c]}")

    def on_msoupdate(self, msoupdate: dict):
        logger.info(f"Received {msoupdate}")


class PEQ:

    def __init__(self, slot, params=None, fc=None, q=None, gain=None, filter_type_name=None):
        self.slot = slot
        if params is not None:
            self.fc = params['Fc']
            self.q = params['Q']
            self.gain = params['gaindB']
            self.filter_type = params.get('FilterType', 0)
            self.filter_type_name = 'PeakingEQ' if self.filter_type == 0 else 'LowShelf' if self.filter_type == 1 else 'HighShelf'
        else:
            self.fc = fc
            self.q = q
            self.gain = gain
            self.filter_type = 0 if filter_type_name == 'PeakingEQ' else 1 if filter_type_name == 'LowShelf' else 2
            self.filter_type_name = filter_type_name

    def as_ops(self, channel: str, use_shelf: bool = True):
        if self.filter_type == 0 or use_shelf:
            prefix = f"/peq/slots/{self.slot}/channels/{channel}"
            ops = [
                {
                    'op': 'replace',
                    'path': f"{prefix}/Fc",
                    'value': self.fc
                },
                {
                    'op': 'replace',
                    'path': f"{prefix}/Q",
                    'value': self.q
                },
                {
                    'op': 'replace',
                    'path': f"{prefix}/gaindB",
                    'value': self.gain
                }
            ]
            if use_shelf:
                ops.append(
                    {
                        'op': 'replace',
                        'path': f"{prefix}/FilterType",
                        'value': self.filter_type
                    }
                )
            return ops
        else:
            return []

    def __repr__(self):
        return f"{self.slot}: {self.filter_type_name} {self.fc} Hz {self.gain} dB {self.q}"
