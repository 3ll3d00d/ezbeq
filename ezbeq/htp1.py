import json
import logging
from typing import Optional, List

import semver
from autobahn.exception import Disconnected
from autobahn.twisted.websocket import WebSocketClientFactory, connectWS, WebSocketClientProtocol
from twisted.internet.protocol import ReconnectingClientFactory

from ezbeq.apis.ws import WsServer
from ezbeq.catalogue import CatalogueEntry, CatalogueProvider
from ezbeq.device import DeviceState, SlotState, PersistentDevice

logger = logging.getLogger('ezbeq.htp1')


class Htp1SlotState(SlotState):

    def __init__(self):
        super().__init__('HTP1')


class Htp1State(DeviceState):

    def __init__(self, name: str):
        self.__name = name
        self.slot = Htp1SlotState()
        self.slot.active = True

    def serialise(self) -> dict:
        return {
            'name': self.__name,
            'slots': [self.slot.as_dict()]
        }


class Htp1(PersistentDevice[Htp1State]):

    def __init__(self, name: str, config_path: str, cfg: dict, ws_server: WsServer, catalogue: CatalogueProvider):
        super().__init__(config_path, name, ws_server)
        self.__name = name
        self.__catalogue = catalogue
        self.__ip = cfg['ip']
        self.__channels = cfg['channels']
        self.__peq = {}
        self.__supports_shelf = True
        if not self.__channels:
            raise ValueError('No channels supplied for HTP-1')
        self.__client = Htp1Client(self.__ip, self)

    def _load_initial_state(self) -> Htp1State:
        return Htp1State(self.name)

    def _merge_state(self, loaded: Htp1State, cached: dict) -> Htp1State:
        if 'slots' in cached:
            for slot in cached['slots']:
                if 'id' in slot:
                    if slot['id'] == 'HTP1':
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
                if slot['id'] == 'HTP1':
                    if 'entry' in slot:
                        if slot['entry']:
                            match = self.__catalogue.find(slot['entry'])
                            if match:
                                self.load_filter('HTP1', match)
                                any_update = True
                        else:
                            self.clear_filter('HTP1')
                            any_update = True
        return any_update

    def __send(self, to_load: List['PEQ']):
        logger.info(f"Sending {len(to_load)} filters")
        while len(to_load) < 16:
            peq = PEQ(len(to_load), fc=100, q=1, gain=0, filter_type_name='PeakingEQ')
            to_load.append(peq)
        ops = [peq.as_ops(c, use_shelf=self.__supports_shelf) for peq in to_load for c in self.__peq.keys()]
        ops = [op for slot_ops in ops for op in slot_ops if op]
        if ops:
            self.__client.send('changemso [{"op":"replace","path":"/peq/peqsw","value":true}]')
            self.__client.send(f"changemso {json.dumps(ops)}")
        else:
            logger.warning(f"Nothing to send")

    def activate(self, slot: str) -> None:
        def __do_it():
            self._current_state.slot.active = True
        self._hydrate_cache_broadcast(__do_it)

    def load_filter(self, slot: str, entry: CatalogueEntry) -> None:
        to_load = [PEQ(idx, fc=f['freq'], q=f['q'], gain=f['gain'], filter_type_name=f['type'])
                   for idx, f in enumerate(entry.filters)]
        self._hydrate_cache_broadcast(lambda: self.__do_it(to_load, entry.formatted_title))

    def __do_it(self, to_load: List['PEQ'], title: str):
        try:
            self.__send(to_load)
            self._current_state.slot.last = title
        except Exception as e:
            self._current_state.slot.last = 'ERRUR'
            raise e

    def clear_filter(self, slot: str) -> None:
        self._hydrate_cache_broadcast(lambda: self.__do_it([], 'Empty'))

    def mute(self, slot: Optional[str], channel: Optional[int]) -> None:
        raise NotImplementedError()

    def unmute(self, slot: Optional[str], channel: Optional[int]) -> None:
        raise NotImplementedError()

    def set_gain(self, slot: Optional[str], channel: Optional[int], gain: float) -> None:
        raise NotImplementedError()

    def on_mso(self, mso: dict):
        logger.info(f"Received {mso}")
        version = mso['versions']['swVer']
        version = version[1:] if version[0] == 'v' or version[0] == 'V' else version
        try:
            self.__supports_shelf = semver.parse_version_info(version) > semver.parse_version_info('1.4.0')
        except:
            logger.error(f"Unable to parse version {mso['versions']['swVer']}, will not send shelf filters")
            self.__supports_shelf = False
        if not self.__supports_shelf:
            logger.error(f"Device version {mso['versions']['swVer']} too old, lacks shelf filter support")

        speakers = mso['speakers']['groups']
        channels = ['lf', 'rf']
        for group in [s for s, v in speakers.items() if 'present' in v and v['present'] is True]:
            if group[0:2] == 'lr' and len(group) > 2:
                channels.append('l' + group[2:])
                channels.append('r' + group[2:])
            else:
                channels.append(group)

        peq_slots = mso['peq']['slots']

        filters = {c: [] for c in channels}
        unknown_channels = set()
        for idx, s in enumerate(peq_slots):
            for c in channels:
                if c in s['channels']:
                    filters[c].append(PEQ(idx, s['channels'][c]))
                else:
                    unknown_channels.add(c)
        if unknown_channels:
            peq_channels = peq_slots[0]['channels'].keys()
            logger.error(f"Unknown channels encountered [peq channels: {peq_channels}, unknown: {unknown_channels}]")
        for c in filters.keys():
            if c in self.__channels:
                logger.info(f"Updating PEQ channel {c} with {filters[c]}")
                self.__peq[c] = filters[c]
            else:
                logger.info(f"Discarding filter channel {c} - {filters[c]}")

    def on_msoupdate(self, msoupdate: dict):
        logger.info(f"Received {msoupdate}")


class Htp1Client:

    def __init__(self, ip, listener):
        self.__factory = Htp1ClientFactory(listener, f"ws://{ip}/ws/controller")
        self.__connector = connectWS(self.__factory)

    def send(self, msg: str):
        self.__factory.broadcast(msg)


class Htp1Protocol(WebSocketClientProtocol):

    def onConnecting(self, transport_details):
        logger.info(f"Connecting to {transport_details}")

    def onConnect(self, response):
        logger.info(f"Connected to {response.peer}")
        self.sendMessage('getmso'.encode('utf-8'), isBinary=False)

    def onOpen(self):
        logger.info("Connected to HTP1")
        self.factory.register(self)

    def onClose(self, was_clean, code, reason):
        if was_clean:
            logger.info(f"Disconnected code: {code} reason: {reason}")
        else:
            logger.warning(f"UNCLEAN! Disconnected code: {code} reason: {reason}")

    def onMessage(self, payload, is_binary):
        if is_binary:
            logger.warning(f"Received {len(payload)} bytes in binary payload, ignoring")
        else:
            msg = payload.decode('utf8')
            if msg.startswith('mso '):
                logger.debug(f"Processing mso {msg}")
                self.factory.listener.on_mso(json.loads(msg[4:]))
            elif msg.startswith('msoupdate '):
                logger.debug(f"Processing msoupdate {msg}")
                self.factory.listener.on_msoupdate(json.loads(msg[10:]))
            else:
                logger.info(f"Received unknown payload {msg}")


class Htp1ClientFactory(WebSocketClientFactory, ReconnectingClientFactory):

    protocol = Htp1Protocol
    maxDelay = 5
    initialDelay = 0.5

    def __init__(self, listener, *args, **kwargs):
        super(Htp1ClientFactory, self).__init__(*args, **kwargs)
        self.__clients: List[Htp1Protocol] = []
        self.listener = listener
        self.setProtocolOptions(version=13)

    def clientConnectionFailed(self, connector, reason):
        logger.warning(f"Client connection failed {reason} .. retrying ..")
        super().clientConnectionFailed(connector, reason)

    def clientConnectionLost(self, connector, reason):
        logger.warning(f"Client connection failed {reason} .. retrying ..")
        super().clientConnectionLost(connector, reason)

    def register(self, client: Htp1Protocol):
        if client not in self.__clients:
            logger.info(f"Registered device {client.peer}")
            self.__clients.append(client)
        else:
            logger.info(f"Ignoring duplicate device {client.peer}")

    def unregister(self, client: Htp1Protocol):
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
                    c.sendMessage(msg.encode('utf8'))
                except Disconnected as e:
                    logger.exception(f"Failed to send to {c.peer}, discarding")
                    disconnected_clients.append(c)
            for c in disconnected_clients:
                self.unregister(c)
        else:
            raise ValueError(f"No devices connected, ignoring {msg}")


class PEQ:

    def __init__(self, slot, params=None, fc=None, q=None, gain=None, filter_type_name=None):
        self.slot = slot
        if params is not None:
            self.fc = params['Fc']
            self.q = params['Q']
            self.gain = params['gaindB']
            self.filter_type = params.get('FilterType', 0)
            self.filter_type_name = 'PeakingEQ' if self.filter_type == 0 else 'LowShelf' if self.filter_type == 1 else 'HighShelf'
        else:
            self.fc = fc
            self.q = q
            self.gain = gain
            self.filter_type = 0 if filter_type_name == 'PeakingEQ' else 1 if filter_type_name == 'LowShelf' else 2
            self.filter_type_name = filter_type_name

    def as_ops(self, channel: str, use_shelf: bool = True):
        if self.filter_type == 0 or use_shelf:
            prefix = f"/peq/slots/{self.slot}/channels/{channel}"
            ops = [
                {
                    'op': 'replace',
                    'path': f"{prefix}/Fc",
                    'value': self.fc
                },
                {
                    'op': 'replace',
                    'path': f"{prefix}/Q",
                    'value': self.q
                },
                {
                    'op': 'replace',
                    'path': f"{prefix}/gaindB",
                    'value': self.gain
                }
            ]
            if use_shelf:
                ops.append(
                    {
                        'op': 'replace',
                        'path': f"{prefix}/FilterType",
                        'value': self.filter_type
                    }
                )
            return ops
        else:
            return []

    def __repr__(self):
        return f"{self.slot}: {self.filter_type_name} {self.fc} Hz {self.gain} dB {self.q}"
