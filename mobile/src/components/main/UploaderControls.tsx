import { Pressable, StyleSheet, View } from 'react-native';
import { ActivityIndicator, Button, Checkbox, RadioButton, Text } from 'react-native-paper';

import type { SlotState } from '../../types/ezbeq';

type Props = {
  slots: SlotState[];
  uploadSlotId: string | null;
  setUploadSlotId: (id: string) => void;
  sendGain: boolean;
  setSendGain: (value: boolean) => void;
  acceptGain: boolean;
  // Ported from Entry.jsx's `disabled={!selectedEntry.mvAdjust}` - the checkbox is shown
  // whenever the slot can accept a gain payload, but disabled unless the entry actually carries
  // an MV adjustment to send, since checking it otherwise would have no effect on upload.
  gainAdjustAvailable: boolean;
  pending: boolean;
  onUpload: () => void;
};

// Ported from the Uploader sub-component in ui/src/components/main/Entry.jsx - presentational
// only, the upload state and the actual PATCH/PUT call live in EntryDetail (its parent), which
// mirrors the web version's split.
//
// All three controls share a single row rather than one each: a View's default cross-axis
// behavior only stretches children to fill the full width in a *column* flex container (the
// layout this previously used), which is what made the gain checkbox and the Upload button balloon
// out to the screen's full width for no visual benefit. A row container's cross axis is vertical,
// so each control just hugs its own content width here, and Upload sits flush right via
// marginLeft: 'auto'. flexWrap covers the rare case (many slots on a narrow phone) where they
// don't all fit on one line.
export default function UploaderControls({
  slots,
  uploadSlotId,
  setUploadSlotId,
  sendGain,
  setSendGain,
  acceptGain,
  gainAdjustAvailable,
  pending,
  onUpload,
}: Props) {
  return (
    <View style={styles.container}>
      {slots.length > 1 ? (
        <RadioButton.Group onValueChange={setUploadSlotId} value={uploadSlotId ?? ''}>
          <View style={styles.slotGroup}>
            {slots.map((slot) => (
              <Pressable
                key={slot.id}
                onPress={() => setUploadSlotId(slot.id)}
                style={styles.radioItem}
                testID={`slot-radio-${slot.id}`}
              >
                <RadioButton value={slot.id} />
                <Text>{slot.id}</Text>
              </Pressable>
            ))}
          </View>
        </RadioButton.Group>
      ) : null}
      {acceptGain ? (
        // A bare Checkbox rather than Checkbox.Item - Item's built-in touch target/padding is
        // sized for a full-width settings-style row, which is too large for a compact toolbar.
        // The inner Checkbox is pointerEvents="none" so only the wrapping Pressable's hit area
        // (matching the slot radios' pattern above) handles the tap, keeping a single source of
        // truth for the accessibility state instead of two overlapping touchables.
        <Pressable
          onPress={() => setSendGain(!sendGain)}
          disabled={!gainAdjustAvailable}
          style={styles.gainToggle}
          accessibilityRole="checkbox"
          accessibilityLabel="Set Input Gain"
          accessibilityState={{ checked: sendGain, disabled: !gainAdjustAvailable }}
        >
          <View pointerEvents="none">
            <Checkbox status={sendGain ? 'checked' : 'unchecked'} disabled={!gainAdjustAvailable} />
          </View>
          <Text style={!gainAdjustAvailable && styles.gainLabelDisabled}>Gain</Text>
        </Pressable>
      ) : null}
      <Button
        mode="contained"
        compact
        style={styles.uploadButton}
        onPress={onUpload}
        disabled={pending || !uploadSlotId}
      >
        {pending ? <ActivityIndicator size="small" /> : 'Upload'}
      </Button>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    marginBottom: 12,
    gap: 12,
  },
  slotGroup: {
    flexDirection: 'row',
    flexWrap: 'wrap',
  },
  radioItem: {
    flexDirection: 'row',
    alignItems: 'center',
    marginRight: 12,
  },
  gainToggle: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  gainLabelDisabled: {
    opacity: 0.38,
  },
  uploadButton: {
    marginLeft: 'auto',
  },
});
