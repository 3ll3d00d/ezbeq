import { MD3DarkTheme, MD3LightTheme } from 'react-native-paper';

// Plain MD3 defaults for now - swap in brand colors here if/when ezbeq gets one, without
// touching any call site (screens/components only ever import lightTheme/darkTheme from here).
export const lightTheme = MD3LightTheme;
export const darkTheme = MD3DarkTheme;
