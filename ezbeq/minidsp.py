import json
import logging
import math
import os
import time
from concurrent.futures.thread import ThreadPoolExecutor
from contextlib import contextmanager
from typing import List, Optional, Union

from autobahn.exception import Disconnected
from autobahn.twisted import WebSocketClientFactory, WebSocketClientProtocol
from twisted.internet.protocol import ReconnectingClientFactory

from ezbeq.apis.ws import WsServer
from ezbeq.catalogue import CatalogueEntry, CatalogueProvider
from ezbeq.device import InvalidRequestError, SlotState, PersistentDevice, DeviceState

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
            MinidspSlotState(c_id, c_id == self.active_slot, descriptor.input_channels, descriptor.output_channels) for
            c_id in slot_ids
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


class PeqRoute:

    def __init__(self, side: str, channel_idx: int, biquads: int, beq: Optional[List[int]]):
        self.side = side
        self.channel_idx = channel_idx
        self.biquads = biquads
        self.beq = beq if beq is not None else list(range(biquads))

    @property
    def is_input(self) -> bool:
        return self.side == 'input'

    def __repr__(self):
        return f"{self.side} {self.channel_idx} {self.biquads} {self.beq}"


class MinidspDescriptor:

    def __init__(self, name: str, fs: str, peq_routes: List[PeqRoute], split: bool = False):
        self.name = name
        self.fs = str(int(fs))
        self.peq_routes = peq_routes
        self.split = split
        self.__input_channels = len([r for r in self.peq_routes if r.is_input])
        self.__output_channels = len([r for r in self.peq_routes if not r.is_input])

    @property
    def input_channels(self) -> int:
        return self.__input_channels

    @property
    def output_channels(self) -> int:
        return self.__output_channels

    def __repr__(self):
        return f"{self.name}, fs:{self.fs}, routes: {self.peq_routes}"


class Minidsp24HD(MinidspDescriptor):

    def __init__(self):
        super().__init__('2x4HD',
                         '96000',
                         [
                             PeqRoute('input', 0, 10, None),
                             PeqRoute('input', 1, 10, None),
                             PeqRoute('output', 0, 10, []),
                             PeqRoute('output', 1, 10, []),
                             PeqRoute('output', 2, 10, []),
                             PeqRoute('output', 3, 10, [])
                         ])


class MinidspDDRC24(MinidspDescriptor):

    def __init__(self):
        super().__init__('DDRC24',
                         '48000',
                         [
                             PeqRoute('output', 0, 10, None),
                             PeqRoute('output', 1, 10, None),
                             PeqRoute('output', 2, 10, None),
                             PeqRoute('output', 3, 10, None)
                         ])


class MinidspDDRC88(MinidspDescriptor):

    def __init__(self, sw_channels: List[int] = None):
        c = sw_channels if sw_channels is not None else [3]
        if any(ch for ch in c if ch < 0 or ch > 7):
            raise ValueError(f"Invalid channels {c}")
        super().__init__('DDRC88',
                         '48000',
                         [PeqRoute('output', r, 10, None if r in c else []) for r in range(8)]
                         )


class Minidsp410(MinidspDescriptor):

    def __init__(self):
        super().__init__('4x10',
                         '96000',
                         [
                             PeqRoute('input', 0, 5, None),
                             PeqRoute('input', 1, 5, None),
                             PeqRoute('output', 0, 5, None),
                             PeqRoute('output', 1, 5, None),
                             PeqRoute('output', 2, 5, None),
                             PeqRoute('output', 3, 5, None),
                             PeqRoute('output', 4, 5, None),
                             PeqRoute('output', 5, 5, None),
                             PeqRoute('output', 6, 5, None),
                             PeqRoute('output', 7, 5, None)
                         ],
                         split=True)


class Minidsp1010(MinidspDescriptor):

    def __init__(self):
        super().__init__('10x10',
                         '48000',
                         [
                             PeqRoute('input', 0, 6, None),
                             PeqRoute('input', 1, 6, None),
                             PeqRoute('input', 2, 6, None),
                             PeqRoute('input', 3, 6, None),
                             PeqRoute('input', 4, 6, None),
                             PeqRoute('input', 5, 6, None),
                             PeqRoute('input', 6, 6, None),
                             PeqRoute('input', 7, 6, None),
                             PeqRoute('output', 0, 6, list(range(4))),
                             PeqRoute('output', 1, 6, list(range(4))),
                             PeqRoute('output', 2, 6, list(range(4))),
                             PeqRoute('output', 3, 6, list(range(4))),
                             PeqRoute('output', 4, 6, list(range(4))),
                             PeqRoute('output', 5, 6, list(range(4))),
                             PeqRoute('output', 6, 6, list(range(4))),
                             PeqRoute('output', 7, 6, list(range(4)))
                         ],
                         split=True)


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
            return Minidsp1010()
        elif device_type == 'SHD':
            return MinidspDDRC24()
    elif 'descriptor' in cfg:
        desc: dict = cfg['descriptor']
        named_args = ['name', 'fs', 'routes']
        missing_keys = [x for x in named_args if x not in desc.keys()]
        if missing_keys:
            raise ValueError(f"Custom descriptor is missing keys - {missing_keys} - from {desc}")
        routes: List[dict] = desc['routes']

        def make_route(r: dict) -> PeqRoute:
            r_named_args = ['side', 'channel_idx', 'biquads']
            missing_route_keys = [x for x in r_named_args if x not in r.keys()]
            if missing_route_keys:
                raise ValueError(f"Custom PeqRoute is missing keys - {missing_keys} - from {r}")
            bq_count = int(r['biquads'])
            beq = [int(b) for b in r['beq']] if 'beq' in r else None
            kwargs = {k: v for k, v in r.items() if k not in r_named_args}
            return PeqRoute(r['side'], int(r['channel_idx']), bq_count, beq, **kwargs)

        kwargs = {k: v for k, v in desc.items() if k not in named_args}
        return MinidspDescriptor(desc['name'], str(desc['fs']), [make_route(r) for r in routes], **kwargs)
    else:
        return Minidsp24HD()


class Minidsp(PersistentDevice[MinidspState]):

    def __init__(self, name: str, config_path: str, cfg: dict, ws_server: WsServer, catalogue: CatalogueProvider):
        super().__init__(config_path, name, ws_server)
        self.__catalogue = catalogue
        self.__executor = ThreadPoolExecutor(max_workers=1)
        self.__cmd_timeout = cfg.get('cmdTimeout', 10)
        self.__ignore_retcode = cfg.get('ignoreRetcode', False)
        self.__levels_interval = 1.0 / float(cfg.get('levelsFps', 10))
        self.__runner = cfg['make_runner']()
        self.__client = MinidspRsClient(self) if cfg.get('useWs', False) else None
        self.__descriptor: MinidspDescriptor = make_peq_layout(cfg)
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
                logger.error(f"No output returned from device")
        except:
            logger.exception(f"Unable to parse device state {output}")
        return None

    @staticmethod
    def __as_idx(idx: Union[int, str]):
        return int(idx) - 1

    def __send_cmds(self, target_slot_idx: Optional[int], cmds: List[str]):
        return self.__executor.submit(self.__do_run, cmds, target_slot_idx).result(timeout=self.__cmd_timeout)

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
            for r in self.__descriptor.peq_routes:
                if r.is_input:
                    cmds.extend(MinidspBeqCommandGenerator.mute(False, target_slot_idx, r.channel_idx, side=r.side))
                    cmds.extend(MinidspBeqCommandGenerator.gain(0.0, target_slot_idx, r.channel_idx, side=r.side))
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

    def __do_run(self, config_cmds: List[str], slot: Optional[int]):
        if slot is not None:
            change_slot = True
            current_state = self.__read_state_from_device()
            if current_state and current_state.active_slot == str(slot + 1):
                change_slot = False
            if change_slot is True:
                logger.info(
                    f"Activating slot {slot}, current is {current_state.active_slot if current_state else 'UNKNOWN'}")
                config_cmds.insert(0, MinidspBeqCommandGenerator.activate(slot))
        formatted = '\n'.join(config_cmds)
        logger.info(f"\n{formatted}")
        with tmp_file(config_cmds) as file_name:
            kwargs = {'retcode': None} if self.__ignore_retcode else {}
            logger.info(
                f"Sending {len(config_cmds)} commands to slot {slot} via {file_name} {kwargs if kwargs else ''}")
            start = time.time()
            code, stdout, stderr = self.__runner['-f', file_name].run(timeout=self.__cmd_timeout, **kwargs)
            end = time.time()
            logger.info(
                f"Sent {len(config_cmds)} commands to slot {slot} in {to_millis(start, end)}ms - result is {code}")

    def _load_initial_state(self) -> MinidspState:
        return self.__load_state()

    def state(self) -> MinidspState:
        if not self._hydrate():
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
            logger.info(f"readlevels,{ts},{to_millis(start, end)}")
            return {
                'ts': ts,
                'input': levels['input_levels'],
                'output': levels['output_levels']
            }
        except:
            logger.exception(f"Unable to load levels {lines}")
            return {}

    def start_broadcast_levels(self) -> None:
        from twisted.internet import reactor
        sched = lambda: reactor.callLater(self.__levels_interval, __send)

        def __send():
            msg = json.dumps(self.levels())
            if self.ws_server.levels(self.name, msg):
                sched()

        sched()


class MinidspBeqCommandGenerator:

    @staticmethod
    def activate(slot: int) -> str:
        return f"config {slot}"

    @staticmethod
    def biquads(overwrite: bool, inputs: List[int], outputs: List[int], biquads: List[dict]):
        # [in|out]put <channel> peq <index> set -- <b0> <b1> <b2> <a1> <a2>
        # [in|out]put <channel> peq <index> bypass [on|off]
        cmds = []
        for side, channels in {'input': inputs, 'output': outputs}.items():
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
        # write filts to the inputs first then the output if it's a split deviceb
        filters = [MinidspBeqCommandGenerator.as_bq(f, descriptor.fs) for f in entry.filters] if entry else []
        idx = 0
        input_beq_routes = [r for r in descriptor.peq_routes if r.side == 'input' and r.beq]
        output_beq_routes = [r for r in descriptor.peq_routes if r.side == 'output' and r.beq]
        input_beqs = input_beq_routes[0].biquads if input_beq_routes else 0
        output_beqs = output_beq_routes[0].biquads if output_beq_routes else 0
        while idx < len(filters):
            coeffs: List[str] = filters[idx]
            if idx < input_beqs:
                for r in input_beq_routes:
                    cmds.append(MinidspBeqCommandGenerator.bq(r.channel_idx, idx, coeffs, r.side))
                    cmds.append(MinidspBeqCommandGenerator.bypass(r.channel_idx, idx, False, r.side))
            elif input_beqs == 0 or descriptor.split:
                if idx < (input_beqs + output_beqs):
                    for r in output_beq_routes:
                        cmds.append(MinidspBeqCommandGenerator.bq(r.channel_idx, idx - input_beqs, coeffs, r.side))
                        cmds.append(MinidspBeqCommandGenerator.bypass(r.channel_idx, idx - input_beqs, False, r.side))
                else:
                    raise ValueError('Not enough slots')
            else:
                raise ValueError('Not enough slots')
            idx += 1
        # we assume 10 biquads max so bypass anything that is left
        while idx < 10:
            if idx < input_beqs:
                for r in input_beq_routes:
                    cmds.append(MinidspBeqCommandGenerator.bypass(r.channel_idx, idx, True, r.side))
            elif input_beqs == 0 or descriptor.split:
                if idx < (input_beqs + output_beqs):
                    for r in output_beq_routes:
                        cmds.append(MinidspBeqCommandGenerator.bypass(r.channel_idx, idx - input_beqs, True, r.side))
                else:
                    raise ValueError('Not enough slots')
            else:
                raise ValueError('Not enough slots')
            idx += 1
        return cmds

    @staticmethod
    def bq(channel: int, idx: int, coeffs, side: str = 'input'):
        return f"{side} {channel} peq {idx} set -- {' '.join(coeffs)}"

    @staticmethod
    def bypass(channel: int, idx: int, bypass: bool, side: str = 'input'):
        return f"{side} {channel} peq {idx} bypass {'on' if bypass else 'off'}"

    @staticmethod
    def mute(state: bool, slot: Optional[int], channel: Optional[int], side: Optional[str] = 'input'):
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
    def gain(gain: float, slot: Optional[int], channel: Optional[int], side: Optional[str] = 'input'):
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

    def __init__(self, listener):
        # TODO which device
        self.__factory = MinidspRsClientFactory(listener, url='ws://localhost/devices/0?levels=true')
        from twisted.internet.endpoints import clientFromString
        from twisted.internet import reactor
        wsclient = clientFromString(reactor, 'unix:path=/tmp/minidsp.sock:timeout=5')
        self.__connector = wsclient.connect(self.__factory)

    def send(self, msg: str):
        self.__factory.broadcast(msg)


class MinidspRsProtocol(WebSocketClientProtocol):

    def onConnecting(self, transport_details):
        logger.info(f"Connecting to {transport_details}")

    def onConnect(self, response):
        logger.info(f"Connected to {response.peer}")
        self.sendMessage('getmso'.encode('utf-8'), isBinary=False)

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
            logger.info(f"Received {msg}")
            # self.factory.listener.on_msoupdate(json.loads(msg[10:]))


class MinidspRsClientFactory(WebSocketClientFactory, ReconnectingClientFactory):
    protocol = MinidspRsProtocol
    maxDelay = 5
    initialDelay = 0.5

    def __init__(self, listener, *args, **kwargs):
        super(MinidspRsClientFactory, self).__init__(*args, **kwargs)
        self.__clients: List[MinidspRsProtocol] = []
        self.listener = listener

    def clientConnectionFailed(self, connector, reason):
        logger.warning(f"Client connection failed {reason} .. retrying ..")
        super().clientConnectionFailed(connector, reason)

    def clientConnectionLost(self, connector, reason):
        logger.warning(f"Client connection failed {reason} .. retrying ..")
        super().clientConnectionLost(connector, reason)

    def register(self, client: MinidspRsProtocol):
        if client not in self.__clients:
            logger.info(f"Registered device {client.peer}")
            self.__clients.append(client)
        else:
            logger.info(f"Ignoring duplicate device {client.peer}")

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
                logger.info(f"Sending to {c.peer} - {msg}")
                try:
                    c.sendMessage(msg.encode('utf8'))
                except Disconnected as e:
                    logger.exception(f"Failed to send to {c.peer}, discarding")
                    disconnected_clients.append(c)
            for c in disconnected_clients:
                self.unregister(c)
        else:
            raise ValueError(f"No devices connected, ignoring {msg}")
