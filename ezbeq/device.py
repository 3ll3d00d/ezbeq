import json
import logging
import os
from abc import ABC, abstractmethod
from typing import List, Optional, Dict, TypeVar, Generic

from ezbeq.apis.ws import WsServer
from ezbeq.catalogue import CatalogueEntry, CatalogueProvider
from ezbeq.config import Config

logger = logging.getLogger('ezbeq.device')

S = TypeVar("S", bound='SlotState')
T = TypeVar("T", bound='SerialisableState')


class SlotState(Generic[S]):

    def __init__(self, slot_id: str):
        self.__slot_id = slot_id
        self.last = 'Empty'
        self.active = False

    @property
    def slot_id(self) -> str:
        return self.__slot_id

    def merge_with(self, state: S) -> None:
        self.last = state.last

    def as_dict(self) -> dict:
        return {'id': self.slot_id, 'last': self.last, 'active': self.active}

    def __repr__(self):
        return f"{'*' if self.active else ''} {self.slot_id} - {self.last}"

    def clear(self):
        self.last = 'Empty'


class DeviceState(ABC):

    @abstractmethod
    def serialise(self) -> dict:
        pass


class Device(ABC, Generic[T]):

    @property
    @abstractmethod
    def name(self) -> str:
        pass

    @property
    @abstractmethod
    def device_type(self) -> str:
        pass

    @property
    def supports_gain(self) -> bool:
        return False

    @abstractmethod
    def state(self) -> T:
        pass

    @abstractmethod
    def activate(self, slot: str) -> None:
        pass

    @abstractmethod
    def load_filter(self, slot: str, entry: CatalogueEntry) -> None:
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

    @abstractmethod
    def update(self, params: dict) -> bool:
        pass


class DeviceRepository:

    def __init__(self, cfg: Config, ws_server: WsServer, catalogue: CatalogueProvider):
        self.__devices: Dict[str, Device] = {}
        device = create_device(cfg, ws_server, catalogue)
        self.__devices[device.name] = device

    def device_type(self, name: str) -> str:
        return self.__get_device(name).device_type

    def __get_device(self, name):
        if name in self.__devices:
            return self.__devices[name]
        else:
            raise NoSuchDevice(name)

    def supports_gain(self, name: str) -> bool:
        return self.__get_device(name).supports_gain

    def state(self, name: str) -> DeviceState:
        return self.__get_device(name).state()

    def all_devices(self) -> List[DeviceState]:
        return [d.state() for d in self.__devices.values()]

    def activate(self, name: str, slot: str) -> None:
        self.__get_device(name).activate(slot)

    def load_filter(self, name: str, slot: str, entry: CatalogueEntry) -> None:
        self.__get_device(name).load_filter(slot, entry)

    def clear_filter(self, name: str, slot: str) -> None:
        self.__get_device(name).clear_filter(slot)

    def mute(self, name: str, slot: Optional[str], channel: Optional[int]) -> None:
        self.__get_device(name).mute(slot, channel)

    def unmute(self, name: str, slot: Optional[str], channel: Optional[int]) -> None:
        self.__get_device(name).unmute(slot, channel)

    def set_gain(self, name: str, slot: Optional[str], channel: Optional[int], gain: float) -> None:
        self.__get_device(name).set_gain(slot, channel, gain)

    def update(self, device_name: str, params: dict) -> bool:
        return self.__get_device(device_name).update(params)


def create_device(cfg: Config, ws_server: WsServer, catalogue: CatalogueProvider) -> Device:
    if cfg.minidsp_exe:
        from ezbeq.minidsp import Minidsp
        return Minidsp('master', cfg, ws_server, catalogue)
    elif cfg.htp1_options:
        from ezbeq.htp1 import Htp1
        return Htp1('master', cfg)
    elif cfg.jriver_options:
        from ezbeq.jriver import JRiver
        return JRiver('master', cfg)
    else:
        raise ValueError('No device configured')


class InvalidRequestError(Exception):
    pass


class NoSuchDevice(Exception):
    pass


class PersistentDevice(Device, ABC, Generic[T]):

    def __init__(self, cache_path: str, name: str, ws_server: WsServer):
        self.__name = name
        self.__file_name = os.path.join(cache_path, f'{name}.json')
        self.__hydrated = False
        self._current_state: Optional[T] = None
        self.__ws_server = ws_server

    @property
    def name(self) -> str:
        return self.__name

    def _hydrate(self) -> bool:
        if not self.__hydrated:
            self._current_state = self._load_initial_state()
            if os.path.exists(self.__file_name):
                with open(self.__file_name, 'r') as f:
                    cached_state = json.load(f)
                logger.info(f"Loaded {cached_state} from {self.__file_name}")
                self._current_state = self._merge_state(self._current_state, cached_state)
            else:
                logger.info(f"No cached state found at {self.__file_name}")
            self.__ws_server.factory.init(self.__get_state_msg)
            self.__hydrated = True
            return True
        return False

    @abstractmethod
    def _load_initial_state(self) -> T:
        pass

    @abstractmethod
    def _merge_state(self, loaded: T, cached: dict) -> None:
        return loaded

    def _persist(self):
        assert self._current_state, 'hydrate cannot return None'
        with open(self.__file_name, 'w') as f:
            json.dump(self._current_state.serialise(), f, sort_keys=True)

    def _broadcast(self):
        if self.__ws_server:
            self.__ws_server.broadcast(self.__get_state_msg())

    def __get_state_msg(self):
        assert self._current_state, 'hydrate cannot return None'
        return json.dumps(self._current_state.serialise(), ensure_ascii=False)
