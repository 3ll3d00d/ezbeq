import { useEffect, useState } from 'react';
import { Image, type NativeSyntheticEvent, type ImageLoadEventData, Linking, ScrollView, StyleSheet, View } from 'react-native';
import { Button, Card, Text, useTheme } from 'react-native-paper';

import UploaderControls from './UploaderControls';
import type { EzbeqApi } from '../../services/ezbeqApi';
import type { CatalogueEntry, DeviceState } from '../../types/ezbeq';

type Props = {
  api: EzbeqApi;
  selectedEntry: CatalogueEntry | null;
  selectedDevice: DeviceState | null;
  selectedSlotId: string | null;
  onDeviceUpdate: (device: DeviceState) => void;
  onError: (e: Error) => void;
  onSuccess: (message: string) => void;
  onUploadPendingSlotChange?: (slotId: string | null) => void;
};

// Ported from ui/src/components/main/Entry.jsx. Web renders content/uploadAction/links in a
// different order for wide vs narrow layouts; mobile is narrow-first by nature, so this always
// uses that ordering (uploader controls above the entry's own details) rather than branching -
// the wide/tablet variant is the responsive layout step's concern, not this component's.
const formatExtraMeta = (entry: CatalogueEntry): string | null => {
  const extras: string[] = [];
  if (entry.rating) extras.push(entry.rating);
  if (entry.runtime) extras.push(`${Math.floor(entry.runtime / 60)}h ${entry.runtime % 60}m`);
  if (entry.language && entry.language !== 'English') extras.push(entry.language);
  if (entry.genres && entry.genres.length > 0) extras.push(entry.genres.join(', '));
  extras.push(entry.author);
  return extras.join(' • ');
};

const formatTV = (entry: CatalogueEntry): string | null => {
  if (!entry.season) return null;
  if (entry.episodes) {
    const isDigits = /^\d+$/.test(entry.episodes);
    return isDigits ? `S${entry.season} E${entry.episodes}` : `S${entry.season} ${entry.episodes}`;
  }
  return `S${entry.season}`;
};

const formatMV = (entry: CatalogueEntry): string | null => {
  if (!entry.mvAdjust) return null;
  return `MV Adjustment: ${entry.mvAdjust > 0 ? '+' : ''}${entry.mvAdjust} dB`;
};

// Card.Cover forces a fixed-height, crop-to-fill box, which chopped the top/bottom off poster
// art. Web's plain <img> (Entry.jsx) shows each image at its natural aspect ratio, full width, so
// mirror that here: scale to the card's width and let height follow the image's own proportions,
// falling back to a plausible ratio until onLoad reports the real one (RN can't know a remote
// image's dimensions ahead of decode without Image.getSize, which isn't safely mockable here -
// jest-expo's mock targets the legacy bridge shape and crashes the whole worker under the new
// architecture's Promise-based NativeImageLoaderAndroid).
function EntryImage({ uri, testID, backgroundColor }: { uri: string; testID: string; backgroundColor: string }) {
  const [aspectRatio, setAspectRatio] = useState(16 / 9);

  const onLoad = (e: NativeSyntheticEvent<ImageLoadEventData>) => {
    const { width, height } = e.nativeEvent.source;
    if (width > 0 && height > 0) setAspectRatio(width / height);
  };

  return (
    <Image
      testID={testID}
      source={{ uri }}
      resizeMode="contain"
      style={[styles.image, { aspectRatio, backgroundColor }]}
      onLoad={onLoad}
    />
  );
}

export default function EntryDetail({
  api,
  selectedEntry,
  selectedDevice,
  selectedSlotId,
  onDeviceUpdate,
  onError,
  onSuccess,
  onUploadPendingSlotChange,
}: Props) {
  const theme = useTheme();
  const [uploadSlotId, setUploadSlotId] = useState<string | null>(null);
  const [sendGain, setSendGain] = useState(false);
  const [pending, setPending] = useState(false);

  useEffect(() => {
    setSendGain(false);
  }, [selectedEntry]);

  useEffect(() => {
    if (!uploadSlotId && selectedSlotId) {
      setUploadSlotId(selectedSlotId);
    }
  }, [uploadSlotId, selectedSlotId]);

  const uploadSlot = selectedDevice?.slots?.find((s) => s.id === uploadSlotId) ?? null;
  const acceptGain = Boolean(uploadSlot?.gains && uploadSlot.gains.length > 0);

  const upload = async () => {
    if (!selectedDevice || !selectedEntry || !uploadSlotId || !uploadSlot) return;

    const gains = acceptGain
      ? {
          gains: (uploadSlot.gains ?? []).map((g) => ({
            id: g.id,
            value: sendGain && selectedEntry.mvAdjust ? selectedEntry.mvAdjust : 0.0,
          })),
          mutes: sendGain ? (uploadSlot.mutes ?? []).map((m) => ({ id: m.id, value: false })) : [],
        }
      : null;

    setPending(true);
    onUploadPendingSlotChange?.(uploadSlotId);
    try {
      const updated = gains
        ? await api.loadWithMV(selectedDevice.name, String(selectedEntry.id), uploadSlotId, gains)
        : await api.sendFilter(selectedDevice.name, String(selectedEntry.id), uploadSlotId);
      onDeviceUpdate(updated);
      onSuccess('Filter loaded');
    } catch (e) {
      onError(e as Error);
    } finally {
      setPending(false);
      onUploadPendingSlotChange?.(null);
    }
  };

  if (!selectedEntry) return null;

  const extraMeta = formatExtraMeta(selectedEntry);
  const secondaryLines = [
    formatTV(selectedEntry),
    ...selectedEntry.audioTypes,
    formatMV(selectedEntry),
    selectedEntry.note,
    selectedEntry.warning ? `Warning: ${selectedEntry.warning}` : null,
  ].filter((line): line is string => Boolean(line));

  const openLink = (url?: string) => {
    if (url) Linking.openURL(url);
  };

  return (
    <ScrollView style={styles.container}>
      <Card>
        <Card.Content>
          {selectedDevice ? (
            <UploaderControls
              slots={selectedDevice.slots ?? []}
              uploadSlotId={uploadSlotId}
              setUploadSlotId={setUploadSlotId}
              sendGain={sendGain}
              setSendGain={setSendGain}
              acceptGain={acceptGain}
              gainAdjustAvailable={Boolean(selectedEntry.mvAdjust)}
              pending={pending}
              onUpload={upload}
            />
          ) : null}

          <Text variant="titleLarge">
            {(selectedEntry.title ?? selectedEntry.formattedTitle) + (selectedEntry.year ? ` (${selectedEntry.year})` : '')}
          </Text>
          {selectedEntry.edition ? <Text variant="titleMedium">{selectedEntry.edition}</Text> : null}
          {selectedEntry.altTitle && selectedEntry.altTitle !== selectedEntry.title ? (
            <Text variant="titleMedium">{selectedEntry.altTitle}</Text>
          ) : null}
          {extraMeta ? <Text variant="bodyLarge">{extraMeta}</Text> : null}
          {selectedEntry.overview ? <Text variant="bodyMedium">{selectedEntry.overview}</Text> : null}
          {secondaryLines.length > 0 ? (
            <Text variant="bodySmall" style={styles.secondary}>
              {secondaryLines.join('\n')}
            </Text>
          ) : null}
        </Card.Content>
        <Card.Actions>
          {selectedEntry.theMovieDB ? (
            <Button
              onPress={() =>
                openLink(
                  `https://themoviedb.org/${selectedEntry.contentType === 'film' ? 'movie' : 'tv'}/${selectedEntry.theMovieDB}`
                )
              }
            >
              TMDb
            </Button>
          ) : null}
          {selectedEntry.avsUrl ? <Button onPress={() => openLink(selectedEntry.avsUrl)}>Discuss</Button> : null}
          {selectedEntry.beqcUrl ? <Button onPress={() => openLink(selectedEntry.beqcUrl)}>Catalogue</Button> : null}
        </Card.Actions>
        {selectedEntry.images && selectedEntry.images.length > 0 ? (
          <View style={styles.gallery}>
            {selectedEntry.images.map((image, idx) => (
              <EntryImage
                key={`img${idx}`}
                testID={`entry-image-${idx}`}
                uri={image}
                backgroundColor={theme.colors.surfaceVariant}
              />
            ))}
          </View>
        ) : null}
      </Card>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  secondary: {
    marginTop: 8,
  },
  gallery: {
    paddingBottom: 8,
  },
  image: {
    width: '100%',
    marginTop: 8,
  },
});
