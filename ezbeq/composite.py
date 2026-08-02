import copy
import logging
from collections.abc import Callable
from concurrent.futures import ThreadPoolExecutor, wait
from dataclasses import dataclass, field

from ezbeq.apis.ws import WsServer
from ezbeq.catalogue import CatalogueEntry, CatalogueProvider
from ezbeq.device import Device, DeviceState, PersistentDevice, UnableToPatchDeviceError

logger = logging.getLogger('ezbeq.composite')


@dataclass
class MemberSpec:
    """
    Per-member translation rules for a composite device. In mirror mode every
    member gets the default (identity) spec - commands are forwarded verbatim.
    In mapped mode a member can override how composite-level slot/channel ids
    map onto its own, opt out of ops it doesn't support, and add an extra
    gain trim on top of a catalogue entry's own mv_adjust.
    """
    slot_map: dict[str, str] = field(default_factory=dict)
    channel_map: dict[str, str] = field(default_factory=dict)
    skip_ops: set[str] = field(default_factory=set)
    mv_adjust: float = 0.0

    @property
    def inverse_slot_map(self) -> dict[str, str]:
        return {v: k for k, v in self.slot_map.items()}


class CompositeDeviceState(DeviceState):
    """
    A composite has no state of its own - it's entirely a reduction of its
    members' states. serialise() reuses the primary member's own serialise()
    output verbatim (so the generic frontend renders it exactly like any
    other device) and overlays a 'members' breakdown for introspection.
    """

    def __init__(self, name: str, primary_name: str, specs: dict[str, MemberSpec], member_states: dict[str, DeviceState]):
        self.name = name
        self.primary_name = primary_name
        self.specs = specs
        self.member_states = member_states

    def update_members(self, fresh_states: dict[str, DeviceState]) -> None:
        # merge, don't replace - a member that failed *this* read keeps
        # showing whatever state it last successfully reported.
        self.member_states.update(fresh_states)

    def serialise(self) -> dict:
        # normally the primary's own state; falls back to any member that has
        # ever reported one if the primary itself has never been reachable
        # (e.g. offline since ezbeq started) - degraded, but better than a
        # KeyError that would 500 the whole /api/2/devices listing.
        name_used = self.primary_name if self.primary_name in self.member_states \
            else next(iter(self.member_states), None)
        if name_used is None:
            raise RuntimeError(f"[{self.name}] no member has ever reported state")

        primary_serialised = dict(self.member_states[name_used].serialise())
        inverse_slot_map = self.specs[name_used].inverse_slot_map
        if 'slots' in primary_serialised:
            primary_serialised['slots'] = [
                {**slot, 'id': inverse_slot_map.get(slot['id'], slot['id'])}
                for slot in primary_serialised['slots']
            ]
        primary_serialised['type'] = 'composite'
        primary_serialised['name'] = self.name
        primary_serialised['members'] = {n: s.serialise() for n, s in self.member_states.items()}
        return primary_serialised


class CompositeDevice(PersistentDevice[CompositeDeviceState]):
    """
    Fans a single logical command out to N already-independently-working
    member devices, in parallel, best-effort (every reachable member is
    attempted even if another one fails).

    Config (see examples/ezbeq_composite.yml):
      devices:
        bass_array:
          type: composite
          mode: mirror              # or 'mapped'
          members: [sub1, sub2]     # mirror: list of same-type device names
          exposeMembers: false      # default: hide members from the selector
          primary: sub1             # mapped mode only, required
          cmdTimeout: 30            # seconds to wait for each member's op
    """

    def __init__(self, name: str, config_path: str, cfg: dict, ws_server: WsServer, catalogue: CatalogueProvider,
                 members: dict[str, Device]):
        super().__init__(config_path, name, ws_server)
        self.__catalogue = catalogue
        self.__members = members
        self.__expose_members = bool(cfg.get('exposeMembers', False))
        self.__timeout = cfg.get('cmdTimeout', 30)
        self.__specs = self.__build_specs(cfg)
        self.__primary_name = cfg.get('primary') or next(iter(members))
        self.__executor = ThreadPoolExecutor(max_workers=max(len(members), 1))

    def __build_specs(self, cfg: dict) -> dict[str, MemberSpec]:
        specs: dict[str, MemberSpec] = {}
        if cfg['mode'] == 'mirror':
            for name in self.__members:
                specs[name] = MemberSpec()
        else:
            overrides = cfg.get('members', {})
            for name in self.__members:
                o = overrides.get(name) or {}
                specs[name] = MemberSpec(
                    slot_map={str(k): str(v) for k, v in o.get('slotMap', {}).items()},
                    channel_map={str(k): str(v) for k, v in o.get('channelMap', {}).items()},
                    skip_ops=set(o.get('skipOps', [])),
                    mv_adjust=float(o.get('mvAdjust', 0.0))
                )
        return specs

    @property
    def device_type(self) -> str:
        return 'composite'

    @property
    def member_names(self) -> list[str]:
        return list(self.__members.keys())

    @property
    def expose_members(self) -> bool:
        return self.__expose_members

    def __translate_slot(self, member_name: str, slot: str | None) -> str | None:
        if slot is None:
            return None
        return self.__specs[member_name].slot_map.get(slot, slot)

    def __translate_channel(self, member_name: str, channel: int | None) -> int | None:
        if channel is None:
            return None
        mapped = self.__specs[member_name].channel_map.get(str(channel))
        return int(mapped) if mapped is not None else channel

    def __fan_out(self, op: str, call: Callable[[str, Device], None]) -> None:
        """
        Dispatches call to every member that hasn't opted out of op, in
        parallel, best-effort - every reachable member is attempted even if
        another one fails. self.__refresh_members() always runs afterwards
        (even on failure) so a partial failure doesn't leave the composite's
        own cached state stale for the members that did succeed.

        All members share a single self.__timeout deadline (via wait(), not
        a per-future fut.result(timeout=...) loop) - otherwise N members that
        each genuinely hang would take N * timeout to fail instead of ~timeout.
        """
        futures = {}
        for name, dev in self.__members.items():
            if op in self.__specs[name].skip_ops:
                continue
            futures[name] = self.__executor.submit(call, name, dev)
        errors: dict[str, Exception] = {}
        try:
            _done, not_done = wait(futures.values(), timeout=self.__timeout)
            for name, fut in futures.items():
                if fut in not_done:
                    logger.error(f"[{self.name}] member '{name}' timed out during {op} after {self.__timeout}s")
                    errors[name] = TimeoutError(f"no response within {self.__timeout}s")
                    continue
                exc = fut.exception()
                if exc is not None:
                    logger.error(f"[{self.name}] member '{name}' failed during {op}: {exc}", exc_info=exc)
                    errors[name] = exc
        finally:
            self.__refresh_members()
        if errors:
            detail = ', '.join(f"{n}: {e}" for n, e in errors.items())
            raise UnableToPatchDeviceError(f"[{self.name}] {op} failed on member(s): {detail}", invalid_request=False)

    def __read_all_states(self, refresh: bool) -> dict[str, DeviceState]:
        """
        Best-effort, parallel read of every member's own state - a member
        that fails or times out is simply omitted rather than blowing up the
        whole read, since one unreachable sub in an array shouldn't take down
        status reporting for the rest of the composite (or, via all_devices(),
        every other device in the /api/2/devices listing).
        """
        futures = {name: self.__executor.submit(dev.state, refresh=refresh) for name, dev in self.__members.items()}
        _done, not_done = wait(futures.values(), timeout=self.__timeout)
        states: dict[str, DeviceState] = {}
        for name, fut in futures.items():
            if fut in not_done:
                logger.warning(f"[{self.name}] member '{name}' state read timed out after {self.__timeout}s")
                continue
            exc = fut.exception()
            if exc is not None:
                logger.warning(f"[{self.name}] member '{name}' state read failed: {exc}", exc_info=exc)
                continue
            states[name] = fut.result()
        return states

    def __refresh_members(self) -> None:
        # merge, don't replace - a member that fails this particular read keeps
        # showing its last known state rather than vanishing from the composite.
        self._current_state.update_members(self.__read_all_states(refresh=False))

    def _load_initial_state(self) -> CompositeDeviceState:
        return CompositeDeviceState(self.name, self.__primary_name, self.__specs, self.__read_all_states(refresh=False))

    def _merge_state(self, loaded: CompositeDeviceState, cached: dict) -> CompositeDeviceState:
        # composite state is fully derived from its members on every load - there's
        # nothing of its own to merge back in from a cached copy.
        return loaded

    def state(self, refresh: bool = False) -> CompositeDeviceState:
        self._hydrate()
        self._current_state.update_members(self.__read_all_states(refresh=refresh))
        return self._current_state

    def activate(self, slot: str) -> None:
        def __do_it():
            self.__fan_out('activate', lambda name, dev: dev.activate(self.__translate_slot(name, slot)))

        self._hydrate_cache_broadcast(__do_it)

    def load_filter(self, slot: str, entry: CatalogueEntry, mv_adjust: float = 0.0) -> None:
        def __call(name: str, dev: Device):
            member_slot = self.__translate_slot(name, slot)
            spec = self.__specs[name]
            member_entry = entry
            if spec.mv_adjust:
                member_entry = copy.copy(entry)
                member_entry.mv_adjust = entry.mv_adjust + spec.mv_adjust
            dev.load_filter(member_slot, member_entry, mv_adjust)

        def __do_it():
            self.__fan_out('load_filter', __call)

        self._hydrate_cache_broadcast(__do_it)

    def load_biquads(self, slot: str, overwrite: bool, inputs: list[int], outputs: list[int],
                     biquads: list[dict]) -> None:
        def __do_it():
            self.__fan_out('load_biquads', lambda name, dev: dev.load_biquads(
                self.__translate_slot(name, slot), overwrite, inputs, outputs, biquads))

        self._hydrate_cache_broadcast(__do_it)

    def send_commands(self, slot: str, inputs: list[int], outputs: list[int], commands: list[str]) -> None:
        def __do_it():
            self.__fan_out('send_commands', lambda name, dev: dev.send_commands(
                self.__translate_slot(name, slot), inputs, outputs, commands))

        self._hydrate_cache_broadcast(__do_it)

    def clear_filter(self, slot: str) -> None:
        def __do_it():
            self.__fan_out('clear_filter', lambda name, dev: dev.clear_filter(self.__translate_slot(name, slot)))

        self._hydrate_cache_broadcast(__do_it)

    def mute(self, slot: str | None, channel: int | None) -> None:
        def __do_it():
            self.__fan_out('mute', lambda name, dev: dev.mute(
                self.__translate_slot(name, slot), self.__translate_channel(name, channel)))

        self._hydrate_cache_broadcast(__do_it)

    def unmute(self, slot: str | None, channel: int | None) -> None:
        def __do_it():
            self.__fan_out('unmute', lambda name, dev: dev.unmute(
                self.__translate_slot(name, slot), self.__translate_channel(name, channel)))

        self._hydrate_cache_broadcast(__do_it)

    def set_gain(self, slot: str | None, channel: int | None, gain: float) -> None:
        def __do_it():
            self.__fan_out('set_gain', lambda name, dev: dev.set_gain(
                self.__translate_slot(name, slot), self.__translate_channel(name, channel), gain))

        self._hydrate_cache_broadcast(__do_it)

    def update(self, params: dict) -> bool:
        def __do_it() -> bool:
            any_update = False
            if 'slots' in params:
                for slot in params['slots']:
                    any_update |= self.__update_slot(slot)
            if 'mute' in params:
                if params['mute']:
                    self.mute(None, None)
                else:
                    self.unmute(None, None)
                any_update = True
            if 'masterVolume' in params:
                self.set_gain(None, None, params['masterVolume'])
                any_update = True
            return any_update

        return self._hydrate_cache_broadcast(__do_it)

    def __update_slot(self, slot: dict) -> bool:
        any_update = False
        slot_id = slot['id']
        if 'gains' in slot:
            for gain in slot['gains']:
                self.set_gain(slot_id, int(gain['id']), gain['value'])
                any_update = True
        if 'mutes' in slot:
            for mute in slot['mutes']:
                if mute['value'] is True:
                    self.mute(slot_id, int(mute['id']))
                else:
                    self.unmute(slot_id, int(mute['id']))
                any_update = True
        if 'entry' in slot:
            if slot['entry']:
                match = self.__catalogue.find(slot['entry'])
                if not match:
                    raise UnableToPatchDeviceError(f'Unknown catalogue entry {slot["entry"]}', True)
                self.load_filter(slot_id, match)
            else:
                self.clear_filter(slot_id)
            any_update = True
        if 'active' in slot:
            self.activate(slot_id)
            any_update = True
        return any_update

    def levels(self) -> dict:
        result = {}
        for name, dev in self.__members.items():
            try:
                result[name] = dev.levels()
            except Exception:
                logger.exception(f"[{self.name}] Unable to get levels from member '{name}'")
        return result
