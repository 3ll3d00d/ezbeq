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


class DeviceState:

    def __init__(self, cfg: Config):
        self.__can_activate = cfg.minidsp_exe is not None
        default_gain = {'gain1': '0.0', 'gain2': '0.0', 'mute1': False, 'mute2': False} if self.__can_activate else {}
        self.__state = [{**default_gain, 'id': id, 'last': 'Empty'} for id in get_channels(cfg)]
        self.__file_name = os.path.join(cfg.config_path, 'device.json')
        self.__active_slot = None
        self.__master_volume = None
        self.__mute = None
        if os.path.exists(self.__file_name):
            with open(self.__file_name, 'r') as f:
                j = json.load(f)
                saved = {v['id']: v for v in j}
                current = {v['id']: v for v in self.__state}
                if saved.keys() == current.keys():
                    self.__state = [{**current[k], **v} for k, v in saved.items()]
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
        self.__update(slot, f'gain1', '0.0')
        self.__update(slot, f'gain2', '0.0')
        self.__update(slot, f'mute1', False)
        self.__update(slot, f'mute2', False)

    def gain(self, slot: str, channel: Optional[str], value: str):
        if slot == '0' or channel is None:
            self.__master_volume = value
        else:
            self.__update(slot, f'gain{channel}', value)

    def mute(self, slot: Optional[str], channel: Optional[str]):
        self.__apply_mute(slot, channel, True)

    def __apply_mute(self, slot: Optional[str], channel: Optional[str], op: bool):
        if slot is None and channel is None:
            self.__mute = op
        else:
            if channel is not None:
                self.__update(slot, f'mute{channel}', op)
            else:
                self.__update(slot, f"mute1", op)
                self.__update(slot, f"mute2", op)

    def unmute(self, slot: Optional[str], channel: Optional[str]):
        self.__apply_mute(slot, channel, False)

    def get(self) -> dict:
        values = {'slots': [{
            **s,
            'canActivate': self.__can_activate,
            'active': True if self.__active_slot is not None and s['id'] == self.__active_slot else False
        } for s in self.__state]}
        if self.__mute is not None:
            values['mute'] = self.__mute
        elif self.__can_activate:
            values['mute'] = False
        if self.__master_volume is not None:
            values['masterVolume'] = self.__master_volume
        elif self.__can_activate:
            values['masterVolume'] = 0.0
        return values


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
    def mute(self, slot: Optional[str], channel: Optional[str]) -> None:
        pass

    @abstractmethod
    def unmute(self, slot: Optional[str], channel: Optional[str]) -> None:
        pass

    @abstractmethod
    def set_gain(self, slot: Optional[str], channel: Optional[str], gain: float) -> None:
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

    def mute(self, slot: Optional[str], channel: Optional[str]) -> None:
        return self.__bridge.mute(slot, channel)

    def unmute(self, slot: Optional[str], channel: Optional[str]) -> None:
        return self.__bridge.unmute(slot, channel)

    def set_gain(self, slot: Optional[str], channel: Optional[str], gain: float) -> None:
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
    def activate(slot: int):
        return [f"config {slot}"]

    @staticmethod
    def filt(entry: Optional[Catalogue], slot: int, active_slot: Optional[int] = None):
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
    def mute(state: bool, slot: Optional[int], channel: Optional[int], active_slot: Optional[int] = None):
        '''
        Generates commands to mute the configuration.
        :param state: mute if true otherwise unmute.
        :param slot: the target slot, if not set apply to the master control.
        :param channel: the channel, applicable only if slot is set, if not set apply to both input channels.
        :param active_slot: if not set or if it does not match the requested slot, activate the slot first.
        :return: the commands.
        '''
        state_cmd = 'on' if state else 'off'
        if slot is not None:
            if active_slot is None or active_slot != slot:
                cmds = MinidspBeqCommandGenerator.activate(slot)
            else:
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
    def gain(gain: float, slot: Optional[int], channel: Optional[int], active_slot: Optional[int] = None):
        '''
        Generates commands to set gain.
        :param gain: the gain to set.
        :param slot: the target slot, if not set apply to the master control.
        :param channel: the channel, applicable only if slot is set, if not set apply to both input channels.
        :param active_slot: if not set or if it does not match the requested slot, activate the slot first.
        :return: the commands.
        '''
        if slot is not None:
            if not -72.0 <= gain <= 12.0:
                raise ValueError(f"Input gain {gain:.2f} out of range (>= -72.0 and <= 12.0)")
            if active_slot is None or active_slot != slot:
                cmds = MinidspBeqCommandGenerator.activate(slot)
            else:
                cmds = []
            if channel is None:
                cmds.append(f"input 0 gain -- {gain:.2f}")
                cmds.append(f"input 1 gain -- {gain:.2f}")
            else:
                cmds.append(f"input {channel} gain -- {gain:.2f}")
            return cmds
        else:
            if not -127.0 <= gain <= 0.0:
                raise ValueError(f"Master gain {gain:.2f} out of range (>= -127.0 and <= 0.0)")
            return [f"gain -- {gain:.2f}"]


class Minidsp(Bridge):

    def __init__(self, cfg: Config):
        self.__executor = ThreadPoolExecutor(max_workers=1)
        self.__ignore_retcode = cfg.ignore_retcode
        self.__runner = cfg.create_minidsp_runner()

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

    @staticmethod
    def __as_idx(idx: str):
        return int(idx) - 1

    def __send_cmds(self, target_slot_idx: int, cmds: List[str]):
        with tmp_file(cmds) as file_name:
            return self.__executor.submit(self.__do_run, self.__runner['-f', file_name], cmds,
                                          target_slot_idx).result(timeout=60)

    def activate(self, slot: str) -> None:
        target_slot_idx = self.__as_idx(slot)
        self.__send_cmds(target_slot_idx, MinidspBeqCommandGenerator.activate(target_slot_idx))

    def load_filter(self, slot: str, entry: Catalogue) -> None:
        target_slot_idx = self.__as_idx(slot)
        cmds = MinidspBeqCommandGenerator.filt(entry, target_slot_idx)
        self.__send_cmds(target_slot_idx, cmds)

    def clear_filter(self, slot: str) -> None:
        target_slot_idx = self.__as_idx(slot)
        cmds = MinidspBeqCommandGenerator.filt(None, target_slot_idx)
        cmds.extend(MinidspBeqCommandGenerator.mute(True, target_slot_idx, None, target_slot_idx))
        cmds.extend(MinidspBeqCommandGenerator.gain(0.0, target_slot_idx, None, target_slot_idx))
        self.__send_cmds(target_slot_idx, cmds)

    def mute(self, slot: Optional[str], channel: Optional[str]) -> None:
        self.__do_mute_op(slot, channel, True)

    def __do_mute_op(self, slot: Optional[str], channel: Optional[str], state: bool):
        target_channel_idx, target_slot_idx = self.__as_idxes(channel, slot)
        cmds = MinidspBeqCommandGenerator.mute(state, target_slot_idx, target_channel_idx)
        self.__send_cmds(target_slot_idx, cmds)

    def unmute(self, slot: Optional[str], channel: Optional[str]) -> None:
        self.__do_mute_op(slot, channel, False)

    def set_gain(self, slot: Optional[str], channel: Optional[str], gain: float) -> None:
        target_channel_idx, target_slot_idx = self.__as_idxes(channel, slot)
        cmds = MinidspBeqCommandGenerator.gain(gain, target_slot_idx, target_channel_idx)
        self.__send_cmds(target_slot_idx, cmds)

    def __as_idxes(self, channel, slot):
        target_slot_idx = self.__as_idx(slot) if slot else None
        target_channel_idx = self.__as_idx(channel) if channel else None
        return target_channel_idx, target_slot_idx

    def __do_run(self, cmd, config_cmds: List[str], slot: int):
        kwargs = {'retcode': None} if self.__ignore_retcode else {}
        logger.info(f"Sending {len(config_cmds)} commands to slot {slot} via {cmd} {kwargs if kwargs else ''}")
        formatted = '\n'.join(config_cmds)
        logger.info(f"\n{formatted}")
        start = time.time()
        code, stdout, stderr = cmd.run(timeout=5, **kwargs)
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

    def mute(self, slot: Optional[str], channel: Optional[str]) -> None:
        raise NotImplementedError()

    def unmute(self, slot: Optional[str], channel: Optional[str]) -> None:
        raise NotImplementedError()

    def set_gain(self, slot: Optional[str], channel: Optional[str], gain: float) -> None:
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
