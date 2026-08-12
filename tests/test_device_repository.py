from ezbeq.device import Device, DeviceRepository, DeviceState


class _FakeState(DeviceState):

    def __init__(self, name: str):
        self.__name = name

    def serialise(self) -> dict:
        return {'name': self.__name}


class _FakeDevice(Device):
    """
    Minimal Device double whose state() can be told to raise, standing in for a device like jriver
    whose _load_initial_state() propagates a connection failure straight out of state() instead of
    degrading gracefully the way minidsp does (see MinidspState(..., connected=False)).
    """

    def __init__(self, name: str, exc: Exception | None = None):
        self.__name = name
        self.__exc = exc

    def recover(self):
        self.__exc = None

    @property
    def name(self) -> str:
        return self.__name

    @property
    def device_type(self) -> str:
        return 'fake'

    def state(self, refresh: bool = False):
        if self.__exc:
            raise self.__exc
        return _FakeState(self.__name)

    def activate(self, slot): raise NotImplementedError

    def load_filter(self, slot, entry, mv_adjust=0.0): raise NotImplementedError

    def load_biquads(self, slot, overwrite, inputs, outputs, biquads): raise NotImplementedError

    def send_commands(self, slot, inputs, outputs, commands): raise NotImplementedError

    def clear_filter(self, slot): raise NotImplementedError

    def mute(self, slot, channel): raise NotImplementedError

    def unmute(self, slot, channel): raise NotImplementedError

    def set_gain(self, slot, channel, gain): raise NotImplementedError

    def update(self, params): raise NotImplementedError

    def levels(self): raise NotImplementedError


def _repo_with(devices: dict[str, Device]) -> DeviceRepository:
    # Bypasses __init__ (which needs a full Config and real create_devices() wiring) to unit test
    # all_devices()'s per-device error isolation directly against hand-built fakes.
    repo = DeviceRepository.__new__(DeviceRepository)
    repo._DeviceRepository__devices = devices
    repo._DeviceRepository__hidden = set()
    return repo


def test_all_devices_excludes_a_device_whose_state_raises_but_keeps_the_rest():
    # Regression test: a single unreachable device (e.g. jriver with MCWS down) used to blow up the
    # dict comprehension in all_devices(), which took every other, perfectly healthy device down
    # with it - GET /api/2/devices returned nothing at all rather than just omitting the broken one.
    repo = _repo_with({
        'jriver1': _FakeDevice('jriver1', exc=ConnectionError('MCWS unreachable')),
        'sub1': _FakeDevice('sub1'),
    })

    result = repo.all_devices()

    assert set(result.keys()) == {'sub1'}
    assert result['sub1'].serialise() == {'name': 'sub1'}


def test_all_devices_recovers_a_previously_failing_device_once_it_stops_raising():
    jriver = _FakeDevice('jriver1', exc=ConnectionError('MCWS unreachable'))
    repo = _repo_with({'jriver1': jriver})

    assert repo.all_devices() == {}

    jriver.recover()
    result = repo.all_devices()

    assert set(result.keys()) == {'jriver1'}
