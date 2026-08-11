import { useWindowDimensions } from 'react-native';

export type ResponsiveLayout = {
  width: number;
  height: number;
  isLandscape: boolean;
  // Literal port of the 580px landscape-height threshold `useWide` in ui/src/App.jsx uses to
  // decide between MainView's two-pane Grid (list | detail) and its stacked layout.
  useWide: boolean;
  // Common tablet breakpoint (iPad mini and up) - a natural extension beyond useWide's web-parity
  // threshold, since a tablet in portrait still has room a phone doesn't.
  isTablet: boolean;
};

// useWindowDimensions (not a static Dimensions.get() snapshot) so rotating the device re-renders
// with the new size, matching how the web version's useMediaQuery reacts to viewport changes.
export const useResponsiveLayout = (): ResponsiveLayout => {
  const { width, height } = useWindowDimensions();
  const isLandscape = width > height;
  const useWide = isLandscape && height >= 580;
  // Keyed off the shortest side (Android's standard sw600dp "tablet" bucket), not raw width -
  // width alone conflates a rotated phone's long edge (Pixel/iPhone landscape width regularly
  // clears 768px) with actual tablet-width screens. A phone's shortest side stays under ~450px in
  // either orientation; iPad mini's shortest side (744pt, even in portrait) stays comfortably
  // above 600.
  const isTablet = Math.min(width, height) >= 600;

  return { width, height, isLandscape, useWide, isTablet };
};
