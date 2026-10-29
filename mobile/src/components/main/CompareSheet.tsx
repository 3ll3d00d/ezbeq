import { useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, ScrollView, StyleSheet, View } from 'react-native';
import { Button, Chip, IconButton, Modal, Portal, SegmentedButtons, Text, useTheme } from 'react-native-paper';
import Svg, { Line } from 'react-native-svg';

import ResponseChart, { type ChartSeries } from './ResponseChart';
import { cascadeResponseDb, coefficientResponseDb, logSpace } from '../../services/biquad';
import type { EzbeqApi } from '../../services/ezbeqApi';
import type { CatalogueEntry, EntryCoefficients, FilterParams } from '../../types/ezbeq';

const COLOURS = ['#2f6fed', '#e0523c', '#3fae5c', '#c9931f', '#8956d6', '#1fa3a3', '#d64f8a', '#6b7280'];
// once the colours run out, repeat them with a different dash so every series stays distinguishable
const DASHES: (number[] | null)[] = [null, [6, 4], [2, 3], [8, 3, 2, 3]];
const FREQS = logSpace(1, 200, 200);

type Mode = 'response' | 'difference';
type CompareView = 'releases' | 'optimisation';
type Style = { colour: string; dash: number[] | null; width: number };

export const variantLabel = (entry: CatalogueEntry): string => {
  const parts: string[] = [];
  if (entry.season) parts.push(`S${entry.season}${entry.episode ? `E${entry.episode}` : ''}`);
  if (entry.edition) parts.push(entry.edition);
  return parts.join(' • ');
};

// largest absolute deviation between two responses, as {db, freq}
export const maxDifference = (
  base: number[],
  other: number[],
  freqs: number[] = FREQS
): { db: number; freq: number | null } => {
  let worst: { db: number; freq: number | null } = { db: 0, freq: null };
  other.forEach((v, i) => {
    const delta = v - base[i];
    if (Math.abs(delta) > Math.abs(worst.db)) worst = { db: delta, freq: freqs[i] };
  });
  return worst;
};

const formatDb = (v: number) => `${v > 0 ? '+' : ''}${v.toFixed(1)} dB`;

const Swatch = ({ colour, dash, width }: Style) => (
  <Svg width={20} height={6} style={styles.swatch}>
    <Line x1={0} y1={3} x2={20} y2={3} stroke={colour} strokeWidth={width + 1} strokeDasharray={dash ?? undefined} />
  </Svg>
);

const ModeToggle = ({ mode, setMode, canDiff }: { mode: Mode; setMode: (m: Mode) => void; canDiff: boolean }) => (
  <SegmentedButtons
    value={mode}
    onValueChange={(v) => setMode(v as Mode)}
    style={styles.toggle}
    buttons={[
      { value: 'response', label: 'Response' },
      { value: 'difference', label: 'Difference', disabled: !canDiff },
    ]}
  />
);

// the chart, a failure or a spinner while loading
const Plot = ({ series, failed, yLabel }: { series: ChartSeries[] | null; failed: boolean; yLabel: string }) => {
  const theme = useTheme();
  if (failed) {
    return (
      <Text variant="bodyMedium" style={[styles.message, { color: theme.colors.error }]}>
        Unable to load filters
      </Text>
    );
  }
  return series ? <ResponseChart freqs={FREQS} series={series} yLabel={yLabel} /> : <ActivityIndicator style={styles.message} />;
};

type ViewProps = {
  api: EzbeqApi;
  selectedEntry: CatalogueEntry;
  mode: Mode;
  setMode: (m: Mode) => void;
  onError: (e: Error) => void;
};

// the selected entry against the other releases of the same title
const ReleaseComparison = ({
  api,
  selectedEntry,
  matches,
  mode,
  setMode,
  onSelect,
  onError,
}: ViewProps & { matches: CatalogueEntry[]; onSelect: (id: number) => void }) => {
  const theme = useTheme();
  const [filtersById, setFiltersById] = useState<Record<string, FilterParams[]> | null>(null);
  const [failed, setFailed] = useState(false);
  const all = useMemo(() => [selectedEntry, ...matches], [selectedEntry, matches]);
  // a catalogue refresh produces new entry objects for the same ids, which shouldn't trigger a reload
  const idsKey = all.map((e) => String(e.id)).join('\n');

  useEffect(() => {
    let cancelled = false;
    setFailed(false);
    api
      .getFilters(idsKey.split('\n'))
      .then((results) => {
        if (!cancelled) setFiltersById(Object.fromEntries(results.map((r) => [r.id, r.filters])));
      })
      .catch((e) => {
        if (cancelled) return;
        setFailed(true);
        onError(e as Error);
      });
    return () => {
      cancelled = true;
    };
  }, [api, idsKey, onError]);

  const responses = useMemo(
    () =>
      filtersById
        ? all.map((e) => {
            const filters = filtersById[String(e.id)];
            return filters ? cascadeResponseDb(filters, FREQS) : null;
          })
        : null,
    [all, filtersById]
  );
  const base = responses ? responses[0] : null;
  const showDifference = mode === 'difference' && base !== null;

  const styleOf = (idx: number): Style =>
    idx === 0
      ? { colour: theme.colors.onSurface, dash: null, width: 3 }
      : {
          colour: COLOURS[(idx - 1) % COLOURS.length],
          dash: DASHES[Math.floor((idx - 1) / COLOURS.length) % DASHES.length],
          width: 1.5,
        };

  const series = useMemo(() => {
    if (!responses) return null;
    const plotted: ChartSeries[] = [];
    all.forEach((e, idx) => {
      const response = responses[idx];
      if (!response) return;
      plotted.push({
        key: String(e.id),
        values: showDifference && base ? response.map((v, i) => v - base[i]) : response,
        ...styleOf(idx),
      });
    });
    return plotted;
    // styleOf only depends on the theme
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [all, responses, base, showDifference, theme]);

  return (
    <>
      <ModeToggle mode={mode} setMode={setMode} canDiff={base !== null} />
      <Plot series={series} failed={failed} yLabel={showDifference ? 'Δ dB' : 'dB'} />
      {all.map((e, idx) => {
        const filters = filtersById ? filtersById[String(e.id)] : null;
        const response = responses ? responses[idx] : null;
        const diff = idx > 0 && base && response ? maxDifference(base, response) : null;
        const details = [
          variantLabel(e),
          e.mvAdjust ? `MV ${formatDb(Number(e.mvAdjust))}` : '',
          filters ? `${filters.reduce((t, f) => t + (f.count || 1), 0)} filters` : '',
          // no freq means the responses are identical
          diff ? `max diff ${diff.freq ? `${formatDb(diff.db)} @ ${diff.freq.toFixed(0)} Hz` : formatDb(0)}` : '',
        ].filter(Boolean);
        return (
          <View
            key={String(e.id)}
            testID={`compare-row-${e.id}`}
            style={[
              styles.row,
              { borderBottomColor: theme.colors.outlineVariant },
              idx === 0 ? { backgroundColor: theme.colors.surfaceVariant } : null,
            ]}
          >
            <Swatch {...styleOf(idx)} />
            <View style={styles.rowText}>
              <Text variant="bodyLarge">
                {e.author} — {(e.audioTypes || []).join(', ')}
              </Text>
              {details.length > 0 ? <Text variant="bodySmall">{details.join(' • ')}</Text> : null}
            </View>
            {idx === 0 ? (
              <Chip compact>Selected</Chip>
            ) : (
              <Button mode="outlined" compact onPress={() => onSelect(e.id)}>
                Select
              </Button>
            )}
          </View>
        );
      })}
    </>
  );
};

type OptimisationKey = 'ideal' | 'unoptimised' | 'optimised';

// the authored coefficients as published (ideal), the authored and the optimised coefficients each as realised by the
// device, null while loading
export const optimisationResponses = (
  coefficients: EntryCoefficients | null
): Record<OptimisationKey, number[]> | null => {
  if (!coefficients) return null;
  // only float32 storage is modelled, anything else is treated as exact
  const quantise = coefficients.precision === 'float32' ? Math.fround : undefined;
  return {
    ideal: coefficientResponseDb(coefficients.authored, FREQS, coefficients.rate),
    unoptimised: coefficientResponseDb(coefficients.authored, FREQS, coefficients.rate, quantise),
    optimised: coefficientResponseDb(coefficients.optimised, FREQS, coefficients.rate, quantise),
  };
};

const OPTIMISATION_SERIES: { key: OptimisationKey; label: string; width: number; dash?: number[] | null }[] = [
  { key: 'ideal', label: 'Ideal', width: 3 },
  { key: 'unoptimised', label: 'Unoptimised (as loaded)', width: 1.5 },
  { key: 'optimised', label: 'Optimised (as loaded)', width: 1.5, dash: DASHES[1] },
];

// the selected entry's authored coefficients against those optimised for the device
const OptimisationComparison = ({
  api,
  selectedEntry,
  deviceName,
  mode,
  setMode,
  onError,
}: ViewProps & { deviceName: string }) => {
  const theme = useTheme();
  const [coefficients, setCoefficients] = useState<EntryCoefficients | null>(null);
  const [failed, setFailed] = useState(false);
  const entryId = String(selectedEntry.id);

  useEffect(() => {
    let cancelled = false;
    setFailed(false);
    setCoefficients(null);
    api
      .getEntryCoefficients(deviceName, entryId)
      .then((r) => {
        if (!cancelled) setCoefficients(r);
      })
      .catch((e) => {
        if (cancelled) return;
        setFailed(true);
        onError(e as Error);
      });
    return () => {
      cancelled = true;
    };
  }, [api, deviceName, entryId, onError]);

  const responses = useMemo(() => optimisationResponses(coefficients), [coefficients]);
  const showDifference = mode === 'difference';
  const colours: Record<OptimisationKey, string> = {
    ideal: theme.colors.onSurface,
    unoptimised: COLOURS[1],
    optimised: COLOURS[2],
  };
  const styleOf = (s: (typeof OPTIMISATION_SERIES)[number]): Style => ({
    colour: colours[s.key],
    dash: s.dash ?? null,
    width: s.width,
  });

  const series = useMemo(
    () =>
      responses
        ? OPTIMISATION_SERIES.map((s) => ({
            key: s.key,
            values: showDifference ? responses[s.key].map((v, i) => v - responses.ideal[i]) : responses[s.key],
            ...styleOf(s),
          }))
        : null,
    // styleOf only depends on the theme
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [responses, showDifference, theme]
  );

  return (
    <>
      <ModeToggle mode={mode} setMode={setMode} canDiff={responses !== null} />
      {coefficients ? (
        <Text variant="bodySmall" style={styles.note}>
          As loaded by {deviceName} ({coefficients.label}), the unoptimised filters are the authored coefficients and
          the optimised filters are those published for this device.
        </Text>
      ) : null}
      <Plot series={series} failed={failed} yLabel={showDifference ? 'Δ dB' : 'dB'} />
      {OPTIMISATION_SERIES.map((s) => {
        const err = responses && s.key !== 'ideal' ? maxDifference(responses.ideal, responses[s.key]) : null;
        return (
          <View
            key={s.key}
            testID={`compare-row-${s.key}`}
            style={[styles.row, { borderBottomColor: theme.colors.outlineVariant }]}
          >
            <Swatch {...styleOf(s)} />
            <View style={styles.rowText}>
              <Text variant="bodyLarge">{s.label}</Text>
              {err ? (
                <Text variant="bodySmall">
                  {`max error ${err.freq ? `${formatDb(err.db)} @ ${err.freq.toFixed(0)} Hz` : formatDb(0)}`}
                </Text>
              ) : null}
            </View>
          </View>
        );
      })}
    </>
  );
};

type Props = {
  api: EzbeqApi;
  selectedEntry: CatalogueEntry;
  matches: CatalogueEntry[];
  // the device to compare against the coefficients optimised for, when the entry is optimised for it
  deviceName?: string | null;
  optimised?: boolean;
  onSelect: (id: number) => void;
  onClose: () => void;
  onError: (e: Error) => void;
};

// Ported from ui/src/components/main/Compare.jsx, always using its compact (phone) layout: a list
// rather than a table, and no chart legend since each row carries its series' swatch.
export default function CompareSheet({
  api,
  selectedEntry,
  matches,
  deviceName,
  optimised,
  onSelect,
  onClose,
  onError,
}: Props) {
  const theme = useTheme();
  const views: CompareView[] = [];
  if (matches.length > 0) views.push('releases');
  if (optimised && deviceName) views.push('optimisation');
  const [selectedView, setView] = useState<CompareView>(views[0]);
  const view = views.includes(selectedView) ? selectedView : views[0];
  const [mode, setMode] = useState<Mode>('response');

  const select = (id: number) => {
    onSelect(id);
    onClose();
  };

  return (
    <Portal>
      <Modal
        visible
        onDismiss={onClose}
        contentContainerStyle={[styles.modal, { backgroundColor: theme.colors.elevation.level3 }]}
      >
        <View style={styles.header}>
          <Text variant="titleLarge" style={styles.title}>
            Compare: {selectedEntry.title || selectedEntry.formattedTitle}
            {selectedEntry.year ? ` (${selectedEntry.year})` : ''}
          </Text>
          <IconButton icon="close" accessibilityLabel="Close" onPress={onClose} />
        </View>
        <ScrollView>
          {views.length > 1 ? (
            <SegmentedButtons
              value={view}
              onValueChange={(v) => setView(v as CompareView)}
              style={styles.toggle}
              buttons={[
                { value: 'releases', label: `Releases (${matches.length})` },
                { value: 'optimisation', label: 'Optimised' },
              ]}
            />
          ) : null}
          {view === 'optimisation' && deviceName ? (
            <OptimisationComparison
              api={api}
              selectedEntry={selectedEntry}
              deviceName={deviceName}
              mode={mode}
              setMode={setMode}
              onError={onError}
            />
          ) : (
            <ReleaseComparison
              api={api}
              selectedEntry={selectedEntry}
              matches={matches}
              mode={mode}
              setMode={setMode}
              onSelect={select}
              onError={onError}
            />
          )}
        </ScrollView>
      </Modal>
    </Portal>
  );
}

const styles = StyleSheet.create({
  // See WhatsNewSheet's matching `modal` style, wider since the chart benefits from the room
  modal: {
    margin: 16,
    marginTop: 48,
    marginBottom: 48,
    padding: 12,
    borderRadius: 8,
    flex: 1,
    width: '100%',
    maxWidth: 720,
    alignSelf: 'center',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  title: {
    flex: 1,
  },
  toggle: {
    marginBottom: 8,
  },
  note: {
    marginBottom: 8,
  },
  message: {
    padding: 24,
    textAlign: 'center',
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 8,
    paddingHorizontal: 4,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  swatch: {
    marginRight: 8,
  },
  rowText: {
    flex: 1,
    marginRight: 8,
  },
});
