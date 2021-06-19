import logging
from collections import defaultdict
from typing import Callable, Optional, List, Dict

from autobahn.exception import Disconnected
from autobahn.twisted import WebSocketServerProtocol, WebSocketServerFactory

SUBSCRIBE_LEVELS_CMD = 'subscribe levels'

logger = logging.getLogger('ezbeq.ws')


class WsServer:

    def __init__(self):
        self.__factory = WsServerFactory()

    @property
    def factory(self) -> 'WsServerFactory':
        return self.__factory

    def broadcast(self, msg: str):
        self.__factory.broadcast(msg)

    def levels(self, device: str, msg: str) -> bool:
        return self.__factory.send_levels(device, msg)


class WsProtocol(WebSocketServerProtocol):

    def onConnect(self, request):
        logger.info(f"Client connecting: {request.peer}")

    def onOpen(self):
        logger.info("WebSocket connection open")
        self.factory.register(self)

    def onClose(self, was_clean, code, reason):
        logger.info(f"WebSocket connection closed: clean? {was_clean}, code: {code}, reason: {reason}")

    def onMessage(self, payload, is_binary):
        try:
            s = payload.decode('utf-8')
            logger.info(f"Received {s}")
            if s.startswith(SUBSCRIBE_LEVELS_CMD):
                self.factory.register_for_levels(s[len(SUBSCRIBE_LEVELS_CMD) + 1:], self)
        except:
            logger.exception('Message received failure')


class WsServerFactory(WebSocketServerFactory):
    protocol = WsProtocol

    def __init__(self, *args, **kwargs):
        super(WsServerFactory, self).__init__(*args, **kwargs)
        self.__clients: List[WsProtocol] = []
        self.__levels_client: Dict[str, List[WsProtocol]] = defaultdict(list)
        self.__state_provider: Optional[Callable[[], str]] = None
        self.__levels_provider: Dict[str, Callable[[], None]] = {}

    def init(self, state_provider: Callable[[], str]):
        self.__state_provider = state_provider

    def set_levels_provider(self, name: str, broadcaster: Callable[[], None]):
        self.__levels_provider[name] = broadcaster

    def register(self, client: WsProtocol):
        if client not in self.__clients:
            logger.info(f"Registered client {client.peer}")
            self.__clients.append(client)
            if self.__state_provider:
                state = self.__state_provider()
                if state:
                    client.sendMessage(state.encode('utf8'), isBinary=False)
        else:
            logger.info(f"Ignoring duplicate client {client.peer}")

    def register_for_levels(self, device: str, client: WsProtocol):
        if device in self.__levels_provider:
            logger.info(f"Transferring client {client.peer} from broadcast to level subscription for {device}")
            self.__clients.remove(client)
            self.__levels_client[device].append(client)
            self.__levels_provider[device]()
        else:
            logger.warning(f"Unknown device {device} requested by {client.peer}")

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
                    logger.exception(f"Failed to send to {c.peer}, discarding")
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
