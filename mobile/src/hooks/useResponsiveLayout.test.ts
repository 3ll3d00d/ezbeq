import { renderHook } from '@testing-library/react-native';
import { useWindowDimensions } from 'react-native';

import { useResponsiveLayout } from './useResponsiveLayout';

jest.mock('react-native/Libraries/Utilities/useWindowDimensions');

const mockDimensions = (width: number, height: number) => {
  (useWindowDimensions as jest.Mock).mockReturnValue({ width, height, scale: 2, fontScale: 1 });
};

test('a narrow portrait phone is neither wide nor tablet', async () => {
  mockDimensions(390, 844);

  const { result } = await renderHook(() => useResponsiveLayout());

  expect(result.current.isLandscape).toBe(false);
  expect(result.current.useWide).toBe(false);
  expect(result.current.isTablet).toBe(false);
});

test('a small phone rotated to landscape stays narrow - its height is below the 580px threshold', async () => {
  mockDimensions(844, 390);

  const { result } = await renderHook(() => useResponsiveLayout());

  expect(result.current.isLandscape).toBe(true);
  expect(result.current.useWide).toBe(false);
  // Regression check: isTablet must look at the shortest side, not raw width - this phone's
  // landscape width (844) alone would clear a naive width>=768 check even though it's still just
  // a rotated phone (shortest side 390).
  expect(result.current.isTablet).toBe(false);
});

test('a Pixel-class phone rotated to landscape is not misclassified as a tablet', async () => {
  mockDimensions(915, 412);

  const { result } = await renderHook(() => useResponsiveLayout());

  expect(result.current.useWide).toBe(false);
  expect(result.current.isTablet).toBe(false);
});

test('iPad mini in portrait clears the tablet breakpoint even though it is narrower than 768px', async () => {
  mockDimensions(744, 1133);

  const { result } = await renderHook(() => useResponsiveLayout());

  expect(result.current.isLandscape).toBe(false);
  expect(result.current.useWide).toBe(false);
  expect(result.current.isTablet).toBe(true);
});

test('a large-enough landscape screen (e.g. a tablet) is wide', async () => {
  mockDimensions(1024, 600);

  const { result } = await renderHook(() => useResponsiveLayout());

  expect(result.current.isLandscape).toBe(true);
  expect(result.current.useWide).toBe(true);
});

test('landscape below the 580px height threshold is not wide', async () => {
  mockDimensions(700, 400);

  const { result } = await renderHook(() => useResponsiveLayout());

  expect(result.current.isLandscape).toBe(true);
  expect(result.current.useWide).toBe(false);
});

test('a tablet-width portrait screen is tablet but not wide', async () => {
  mockDimensions(834, 1194);

  const { result } = await renderHook(() => useResponsiveLayout());

  expect(result.current.isLandscape).toBe(false);
  expect(result.current.useWide).toBe(false);
  expect(result.current.isTablet).toBe(true);
});

test('a tablet in landscape is both wide and tablet', async () => {
  mockDimensions(1194, 834);

  const { result } = await renderHook(() => useResponsiveLayout());

  expect(result.current.useWide).toBe(true);
  expect(result.current.isTablet).toBe(true);
});

// Reference dp figures from Android's foldable/large-screen design guidance (Galaxy Fold-class
// device): ~344x792 folded (outer cover screen), ~673x841 unfolded (inner screen). Locking these
// in matters because useWindowDimensions (not a static Dimensions.get() snapshot, see above)
// re-renders this hook live as the device folds/unfolds mid-session - a regression here wouldn't
// just misclassify a static screen size, it'd flip the layout mid-interaction.
test('a folded cover screen is treated as a narrow phone, not a tablet', async () => {
  mockDimensions(344, 792);

  const { result } = await renderHook(() => useResponsiveLayout());

  expect(result.current.isLandscape).toBe(false);
  expect(result.current.useWide).toBe(false);
  expect(result.current.isTablet).toBe(false);
});

test('unfolding to the inner screen in book/portrait posture crosses the tablet breakpoint', async () => {
  mockDimensions(673, 841);

  const { result } = await renderHook(() => useResponsiveLayout());

  expect(result.current.isLandscape).toBe(false);
  expect(result.current.useWide).toBe(false);
  expect(result.current.isTablet).toBe(true);
});

test('unfolding to the inner screen in landscape posture is both wide and tablet', async () => {
  mockDimensions(841, 673);

  const { result } = await renderHook(() => useResponsiveLayout());

  expect(result.current.isLandscape).toBe(true);
  expect(result.current.useWide).toBe(true);
  expect(result.current.isTablet).toBe(true);
});
