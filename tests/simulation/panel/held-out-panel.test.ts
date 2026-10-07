// =============================================================================
// THE HELD-OUT PANEL, JUDGED THREE WAYS — deterministic in CI.
//
// Three scripted judges (judges.ts) read every held-out persona against a
// capable and a degraded file for each theme. What this proves is the
// HARNESS: that agreement is measured, disagreements are surfaced, a sloppy
// file is judged worse than a sound one, and a real-model run refuses to start
// past its dollar ceiling without calling anything. What it does not prove is
// what real buyers think: the judges are scripts.
// =============================================================================
import { afterEach, describe, expect, it, vi } from 'vitest';
import { JUDGES, PanelRefused, cohenKappa, fleissKappa, judgeTheHeldOutPanel, planARealRun } from './judges.js';

describe('three judges on the held-out panel', () => {
  const run = judgeTheHeldOutPanel();

  it('reads every held-out persona and every product, with three judges', () => {
    expect(run.personas).toBeGreaterThanOrEqual(20);
    expect(run.products).toBe(14);
    expect(run.judges).toEqual(JUDGES.map((j) => j.id));
  });

  it('measures agreement, pair by pair and all three together, and lists every disagreement', () => {
    expect(Object.keys(run.kappaPairs)).toHaveLength(3);
    for (const k of [...Object.values(run.kappaPairs), run.fleiss]) { expect(k).toBeGreaterThanOrEqual(-1); expect(k).toBeLessThanOrEqual(1); }
    expect(run.percentAllAgree).toBeGreaterThan(0);
    expect(run.percentAllAgree).toBeLessThan(1);
    expect(run.disagreements.length).toBeGreaterThan(0);
    for (const d of run.disagreements) expect(new Set(Object.values(d.verdicts)).size).toBeGreaterThan(1);
  });

  it('judges a sloppy file worse than a sound one', () => {
    expect(run.yesShareByKind.capable).toBeGreaterThan(run.yesShareByKind.degraded!);
  });

  it('the agreement measures are the textbook ones', () => {
    expect(cohenKappa(['yes', 'no', 'yes', 'no'], ['yes', 'no', 'yes', 'no'])).toBe(1);
    expect(cohenKappa(['yes', 'yes', 'no', 'no'], ['yes', 'no', 'yes', 'no'])).toBe(0);
    expect(fleissKappa([['yes', 'yes', 'yes'], ['no', 'no', 'no']])).toBe(1);
  });
});

describe('a real-model run is ready, and refuses to start past its ceiling', () => {
  afterEach(() => { vi.unstubAllGlobals(); });
  const prices = { inputUsdPerMTok: 3, outputUsdPerMTok: 15 };

  it('without the flag, without a ceiling, or above the hard cap, it refuses before calling anything', () => {
    const fetchSpy = vi.fn(async () => { throw new Error('no model may be called by this test'); });
    vi.stubGlobal('fetch', fetchSpy);
    expect(() => planARealRun({ env: {}, ...prices })).toThrow(PanelRefused);
    expect(() => planARealRun({ env: { PANEL_REAL: '1' }, ...prices })).toThrow(/needs a dollar ceiling/);
    expect(() => planARealRun({ env: { PANEL_REAL: '1', PANEL_MAX_USD: '500' }, ...prices })).toThrow(/above the hard cap/);
    expect(() => planARealRun({ env: { PANEL_REAL: '1', PANEL_MAX_USD: '0.01' }, ...prices })).toThrow(/would cost about \$[\d.]+, above the ceiling of \$0\.01; nothing was called/);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('inside its ceiling it says what it would call and spend', () => {
    const plan = planARealRun({ env: { PANEL_REAL: '1', PANEL_MAX_USD: '20' }, ...prices });
    expect(plan.calls).toBeGreaterThan(0);
    expect(plan.estimateUsd).toBeLessThanOrEqual(20);
  });
});
