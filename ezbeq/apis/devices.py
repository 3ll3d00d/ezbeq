import decimal
import logging
import re
import time
from typing import List, Tuple, Optional, Union

from flask import request
from flask_restx import Resource, Namespace, fields

from ezbeq.catalogue import CatalogueProvider, CatalogueEntry
from ezbeq.device import DeviceRepository, InvalidRequestError, UnableToPatchDeviceError
from ezbeq.iir import PeakingEQ, LowShelf, HighShelf

logger = logging.getLogger('ezbeq.devices')

FILTER_PATTERN = r'Filter\s+(\d+):\s+(ON|OFF)\s+(PEQ|PK|LS|HS)\s+Fc\s+(\d+\.\d+)\s+Hz\s+Gain\s+(-?\d+\.\d+)\s+dB\s+Q\s+(\d+\.\d+)'
ctx = decimal.Context()
ctx.prec = 17


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


def text_to_commands(command_type: str, lines: List[str]) -> Tuple[str, Union[List[dict], List[str]]]:
    commands: Union[List[dict], List[str]] = []
    if lines and command_type == 'filt':
        commands = [{}] * 10

        def convert_to_bq(filt_type: str, freq: float, gain: float, q: float) -> dict:
            if filt_type == 'PK' or filt_type == 'PEQ':
                f = PeakingEQ(96000, freq, q, gain)
            elif filt_type == 'LS':
                f = LowShelf(96000, freq, q, gain)
            elif filt_type == 'HS':
                f = HighShelf(96000, freq, q, gain)
            else:
                raise InvalidRequestError(f"Unknown filt_type {filt_type}")
            return f.format_biquads()

        for idx, line in enumerate(lines):
            if line:
                m = re.match(FILTER_PATTERN, line)
                if m:
                    filt_idx = int(m.group(1))
                    if 0 < filt_idx < 11:
                        ft = m.group(3)
                        fc = float(m.group(4))
                        g = float(m.group(5))
                        q = float(m.group(6))
                        commands[filt_idx - 1] = convert_to_bq(ft, fc, g, q)
                        if m.group(2) == 'OFF':
                            commands[filt_idx - 1]['BYPASS'] = True
                    else:
                        raise InvalidRequestError(
                            f"Filter line {idx} specifies filter {filt_idx} which is out of range")
                else:
                    raise InvalidRequestError(f"Filter line {idx} does not match - {line}")
        return 'bq', commands
    elif lines and command_type == 'rs':
        return 'rs', [line for line in lines if line.strip()]
    else:
        tmp = {}

        def append_bq():
            if tmp:
                keys = list(tmp.keys())
                if 'b0' in keys and 'b1' in keys and 'b2' in keys and 'a1' in keys and 'a2' in keys:
                    commands.append(tmp)
                else:
                    raise InvalidRequestError()

        for line in lines:
            if line:
                if line.startswith('biquad'):
                    append_bq()
                    tmp = {}
                else:
                    tokens = line.split('=')
                    tmp[tokens[0]] = tokens[1][:-1] if tokens[1][-1] == ',' else tokens[1]
        if tmp:
            append_bq()

        return 'bq', commands


def load_biquads(bridge: DeviceRepository, device_name: str, slot: str, overwrite: bool, inputs: List[int],
                 outputs: List[int], biquads: str):
    '''
    Attempts to load the provided biquads into the device. Expects minidsp format only. biquads can be raw biquad format
    or filter text format (as per https://sourceforge.net/p/equalizerapo/wiki/Configuration%20reference/#filter)
    :param bridge:
    :param device_name:
    :param slot:
    :param overwrite:
    :param inputs:
    :param outputs:
    :param biquads:
    :return:
    '''
    cmd_type, bqs = text_to_commands('bq', biquads.splitlines())
    try:
        if cmd_type != 'bq':
            raise InvalidRequestError(f"load_biquads but parsed command type is {cmd_type}")
        bridge.load_biquads(device_name, slot, overwrite, inputs, outputs, bqs)
        return bridge.state(device_name).serialise(), 200
    except InvalidRequestError as e:
        logger.exception(f"Invalid biquad request to {device_name} {slot}")
        return bridge.state(device_name).serialise(), 400
    except Exception as e:
        logger.exception(f"Failed to write biquads to {device_name} {slot}")
        return bridge.state(device_name).serialise(), 500


def load_commands(bridge: DeviceRepository, device_name: str, slot: str, overwrite: bool, inputs: List[int],
                  outputs: List[int], command_type: str, commands: str):
    '''
    Attempts to load the provided commands, filters or biquads into the device.
    :param bridge:
    :param device_name:
    :param slot:
    :param overwrite:
    :param inputs:
    :param outputs:
    :param command_type:
    :param commands:
    :return:
    '''
    cmd_type, bqs = text_to_commands(command_type, commands.splitlines())
    try:
        if cmd_type == 'bq':
            bridge.load_biquads(device_name, slot, overwrite, inputs, outputs, bqs)
        else:
            bridge.send_commands(device_name, slot, inputs, outputs, bqs)
        return bridge.state(device_name).serialise(), 200
    except InvalidRequestError as e:
        logger.exception(f"Invalid biquad request to {device_name} {slot}")
        return bridge.state(device_name).serialise(), 400
    except Exception as e:
        logger.exception(f"Failed to write biquads to {device_name} {slot}")
        return bridge.state(device_name).serialise(), 500


def load_filter(entry: Optional[CatalogueEntry], bridge: DeviceRepository, device_name: str,
                slot: str) -> Tuple[dict, int]:
    '''
    Attempts to find the supplied entry in the catalogue and load it into the given slot.
    :param entry: the catalogue entry.
    :param bridge: the bridge to the device.
    :param device_name: the device name.
    :param slot: the slot.
    :return: current state after load, 200 if loaded, 400 if no such entry, 500 if unable to load
    '''
    if not entry:
        return {'message': 'No such entry, please refresh.'}, 404
    try:
        logger.info(f"Sending {entry.id} to Slot {slot}")
        bridge.load_filter(device_name, slot, entry)
        return bridge.state(device_name).serialise(), 200
    except InvalidRequestError as e:
        logger.exception(f"Invalid request {entry.id} to Slot {slot}")
        return bridge.state(device_name).serialise(), 400
    except Exception as e:
        logger.exception(f"Failed to write {entry.id} to Slot {slot}")
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
v3_api = Namespace('3/devices', description='Device related operations')


@v1_api.route('')
class DevicesV1(Resource):

    def __init__(self, *args, **kwargs):
        super().__init__(*args, **kwargs)
        self.__bridge: DeviceRepository = kwargs['device_bridge']

    def get(self):
        all_devices = self.__bridge.all_devices()
        for k, v in all_devices.items():
            return v.serialise()
        return None, 404


@v2_api.route('')
class DevicesV2(Resource):

    def __init__(self, *args, **kwargs):
        super().__init__(*args, **kwargs)
        self.__bridge: DeviceRepository = kwargs['device_bridge']

    def get(self):
        from ezbeq import to_millis
        start = time.time()
        v = {n: d.serialise() for n, d in self.__bridge.all_devices(refresh=True).items()}
        logger.info(f'Loaded device state in {to_millis(start, time.time())}ms')
        return v


slot_model_v2 = v2_api.model('SlotV2', {
    'id': fields.String(required=True, description='The slot id'),
    'active': fields.Boolean(required=False, description='(Optional) if set to true will activate this slot (minidsp)'),
    'gains': fields.List(fields.Float, required=False,
                         description='(Optional) gains to set on each input channel (minidsp, camilladsp)'),
    'mutes': fields.List(fields.Boolean, required=False,
                         description='(Optional) allows each input channel to be muted or unmuted individually (minidsp, camilladsp)'),
    'entry': fields.String(required=False, description='(Optional) Accepts value from either the id or digest fields')
})

device_model_v2 = v2_api.model('DeviceV2', {
    'mute': fields.Boolean(required=False,
                           description='(Optional) True if mute the entire output, false to unmute (minidsp, camilladsp)'),
    'masterVolume': fields.Float(required=False, description='(Optional) The master gain in dB (minidsp, camilladsp)'),
    'slots': fields.List(fields.Nested(slot_model_v2), required=False, description='(Optional) Allows updates to be applied to individual DSP slots')
})


@v2_api.route('/<string:device_name>')
class DeviceV2(Resource):

    def __init__(self, *args, **kwargs):
        super().__init__(*args, **kwargs)
        self.__bridge: DeviceRepository = kwargs['device_bridge']
        self.__catalogue_provider: CatalogueProvider = kwargs['catalogue']

    @v2_api.expect(device_model_v2, validate=True)
    def patch(self, device_name: str):
        payload = request.get_json()
        for slot in payload.get('slots', []):
            if 'gains' in slot:
                slot['gains'] = [{'id': str(i + 1), 'value': v} for i, v in enumerate(slot['gains'])]
            if 'mutes' in slot:
                slot['mutes'] = [{'id': str(i + 1), 'value': v} for i, v in enumerate(slot['mutes'])]
        logger.info(f"PATCHing {device_name} with {payload}")
        if not self.__bridge.update(device_name, payload):
            logger.info(f"PATCH {device_name} was a nop")
        return self.__bridge.state(device_name).serialise()


gain_model_v3 = v3_api.model('GainV3', {
    'id': fields.String(required=True, description='The channel id'),
    'value': fields.Float(required=True, description='gain in dB')
})

mute_model_v3 = v3_api.model('MuteV3', {
    'id': fields.String(required=True, description='The channel id'),
    'value': fields.Boolean(required=True, description='true to mute, false to unmute')
})

slot_model_v3 = v3_api.model('SlotV3', {
    'id': fields.String(required=True, description='The slot id'),
    'active': fields.Boolean(required=False,
                             description='(Optional) if set to true will activate this slot (minidsp)'),
    'gains': fields.List(fields.Nested(gain_model_v3), required=False,
                         description='(Optional) gains to set on the specified input channels (minidsp, camilladsp)'),
    'mutes': fields.List(fields.Nested(mute_model_v3), required=False,
                         description='(Optional) allows each input channel to be muted or unmuted individually (minidsp, camilladsp)'),
    'entry': fields.String(required=False, description='(Optional) Accepts value from either the id or digest fields')
})

device_model_v3 = v3_api.model('DeviceV3', {
    'mute': fields.Boolean(required=False,
                           description='(Optional) True if mute the entire output, false to unmute (minidsp, camilladsp)'),
    'masterVolume': fields.Float(required=False, description='(Optional) The master gain in dB (minidsp, camilladsp)'),
    'slots': fields.List(fields.Nested(slot_model_v3), required=False, description='(Optional) Allows updates to be applied to individual DSP slots')
})


@v3_api.route('/<string:device_name>')
class DeviceV3(Resource):

    def __init__(self, *args, **kwargs):
        super().__init__(*args, **kwargs)
        self.__bridge: DeviceRepository = kwargs['device_bridge']
        self.__catalogue_provider: CatalogueProvider = kwargs['catalogue']

    @v3_api.expect(device_model_v3, validate=True)
    def patch(self, device_name: str) -> Tuple[dict, int]:
        payload = request.get_json()
        logger.info(f"PATCHing {device_name} with {payload}")
        try:
            updated = self.__bridge.update(device_name, payload)
            if updated:
                logger.info(f"PATCHed {device_name}")
            else:
                logger.info(f"PATCH {device_name} was a nop")
        except UnableToPatchDeviceError as e:
            logger.exception(f'PATCH {device_name} failure')
            return {'message': f'Update failed : {e.msg}'}, e.code
        return self.__bridge.state(device_name).serialise(), 200


@v1_api.route('/<string:device_name>/levels')
class DeviceLevels(Resource):

    def __init__(self, *args, **kwargs):
        super().__init__(*args, **kwargs)
        self.__bridge: DeviceRepository = kwargs['device_bridge']

    def get(self, device_name: str) -> Tuple[dict, int]:
        try:
            return self.__bridge.levels(device_name), 200
        except InvalidRequestError as e:
            logger.exception(f"Invalid device {device_name}")
            return {}, 400
        except Exception as e:
            logger.exception(f"Failed to get levels for {device_name}")
            return {}, 500


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


gain_model_v1 = v1_api.model('GainV1', {
    'gain': fields.Float(description='Gain in dB')
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

    @v1_api.expect(gain_model_v1, validate=True)
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


biquad_model = v1_api.model('BiquadV1', {
    'overwrite': fields.Boolean(description='If true, all existing biquads will be overwritten. If false, anything not specified will be left as is.'),
    'slot': fields.String(description='The slot id'),
    'inputs': fields.List(fields.Integer, description='The input channels to apply the biquads to'),
    'outputs': fields.List(fields.Integer, description='The output channels to apply the biquads to'),
    'biquads': fields.String(description='List of biquad coefficients in minidsp compatible format')
})


@v1_api.route('/<string:device_name>/biquads')
@v1_api.doc(params={
    'device_name': 'The dsp device name',
})
class LoadBiquads(Resource):

    def __init__(self, *args, **kwargs):
        super().__init__(*args, **kwargs)
        self.__bridge: DeviceRepository = kwargs['device_bridge']

    @v1_api.expect(biquad_model, validate=True)
    def put(self, device_name: str) -> Tuple[dict, int]:
        overwrite = request.get_json()['overwrite']
        slot = request.get_json()['slot']
        inputs = request.get_json()['inputs']
        outputs = request.get_json()['outputs']
        biquads = request.get_json()['biquads']
        return load_biquads(self.__bridge, device_name, str(slot), overwrite, inputs, outputs, biquads)


command_model = v1_api.model('CommandV1', {
    'overwrite': fields.Boolean(description='If true, all existing filters will be overwritten. If false, anything not specified will be left as is.'),
    'slot': fields.String(description='The slot id'),
    'inputs': fields.List(fields.Integer, description='The input channels to apply to'),
    'outputs': fields.List(fields.Integer, description='The output channels to apply to'),
    'commandType': fields.String(description='Valid values: bq (biquad coefficients), rs (minidsp rs commands), filt (equalizer apo filters)'),
    'commands': fields.String(description='The commands to execute')
})


@v1_api.route('/<string:device_name>/commands')
@v1_api.doc(params={
    'device_name': 'The dsp device name',
})
class LoadCommands(Resource):

    def __init__(self, *args, **kwargs):
        super().__init__(*args, **kwargs)
        self.__bridge: DeviceRepository = kwargs['device_bridge']

    @v1_api.expect(command_model, validate=True)
    def put(self, device_name: str) -> Tuple[dict, int]:
        overwrite = request.get_json()['overwrite']
        slot = request.get_json()['slot']
        inputs = request.get_json()['inputs']
        outputs = request.get_json()['outputs']
        command_type = request.get_json()['commandType']
        commands = request.get_json()['commands']
        return load_commands(self.__bridge, device_name, str(slot), overwrite, inputs, outputs, command_type, commands)


filter_model = v1_api.model('FilterV1', {
    'entryId': fields.String(description='Accepts value from the id field only')
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
        entry = self.__catalogue_provider.find_by_id(request.get_json()['entryId'])
        return load_filter(entry, self.__bridge, device_name, slot)

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
                    entry = self.__catalogue_provider.find_by_id(payload['id'])
                    return load_filter(entry, self.__bridge, 'master', slot)
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
