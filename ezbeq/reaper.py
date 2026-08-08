import logging
import time
import urllib.parse

import requests
from requests.adapters import HTTPAdapter
from urllib3.util import Retry

from ezbeq.apis.ws import WsServer
from ezbeq.catalogue import CatalogueEntry, CatalogueProvider
from ezbeq.device import DeviceState, PersistentDevice, SlotState

logger = logging.getLogger('ezbeq.reaper')

# The only filter types ezbeq's catalogue model produces (see ezbeq/iir.py).
# Mapping these to Pro-Q's band "Shape" values happens entirely on the Lua
# side (proq4_apply_filters.lua); this module just forwards the type string.
KNOWN_FILTER_TYPES = {'PeakingEQ', 'LowShelf', 'HighShelf'}


class ReaperSlotState(SlotState):

    def __init__(self):
        super().__init__('REAPER')


class ReaperState(DeviceState):

    def __init__(self, name: str):
        self.__name = name
        self.slot = ReaperSlotState()
        self.slot.active = True

    def serialise(self) -> dict:
        return {
            'type': 'reaper',
            'name': self.__name,
            'slots': [self.slot.as_dict()]
        }


class Reaper(PersistentDevice[ReaperState]):
    """
    Sends BEQ filters to a REAPER instance running FabFilter Pro-Q 4, via
    REAPER's built-in Web Control interface (Options > Preferences >
    Control/OSC/Web > "Web browser interface").

    This builds a flat-text payload (see __build_payload) and pushes it into
    REAPER's ExtState via the SET/EXTSTATE web control command
    (see __push_extstate). A companion ReaScript running inside REAPER
    (proq4_apply_filters.lua) polls that ExtState value and applies it to a
    Pro-Q 4 instance via TrackFX_SetParam - see that script for the
    Hz/dB/Q -> Pro-Q normalized-parameter conversion.

    Config (see examples/ezbeq_reaper.yml):
      devices:
        reaper1:
          type: reaper
          ip: 192.168.1.50:8080         # REAPER machine, Web Control port
          extstate_section: beqbridge   # optional, defaults shown
          extstate_key: filters         # optional, defaults shown
          timeout: 3                    # optional, HTTP timeout in seconds (applies per retry attempt)
    """
    SUPPORTED_OPS = frozenset({'activate', 'load_filter', 'clear_filter'})
    FIXED_SLOT_ID = 'REAPER'

    def __init__(self, name: str, config_path: str, cfg: dict, ws_server: WsServer, catalogue: CatalogueProvider):
        super().__init__(config_path, name, ws_server)
        self.__name = name
        self.__catalogue = catalogue
        self.__ip = cfg['ip']
        self.__section = cfg.get('extstate_section', 'beqbridge')
        self.__key = cfg.get('extstate_key', 'filters')
        self.__timeout = cfg.get('timeout', 3)

        # REAPER is typically on a different machine, so retry transient
        # network failures rather than failing a filter load outright.
        self.__session = requests.Session()
        retries = Retry(total=3, backoff_factor=0.1, status_forcelist=[500, 502, 503, 504])
        self.__session.mount('http://', HTTPAdapter(max_retries=retries))

    def _load_initial_state(self) -> ReaperState:
        return ReaperState(self.name)

    def _merge_state(self, loaded: ReaperState, cached: dict) -> ReaperState:
        if 'slots' in cached:
            for slot in cached['slots']:
                if slot.get('id') == 'REAPER':
                    if slot.get('last'):
                        loaded.slot.last = slot['last']
                    if slot.get('author'):
                        loaded.slot.last_author = slot['author']
        return loaded

    @property
    def device_type(self) -> str:
        return self.__class__.__name__.lower()

    def update(self, params: dict) -> bool:
        any_update = False
        if 'slots' in params:
            for slot in params['slots']:
                if slot['id'] == 'REAPER' and 'entry' in slot:
                    if slot['entry']:
                        match = self.__catalogue.find(slot['entry'])
                        if match:
                            self.load_filter('REAPER', match)
                            any_update = True
                    else:
                        self.clear_filter('REAPER')
                        any_update = True
        return any_update

    def activate(self, slot: str) -> None:
        def __do_it():
            self._current_state.slot.active = True

        self._hydrate_cache_broadcast(__do_it)

    def load_biquads(self, slot: str, overwrite: bool, inputs: list[int], outputs: list[int],
                     biquads: list[dict]) -> None:
        raise NotImplementedError()

    def send_commands(self, slot: str, inputs: list[int], outputs: list[int], commands: list[str]) -> None:
        raise NotImplementedError()

    def load_filter(self, slot: str, entry: CatalogueEntry, mv_adjust: float = 0.0) -> None:
        # DeviceRepository.load_filter() never forwards a real mv_adjust
        # value here (it doesn't accept one), so read it from the catalogue
        # entry directly rather than trusting the parameter.
        effective_mv_adjust = entry.mv_adjust

        def __do_it():
            try:
                self.__send(entry.filters, effective_mv_adjust)
                self._current_state.slot.last = entry.formatted_title
                self._current_state.slot.last_author = entry.author
            except Exception:
                self._current_state.slot.last = 'ERROR'
                self._current_state.slot.last_author = None
                raise

        self._hydrate_cache_broadcast(__do_it)

    def clear_filter(self, slot: str) -> None:
        def __do_it():
            try:
                self.__send_clear()
                self._current_state.slot.last = 'Empty'
                self._current_state.slot.last_author = None
            except Exception:
                self._current_state.slot.last = 'ERROR'
                self._current_state.slot.last_author = None
                raise

        self._hydrate_cache_broadcast(__do_it)

    def mute(self, slot: str | None, channel: int | None) -> None:
        raise NotImplementedError()

    def unmute(self, slot: str | None, channel: int | None) -> None:
        raise NotImplementedError()

    def set_gain(self, slot: str | None, channel: int | None, gain: float) -> None:
        raise NotImplementedError()

    def levels(self) -> dict:
        return {}

    def __build_payload(self, filters: list[dict], mv_adjust: float = 0.0) -> str:
        """
        Builds the flat-text payload proq4_apply_filters.lua parses on the
        REAPER side. Not JSON: REAPER's ReaScript Lua environment doesn't
        ship a JSON library by default.

        Format:
            version=<int, ms since epoch>
            mv=<float>
            band1 type=<str> freq=<float> gain=<float> q=<float> enabled=1
            band2 type=<str> freq=<float> gain=<float> q=<float> enabled=1
            ...
        """
        # Wall-clock derived so it keeps increasing across ezbeq restarts -
        # the Lua side detects new payloads via a simple "> last seen" check.
        version = int(time.time() * 1000)
        lines = [f"version={version}", f"mv={mv_adjust}"]
        for i, f in enumerate(filters, start=1):
            ftype = f.get('type', 'PeakingEQ')
            if ftype not in KNOWN_FILTER_TYPES:
                logger.warning(f"Unrecognised filter type '{ftype}' in filter {i}, sending as-is")
            lines.append(
                f"band{i} type={ftype} freq={f['freq']} gain={f['gain']} "
                f"q={f['q']} enabled=1"
            )
        return "\n".join(lines)

    def __send(self, filters: list[dict], mv_adjust: float = 0.0):
        payload = self.__build_payload(filters, mv_adjust)
        logger.info(f"Sending {len(filters)} filters to REAPER at {self.__ip} (mv_adjust={mv_adjust})")
        self.__push_extstate(payload)

    def __send_clear(self):
        version = int(time.time() * 1000)
        payload = f"version={version}\nclear=1"
        logger.info(f"Clearing filters on REAPER at {self.__ip}")
        self.__push_extstate(payload)

    def __push_extstate(self, payload: str):
        # safe='' also escapes '/' and '=' inside the payload (e.g. "freq=80")
        # so REAPER's request parser doesn't mistake them for path separators.
        encoded = urllib.parse.quote(payload, safe='')
        url = (
            f"http://{self.__ip}/_/"
            f"SET/EXTSTATE/{self.__section}/{self.__key}/{encoded}"
        )
        resp = self.__session.get(url, timeout=self.__timeout)
        resp.raise_for_status()
