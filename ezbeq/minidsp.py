import logging
import os
from concurrent.futures.thread import ThreadPoolExecutor
from contextlib import contextmanager
from typing import List, Optional, Union

import math
import time
from autobahn.exception import Disconnected
from autobahn.twisted import WebSocketClientFactory, WebSocketClientProtocol
from twisted.internet.protocol import ReconnectingClientFactory

from ezbeq.apis.ws import WsServer
from ezbeq.catalogue import CatalogueEntry, CatalogueProvider
from ezbeq.device import InvalidRequestError, SlotState, PersistentDevice, DeviceState

logger = logging.getLogger('ezbeq.minidsp')


class MinidspState(DeviceState):

    def __init__(self, name: str, **kwargs):
        self.__name = name
        self.master_volume: float = kwargs['mv'] if 'mv' in kwargs else 0.0
        self.__mute: bool = kwargs['mute'] if 'mute' in kwargs else False
        self.__active_slot: str = kwargs['active_slot'] if 'active_slot' in kwargs else ''
        slot_ids = [str(i + 1) for i in range(4)]
        self.__slots: List[MinidspSlotState] = [MinidspSlotState(c_id, c_id == self.active_slot) for c_id in slot_ids]

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

    def load(self, slot_id: str, entry: CatalogueEntry):
        self.get_slot(slot_id).last = entry.formatted_title
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

    def __init__(self, slot_id: str, active: bool):
        super().__init__(slot_id)
        self.gain1 = 0.0
        self.mute1 = False
        self.gain2 = 0.0
        self.mute2 = False
        self.active = active

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

    def merge_with(self, state: dict) -> None:
        super().merge_with(state)
        if 'gain1' in state:
            self.gain1 = float(state['gain1'])
        if 'gain2' in state:
            self.gain2 = float(state['gain2'])
        if 'mute1' in state:
            self.mute1 = bool(state['mute1'])
        if 'mute2' in state:
            self.mute2 = bool(state['mute2'])

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
        return f"{super().__repr__()} - 1: {self.gain1:.2f}/{self.mute1} 2: {self.gain2:.2f}/{self.mute2}"


class Minidsp(PersistentDevice[MinidspState]):

    def __init__(self, name: str, config_path: str, cfg: dict, ws_server: WsServer, catalogue: CatalogueProvider):
        super().__init__(config_path, name, ws_server)
        self.__catalogue = catalogue
        self.__executor = ThreadPoolExecutor(max_workers=1)
        self.__cmd_timeout = cfg.get('cmdTimeout', 10)
        self.__ignore_retcode = cfg.get('ignoreRetcode', False)
        self.__runner = cfg['make_runner']()
        self.__client = MinidspRsClient(self) if cfg.get('useWs', False) else None

    @property
    def device_type(self) -> str:
        return self.__class__.__name__.lower()

    @property
    def supports_gain(self) -> bool:
        return True

    def __load_state(self) -> MinidspState:
        result = self.__executor.submit(self.__read_state_from_device).result(timeout=self.__cmd_timeout)
        return result if result else MinidspState(self.name)

    def __read_state_from_device(self) -> Optional[MinidspState]:
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
                                values['mv'] = float(v[13:-1])
            return MinidspState(self.name, **values)
        except:
            logger.exception(f"Unable to parse device state {lines}")
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

    def load_filter(self, slot: str, entry: CatalogueEntry) -> None:
        def __do_it():
            target_slot_idx = self.__as_idx(slot)
            self.__validate_slot_idx(target_slot_idx)
            cmds = MinidspBeqCommandGenerator.filt(entry)
            try:
                self.__send_cmds(target_slot_idx, cmds)
                self._current_state.load(slot, entry)
            except Exception as e:
                self._current_state.error(slot)
                raise e
        self._hydrate_cache_broadcast(__do_it)

    def clear_filter(self, slot: str) -> None:
        def __do_it():
            target_slot_idx = self.__as_idx(slot)
            self.__validate_slot_idx(target_slot_idx)
            cmds = MinidspBeqCommandGenerator.filt(None)
            cmds.extend(MinidspBeqCommandGenerator.mute(False, target_slot_idx, None))
            cmds.extend(MinidspBeqCommandGenerator.gain(0.0, target_slot_idx, None))
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
                logger.info(f"Activating slot {slot}, current is {current_state.active_slot}")
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


class MinidspBeqCommandGenerator:

    @staticmethod
    def activate(slot: int) -> str:
        return f"config {slot}"

    @staticmethod
    def filt(entry: Optional[CatalogueEntry]):
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
