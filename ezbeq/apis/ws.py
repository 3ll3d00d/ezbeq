import abc
import json
import logging
from collections import defaultdict
from typing import Callable, Optional, List, Dict, TypeVar, Generic

from autobahn.exception import Disconnected
from autobahn.twisted import WebSocketServerProtocol, WebSocketServerFactory

SUBSCRIBE_LEVELS_CMD = 'subscribe levels'

LOAD_CATALOGUE_CMD = 'load catalogue'

logger = logging.getLogger('ezbeq.ws')


class WsServerFactory(abc.ABC):
    @abc.abstractmethod
    def broadcast(self, msg: str):
        pass

    @abc.abstractmethod
    def has_levels_client(self, device: str) -> bool:
        pass

    @abc.abstractmethod
    def set_levels_provider(self, name: str, broadcaster: Callable[[], None]):
        pass

    @abc.abstractmethod
    def init_state_provider(self, state_provider: Callable[[], str]):
        pass

    @abc.abstractmethod
    def init_meta_provider(self, meta_provider: Callable[[], str]):
        pass

    @abc.abstractmethod
    def init_catalogue_loader(self, loader: Callable[[Callable[[str], None]], None]):
        pass


T = TypeVar("T", bound=WsServerFactory)


class WsProtocol(WebSocketServerProtocol):

    def onConnect(self, request):
        logger.info(f"Client connecting: {request.peer}")

    def onOpen(self):
        logger.info("WebSocket connection open")
        self.factory.register(self)

    def onClose(self, was_clean, code, reason):
        logger.info(f"WebSocket connection closed: clean? {was_clean}, code: {code}, reason: {reason}")
        self.factory.unregister(self)

    def onMessage(self, payload, is_binary):
        try:
            s = payload.decode('utf-8')
            logger.info(f"Received '{s}'")
            if s.startswith(SUBSCRIBE_LEVELS_CMD):
                device_name = s[len(SUBSCRIBE_LEVELS_CMD) + 1:].rstrip()
                self.factory.register_for_levels(device_name, self)
            elif s.startswith(LOAD_CATALOGUE_CMD):
                self.factory.send_catalogue(self)
        except:
            logger.exception('Message received failure')


class AutobahnWsServerFactory(WsServerFactory, WebSocketServerFactory):
    protocol = WsProtocol

    def __init__(self, *args, **kwargs):
        super(AutobahnWsServerFactory, self).__init__(*args, **kwargs)
        self.__clients: List[WsProtocol] = []
        self.__levels_client: Dict[str, List[WsProtocol]] = defaultdict(list)
        self.__state_provider: Optional[Callable[[], str]] = None
        self.__meta_provider: Optional[Callable[[], str]] = None
        self.__catalogue_loader: Optional[Callable[[Callable[[str], None]], None]] = None
        self.__levels_provider: Dict[str, Callable[[], None]] = {}

    def init_state_provider(self, state_provider: Callable[[], str]):
        self.__state_provider = state_provider

    def init_meta_provider(self, meta_provider: Callable[[], str]):
        self.__meta_provider = meta_provider

    def init_catalogue_loader(self, loader: Callable[[Callable[[str], None]], None]):
        self.__catalogue_loader = loader

    def set_levels_provider(self, name: str, broadcaster: Callable[[], None]):
        self.__levels_provider[name] = broadcaster

    def register(self, client: WsProtocol):
        if client not in self.__clients:
            logger.info(f"Registered client {client.peer}")
            self.__clients.append(client)
            if self.__meta_provider:
                msg = self.__meta_provider()
                if msg:
                    client.sendMessage(msg.encode('utf8'), isBinary=False)
            if self.__state_provider:
                msg = self.__state_provider()
                if msg:
                    client.sendMessage(msg.encode('utf8'), isBinary=False)
        else:
            logger.info(f"Ignoring duplicate client {client.peer}")

    def send_catalogue(self, client: WsProtocol):
        if client not in self.__clients:
            logger.warning(f'Ignoring request for catalogue from unregistered client {client.peer}')
            return
        if self.__catalogue_loader:
            logger.info(f'Sending catalogue to {client.peer}')

            def encode_and_send(msg):
                if msg:
                    logger.info(f'Sending catalogue msg (len {len(msg)}b)')
                    client.sendMessage(msg.encode('utf8'), isBinary=False)

            self.__catalogue_loader(encode_and_send)
        else:
            logger.error(f'Unable to send catalogue to {client.peer}, no loader available')

    def register_for_levels(self, device: str, client: WsProtocol):
        if device in self.__levels_provider:
            if client in self.__clients:
                logger.info(f"Removing client {client.peer} from broadcast on level subscription for {device}")
                self.__clients.remove(client)
            # make sure the device is known
            _ = self.__levels_client[device]
            for k, v in self.__levels_client.items():
                if k == device:
                    if client in v:
                        logger.warning(f"Client {client.peer} already subscribed to levels for {device}")
                    else:
                        logger.info(f"Client {client.peer} subscribed to levels for {device}")
                        v.append(client)
            self.__levels_provider[device]()
        else:
            logger.warning(f"Unknown device {device} requested by {client.peer}")

    def unregister_for_levels(self, client: WsProtocol):
        for k, v in self.__levels_client.items():
            try:
                v.remove(client)
                logger.info(f"Client {client.peer} unsubscribed from levels for {k}")
            except ValueError:
                pass

    def unregister(self, client: WsProtocol):
        if client in self.__clients:
            logger.info(f"Unregistering client {client.peer}")
            self.__clients.remove(client)
        else:
            found = False
            for device, clients in self.__levels_client.items():
                if client in clients:
                    found = True
                    logger.info(f"Unregistering {device} levels client {client.peer}")
                    clients.remove(client)
            if not found:
                logger.info(f"Ignoring unregistered client {client.peer}")

    def broadcast(self, msg: str):
        logger.debug(f"Broadcasting {msg}")
        self.__send_to_all(self.__clients, msg)

    def __send_to_all(self, clients, msg: str) -> bool:
        if clients:
            disconnected_clients = []
            for c in clients:
                logger.debug(f"Sending to {c.peer} - {msg}")
                try:
                    c.sendMessage(msg.encode('utf8'), isBinary=False)
                except Disconnected as e:
                    logger.exception(f"Failed to send to disconnected client {c.peer}, discarding")
                    disconnected_clients.append(c)
            for c in disconnected_clients:
                self.unregister(c)
            return len(disconnected_clients) < len(clients)
        else:
            logger.info(f"No devices connected, ignoring {msg}")
            return False

    def send_levels(self, device: str, msg: str):
        logger.debug(f"Broadcasting levels {msg}")
        clients = self.__levels_client.get(device, None)
        if clients:
            return self.__send_to_all(clients, msg)
        else:
            return False

    def has_levels_client(self, device: str):
        return len(self.__levels_client.get(device, [])) > 0


class WsServer(abc.ABC, Generic[T]):

    def __init__(self, factory: T):
        self.__factory = factory

    @property
    def factory(self) -> T:
        return self.__factory

    def broadcast(self, msg: str):
        self.factory.broadcast(msg)

    def levels(self, device: str, levels: dict) -> bool:
        return self.factory.send_levels(device, json.dumps({'message': 'Levels', 'data': levels}))

    def has_levels_client(self, device: str) -> bool:
        return self.factory.has_levels_client(device)


class AutobahnWsServer(WsServer[AutobahnWsServerFactory]):

    def __init__(self):
        super().__init__(AutobahnWsServerFactory())
