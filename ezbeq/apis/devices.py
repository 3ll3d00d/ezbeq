import logging

from flask_restx import Resource, Namespace

from device import DeviceState, DeviceBridge

logger = logging.getLogger('ezbeq.device')

api = Namespace('devices', description='Device related operations')


@api.route('')
class Devices(Resource):

    def __init__(self, *args, **kwargs):
        super().__init__(*args, **kwargs)
        self.__state: DeviceState = kwargs['device_state']
        self.__bridge: DeviceBridge = kwargs['device_bridge']

    @api.doc(responses={
        200: 'Success'
    })
    def get(self):
        state = self.__bridge.state()
        if self.__bridge.supports_gain():
            if 'active_slot' in state:
                self.__state.activate(state['active_slot'])
            if 'mute' in state:
                self.__state.mute('0', '0', state['mute'])
            if 'volume' in state:
                self.__state.gain('0', '0', state['volume'])
        return self.__state.get()
