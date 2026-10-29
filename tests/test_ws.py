import json
from unittest.mock import MagicMock

from autobahn.exception import Disconnected

from ezbeq.apis.ws import AutobahnWsServerFactory, WsProtocol


def make_protocol():
    protocol = WsProtocol()
    protocol.factory = MagicMock()
    protocol.sendMessage = MagicMock()
    return protocol


def test_ping_is_answered_with_pong():
    protocol = make_protocol()

    protocol.onMessage(b'ping', False)

    protocol.sendMessage.assert_called_once()
    payload = protocol.sendMessage.call_args.args[0]
    assert json.loads(payload.decode('utf-8')) == {'message': 'Pong'}
    assert protocol.sendMessage.call_args.kwargs == {'isBinary': False}


def test_load_catalogue_is_routed_to_the_factory():
    protocol = make_protocol()

    protocol.onMessage(b'load catalogue', False)

    protocol.factory.send_catalogue.assert_called_once_with(protocol)
    protocol.sendMessage.assert_not_called()


def make_catalogue_sender(client):
    factory = AutobahnWsServerFactory()
    factory.register(client)
    senders = []
    factory.init_catalogue_loader(lambda sender: senders.append(sender))
    factory.send_catalogue(client)
    return senders[0]


def test_catalogue_sender_reports_delivery():
    client = MagicMock()

    assert make_catalogue_sender(client)('{"message": "CatalogueEntries", "data": []}') is True

    client.sendMessage.assert_called_with(b'{"message": "CatalogueEntries", "data": []}', isBinary=False)


def test_catalogue_sender_reports_a_disconnected_client():
    client = MagicMock()
    client.sendMessage.side_effect = Disconnected('gone')

    assert make_catalogue_sender(client)('{"message": "CatalogueEntries", "data": []}') is False
