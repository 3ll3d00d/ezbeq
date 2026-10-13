"""ezBEQ ShakEQ adapter using an independent ShakEQ HTTP service.

No serial access, console routes, or dependency on the service's Python code.
"""
import json
import math
import threading
import urllib.error
import urllib.request
from pathlib import Path
from urllib.parse import quote, urlsplit

from ezbeq.catalogue import CatalogueEntry, CatalogueProvider
from ezbeq.device import (
    DeviceState,
    InvalidRequestError,
    PersistentDevice,
    SlotState,
    UnableToPatchDeviceError,
)


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return None


SLOT_ID = 'BEQ'
FILTER_TYPES = frozenset({'PeakingEQ', 'LowShelf'})


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

    def serialise(self) -> dict:
        return {'type': 'shakeq', 'name': self.name, 'slots': [self.slot.as_dict()],
                'stateSource': 'service', 'status': self.status, 'beq': self.entry,
                'consoleBusy': getattr(self, 'console_busy', False),
                'serviceOnline': getattr(self, 'service_online', False)}


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
        token_path = Path(token_path).expanduser()
        if not token_path.is_absolute():
            token_path = Path(config_path)/token_path
        self.__token = token_path.read_text().strip()
        if len(self.__token) < 32:
            raise ValueError('Invalid ShakEQ service token')
        self.__timeout = float(cfg.get('requestTimeout', 120))
        self.__state_timeout = float(cfg.get('stateTimeout', 2))
        if any(not math.isfinite(t) or t <= 0 for t in (self.__timeout, self.__state_timeout)):
            raise ValueError('ShakEQ HTTP timeouts must be finite and positive')
        self.__catalogue = catalogue
        self.__lock = threading.RLock()
        self.__opener = urllib.request.build_opener(urllib.request.ProxyHandler({}), NoRedirect())

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
        headers = {'Authorization': 'Bearer '+self.__token, 'Accept': 'application/json'}
        data = None
        if body is not None:
            data = json.dumps(body, allow_nan=False).encode()
            headers['Content-Type'] = 'application/json'
        req = urllib.request.Request(self.__url+'/'+route, data=data, headers=headers)
        try:
            with self.__opener.open(req, timeout=self.__state_timeout if body is None else self.__timeout) as response:
                result = json.loads(response.read(262145))
        except urllib.error.HTTPError as exc:
            if exc.code == 423:
                self._current_state.console_busy = True
                raise InvalidRequestError('ShakEQ console is busy; BEQ deferred') from None
            raise OSError(f'ShakEQ service returned HTTP {exc.code}; no automatic replay') from None
        except (urllib.error.URLError, TimeoutError) as exc:
            raise OSError('ShakEQ service unavailable or timed out; no automatic replay') from exc
        if not isinstance(result, dict) or result.get('type') != 'shakeq' or result.get('name') != self.name or result.get('status') not in ('sent', 'unknown'):
            raise OSError('Invalid ShakEQ service response')
        slots = result.get('slots')
        if not isinstance(slots, list) or len(slots) != 1 or not isinstance(slots[0], dict) or slots[0].get('id') != SLOT_ID:
            raise OSError('Invalid ShakEQ service slot')
        return result

    def __adopt(self, snapshot):
        self._current_state.slot.merge_with(snapshot['slots'][0])
        self._current_state.slot.active = True
        self._current_state.entry = snapshot.get('beq')
        self._current_state.status = snapshot['status']
        self._current_state.console_busy = bool(snapshot.get('consoleBusy'))
        self._current_state.service_online = True

    def state(self, refresh=False):
        # This only reads HTTP service memory, never UART/device status.
        with self.__lock:
            self._hydrate(refresh=refresh)
            before = self._current_state.serialise()
            try:
                self.__adopt(self.__request('state'))
            except (OSError, ValueError, TypeError, KeyError):
                self._current_state.status = 'unknown'
                self._current_state.service_online = False
                self._current_state.console_busy = False
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
            try:
                snapshot = self.__request('beq', body)
                if snapshot['status'] != 'sent':
                    raise OSError('ShakEQ service did not confirm completion')
                actual = snapshot.get('beq')
                if body['action'] == 'load':
                    if not isinstance(actual, dict) or actual.get('digest') != body['entry']['digest']:
                        raise OSError('ShakEQ service confirmed a different BEQ')
                elif actual is not None:
                    raise OSError('ShakEQ service did not confirm clear')
                self.__adopt(snapshot)
            except InvalidRequestError:
                # A reserved console connection has not changed the device.
                raise
            except Exception:
                self._current_state.slot.last = 'ERROR'
                self._current_state.slot.last_author = None
                self._current_state.entry = None
                self._current_state.status = 'unknown'
                self._current_state.service_online = False
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
