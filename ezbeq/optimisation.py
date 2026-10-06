import logging
from collections.abc import Callable
from dataclasses import dataclass

from ezbeq.catalogue import (
    CatalogueEntry,
    DeviceCatalogues,
    DeviceProfile,
    ProfileRequirement,
)

logger = logging.getLogger('ezbeq.optimisation')

OPTIMISATION_PROFILE_KEY = 'optimisationProfile'

FLOAT32 = 'float32'
FIXED = 'fixed'
PRECISIONS = frozenset({FLOAT32, FIXED})

# coefficients loaded into a slot
OPTIMISED = 'optimised'
STANDARD = 'standard'
UNOPTIMISED = 'unoptimised'

# reasons optimised coefficients are not in use
NO_PROFILE = 'no_profile'
PROFILE_UNAVAILABLE = 'profile_unavailable'
RATE_MISMATCH = 'rate_mismatch'
PRECISION_MISMATCH = 'precision_mismatch'


@dataclass(frozen=True)
class CoefficientFormat:
    """
    How a device realises biquads: its internal sample rate, coefficient precision (if known) and the beqcatalogue
    profile it uses by default (if any).
    """
    rate: int
    precision: str | None
    default_profile: str | None = None
    match_by_format: bool = False


@dataclass(frozen=True)
class LoadableCoefficients:
    biquads: list[list[str]] | None
    coefficients: str
    profile: str | None


def make_requirement(device_name: str, fmt: CoefficientFormat, cfg: dict) -> ProfileRequirement | None:
    """
    Resolves the device catalogue requirement for a device from its built-in format and the optional
    optimisationProfile config override (a profile id, or none to opt out).
    """
    if OPTIMISATION_PROFILE_KEY in cfg:
        override = cfg[OPTIMISATION_PROFILE_KEY]
        if override is None or override is False or str(override).lower() == 'none':
            logger.info(f'[{device_name}] Device optimisation disabled by config')
            return None
        logger.info(f'[{device_name}] Using configured device optimisation profile {override}')
        return ProfileRequirement(str(override), fmt.rate, fmt.precision)
    if fmt.default_profile:
        return ProfileRequirement(fmt.default_profile, fmt.rate, fmt.precision)
    if fmt.match_by_format and fmt.precision:
        return ProfileRequirement(None, fmt.rate, fmt.precision)
    return None


class DeviceOptimisation:
    """
    Decides whether a device that loads raw coefficients can, and should, use the optimised biquads published in a
    beqcatalogue device catalogue.
    """

    def __init__(self, device_name: str, fmt: CoefficientFormat, cfg: dict, catalogues: DeviceCatalogues | None,
                 on_change: Callable[[], None]):
        """
        :param on_change: called when the device catalogues change, as that may change this device's status.
        """
        self.__device_name = device_name
        self.__format = fmt
        self.__catalogues = catalogues
        self.__requirement = make_requirement(device_name, fmt, cfg)
        if self.__requirement and catalogues:
            catalogues.add_listener(on_change)
            catalogues.require(self.__requirement)

    def __status(self) -> tuple[DeviceProfile | None, str | None]:
        if not self.__requirement:
            return None, NO_PROFILE
        profile = self.__catalogues.resolve(self.__requirement) if self.__catalogues else None
        if not profile:
            return None, PROFILE_UNAVAILABLE
        if profile.rate != self.__format.rate:
            return profile, RATE_MISMATCH
        if self.__format.precision is not None and profile.storage != self.__format.precision:
            return profile, PRECISION_MISMATCH
        return profile, None

    @property
    def optimisable_profile(self) -> str | None:
        """
        :return: the profile whose optimised coefficients this device can load (whether or not it currently does).
        """
        profile, reason = self.__status()
        return profile.id if profile and reason is None else None

    def as_dict(self) -> dict:
        """
        :return: whether this device can load optimised coefficients and, if not, why not. Whether a particular slot
        does so is a per slot setting.
        """
        profile, reason = self.__status()
        return {
            'profile': profile.id if profile else (self.__requirement.profile_id if self.__requirement else None),
            'label': profile.label if profile else None,
            'available': profile is not None and reason is None,
            'reason': reason,
        }

    def describe(self, entry: CatalogueEntry) -> dict:
        """
        :param entry: the entry.
        :return: whether optimised coefficients are published for this entry in a profile this device can use.
        """
        profile, reason = self.__status()
        optimised = profile is not None and reason is None and self.__catalogues is not None \
            and self.__catalogues.optimised_biquads(profile.id, entry.digest, len(entry.filters)) is not None
        return {
            'applicable': True,
            'profile': profile.id if profile else None,
            'optimised': optimised,
        }

    def resolve(self, entry: CatalogueEntry, enabled: bool = True) -> LoadableCoefficients:
        """
        :param entry: the entry to load.
        :param enabled: whether the target slot uses optimised coefficients.
        :return: the optimised biquads to load, if any, and how to describe what was loaded.
        """
        profile, reason = self.__status()
        if profile is None or self.__catalogues is None:
            return LoadableCoefficients(None, UNOPTIMISED, None)
        biquads = self.__catalogues.optimised_biquads(profile.id, entry.digest, len(entry.filters))
        if biquads is None:
            return LoadableCoefficients(None, STANDARD if reason is None else UNOPTIMISED, profile.id)
        if reason is None and enabled:
            logger.info(f'[{self.__device_name}] Using {profile.id} optimised biquads for {entry.formatted_title}')
            return LoadableCoefficients(biquads, OPTIMISED, profile.id)
        return LoadableCoefficients(None, UNOPTIMISED, profile.id)
