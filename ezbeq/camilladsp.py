import json
import logging
import math
import time
from typing import List, Optional, Callable, Union, Tuple, Dict

from autobahn.exception import Disconnected
from autobahn.twisted.websocket import connectWS, WebSocketClientProtocol, WebSocketClientFactory
from twisted.internet.protocol import ReconnectingClientFactory

from ezbeq.apis.ws import WsServer
from ezbeq.catalogue import CatalogueProvider, CatalogueEntry
from ezbeq.device import SlotState, DeviceState, PersistentDevice

SLOT_ID = 'CamillaDSP'

logger = logging.getLogger('ezbeq.camilladsp')


class CamillaDspSlotState(SlotState):

    def __init__(self):
        super().__init__(SLOT_ID)
        self.gains_by_channel: Dict[str, float] = {}

    def as_dict(self) -> dict:
        return {
            **super().as_dict(),
            'gains': self.gains_by_channel
        }


class CamillaDspState(DeviceState):

    def __init__(self, name: str):
        self.__name = name
        self.has_volume = False
        self.slot = CamillaDspSlotState()
        self.slot.active = True
        self.master_volume: float = 0.0
        self.mute: bool = False

    def serialise(self) -> dict:
        val = {
            'type': 'camilladsp',
            'name': self.__name,
            'mute': self.mute,
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
        self.__input_gains: Optional[Tuple[str, List[int]]] = self.__extract_input_gains(cfg)
        self.__current_config: dict = {}
        self.__levels_interval_ms = round(1000.0 / float(cfg.get('levelsFps', 10)))
        self.__config_loader: Optional[LoadConfig] = None
        if not self.__beq_channels:
            raise ValueError(f'No channels supplied for CamillaDSP {name} - {self.__ip}:{self.__port}')
        self.__ws_client = CamillaDspClient(self.__ip, self.__port, self)
        self.__playback_peak: float = 0.0
        self.__playback_rms: float = 0.0
        ws_server.factory.set_levels_provider(name, self.start_broadcast_levels)

    @staticmethod
    def __extract_input_gains(cfg) -> Optional[Tuple[str, List[int]]]:
        input_gains = cfg.get('input_gains', {})
        return (input_gains['mixer'], [int(c) for c in input_gains['channels']]) if 'input_gains' in cfg else None

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

            if self.__input_gains and 'mixers' in cfg:
                mixer_cfg = cfg['mixers'].get(self.__input_gains[0], None)
                gains = {}
                if mixer_cfg:
                    for mapping in mixer_cfg['mapping']:
                        for source in mapping['sources']:
                            if source['channel'] in self.__input_gains[1]:
                                gains[str(source['channel'])] = source.get('gain', 0.0)
                self._current_state.slot.gains_by_channel = gains

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
        if 'slots' in cached:
            for slot in cached['slots']:
                if 'id' in slot:
                    if slot['id'] == SLOT_ID:
                        if slot['last']:
                            loaded.slot.last = slot['last']
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
                                        mv = float(slot['gains'][0])
                                    self.load_filter(SLOT_ID, match, mv)
                                    any_update = True
                            else:
                                self.clear_filter(SLOT_ID)
                                any_update = True
                        if 'mutes' in slot and slot['mutes']:
                            if slot['mutes'][0] is True:
                                self.mute(None, None)
                            else:
                                self.unmute(None, None)
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

    def __send_filter(self, to_load: List[dict], title: str, mv_adjust: float, on_complete: Callable[[bool], None]):
        if self.__config_loader is None:
            logger.info(f"Sending {len(to_load)} filters for {title}")
            self.__config_loader = LoadConfig(title, self.__beq_channels, mv_adjust, self.__input_gains, to_load,
                                              self.ws_server, self.__ws_client, on_complete)
            from twisted.internet import reactor
            reactor.callLater(0.0, self.__config_loader.send_get_config)
        else:
            raise ValueError(f'Unable to load BEQ, load already in progress for {self.__config_loader.title}')

    def __send_command(self, set_cmd: str, value: Union[float, bool]):
        logger.info(f"Sending command {set_cmd}: {value}")
        self.__ws_client.send(json.dumps({set_cmd: value}))

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
        self._hydrate_cache_broadcast(lambda: self.__do_load_filter(entry.filters, entry.formatted_title, mv_adjust))

    def __do_load_filter(self, to_load: List[dict], title: str, mv_adjust: float = 0.0):
        try:
            self._current_state.slot.last = 'Loading' if to_load else 'Clearing'

            def completed(success: bool):
                if success:
                    self._current_state.slot.last = title
                else:
                    self._current_state.slot.last = 'ERROR'

            self.__send_filter(to_load, title, mv_adjust, lambda b: self._hydrate_cache_broadcast(lambda: completed(b)))
        except Exception as e:
            self._current_state.slot.last = 'ERROR'
            raise e

    def clear_filter(self, slot: str) -> None:
        self._hydrate_cache_broadcast(lambda: self.__do_load_filter([], 'Empty'))

    def mute(self, slot: Optional[str], channel: Optional[int]) -> None:
        self._hydrate_cache_broadcast(lambda: self.__do_mute_op(True))

    def __do_mute_op(self, mute: bool):
        try:
            self.__send_command('SetMute', mute)
        except Exception as e:
            raise e

    def unmute(self, slot: Optional[str], channel: Optional[int]) -> None:
        self._hydrate_cache_broadcast(lambda: self.__do_mute_op(False))

    def set_gain(self, slot: Optional[str], channel: Optional[int], gain: float) -> None:
        self._hydrate_cache_broadcast(lambda: self.__do_volume_op(gain))

    def __do_volume_op(self, level: float):
        try:
            self.__send_command('SetVolume', level)
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
        if config['result'] == 'Ok':
            new_config = json.loads(config['value'])
            self.current_config = new_config
            if self.__config_loader is None:
                logger.info(f'Received new DSP config but nothing to load, ignoring {new_config}')
            else:
                self.__config_loader.on_get_config(new_config)
        else:
            if self.__config_loader is not None:
                self.__config_loader.failed('GetConfig', config)
                self.__config_loader = None
            else:
                logger.warning(f'GetConfig failed :: {config}')

    def on_set_config(self, result: str):
        if self.__config_loader is None:
            logger.info(f'Received response to SetConfigJson but nothing to load, ignoring {result}')
        else:
            if result == 'Ok':
                self.__config_loader.on_set_config()
            else:
                self.__config_loader.failed('SetConfig', result)
                self.__config_loader = None

    def on_reload(self, result: str):
        if self.__config_loader is None:
            logger.info(f'Received response to Reload but nothing to load, ignoring {result}')
        else:
            if result == 'Ok':
                self.__config_loader.on_reload()
            else:
                self.__config_loader.failed('Reload', result)
            self.__config_loader = None

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
            self.__playback_rms = msg['value']
            self.ws_server.levels(self.name, self.levels())

    def on_get_playback_peak(self, msg):
        if msg['result'] == 'Ok':
            self.__playback_peak = msg['value']


class CamillaDspClient:

    def __init__(self, ip: str, port: int, listener):
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


def create_new_cfg(to_load: List[dict], base_cfg: dict, beq_channels: List[int], mv_adjust: float,
                   input_gains: Optional[Tuple[str, List[int]]]) -> dict:
    from copy import deepcopy
    new_cfg = deepcopy(base_cfg)
    if 'filters' not in new_cfg:
        new_cfg['filters'] = {}
    filters = new_cfg['filters']
    filter_names = []
    i = -1
    for i, peq in enumerate(to_load):
        name = f'BEQ{i}'
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
    for j in range(i + 1, 10):
        k = f'BEQ{j}'
        if k in filters:
            del filters[k]
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
            existing['names'] = [n for n in existing['names'] if re.match(r'^BEQ\d$', n) is None] + filter_names
    else:
        raise ValueError(f'Unable to load BEQ, dsp config has no pipeline declared')
    if input_gains and 'mixers' in new_cfg:
        mixer_name, input_channels = input_gains
        if mixer_name and input_channels:
            mixer_cfg = new_cfg['mixers'].get(mixer_name, None)
            if mixer_cfg:
                for mapping in mixer_cfg['mapping']:
                    for source in mapping['sources']:
                        for gain_channel in input_channels:
                            if source['channel'] == gain_channel:
                                source['gain'] = mv_adjust
            else:
                raise ValueError(f'Unable to load BEQ with MV adjustment, mixer {mixer_name} is required but not found in config')
    return new_cfg


def get_filter_type(peq):
    return 'Lowshelf' if peq['type'] == 'LowShelf' else 'Highshelf' if peq['type'] == 'HighShelf' else 'Peaking'


class LoadConfig:

    def __init__(self, title: str, beq_channels: List[int], mv_adjust: float,
                 input_gains: Optional[Tuple[str, List[int]]], to_load: List[dict], ws_server: WsServer,
                 client: CamillaDspClient, on_complete: Callable[[bool], None]):
        self.title = title
        self.__mv_adjust = mv_adjust
        self.__input_gains = input_gains
        self.__beq_channels = beq_channels
        self.__to_load = to_load
        self.__dsp_config = None
        self.__ws_server = ws_server
        self.__client = client
        self.__failed = False
        self.__on_complete = on_complete

    def on_get_config(self, cfg: dict):
        logger.info(f"Received new DSP config {cfg}")
        self.__dsp_config = cfg
        self.__do_set_config()

    def send_get_config(self):
        logger.info(f'[{self.title}] Sending GetConfigJson')
        self.__client.send(json.dumps("GetConfigJson"))

    def __do_set_config(self):
        logger.info(f'[{self.title}] Sending SetConfigJson')
        new_cfg = create_new_cfg(self.__to_load, self.__dsp_config, self.__beq_channels, self.__mv_adjust, self.__input_gains)
        self.__client.send(json.dumps({'SetConfigJson': json.dumps(new_cfg)}))

    def on_set_config(self):
        logger.info(f'[{self.title}] Sending Reload')
        self.__client.send(json.dumps('Reload'))

    def on_reload(self):
        logger.info(f'[{self.title}] Reload completed')
        self.__on_complete(True)

    def failed(self, stage: str, payload):
        self.__failed = True
        msg = f'{stage} failed : {payload}'
        logger.warning(f'[{self.title}] {msg}')
        self.__on_complete(False)
        self.__ws_server.broadcast(json.dumps({'message': 'Error', 'data': msg}))
