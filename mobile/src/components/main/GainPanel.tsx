import { useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { IconButton, Text } from 'react-native-paper';

import GainRow from './GainRow';
import type { GainsPayload } from '../../types/ezbeq';

type Props = {
  selectedSlotId: string | null;
  deviceGains: GainsPayload;
  gains: GainsPayload;
  updateGain: (parent: string, key: 'mv' | 'mute', value: number | boolean) => void;
  commitGain: (parent: string, key: 'mv' | 'mute', value: number | boolean) => void;
};

// Ported from ui/src/components/main/Gain.jsx. The real "does this device support volume
// control at all" gate is the caller's job (MainScreen checks `device.masterVolume !==
// undefined` before rendering this, mirroring Slots.jsx's `selectedDevice.hasOwnProperty
// ('masterVolume')` check) - useGainSync's deriveDeviceGain always defaults master_mv to 0 once
// synced, so checking it here would never actually be false. This early-out only covers the
// narrower case of gains not being synced (e.g. a caller passing the hook's raw initial state).
export default function GainPanel({ selectedSlotId, deviceGains, gains, updateGain, commitGain }: Props) {
  const [channelsOpen, setChannelsOpen] = useState(false);

  if (gains.master_mv === undefined) return null;

  const inputChannels = gains.gains ?? [];
  const outputChannels = gains.output_gains ?? [];
  const hasChannels = selectedSlotId !== null && (inputChannels.length > 0 || outputChannels.length > 0);
  const channelCount = inputChannels.length + outputChannels.length;

  return (
    <View style={styles.container}>
      <GainRow
        label="Master"
        minGain={-127}
        maxGain={0}
        step={0.5}
        value={Number(gains.master_mv ?? 0)}
        muted={gains.master_mute ?? false}
        savedValue={Number(deviceGains.master_mv ?? 0)}
        savedMuted={deviceGains.master_mute ?? false}
        onValueChange={(v) => updateGain('master', 'mv', v)}
        onValueCommit={(v) => commitGain('master', 'mv', v)}
        onMuteToggle={(v) => commitGain('master', 'mute', v)}
      />

      {hasChannels ? (
        <>
          <Pressable onPress={() => setChannelsOpen((open) => !open)} style={styles.channelsHeader}>
            <Text variant="labelSmall" style={styles.channelsLabel}>
              Channels ({channelCount})
            </Text>
            <IconButton
              icon={channelsOpen ? 'chevron-up' : 'chevron-down'}
              size={16}
              accessibilityLabel={channelsOpen ? 'Collapse channels' : 'Expand channels'}
              onPress={() => setChannelsOpen((open) => !open)}
            />
          </Pressable>
          {channelsOpen ? (
            <View>
              {inputChannels.map((g, i) => (
                <GainRow
                  key={`input-${g.id}`}
                  label={`In ${g.id}`}
                  minGain={-72}
                  maxGain={12}
                  step={0.25}
                  value={g.value}
                  muted={gains.mutes?.[i]?.value ?? false}
                  savedValue={deviceGains.gains?.[i]?.value ?? 0}
                  savedMuted={deviceGains.mutes?.[i]?.value ?? false}
                  onValueChange={(v) => updateGain(g.id, 'mv', v)}
                  onValueCommit={(v) => commitGain(g.id, 'mv', v)}
                  onMuteToggle={(v) => commitGain(g.id, 'mute', v)}
                />
              ))}
              {outputChannels.map((g, i) => (
                <GainRow
                  key={`output-${g.id}`}
                  label={`Out ${g.id}`}
                  minGain={-72}
                  maxGain={12}
                  step={0.25}
                  value={g.value}
                  muted={gains.output_mutes?.[i]?.value ?? false}
                  savedValue={deviceGains.output_gains?.[i]?.value ?? 0}
                  savedMuted={deviceGains.output_mutes?.[i]?.value ?? false}
                  onValueChange={(v) => updateGain(`out_${g.id}`, 'mv', v)}
                  onValueCommit={(v) => commitGain(`out_${g.id}`, 'mv', v)}
                  onMuteToggle={(v) => commitGain(`out_${g.id}`, 'mute', v)}
                />
              ))}
            </View>
          ) : null}
        </>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    paddingTop: 8,
    paddingHorizontal: 4,
  },
  channelsHeader: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  channelsLabel: {
    flex: 1,
  },
});
