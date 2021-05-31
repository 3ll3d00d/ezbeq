import logging
from typing import Callable, Optional, List

from autobahn.exception import Disconnected
from autobahn.twisted import WebSocketServerProtocol, WebSocketServerFactory

logger = logging.getLogger('ezbeq.ws')


class WsServer:

    def __init__(self):
        self.__factory = WsServerFactory()

    @property
    def factory(self) -> 'WsServerFactory':
        return self.__factory

    def broadcast(self, msg: str):
        self.__factory.broadcast(msg)


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
        except:
            logger.exception('Message received failure')


class WsServerFactory(WebSocketServerFactory):
    protocol = WsProtocol

    def __init__(self, *args, **kwargs):
        super(WsServerFactory, self).__init__(*args, **kwargs)
        self.__clients: List[WsProtocol] = []
        self.__state_provider: Optional[Callable[[], str]] = None

    def init(self, state_provider: Callable[[], str]):
        self.__state_provider = state_provider

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

    def unregister(self, client: WsProtocol):
        if client in self.__clients:
            logger.info(f"Unregistering client {client.peer}")
            self.__clients.remove(client)
        else:
            logger.info(f"Ignoring unregistered client {client.peer}")
    
    def broadcast(self, msg: str):
        logger.debug(f"Broadcasting {msg}")
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
            logger.info(f"No devices connected, ignoring {msg}")
