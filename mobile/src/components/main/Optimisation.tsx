import { useEffect, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { Chip, Switch, Text, useTheme } from 'react-native-paper';

import type { EzbeqApi } from '../../services/ezbeqApi';
import type { CatalogueEntry, DeviceOptimisation, DeviceState, EntryOptimisation, SlotState } from '../../types/ezbeq';

// Ported from ui/src/components/main/Optimisation.jsx. Mobile has no hover tooltips so the reason
// optimised filters are not in use is shown as text beside the warning instead.
const REASONS: Record<string, string> = {
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

// true if filters loaded into the slot will use optimised coefficients when they're available, slots
// which don't report the setting are treated as optimising.
export const slotOptimises = (slot: SlotState | null | undefined): boolean => Boolean(slot) && slot?.optimise !== false;

type ControlProps = {
  api: EzbeqApi;
  device: DeviceState;
  selectedSlotId: string | null;
  onDeviceUpdate: (device: DeviceState) => void;
  onError: (e: Error) => void;
};

// Compact control over the use of device optimised coefficients by the selected slot, sits in the
// master volume row. Only shown for devices which load coefficients (i.e. those which report an
// optimisation status); a device which cannot use optimised filters, or no slot selected, shows a
// disabled switch whose accessibility label explains why.
export function OptimisationControl({ api, device, selectedSlotId, onDeviceUpdate, onError }: ControlProps) {
  const [pending, setPending] = useState(false);
  const optimisation = device.optimisation;
  if (!optimisation) return null;
  const slot = device.slots?.find((s) => s.id === selectedSlotId) ?? null;

  const toggle = async (enabled: boolean) => {
    if (!slot) return;
    setPending(true);
    try {
      onDeviceUpdate(await api.setOptimise(device.name, slot.id, enabled));
    } catch (e) {
      onError(e as Error);
    } finally {
      setPending(false);
    }
  };

  const reason = describeReason(optimisation);
  const slotName = slot ? `slot ${slot.name ?? slot.id}` : 'the selected slot';
  const description =
    reason ?? `Load filters optimised for ${optimisation.label ?? 'this device'} into ${slotName}`;
  return (
    <View style={styles.control}>
      <Switch
        value={optimisation.available && slotOptimises(slot)}
        disabled={pending || !optimisation.available || !slot}
        onValueChange={toggle}
        accessibilityLabel={description}
        testID="optimisation-switch"
      />
      <Text variant="labelSmall">Optimise</Text>
    </View>
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
  }, [api, deviceName, entryId, profile, reason]);
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
  const profile = optimisable ? device?.optimisation?.profile : null;
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
// optimise is whether the slot the entry will be uploaded to uses optimised coefficients.
export function EntryOptimisationChip({
  entryOptimisation,
  optimise = true,
}: {
  entryOptimisation: EntryOptimisation | null;
  optimise?: boolean;
}) {
  if (!entryOptimisation || !entryOptimisation.optimised) return null;
  if (optimise) {
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
  control: {
    alignItems: 'center',
  },
  chip: {
    alignSelf: 'flex-start',
  },
});
