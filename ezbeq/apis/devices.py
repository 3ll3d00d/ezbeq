import logging
from typing import List, Tuple, Optional

from flask import request
from flask_restx import Resource, Namespace

from ezbeq.catalogue import CatalogueProvider, Catalogue
from ezbeq.device import DeviceState, DeviceBridge, InvalidRequestError

logger = logging.getLogger('ezbeq.devices')


def delete_filter(bridge: DeviceBridge, state: DeviceState, slot: str):
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
        return state.get(), 200
    except Exception as e:
        logger.exception(f"Failed to clear Slot {slot}")
        state.error(slot)
        return state.get(), 500


def load_filter(catalogue: List[Catalogue], bridge: DeviceBridge, state: DeviceState, entry_id: str,
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
        state.put(slot, match)
        return state.get(), 200
    except InvalidRequestError as e:
        logger.exception(f"Invalid request {entry_id} to Slot {slot}")
        return state.get(), 400
    except Exception as e:
        logger.exception(f"Failed to write {entry_id} to Slot {slot}")
        state.error(slot)
        return state.get(), 500


def activate_slot(bridge: DeviceBridge, state: DeviceState, slot: str):
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
        return state.get(), 200
    except InvalidRequestError as e:
        logger.exception(f"Invalid slot {slot}")
        return state.get(), 400
    except Exception as e:
        logger.exception(f"Failed to activate Slot {slot}")
        state.error(slot)
        return state.get(), 500


def mute_device(bridge: DeviceBridge, state: DeviceState, device_name: str, slot: Optional[str], value: bool,
                channel: Optional[str] = None):
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
        return state.get(), 200
    except InvalidRequestError as e:
        logger.exception(f"Invalid mute request {slot} {channel} {value}")
        return state.get(), 400
    except Exception as e:
        logger.exception(f"Failed mute channel {slot}")
        return state.get(), 500


def set_gain(bridge: DeviceBridge, state: DeviceState, device_name: str, slot: Optional[str], value: float,
             channel: Optional[str] = None):
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
        return state.get(), 200
    except InvalidRequestError as e:
        logger.exception(f"Unable to set gain for {slot} {channel} {value}")
        return state.get(), 400
    except Exception as e:
        logger.exception(f"Failed mute channel {slot}")
        return state.get(), 500


api = Namespace('devices', description='Device related operations')


@api.route('')
class Devices(Resource):

    def __init__(self, *args, **kwargs):
        super().__init__(*args, **kwargs)
        self.__state: DeviceState = kwargs['device_state']
        self.__bridge: DeviceBridge = kwargs['device_bridge']

    def get(self):
        self.__state.initialise(self.__bridge)
        return self.__state.get()


@api.route('/<string:device_name>/config/<string:slot>/active')
@api.doc(params={
    'device_name': 'The dsp device name',
    'slot': 'The dsp configuration to activate, available values depend on the DSP device (1-4 for MiniDSP 2x4HD)'
})
class ActiveSlot(Resource):

    def __init__(self, *args, **kwargs):
        super().__init__(*args, **kwargs)
        self.__bridge: DeviceBridge = kwargs['device_bridge']
        self.__state: DeviceState = kwargs['device_state']

    def put(self, device_name: str, slot: str) -> Tuple[dict, int]:
        return activate_slot(self.__bridge, self.__state, slot)


@api.route('/<string:device_name>/gain')
@api.route('/<string:device_name>/gain/<string:slot>')
@api.route('/<string:device_name>/gain/<string:slot>/<string:channel>')
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
        self.__state: DeviceState = kwargs['device_state']

    def put(self, device_name: str, slot: Optional[str], channel: Optional[str] = None) -> Tuple[dict, int]:
        return set_gain(self.__bridge, self.__state, device_name, slot, True, channel)


@api.route('/<string:device_name>/mute')
@api.route('/<string:device_name>/mute/<string:slot>')
@api.route('/<string:device_name>/mute/<string:slot>/<string:channel>')
@api.doc(params={
    'device_name': 'The dsp device name',
    'slot': 'The dsp configuration to mute, available values depend on the DSP device (1-4 for MiniDSP 2x4HD). '
            'If unset, the entire device is muted.',
    'channel': 'mutes the specified input channel or all inputs if not set'
})
class Mute(Resource):

    def __init__(self, *args, **kwargs):
        super().__init__(*args, **kwargs)
        self.__bridge: DeviceBridge = kwargs['device_bridge']
        self.__state: DeviceState = kwargs['device_state']

    def put(self, device_name: str, slot: Optional[str], channel: Optional[str] = None) -> Tuple[dict, int]:
        return mute_device(self.__bridge, self.__state, device_name, slot, True, channel)


@api.route('/<string:device_name>/unmute')
@api.route('/<string:device_name>/unmute/<string:slot>')
@api.route('/<string:device_name>/unmute/<string:slot>/<string:channel>')
@api.doc(params={
    'device_name': 'The dsp device name',
    'slot': 'The dsp configuration to unmute, available values depend on the DSP device (1-4 for MiniDSP 2x4HD). '
            'If unset, the entire device is unmuted.',
    'channel': 'unmutes the specified input channel or all inputs if not set'
})
class Unmute(Resource):

    def __init__(self, *args, **kwargs):
        super().__init__(*args, **kwargs)
        self.__bridge: DeviceBridge = kwargs['device_bridge']
        self.__state: DeviceState = kwargs['device_state']

    def put(self, device_name: str, slot: Optional[str], channel: Optional[str] = None) -> Tuple[dict, int]:
        return mute_device(self.__bridge, self.__state, device_name, slot, False, channel)


@api.route('/<string:device_name>/filter/<string:slot>')
@api.doc(params={
    'device_name': 'The dsp device name',
    'slot': 'The dsp configuration to clear, available values depend on the DSP device (1-4 for MiniDSP 2x4HD)'
})
class ClearFilter(Resource):

    def __init__(self, *args, **kwargs):
        super().__init__(*args, **kwargs)
        self.__bridge: DeviceBridge = kwargs['device_bridge']
        self.__state: DeviceState = kwargs['device_state']

    def delete(self, slot: str) -> Tuple[dict, int]:
        return delete_filter(self.__bridge, self.__state, slot)


@api.route('/<string:device_name>/filter/<string:slot>/<string:entry_id>')
@api.doc(params={
    'device_name': 'The dsp device name',
    'slot': 'The dsp configuration to load into, available values depend on the DSP device (1-4 for MiniDSP 2x4HD)',
    'entry_id': 'The id of a an entry in the currently available beqcatalogue'
})
class LoadFilter(Resource):

    def __init__(self, *args, **kwargs):
        super().__init__(*args, **kwargs)
        self.__bridge: DeviceBridge = kwargs['device_bridge']
        self.__catalogue_provider: CatalogueProvider = kwargs['catalogue']
        self.__state: DeviceState = kwargs['device_state']

    def put(self, device_name: str, slot: str, entry_id: str) -> Tuple[dict, int]:
        return load_filter(self.__catalogue_provider.catalogue, self.__bridge, self.__state, entry_id, slot)


# legacy API, deprecated
device_api = Namespace('device')


@device_api.route('/<string:slot>', doc=False)
class DeviceSender(Resource):

    def __init__(self, *args, **kwargs):
        super().__init__(*args, **kwargs)
        self.__bridge: DeviceBridge = kwargs['device_bridge']
        self.__catalogue_provider: CatalogueProvider = kwargs['catalogue']
        self.__state: DeviceState = kwargs['device_state']

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
            return self.__state.get(), 200 if result else 500
        elif isinstance(payload, dict):
            return self.__handle_command(slot, payload)
        return self.__state.get(), 404

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
                    if cmd == 'mute':
                        return mute_device(self.__bridge, self.__state, 'NOP', slot,
                                           False if payload['value'] == 'off' else True, channel)
                    else:
                        return set_gain(self.__bridge, self.__state, 'NOP', slot, round(float(payload['value']), 2),
                                        channel)
        return None, 400

    def delete(self, slot):
        return delete_filter(self.__bridge, self.__state, slot)
