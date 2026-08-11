import { ActivityIndicator, View } from 'react-native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';

import { useServerContext } from '../context/ServerContext';
import ConnectScreen from '../screens/connect/ConnectScreen';
import ScanQrScreen from '../screens/connect/ScanQrScreen';
import MainScreen from '../screens/main/MainScreen';

// Plain React Navigation (not Expo Router) deliberately - its focus/transition model on tvOS is
// better trodden, which matters once a react-native-tvos port is added later (see mobile/README.md).
export type RootStackParamList = {
  Connect: undefined;
  ScanQr: undefined;
  Main: undefined;
};

const Stack = createNativeStackNavigator<RootStackParamList>();

// initialRouteName is only read on first mount, so the Navigator itself must not mount until
// ServerContext has resolved whether a server is already paired - otherwise a relaunch with a
// persisted connection would still flash the Connect screen before jumping to Main.
export default function RootNavigator() {
  const { connection } = useServerContext();

  if (connection === undefined) {
    return (
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
        <ActivityIndicator />
      </View>
    );
  }

  return (
    <Stack.Navigator initialRouteName={connection ? 'Main' : 'Connect'}>
      <Stack.Screen name="Connect" component={ConnectScreen} options={{ title: 'Connect' }} />
      <Stack.Screen name="ScanQr" component={ScanQrScreen} options={{ title: 'Scan QR Code' }} />
      {/* No header - it only ever showed the literal text "ezbeq", which is redundant on the
          app's one and only main screen. MainScreen takes over covering the top safe-area inset
          itself now that there's no header row to do it (see its own insets usage). */}
      <Stack.Screen name="Main" component={MainScreen} options={{ headerShown: false }} />
    </Stack.Navigator>
  );
}
