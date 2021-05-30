import logging
import os
from concurrent.futures.thread import ThreadPoolExecutor
from contextlib import contextmanager
from typing import List, Optional, Union

import time

from ezbeq.catalogue import Catalogue
from ezbeq.config import Config
from ezbeq.device import Bridge, InvalidRequestError, SlotState

logger = logging.getLogger('ezbeq.minidsp')


class Minidsp(Bridge):

    def __init__(self, cfg: Config):
        self.__executor = ThreadPoolExecutor(max_workers=1)
        self.__cmd_timeout = cfg.minidsp_cmd_timeout
        self.__ignore_retcode = cfg.ignore_retcode
        self.__runner = cfg.create_minidsp_runner()

    def device_type(self) -> str:
        return 'minidsp'

    def slot_state(self) -> List[SlotState]:
        return [MinidspSlotState(c_id) for c_id in [str(i + 1) for i in range(4)]]

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
                                values['active_slot'] = str(int(v[8:]) + 1)
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
            if current_state and 'active_slot' in current_state and int(current_state['active_slot']) == slot + 1:
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


def to_millis(start, end, precision=1):
    '''
    Calculates the differences in time in millis.
    :param start: start time in seconds.
    :param end: end time in seconds.
    :return: delta in millis.
    '''
    return round((end - start) * 1000, precision)
