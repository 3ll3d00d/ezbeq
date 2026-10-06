import { useEffect, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { Chip, Switch, Text, useTheme } from 'react-native-paper';

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

// Device level control over the use of device optimised coefficients, only shown for devices which
// load coefficients (i.e. those which report an optimisation status).
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
    <View style={styles.control} testID="optimisation-control">
      {optimisation.available ? (
        <View style={styles.row}>
          <Switch
            value={optimisation.enabled}
            disabled={pending}
            onValueChange={toggle}
            accessibilityLabel={label}
            testID="optimisation-switch"
          />
          <Text variant="bodyMedium" style={styles.label}>
            {label}
          </Text>
        </View>
      ) : null}
      {reason ? (
        <View style={styles.row}>
          <UnoptimisedChip accessibilityLabel={reason} />
          <Text variant="bodySmall" style={styles.label}>
            {reason}
          </Text>
        </View>
      ) : null}
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
  control: {
    paddingHorizontal: 8,
    paddingTop: 4,
    gap: 4,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  label: {
    flex: 1,
  },
  chip: {
    alignSelf: 'flex-start',
  },
});
