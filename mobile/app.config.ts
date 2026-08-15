import type { ConfigContext, ExpoConfig } from 'expo/config';

// @react-native-tvos/config-tv itself reads EXPO_TV to decide whether to reconfigure the native
// project for TV - this only decides whether the plugin is in the list at all, since its own
// README says it "cannot be used in the Expo Go app" at all, so a plain phone/tablet
// `expo start`/`expo run:android` shouldn't carry it as a no-op dependency of every prebuild.
const isTV = process.env.EXPO_TV === '1' || process.env.EXPO_TV === 'true';

export default ({ config }: ConfigContext): ExpoConfig => ({
  ...config,
  name: 'ezbeq',
  slug: 'ezbeq-mobile',
  version: '1.0.0',
  orientation: 'default',
  icon: './assets/icon.png',
  userInterfaceStyle: 'automatic',
  ios: {
    supportsTablet: true,
    bundleIdentifier: 'com.ezbeq.mobile',
  },
  android: {
    package: 'com.ezbeq.mobile',
    adaptiveIcon: {
      backgroundColor: '#152846',
      foregroundImage: './assets/android-icon-foreground.png',
      backgroundImage: './assets/android-icon-background.png',
    },
    predictiveBackGestureEnabled: false,
  },
  web: {
    favicon: './assets/favicon.png',
  },
  plugins: [
    'expo-asset',
    'expo-font',
    'expo-notifications',
    [
      'expo-splash-screen',
      {
        image: './assets/splash-icon.png',
        imageWidth: 220,
        resizeMode: 'contain',
        backgroundColor: '#152846',
      },
    ],
    [
      'expo-build-properties',
      {
        android: {
          usesCleartextTraffic: true,
        },
      },
    ],
    './plugins/withAndroidReleaseSigning',
    // Only added for `EXPO_TV=1` prebuilds (see `npm run tvos`) - appleTVImages is deliberately
    // left unset here rather than pointed at the phone-derived icons: the plugin throws if that
    // option is set with any path missing, and a resized phone icon isn't a valid substitute for
    // tvOS's layered icon/top-shelf asset requirements anyway (see
    // docs/appletv-implementation-plan.md's Phase 4 - real TV-specific art still needs to be
    // sourced before this can be filled in).
    ...(isTV
      ? [
          [
            '@react-native-tvos/config-tv',
            {
              isTV: true,
              tvosDeploymentTarget: '15.1',
            },
          ] as [string, Record<string, unknown>],
        ]
      : []),
  ],
});
