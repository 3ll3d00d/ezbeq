import { fireEvent, render, screen } from '@testing-library/react-native';

import ResponseChart, { niceStep, yAxis, type ChartSeries } from './ResponseChart';

const series = (key: string, values: number[], overrides: Partial<ChartSeries> = {}): ChartSeries => ({
  key,
  values,
  colour: '#fff',
  width: 1.5,
  dash: null,
  ...overrides,
});

describe('niceStep', () => {
  it('picks a round step giving about five gridlines', () => {
    expect(niceStep(1)).toBeCloseTo(0.2);
    expect(niceStep(14)).toBe(5);
    expect(niceStep(30)).toBe(10);
    expect(niceStep(60)).toBe(20);
  });
});

describe('yAxis', () => {
  it('spans every value, rounded out to whole steps', () => {
    expect(yAxis([series('a', [-1.5, 13.7]), series('b', [0, 12])])).toEqual({ min: -5, max: 15, step: 5 });
  });

  it('widens a flat or empty range so it can still be drawn', () => {
    const flat = yAxis([series('a', [0, 0])]);
    expect(flat.min).toBeLessThan(0);
    expect(flat.max).toBeGreaterThan(0);
    expect(yAxis([]).max).toBeGreaterThan(yAxis([]).min);
  });
});

test('draws nothing until it knows its width, then one line per series', async () => {
  await render(
    <ResponseChart
      freqs={[1, 10, 100]}
      series={[series('a', [0, 6, 0]), series('b', [1, 2, 3], { dash: [6, 4] })]}
      yLabel="dB"
    />
  );
  expect(screen.queryByTestId('series-a')).toBeNull();

  fireEvent(screen.getByTestId('response-chart'), 'layout', { nativeEvent: { layout: { width: 300, height: 180 } } });

  const a = await screen.findByTestId('series-a');
  // x is log spaced across the plot (36px left gutter, 8px right), y is inverted
  // react-native-svg renders a polyline as a path, "M x1 y1 x2 y2 ..."
  const coords = a.props.d.slice(1).trim().split(/\s+/).map(Number);
  const xs = coords.filter((_: number, i: number) => i % 2 === 0);
  const ys = coords.filter((_: number, i: number) => i % 2 === 1);
  expect(xs).toEqual([36, 164, 292]);
  expect(ys[1]).toBeLessThan(ys[0]);
  expect(screen.getByTestId('series-b')).toBeTruthy();
  expect(screen.getByLabelText('Frequency response chart, dB against Hz')).toBeTruthy();
});
