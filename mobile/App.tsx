import 'react-native-gesture-handler';
import { StatusBar } from 'expo-status-bar';
import {
  DarkTheme as NavigationDarkTheme,
  DefaultTheme as NavigationDefaultTheme,
  NavigationContainer,
} from '@react-navigation/native';
import { useColorScheme } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { adaptNavigationTheme, PaperProvider } from 'react-native-paper';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { DeviceStateProvider } from './src/context/DeviceStateContext';
import { ServerProvider } from './src/context/ServerContext';
import RootNavigator from './src/navigation/RootNavigator';
import { darkTheme, lightTheme } from './src/theme/paperTheme';

// React Navigation's screen containers (background, header) aren't Paper components, so wrapping
// everything in <PaperProvider> alone doesn't theme them - NavigationContainer needs its own
// `theme`, derived here from the same Paper themes so the two never disagree (e.g. dark-themed
// text rendered over a navigator screen background that stayed light).
const { LightTheme: navigationLightTheme, DarkTheme: navigationDarkTheme } = adaptNavigationTheme({
  reactNavigationLight: NavigationDefaultTheme,
  reactNavigationDark: NavigationDarkTheme,
  materialLight: lightTheme,
  materialDark: darkTheme,
});

export default function App() {
  const scheme = useColorScheme();
  const isDark = scheme === 'dark';
  const theme = isDark ? darkTheme : lightTheme;
  const navigationTheme = isDark ? navigationDarkTheme : navigationLightTheme;

  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <SafeAreaProvider>
        <PaperProvider theme={theme}>
          <ServerProvider>
            <DeviceStateProvider>
              <NavigationContainer theme={navigationTheme}>
                <RootNavigator />
              </NavigationContainer>
            </DeviceStateProvider>
          </ServerProvider>
          <StatusBar style="auto" />
        </PaperProvider>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}
