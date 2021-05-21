import logging

from flask import request
from flask_restx import Resource, Namespace, fields

from catalogue import CatalogueProvider, Catalogue
from device import DeviceState, DeviceBridge

logger = logging.getLogger('ezbeq.device')

api = Namespace('device', description='Device related operations')

resource_fields = api.model('Device', {
    'command': fields.String,
    'id': fields.String(required=False)
})

@api.route('/<string:slot>')
class DeviceSender(Resource):

    def __init__(self, *args, **kwargs):
        super().__init__(*args, **kwargs)
        self.__bridge: DeviceBridge = kwargs['device_bridge']
        self.__catalogue_provider: CatalogueProvider = kwargs['catalogue']
        self.__state: DeviceState = kwargs['device_state']

    @api.expect([resource_fields])
    def put(self, slot: str):
        '''
        Handles update commands for the device. The following rules apply
        * slot is a string in the 1-4 range representing minidsp config slots except for mute/gain commands which translate 0 to the master controls
        * command is one of load, activate, mute, gain
        * the payload may be a single dict or a list of dicts (for multiple commands)
        * mute: requires channel and value where channel is 0 (meaning 1 and 2), 1 or 2 and refers to the input channel, value is on or off
        * gain: requires channel and value where channel is 0 (meaning 1 and 2), 1 or 2 and refers to the input channel, value is the dB level to set
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
                    return self.__handle_load(payload, slot)
            elif cmd == 'activate':
                return self.__handle_activate(slot)
            elif cmd == 'mute':
                if 'value' in payload:
                    return self.__handle_mute(payload, slot, cmd)
            elif cmd == 'gain':
                if 'value' in payload:
                    return self.__handle_gain(payload, slot, cmd)
        return None, 400

    def __handle_gain(self, payload, slot, cmd):
        value = payload['value']
        channel = payload['channel'] if 'channel' in payload else None
        if channel == 'master':
            slot = '0'
            del payload['channel']
        float_value = round(float(value), 2)
        if slot == '0':
            if not -127.0 <= float_value <= 0.0:
                logger.exception(f"Invalid value for gain: {value}")
                return {'message': f"Invalid value for gain: {value}"}, 400
        else:
            if not -72.0 <= float_value <= 12.0:
                logger.exception(f"Invalid value for gain: {value}")
                return {'message': f"Invalid value for gain: {value}"}, 400
        try:
            self.__bridge.send(slot, payload, cmd)
            self.__state.gain(slot, channel, value)
            return self.__state.get(), 200
        except Exception as e:
            logger.exception(f"Failed to set gain on channel {slot}")
            return self.__state.get(), 500

    def __handle_activate(self, slot):
        logger.info(f"Activating Slot {slot}")
        try:
            self.__bridge.send(slot, True, 'activate')
            self.__state.activate(slot)
        except Exception as e:
            logger.exception(f"Failed to activate Slot {slot}")
            self.__state.error(slot)
        return self.__state.get(), 200

    def __handle_load(self, payload, slot):
        payload_id = payload['id']
        logger.info(f"Sending {payload_id} to Slot {slot}")
        match: Catalogue = next((c for c in self.__catalogue_provider.catalogue if c.idx == payload_id), None)
        if not match:
            logger.warning(f"No title with ID {payload_id} in catalogue {self.__catalogue_provider.version}")
            return {'message': 'Title not found, please refresh.'}, 400
        try:
            self.__bridge.send(slot, match, 'load')
            self.__state.put(slot, match)
        except Exception as e:
            logger.exception(f"Failed to write {payload_id} to Slot {slot}")
            self.__state.error(slot)
        return self.__state.get(), 200

    def __handle_mute(self, payload, slot, cmd):
        value = payload['value']
        channel = payload['channel'] if 'channel' in payload else None
        if channel == 'master':
            slot = '0'
            del payload['channel']
        if value != 'on' and value != 'off':
            logger.exception(f"Invalid value for mute: {value}")
            return {'message': f"Invalid value for mute: {value}"}, 400
        try:
            self.__bridge.send(slot, payload, cmd)
            self.__state.mute(slot, channel, value == 'on')
            return self.__state.get(), 200
        except Exception as e:
            logger.exception(f"Failed mute channel {slot}")
            return self.__state.get(), 500

    def delete(self, slot):
        logger.info(f"Clearing Slot {slot}")
        try:
            self.__bridge.send(slot, None, 'clear')
            self.__state.clear(slot)
        except Exception as e:
            logger.exception(f"Failed to clear Slot {slot}")
            self.__state.error(slot)
        return self.__state.get(), 200


