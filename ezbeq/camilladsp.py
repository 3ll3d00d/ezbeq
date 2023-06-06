import json
import logging
import math
import time
from collections import defaultdict
from typing import List, Optional, Callable, Union, Dict

from autobahn.exception import Disconnected
from autobahn.twisted.websocket import connectWS, WebSocketClientProtocol, WebSocketClientFactory
from twisted.internet.protocol import ReconnectingClientFactory

from ezbeq.apis.ws import WsServer
from ezbeq.catalogue import CatalogueProvider, CatalogueEntry
from ezbeq.device import SlotState, DeviceState, PersistentDevice

BEQ_FILTER_NAME_PATTERN = r'^BEQ_(Gain_\d+|\d+_[a-zA-Z0-9]+)$'

SLOT_ID = 'CamillaDSP'

logger = logging.getLogger('ezbeq.camilladsp')


class CamillaDspSlotState(SlotState):

    def __init__(self):
        super().__init__(SLOT_ID)
        self.gains: List[dict] = []
        self.mutes: List[dict] = []

    def as_dict(self) -> dict:
        return {
            **super().as_dict(),
            'gains': self.gains,
            'mutes': self.mutes
        }


class CamillaDspState(DeviceState):

    def __init__(self, name: str):
        self.__name = name
        self.__has_volume = False
        self.slot = CamillaDspSlotState()
        self.slot.active = True
        self.master_volume: float = 0.0
        self.mute: bool = False

    @property
    def has_volume(self) -> bool:
        return self.__has_volume

    @has_volume.setter
    def has_volume(self, has_volume: bool):
        self.__has_volume = has_volume

    def serialise(self) -> dict:
        val = {
            'type': 'camilladsp',
            'name': self.__name,
            'mute': self.mute,
            'has_volume': self.has_volume,
            'slots': [self.slot.as_dict()]
        }
        if self.has_volume is True:
            val['masterVolume'] = self.master_volume
        return val


class CamillaDsp(PersistentDevice[CamillaDspState]):

    def __init__(self, name: str, config_path: str, cfg: dict, ws_server: WsServer, catalogue: CatalogueProvider):
        super().__init__(config_path, name, ws_server)
        self.__name = name
        self.__catalogue = catalogue
        self.__ip: str = cfg['ip']
        self.__port: int = cfg['port']
        self.__beq_channels: List[int] = [int(c) for c in cfg['channels']]
        self.__current_config: dict = {}
        self.__levels_interval_ms = round(1000.0 / float(cfg.get('levelsFps', 10)))
        self.__config_updater: Optional[UpdateConfig] = None
        if not self.__beq_channels:
            raise ValueError(f'No channels supplied for CamillaDSP {name} - {self.__ip}:{self.__port}')
        self.__ws_client = cfg['make_wsclient'](self.__ip, self.__port, self)
        self.__playback_peak: List[float] = []
        self.__playback_rms: List[float] = []
        ws_server.factory.set_levels_provider(name, self.start_broadcast_levels)

    @property
    def current_config(self) -> dict:
        return self.__current_config

    @current_config.setter
    def current_config(self, cfg: dict):
        self.__current_config = cfg

        def upd():
            prev = self._current_state.has_volume
            if 'filters' in cfg:
                vol_filter_name = next((k for k, v in cfg['filters'].items() if v['type'] == 'Volume'), None)
                if vol_filter_name and 'pipeline' in cfg:
                    self._current_state.has_volume = any(f for f in cfg['pipeline']
                                                         if f['type'] == 'Filter' and vol_filter_name in f['names'])
            if prev != self._current_state.has_volume:
                logger.info(f'[{self.name}] current config has volume filter? {self._current_state.has_volume}')

            if 'pipeline' in cfg:
                gains = [{'id': c, 'value': 0.0} for c in self.__beq_channels]
                mutes = [{'id': c, 'value': False} for c in self.__beq_channels]
                for k, v in cfg.get('filters', {}).items():
                    if k.startswith('BEQ_Gain_'):
                        channel = int(k[9:])
                        muted = v.get('mute', False)
                        gain = v.get('gain', 0.0)
                        if not math.isclose(gain, 0.0) or muted is True:
                            for f in cfg['pipeline']:
                                if f['type'] == 'Filter' and f['channel'] in self.__beq_channels and 'BEQ_Gain' in f['names']:
                                    next(g for g in gains if g['id'] == f['channel'])['value'] = gain
                                    next(g for g in mutes if g['id'] == f['channel'])['value'] = muted
                self._current_state.slot.gains = gains
                self._current_state.slot.mutes = mutes

        self._hydrate_cache_broadcast(upd)

    def start_broadcast_levels(self) -> None:
        from twisted.internet import reactor
        sched = lambda: reactor.callLater(self.__levels_interval_ms / 1000.0, __send)

        def __send():
            self.request_levels()
            if self.ws_server.has_levels_client(self.name):
                sched()

        sched()

    def _load_initial_state(self) -> CamillaDspState:
        return CamillaDspState(self.name)

    def _merge_state(self, loaded: CamillaDspState, cached: dict) -> CamillaDspState:
        if 'has_volume' in cached:
            loaded.has_volume = cached['has_volume']
        if 'masterVolume' in cached:
            loaded.master_volume = cached['masterVolume']
        if 'slots' in cached:
            for slot in cached['slots']:
                if 'id' in slot:
                    if slot['id'] == SLOT_ID:
                        if slot['last']:
                            loaded.slot.last = slot['last']
                        if slot['gains']:
                            loaded.slot.gains = slot['gains']
                        if slot['mutes']:
                            loaded.slot.mutes = slot['mutes']
        return loaded

    @property
    def device_type(self) -> str:
        return self.__class__.__name__.lower()

    def update(self, params: dict) -> bool:
        def __do_it() -> bool:
            any_update = False
            if 'slots' in params:
                for slot in params['slots']:
                    if slot['id'] == SLOT_ID:
                        if 'entry' in slot:
                            if slot['entry']:
                                match = self.__catalogue.find(slot['entry'])
                                if match:
                                    mv = 0.0
                                    if 'gains' in slot and slot['gains']:
                                        mv = float(slot['gains'][0]['value'])
                                    self.load_filter(SLOT_ID, match, mv)
                                    any_update = True
                            else:
                                self.clear_filter(SLOT_ID)
                                any_update = True
                        elif 'gains' in slot or 'mutes' in slot:
                            merged = defaultdict(dict)
                            for g in slot.get('gains', []):
                                c_id = int(g['id'])
                                if c_id in self.__beq_channels:
                                    merged[c_id]['gain'] = g['value']
                                else:
                                    raise ValueError(f'Invalid channel id for gain setting {c_id}')
                            for g in slot.get('mutes', []):
                                c_id = int(g['id'])
                                if c_id in self.__beq_channels:
                                    merged[c_id]['mute'] = g['value']
                                else:
                                    raise ValueError(f'Invalid channel id for gain setting {c_id}')

                            def completed(success: bool):
                                logger.log(logging.INFO if success else logging.WARNING,
                                           f'Completed gain update {success}')
                                if success:
                                    css = self._current_state.slot
                                    for k, v in merged.items():
                                        if 'gain' in v:
                                            to_update = next(g for g in css.gains if g['id'] == k)
                                            to_update['value'] = v['gain']
                                        if 'mute' in v:
                                            to_update = next(g for g in css.mutes if g['id'] == k)
                                            to_update['value'] = v['mute']

                            self.__update_channel_levels(merged,
                                                         lambda b: self._hydrate_cache_broadcast(lambda: completed(b)))
                            any_update = True
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

    def __update_channel_levels(self, values: Dict[int, dict], on_complete: Callable[[bool], None]):
        if self.__config_updater is None:
            logger.info(f"Sending {len(values)} level changes")
            self.__config_updater = UpdateGain(values, self.ws_server, self.__ws_client, on_complete)
            self.__config_updater.send_get_config()
        else:
            raise ValueError(f'Unable to load BEQ, config update already in progress for {self.__config_updater.name}')

    def __send_filter(self, entry: Optional[CatalogueEntry], mv_adjust: float, on_complete: Callable[[bool], None]):
        if self.__config_updater is None:
            if entry:
                logger.info(f"Sending {len(entry.filters)} filters for {entry.formatted_title}")
            else:
                logger.info(f"Clearing filters")
            self.__config_updater = LoadConfig(entry, self.__beq_channels, mv_adjust, self.ws_server, self.__ws_client,
                                               on_complete)
            self.__config_updater.send_get_config()
        else:
            raise ValueError(f'Unable to load BEQ, config update already in progress for {self.__config_updater.name}')

    def __send_command(self, set_cmd: str, value: Union[float, bool]):
        logger.info(f"Sending command {set_cmd}: {value}")
        # messages are guaranteed to be processed in order
        self.__ws_client.send(json.dumps({f'Set{set_cmd}': value}))
        self.__ws_client.send(json.dumps(f'Get{set_cmd}'))

    def activate(self, slot: str) -> None:
        def __do_it():
            self._current_state.slot.active = True

        self._hydrate_cache_broadcast(__do_it)

    def load_biquads(self, slot: str, overwrite: bool, inputs: List[int], outputs: List[int],
                     biquads: List[dict]) -> None:
        raise NotImplementedError()

    def send_commands(self, slot: str, inputs: List[int], outputs: List[int], commands: List[str]) -> None:
        raise NotImplementedError()

    def load_filter(self, slot: str, entry: CatalogueEntry, mv_adjust: float = 0.0) -> None:
        self._hydrate_cache_broadcast(lambda: self.__do_load_filter(entry, mv_adjust))

    def __do_load_filter(self, entry: Optional[CatalogueEntry], mv_adjust: float = 0.0):
        try:
            self._current_state.slot.last = 'Loading' if entry else 'Clearing'

            def completed(success: bool):
                if success:
                    self._current_state.slot.last = entry.formatted_title if entry else 'Empty'
                    for g in self._current_state.slot.gains:
                        g['value'] = mv_adjust
                    for g in self._current_state.slot.mutes:
                        g['value'] = False
                else:
                    self._current_state.slot.last = 'ERROR'

            self.__send_filter(entry, mv_adjust, lambda b: self._hydrate_cache_broadcast(lambda: completed(b)))
        except Exception as e:
            self._current_state.slot.last = 'ERROR'
            raise e

    def clear_filter(self, slot: str) -> None:
        self._hydrate_cache_broadcast(lambda: self.__do_load_filter(None))

    def mute(self, slot: Optional[str], channel: Optional[int]) -> None:
        self._hydrate_cache_broadcast(lambda: self.__do_mute_op(True))

    def __do_mute_op(self, mute: bool):
        try:
            self.__send_command('Mute', mute)
        except Exception as e:
            raise e

    def unmute(self, slot: Optional[str], channel: Optional[int]) -> None:
        self._hydrate_cache_broadcast(lambda: self.__do_mute_op(False))

    def set_gain(self, slot: Optional[str], channel: Optional[int], gain: float) -> None:
        if channel is None:
            self._hydrate_cache_broadcast(lambda: self.__do_volume_op(gain))
        else:
            self._hydrate_cache_broadcast(lambda: self.__do_gain_op(channel, gain))

    def __do_gain_op(self, channel: int, gain: float):
        pass

    def __do_volume_op(self, level: float):
        try:
            self.__send_command('Volume', level)
        except Exception as e:
            raise e

    def request_levels(self):
        self.__ws_client.send(json.dumps('GetPlaybackSignalPeak'))
        self.__ws_client.send(json.dumps('GetPlaybackSignalRms'))

    def levels(self) -> dict:
        return {
            'name': self.name,
            'ts': time.time(),
            'levels': self.__format_levels()
        }

    def __format_levels(self):
        return {
            **{f'RMS-{i}': v for i, v in enumerate(self.__playback_rms)},
            **{f'Peak-{i}': v for i, v in enumerate(self.__playback_peak)}
        }

    def on_open(self):
        self.__ws_client.send(json.dumps('GetConfigJson'))
        self.__ws_client.send(json.dumps('GetVolume'))
        self.__ws_client.send(json.dumps('GetMute'))
        self.__ws_client.send(json.dumps({'SetUpdateInterval': self.__levels_interval_ms}))

    def on_get_config(self, config: dict):
        if config.get('result', None) == 'Ok':
            new_config = json.loads(config['value'])
            self.current_config = new_config
            if self.__config_updater is None:
                logger.info(f'Received new DSP config but nothing to load, ignoring {new_config}')
            else:
                self.__config_updater.on_get_config(new_config)
        else:
            if self.__config_updater is not None:
                self.__config_updater.failed('GetConfig', config)
                self.__config_updater = None
            else:
                logger.warning(f'GetConfig failed :: {config}')

    def on_set_config(self, result: str):
        if self.__config_updater is None:
            logger.info(f'Received response to SetConfigJson but nothing to load, ignoring {result}')
        else:
            if result == 'Ok':
                self.__config_updater.on_set_config()
            else:
                self.__config_updater.failed('SetConfig', result)
                self.__config_updater = None

    def on_reload(self, result: str):
        if self.__config_updater is None:
            logger.info(f'Received response to Reload but nothing to load, ignoring {result}')
        else:
            if result == 'Ok':
                self.__config_updater.on_reload()
            else:
                self.__config_updater.failed('Reload', result)
            self.__config_updater = None

    def on_get_volume(self, msg):
        if msg['result'] == 'Ok':
            def do_it():
                self._current_state.master_volume = msg['value']

            self._hydrate_cache_broadcast(do_it)

    def on_set_volume(self, msg):
        if msg['result'] == 'Ok':
            self.__ws_client.send(json.dumps('GetVolume'))
        else:
            # TODO send to UI
            logger.warning(f'Unsuccessful command {msg}')

    def on_set_mute(self, msg):
        if msg['result'] == 'Ok':
            self.__ws_client.send(json.dumps('GetMute'))
        else:
            # TODO send to UI
            logger.warning(f'Unsuccessful command {msg}')

    def on_get_mute(self, msg):
        if msg['result'] == 'Ok':
            def do_it():
                self._current_state.mute = msg['value']

            self._hydrate_cache_broadcast(do_it)

    def on_get_playback_rms(self, msg):
        if msg['result'] == 'Ok':
            self.__playback_rms = [v if not math.isclose(v, -1000.0) else -144.0 for v in msg['value']]
            self.ws_server.levels(self.name, self.levels())

    def on_get_playback_peak(self, msg):
        if msg['result'] == 'Ok':
            self.__playback_peak = [v if not math.isclose(v, -1000.0) else -144.0 for v in msg['value']]


class CamillaDspClient:

    def __init__(self, ip: str, port: int, listener: CamillaDsp):
        self.__factory = CamillaDspClientFactory(listener, f"ws://{ip}:{port}")
        self.__connector = connectWS(self.__factory)

    def send(self, msg: str):
        self.__factory.broadcast(msg)


class CamillaDspProtocol(WebSocketClientProtocol):

    # do_send = None

    def onConnecting(self, transport_details):
        logger.info(f"Connecting to {transport_details}")

    def onConnect(self, response):
        logger.info(f"Connected to {response.peer}")

    def onOpen(self):
        logger.info("Connected to CAMILLADSP")
        self.factory.register(self)
        self.factory.listener.on_open()

    def onClose(self, was_clean, code, reason):
        # self.do_send = None
        if was_clean:
            logger.info(f"Disconnected code: {code} reason: {reason}")
        else:
            logger.warning(f"UNCLEAN! Disconnected code: {code} reason: {reason}")

    def onMessage(self, payload, is_binary):
        if is_binary:
            logger.warning(f"Received {len(payload)} bytes in binary payload, ignoring")
        else:
            try:
                msg: dict = json.loads(payload.decode('utf8'))
                logger.debug(f'>>> {msg}')
                if 'GetConfigJson' in msg:
                    self.factory.listener.on_get_config(msg['GetConfigJson'])
                elif 'SetConfigJson' in msg:
                    self.factory.listener.on_set_config(msg['SetConfigJson']['result'])
                elif 'Reload' in msg:
                    self.factory.listener.on_reload(msg['Reload']['result'])
                elif 'GetVolume' in msg:
                    self.factory.listener.on_get_volume(msg['GetVolume'])
                elif 'GetMute' in msg:
                    self.factory.listener.on_get_mute(msg['GetMute'])
                elif 'GetPlaybackSignalRms' in msg:
                    self.factory.listener.on_get_playback_rms(msg['GetPlaybackSignalRms'])
                elif 'GetPlaybackSignalPeak' in msg:
                    self.factory.listener.on_get_playback_peak(msg['GetPlaybackSignalPeak'])
            except:
                logger.exception(f'Unable to decode {len(payload)} bytes in text payload')


class CamillaDspClientFactory(WebSocketClientFactory, ReconnectingClientFactory):
    protocol = CamillaDspProtocol
    maxDelay = 5
    initialDelay = 0.5

    def __init__(self, listener: CamillaDsp, *args, **kwargs):
        super(CamillaDspClientFactory, self).__init__(*args, **kwargs)
        self.__clients: List[CamillaDspProtocol] = []
        self.listener: CamillaDsp = listener
        self.setProtocolOptions(version=13)

    def clientConnectionFailed(self, connector, reason):
        logger.warning(f"Client connection failed {reason} .. retrying ..")
        super().clientConnectionFailed(connector, reason)

    def clientConnectionLost(self, connector, reason):
        logger.warning(f"Client connection failed {reason} .. retrying ..")
        super().clientConnectionLost(connector, reason)

    def register(self, client: CamillaDspProtocol):
        if client not in self.__clients:
            logger.info(f"Registered device {client.peer}")
            self.__clients.append(client)
        else:
            logger.info(f"Ignoring duplicate device {client.peer}")

    def unregister(self, client: CamillaDspProtocol):
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
                    c.sendMessage(msg.encode('utf8'), isBinary=False)
                except Disconnected as e:
                    logger.exception(f"Failed to send to {c.peer}, discarding")
                    disconnected_clients.append(c)
            for c in disconnected_clients:
                self.unregister(c)
        else:
            raise ValueError(f"No devices connected, ignoring {msg}")


def create_cfg_for_entry(entry: Optional[CatalogueEntry], base_cfg: dict, beq_channels: List[int], mv_adjust: float,
                         mute: bool) -> dict:
    from copy import deepcopy
    new_cfg = deepcopy(base_cfg)
    beq_filters = entry.filters if entry else []
    filters = {k: v for k, v in new_cfg.get('filters', {}).items() if not k.startswith('BEQ_')}
    new_cfg['filters'] = filters
    filter_names = []
    gain_filter_names = {}
    if entry or not math.isclose(mv_adjust, 0.0) or mute is True:
        for c in beq_channels:
            name = f'BEQ_Gain_{c}'
            gain_filter_names[c] = name
            filters[name] = {
                'type': 'Gain',
                'parameters': {
                    'gain': mv_adjust,
                    'inverted': False,
                    'mute': mute
                }
            }
    for i, peq in enumerate(beq_filters):
        name = f'BEQ_{i}_{entry.digest}'
        filters[name] = {
            'type': 'Biquad',
            'parameters': {
                'type': get_filter_type(peq),
                'freq': peq['freq'],
                'q': peq['q'],
                'gain': peq['gain']
            }
        }
        filter_names.append(name)
    if 'pipeline' in new_cfg:
        pipeline = new_cfg['pipeline']
        for channel in beq_channels:
            empty_filter = {'type': 'Filter', 'channel': channel, 'names': []}
            existing = None
            for f in pipeline:
                if f['type'] == 'Filter' and f['channel'] == channel:
                    existing = f
            if existing is None:
                existing = empty_filter
                pipeline.append(existing)
            import re
            new_names = [n for n in existing['names'] if re.match(BEQ_FILTER_NAME_PATTERN, n) is None]
            if channel in gain_filter_names:
                new_names.append(gain_filter_names[channel])
            new_names.extend(filter_names)
            existing['names'] = new_names
    else:
        raise ValueError(f'Unable to load BEQ, dsp config has no pipeline declared')
    return new_cfg


def get_filter_type(peq):
    return 'Lowshelf' if peq['type'] == 'LowShelf' else 'Highshelf' if peq['type'] == 'HighShelf' else 'Peaking'


def create_cfg_for_gains(values: Dict[int, dict], base_cfg: dict) -> dict:
    from copy import deepcopy
    new_cfg = deepcopy(base_cfg)
    if 'filters' not in new_cfg:
        new_cfg['filters'] = {}
    for ch, v in values.items():
        gain_filter_name = f'BEQ_Gain_{ch}'
        gain_filter = new_cfg['filters'].get(gain_filter_name, None)
        if gain_filter is None:
            gain_filter = {
                'type': 'Gain',
                'parameters': {
                    'gain': v.get('gain', 0.0),
                    'inverted': False,
                    'mute': v.get('mute', False)
                }
            }
            new_cfg['filters'][gain_filter_name] = gain_filter
        else:
            if 'gain' in v:
                gain_filter['parameters']['gain'] = v['gain']
            if 'mute' in v:
                gain_filter['parameters']['mute'] = v['mute']

        if 'pipeline' in new_cfg:
            pipeline = new_cfg['pipeline']
            empty_filter = {'type': 'Filter', 'channel': ch, 'names': []}
            existing = next((f for f in pipeline if f['type'] == 'Filter' and f['channel'] == ch), None)
            if existing is None:
                existing = empty_filter
                pipeline.append(existing)
            import re
            if gain_filter_name not in existing['names']:
                insert_at = next((i for i, n in enumerate(existing['names']) if re.match(BEQ_FILTER_NAME_PATTERN, n) is not None), -1)
                if insert_at == -1:
                    existing['names'].append(gain_filter_name)
                else:
                    existing['names'].insert(insert_at, gain_filter_name)
        else:
            raise ValueError(f'Unable to load BEQ, dsp config has no pipeline declared')
    return new_cfg


class UpdateConfig:

    def __init__(self, name: str, create_cfg: Callable[[dict], dict], ws_server: WsServer, client: CamillaDspClient,
                 on_complete: Callable[[bool], None]):
        self.__name = name
        self.__create_cfg = create_cfg
        self.__dsp_config = None
        self.__ws_server = ws_server
        self.__client = client
        self.__failed = False
        self.__on_complete = on_complete

    @property
    def name(self):
        return self.__name

    def on_get_config(self, cfg: dict):
        logger.info(f"[{self.__name}] Received new DSP config {cfg}")
        self.__dsp_config = cfg
        self.__do_set_config()

    def send_get_config(self):
        logger.info(f'[{self.__name}] Sending GetConfigJson')
        self.__client.send(json.dumps("GetConfigJson"))

    def __do_set_config(self):
        logger.info(f'[{self.__name}] Sending SetConfigJson')
        self.__client.send(json.dumps({'SetConfigJson': json.dumps(self.__create_cfg(self.__dsp_config))}))

    def on_set_config(self):
        logger.info(f'[{self.__name}] Sending Reload')
        self.__client.send(json.dumps('Reload'))

    def on_reload(self):
        logger.info(f'[{self.__name}] Reload completed')
        self.__on_complete(True)

    def failed(self, stage: str, payload):
        self.__failed = True
        msg = f'{stage} failed : {payload}'
        logger.warning(f'[{self.__name}] Operation failed - {msg}')
        self.__on_complete(False)
        self.__ws_server.broadcast(json.dumps({'message': 'Error', 'data': msg}))


class LoadConfig(UpdateConfig):

    def __init__(self, entry: Optional[CatalogueEntry], beq_channels: List[int], mv_adjust: float, ws_server: WsServer,
                 client: CamillaDspClient, on_complete: Callable[[bool], None]):
        super().__init__(entry.formatted_title if entry else 'Clearing BEQ',
                         lambda base: create_cfg_for_entry(entry, base, beq_channels, mv_adjust, False),
                         ws_server, client, on_complete)


class UpdateGain(UpdateConfig):
    def __init__(self, values: Dict[int, dict], ws_server: WsServer, client: CamillaDspClient,
                 on_complete: Callable[[bool], None]):
        super().__init__('UpdateGain', lambda base: create_cfg_for_gains(values, base), ws_server, client, on_complete)
