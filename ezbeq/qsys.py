import json
import logging
import socket
from typing import Optional, List

from ezbeq.apis.ws import WsServer
from ezbeq.catalogue import CatalogueEntry, CatalogueProvider
from ezbeq.device import SlotState, DeviceState, PersistentDevice

SLOT_NAME = 'QSYS'
TERMINATOR = '\0'

logger = logging.getLogger('ezbeq.qsys')


class QsysSlotState(SlotState):

    def __init__(self):
        super().__init__(SLOT_NAME)


class QsysState(DeviceState):

    def __init__(self, name: str):
        self.__name = name
        self.slot = QsysSlotState()
        self.slot.active = True

    def serialise(self) -> dict:
        return {
            'name': self.__name,
            'slots': [self.slot.as_dict()]
        }


class Qsys(PersistentDevice[QsysState]):

    def __init__(self, name: str, config_path: str, cfg: dict, ws_server: WsServer, catalogue: CatalogueProvider):
        super().__init__(config_path, name, ws_server)
        self.__name = name
        self.__catalogue = catalogue
        self.__ip = cfg['ip']
        self.__port = cfg['port']
        self.__components = cfg.get('components', [])
        self.__timeout_srcs = cfg.get('timeout_secs', 2)
        self.__peq = {}

    def _load_initial_state(self) -> QsysState:
        return QsysState(self.name)

    def _merge_state(self, loaded: QsysState, cached: dict) -> QsysState:
        if 'slots' in cached:
            for slot in cached['slots']:
                if 'id' in slot:
                    if slot['id'] == 'Qsys':
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
                if slot['id'] == SLOT_NAME:
                    if 'entry' in slot:
                        if slot['entry']:
                            match = self.__catalogue.find(slot['entry'])
                            if match:
                                self.load_filter(SLOT_NAME, match)
                                any_update = True
                        else:
                            self.clear_filter(SLOT_NAME)
                            any_update = True
        return any_update

    def __send(self, to_load: List['PEQ']):
        logger.info(f"Sending {len(to_load)} filters")
        while len(to_load) < 10:
            to_load.append(PEQ(100, 1, 0, 'PeakingEQ'))
        if to_load:
            controls = []
            for idx, peq in enumerate(to_load):
                controls += peq.to_rpc(idx + 1)
            self.__send_to_socket(controls)
        else:
            logger.warning(f"Nothing to send")

    @staticmethod
    def __recvall(sock: socket, buf_size: int = 4096) -> str:
        data = b''
        while True:
            try:
                packet = sock.recv(buf_size)
                if not packet:
                    break
                data += packet
                if len(packet) < buf_size:
                    break
            except TimeoutError:
                logger.error("timed out")
                break
        if data:
            return data.decode('utf-8').strip(TERMINATOR)
        return ''

    def __send_to_socket(self, controls: list):
        logger.info(f"Sending {controls} to {self.__ip}:{self.__port}")
        sock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
        sock.settimeout(self.__timeout_srcs)
        try:
            sock.connect((self.__ip, self.__port))
            for c in self.__components:
                jsonrpc = {
                    "jsonrpc": "2.0",
                    "id": 1234,
                    "method": "Component.Set",
                    "params": {
                        "Name": c,
                        "Controls": controls
                    }
                }
                logger.info(f"Sending to {c}")
                sock.sendall(json.dumps(jsonrpc).encode('utf-8'))
                sock.sendall(TERMINATOR.encode('utf-8'))
                msg = self.__recvall(sock)
                if msg:
                    result = json.loads(msg)
                    logger.info(f"Received from {c}: {result}")
                else:
                    logger.info(f"Received no data from {c}")
        finally:
            sock.close()

    def activate(self, slot: str) -> None:
        def __do_it():
            self._current_state.slot.active = True

        self._hydrate_cache_broadcast(__do_it)

    def load_biquads(self, slot: str, overwrite: bool, inputs: List[int], outputs: List[int],
                     biquads: List[dict]) -> None:
        raise NotImplementedError()

    def load_filter(self, slot: str, entry: CatalogueEntry) -> None:
        to_load = [PEQ(f['freq'], f['q'], f['gain'], f['type']) for f in entry.filters]
        self._hydrate_cache_broadcast(lambda: self.__do_it(to_load, entry.formatted_title))

    def __do_it(self, to_load: List['PEQ'], title: str):
        try:
            self.__send(to_load)
            self._current_state.slot.last = title
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


class PEQ:

    def __init__(self, fc: float, q: float, gain: float, filter_type_name: str):
        self.fc = fc
        self.q = q
        self.gain = gain
        self.filter_type = 1.0 if filter_type_name == 'PeakingEQ' else 2.0 if filter_type_name == 'LowShelf' else 3.0
        self.filter_type_name = filter_type_name

    def to_rpc(self, slot: int):
        return [
            {"Name": f"frequency.{slot}", "Value": self.fc},
            {"Name": f"gain.{slot}", "Value": self.gain},
            {"Name": f"q.factor.{slot}", "Value": self.q},
            {"Name": f"type.{slot}", "Value": self.filter_type}
        ]

    def __repr__(self):
        return f"{self.filter_type_name} {self.fc} Hz {self.gain} dB {self.q}"
