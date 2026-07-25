import logging
import time
import urllib.parse

import requests
from requests.adapters import HTTPAdapter
from urllib3.util import Retry

from ezbeq.apis.ws import WsServer
from ezbeq.catalogue import CatalogueEntry, CatalogueProvider
from ezbeq.device import DeviceState, SlotState, PersistentDevice

logger = logging.getLogger('ezbeq.reaper')

# ezbeq's CatalogueEntry.filters carry a 'type' field using these exact
# literal strings - confirmed directly from source, not assumed:
#   - ezbeq/iir.py defines exactly three Biquad subclasses: PeakingEQ,
#     LowShelf, HighShelf.
#   - ezbeq/minidsp.py's filter-building code does `t = f['type']` and then
#     branches on `t == 'PeakingEQ'` / `'LowShelf'` / `'HighShelf'` - these
#     are literally the only three strings ezbeq's own code ever checks for.
# There is NO HighPass/LowPass/Notch filter type anywhere in ezbeq's model.
# The actual mapping from these strings to REAPER/Pro-Q-specific band
# "Shape" values is done entirely on the Lua side (proq4_apply_filters.lua)
# - this module only forwards the type string through as-is, unmodified, so
# it stays correct regardless of which REAPER-side EQ plugin/script consumes
# it (this module has already been repointed from ReaEQ -> ReEQ -> Pro-Q 4
# over the course of development without needing any changes here, since the
# type strings themselves never changed).
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

    High-level data flow:
      1. This class builds a small flat-text payload describing the filter
         set (see __build_payload) and HTTP GETs it to REAPER's Web Control
         endpoint, which stores it into REAPER's in-process ExtState memory
         via the SET/EXTSTATE command (see __push_extstate).
      2. A persistent ReaScript running inside REAPER itself
         (proq4_apply_filters.lua) polls that ExtState value on a timer,
         and when it changes, converts the real Hz/dB/Q values in the
         payload into Pro-Q 4's normalized 0..1 VST3 parameters (using
         curve formulas reverse-engineered from real REAPER API data - see
         that script's own extensive comments) and writes them via
         TrackFX_SetParam.

    Why not REAPER's native EQ scripting API (TrackFX_SetEQParam)? That API
    is specific to REAPER's own native ReaEQ plugin and does not recognize
    Pro-Q 4 at all (confirmed empirically - see proq4_dump.lua). Why not
    ReaEQ itself? It reliably crashed on sub-20Hz frequencies during
    development, which BEQ profiles can require. Why not the free JSFX
    "ReEQ" plugin (an earlier iteration of this integration)? It only
    exposes 5 automatable bands per instance, requiring multiple stacked
    instances to reach a usable band count; Pro-Q 4 offers 24 bands in a
    single instance.

    Config (see examples/ezbeq_reaper.yml):
      devices:
        reaper1:
          type: reaper
          ip: 192.168.1.50:8080         # REAPER machine, Web Control port
          extstate_section: beqbridge   # optional, defaults shown
          extstate_key: filters         # optional, defaults shown
          timeout: 3                    # optional, HTTP timeout in seconds (applies per retry attempt)
    """

    def __init__(self, name: str, config_path: str, cfg: dict, ws_server: WsServer, catalogue: CatalogueProvider):
        super().__init__(config_path, name, ws_server)
        self.__name = name
        self.__catalogue = catalogue
        self.__ip = cfg['ip']
        self.__section = cfg.get('extstate_section', 'beqbridge')
        self.__key = cfg.get('extstate_key', 'filters')
        self.__timeout = cfg.get('timeout', 3)

        # A plain requests.get() per call would fail outright on any
        # transient network hiccup (the NixOS<->Windows link is a real LAN
        # hop, not localhost, so brief drops/reboots/Wi-Fi blips are a
        # realistic occurrence over time). A Session with a Retry-backed
        # HTTPAdapter automatically retries on connection failures and on
        # the given HTTP status codes, with exponential-ish backoff between
        # attempts, before finally giving up and raising - meaningfully
        # more resilient than a one-shot request for a bridge component
        # that's expected to run unattended for long periods.
        self.__session = requests.Session()
        retries = Retry(
            total=3,                                   # up to 3 retry attempts beyond the initial try
            backoff_factor=0.1,                         # ~0.1s, 0.2s, 0.4s delays between retries
            status_forcelist=[500, 502, 503, 504],       # retry on these server-side error codes
        )
        self.__session.mount('http://', HTTPAdapter(max_retries=retries))

    def _load_initial_state(self) -> ReaperState:
        return ReaperState(self.name)

    def _merge_state(self, loaded: ReaperState, cached: dict) -> ReaperState:
        # Restores the last-known slot title/author from ezbeq's persisted
        # cache on startup, purely for UI display purposes (so the
        # dashboard shows what was last loaded even immediately after an
        # ezbeq restart, before any new filter load happens).
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
        # This is the actual entry point ezbeq's REST API / web UI calls
        # when a user picks a catalog entry (or clears one) for this device
        # from the dashboard - NOT load_filter()/clear_filter() directly.
        any_update = False
        if 'slots' in params:
            for slot in params['slots']:
                if slot['id'] == 'REAPER':
                    if 'entry' in slot:
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
        # IMPORTANT, non-obvious gotcha: the mv_adjust FUNCTION PARAMETER
        # here is NOT reliable and should not be trusted. ezbeq's actual
        # call dispatcher - DeviceRepository.load_filter() in
        # ezbeq/device.py, which is what the REST API really calls - never
        # passes a real value into this parameter; it always defaults to
        # 0.0 regardless of what the catalog entry actually specifies. This
        # is true for every device type in ezbeq, not just this one (grep
        # confirms no device anywhere in ezbeq reads entry.mv_adjust
        # normally, this parameter appears to be effectively vestigial in
        # the current codebase).
        #
        # The REAL mv_adjust value lives on entry.mv_adjust itself - parsed
        # directly from the BEQ catalog's "mv" key in ezbeq/catalogue.py's
        # CatalogueEntry.__init__. We read it from there explicitly instead
        # of trusting the parameter, which is why every method below takes
        # care to pass entry.mv_adjust (not the mv_adjust parameter) onward.
        effective_mv_adjust = entry.mv_adjust

        def __do_it():
            try:
                self.__send(entry.filters, effective_mv_adjust)
                self._current_state.slot.last = entry.formatted_title
                self._current_state.slot.last_author = entry.author
            except Exception as e:
                self._current_state.slot.last = 'ERROR'
                self._current_state.slot.last_author = None
                raise e

        self._hydrate_cache_broadcast(__do_it)

    def clear_filter(self, slot: str) -> None:
        def __do_it():
            try:
                self.__send_clear()
                self._current_state.slot.last = 'Empty'
                self._current_state.slot.last_author = None
            except Exception as e:
                self._current_state.slot.last = 'ERROR'
                self._current_state.slot.last_author = None
                raise e

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
        Builds the flat-text payload consumed by proq4_apply_filters.lua on
        the REAPER side. Deliberately NOT JSON: REAPER's ReaScript Lua
        environment doesn't ship a JSON library by default, and this format
        is trivially parsable with plain Lua string patterns, avoiding an
        extra dependency on the REAPER/Windows side entirely.

        Format:
            version=<int, ms since epoch>
            mv=<float>
            band1 type=<str> freq=<float> gain=<float> q=<float> enabled=1
            band2 type=<str> freq=<float> gain=<float> q=<float> enabled=1
            ...
        """
        # Monotonically increasing version derived from wall-clock time in
        # milliseconds (NOT a simple incrementing counter). This matters
        # because the Lua side's "has this changed since I last saw it"
        # comparison is a simple inequality check against the last version
        # it processed - a plain counter would RESET to 0/1 every time
        # ezbeq itself restarts, and could then compare as "older" than a
        # version the Lua script already processed in a previous ezbeq
        # session, causing a real update to be silently ignored. A
        # wall-clock-derived value only ever increases, so this failure
        # mode can't happen even across ezbeq restarts.
        version = int(time.time() * 1000)
        lines = [f"version={version}", f"mv={mv_adjust}"]
        for i, f in enumerate(filters, start=1):
            ftype = f.get('type', 'PeakingEQ')
            if ftype not in KNOWN_FILTER_TYPES:
                # Not fatal - forwarded as-is. The Lua side has its own
                # fallback (defaults to a parametric "Bell" band) so a
                # genuinely never-before-seen type string degrades
                # gracefully instead of breaking the whole filter load.
                logger.warning(f"Unrecognised filter type '{ftype}' in filter {i}, sending as-is - "
                                f"the Lua side will default to parametric if it doesn't recognise it either")
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
        # Same version scheme as __build_payload - see comment there.
        version = int(time.time() * 1000)
        payload = f"version={version}\nclear=1"
        logger.info(f"Clearing filters on REAPER at {self.__ip}")
        self.__push_extstate(payload)

    def __push_extstate(self, payload: str):
        """
        Pushes payload into REAPER's ExtState via its Web Control HTTP
        interface. section/key/value must all be urlencoded per REAPER's
        own web control documentation - urllib.parse.quote with safe=''
        ensures even characters like '/' and '=' inside the payload
        (present in e.g. "freq=80") get escaped, since those would
        otherwise be misinterpreted as URL path separators by REAPER's
        request parser.

        Uses self.__session (see __init__) rather than a bare
        requests.get(), so transient network failures are retried
        automatically instead of immediately raising - important since
        this HTTP call crosses a real LAN link (NixOS -> Windows), not
        localhost, and is expected to run unattended for long periods.
        """
        encoded = urllib.parse.quote(payload, safe='')
        url = (
            f"http://{self.__ip}/_/"
            f"SET/EXTSTATE/{self.__section}/{self.__key}/{encoded}"
        )
        resp = self.__session.get(url, timeout=self.__timeout)
        resp.raise_for_status()
