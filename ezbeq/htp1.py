import json
import logging

from autobahn.twisted.websocket import WebSocketClientFactory, connectWS, WebSocketClientProtocol
from twisted.internet.protocol import ReconnectingClientFactory

logger = logging.getLogger('ezbeq.htp1')


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

    def __init__(self, listener, *args, **kwargs):
        super().__init__(*args, **kwargs)
        self.__clients = []
        self.listener = listener
        self.setProtocolOptions(version=13)

    def clientConnectionFailed(self, connector, reason):
        logger.warning(f"Client connection failed {reason} .. retrying ..")
        self.retry(connector)

    def clientConnectionLost(self, connector, reason):
        logger.warning(f"Client connection failed {reason} .. retrying ..")
        self.retry(connector)

    def register(self, client):
        if client not in self.__clients:
            logger.info(f"Registered device {client.peer}")
            self.__clients.append(client)
        else:
            logger.info(f"Ignoring duplicate device {client.peer}")

    def unregister(self, client):
        if client in self.__clients:
            logger.info(f"Unregistering device {client.peer}")
            self.__clients.remove(client)
        else:
            logger.info(f"Ignoring unregistered device {client.peer}")

    def broadcast(self, msg):
        if self.__clients:
            for c in self.__clients:
                logger.info(f"Sending to {c.peer} - {msg}")
                c.sendMessage(msg.encode('utf8'))
        else:
            raise ValueError(f"No devices connected, ignoring {msg}")
