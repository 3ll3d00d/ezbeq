import logging
from typing import List, Tuple, Optional

from flask import request
from flask_restx import Resource, Namespace, fields

from ezbeq.catalogue import CatalogueProvider, CatalogueEntry
from ezbeq.device import DeviceRepository, InvalidRequestError

logger = logging.getLogger('ezbeq.devices')


def delete_filter(bridge: DeviceRepository, device_name: str, slot: str):
    '''
    Clears the slot.
    :param bridge: the bridge to the device.
    :param device_name: the device name.
    :param slot: the slot.
    :return: current state after clearing, 200 if cleared or 500 if unable to load
    '''
    logger.info(f"Clearing Slot {slot}")
    try:
        bridge.clear_filter(device_name, slot)
        return bridge.state(device_name).serialise(), 200
    except Exception as e:
        logger.exception(f"Failed to clear Slot {slot}")
        return bridge.state(device_name).serialise(), 500


def load_filter(catalogue: List[CatalogueEntry], bridge: DeviceRepository, device_name: str,
                slot: str, entry_id: str) -> Tuple[dict, int]:
    '''
    Attempts to find the supplied entry in the catalogue and load it into the given slot.
    :param catalogue: the catalogue.
    :param bridge: the bridge to the device.
    :param device_name: the device name.
    :param slot: the slot.
    :param entry_id: the catalogue entry id.
    :return: current state after load, 200 if loaded, 400 if no such entry, 500 if unable to load
    '''
    logger.info(f"Sending {entry_id} to Slot {slot}")
    match: CatalogueEntry = next((c for c in catalogue if c.idx == entry_id), None)
    if not match:
        logger.warning(f"No title with ID {entry_id} in catalogue")
        return {'message': 'Title not found, please refresh.'}, 404
    try:
        bridge.load_filter(device_name, slot, match)
        return bridge.state(device_name).serialise(), 200
    except InvalidRequestError as e:
        logger.exception(f"Invalid request {entry_id} to Slot {slot}")
        return bridge.state(device_name).serialise(), 400
    except Exception as e:
        logger.exception(f"Failed to write {entry_id} to Slot {slot}")
        return bridge.state(device_name).serialise(), 500


def activate_slot(bridge: DeviceRepository, device_name: str, slot: str):
    '''
    Activates the slot.
    :param bridge: the bridge to the device.
    :param device_name: the device name.
    :param slot: the slot.
    :return: current state after activation, 200 if activated or 500 if unable to activate
    '''
    logger.info(f"Activating Slot {slot}")
    try:
        bridge.activate(device_name, slot)
        return bridge.state(device_name).serialise(), 200
    except InvalidRequestError as e:
        logger.exception(f"Invalid slot {slot}")
        return bridge.state(device_name).serialise(), 400
    except Exception as e:
        logger.exception(f"Failed to activate Slot {slot}")
        return bridge.state(device_name).serialise(), 500


def mute_device(bridge: DeviceRepository, device_name: str, slot: Optional[str], value: bool,
                channel: Optional[int] = None):
    '''
    Mutes or unmutes a particular aspect of the device.
    :param bridge: the bridge to the device.
    :param device_name: device to affect.
    :param slot: optional slot id.
    :param value: whether to mute (true) or unmute (false)
    :param channel: optional input channel id.
    :return: current state after making changes, 200 if updated or 500 if unable to update
    '''
    try:
        if value:
            bridge.mute(device_name, slot, channel)
        else:
            bridge.unmute(device_name, slot, channel)
        return bridge.state(device_name).serialise(), 200
    except InvalidRequestError as e:
        logger.exception(f"Invalid mute request {slot} {channel} {value}")
        return bridge.state(device_name).serialise(), 400
    except Exception as e:
        logger.exception(f"Failed mute channel {slot}")
        return bridge.state(device_name).serialise(), 500


def set_gain(bridge: DeviceRepository, device_name: str, slot: Optional[str], value: float,
             channel: Optional[int] = None):
    '''
    Sets gain on a particular aspect of the device.
    :param bridge: the bridge to the device.
    :param device_name: device to affect.
    :param slot: optional slot id.
    :param value: the gain level to set.
    :param channel: optional input channel id.
    :return: current state after making changes, 200 if updated or 500 if unable to update
    '''
    try:
        bridge.set_gain(device_name, slot, channel, value)
        return bridge.state(device_name).serialise(), 200
    except InvalidRequestError as e:
        logger.exception(f"Unable to set gain for {slot} {channel} {value}")
        return bridge.state(device_name).serialise(), 400
    except Exception as e:
        logger.exception(f"Failed mute channel {slot}")
        return bridge.state(device_name).serialise(), 500


v1_api = Namespace('1/devices', description='Device related operations')
v2_api = Namespace('2/devices', description='Device related operations')


@v1_api.route('')
class Devices(Resource):

    def __init__(self, *args, **kwargs):
        super().__init__(*args, **kwargs)
        self.__bridge: DeviceRepository = kwargs['device_bridge']

    def get(self):
        all_devices = self.__bridge.all_devices()
        for k, v in all_devices.items():
            return v.serialise()
        return None, 404


@v2_api.route('')
class Devices(Resource):

    def __init__(self, *args, **kwargs):
        super().__init__(*args, **kwargs)
        self.__bridge: DeviceRepository = kwargs['device_bridge']

    def get(self):
        return {n: d.serialise() for n, d in self.__bridge.all_devices().items()}


slot_model = v1_api.model('Slot', {
    'id': fields.String(required=True),
    'active': fields.Boolean(required=False),
    'gain1': fields.Float(required=False),
    'gain2': fields.Float(required=False),
    'mute1': fields.Boolean(required=False),
    'mute2': fields.Boolean(required=False),
    'entry': fields.String(required=False)
})

device_model = v1_api.model('Device', {
    'mute': fields.Boolean(required=False),
    'masterVolume': fields.Float(required=False),
    'slots': fields.List(fields.Nested(slot_model), required=False)
})


@v1_api.route('/<string:device_name>')
class Device(Resource):

    def __init__(self, *args, **kwargs):
        super().__init__(*args, **kwargs)
        self.__bridge: DeviceRepository = kwargs['device_bridge']
        self.__catalogue_provider: CatalogueProvider = kwargs['catalogue']

    @v1_api.expect(device_model, validate=True)
    def patch(self, device_name: str):
        payload = request.get_json()
        logger.info(f"PATCHing {device_name} with {payload}")
        if not self.__bridge.update(device_name, payload):
            logger.info(f"PATCH {device_name} was a nop")
        return self.__bridge.state(device_name).serialise()


@v1_api.route('/<string:device_name>/config/<string:slot>/active')
@v1_api.doc(params={
    'device_name': 'The dsp device name',
    'slot': 'The dsp configuration to activate, available values depend on the DSP device (1-4 for MiniDSP 2x4HD)'
})
class ActiveSlot(Resource):

    def __init__(self, *args, **kwargs):
        super().__init__(*args, **kwargs)
        self.__bridge: DeviceRepository = kwargs['device_bridge']

    def put(self, device_name: str, slot: str) -> Tuple[dict, int]:
        return activate_slot(self.__bridge, device_name, slot)


gain_model = v1_api.model('Gain', {
    'gain': fields.Float
})


@v1_api.route('/<string:device_name>/gain/<string:slot>/<int:channel>')
@v1_api.route('/<string:device_name>/gain/<string:slot>')
@v1_api.route('/<string:device_name>/gain')
@v1_api.doc(params={
    'device_name': 'The dsp device name',
    'slot': 'The dsp configuration to set the gain on, available values depend on the DSP device (1-4 for MiniDSP'
            '2x4HD). If unset, the master gain is changed.',
    'channel': 'sets the gain on the specified input channel or all inputs if not set'
})
class SetGain(Resource):

    def __init__(self, *args, **kwargs):
        super().__init__(*args, **kwargs)
        self.__bridge: DeviceRepository = kwargs['device_bridge']

    @v1_api.expect(gain_model, validate=True)
    def put(self, device_name: str, slot: Optional[str] = None, channel: Optional[int] = None) -> Tuple[dict, int]:
        return set_gain(self.__bridge, device_name, slot, request.get_json()['gain'], channel)

    def delete(self, device_name: str, slot: Optional[str] = None, channel: Optional[int] = None) -> Tuple[dict, int]:
        return set_gain(self.__bridge, device_name, slot, 0.0, channel)


@v1_api.route('/<string:device_name>/mute/<string:slot>/<int:channel>')
@v1_api.route('/<string:device_name>/mute/<string:slot>')
@v1_api.route('/<string:device_name>/mute')
@v1_api.doc(params={
    'device_name': 'The dsp device name',
    'slot': 'The dsp configuration to mute, available values depend on the DSP device (1-4 for MiniDSP 2x4HD). '
            'If unset, the entire device is muted.',
    'channel': 'mutes or unmutes the specified input channel or all inputs if not set'
})
class Mute(Resource):

    def __init__(self, *args, **kwargs):
        super().__init__(*args, **kwargs)
        self.__bridge: DeviceRepository = kwargs['device_bridge']

    def put(self, device_name: str, slot: Optional[str] = None, channel: Optional[int] = None) -> Tuple[dict, int]:
        return mute_device(self.__bridge, device_name, slot, True, channel)

    def delete(self, device_name: str, slot: Optional[str] = None, channel: Optional[int] = None) -> Tuple[dict, int]:
        return mute_device(self.__bridge, device_name, slot, False, channel)


filter_model = v1_api.model('Filter', {
    'entryId': fields.String
})


@v1_api.route('/<string:device_name>/filter/<string:slot>')
@v1_api.doc(params={
    'device_name': 'The dsp device name',
    'slot': 'The dsp configuration to load into, available values depend on the DSP device (1-4 for MiniDSP 2x4HD)'
})
class ManageFilter(Resource):

    def __init__(self, *args, **kwargs):
        super().__init__(*args, **kwargs)
        self.__bridge: DeviceRepository = kwargs['device_bridge']
        self.__catalogue_provider: CatalogueProvider = kwargs['catalogue']

    @v1_api.expect(filter_model, validate=True)
    def put(self, device_name: str, slot: str) -> Tuple[dict, int]:
        return load_filter(self.__catalogue_provider.catalogue, self.__bridge, device_name, slot,
                           request.get_json()['entryId'])

    def delete(self, device_name: str, slot: str) -> Tuple[dict, int]:
        return delete_filter(self.__bridge, device_name, slot)


# legacy API, deprecated
device_api = Namespace('1/device')


@device_api.route('/<string:slot>')
@device_api.deprecated
class DeviceSender(Resource):

    def __init__(self, *args, **kwargs):
        super().__init__(*args, **kwargs)
        self.__bridge: DeviceRepository = kwargs['device_bridge']
        self.__catalogue_provider: CatalogueProvider = kwargs['catalogue']

    def put(self, slot: str):
        '''
        Handles update commands for the device. The following rules apply
        * slot is a string in the 1-4 range representing minidsp config slots except for mute/gain commands which translate 0 to the master controls
        * command is one of load, activate, mute, gain
        * the payload may be a single dict or a list of dicts (for multiple commands)
        * mute: requires channel and value where channel is 0 (meaning 1 and 2) or master, 1 or 2 and refers to the input channel, value is on or off
        * gain: requires channel and value where channel is 0 (meaning 1 and 2) or master, 1 or 2 and refers to the input channel, value is the dB level to set
        * activate: requires no further data
        * load: requires id which refers to catalogue.id
        * mute and gain also accept channel = master which is used to override the provided slot and target the command at the master controls
        :param slot: the slot to target.
        :return: the device state, http status code.
        '''
        payload = request.get_json()
        if isinstance(payload, list):
            result = None
            for p in payload:
                result, _ = self.__handle_command(slot, p)
            return self.__bridge.state('master').serialise(), 200 if result else 500
        elif isinstance(payload, dict):
            return self.__handle_command(slot, payload)
        return self.__bridge.state('master').serialise(), 404

    def __handle_command(self, slot: str, payload: dict):
        if 'command' in payload:
            cmd = payload['command']
            if cmd == 'load':
                if 'id' in payload:
                    return load_filter(self.__catalogue_provider.catalogue, self.__bridge, 'master', slot,
                                       payload['id'])
            elif cmd == 'activate':
                return activate_slot(self.__bridge, 'master', slot)
            elif cmd == 'mute' or cmd == 'gain':
                if 'value' in payload:
                    channel = payload['channel'] if 'channel' in payload else None
                    if channel == 'master':
                        slot = None
                        channel = None
                    elif channel == '0':
                        channel = None
                    channel = int(channel) if channel is not None else None
                    if cmd == 'mute':
                        return mute_device(self.__bridge, 'master', slot,
                                           False if payload['value'] == 'off' else True, channel)
                    else:
                        return set_gain(self.__bridge, 'master', slot, round(float(payload['value']), 2),
                                        channel)
        return None, 400

    def delete(self, slot):
        return delete_filter(self.__bridge, 'master', slot)
