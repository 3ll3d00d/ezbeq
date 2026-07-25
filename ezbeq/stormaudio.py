import logging
import re

import requests

from ezbeq.apis.ws import WsServer
from ezbeq.catalogue import CatalogueEntry, CatalogueProvider
from ezbeq.device import (
    DeviceState,
    InvalidRequestError,
    PersistentDevice,
    SlotState,
    UnableToPatchDeviceError,
)

logger = logging.getLogger('ezbeq.stormaudio')

SLOT_ID = 'StormAudio'
FILTER_TYPE_MAP = {
    'PeakingEQ': 'Bell',
    'LowShelf': 'Low Shelf',
    'HighShelf': 'High Shelf',
}
MAX_FILTERS = 20
IMPORT_SUCCESS_PATTERN = re.compile(
    r'\bmodifications?\s+(?:have\s+been\s+)?(?:committed|commitees|commitées)\b',
    re.IGNORECASE,
)


class StormAudioSlotState(SlotState):

    def __init__(self):
        super().__init__(SLOT_ID)


class StormAudioState(DeviceState):

    def __init__(self, name: str):
        self.__name = name
        self.slot = StormAudioSlotState()
        self.slot.active = True

    def serialise(self) -> dict:
        return {
            'type': 'stormaudio',
            'name': self.__name,
            'slots': [self.slot.as_dict()]
        }


class StormAudio(PersistentDevice[StormAudioState]):

    def __init__(self, name: str, config_path: str, cfg: dict, ws_server: WsServer, catalogue: CatalogueProvider):
        super().__init__(config_path, name, ws_server)
        self.__name = name
        self.__catalogue = catalogue
        self.__url = self.__resolve_url(cfg)
        self.__timeout = float(cfg.get('timeout', 30.0))
        self.__profile_name = cfg.get('profileName', 'ezBEQ')
        self.__sub_count = int(cfg.get('subCount', 1))
        self.__ratio = RatioConfig(cfg.get('ratio', {}))
        if self.__sub_count < 1:
            raise ValueError('StormAudio subCount must be at least 1')

    @staticmethod
    def __resolve_url(cfg: dict) -> str:
        if 'url' in cfg:
            return cfg['url']
        ip = cfg.get('ip')
        if not ip:
            raise ValueError('StormAudio requires either url or ip')
        ip = str(ip).rstrip('/')
        if not ip.startswith(('http://', 'https://')):
            ip = f'http://{ip}'
        return f'{ip}/mso.php'

    def _load_initial_state(self) -> StormAudioState:
        return StormAudioState(self.name)

    def _merge_state(self, loaded: StormAudioState, cached: dict) -> StormAudioState:
        if 'slots' in cached:
            for slot in cached['slots']:
                if slot.get('id') == SLOT_ID:
                    loaded.slot.merge_with(slot)
        loaded.slot.active = True
        return loaded

    @property
    def device_type(self) -> str:
        return self.__class__.__name__.lower()

    def update(self, params: dict) -> bool:
        any_update = False
        if 'slots' in params:
            for slot in params['slots']:
                if slot.get('id') == SLOT_ID and 'entry' in slot:
                    if slot['entry']:
                        match = self.__catalogue.find(slot['entry'])
                        if not match:
                            raise UnableToPatchDeviceError(f'Unknown catalogue entry {slot["entry"]}', True)
                        self.load_filter(SLOT_ID, match)
                        any_update = True
                    else:
                        self.clear_filter(SLOT_ID)
                        any_update = True
        return any_update

    def activate(self, slot: str) -> None:
        self.__check_slot(slot)

        def __do_it():
            self._current_state.slot.active = True

        self._hydrate_cache_broadcast(__do_it)

    def load_filter(self, slot: str, entry: CatalogueEntry, mv_adjust: float = 0.0) -> None:
        self.__check_slot(slot)
        payload = make_mso_payload(entry, self.__profile_name, self.__sub_count, self.__ratio, mv_adjust=mv_adjust)
        self._hydrate_cache_broadcast(lambda: self.__load_payload(payload, entry.formatted_title, entry.author))

    def __load_payload(self, payload: dict, title: str, author: str | None = None):
        try:
            self.__post(payload)
            self._current_state.slot.last = title
            self._current_state.slot.last_author = author
        except Exception:
            self._current_state.slot.last = 'ERROR'
            self._current_state.slot.last_author = None
            raise

    def __post(self, payload: dict):
        logger.info(f"Sending {len(payload.get('Sub', []))} StormAudio sub blocks")
        rsp = requests.post(self.__url, json=payload, timeout=self.__timeout)
        if not rsp.ok:
            raise StormAudioError(f"StormAudio returned HTTP {rsp.status_code}")
        try:
            body = rsp.json()
        except ValueError as e:
            raise StormAudioError("StormAudio returned non-JSON response") from e
        if body.get('ok') is True:
            return
        parser = body.get('parser', {})
        stdout = str(parser.get('stdout', ''))
        if IMPORT_SUCCESS_PATTERN.search(stdout):
            logger.warning("StormAudio import response indicated success with ok=false")
            return
        raise StormAudioError("StormAudio rejected MSO payload")

    def clear_filter(self, slot: str) -> None:
        self.__check_slot(slot)

        def __do_it():
            self._current_state.slot.clear()
            self._current_state.slot.active = True

        self._hydrate_cache_broadcast(__do_it)

    def load_biquads(self, slot: str, overwrite: bool, inputs: list[int], outputs: list[int],
                     biquads: list[dict]) -> None:
        raise NotImplementedError()

    def send_commands(self, slot: str, inputs: list[int], outputs: list[int], commands: list[str]) -> None:
        raise NotImplementedError()

    def mute(self, slot: str | None, channel: int | None) -> None:
        raise NotImplementedError()

    def unmute(self, slot: str | None, channel: int | None) -> None:
        raise NotImplementedError()

    def set_gain(self, slot: str | None, channel: int | None, gain: float) -> None:
        raise NotImplementedError()

    def levels(self) -> dict:
        return {}

    @staticmethod
    def __check_slot(slot: str) -> None:
        if slot != SLOT_ID:
            raise InvalidRequestError(f"Unknown StormAudio slot {slot}")


class RatioConfig:

    def __init__(self, cfg: dict):
        cfg = cfg or {}
        default_cfg = cfg.get('default', {})
        self.__default_gain = self.__validate_ratio(default_cfg.get('gain', 1.0), 'default gain', False)
        self.__default_q = self.__validate_ratio(default_cfg.get('q', 1.0), 'default q', True)
        self.__by_type = {}
        for filter_type, values in cfg.get('byType', {}).items():
            if filter_type not in FILTER_TYPE_MAP:
                raise ValueError(f"Unknown StormAudio ratio filter type {filter_type}")
            self.__by_type[filter_type] = {
                'gain': self.__validate_ratio(values.get('gain', self.__default_gain), f'{filter_type} gain', False),
                'q': self.__validate_ratio(values.get('q', self.__default_q), f'{filter_type} q', True),
            }

    @staticmethod
    def __validate_ratio(value, label: str, strict_positive: bool) -> float:
        value = float(value)
        if strict_positive and value <= 0:
            raise ValueError(f"StormAudio ratio {label} must be greater than 0")
        if not strict_positive and value < 0:
            raise ValueError(f"StormAudio ratio {label} must be greater than or equal to 0")
        return value

    def for_type(self, filter_type: str) -> tuple[float, float]:
        values = self.__by_type.get(filter_type, {})
        return values.get('gain', self.__default_gain), values.get('q', self.__default_q)

    def as_dict(self) -> dict:
        return {
            'default': {
                'gain': self.__default_gain,
                'q': self.__default_q,
            },
            'byType': self.__by_type,
        }


def make_mso_payload(
        entry: CatalogueEntry,
        profile_name: str,
        sub_count: int,
        ratio: RatioConfig,
        mv_adjust: float = 0.0,
) -> dict:
    eq = [convert_filter(idx, f, ratio) for idx, f in enumerate(entry.filters)]
    if len(eq) > MAX_FILTERS:
        raise InvalidRequestError(f"StormAudio supports at most {MAX_FILTERS} MSO filters")
    return {
        'global': {
            'profile_name': profile_name,
            'beq_title': entry.formatted_title,
            'beq_year': entry.year,
            'beq_audioTypes': entry.audio_types,
            'beq_author': entry.author,
            'beq_digest': entry.digest,
            'beq_mv': entry.mv_adjust + mv_adjust,
            'beq_catalogue_url': entry.catalogue_url,
            'beq_ratio': ratio.as_dict(),
        },
        'Sub': [{'eq': list(eq)} for _ in range(sub_count)]
    }


def convert_filter(idx: int, f: dict, ratio: RatioConfig) -> dict:
    filter_type = f.get('type')
    if filter_type not in FILTER_TYPE_MAP:
        raise InvalidRequestError(f"StormAudio does not support filter type {filter_type} at index {idx}")
    gain_ratio, q_ratio = ratio.for_type(filter_type)
    try:
        freq = float(f['freq'])
        gain = float(f['gain'])
        q = float(f['q'])
    except (KeyError, TypeError, ValueError) as e:
        raise InvalidRequestError(f"StormAudio filter {idx} has invalid values") from e
    converted = {
        'ftype': FILTER_TYPE_MAP[filter_type],
        'f': freq,
        'g': gain * gain_ratio,
        'q': q * q_ratio,
    }
    validate_filter(idx, converted)
    return converted


def validate_filter(idx: int, f: dict) -> None:
    if not 1 <= f['f'] <= 20000:
        raise InvalidRequestError(f"StormAudio filter {idx} frequency {f['f']} is out of range")
    if not -96 <= f['g'] <= 48:
        raise InvalidRequestError(f"StormAudio filter {idx} gain {f['g']} is out of range")
    if not 0.05 <= f['q'] <= 32:
        raise InvalidRequestError(f"StormAudio filter {idx} q {f['q']} is out of range")


class StormAudioError(Exception):
    pass
