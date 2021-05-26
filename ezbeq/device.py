import json
import logging
import os
from abc import ABC, abstractmethod
from concurrent.futures.thread import ThreadPoolExecutor
from contextlib import contextmanager
from typing import List, Optional, Union

import semver
import time

from ezbeq.catalogue import Catalogue
from ezbeq.config import Config

logger = logging.getLogger('ezbeq.minidsp')


def get_channels(cfg: Config) -> List[str]:
    if cfg.minidsp_exe:
        return [str(i + 1) for i in range(4)]
    else:
        return ['HTP1']


class SlotState:

    def __init__(self, slot_id: str):
        self.__slot_id = slot_id
        self.last = 'Empty'
        self.active = False

    @property
    def slot_id(self) -> str:
        return self.__slot_id

    def merge_with(self, state: dict) -> bool:
        if 'last' in state:
            self.last = state['last']
        return True

    def as_dict(self) -> dict:
        return {'id': self.slot_id, 'last': self.last, 'active': self.active}

    def __repr__(self):
        return f"{'*' if self.active else ''} {self.slot_id} - {self.last}"

    def clear(self):
        self.last = 'Empty'

    def set_gain(self, channel: Optional[int], value: float):
        pass

    def mute(self, channel: Optional[int]):
        pass

    def unmute(self, channel: Optional[int]):
        pass


class MinidspSlotState(SlotState):

    def __init__(self, slot_id: str):
        super().__init__(slot_id)
        self.gain1 = 0.0
        self.mute1 = False
        self.gain2 = 0.0
        self.mute2 = False

    def clear(self):
        super().clear()
        self.gain1 = 0.0
        self.gain2 = 0.0
        self.mute1 = False
        self.mute2 = False

    def set_gain(self, channel: Optional[int], value: float):
        if channel is None:
            self.gain1 = value
            self.gain2 = value
        else:
            if channel == 1:
                self.gain1 = value
            elif channel == 2:
                self.gain2 = value
            else:
                raise ValueError(f'Unknown channel {channel} for slot {self.slot_id}')

    def mute(self, channel: Optional[int]):
        self.__do_mute(channel, True)

    def __do_mute(self, channel: Optional[int], value: bool):
        if channel is None:
            self.mute1 = value
            self.mute2 = value
        else:
            if channel == 1:
                self.mute1 = value
            elif channel == 2:
                self.mute2 = value
            else:
                raise ValueError(f'Unknown channel {channel} for slot {self.slot_id}')

    def unmute(self, channel: Optional[int]):
        self.__do_mute(channel, False)

    def merge_with(self, state: dict) -> bool:
        super().merge_with(state)
        if 'gain1' in state:
            self.gain1 = float(state['gain1'])
        if 'gain2' in state:
            self.gain2 = float(state['gain2'])
        if 'mute1' in state:
            self.mute1 = bool(state['mute1'])
        if 'mute2' in state:
            self.mute2 = bool(state['mute2'])
        return True

    def as_dict(self) -> dict:
        sup = super().as_dict()
        return {
            **sup,
            'gain1': self.gain1,
            'gain2': self.gain2,
            'mute1': self.mute1,
            'mute2': self.mute2,
            'canActivate': True
        }

    def __repr__(self):
        return f"{super().__repr__()} - 1: {self.gain1:.2f}/{self.mute1} 2: {self.gain1:.2f}/{self.mute2}"


class DeviceState:

    def __init__(self, name: str, channel_ids: List[str], has_gain: bool):
        self.__name: str = name
        self.__slots: List[SlotState] = [MinidspSlotState(c_id) if has_gain else SlotState(c_id)
                                         for c_id in channel_ids]
        self.mute: bool = False
        self.master_volume: float = 0.0

    @property
    def name(self):
        return self.__name

    def __repr__(self):
        return f"{self.name} MV: {self.master_volume:.2f} Mute: {self.mute} [Slots: {self.__slots}]"

    def merge_with(self, serialised_state: dict) -> bool:
        saved_slots_by_id = {v['id']: v for v in serialised_state}
        current_slots_by_id = {s.slot_id: s for s in self.__slots}
        if saved_slots_by_id.keys() == current_slots_by_id.keys():
            for slot_id, state in saved_slots_by_id.items():
                current_slots_by_id[slot_id].merge_with(state)
            return True
        else:
            return False

    def get_slot(self, slot_id) -> SlotState:
        return next(s for s in self.__slots if s.slot_id == slot_id)

    def serialise(self):
        return [s.as_dict() for s in self.__slots]

    def as_dict(self) -> dict:
        return {
            'mute': self.mute,
            'masterVolume': self.master_volume,
            'slots': [s.as_dict() for s in self.__slots]
        }

    def activate(self, slot_id: str):
        for s in self.__slots:
            s.active = s.slot_id == slot_id


class DeviceStateHolder:

    def __init__(self, cfg: Config):
        self.__state = DeviceState('master', get_channels(cfg), cfg.minidsp_exe is not None)
        self.__file_name = os.path.join(cfg.config_path, 'device.json')
        self.__initialised = False
        if os.path.exists(self.__file_name):
            with open(self.__file_name, 'r') as f:
                j = json.load(f)
            if self.__state.merge_with(j):
                logger.info(f"Loaded {self.__state} from {self.__file_name}")
            else:
                logger.warning(f"Discarded {j} from {self.__file_name}, does not match {self.__state}")

    def initialise(self, bridge: 'DeviceBridge') -> None:
        if not self.__initialised:
            device_state = bridge.state()
            if device_state:
                if 'active_slot' in device_state:
                    self.activate(str(device_state['active_slot'] + 1))
                if 'mute' in device_state:
                    self.master_mute = device_state['mute'] is True
                if 'volume' in device_state:
                    self.master_volume = device_state['volume']

    def activate(self, slot: str):
        self.__state.activate(slot)

    def set_loaded_entry(self, slot: str, entry: Catalogue):
        self.__set_last(slot, entry.formatted_title)

    def __set_last(self, slot: str, title: str):
        self.__state.get_slot(slot).last = title
        self.__activate_and_cache(slot)

    def __activate_and_cache(self, slot: str):
        self.activate(slot)
        with open(self.__file_name, 'w') as f:
            json.dump(self.__state.serialise(), f, sort_keys=True)

    def error(self, slot: str):
        self.__set_last(slot, 'ERROR')
        self.__activate_and_cache(slot)

    def clear(self, slot: str):
        self.__state.get_slot(slot).clear()

    @property
    def master_volume(self):
        return self.__state.master_volume

    @master_volume.setter
    def master_volume(self, value: float):
        self.__state.master_volume = value

    @property
    def master_mute(self):
        return self.__state.mute

    @master_mute.setter
    def master_mute(self, value: bool):
        self.__state.mute = value

    def set_slot_gain(self, slot: str, channel: Optional[int], value: float):
        self.__state.get_slot(slot).set_gain(channel, value)
        self.__activate_and_cache(slot)

    def mute_slot(self, slot: str, channel: Optional[int]):
        self.__state.get_slot(slot).mute(channel)
        self.__activate_and_cache(slot)

    def unmute_slot(self, slot: str, channel: Optional[int]):
        self.__state.get_slot(slot).unmute(channel)
        self.__activate_and_cache(slot)

    def get(self) -> DeviceState:
        return self.__state
        # TODO render
        # values = {'slots': [{
        #     **s,
        #     'canActivate': self.__can_activate,
        #     'active': True if self.__active_slot is not None and s['id'] == self.__active_slot else False
        # } for s in self.__state]}
        # if self.__mute is not None:
        #     values['mute'] = self.__mute
        # elif self.__can_activate:
        #     values['mute'] = False
        # if self.__master_volume is not None:
        #     values['masterVolume'] = self.__master_volume
        # elif self.__can_activate:
        #     values['masterVolume'] = 0.0
        # return values


class Bridge(ABC):

    @abstractmethod
    def state(self) -> Optional[str]:
        pass

    @abstractmethod
    def activate(self, slot: str) -> None:
        pass

    @abstractmethod
    def load_filter(self, slot: str, entry: Catalogue) -> None:
        pass

    @abstractmethod
    def clear_filter(self, slot: str) -> None:
        pass

    @abstractmethod
    def mute(self, slot: Optional[str], channel: Optional[int]) -> None:
        pass

    @abstractmethod
    def unmute(self, slot: Optional[str], channel: Optional[int]) -> None:
        pass

    @abstractmethod
    def set_gain(self, slot: Optional[str], channel: Optional[int], gain: float) -> None:
        pass


class DeviceBridge(Bridge):

    def __init__(self, cfg: Config):
        self.__bridge = create_bridge(cfg)

    def supports_gain(self):
        return isinstance(self.__bridge, Minidsp)

    def state(self) -> Optional[dict]:
        return self.__bridge.state()

    def activate(self, slot: str):
        return self.__bridge.activate(slot)

    def load_filter(self, slot: str, entry: Catalogue):
        return self.__bridge.load_filter(slot, entry)

    def clear_filter(self, slot: str):
        return self.__bridge.clear_filter(slot)

    def mute(self, slot: Optional[str], channel: Optional[int]) -> None:
        return self.__bridge.mute(slot, channel)

    def unmute(self, slot: Optional[str], channel: Optional[int]) -> None:
        return self.__bridge.unmute(slot, channel)

    def set_gain(self, slot: Optional[str], channel: Optional[int], gain: float) -> None:
        return self.__bridge.set_gain(slot, channel, gain)


def create_bridge(cfg: Config) -> Bridge:
    if cfg.minidsp_exe:
        return Minidsp(cfg)
    elif cfg.htp1_options:
        return Htp1(cfg)
    else:
        raise ValueError('No device configured')


class MinidspBeqCommandGenerator:

    @staticmethod
    def activate(slot: int) -> str:
        return f"config {slot}"

    @staticmethod
    def filt(entry: Optional[Catalogue]):
        # input <channel> peq <index> set -- <b0> <b1> <b2> <a1> <a2>
        # input <channel> peq <index> bypass [on|off]
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
    def mute(state: bool, slot: Optional[int], channel: Optional[int]):
        '''
        Generates commands to mute the configuration.
        :param state: mute if true otherwise unmute.
        :param slot: the target slot, if not set apply to the master control.
        :param channel: the channel, applicable only if slot is set, if not set apply to both input channels.
        :return: the commands.
        '''
        state_cmd = 'on' if state else 'off'
        if slot is not None:
            cmds = []
            if channel is None:
                cmds.append(f"input 0 mute {state_cmd}")
                cmds.append(f"input 1 mute {state_cmd}")
            else:
                cmds.append(f"input {channel} mute {state_cmd}")
            return cmds
        else:
            return [f"mute {state_cmd}"]

    @staticmethod
    def gain(gain: float, slot: Optional[int], channel: Optional[int]):
        '''
        Generates commands to set gain.
        :param gain: the gain to set.
        :param slot: the target slot, if not set apply to the master control.
        :param channel: the channel, applicable only if slot is set, if not set apply to both input channels.
        :return: the commands.
        '''
        if slot is not None:
            if not -72.0 <= gain <= 12.0:
                raise InvalidRequestError(f"Input gain {gain:.2f} out of range (>= -72.0 and <= 12.0)")
            cmds = []
            if channel is None:
                cmds.append(f"input 0 gain -- {gain:.2f}")
                cmds.append(f"input 1 gain -- {gain:.2f}")
            else:
                cmds.append(f"input {channel} gain -- {gain:.2f}")
            return cmds
        else:
            if not -127.0 <= gain <= 0.0:
                raise InvalidRequestError(f"Master gain {gain:.2f} out of range (>= -127.0 and <= 0.0)")
            return [f"gain -- {gain:.2f}"]


class Minidsp(Bridge):

    def __init__(self, cfg: Config):
        self.__executor = ThreadPoolExecutor(max_workers=1)
        self.__cmd_timeout = cfg.minidsp_cmd_timeout
        self.__ignore_retcode = cfg.ignore_retcode
        self.__runner = cfg.create_minidsp_runner()

    def state(self) -> Optional[dict]:
        return self.__executor.submit(self.__get_state).result(timeout=self.__cmd_timeout)

    def __get_state(self) -> Optional[dict]:
        values = {}
        lines = None
        try:
            kwargs = {'retcode': None} if self.__ignore_retcode else {}
            lines = self.__runner(timeout=self.__cmd_timeout, **kwargs)
            for line in lines.split('\n'):
                if line.startswith('MasterStatus'):
                    idx = line.find('{ ')
                    if idx > -1:
                        vals = line[idx + 2:-2].split(', ')
                        for v in vals:
                            if v.startswith('preset: '):
                                values['active_slot'] = int(v[8:])
                            elif v.startswith('mute: '):
                                values['mute'] = v[6:] == 'true'
                            elif v.startswith('volume: Gain('):
                                values['volume'] = float(v[13:-1])
        except:
            logger.exception(f"Unable to locate active preset in {lines}")
        return values

    @staticmethod
    def __as_idx(idx: Union[int, str]):
        return int(idx) - 1

    def __send_cmds(self, target_slot_idx: Optional[int], cmds: List[str]):
        return self.__executor.submit(self.__do_run, cmds, target_slot_idx).result(timeout=self.__cmd_timeout)

    def activate(self, slot: str) -> None:
        target_slot_idx = self.__as_idx(slot)
        self.__validate_slot_idx(target_slot_idx)
        self.__send_cmds(target_slot_idx, [])

    @staticmethod
    def __validate_slot_idx(target_slot_idx):
        if target_slot_idx < 0 or target_slot_idx > 3:
            raise InvalidRequestError(f"Slot must be in range 1-4")

    def load_filter(self, slot: str, entry: Catalogue) -> None:
        target_slot_idx = self.__as_idx(slot)
        self.__validate_slot_idx(target_slot_idx)
        cmds = MinidspBeqCommandGenerator.filt(entry)
        self.__send_cmds(target_slot_idx, cmds)

    def clear_filter(self, slot: str) -> None:
        target_slot_idx = self.__as_idx(slot)
        self.__validate_slot_idx(target_slot_idx)
        cmds = MinidspBeqCommandGenerator.filt(None)
        cmds.extend(MinidspBeqCommandGenerator.mute(False, target_slot_idx, None))
        cmds.extend(MinidspBeqCommandGenerator.gain(0.0, target_slot_idx, None))
        self.__send_cmds(target_slot_idx, cmds)

    def mute(self, slot: Optional[str], channel: Optional[int]) -> None:
        self.__do_mute_op(slot, channel, True)

    def __do_mute_op(self, slot: Optional[str], channel: Optional[int], state: bool):
        target_channel_idx, target_slot_idx = self.__as_idxes(channel, slot)
        if target_slot_idx:
            self.__validate_slot_idx(target_slot_idx)
        cmds = MinidspBeqCommandGenerator.mute(state, target_slot_idx, target_channel_idx)
        self.__send_cmds(target_slot_idx, cmds)

    def unmute(self, slot: Optional[str], channel: Optional[int]) -> None:
        self.__do_mute_op(slot, channel, False)

    def set_gain(self, slot: Optional[str], channel: Optional[int], gain: float) -> None:
        target_channel_idx, target_slot_idx = self.__as_idxes(channel, slot)
        cmds = MinidspBeqCommandGenerator.gain(gain, target_slot_idx, target_channel_idx)
        self.__send_cmds(target_slot_idx, cmds)

    def __as_idxes(self, channel, slot):
        target_slot_idx = self.__as_idx(slot) if slot else None
        target_channel_idx = self.__as_idx(channel) if channel else None
        return target_channel_idx, target_slot_idx

    def __do_run(self, config_cmds: List[str], slot: Optional[int]):
        if slot is not None:
            change_slot = True
            current_state = self.__get_state()
            if current_state and 'active_slot' in current_state and current_state['active_slot'] == slot:
                change_slot = False
            if change_slot is True:
                logger.info(f"Activating slot {slot}, current is {current_state.get('active_slot', 'UNKNOWN')}")
                config_cmds.insert(0, MinidspBeqCommandGenerator.activate(slot))
        formatted = '\n'.join(config_cmds)
        logger.info(f"\n{formatted}")
        with tmp_file(config_cmds) as file_name:
            kwargs = {'retcode': None} if self.__ignore_retcode else {}
            logger.info(f"Sending {len(config_cmds)} commands to slot {slot} via {file_name} {kwargs if kwargs else ''}")
            start = time.time()
            code, stdout, stderr = self.__runner['-f', file_name].run(timeout=self.__cmd_timeout, **kwargs)
            end = time.time()
            logger.info(f"Sent {len(config_cmds)} commands to slot {slot} in {to_millis(start, end)}ms - result is {code}")


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

    def __send(self, to_load: List[PEQ]):
        while len(to_load) < 16:
            peq = PEQ(len(to_load), fc=100, q=1, gain=0, filter_type_name='PeakingEQ')
            to_load.append(peq)
        ops = [peq.as_ops(c, use_shelf=self.__supports_shelf) for peq in to_load for c in self.__peq.keys()]
        ops = [op for slot_ops in ops for op in slot_ops if op]
        if ops:
            self.__client.send(f"changemso {json.dumps(ops)}")
        else:
            logger.warning(f"Nothing to send")

    def activate(self, slot: str) -> None:
        raise NotImplementedError()

    def load_filter(self, slot: str, entry: Catalogue) -> None:
        to_load = [PEQ(idx, fc=f['freq'], q=f['q'], gain=f['gain'], filter_type_name=f['type'])
                   for idx, f in enumerate(entry.filters)]
        self.__send(to_load)

    def clear_filter(self, slot: str) -> None:
        self.__send([])

    def mute(self, slot: Optional[str], channel: Optional[int]) -> None:
        raise NotImplementedError()

    def unmute(self, slot: Optional[str], channel: Optional[int]) -> None:
        raise NotImplementedError()

    def set_gain(self, slot: Optional[str], channel: Optional[int], gain: float) -> None:
        raise NotImplementedError()

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


class InvalidRequestError(Exception):
    pass