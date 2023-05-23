import json
import logging
from typing import List, Optional, Callable

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


class CamillaDspState(DeviceState):

    def __init__(self, name: str):
        self.__name = name
        self.slot = CamillaDspSlotState()
        self.slot.active = True

    def serialise(self) -> dict:
        return {
            'name': self.__name,
            'slots': [self.slot.as_dict()]
        }


class CamillaDsp(PersistentDevice[CamillaDspState]):

    def __init__(self, name: str, config_path: str, cfg: dict, ws_server: WsServer, catalogue: CatalogueProvider):
        super().__init__(config_path, name, ws_server)
        self.__name = name
        self.__catalogue = catalogue
        self.__ip: str = cfg['ip']
        self.__port: int = cfg['port']
        self.__channels: List[int] = [int(c) for c in cfg['channels']]
        self.__config_loader: Optional[LoadConfig] = None
        if not self.__channels:
            raise ValueError(f'No channels supplied for CamillaDSP {name} - {self.__ip}:{self.__port}')
        self.__client = CamillaDspClient(self.__ip, self.__port, self)

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
        any_update = False
        if 'slots' in params:
            for slot in params['slots']:
                if slot['id'] == SLOT_ID:
                    if 'entry' in slot:
                        if slot['entry']:
                            match = self.__catalogue.find(slot['entry'])
                            if match:
                                self.load_filter(SLOT_ID, match)
                                any_update = True
                        else:
                            self.clear_filter(SLOT_ID)
                            any_update = True
        return any_update

    def __send(self, to_load: List[dict], title: str, on_complete: Callable[[bool], None]):
        if self.__config_loader is None:
            logger.info(f"Sending {len(to_load)} filters for {title}")
            self.__config_loader = LoadConfig(title, self.__channels, to_load, self.ws_server, self.__client,
                                              on_complete)
            from twisted.internet import reactor
            reactor.callLater(0.0, self.__config_loader.send_get_config)
        else:
            raise ValueError(f'Unable to load PEQ, load already in progress for {self.__config_loader.title}')

    def activate(self, slot: str) -> None:
        def __do_it():
            self._current_state.slot.active = True

        self._hydrate_cache_broadcast(__do_it)

    def load_biquads(self, slot: str, overwrite: bool, inputs: List[int], outputs: List[int],
                     biquads: List[dict]) -> None:
        raise NotImplementedError()

    def send_commands(self, slot: str, inputs: List[int], outputs: List[int], commands: List[str]) -> None:
        raise NotImplementedError()

    def load_filter(self, slot: str, entry: CatalogueEntry) -> None:
        self._hydrate_cache_broadcast(lambda: self.__do_it(entry.filters, entry.formatted_title))

    def __do_it(self, to_load: List[dict], title: str):
        try:
            self._current_state.slot.last = 'Loading' if to_load else 'Clearing'

            def completed(success: bool):
                if success:
                    self._current_state.slot.last = title
                else:
                    self._current_state.slot.last = 'ERROR'

            self.__send(to_load, title, lambda b: self._hydrate_cache_broadcast(lambda: completed(b)))
        except Exception as e:
            self._current_state.slot.last = 'ERROR'
            raise e

    def clear_filter(self, slot: str) -> None:
        self._hydrate_cache_broadcast(lambda: self.__do_it([], 'Empty'))

    def mute(self, slot: Optional[str], channel: Optional[int]) -> None:
        raise NotImplementedError()

    def unmute(self, slot: Optional[str], channel: Optional[int]) -> None:
        raise NotImplementedError()

    def set_gain(self, slot: Optional[str], channel: Optional[int], gain: float) -> None:
        raise NotImplementedError()

    def levels(self) -> dict:
        # TODO implement
        return {}

    def on_get_config(self, config: dict):
        if self.__config_loader is None:
            logger.info(f'Received new DSP config but nothing to load, ignoring {config}')
        else:
            if config['result'] == 'Ok':
                self.__config_loader.on_get_config(json.loads(config['value']))
            else:
                self.__config_loader.failed('GetConfig', config)
                self.__config_loader = None

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
        pass

    def on_get_mute(self, msg):
        pass

    def on_get_playback_rms(self, msg):
        pass

    def on_get_playback_peak(self, msg):
        pass


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
                elif 'GetMute' in msg:\
                    self.factory.listener.on_get_mute(msg['GetMute'])
                elif 'GetPlaybackSignalRms' in msg:
                    self.factory.listener.on_get_playback_rms(msg['GetPlaybackSignalRms'])
                elif 'GetPlaybackSignalPeak' in msg:
                    self.factory.listener.on_get_playback_rms(msg['GetPlaybackSignalPeak'])
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


def create_new_cfg(to_load: List[dict], base_cfg: dict, channels: List[int]) -> dict:
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
                'type': 'Lowshelf' if peq['type'] == 'LowShelf' else 'Highshelf' if peq['type'] == 'HighShelf' else 'Peaking',
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
        for channel in channels:
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
        raise ValueError(f'Unable to load PEQ, dsp config has no pipeline declared')
    return new_cfg


class LoadConfig:

    def __init__(self, title: str, channels: List[int], to_load: List[dict], ws_server: WsServer,
                 client: CamillaDspClient, on_complete: Callable[[bool], None]):
        self.title = title
        self.__channels = channels
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
        new_cfg = create_new_cfg(self.__to_load, self.__dsp_config, self.__channels)
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
