"""ezBEQ ShakEQ adapter using an independent ShakEQ HTTP service.

No serial access, console routes, or dependency on the service's Python code.
"""
import json
import logging
import math
import threading
import time
from copy import deepcopy
from pathlib import Path
from urllib.parse import quote, urlsplit

import requests

from ezbeq.catalogue import CatalogueEntry, CatalogueProvider
from ezbeq.device import (
    DeviceState,
    InvalidRequestError,
    PersistentDevice,
    SlotState,
    UnableToPatchDeviceError,
)

logger = logging.getLogger('ezbeq.shakeq')


class ShakEQBusyError(InvalidRequestError):
    """The service rejected the operation because the console owns the device."""


class ShakEQRejectedError(InvalidRequestError):
    """The service explicitly rejected an operation before hardware access."""


class ShakEQResponseError(OSError):
    """An HTTP response arrived, but does not confirm the hardware result."""


SLOT_ID = 'BEQ'
FILTER_TYPES = frozenset({'PeakingEQ', 'LowShelf'})
MAX_RESPONSE_BYTES = 1024 * 1024  # Independent service's maximum encoded snapshot.
STATE_CACHE_SECONDS = 2.0


def validate_filters(entry: CatalogueEntry) -> None:
    """Reject unsupported or invalid catalogue filters before any HTTP mutation."""
    if not isinstance(entry.filters, list) or not entry.filters:
        raise InvalidRequestError('An empty BEQ entry is not a clear command')
    for idx, filt in enumerate(entry.filters, 1):
        if not isinstance(filt, dict) or not isinstance(filt.get('type'), str):
            raise InvalidRequestError(f'Filter {idx}: invalid filter definition')
        if filt['type'] not in FILTER_TYPES:
            raise InvalidRequestError(f"Filter {idx}: unsupported ShakEQ type {filt['type']!r}")
        for key in ('freq', 'gain', 'q'):
            try:
                raw = filt[key]
                if isinstance(raw, bool):
                    raise TypeError('boolean')
                value = float(raw)
            except (KeyError, TypeError, ValueError, OverflowError) as exc:
                raise InvalidRequestError(f'Filter {idx}: invalid {key}') from exc
            if not math.isfinite(value) or (key != 'gain' and value <= 0):
                raise InvalidRequestError(f'Filter {idx}: invalid {key}')


class ShakEQState(DeviceState):
    def __init__(self, name: str):
        self.name = name
        self.slot = SlotState(SLOT_ID)
        self.slot.active = True
        self.entry: dict | None = None
        self.status = 'unknown'
        self.console_busy = False
        self.service_online = False

    def serialise(self) -> dict:
        return {'type': 'shakeq', 'name': self.name, 'slots': [self.slot.as_dict()],
                'stateSource': 'service', 'status': self.status, 'beq': self.entry,
                'consoleBusy': self.console_busy,
                'serviceOnline': self.service_online}


class ShakEQ(PersistentDevice[ShakEQState]):
    SUPPORTED_OPS = frozenset({'activate', 'load_filter', 'clear_filter'})
    FIXED_SLOT_ID = SLOT_ID

    def __init__(self, name, config_path, cfg, ws_server, catalogue: CatalogueProvider):
        super().__init__(config_path, name, ws_server)
        url = cfg.get('url')
        if not isinstance(url, str):
            raise TypeError('ShakEQ requires the independent service URL')
        parsed = urlsplit(url)
        if parsed.scheme not in ('http', 'https') or not parsed.hostname or parsed.username or parsed.password or parsed.query or parsed.fragment or parsed.path not in ('', '/'):
            raise ValueError('ShakEQ url must be an HTTP(S) service origin')
        self.__url = url.rstrip('/')+'/api/1/shakeq/'+quote(name, safe='')
        token_path = cfg.get('tokenFile')
        if not isinstance(token_path, str) or not token_path:
            raise ValueError('ShakEQ requires tokenFile')
        self.__token_path = Path(token_path).expanduser()
        if not self.__token_path.is_absolute():
            self.__token_path = Path(config_path)/self.__token_path
        self.__timeout = float(cfg.get('requestTimeout', 120))
        self.__state_timeout = float(cfg.get('stateTimeout', 2))
        if any(not math.isfinite(t) or t <= 0 for t in (self.__timeout, self.__state_timeout)):
            raise ValueError('ShakEQ HTTP timeouts must be finite and positive')
        self.__catalogue = catalogue
        self.__lock = threading.RLock()
        self.__session = requests.Session()
        self.__session.trust_env = False
        self.__next_state_check = 0.0

    @property
    def device_type(self):
        return 'shakeq'

    def _load_initial_state(self):
        return ShakEQState(self.name)

    def _merge_state(self, loaded, cached):
        for slot in cached.get('slots', []):
            if slot.get('id') == SLOT_ID:
                loaded.slot.merge_with(slot)
                loaded.slot.active = True
        loaded.entry = cached.get('beq')
        loaded.status = 'unknown'
        return loaded

    def __request(self, route, body=None):
        # Read lazily: an unavailable/rotated token must not prevent ezBEQ startup.
        token = self.__token_path.read_text().strip()
        if len(token) < 32 or not token.isascii() or any(c.isspace() for c in token):
            raise OSError('Invalid ShakEQ service token file')
        headers = {'Authorization': 'Bearer '+token, 'Accept': 'application/json'}
        try:
            with self.__session.request('GET' if body is None else 'POST', self.__url+'/'+route,
                                        headers=headers, json=body, stream=True, allow_redirects=False,
                                        timeout=self.__state_timeout if body is None else self.__timeout) as response:
                if response.status_code == 423:
                    raise ShakEQBusyError('ShakEQ console is busy; BEQ deferred')
                # Bound decoded bytes too, including compressed responses. Using
                # json.loads here avoids requests.json() buffering an unbounded body.
                chunks, size = [], 0
                for chunk in response.iter_content(8192):
                    size += len(chunk)
                    if size > MAX_RESPONSE_BYTES:
                        raise ShakEQResponseError('ShakEQ service response too large; no automatic replay')
                    chunks.append(chunk)
                raw = b''.join(chunks)
                if response.status_code != 200:
                    rejected = response.status_code in (401, 403, 404, 405, 413, 415)
                    if response.status_code in (400, 422):
                        # Older services could report 400 after a serial write.
                        try:
                            detail = json.loads(raw)
                            rejected = isinstance(detail, dict) and detail.get('applied') is False
                        except (ValueError, TypeError):
                            pass
                    message = f'ShakEQ service returned HTTP {response.status_code}; no automatic replay'
                    if rejected:
                        raise ShakEQRejectedError(message)
                    raise ShakEQResponseError(message)
                try:
                    result = json.loads(raw)
                except (ValueError, UnicodeError) as exc:
                    raise ShakEQResponseError('Invalid ShakEQ service JSON; no automatic replay') from exc
        except requests.RequestException as exc:
            raise OSError('ShakEQ service unavailable or timed out; no automatic replay') from exc
        if not isinstance(result, dict) or result.get('type') != 'shakeq' or result.get('name') != self.name or result.get('status') not in ('sent', 'unknown'):
            raise ShakEQResponseError('Invalid ShakEQ service response')
        if 'beq' not in result or (result['beq'] is not None and not isinstance(result['beq'], dict)):
            raise ShakEQResponseError('Invalid ShakEQ service BEQ state')
        slots = result.get('slots')
        if not isinstance(slots, list) or len(slots) != 1 or not isinstance(slots[0], dict) or slots[0].get('id') != SLOT_ID:
            raise ShakEQResponseError('Invalid ShakEQ service slot')
        return result

    def __adopt(self, snapshot):
        assert self._current_state is not None
        self._current_state.slot.merge_with(snapshot['slots'][0])
        self._current_state.slot.active = True
        self._current_state.entry = snapshot.get('beq')
        self._current_state.status = snapshot['status']
        self._current_state.console_busy = bool(snapshot.get('consoleBusy'))
        self._current_state.service_online = True

    def state(self, refresh=False):
        # This only reads HTTP service memory, never UART/device status.
        with self.__lock:
            # Repository list polls pass refresh=True too. Keep the same short
            # TTL/backoff for them, rather than resetting from disk or blocking
            # every poll behind another request to an unavailable service.
            self._hydrate()
            assert self._current_state is not None
            if time.monotonic() < self.__next_state_check:
                return self._current_state
            before = deepcopy(self._current_state.serialise())
            try:
                self.__adopt(self.__request('state'))
            except ShakEQBusyError:
                self._current_state.console_busy = True
                self._current_state.service_online = True
                logger.info('ShakEQ %s state is busy', self.name)
            except (OSError, InvalidRequestError, ValueError, TypeError, KeyError) as exc:
                self._current_state.status = 'unknown'
                self._current_state.service_online = isinstance(exc, (ShakEQResponseError, ShakEQRejectedError))
                self._current_state.console_busy = False
                logger.warning('Unable to refresh ShakEQ %s: %s', self.name, exc)
            finally:
                # Also back off after failures, so every device-list poll does
                # not wait for another unreachable-host timeout.
                self.__next_state_check = time.monotonic() + STATE_CACHE_SECONDS
            if before != self._current_state.serialise():
                self._persist()
                self._broadcast()
            return self._current_state

    @staticmethod
    def __check_slot(slot):
        if slot != SLOT_ID:
            raise InvalidRequestError(f'ShakEQ has one slot: {SLOT_ID}')

    def activate(self, slot):
        self.__check_slot(slot)
        with self.__lock:
            self._hydrate_cache_broadcast(lambda: None)

    def __transfer(self, body):
        def apply():
            assert self._current_state is not None
            try:
                snapshot = self.__request('beq', body)
                if snapshot['status'] != 'sent':
                    raise ShakEQResponseError('ShakEQ service did not confirm completion')
                actual = snapshot.get('beq')
                if body['action'] == 'load':
                    if not isinstance(actual, dict) or actual.get('id') != body['entry']['id'] or actual.get('digest') != body['entry']['digest']:
                        raise ShakEQResponseError('ShakEQ service confirmed a different BEQ')
                elif actual is not None:
                    raise ShakEQResponseError('ShakEQ service did not confirm clear')
                self.__adopt(snapshot)
                self.__next_state_check = time.monotonic() + STATE_CACHE_SECONDS
            except ShakEQBusyError:
                self._current_state.console_busy = True
                self._current_state.service_online = True
                self.__next_state_check = time.monotonic() + STATE_CACHE_SECONDS
                logger.info('ShakEQ %s BEQ operation deferred: console is busy', self.name)
                raise
            except ShakEQRejectedError:
                self._current_state.service_online = True
                self.__next_state_check = time.monotonic() + STATE_CACHE_SECONDS
                logger.warning('ShakEQ %s BEQ operation rejected', self.name, exc_info=True)
                raise
            except InvalidRequestError:
                raise
            except Exception as exc:
                self._current_state.slot.last = 'ERROR'
                self._current_state.slot.last_author = None
                self._current_state.entry = None
                self._current_state.status = 'unknown'
                self._current_state.service_online = isinstance(exc, ShakEQResponseError)
                self._current_state.console_busy = False
                self.__next_state_check = time.monotonic() + STATE_CACHE_SECONDS
                logger.exception('ShakEQ %s BEQ result is unconfirmed; no automatic replay', self.name)
                raise
        with self.__lock:
            self._hydrate_cache_broadcast(apply)

    def load_filter(self, slot, entry, mv_adjust=0.0):
        self.__check_slot(slot)
        validate_filters(entry)
        self.__transfer({'action': 'load', 'entry': {
            'id': entry.id, 'digest': entry.digest, 'title': entry.title,
            'author': entry.author, 'formatted_title': entry.formatted_title,
            'filters': entry.filters, 'mv_adjust': entry.mv_adjust,
        }})

    def clear_filter(self, slot):
        self.__check_slot(slot)
        self.__transfer({'action': 'clear'})

    def update(self, params: dict) -> bool:
        try:
            if set(params) - {'slots'}:
                raise InvalidRequestError('ShakEQ supports BEQ selection only')
            slots = params.get('slots', [])
            if len(slots) > 1:
                raise InvalidRequestError('ShakEQ accepts one slot update per request')
            for slot in slots:
                self.__check_slot(slot['id'])
                if set(slot) - {'id', 'entry', 'active'}:
                    raise InvalidRequestError('Unsupported ShakEQ slot control')
                if 'active' in slot and slot['active'] is not True:
                    raise InvalidRequestError('ShakEQ BEQ slot cannot be deactivated')
                if 'entry' in slot:
                    if slot['entry']:
                        entry = self.__catalogue.find(slot['entry'])
                        if not isinstance(entry, CatalogueEntry):
                            raise InvalidRequestError('No such BEQ entry')
                        self.load_filter(SLOT_ID, entry)
                    else:
                        self.clear_filter(SLOT_ID)
                    return True
                if slot.get('active'):
                    self.activate(SLOT_ID)
                    return True
            return False
        except (InvalidRequestError, KeyError, TypeError) as e:
            raise UnableToPatchDeviceError(str(e), True) from e
        except Exception as e:
            raise UnableToPatchDeviceError(str(e), False) from e

    def load_biquads(self, slot, overwrite, inputs, outputs, biquads):
        raise InvalidRequestError('ShakEQ accepts catalogue filters, not raw biquads')

    def send_commands(self, slot, inputs, outputs, commands):
        raise InvalidRequestError('Raw ShakEQ commands are not exposed')

    def mute(self, slot, channel):
        raise InvalidRequestError('ShakEQ mute is not supported by this adapter')

    def unmute(self, slot, channel):
        raise InvalidRequestError('ShakEQ mute is not supported by this adapter')

    def set_gain(self, slot, channel, gain):
        raise InvalidRequestError('Set listening volume using the ShakEQ console')

    def levels(self) -> dict:
        return {}
