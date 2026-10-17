import { useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, ScrollView, StyleSheet, View } from 'react-native';
import { Button, Chip, IconButton, Modal, Portal, SegmentedButtons, Text, useTheme } from 'react-native-paper';
import Svg, { Line } from 'react-native-svg';

import ResponseChart, { type ChartSeries } from './ResponseChart';
import { cascadeResponseDb, logSpace } from '../../services/biquad';
import type { EzbeqApi } from '../../services/ezbeqApi';
import type { CatalogueEntry, FilterParams } from '../../types/ezbeq';

const COLOURS = ['#2f6fed', '#e0523c', '#3fae5c', '#c9931f', '#8956d6', '#1fa3a3', '#d64f8a', '#6b7280'];
// once the colours run out, repeat them with a different dash so every series stays distinguishable
const DASHES: (number[] | null)[] = [null, [6, 4], [2, 3], [8, 3, 2, 3]];
const FREQS = logSpace(1, 200, 200);

type Mode = 'response' | 'difference';

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

type Props = {
  api: EzbeqApi;
  selectedEntry: CatalogueEntry;
  matches: CatalogueEntry[];
  onSelect: (id: number) => void;
  onClose: () => void;
  onError: (e: Error) => void;
};

// Ported from ui/src/components/main/Compare.jsx, always using its compact (phone) layout: a list
// rather than a table, and no chart legend since each row carries its series' swatch.
export default function CompareSheet({ api, selectedEntry, matches, onSelect, onClose, onError }: Props) {
  const theme = useTheme();
  const [filtersById, setFiltersById] = useState<Record<string, FilterParams[]> | null>(null);
  const [failed, setFailed] = useState(false);
  const [mode, setMode] = useState<Mode>('response');
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

  const styleOf = (idx: number) =>
    idx === 0
      ? { colour: theme.colors.onSurface, dash: null, width: 3 }
      : {
          colour: COLOURS[(idx - 1) % COLOURS.length],
          dash: DASHES[Math.floor((idx - 1) / COLOURS.length) % DASHES.length],
          width: 1.5,
        };

  const series = useMemo(() => {
    const plotted: ChartSeries[] = [];
    all.forEach((e, idx) => {
      const response = responses ? responses[idx] : null;
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
          <SegmentedButtons
            value={mode}
            onValueChange={(v) => setMode(v as Mode)}
            style={styles.toggle}
            buttons={[
              { value: 'response', label: 'Response' },
              { value: 'difference', label: 'Difference', disabled: base === null },
            ]}
          />
          {failed ? (
            <Text variant="bodyMedium" style={[styles.message, { color: theme.colors.error }]}>
              Unable to load filters
            </Text>
          ) : responses ? (
            <ResponseChart freqs={FREQS} series={series} yLabel={showDifference ? 'Δ dB' : 'dB'} />
          ) : (
            <ActivityIndicator style={styles.message} />
          )}
          {all.map((e, idx) => {
            const filters = filtersById ? filtersById[String(e.id)] : null;
            const response = responses ? responses[idx] : null;
            const diff = idx > 0 && base && response ? maxDifference(base, response) : null;
            const { colour, dash, width } = styleOf(idx);
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
                <Svg width={20} height={6} style={styles.swatch}>
                  <Line
                    x1={0}
                    y1={3}
                    x2={20}
                    y2={3}
                    stroke={colour}
                    strokeWidth={width + 1}
                    strokeDasharray={dash ?? undefined}
                  />
                </Svg>
                <View style={styles.rowText}>
                  <Text variant="bodyLarge">
                    {e.author} — {(e.audioTypes || []).join(', ')}
                  </Text>
                  {details.length > 0 ? <Text variant="bodySmall">{details.join(' • ')}</Text> : null}
                </View>
                {idx === 0 ? (
                  <Chip compact>Selected</Chip>
                ) : (
                  <Button mode="outlined" compact onPress={() => select(e.id)}>
                    Select
                  </Button>
                )}
              </View>
            );
          })}
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
