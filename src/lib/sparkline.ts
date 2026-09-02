// =============================================================================
// FOUNDRY - a trend you can read in a glance, drawn honestly
//
// A sparkline is the one chart that earns its place on a phone: it says which
// way a number has been going without an axis, a legend or a tooltip. It is
// also the easiest chart to lie with, so three rules are enforced here rather
// than left to taste:
//
//   NO LINE FROM FEWER THAN THREE READINGS. Two points is a slope, not a trend,
//   and a single point drawn as a flat line would say "stable" about a thing
//   that has been seen once.
//
//   THE BASELINE IS THE SERIES' OWN RANGE, and a flat series is drawn flat in
//   the middle, not amplified into drama by a zoomed axis.
//
//   COLOUR MEANS DIRECTION, and only for numbers where direction has a
//   meaning: revenue up is good, churn up is not. The caller says which.
// =============================================================================

export interface Spark {
  /** Inline SVG, or empty when there is not enough to draw honestly. */
  svg: string;
  points: number;
}

export function sparkline(values: number[], input: {
  width?: number; height?: number;
  /** 'up_is_good' | 'down_is_good' | 'neutral' */
  meaning?: 'up_is_good' | 'down_is_good' | 'neutral';
} = {}): Spark {
  const w = input.width ?? 120;
  const h = input.height ?? 32;
  const series = values.filter((v) => Number.isFinite(v));
  if (series.length < 3) return { svg: '', points: series.length };

  const min = Math.min(...series);
  const max = Math.max(...series);
  const span = max - min;
  const pad = 3;
  const x = (i: number): number => pad + (i * (w - pad * 2)) / (series.length - 1);
  const y = (v: number): number => span === 0
    ? h / 2
    : pad + ((max - v) * (h - pad * 2)) / span;
  const path = series.map((v, i) =>
    `${i === 0 ? 'M' : 'L'}${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(' ');

  const first = series[0] ?? 0;
  const last = series[series.length - 1] ?? 0;
  const rose = last > first * 1.015;
  const fell = last < first * 0.985;
  const meaning = input.meaning ?? 'neutral';
  const tone = meaning === 'neutral' || (!rose && !fell) ? 'var(--ink-3)'
    : (rose && meaning === 'up_is_good') || (fell && meaning === 'down_is_good')
      ? 'var(--good)' : 'var(--alert)';

  // The area under the line is a hint of weight, not data: it is drawn at low
  // opacity so it cannot be read as a second series.
  const area = `${path} L${x(series.length - 1).toFixed(1)},${String(h)} L${x(0).toFixed(1)},${String(h)} Z`;
  const endX = x(series.length - 1).toFixed(1);
  const endY = y(last).toFixed(1);
  return {
    points: series.length,
    svg: `<svg class="spark" viewBox="0 0 ${String(w)} ${String(h)}" width="${String(w)}" height="${String(h)}" `
      + `aria-hidden="true" focusable="false">`
      + `<path d="${area}" fill="${tone}" opacity=".12"/>`
      + `<path d="${path}" fill="none" stroke="${tone}" stroke-width="1.75" `
      + `stroke-linejoin="round" stroke-linecap="round"/>`
      + `<circle cx="${endX}" cy="${endY}" r="2.4" fill="${tone}"/></svg>`,
  };
}
