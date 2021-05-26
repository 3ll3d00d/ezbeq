import logging
from typing import List, Tuple, Optional

import math
from flask import request
from flask_restx import Resource, Namespace, fields

from ezbeq.catalogue import CatalogueProvider, Catalogue
from ezbeq.device import DeviceStateHolder, DeviceBridge, InvalidRequestError, DeviceState

logger = logging.getLogger('ezbeq.devices')


def delete_filter(bridge: DeviceBridge, state: DeviceStateHolder, slot: str):
    '''
    Clears the slot.
    :param bridge: the bridge to the device.
    :param state: state of the bridge.
    :param slot: the slot.
    :return: current state after clearing, 200 if cleared or 500 if unable to load
    '''
    logger.info(f"Clearing Slot {slot}")
    try:
        bridge.clear_filter(slot)
        state.clear(slot)
        return state.get().as_dict(), 200
    except Exception as e:
        logger.exception(f"Failed to clear Slot {slot}")
        state.error(slot)
        return state.get().as_dict(), 500


def load_filter(catalogue: List[Catalogue], bridge: DeviceBridge, state: DeviceStateHolder, entry_id: str,
                slot: str) -> Tuple[dict, int]:
    '''
    Attempts to find the supplied entry in the catalogue and load it into the given slot.
    :param catalogue: the catalogue.
    :param bridge: the bridge to the device.
    :param state: state of the bridge.
    :param entry_id: the catalogue entry id.
    :param slot: the slot.
    :return: current state after load, 200 if loaded, 400 if no such entry, 500 if unable to load
    '''
    logger.info(f"Sending {entry_id} to Slot {slot}")
    match: Catalogue = next((c for c in catalogue if c.idx == entry_id), None)
    if not match:
        logger.warning(f"No title with ID {entry_id} in catalogue")
        return {'message': 'Title not found, please refresh.'}, 404
    try:
        bridge.load_filter(slot, match)
        state.set_loaded_entry(slot, match)
        return state.get().as_dict(), 200
    except InvalidRequestError as e:
        logger.exception(f"Invalid request {entry_id} to Slot {slot}")
        return state.get().as_dict(), 400
    except Exception as e:
        logger.exception(f"Failed to write {entry_id} to Slot {slot}")
        state.error(slot)
        return state.get().as_dict(), 500


def activate_slot(bridge: DeviceBridge, state: DeviceStateHolder, slot: str):
    '''
    Activates the slot.
    :param bridge: the bridge to the device.
    :param state: state of the bridge.
    :param slot: the slot.
    :return: current state after activation, 200 if activated or 500 if unable to activate
    '''
    logger.info(f"Activating Slot {slot}")
    try:
        bridge.activate(slot)
        state.activate(slot)
        return state.get().as_dict(), 200
    except InvalidRequestError as e:
        logger.exception(f"Invalid slot {slot}")
        return state.get().as_dict(), 400
    except Exception as e:
        logger.exception(f"Failed to activate Slot {slot}")
        state.error(slot)
        return state.get().as_dict(), 500


def mute_device(bridge: DeviceBridge, state: DeviceStateHolder, device_name: str, slot: Optional[str], value: bool,
                channel: Optional[int] = None):
    '''
    Mutes or unmutes a particular aspect of the device.
    :param bridge: the bridge to the device.
    :param state: state of the bridge.
    :param device_name: device to affect.
    :param slot: optional slot id.
    :param value: whether to mute (true) or unmute (false)
    :param channel: optional input channel id.
    :return: current state after making changes, 200 if updated or 500 if unable to update
    '''
    try:
        if value:
            bridge.mute(slot, channel)
            if slot is None:
                state.master_mute = value
            else:
                state.mute_slot(slot, channel)
        else:
            bridge.unmute(slot, channel)
            if slot is None:
                state.master_mute = value
            else:
                state.unmute_slot(slot, channel)
        return state.get().as_dict(), 200
    except InvalidRequestError as e:
        logger.exception(f"Invalid mute request {slot} {channel} {value}")
        return state.get().as_dict(), 400
    except Exception as e:
        logger.exception(f"Failed mute channel {slot}")
        return state.get().as_dict(), 500


def set_gain(bridge: DeviceBridge, state: DeviceStateHolder, device_name: str, slot: Optional[str], value: float,
             channel: Optional[int] = None):
    '''
    Sets gain on a particular aspect of the device.
    :param bridge: the bridge to the device.
    :param state: state of the bridge.
    :param device_name: device to affect.
    :param slot: optional slot id.
    :param value: the gain level to set.
    :param channel: optional input channel id.
    :return: current state after making changes, 200 if updated or 500 if unable to update
    '''
    try:
        bridge.set_gain(slot, channel, value)
        if slot is None:
            state.master_volume = value
        else:
            state.set_slot_gain(slot, channel, value)
        return state.get().as_dict(), 200
    except InvalidRequestError as e:
        logger.exception(f"Unable to set gain for {slot} {channel} {value}")
        return state.get().as_dict(), 400
    except Exception as e:
        logger.exception(f"Failed mute channel {slot}")
        return state.get().as_dict(), 500


api = Namespace('devices', description='Device related operations')


@api.route('')
class Devices(Resource):

    def __init__(self, *args, **kwargs):
        super().__init__(*args, **kwargs)
        self.__state: DeviceStateHolder = kwargs['device_state']
        self.__bridge: DeviceBridge = kwargs['device_bridge']

    def get(self):
        self.__state.initialise(self.__bridge)
        return self.__state.get().as_dict()


slot_model = api.model('Slot', {
    'id': fields.String(required=True),
    'active': fields.Boolean(required=False),
    'gain1': fields.Float(required=False),
    'gain2': fields.Float(required=False),
    'mute1': fields.Boolean(required=False),
    'mute2': fields.Boolean(required=False),
    'entry': fields.String(required=False)
})

device_model = api.model('Device', {
    'mute': fields.Boolean(required=False),
    'masterVolume': fields.Float(required=False),
    'slots': fields.List(fields.Nested(slot_model), required=False)
})


@api.route('/<string:device_name>', defaults={'device_name': 'master'})
class Device(Resource):

    def __init__(self, *args, **kwargs):
        super().__init__(*args, **kwargs)
        self.__state: DeviceStateHolder = kwargs['device_state']
        self.__bridge: DeviceBridge = kwargs['device_bridge']
        self.__catalogue_provider: CatalogueProvider = kwargs['catalogue']

    @api.expect(device_model, validate=True)
    def patch(self, device_name: str):
        current_state: DeviceState = self.__state.get()
        if current_state:
            payload = request.get_json()
            logger.info(f"Processing PATCH for {device_name} {payload}")
            if 'slots' in payload:
                for slot in payload['slots']:
                    state, cmd_code = self.__update_slot(slot, current_state, device_name)
                    if cmd_code != 200:
                        return state, cmd_code
            if 'mute' in payload and payload['mute'] != current_state.mute:
                state, cmd_code = mute_device(self.__bridge, self.__state, device_name, None, payload['mute'], None)
                if cmd_code != 200:
                    return state, cmd_code
            if 'masterVolume' in payload and not math.isclose(payload['masterVolume'], current_state.master_volume):
                state, cmd_code = set_gain(self.__bridge, self.__state, device_name, None, payload['masterVolume'],
                                           None)
                if cmd_code != 200:
                    return state, cmd_code
            return self.__state.get().as_dict(), 200
        else:
            return f"Unknown device {device_name}", 404

    def __update_slot(self, slot: dict, current_state: DeviceState, device_name: str) -> Tuple[dict, int]:
        state = {}
        cmd_code = 400
        try:
            current_state.get_slot(slot['id'])
        except StopIteration as e:
            return {'msg': f"Unknown slot {slot['id']} in device {device_name}"}, 400
        if 'gain1' in slot:
            state, cmd_code = set_gain(self.__bridge, self.__state, device_name, slot['id'], slot['gain1'], 1)
            if cmd_code != 200:
                return state, cmd_code
        if 'gain2' in slot:
            state, cmd_code = set_gain(self.__bridge, self.__state, device_name, slot['id'], slot['gain2'], 2)
            if cmd_code != 200:
                return state, cmd_code
        if 'mute1' in slot:
            state, cmd_code = mute_device(self.__bridge, self.__state, device_name, slot['id'], slot['mute1'], 1)
            if cmd_code != 200:
                return state, cmd_code
        if 'mute2' in slot:
            state, cmd_code = mute_device(self.__bridge, self.__state, device_name, slot['id'], slot['mute1'], 2)
            if cmd_code != 200:
                return state, cmd_code
        if 'entry' in slot and slot['entry']:
            state, cmd_code = load_filter(self.__catalogue_provider.catalogue, self.__bridge, self.__state,
                                          slot['entry'], slot['id'])
            if cmd_code != 200:
                return state, cmd_code
        if 'active' in slot:
            state, cmd_code = activate_slot(self.__bridge, self.__state, slot['id'])
            if cmd_code != 200:
                return state, cmd_code
        return state, cmd_code


@api.route('/<string:device_name>/config/<string:slot>/active')
@api.doc(params={
    'device_name': 'The dsp device name',
    'slot': 'The dsp configuration to activate, available values depend on the DSP device (1-4 for MiniDSP 2x4HD)'
})
class ActiveSlot(Resource):

    def __init__(self, *args, **kwargs):
        super().__init__(*args, **kwargs)
        self.__bridge: DeviceBridge = kwargs['device_bridge']
        self.__state: DeviceStateHolder = kwargs['device_state']

    def put(self, device_name: str, slot: str) -> Tuple[dict, int]:
        return activate_slot(self.__bridge, self.__state, slot)


gain_model = api.model('Gain', {
    'gain': fields.Float
})


@api.route('/<string:device_name>/gain/<string:slot>/<int:channel>')
@api.route('/<string:device_name>/gain/<string:slot>')
@api.route('/<string:device_name>/gain')
@api.doc(params={
    'device_name': 'The dsp device name',
    'slot': 'The dsp configuration to set the gain on, available values depend on the DSP device (1-4 for MiniDSP'
            '2x4HD). If unset, the master gain is changed.',
    'channel': 'sets the gain on the specified input channel or all inputs if not set'
})
class SetGain(Resource):

    def __init__(self, *args, **kwargs):
        super().__init__(*args, **kwargs)
        self.__bridge: DeviceBridge = kwargs['device_bridge']
        self.__state: DeviceStateHolder = kwargs['device_state']

    @api.expect(gain_model, validate=True)
    def put(self, device_name: str, slot: Optional[str] = None, channel: Optional[int] = None) -> Tuple[dict, int]:
        return set_gain(self.__bridge, self.__state, device_name, slot, request.get_json()['gain'], channel)

    def delete(self, device_name: str, slot: Optional[str] = None, channel: Optional[int] = None) -> Tuple[dict, int]:
        return set_gain(self.__bridge, self.__state, device_name, slot, 0.0, channel)


@api.route('/<string:device_name>/mute/<string:slot>/<int:channel>')
@api.route('/<string:device_name>/mute/<string:slot>')
@api.route('/<string:device_name>/mute')
@api.doc(params={
    'device_name': 'The dsp device name',
    'slot': 'The dsp configuration to mute, available values depend on the DSP device (1-4 for MiniDSP 2x4HD). '
            'If unset, the entire device is muted.',
    'channel': 'mutes or unmutes the specified input channel or all inputs if not set'
})
class Mute(Resource):

    def __init__(self, *args, **kwargs):
        super().__init__(*args, **kwargs)
        self.__bridge: DeviceBridge = kwargs['device_bridge']
        self.__state: DeviceStateHolder = kwargs['device_state']

    def put(self, device_name: str, slot: Optional[str] = None, channel: Optional[int] = None) -> Tuple[dict, int]:
        return mute_device(self.__bridge, self.__state, device_name, slot, True, channel)

    def delete(self, device_name: str, slot: Optional[str] = None, channel: Optional[int] = None) -> Tuple[dict, int]:
        return mute_device(self.__bridge, self.__state, device_name, slot, False, channel)


filter_model = api.model('Filter', {
    'entryId': fields.String
})


@api.route('/<string:device_name>/filter/<string:slot>')
@api.doc(params={
    'device_name': 'The dsp device name',
    'slot': 'The dsp configuration to load into, available values depend on the DSP device (1-4 for MiniDSP 2x4HD)'
})
class ManageFilter(Resource):

    def __init__(self, *args, **kwargs):
        super().__init__(*args, **kwargs)
        self.__bridge: DeviceBridge = kwargs['device_bridge']
        self.__catalogue_provider: CatalogueProvider = kwargs['catalogue']
        self.__state: DeviceStateHolder = kwargs['device_state']

    @api.expect(filter_model, validate=True)
    def put(self, device_name: str, slot: str) -> Tuple[dict, int]:
        return load_filter(self.__catalogue_provider.catalogue, self.__bridge, self.__state,
                           request.get_json()['entryId'], slot)

    def delete(self, device_name: str, slot: str) -> Tuple[dict, int]:
        return delete_filter(self.__bridge, self.__state, slot)


# legacy API, deprecated
device_api = Namespace('device')


@device_api.route('/<string:slot>')
@device_api.deprecated
class DeviceSender(Resource):

    def __init__(self, *args, **kwargs):
        super().__init__(*args, **kwargs)
        self.__bridge: DeviceBridge = kwargs['device_bridge']
        self.__catalogue_provider: CatalogueProvider = kwargs['catalogue']
        self.__state: DeviceStateHolder = kwargs['device_state']

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
            return self.__state.get().as_dict(), 200 if result else 500
        elif isinstance(payload, dict):
            return self.__handle_command(slot, payload)
        return self.__state.get().as_dict(), 404

    def __handle_command(self, slot: str, payload: dict):
        if 'command' in payload:
            cmd = payload['command']
            if cmd == 'load':
                if 'id' in payload:
                    return load_filter(self.__catalogue_provider.catalogue, self.__bridge, self.__state, payload['id'],
                                       slot)
            elif cmd == 'activate':
                return activate_slot(self.__bridge, self.__state, slot)
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
                        return mute_device(self.__bridge, self.__state, 'NOP', slot,
                                           False if payload['value'] == 'off' else True, channel)
                    else:
                        return set_gain(self.__bridge, self.__state, 'NOP', slot, round(float(payload['value']), 2),
                                        channel)
        return None, 400

    def delete(self, slot):
        return delete_filter(self.__bridge, self.__state, slot)
