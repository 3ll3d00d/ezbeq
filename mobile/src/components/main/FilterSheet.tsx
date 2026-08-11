import { useEffect, useMemo, useState } from 'react';
import { ScrollView, StyleSheet } from 'react-native';

import MultiSelectField from './MultiSelectField';
import type { EzbeqApi } from '../../services/ezbeqApi';
import type { CatalogueEntry } from '../../types/ezbeq';

const FRESHNESS = ['Fresh', 'Updated', 'Stale'];

export type FilterSelection = {
  contentTypes: string[];
  authors: string[];
  years: string[];
  audioTypes: string[];
  freshness: string[];
  languages: string[];
};

export const emptyFilterSelection: FilterSelection = {
  contentTypes: [],
  authors: [],
  years: [],
  audioTypes: [],
  freshness: [],
  languages: [],
};

type Props = {
  api: EzbeqApi;
  selection: FilterSelection;
  onChange: (next: FilterSelection) => void;
  filteredEntries: CatalogueEntry[];
  onError: (e: Error) => void;
};

const isInView =
  (values: string[]) =>
  (v: string): boolean =>
    values.length === 0 || values.includes(v);

// Presentation (bottom sheet on phone, persistent panel on tablet) is decided in a later step
// (ui/src/components/main/Filter.jsx's `visible` toggle becomes MainScreen's job too) - this
// just owns the six filter dimensions and their option-fetching/derived-in-view logic.
export default function FilterSheet({ api, selection, onChange, filteredEntries, onError }: Props) {
  const [authors, setAuthors] = useState<string[]>([]);
  const [languages, setLanguages] = useState<string[]>([]);
  const [years, setYears] = useState<string[]>([]);
  const [audioTypes, setAudioTypes] = useState<string[]>([]);
  const [contentTypes, setContentTypes] = useState<string[]>([]);

  useEffect(() => {
    api.getAuthors().then(setAuthors).catch(onError);
    api.getLanguages().then(setLanguages).catch(onError);
    api.getYears().then((ys) => setYears(ys.map(String))).catch(onError);
    api.getAudioTypes().then(setAudioTypes).catch(onError);
    api.getContentTypes().then(setContentTypes).catch(onError);
    // Fetched once per mounted FilterSheet - `api` is stable for the lifetime of a paired
    // server, and `onError` intentionally isn't a dependency (it would refetch on every
    // re-render of a parent that doesn't memoize its error handler).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [api]);

  const filteredYears = useMemo(
    () => [...new Set(filteredEntries.map((e) => String(e.year)))],
    [filteredEntries]
  );
  const filteredAudioTypes = useMemo(
    () => [...new Set(filteredEntries.flatMap((e) => e.audioTypes))],
    [filteredEntries]
  );
  const filteredFreshness = useMemo(
    () => [...new Set(filteredEntries.map((e) => e.freshness).filter((f): f is string => Boolean(f)))],
    [filteredEntries]
  );
  const filteredLanguages = useMemo(
    () => [...new Set(filteredEntries.map((e) => e.language).filter((l): l is string => Boolean(l)))],
    [filteredEntries]
  );

  return (
    <ScrollView style={styles.container}>
      <MultiSelectField
        label="Content Types"
        items={contentTypes}
        selectedValues={selection.contentTypes}
        onChange={(v) => onChange({ ...selection, contentTypes: v })}
      />
      <MultiSelectField
        label="Author"
        items={authors}
        selectedValues={selection.authors}
        onChange={(v) => onChange({ ...selection, authors: v })}
      />
      <MultiSelectField
        label="Year"
        items={years}
        selectedValues={selection.years}
        onChange={(v) => onChange({ ...selection, years: v })}
        isInView={isInView(filteredYears)}
      />
      <MultiSelectField
        label="Audio Types"
        items={audioTypes}
        selectedValues={selection.audioTypes}
        onChange={(v) => onChange({ ...selection, audioTypes: v })}
        isInView={isInView(filteredAudioTypes)}
      />
      <MultiSelectField
        label="Fresh"
        items={FRESHNESS}
        selectedValues={selection.freshness}
        onChange={(v) => onChange({ ...selection, freshness: v })}
        isInView={isInView(filteredFreshness)}
      />
      <MultiSelectField
        label="Language"
        items={languages}
        selectedValues={selection.languages}
        onChange={(v) => onChange({ ...selection, languages: v })}
        isInView={isInView(filteredLanguages)}
      />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    padding: 8,
  },
});
