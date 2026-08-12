import json
import logging
import os
from abc import ABC, abstractmethod
from typing import ClassVar, Generic, TypeVar

from ezbeq.apis.ws import WsServer
from ezbeq.catalogue import CatalogueEntry, CatalogueProvider
from ezbeq.config import Config

logger = logging.getLogger('ezbeq.device')


S = TypeVar('S', bound='SlotState')


class SlotState(Generic[S]):

    def __init__(self, slot_id: str):
        self.__slot_id = slot_id
        self.last = 'Empty'
        self.last_author = None
        self.active = False

    @property
    def slot_id(self) -> str:
        return self.__slot_id

    def merge_with(self, state: dict) -> None:
        if 'last' in state:
            self.last = state['last']
        if 'active' in state:
            self.active = bool(state['active'])
        else:
            self.active = False
        if 'author' in state:
            self.last_author = state['author']

    def as_dict(self) -> dict:
        return {'id': self.slot_id, 'last': self.last, 'active': self.active, 'author': self.last_author}

    def __repr__(self):
        return f"{'*' if self.active else ''} {self.slot_id} - {self.last}"

    def clear(self):
        self.last = 'Empty'
        self.last_author = None


class DeviceState(ABC):

    @abstractmethod
    def serialise(self) -> dict:
        pass

    def __repr__(self):
        return f"{self.__class__.__name__} : {self.serialise()}"


T = TypeVar('T', bound='DeviceState')


class Device(ABC, Generic[T]):
    """
    ALL_OPS is every fan-out-able operation a composite device knows about.
    SUPPORTED_OPS is the subset a given device class actually implements -
    the rest raise NotImplementedError if called directly. A composite uses
    ALL_OPS - SUPPORTED_OPS to automatically skip a member for an op it
    structurally can't do, instead of requiring the user to list it in
    skipOps by hand (see CompositeDevice._CompositeDevice__build_specs).

    FIXED_SLOT_ID is None for devices with more than one real, independently
    addressable slot (minidsp's 4 memory configs, jriver's zones). Every
    other device type has exactly one slot with a fixed id - FIXED_SLOT_ID
    names it so a composite can route any composite-level slot straight to
    it without a per-member slotMap.
    """
    ALL_OPS: ClassVar[frozenset[str]] = frozenset({
        'activate', 'load_filter', 'clear_filter', 'load_biquads', 'send_commands',
        'mute', 'unmute', 'set_gain',
    })
    SUPPORTED_OPS: ClassVar[frozenset[str]] = ALL_OPS
    FIXED_SLOT_ID: ClassVar[str | None] = None

    @property
    @abstractmethod
    def name(self) -> str:
        pass

    @property
    @abstractmethod
    def device_type(self) -> str:
        pass

    @abstractmethod
    def state(self, refresh: bool = False) -> T:
        pass

    @abstractmethod
    def activate(self, slot: str) -> None:
        pass

    @abstractmethod
    def load_filter(self, slot: str, entry: CatalogueEntry, mv_adjust: float = 0.0) -> None:
        pass

    @abstractmethod
    def load_biquads(self, slot: str, overwrite: bool, inputs: list[int], outputs: list[int], biquads: list[dict]) -> None:
        pass

    @abstractmethod
    def send_commands(self, slot: str, inputs: list[int], outputs: list[int], commands: list[str]) -> None:
        pass

    @abstractmethod
    def clear_filter(self, slot: str) -> None:
        pass

    @abstractmethod
    def mute(self, slot: str | None, channel: int | None) -> None:
        pass

    @abstractmethod
    def unmute(self, slot: str | None, channel: int | None) -> None:
        pass

    @abstractmethod
    def set_gain(self, slot: str | None, channel: int | None, gain: float) -> None:
        pass

    @abstractmethod
    def update(self, params: dict) -> bool:
        pass

    @abstractmethod
    def levels(self) -> dict:
        pass


class DeviceRepository:

    def __init__(self, cfg: Config, ws_server: WsServer, catalogue: CatalogueProvider):
        self.__devices: dict[str, Device] = {}
        for device in create_devices(cfg, ws_server, catalogue):
            self.__devices[device.name] = device
        self.__hidden: set[str] = set()
        for device in self.__devices.values():
            if device.device_type == 'composite' and not device.expose_members:
                self.__hidden.update(device.member_names)

    def device_type(self, name: str) -> str:
        return self.__get_device(name).device_type

    def __get_device(self, name):
        if name in self.__devices:
            return self.__devices[name]
        else:
            raise NoSuchDevice(name)

    def state(self, name: str) -> DeviceState:
        return self.__get_device(name).state()

    def all_devices(self, refresh: bool = False) -> dict[str, DeviceState]:
        result: dict[str, DeviceState] = {}
        for n, d in self.__devices.items():
            if n in self.__hidden:
                continue
            try:
                result[n] = d.state(refresh=refresh)
            except Exception:
                # A device that is unreachable (e.g. jriver with MCWS down) must not take every
                # other device down with it - state() for a PersistentDevice retries from scratch
                # on the next call (see PersistentDevice._hydrate), so simply omitting it here
                # keeps this device recoverable on a later poll instead of raising and leaving
                # every device - including healthy ones - unresolved for this call.
                logger.exception(f"Failed to load state for device '{n}', excluding it from this response")
        return result

    def activate(self, name: str, slot: str) -> None:
        self.__get_device(name).activate(slot)

    def load_filter(self, name: str, slot: str, entry: CatalogueEntry) -> None:
        self.__get_device(name).load_filter(slot, entry)

    def load_biquads(self, name: str, slot: str, overwrite: bool, inputs: list[int], outputs: list[int],
                     biquads: list[dict]) -> None:
        self.__get_device(name).load_biquads(slot, overwrite, inputs, outputs, biquads)

    def send_commands(self, name: str, slot: str, inputs: list[int], outputs: list[int], commands: list[str]) -> None:
        self.__get_device(name).send_commands(slot, inputs, outputs, commands)

    def clear_filter(self, name: str, slot: str) -> None:
        self.__get_device(name).clear_filter(slot)

    def mute(self, name: str, slot: str | None, channel: int | None) -> None:
        self.__get_device(name).mute(slot, channel)

    def unmute(self, name: str, slot: str | None, channel: int | None) -> None:
        self.__get_device(name).unmute(slot, channel)

    def set_gain(self, name: str, slot: str | None, channel: int | None, gain: float) -> None:
        self.__get_device(name).set_gain(slot, channel, gain)

    def update(self, device_name: str, params: dict) -> bool:
        return self.__get_device(device_name).update(params)

    def levels(self, device_name: str) -> dict:
        return self.__get_device(device_name).levels()


def _composite_member_names(values: dict) -> list[str]:
    members = values.get('members')
    if isinstance(members, dict):
        return list(members.keys())
    elif isinstance(members, list):
        return list(members)
    return []


def _device_class_for_type(d_type: str) -> type[Device]:
    """
    Resolves a config 'type' value to its Device class without instantiating
    it - used both by create_devices() (to build real devices) and by
    _validate_composite_configs() (to read SUPPORTED_OPS/FIXED_SLOT_ID ahead
    of time, before any hardware connection is attempted).
    """
    if d_type == 'minidsp':
        from ezbeq.minidsp import Minidsp
        return Minidsp
    elif d_type == 'htp1':
        from ezbeq.htp1 import Htp1
        return Htp1
    elif d_type == 'stormaudio':
        from ezbeq.stormaudio import StormAudio
        return StormAudio
    elif d_type == 'jriver':
        from ezbeq.jriver import JRiver
        return JRiver
    elif d_type == 'qsys':
        from ezbeq.qsys import Qsys
        return Qsys
    elif d_type == 'camilladsp':
        from ezbeq.camilladsp import CamillaDsp
        return CamillaDsp
    elif d_type == 'reaper':
        from ezbeq.reaper import Reaper
        return Reaper
    raise ValueError(f"Unknown device type '{d_type}'")


_BALANCE_OPS = ('set_gain', 'mute', 'unmute')


def _validate_no_silent_partial_gain(name: str, values: dict, member_names: list[str], cfg: Config) -> None:
    """
    A mapped composite whose members disagree on set_gain/mute/unmute support
    (whether structurally, via SUPPORTED_OPS, or because a member explicitly
    opted out via skipOps) would apply the op to some members but not others -
    silently skewing the array's inter-channel balance rather than erroring.
    Require an explicit allowPartialGain: true acknowledging that before
    letting it through.
    """
    if values.get('allowPartialGain', False):
        return
    overrides = values.get('members', {})
    effective_support: dict[str, frozenset[str]] = {}
    for member_name in member_names:
        cls = _device_class_for_type(cfg.devices[member_name]['type'])
        explicit_skip = set((overrides.get(member_name) or {}).get('skipOps', []))
        effective_support[member_name] = cls.SUPPORTED_OPS - explicit_skip
    for op in _BALANCE_OPS:
        supporting = {m for m in member_names if op in effective_support[m]}
        if supporting and len(supporting) < len(member_names):
            missing = sorted(set(member_names) - supporting)
            raise ValueError(
                f"Composite device '{name}' would apply '{op}' to some members but not others "
                f"({', '.join(missing)} do not support it) - this would silently skew inter-channel "
                f"balance. Set allowPartialGain: true on '{name}' to apply it only to the members "
                f"that support it anyway."
            )


def _validate_composite_configs(cfg: Config) -> None:
    """
    Fail fast, at startup, on malformed composite device config - mirrors the
    existing pattern of Minidsp.__init__ exiting via create_minidsp_runner if
    its exe binary can't be found.
    """
    all_names = set(cfg.devices.keys())
    composite_names = {n for n, v in cfg.devices.items() if v['type'] == 'composite'}
    seen_as_member: dict[str, str] = {}
    for name in composite_names:
        values = cfg.devices[name]
        mode = values.get('mode')
        if mode not in ('mirror', 'mapped'):
            raise ValueError(f"Composite device '{name}' has invalid mode '{mode}', must be 'mirror' or 'mapped'")
        member_names = _composite_member_names(values)
        if not member_names:
            raise ValueError(f"Composite device '{name}' has no members configured")
        for member_name in member_names:
            if member_name not in all_names:
                raise ValueError(f"Composite device '{name}' references unknown member '{member_name}'")
            if member_name in composite_names:
                raise ValueError(f"Composite device '{name}' references '{member_name}' which is itself a "
                                 f"composite - nesting composite devices is not supported")
            if member_name in seen_as_member:
                raise ValueError(f"Device '{member_name}' cannot be a member of more than one composite "
                                 f"('{seen_as_member[member_name]}' and '{name}')")
            seen_as_member[member_name] = name
        if mode == 'mirror':
            member_types = {cfg.devices[m]['type'] for m in member_names}
            if len(member_types) > 1:
                raise ValueError(f"Composite device '{name}' is in mirror mode but its members have differing "
                                 f"types ({sorted(member_types)}) - mirror mode requires members of one type, "
                                 f"use mode: mapped for mixed device types")
        else:
            primary = values.get('primary')
            if not primary:
                raise ValueError(f"Composite device '{name}' is in mapped mode but has no 'primary' member set")
            if primary not in member_names:
                raise ValueError(f"Composite device '{name}' has primary '{primary}' which is not one of its members")
            _validate_no_silent_partial_gain(name, values, member_names, cfg)


def create_devices(cfg: Config, ws_server: WsServer, catalogue: CatalogueProvider) -> list[Device]:
    _validate_composite_configs(cfg)
    devices: dict[str, Device] = {}
    composite_configs: dict[str, dict] = {}
    for name, values in cfg.devices.items():
        d_type = values['type']
        if d_type == 'composite':
            composite_configs[name] = values
        else:
            devices[name] = _device_class_for_type(d_type)(name, cfg.config_path, values, ws_server, catalogue)
    for name, values in composite_configs.items():
        from ezbeq.composite import CompositeDevice
        member_names = _composite_member_names(values)
        members = {m: devices[m] for m in member_names}
        devices[name] = CompositeDevice(name, cfg.config_path, values, ws_server, catalogue, members)
    if not devices:
        raise ValueError('No device configured')
    else:
        # composites are necessarily built in a second pass (they need their members to already
        # exist), so `devices` above ends up with every composite trailing after every
        # non-composite regardless of where it was actually declared - reorder back to cfg.devices'
        # original yaml order so the API/UI list devices the way the user wrote them.
        return [devices[name] for name in cfg.devices]


class InvalidRequestError(Exception):
    pass


class NoSuchDevice(Exception):
    pass


class PersistentDevice(Device, ABC, Generic[T]):

    def __init__(self, cache_path: str, name: str, ws_server: WsServer):
        self.__name = name
        self.__file_name = os.path.join(cache_path, f'{name}.json')
        self.__hydrated = False
        self._current_state: T | None = None
        self.__ws_server = ws_server

    @property
    def name(self) -> str:
        return self.__name

    def state(self, refresh: bool = False) -> T:
        self._hydrate(refresh=refresh)
        return self._current_state

    def _hydrate(self, refresh: bool = False) -> bool:
        if not self.__hydrated or refresh is True:
            self._current_state = self._load_initial_state()
            if os.path.exists(self.__file_name):
                try:
                    with open(self.__file_name) as f:
                        cached_state = json.load(f)
                    logger.debug(f"Loaded {cached_state} from {self.__file_name}")
                    self._current_state = self._merge_state(self._current_state, cached_state)
                except Exception:
                    logger.exception(f'Failed to load content from {self.__file_name}')
            else:
                logger.debug(f"No cached state found at {self.__file_name}")
            if refresh is False:
                self.__ws_server.factory.init_state_provider(self.__get_state_msg)
                self.__hydrated = True
            return True
        return False

    @abstractmethod
    def _load_initial_state(self) -> T:
        pass

    @abstractmethod
    def _merge_state(self, loaded: T, cached: dict) -> T:
        return loaded

    def _persist(self):
        assert self._current_state, 'hydrate cannot return None'
        tmp = self.__file_name + '.tmp'
        with open(tmp, 'w') as f:
            json.dump(self._current_state.serialise(), f, sort_keys=True)
        os.replace(tmp, self.__file_name)

    def _broadcast(self):
        if self.ws_server:
            self.ws_server.broadcast(self.__get_state_msg())

    def __get_state_msg(self):
        assert self._current_state, 'hydrate cannot return None'
        return json.dumps({'message': 'DeviceState', 'data': self._current_state.serialise()}, ensure_ascii=False)

    def _hydrate_cache_broadcast(self, func: callable):
        self._hydrate()
        try:
            return func()
        finally:
            self._persist()
            self._broadcast()

    @property
    def ws_server(self) -> WsServer:
        return self.__ws_server


class UnableToPatchDeviceError(Exception):
    def __init__(self, msg: str, invalid_request: bool):
        self.msg = msg
        self.invalid_request = invalid_request

    @property
    def code(self) -> int:
        return 400 if self.invalid_request else 500
