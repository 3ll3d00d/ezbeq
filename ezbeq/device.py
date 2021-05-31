import json
import logging
import os
from abc import ABC, abstractmethod
from typing import List, Optional

from ezbeq.apis.ws import WsServer
from ezbeq.catalogue import Catalogue
from ezbeq.config import Config

logger = logging.getLogger('ezbeq.device')


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


class DeviceControls:

    def __init__(self):
        self.mute: bool = False
        self.master_volume: float = 0.0

    def as_dict(self) -> dict:
        return {
            'mute': self.mute,
            'masterVolume': self.master_volume
        }

    def __repr__(self):
        return f"MV: {self.master_volume:.2f} Mute: {self.mute}"


class DeviceState:

    def __init__(self, name: str):
        self.__name: str = name
        self.__slots: List[SlotState] = []
        self.__device_controls: Optional[DeviceControls] = None

    @property
    def name(self):
        return self.__name

    def __repr__(self):
        return f"{self.name} {self.__device_controls if self.__device_controls else ''} [Slots: {self.__slots}]"

    @property
    def slots(self) -> List[SlotState]:
        return self.__slots

    @slots.setter
    def slots(self, slots: List[SlotState]):
        assert self.__slots == [], 'can only initialise slots once'
        assert slots != [], 'must have slots'
        self.__slots = slots
        # TODO fix
        from ezbeq.minidsp import MinidspSlotState
        if isinstance(slots[0], MinidspSlotState):
            self.__device_controls = DeviceControls()

    @property
    def master_volume(self) -> Optional[float]:
        return self.__device_controls.master_volume if self.__device_controls else None

    @master_volume.setter
    def master_volume(self, mv: float):
        if self.__device_controls:
            self.__device_controls.master_volume = mv

    @property
    def mute(self) -> Optional[bool]:
        return self.__device_controls.mute if self.__device_controls else None

    @mute.setter
    def mute(self, mute: bool):
        if self.__device_controls:
            self.__device_controls.mute = mute

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
        d_dict = self.__device_controls.as_dict() if self.__device_controls else {}
        return {
            **d_dict,
            'slots': [s.as_dict() for s in self.__slots]
        }

    def activate(self, slot_id: str):
        for s in self.__slots:
            s.active = s.slot_id == slot_id


class DeviceStateHolder:

    def __init__(self, cfg: Config, ws_server: WsServer):
        self.__ws_server = ws_server
        self.__state = DeviceState('master')
        self.__cached_state = {}
        self.__device_type = None
        self.__file_name = os.path.join(cfg.config_path, 'device.json')
        self.__initialised = False
        if os.path.exists(self.__file_name):
            with open(self.__file_name, 'r') as f:
                self.__cached_state = json.load(f)
            logger.info(f"Loaded {self.__cached_state} from {self.__file_name}")
        else:
            logger.info(f"No cached state found at {self.__file_name}")
        self.__ws_server.factory.init(self.__get_state_msg)

    def initialise(self, bridge: 'DeviceBridge') -> None:
        if not self.__initialised:
            self.__device_type = bridge.device_type()
            self.__state.slots = bridge.slot_state()
            if self.__cached_state:
                if not self.__state.merge_with(self.__cached_state):
                    logger.warning(f"Discarded {self.__cached_state} from {self.__file_name}, does not match {self.__state}")
            device_state = bridge.state()
            if device_state:
                if 'active_slot' in device_state:
                    self.activate(device_state['active_slot'])
                if 'mute' in device_state:
                    self.master_mute = device_state['mute'] is True
                if 'volume' in device_state:
                    self.master_volume = device_state['volume']
            self.__initialised = True
            self.__broadcast_state()

    def __broadcast_state(self):
        self.__ws_server.broadcast(self.__get_state_msg())

    def __get_state_msg(self):
        return json.dumps(self.__state.as_dict(), ensure_ascii=False)

    def activate(self, slot: str):
        self.__activate_cache_broadcast(slot)

    def __do_activate(self, slot):
        self.__state.activate(slot)

    def set_loaded_entry(self, slot: str, entry: Catalogue):
        self.__set_last(slot, entry.formatted_title)

    def __set_last(self, slot: str, title: str):
        self.__state.get_slot(slot).last = title
        self.__activate_cache_broadcast(slot)

    def __activate_cache_broadcast(self, slot: str):
        self.__do_activate(slot)
        with open(self.__file_name, 'w') as f:
            json.dump(self.__state.serialise(), f, sort_keys=True)
        self.__broadcast_state()

    def error(self, slot: str):
        self.__set_last(slot, 'ERROR')

    def clear(self, slot: str):
        self.__state.get_slot(slot).clear()
        self.__activate_cache_broadcast(slot)

    @property
    def master_volume(self):
        return self.__state.master_volume

    @master_volume.setter
    def master_volume(self, value: float):
        self.__state.master_volume = value
        self.__broadcast_state()

    @property
    def master_mute(self):
        return self.__state.mute

    @master_mute.setter
    def master_mute(self, value: bool):
        self.__state.mute = value
        self.__broadcast_state()

    def set_slot_gain(self, slot: str, channel: Optional[int], value: float):
        self.__state.get_slot(slot).set_gain(channel, value)
        self.__activate_cache_broadcast(slot)

    def mute_slot(self, slot: str, channel: Optional[int]):
        self.__state.get_slot(slot).mute(channel)
        self.__activate_cache_broadcast(slot)

    def unmute_slot(self, slot: str, channel: Optional[int]):
        self.__state.get_slot(slot).unmute(channel)
        self.__activate_cache_broadcast(slot)

    def get(self) -> DeviceState:
        return self.__state


class Bridge(ABC):

    @abstractmethod
    def device_type(self) -> str:
        pass

    @abstractmethod
    def slot_state(self) -> List[SlotState]:
        pass

    @abstractmethod
    def state(self) -> Optional[dict]:
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

    def device_type(self):
        return self.__bridge.device_type()

    def slot_state(self) -> List[SlotState]:
        return self.__bridge.slot_state()

    def supports_gain(self):
        from ezbeq.minidsp import Minidsp
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
        from ezbeq.minidsp import Minidsp
        return Minidsp(cfg)
    elif cfg.htp1_options:
        from ezbeq.htp1 import Htp1
        return Htp1(cfg)
    elif cfg.jriver_options:
        from ezbeq.jriver import JRiver
        return JRiver(cfg)
    else:
        raise ValueError('No device configured')


class InvalidRequestError(Exception):
    pass
