import { useState } from 'react';
import { type LayoutChangeEvent, StyleSheet, View } from 'react-native';
import { useTheme } from 'react-native-paper';
import Svg, { Line, Polyline, Text as SvgText } from 'react-native-svg';

export type ChartSeries = {
  key: string;
  values: number[];
  colour: string;
  width: number;
  dash: number[] | null;
};

type Props = {
  freqs: number[];
  series: ChartSeries[];
  yLabel: string;
};

// stands in for uPlot (used by ui/src/components/main/Compare.jsx), which needs a DOM - a plain
// log-frequency line chart is all compare needs, so it's drawn directly with react-native-svg
const LEFT = 36;
const RIGHT = 8;
const TOP = 8;
const BOTTOM = 20;
const X_GRID = [1, 2, 5, 10, 20, 50, 100, 200];
const X_LABELS = new Set([1, 10, 100]);

// a round step giving roughly five gridlines across range
export const niceStep = (range: number): number => {
  const raw = range / 5;
  const pow = Math.pow(10, Math.floor(Math.log10(raw)));
  const n = raw / pow;
  return (n <= 1 ? 1 : n <= 2 ? 2 : n <= 5 ? 5 : 10) * pow;
};

export const yAxis = (series: ChartSeries[]): { min: number; max: number; step: number } => {
  const values = series.flatMap((s) => s.values);
  let lo = values.length ? Math.min(...values) : 0;
  let hi = values.length ? Math.max(...values) : 0;
  if (hi - lo < 1) {
    lo -= 0.5;
    hi += 0.5;
  }
  const step = niceStep(hi - lo);
  return { min: Math.floor(lo / step) * step, max: Math.ceil(hi / step) * step, step };
};

export default function ResponseChart({ freqs, series, yLabel }: Props) {
  const theme = useTheme();
  const [width, setWidth] = useState(0);
  const height = Math.min(320, Math.max(180, Math.round(width * 0.6)));

  const onLayout = (e: LayoutChangeEvent) => setWidth(Math.floor(e.nativeEvent.layout.width));

  const plotW = Math.max(0, width - LEFT - RIGHT);
  const plotH = height - TOP - BOTTOM;
  const logMin = Math.log10(freqs[0]);
  const logRange = Math.log10(freqs[freqs.length - 1]) - logMin;
  const x = (f: number) => LEFT + ((Math.log10(f) - logMin) / logRange) * plotW;
  const { min, max, step } = yAxis(series);
  const y = (v: number) => TOP + ((max - v) / (max - min)) * plotH;
  const yTicks: number[] = [];
  for (let v = min; v <= max + step / 2; v += step) yTicks.push(Number(v.toFixed(6)));

  const gridColour = theme.colors.outlineVariant;
  const labelColour = theme.colors.onSurfaceVariant;

  return (
    <View
      onLayout={onLayout}
      style={[styles.container, { height }]}
      testID="response-chart"
      accessible
      accessibilityLabel={`Frequency response chart, ${yLabel} against Hz`}
    >
      {width > 0 ? (
        <Svg width={width} height={height}>
          {X_GRID.map((f) => (
            <Line key={`x${f}`} x1={x(f)} x2={x(f)} y1={TOP} y2={TOP + plotH} stroke={gridColour} strokeWidth={0.5} />
          ))}
          {yTicks.map((v) => (
            <Line key={`y${v}`} x1={LEFT} x2={LEFT + plotW} y1={y(v)} y2={y(v)} stroke={gridColour} strokeWidth={0.5} />
          ))}
          {[...X_LABELS].map((f) => (
            <SvgText key={`xl${f}`} x={x(f)} y={height - 6} fontSize={10} fill={labelColour} textAnchor="middle">
              {String(f)}
            </SvgText>
          ))}
          {yTicks.map((v) => (
            <SvgText key={`yl${v}`} x={LEFT - 4} y={y(v) + 3} fontSize={10} fill={labelColour} textAnchor="end">
              {String(v)}
            </SvgText>
          ))}
          <SvgText
            x={10}
            y={TOP + plotH / 2}
            fontSize={10}
            fill={labelColour}
            textAnchor="middle"
            rotation={-90}
            origin={`10, ${TOP + plotH / 2}`}
          >
            {yLabel}
          </SvgText>
          {series.map((s) => (
            <Polyline
              key={s.key}
              testID={`series-${s.key}`}
              points={s.values.map((v, i) => `${x(freqs[i]).toFixed(1)},${y(v).toFixed(1)}`).join(' ')}
              fill="none"
              stroke={s.colour}
              strokeWidth={s.width}
              strokeDasharray={s.dash ?? undefined}
            />
          ))}
        </Svg>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    width: '100%',
  },
});
