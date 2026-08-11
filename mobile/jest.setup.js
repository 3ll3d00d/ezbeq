import 'react-native-gesture-handler/jestSetup';

jest.mock('react-native-safe-area-context', () => {
  const mock = require('react-native-safe-area-context/jest/mock');
  // The mock ships as a default export; spread it so both `import Foo from '...'` and
  // `import { Foo } from '...'` consumers (react-navigation uses the latter) see its members.
  return { ...mock, ...mock.default };
});

jest.mock('@react-native-async-storage/async-storage', () =>
  require('@react-native-async-storage/async-storage/jest/async-storage-mock')
);

jest.mock('@react-native-community/netinfo', () =>
  require('@react-native-community/netinfo/jest/netinfo-mock')
);

// expo-notifications ships no jest mock of its own - stub the handful of functions
// filterNotification.ts/useFilterLoadedNotification.ts call so importing them in a test doesn't
// hit a native module. Individual tests override return values with jest.mocked(...) as needed.
jest.mock('expo-notifications', () => ({
  setNotificationHandler: jest.fn(),
  setNotificationCategoryAsync: jest.fn().mockResolvedValue(undefined),
  setNotificationChannelAsync: jest.fn().mockResolvedValue(undefined),
  getPermissionsAsync: jest.fn().mockResolvedValue({ granted: true }),
  requestPermissionsAsync: jest.fn().mockResolvedValue({ granted: true }),
  scheduleNotificationAsync: jest.fn().mockResolvedValue('id'),
  dismissNotificationAsync: jest.fn().mockResolvedValue(undefined),
  addNotificationResponseReceivedListener: jest.fn(() => ({ remove: jest.fn() })),
  AndroidImportance: { DEFAULT: 3 },
}));
