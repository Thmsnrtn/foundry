// =============================================================================
// THE TWIN IS EXPLICIT: every number has a distribution and a source, and the
// same seed is the same world.
//
// No invented statistic presented as fact: a parameter whose source is not
// one of the three recorded observations is labelled 'assumption', and says
// why its range is what it is. This file holds the registry to that, and to
// determinism, and checks the pieces the year runs lean on.
// =============================================================================
import { describe, expect, it } from 'vitest';
import { PARAMS, drawParams, medianParams, quantile, type ParamName } from './params.js';
import { Market, type Listing } from './market.js';
import { publicWorld } from './public-world.js';
import { firesOn } from './world-run.js';
import { SEGMENTS, THEMES, segmentsFor } from './segments.js';
import { BUYER_PANEL, CASSETTE_DIGEST } from './sources/observations.js';
import { range } from './scorecard.js';

describe('every parameter is a distribution with a source', () => {
  for (const [name, p] of Object.entries(PARAMS)) {
    it(`${name}: ${p.source.kind}`, () => {
      expect(['cassette', 'calibration', 'buyer-panel', 'assumption']).toContain(p.source.kind);
      expect(p.source.cite.length).toBeGreaterThan(10);
      const lo = quantile(p.dist, 0); const hi = quantile(p.dist, 1);
      expect(hi, 'a range, not a point').toBeGreaterThan(lo);
      expect(Number.isFinite(lo) && Number.isFinite(hi)).toBe(true);
    });
  }
  it('the observed sources are real records, read from what was recorded', () => {
    expect(CASSETTE_DIGEST.keys).toBeGreaterThan(50);
    expect(CASSETTE_DIGEST.byHost['hn.algolia.com']?.queries).toBeGreaterThan(5);
    expect(BUYER_PANEL.voices).toHaveLength(5);
    // Every segment says where it came from; the two nobody has heard from say so.
    for (const s of SEGMENTS) expect(['buyer-panel', 'assumption']).toContain(s.source.kind);
    expect(SEGMENTS.filter((s) => s.source.kind === 'assumption').map((s) => s.key)).toEqual(['side-business', 'homeowner']);
  });
  it('most of what the market runs on is a named assumption, and the scorecard can say how many', () => {
    const assumed = Object.values(PARAMS).filter((p) => p.source.kind === 'assumption').length;
    expect(assumed).toBeGreaterThan(0);
    expect(assumed).toBeLessThan(Object.keys(PARAMS).length);
  });
});

describe('the same seed is the same world', () => {
  it('draws the same parameters, and different seeds draw different ones', () => {
    expect(drawParams(4)).toEqual(drawParams(4));
    expect(drawParams(4)).not.toEqual(drawParams(5));
    const pinned = drawParams(4, { 'market.baseConversion': 0.9 });
    expect(pinned['market.baseConversion']).toBe(quantile(PARAMS['market.baseConversion'].dist, 0.9));
  });

  it('a market day is the same whatever order the listings arrive in', () => {
    const p = { ...medianParams(), 'market.indexLagDays': 0, 'market.impressionsPerDay': 400, 'market.baseConversion': 0.2 } as Record<ParamName, number>;
    const ls: Listing[] = [
      { key: 'The Handover File', experimentId: 'a', title: 'The Handover File', priceCents: 900, liveSince: 0, theme: 'handover', quality: 0.8, defects: [] },
      { key: 'The Home Maintenance Log', experimentId: 'b', title: 'The Home Maintenance Log', priceCents: 700, liveSince: 0, theme: 'home-upkeep', quality: 0.8, defects: [] },
    ];
    const run = (order: Listing[]) => { const m = new Market(9, p); const out = []; for (let d = 1; d <= 20; d++) out.push(m.day(d, order).events.map((e) => `${e.kind}:${'listing' in e ? e.listing.key : e.listingKey}`)); return out; };
    expect(run(ls)).toEqual(run([...ls].reverse()));
  });

  it('the public world answers the same query the same way, in the source\'s own shape', () => {
    const a = publicWorld(3, medianParams(), () => 1).answer('https://hn.algolia.com/api/v1/search?query=keep%20a%20spreadsheet%20for&tags=comment&hitsPerPage=15');
    const b = publicWorld(3, medianParams(), () => 1).answer('https://hn.algolia.com/api/v1/search?query=keep%20a%20spreadsheet%20for&tags=comment&hitsPerPage=15');
    expect(a).not.toBeNull();
    return Promise.all([a!.json(), b!.json()]).then(([x, y]) => {
      expect(x).toEqual(y);
      expect(Array.isArray((x as { hits: unknown[] }).hits)).toBe(true);
    });
  });
});

describe('the pieces the year runs lean on', () => {
  it('a routine fires on the days its own schedule names', () => {
    expect([1, 2, 3, 4, 5, 6, 7].map((d) => firesOn('0 7 * * *', d))).toEqual([true, true, true, true, true, true, true]);
    expect([1, 2, 3, 4, 5, 6, 7, 8].map((d) => firesOn('30 7 * * 1', d))).toEqual([true, false, false, false, false, false, false, true]);
    expect([1, 2, 31].map((d) => firesOn('0 3 1 * *', d))).toEqual([true, false, true]);
    expect(firesOn('*/10 * * * *', 4)).toBe(true);
  });
  it('every theme is somebody\'s, and segment shares of a theme add up', () => {
    for (const t of Object.keys(THEMES) as Array<keyof typeof THEMES>) {
      const s = segmentsFor(t);
      expect(s.length).toBeGreaterThan(0);
      expect(s.reduce((n, x) => n + x.share, 0)).toBeCloseTo(1, 6);
    }
  });
  it('a range is p10 / p50 / p90, interpolated', () => {
    expect(range([1, 2, 3, 4, 5, 6, 7, 8, 9, 10])).toMatchObject({ p10: 1.9, p50: 5.5, p90: 9.1, n: 10 });
  });
});
