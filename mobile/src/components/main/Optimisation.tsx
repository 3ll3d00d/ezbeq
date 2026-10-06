import { useEffect, useState } from 'react';
import { StyleSheet } from 'react-native';
import { Chip, Switch, useTheme } from 'react-native-paper';

import type { EzbeqApi } from '../../services/ezbeqApi';
import type { CatalogueEntry, DeviceOptimisation, DeviceState, EntryOptimisation, SlotState } from '../../types/ezbeq';

// Ported from ui/src/components/main/Optimisation.jsx. Mobile has no hover tooltips so the reason
// optimised filters are not in use is shown as text beside the warning instead.
const REASONS: Record<string, string> = {
  disabled: 'Device optimised filters are switched off so the authored coefficients are loaded',
  no_profile: 'No optimised filters are published for this device so the authored coefficients are loaded',
  profile_unavailable:
    'The optimised filters for this device have not been downloaded so the authored coefficients are loaded',
  rate_mismatch:
    'The configured optimisation profile does not match the sample rate of this device so the authored coefficients are loaded',
  precision_mismatch:
    'The configured optimisation profile does not match the coefficient precision of this device so the authored coefficients are loaded',
};

export const describeReason = (optimisation: DeviceOptimisation | null | undefined): string | null => {
  if (!optimisation || !optimisation.reason) return null;
  const txt = REASONS[optimisation.reason] ?? `Optimised filters are not in use (${optimisation.reason})`;
  return optimisation.member ? `${optimisation.member}: ${txt}` : txt;
};

function UnoptimisedChip({ accessibilityLabel }: { accessibilityLabel: string }) {
  const theme = useTheme();
  return (
    <Chip
      compact
      mode="outlined"
      icon="alert-outline"
      style={styles.chip}
      textStyle={{ color: theme.colors.error }}
      accessibilityLabel={accessibilityLabel}
    >
      Unoptimised
    </Chip>
  );
}

type ControlProps = {
  api: EzbeqApi;
  device: DeviceState;
  onDeviceUpdate: (device: DeviceState) => void;
  onError: (e: Error) => void;
};

// Compact device level control over the use of device optimised coefficients, sits in the master
// volume row. Only shown for devices which load coefficients (i.e. those which report an
// optimisation status); a device which cannot use optimised filters shows a disabled switch whose
// accessibility label explains why.
export function OptimisationControl({ api, device, onDeviceUpdate, onError }: ControlProps) {
  const [pending, setPending] = useState(false);
  const optimisation = device.optimisation;
  if (!optimisation) return null;

  const toggle = async (enabled: boolean) => {
    setPending(true);
    try {
      onDeviceUpdate(await api.setOptimisationEnabled(device.name, enabled));
    } catch (e) {
      onError(e as Error);
    } finally {
      setPending(false);
    }
  };

  const reason = describeReason(optimisation);
  const label = optimisation.label ? `Use optimised filters (${optimisation.label})` : 'Use optimised filters';
  return (
    <Switch
      value={optimisation.available && optimisation.enabled}
      disabled={pending || !optimisation.available}
      onValueChange={toggle}
      accessibilityLabel={reason ?? label}
      testID="optimisation-switch"
    />
  );
}

// Shows which coefficients are loaded in a slot, nothing for standard coefficients or when unknown.
export function SlotCoefficientsChip({ slot }: { slot: SlotState }) {
  if (slot.coefficients === 'optimised') {
    return (
      <Chip
        compact
        mode="outlined"
        icon="tune"
        style={styles.chip}
        accessibilityLabel={`Loaded with coefficients optimised for ${slot.profile}`}
      >
        Optimised
      </Chip>
    );
  }
  if (slot.coefficients === 'unoptimised') {
    return <UnoptimisedChip accessibilityLabel="Loaded with coefficients which are not optimised for this device" />;
  }
  return null;
}

// Looks up whether the selected entry has optimised coefficients for the selected device. Keyed on
// the optimisation status rather than the whole device so unrelated device updates don't refetch.
export const useEntryOptimisation = (
  api: EzbeqApi,
  device: DeviceState | null,
  entry: CatalogueEntry | null
): EntryOptimisation | null => {
  const [result, setResult] = useState<EntryOptimisation | null>(null);
  const deviceName = device?.name ?? null;
  const enabled = device?.optimisation?.enabled ?? null;
  const profile = device?.optimisation?.profile ?? null;
  const reason = device?.optimisation?.reason ?? null;
  const entryId = entry ? String(entry.id) : null;
  useEffect(() => {
    let cancelled = false;
    setResult(null);
    if (deviceName && entryId && profile) {
      api
        .getEntryOptimisation(deviceName, entryId)
        .then((r) => {
          if (!cancelled) setResult(r);
        })
        .catch(() => {
          if (!cancelled) setResult(null);
        });
    }
    return () => {
      cancelled = true;
    };
  }, [api, deviceName, entryId, enabled, profile, reason]);
  return result;
};

export const OPTIMISED = 'optimised';
export const NOT_OPTIMISED = 'unoptimised';
export type OptimisationSearch = typeof OPTIMISED | typeof NOT_OPTIMISED | null;

// true if the device can load optimised coefficients, i.e. whether searching by optimisation means
// anything for this device.
export const isOptimisable = (device: DeviceState | null): boolean =>
  Boolean(device?.optimisation?.profile && device.optimisation.available);

// Loads the ids of the catalogue entries with optimised coefficients for the device, only while a
// search on optimisation is active. Returns null if not searching or not loaded.
export const useOptimisedEntryIds = (
  api: EzbeqApi | null,
  device: DeviceState | null,
  selectedOptimisation: OptimisationSearch,
  meta: unknown,
  onError: (e: Error) => void
): ReadonlySet<string> | null => {
  const [ids, setIds] = useState<ReadonlySet<string> | null>(null);
  const optimisable = isOptimisable(device);
  const deviceName = device?.name ?? null;
  const profile = optimisable ? (device?.optimisation?.profile ?? null) : null;
  const active = Boolean(selectedOptimisation) && optimisable;
  useEffect(() => {
    let cancelled = false;
    setIds(null);
    if (api && active && deviceName) {
      api
        .getOptimisedEntries(deviceName)
        .then((r) => {
          if (!cancelled) setIds(new Set(r.ids));
        })
        .catch((e) => {
          if (!cancelled) onError(e as Error);
        });
    }
    return () => {
      cancelled = true;
    };
    // meta changes when the catalogue is reloaded, which changes the entry ids; onError is
    // deliberately not a dependency (it would refetch whenever a parent re-creates it)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [api, active, deviceName, profile, meta]);
  return ids;
};

// Flags an entry with optimised coefficients for the selected device, and whether they will be used.
export function EntryOptimisationChip({ entryOptimisation }: { entryOptimisation: EntryOptimisation | null }) {
  if (!entryOptimisation || !entryOptimisation.optimised) return null;
  if (entryOptimisation.inUse) {
    return (
      <Chip
        compact
        mode="outlined"
        icon="tune"
        style={styles.chip}
        accessibilityLabel={`Coefficients optimised for ${entryOptimisation.profile} will be loaded`}
      >
        Optimised for this device
      </Chip>
    );
  }
  return (
    <UnoptimisedChip accessibilityLabel="Coefficients optimised for this device are available but optimised filters are switched off" />
  );
}

const styles = StyleSheet.create({
  chip: {
    alignSelf: 'flex-start',
  },
});
