import json
import logging
import math
import os
import time
from concurrent.futures.thread import ThreadPoolExecutor
from contextlib import contextmanager
from typing import List, Optional, Union

import yaml
from autobahn.exception import Disconnected
from autobahn.twisted import WebSocketClientFactory, WebSocketClientProtocol
from twisted.internet.protocol import ReconnectingClientFactory

from ezbeq.apis.ws import WsServer
from ezbeq.catalogue import CatalogueEntry, CatalogueProvider
from ezbeq.device import InvalidRequestError, SlotState, PersistentDevice, DeviceState

INPUT_NAME = 'input'
OUTPUT_NAME = 'output'
CROSSOVER_NAME = 'crossover'

logger = logging.getLogger('ezbeq.minidsp')


class MinidspState(DeviceState):

    def __init__(self, name: str, descriptor: 'MinidspDescriptor', **kwargs):
        self.__name = name
        self.master_volume: float = kwargs['mv'] if 'mv' in kwargs else 0.0
        self.__mute: bool = kwargs['mute'] if 'mute' in kwargs else False
        self.__active_slot: str = kwargs['active_slot'] if 'active_slot' in kwargs else ''
        self.__descriptr = descriptor
        slot_ids = [str(i + 1) for i in range(4)]
        self.__slots: List[MinidspSlotState] = [
            MinidspSlotState(c_id,
                             c_id == self.active_slot,
                             0 if not descriptor.input else len(descriptor.input.channels),
                             0 if not descriptor.output else len(descriptor.output.channels)) for c_id in slot_ids
        ]

    def update_master_state(self, mute: bool, gain: float):
        self.__mute = mute
        self.master_volume = gain

    def activate(self, slot_id: str):
        self.__active_slot = slot_id
        for s in self.__slots:
            s.active = s.slot_id == slot_id

    @property
    def active_slot(self) -> str:
        return self.__active_slot

    @property
    def mute(self) -> bool:
        return self.__mute

    def load(self, slot_id: str, title: str):
        self.get_slot(slot_id).last = title
        self.activate(slot_id)

    def get_slot(self, slot_id) -> 'MinidspSlotState':
        return next(s for s in self.__slots if s.slot_id == slot_id)

    def clear(self, slot_id):
        slot = self.get_slot(slot_id)
        slot.unmute(None)
        slot.set_gain(None, 0.0)
        slot.last = 'Empty'
        self.activate(slot_id)

    def error(self, slot_id):
        self.get_slot(slot_id).last = 'ERROR'
        self.activate(slot_id)

    def gain(self, slot_id: Optional[str], channel: Optional[int], gain: float):
        if slot_id is None:
            self.master_volume = gain
        else:
            self.get_slot(slot_id).set_gain(channel, gain)
            self.activate(slot_id)

    def toggle_mute(self, slot_id: Optional[str], channel: Optional[int], mute: bool):
        if slot_id is None:
            self.__mute = mute
        else:
            slot = self.get_slot(slot_id)
            if mute:
                slot.mute(channel)
            else:
                slot.unmute(channel)
            self.activate(slot_id)

    def serialise(self) -> dict:
        return {
            'name': self.__name,
            'masterVolume': self.master_volume,
            'mute': self.__mute,
            'slots': [s.as_dict() for s in self.__slots]
        }

    def merge_with(self, cached: dict) -> None:
        saved_slots_by_id = {v['id']: v for v in cached.get('slots', [])}
        current_slots_by_id = {s.slot_id: s for s in self.__slots}
        if saved_slots_by_id.keys() == current_slots_by_id.keys():
            for slot_id, state in saved_slots_by_id.items():
                current_slots_by_id[slot_id].merge_with(state)


class MinidspSlotState(SlotState['MinidspSlotState']):

    def __init__(self, slot_id: str, active: bool, input_channels: int, output_channels: int):
        super().__init__(slot_id)
        self.__input_channels = input_channels
        self.__output_channels = output_channels
        self.gains = self.__make_vals(0.0)
        self.mutes = self.__make_vals(False)
        self.active = active

    def clear(self):
        super().clear()
        self.gains = self.__make_vals(0.0)
        self.mutes = self.__make_vals(False)

    def __make_vals(self, val):
        return [val] * self.__input_channels

    def set_gain(self, channel: Optional[int], value: float):
        if channel is None:
            self.gains = self.__make_vals(value)
        else:
            if channel <= self.__input_channels:
                self.gains[channel-1] = value
            else:
                raise ValueError(f'Unknown channel {channel} for slot {self.slot_id}')

    def mute(self, channel: Optional[int]):
        self.__do_mute(channel, True)

    def __do_mute(self, channel: Optional[int], value: bool):
        if channel is None:
            self.mutes = self.__make_vals(value)
        else:
            if channel <= self.__input_channels:
                self.mutes[channel-1] = value
            else:
                raise ValueError(f'Unknown channel {channel} for slot {self.slot_id}')

    def unmute(self, channel: Optional[int]):
        self.__do_mute(channel, False)

    def merge_with(self, state: dict) -> None:
        super().merge_with(state)
        # legacy (v1 api)
        if 'gain1' in state and self.__input_channels > 0:
            self.gains[0] = float(state['gain1'])
        if 'gain2' in state and self.__input_channels > 1:
            self.gains[1] = float(state['gain2'])
        if 'mute1' in state and self.__input_channels > 0:
            self.mutes[0] = bool(state['mute1'])
        if 'mute2' in state and self.__input_channels > 1:
            self.mutes[1] = bool(state['mute2'])
        # current (v2 api)
        if 'gains' in state and len(state['gains']) == self.__input_channels:
            self.gains = [float(v) for v in state['gains']]
        if 'mutes' in state and len(state['mutes']) == self.__input_channels:
            self.mutes = [bool(v) for v in state['mutes']]

    def as_dict(self) -> dict:
        sup = super().as_dict()
        vals = {}
        if self.__input_channels == 2:
            # backwards compatibility
            vals = {
                'gain1': self.gains[0],
                'gain2': self.gains[1],
                'mute1': self.mutes[0],
                'mute2': self.mutes[1],
            }
        return {
            **sup,
            **vals,
            'gains': [g for g in self.gains],
            'mutes': [m for m in self.mutes],
            'canActivate': True,
            'inputs': self.__input_channels,
            'outputs': self.__output_channels
        }

    def __repr__(self):
        vals = ' '.join([f"{i+1}: {g:.2f}/{self.mutes[i]}" for i, g in enumerate(self.gains)])
        return f"{super().__repr__()} - {vals}"


class PeqRoutes:
    def __init__(self, name: str, biquads: int, channels: List[int], beq_slots: List[int], groups: List[int] = None):
        self.name = name
        self.biquads = biquads
        self.channels = channels
        self.beq_slots = beq_slots
        self.groups = groups

    @property
    def takes_beq(self) -> bool:
        return len(self.channels) > 0 and len(self.beq_slots) > 0

    def __repr__(self):
        return f"{self.name}"


class BeqFilterSlot:

    def __init__(self, name: str, idx: int, channels: List[int], group: Optional[int] = None):
        self.name = name
        self.idx = idx
        self.channels = channels
        self.group = group

    def __repr__(self):
        return f"{self.name}{self.group if self.group is not None else ''}/{self.idx}/{self.channels}"


class BeqFilterAllocator:

    def __init__(self, routes: List[PeqRoutes]):
        self.slots = []
        for r in routes:
            if r:
                for s in r.beq_slots:
                    if r.groups:
                        for g in r.groups:
                            self.slots.append(BeqFilterSlot(r.name, s, r.channels, g))
                    else:
                        self.slots.append(BeqFilterSlot(r.name, s, r.channels))

    def pop(self) -> Optional[BeqFilterSlot]:
        if self.slots:
            return self.slots.pop(0)
        return None

    def __len__(self):
        return len(self.slots)

    def __repr__(self):
        return f"{self.slots}"


class MinidspDescriptor:

    def __init__(self, name: str, fs: str, i: PeqRoutes = None, xo: PeqRoutes = None, o: PeqRoutes = None,
                 extra: List[PeqRoutes] = None):
        self.name = name
        self.fs = str(int(fs))
        self.input = i
        self.crossover = xo
        self.output = o
        self.extra = extra

    @property
    def peq_routes(self) -> List[PeqRoutes]:
        return [x for x in [self.input, self.crossover, self.output, self.extra] if x]

    def to_allocator(self) -> BeqFilterAllocator:
        return BeqFilterAllocator(self.peq_routes)

    def __repr__(self):
        s = f"{self.name}, fs:{self.fs}"
        if self.input:
            s = f"{s}, inputs: {self.input}"
        if self.crossover:
            s = f"{s}, crossovers: {self.crossover}"
        if self.output:
            s = f"{s}, outputs: {self.output}"
        return s


def zero_til(count: int) -> List[int]:
    return list(range(0, count))


class Minidsp24HD(MinidspDescriptor):

    def __init__(self):
        super().__init__('2x4HD',
                         '96000',
                         i=PeqRoutes(INPUT_NAME, 10, zero_til(2), zero_til(10)),
                         xo=PeqRoutes(CROSSOVER_NAME, 4, zero_til(4), [], groups=zero_til(2)),
                         o=PeqRoutes(OUTPUT_NAME, 10, zero_til(4), []))


class MinidspDDRC24(MinidspDescriptor):

    def __init__(self):
        super().__init__('DDRC24',
                         '48000',
                         xo=PeqRoutes(CROSSOVER_NAME, 4, zero_til(4), [], zero_til(2)),
                         o=PeqRoutes(OUTPUT_NAME, 10, zero_til(4), zero_til(10)))


class MinidspDDRC88(MinidspDescriptor):

    def __init__(self, sw_channels: List[int] = None):
        c = sw_channels if sw_channels is not None else [3]
        if any(ch for ch in c if ch < 0 or ch > 7):
            raise ValueError(f"Invalid channels {c}")
        non_sw = [c1 for c1 in zero_til(8) if c1 not in c]
        super().__init__('DDRC88',
                         '48000',
                         xo=PeqRoutes(CROSSOVER_NAME, 8, zero_til(8), [], zero_til(2)),
                         o=PeqRoutes(OUTPUT_NAME, 10, c, zero_til(10)),
                         extra=PeqRoutes(OUTPUT_NAME, 10, non_sw, []) if non_sw else None)


class Minidsp410(MinidspDescriptor):

    def __init__(self):
        super().__init__('4x10',
                         '96000',
                         i=PeqRoutes(INPUT_NAME, 5, zero_til(2), zero_til(5)),
                         o=PeqRoutes(OUTPUT_NAME, 5, zero_til(8), zero_til(5)))


class Minidsp1010(MinidspDescriptor):

    def __init__(self, use_xo: Union[bool, int, str]):
        if use_xo is True:
            secondary = {'xo': PeqRoutes(CROSSOVER_NAME, 4, zero_til(8), zero_til(4), groups=[0])}
        elif use_xo is False:
            secondary = {'o': PeqRoutes(OUTPUT_NAME, 6, zero_til(8), zero_til(4))}
        elif use_xo == '0' or use_xo == '1':
            secondary = {'xo': PeqRoutes(CROSSOVER_NAME, 4, zero_til(8), zero_til(4), groups=[int(use_xo)])}
        elif use_xo == 0 or use_xo == 1:
            secondary = {'xo': PeqRoutes(CROSSOVER_NAME, 4, zero_til(8), zero_til(4), groups=[use_xo])}
        elif use_xo == 'all':
            secondary = {'xo': PeqRoutes(CROSSOVER_NAME, 4, zero_til(8), zero_til(4), groups=zero_til(2))}
        else:
            secondary = {'o': PeqRoutes(OUTPUT_NAME, 6, zero_til(8), zero_til(4))}
        super().__init__('10x10',
                         '48000',
                         i=PeqRoutes(INPUT_NAME, 6, zero_til(8), zero_til(6)),
                         **secondary)


def make_peq_layout(cfg: dict) -> MinidspDescriptor:
    if 'device_type' in cfg:
        device_type = cfg['device_type']
        if device_type == '24HD':
            return Minidsp24HD()
        elif device_type == 'DDRC24':
            return MinidspDDRC24()
        elif device_type == 'DDRC88':
            return MinidspDDRC88(sw_channels=cfg.get('sw_channels', None))
        elif device_type == '4x10':
            return Minidsp410()
        elif device_type == '10x10':
            return Minidsp1010(cfg.get('use_xo', False))
        elif device_type == 'SHD':
            return MinidspDDRC24()
    elif 'descriptor' in cfg:
        desc: dict = cfg['descriptor']
        named_args = ['name', 'fs', 'routes']
        missing_keys = [x for x in named_args if x not in desc.keys()]
        if missing_keys:
            raise ValueError(f"Custom descriptor is missing keys - {missing_keys} - from {desc}")
        routes: List[dict] = desc['routes']

        def make_route(r: dict) -> PeqRoutes:
            r_named_args = ['name', 'biquads', 'channels', 'slots']
            missing_route_keys = [x for x in r_named_args if x not in r.keys()]
            if missing_route_keys:
                raise ValueError(f"Custom PeqRoutes is missing keys - {missing_keys} - from {r}")

            def to_ints(v):
                return [int(i) for i in v] if v else None

            return PeqRoutes(r['name'], int(r['biquads']), to_ints(r['channels']), to_ints(r['slots']),
                             to_ints(r.get('groups', None)))
        args = [make_route(r) for r in routes]
        return MinidspDescriptor(desc['name'], str(desc['fs']),
                                 **{'xo' if r.name == CROSSOVER_NAME else r.name[0]: r for r in args})
    else:
        return Minidsp24HD()


class Minidsp(PersistentDevice[MinidspState]):

    def __init__(self, name: str, config_path: str, cfg: dict, ws_server: WsServer, catalogue: CatalogueProvider):
        super().__init__(config_path, name, ws_server)
        self.__catalogue = catalogue
        self.__executor = ThreadPoolExecutor(max_workers=1)
        self.__cmd_timeout = cfg.get('cmdTimeout', 10)
        self.__ignore_retcode = cfg.get('ignoreRetcode', False)
        self.__slot_change_delay: Union[bool, int] = cfg.get('slotChangeDelay', False)
        self.__levels_interval = 1.0 / float(cfg.get('levelsFps', 10))
        self.__runner = cfg['make_runner'](cfg['exe'], cfg.get('options', ''))
        ws_device_id = cfg.get('wsDeviceId', None)
        ws_ip = cfg.get('wsIp', '127.0.0.1:5380')
        if ws_device_id is not None and ws_ip:
            self.__ws_client = MinidspRsClient(self, ws_ip, ws_device_id)
        else:
            self.__ws_client = None
        self.__descriptor: MinidspDescriptor = make_peq_layout(cfg)
        logger.info(f"[{name}] Minidsp descriptor is loaded.... exe is {self.__runner}")
        logger.info(yaml.dump(self.__descriptor, indent=2, default_flow_style=False, sort_keys=False))
        ws_server.factory.set_levels_provider(name, self.start_broadcast_levels)

    @property
    def device_type(self) -> str:
        return self.__class__.__name__.lower()

    @property
    def supports_gain(self) -> bool:
        return True

    def __load_state(self) -> MinidspState:
        result = self.__executor.submit(self.__read_state_from_device).result(timeout=self.__cmd_timeout)
        return result if result else MinidspState(self.name, self.__descriptor)

    def __read_state_from_device(self) -> Optional[MinidspState]:
        output = None
        try:
            kwargs = {'retcode': None} if self.__ignore_retcode else {}
            output = self.__runner['-o', 'jsonline'](timeout=self.__cmd_timeout, **kwargs)
            lines = output.splitlines()
            if lines:
                status = json.loads(lines[0])
                values = {
                    'active_slot': str(status['master']['preset'] + 1),
                    'mute': status['master']['mute'],
                    'mv': status['master']['volume']
                }
                return MinidspState(self.name, self.__descriptor, **values)
            else:
                logger.error(f"[{self.name}] No output returned from device")
        except:
            logger.exception(f"[{self.name}] Unable to parse device state {output}")
        return None

    @staticmethod
    def __as_idx(idx: Union[int, str]):
        return int(idx) - 1

    def __send_cmds(self, target_slot_idx: Optional[int], cmds: List[str]):
        return self.__executor.submit(self.__do_run, cmds, target_slot_idx, self.__slot_change_delay).result(timeout=self.__cmd_timeout)

    def activate(self, slot: str):
        def __do_it():
            target_slot_idx = self.__as_idx(slot)
            self.__validate_slot_idx(target_slot_idx)
            self.__send_cmds(target_slot_idx, [])
            self._current_state.activate(slot)

        self._hydrate_cache_broadcast(__do_it)

    @staticmethod
    def __validate_slot_idx(target_slot_idx):
        if target_slot_idx < 0 or target_slot_idx > 3:
            raise InvalidRequestError(f"Slot must be in range 1-4")

    def load_biquads(self, slot: str, overwrite: bool, inputs: List[int], outputs: List[int],
                     biquads: List[dict]) -> None:
        def __do_it():
            target_slot_idx = self.__as_idx(slot)
            self.__validate_slot_idx(target_slot_idx)
            cmds = MinidspBeqCommandGenerator.biquads(overwrite, inputs, outputs, biquads)
            try:
                self.__send_cmds(target_slot_idx, cmds)
                if inputs:
                    self._current_state.load(slot, 'CUSTOM')
                else:
                    self._current_state.activate(slot)
            except Exception as e:
                self._current_state.error(slot)
                raise e

        self._hydrate_cache_broadcast(__do_it)

    def send_commands(self, slot: str, inputs: List[int], outputs: List[int], commands: List[str]) -> None:
        def __do_it():
            target_slot_idx = self.__as_idx(slot)
            self.__validate_slot_idx(target_slot_idx)
            cmds = MinidspBeqCommandGenerator.commands(inputs, outputs, commands)
            try:
                self.__send_cmds(target_slot_idx, cmds)
                if inputs:
                    self._current_state.load(slot, 'CUSTOM')
                else:
                    self._current_state.activate(slot)
            except Exception as e:
                self._current_state.error(slot)
                raise e

        self._hydrate_cache_broadcast(__do_it)

    def load_filter(self, slot: str, entry: CatalogueEntry) -> None:
        def __do_it():
            target_slot_idx = self.__as_idx(slot)
            self.__validate_slot_idx(target_slot_idx)
            cmds = MinidspBeqCommandGenerator.filt(entry, self.__descriptor)
            try:
                self.__send_cmds(target_slot_idx, cmds)
                self._current_state.load(slot, entry.formatted_title)
            except Exception as e:
                self._current_state.error(slot)
                raise e

        self._hydrate_cache_broadcast(__do_it)

    def clear_filter(self, slot: str) -> None:
        def __do_it():
            target_slot_idx = self.__as_idx(slot)
            self.__validate_slot_idx(target_slot_idx)
            cmds = MinidspBeqCommandGenerator.filt(None, self.__descriptor)
            beq_slots = self.__descriptor.to_allocator()
            levels = []
            handled = []
            s = beq_slots.pop()
            while s is not None:
                for c in s.channels:
                    if s.name == INPUT_NAME and c not in handled:
                        levels.extend(MinidspBeqCommandGenerator.mute(False, target_slot_idx, c, side=s.name))
                        levels.extend(MinidspBeqCommandGenerator.gain(0.0, target_slot_idx, c, side=s.name))
                        handled.append(c)
                s = beq_slots.pop()
            if levels:
                cmds.extend(levels)
            try:
                self.__send_cmds(target_slot_idx, cmds)
                self._current_state.clear(slot)
            except Exception as e:
                self._current_state.error(slot)
                raise e

        self._hydrate_cache_broadcast(__do_it)

    def mute(self, slot: Optional[str], channel: Optional[int]) -> None:
        self.__do_mute_op(slot, channel, True)

    def __do_mute_op(self, slot: Optional[str], channel: Optional[int], state: bool):
        def __do_it():
            target_channel_idx, target_slot_idx = self.__as_idxes(channel, slot)
            if target_slot_idx:
                self.__validate_slot_idx(target_slot_idx)
            cmds = MinidspBeqCommandGenerator.mute(state, target_slot_idx, target_channel_idx)
            self.__send_cmds(target_slot_idx, cmds)
            self._current_state.toggle_mute(slot, channel, state)

        self._hydrate_cache_broadcast(__do_it)

    def unmute(self, slot: Optional[str], channel: Optional[int]) -> None:
        self.__do_mute_op(slot, channel, False)

    def set_gain(self, slot: Optional[str], channel: Optional[int], gain: float) -> None:
        def __do_it():
            target_channel_idx, target_slot_idx = self.__as_idxes(channel, slot)
            cmds = MinidspBeqCommandGenerator.gain(gain, target_slot_idx, target_channel_idx)
            self.__send_cmds(target_slot_idx, cmds)
            self._current_state.gain(slot, channel, gain)

        self._hydrate_cache_broadcast(__do_it)

    def __as_idxes(self, channel, slot):
        target_slot_idx = self.__as_idx(slot) if slot else None
        target_channel_idx = self.__as_idx(channel) if channel else None
        return target_channel_idx, target_slot_idx

    def __do_run(self, config_cmds: List[str], slot: Optional[int], slot_change_delay: Union[bool, int]):
        if slot is not None:
            change_slot = True
            current_state = self.__read_state_from_device()
            if current_state and current_state.active_slot == str(slot + 1):
                change_slot = False
            if change_slot is True:
                if slot_change_delay:
                    self.__do_run([], slot, False)
                    if slot_change_delay is not True and slot_change_delay > 0:
                        from time import sleep
                        logger.info(f"[{self.name}] Sleeping for {slot_change_delay} seconds after config slot change")
                        sleep(slot_change_delay)
                else:
                    logger.info(
                        f"[{self.name}] Activating slot {slot}, current is {current_state.active_slot if current_state else 'UNKNOWN'}")
                    config_cmds.insert(0, MinidspBeqCommandGenerator.activate(slot))
        formatted = '\n'.join(config_cmds)
        logger.info(f"\n{formatted}")
        with tmp_file(config_cmds) as file_name:
            kwargs = {'retcode': None} if self.__ignore_retcode else {}
            exe = self.__runner['-f', file_name]
            logger.info(
                f"[{self.name}] Sending {len(config_cmds)} commands to slot {slot} using {exe} {kwargs if kwargs else ''}")
            start = time.time()
            code, stdout, stderr = exe.run(timeout=self.__cmd_timeout, **kwargs)
            end = time.time()
            logger.info(
                f"[{self.name}] Sent {len(config_cmds)} commands to slot {slot} in {to_millis(start, end)}ms - result is {code}")

    def _load_initial_state(self) -> MinidspState:
        return self.__load_state()

    def state(self, refresh: bool = False) -> MinidspState:
        if not self._hydrate() or refresh is True:
            new_state = self.__load_state()
            self._current_state.update_master_state(new_state.mute, new_state.master_volume)
        return self._current_state

    def _merge_state(self, loaded: MinidspState, cached: dict) -> MinidspState:
        loaded.merge_with(cached)
        return loaded

    def update(self, params: dict) -> bool:
        def __do_it() -> bool:
            any_update = False
            if 'slots' in params:
                for slot in params['slots']:
                    any_update |= self.__update_slot(slot)
            if 'mute' in params and params['mute'] != self._current_state.mute:
                if self._current_state.mute:
                    self.unmute(None, None)
                else:
                    self.mute(None, None)
                any_update = True
            if 'masterVolume' in params and not math.isclose(params['masterVolume'], self._current_state.master_volume):
                self.set_gain(None, None, params['masterVolume'])
                any_update = True
            return any_update

        return self._hydrate_cache_broadcast(__do_it)

    def __update_slot(self, slot: dict) -> bool:
        any_update = False
        current_slot = self._current_state.get_slot(slot['id'])
        # legacy
        if 'gain1' in slot:
            self.set_gain(current_slot.slot_id, 1, slot['gain1'])
            any_update = True
        if 'gain2' in slot:
            self.set_gain(current_slot.slot_id, 2, slot['gain2'])
            any_update = True
        if 'mute1' in slot:
            if slot['mute1'] is True:
                self.mute(current_slot.slot_id, 1)
            else:
                self.unmute(current_slot.slot_id, 1)
            any_update = True
        if 'mute2' in slot:
            if slot['mute1'] is True:
                self.mute(current_slot.slot_id, 2)
            else:
                self.unmute(current_slot.slot_id, 2)
            any_update = True
        # current
        if 'gains' in slot:
            for idx, gain in enumerate(slot['gains']):
                self.set_gain(current_slot.slot_id, idx+1, gain)
                any_update = True
        if 'mutes' in slot:
            for idx, mute in enumerate(slot['mutes']):
                if mute is True:
                    self.mute(current_slot.slot_id, idx+1)
                else:
                    self.unmute(current_slot.slot_id, idx+1)
                any_update = True
        if 'entry' in slot:
            if slot['entry']:
                match = self.__catalogue.find(slot['entry'])
                if match:
                    self.load_filter(current_slot.slot_id, match)
                    any_update = True
            else:
                self.clear_filter(current_slot.slot_id)
        if 'active' in slot:
            self.activate(current_slot.slot_id)
            any_update = True
        return any_update

    def levels(self) -> dict:
        return self.__executor.submit(self.__read_levels_from_device).result(timeout=self.__cmd_timeout)

    def __read_levels_from_device(self) -> dict:
        lines = None
        try:
            kwargs = {'retcode': None} if self.__ignore_retcode else {}
            start = time.time()
            lines = self.__runner['-o', 'jsonline'](timeout=self.__cmd_timeout, **kwargs)
            end = time.time()
            levels = json.loads(lines)
            ts = time.time()
            logger.info(f"{self.name},readlevels,{ts},{to_millis(start, end)}")
            return {
                'ts': ts,
                INPUT_NAME: levels['input_levels'],
                OUTPUT_NAME: levels['output_levels']
            }
        except:
            logger.exception(f"[{self.name}] Unable to load levels {lines}")
            return {}

    def start_broadcast_levels(self) -> None:
        if self.__ws_client is None:
            from twisted.internet import reactor
            sched = lambda: reactor.callLater(self.__levels_interval, __send)

            def __send():
                msg = json.dumps(self.levels())
                if self.ws_server.levels(self.name, msg):
                    sched()

            sched()

    def on_ws_message(self, msg: dict):
        logger.info(f"[{self.name}] Received {msg}")
        if 'master' in msg:
            master = msg['master']
            if master:
                def do_it():
                    preset = str(master['preset'] + 1)
                    mv = master['volume']
                    mute = master['mute']
                    if self._current_state.master_volume != mv:
                        self._current_state.master_volume = mv
                    if self._current_state.mute != mute:
                        self._current_state.mute = mute
                    if self._current_state.active_slot != preset:
                        self._current_state.activate(preset)

                self._hydrate_cache_broadcast(do_it)
        if 'input_levels' in msg and 'output_levels' in msg:
            self.ws_server.levels(self.name, json.dumps({
                'ts': time.time(),
                INPUT_NAME: msg['input_levels'],
                OUTPUT_NAME: msg['output_levels']
            }))


class MinidspBeqCommandGenerator:

    @staticmethod
    def activate(slot: int) -> str:
        return f"config {slot}"

    @staticmethod
    def biquads(overwrite: bool, inputs: List[int], outputs: List[int], biquads: List[dict]):
        # [in|out]put <channel> peq <index> set -- <b0> <b1> <b2> <a1> <a2>
        # [in|out]put <channel> peq <index> bypass [on|off]
        cmds = []
        for side, channels in {INPUT_NAME: inputs, OUTPUT_NAME: outputs}.items():
            for channel in channels:
                for idx, bq in enumerate(biquads):
                    if bq:
                        coeffs = [bq['b0'], bq['b1'], bq['b2'], bq['a1'], bq['a2']]
                        cmds.append(MinidspBeqCommandGenerator.bq(channel - 1, idx, coeffs, side=side))
                        bypass = 'BYPASS' in bq and bq['BYPASS'] is True
                        cmds.append(MinidspBeqCommandGenerator.bypass(channel - 1, idx, bypass, side=side))
                    elif overwrite:
                        cmds.append(MinidspBeqCommandGenerator.bypass(channel - 1, idx, True, side=side))
                if overwrite:
                    for idx in range(len(biquads), 10):
                        cmds.append(MinidspBeqCommandGenerator.bypass(channel - 1, idx, True, side=side))
        return cmds

    @staticmethod
    def commands(inputs: List[int], outputs: List[int], commands: List[str]):
        cmds = []
        for side, channels in {INPUT_NAME: inputs, OUTPUT_NAME: outputs}.items():
            for channel in channels:
                for command in commands:
                    cmds.append(MinidspBeqCommandGenerator.cmd(channel - 1, command, side=side))
        return cmds

    @staticmethod
    def as_bq(f: dict, fs: str):
        if fs in f['biquads']:
            bq = f['biquads'][fs]['b'] + f['biquads'][fs]['a']
        else:
            t = f['type']
            freq = f['freq']
            gain = f['gain']
            q = f['q']
            from ezbeq.iir import PeakingEQ, LowShelf, HighShelf
            if t == 'PeakingEQ':
                f = PeakingEQ(int(fs), freq, q, gain)
            elif t == 'LowShelf':
                f = LowShelf(int(fs), freq, q, gain)
            elif t == 'HighShelf':
                f = HighShelf(int(fs), freq, q, gain)
            else:
                raise InvalidRequestError(f"Unknown filt_type {t}")
            bq = list(f.format_biquads().values())
        if len(bq) != 5:
            raise ValueError(f"Invalid coeff count {len(bq)}")
        return bq

    @staticmethod
    def filt(entry: Optional[CatalogueEntry], descriptor: MinidspDescriptor):
        # [in|out]put <channel> peq <index> set -- <b0> <b1> <b2> <a1> <a2>
        # [in|out]put <channel> peq <index> bypass [on|off]
        cmds = []
        # write filts to the inputs first then the output if it's a split device
        filters = [MinidspBeqCommandGenerator.as_bq(f, descriptor.fs) for f in entry.filters] if entry else []
        beq_slots = descriptor.to_allocator()

        def push(chs: List[int], i: int, s: str, group: Optional[int]):
            for ch in chs:
                cmds.append(MinidspBeqCommandGenerator.bq(ch, i, coeffs, s, group=group))
                cmds.append(MinidspBeqCommandGenerator.bypass(ch, i, False, s, group=group))

        idx = 0
        while idx < len(filters):
            coeffs: List[str] = filters[idx]
            slot = beq_slots.pop()
            if slot is not None:
                push(slot.channels, slot.idx, slot.name, slot.group)
            else:
                raise ValueError(f"Loaded {idx} filters but no slots remaining")
            idx += 1
        s = beq_slots.pop()
        while s is not None:
            for c in s.channels:
                cmds.append(MinidspBeqCommandGenerator.bypass(c, s.idx, True, s.name, s.group))
            s = beq_slots.pop()
        return cmds

    @staticmethod
    def bq(channel: int, idx: int, coeffs, side: str = INPUT_NAME, group: Optional[int] = None):
        is_xo = side == CROSSOVER_NAME
        addr = f"crossover {group}" if is_xo and group is not None else 'peq'
        return f"{OUTPUT_NAME if is_xo else side} {channel} {addr} {idx} set -- {' '.join(coeffs)}"

    @staticmethod
    def cmd(channel: int, cmd: str, side: str = INPUT_NAME):
        return f"{side} {channel} {cmd}"

    @staticmethod
    def bypass(channel: int, idx: int, bypass: bool, side: str = INPUT_NAME, group: Optional[int] = 0):
        is_xo = side == CROSSOVER_NAME
        addr = f"crossover {group}" if is_xo and group is not None else 'peq'
        return f"{OUTPUT_NAME if is_xo else side} {channel} {addr} {idx} bypass {'on' if bypass else 'off'}"

    @staticmethod
    def mute(state: bool, slot: Optional[int], channel: Optional[int], side: Optional[str] = INPUT_NAME):
        '''
        Generates commands to mute the configuration.
        :param state: mute if true otherwise unmute.
        :param slot: the target slot, if not set apply to the master control.
        :param channel: the channel, applicable only if slot is set, if not set apply to both input channels.
        :param side: the side, input by default.
        :return: the commands.
        '''
        state_cmd = 'on' if state else 'off'
        if slot is not None:
            cmds = []
            if channel is None:
                cmds.append(f"{side} 0 mute {state_cmd}")
                cmds.append(f"{side} 1 mute {state_cmd}")
            else:
                cmds.append(f"{side} {channel} mute {state_cmd}")
            return cmds
        else:
            return [f"mute {state_cmd}"]

    @staticmethod
    def gain(gain: float, slot: Optional[int], channel: Optional[int], side: Optional[str] = INPUT_NAME):
        '''
        Generates commands to set gain.
        :param gain: the gain to set.
        :param slot: the target slot, if not set apply to the master control.
        :param channel: the channel, applicable only if slot is set, if not set apply to both input channels.
        :param side: the side to apply the gain to, input by default.
        :return: the commands.
        '''
        if slot is not None:
            # TODO is this valid for other devices
            if not -72.0 <= gain <= 12.0:
                raise InvalidRequestError(f"{side} gain {gain:.2f} out of range (>= -72.0 and <= 12.0)")
            cmds = []
            if channel is None:
                cmds.append(f"{side} 0 gain -- {gain:.2f}")
                cmds.append(f"{side} 1 gain -- {gain:.2f}")
            else:
                cmds.append(f"{side} {channel} gain -- {gain:.2f}")
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


class MinidspRsClient:

    def __init__(self, listener, ip, device_id):
        ws_url = f"ws://{ip}/devices/{device_id}?levels=true&poll=true"
        logger.info(f"Listening to ws on {ws_url}")
        self.__factory = MinidspRsClientFactory(listener, device_id, url=ws_url)
        from twisted.internet.endpoints import clientFromString
        from twisted.internet import reactor
        # wsclient = clientFromString(reactor, 'unix:path=/tmp/minidsp.sock:timeout=5')
        wsclient = clientFromString(reactor, f"tcp:{ip}:timeout=5")
        self.__connector = wsclient.connect(self.__factory)

    def send(self, msg: str):
        self.__factory.broadcast(msg)


class MinidspRsProtocol(WebSocketClientProtocol):

    def onConnecting(self, transport_details):
        logger.info(f"Connecting to {transport_details}")

    def onConnect(self, response):
        logger.info(f"Connected to {response.peer}")

    def onOpen(self):
        logger.info("Connected to Minidsp")
        self.factory.register(self)

    def onClose(self, was_clean, code, reason):
        if was_clean:
            logger.info(f"Disconnected code: {code} reason: {reason}")
        else:
            logger.warning(f"UNCLEAN! Disconnected code: {code} reason: {reason}")

    def onMessage(self, payload, is_binary):
        if is_binary:
            logger.warning(f"Received {len(payload)} bytes in binary payload, ignoring")
        else:
            msg = payload.decode('utf8')
            logger.debug(f"[{self.factory.device_id}] Received {msg}")
            try:
                self.factory.listener.on_ws_message(json.loads(msg))
            except:
                logger.exception(f"[{self.factory.device_id}] Receiving unparseable message {msg}")


class MinidspRsClientFactory(WebSocketClientFactory, ReconnectingClientFactory):
    protocol = MinidspRsProtocol
    maxDelay = 5
    initialDelay = 0.5

    def __init__(self, listener, device_id, *args, **kwargs):
        super(MinidspRsClientFactory, self).__init__(*args, **kwargs)
        self.__device_id = device_id
        self.__clients: List[MinidspRsProtocol] = []
        self.listener = listener

    @property
    def device_id(self):
        return self.__device_id

    def clientConnectionFailed(self, connector, reason):
        logger.warning(f"[{self.device_id}] Client connection failed {reason} .. retrying ..")
        super().clientConnectionFailed(connector, reason)

    def clientConnectionLost(self, connector, reason):
        logger.warning(f"[{self.device_id}] Client connection failed {reason} .. retrying ..")
        super().clientConnectionLost(connector, reason)

    def register(self, client: MinidspRsProtocol):
        if client not in self.__clients:
            logger.info(f"[{self.device_id}] Registered device {client.peer}")
            self.__clients.append(client)
        else:
            logger.info(f"[{self.device_id}] Ignoring duplicate device {client.peer}")

    def unregister(self, client: MinidspRsProtocol):
        if client in self.__clients:
            logger.info(f"Unregistering device {client.peer}")
            self.__clients.remove(client)
        else:
            logger.info(f"Ignoring unregistered device {client.peer}")

    def broadcast(self, msg):
        if self.__clients:
            disconnected_clients = []
            for c in self.__clients:
                logger.info(f"[{self.device_id}] Sending to {c.peer} - {msg}")
                try:
                    c.sendMessage(msg.encode('utf8'))
                except Disconnected as e:
                    logger.exception(f"[{self.device_id}] Failed to send to {c.peer}, discarding")
                    disconnected_clients.append(c)
            for c in disconnected_clients:
                self.unregister(c)
        else:
            raise ValueError(f"No devices connected, ignoring {msg}")
