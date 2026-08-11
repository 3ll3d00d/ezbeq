import { Banner } from 'react-native-paper';

type Props = {
  deviceName: string;
};

// Ported from ui/src/components/DeviceDisconnectedBanner.jsx - shown when the selected device's
// own `connected` field is false (e.g. a minidsp/AVR unreachable from the ezbeq server), which is
// a different thing from the mobile app's WebSocket connection to the server itself.
export default function DeviceDisconnectedBanner({ deviceName }: Props) {
  return (
    <Banner visible icon="lan-disconnect">
      {`Device Unreachable\n${deviceName} is not responding — check connection and review ezbeq.log`}
    </Banner>
  );
}
