import { useEffect, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import Slider from '@react-native-community/slider';
import { IconButton, TextInput, useTheme } from 'react-native-paper';

type Props = {
  label: string;
  minGain: number;
  maxGain: number;
  step: number;
  value: number;
  muted: boolean;
  savedValue: number;
  savedMuted: boolean;
  onValueChange: (v: number) => void;
  onValueCommit: (v: number) => void;
  onMuteToggle: (v: boolean) => void;
};

const decimalsFor = (step: number): number => (step < 0.1 ? 2 : step < 1 ? 1 : 0);

// Ported from ui/src/components/main/Gain.jsx's GainRow. The web version keeps `value` as a
// string throughout (so a MUI TextField can hold invalid/in-progress input like "-1."); this
// keeps the committed value a plain number (matching gains.ts's numeric GainValue) and only
// tracks in-progress text locally, parsing/clamping/committing it on blur.
export default function GainRow({
  label,
  minGain,
  maxGain,
  step,
  value,
  muted,
  savedValue,
  savedMuted,
  onValueChange,
  onValueCommit,
  onMuteToggle,
}: Props) {
  const theme = useTheme();
  const isDirty = value !== savedValue || muted !== savedMuted;
  const decimals = decimalsFor(step);
  const [text, setText] = useState(value.toFixed(decimals));

  useEffect(() => {
    setText(value.toFixed(decimals));
  }, [value, decimals]);

  const commitText = () => {
    const parsed = parseFloat(text);
    if (isNaN(parsed)) {
      setText(value.toFixed(decimals));
      return;
    }
    onValueCommit(Math.min(maxGain, Math.max(minGain, parsed)));
  };

  return (
    <View style={styles.row}>
      <Text numberOfLines={1} style={[styles.label, { color: theme.colors.onSurfaceVariant }]}>
        {label}
      </Text>
      <Slider
        testID={`gain-slider-${label}`}
        style={styles.slider}
        minimumValue={minGain}
        maximumValue={maxGain}
        step={step}
        value={value}
        disabled={muted}
        minimumTrackTintColor={isDirty ? theme.colors.secondary : theme.colors.primary}
        onValueChange={(v) => onValueChange(Number(v.toFixed(decimals)))}
        onSlidingComplete={(v) => onValueCommit(Number(v.toFixed(decimals)))}
        accessibilityLabel={`${label} gain`}
        accessibilityValue={{ min: minGain, max: maxGain, now: value }}
      />
      <TextInput
        mode="outlined"
        dense
        style={styles.input}
        keyboardType="numeric"
        value={text}
        onChangeText={setText}
        onBlur={commitText}
        accessibilityLabel={`${label} gain, decibels`}
      />
      <IconButton
        icon={muted ? 'volume-off' : 'volume-high'}
        size={18}
        accessibilityLabel={muted ? 'Unmute' : 'Mute'}
        onPress={() => onMuteToggle(!muted)}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 4,
  },
  label: {
    width: 44,
    fontSize: 12,
  },
  slider: {
    flex: 1,
  },
  input: {
    width: 68,
    height: 40,
  },
});
