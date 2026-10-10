// =============================================================================
// THE EYES STAY FRESH AND ON TOPIC (F3 gate, plan C-Stage 4).
//
// The gate the plan set: "a 90-day twin run with refreshed sources never goes
// idle, and at least 80% of the evidence given to reviewers is on-topic". So a
// capable world of the REAL institution (world-run.ts), with the F3 eyes —
// newest-first forum reads in rotating words, a second forum in rotating
// rooms, a marketplace, Foundry's own sales in the record — runs N days, and:
//
//   * NEVER IDLE: on every day the eyes record at least one observation they
//     had not recorded before (the institution's own count), and the public
//     world shows them at least one item it never showed before (the twin's).
//   * ON TOPIC: every evidence row the forge's reviewers were given (the
//     record each deliberated test's lenses read, after the relevance floor)
//     is judged by THREE deterministic scripted judges, each knowing
//     differently — the twin's ground truth for the item it showed, the
//     twin's theme vocabulary, and the candidate's own words — and the
//     majority verdict is on-topic for at least 80% of rows. Agreement is
//     measured with the existing judge harness (Cohen per pair, Fleiss
//     overall, from panel/judges.ts), and disagreements are reported.
//
// THE 90-DAY GATE WAS NOT MET (10 October 2026), and the reason is recorded
// rather than tuned away: on days 85, 88 and 89 discovery recorded no sentence
// it had not recorded before. The twin's people can say at most 330 different
// sentences (7 themes; things × chores × wishes × 5 openers), discovery never
// pays to read the same words twice, and by day 85 it had read them. That is a
// limit of the twin's vocabulary meeting a correct rule of the institution, not
// a property of the world it stands in for — but the gate measures the twin, so
// it is reported as failed (IMPLEMENTATION_STATE.md, "F3").
//
// DEFAULT, IN CI: one seed × 60 days, inside the twin's vocabulary, so the
// freshness the wave built is held (a mutation removing newest-first, rotation
// and the second forum idles 22 of 30 days). The 90-day run is
// SIM_EYES_DAYS=90; more seeds with SIM_LONG=1 SIM_EYES_SEEDS=n. The scorecard goes to
// $CAMPAIGN_OUT/eyes.json. Every source the eyes read in the twin is the
// twin's own people (public-world.ts); nothing here was read from a live site.
// =============================================================================
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import type { WorldResult } from './world-run.js';
import { THEMES, themeOf, type ThemeKey } from './segments.js';
import { cohenKappa, fleissKappa, type Verdict } from '../panel/judges.js';

const int = (v: string | undefined, d: number): number => (v && /^\d+$/.test(v) ? Number(v) : d);
const LONG = process.env.SIM_LONG === '1';
const DAYS = int(process.env.SIM_EYES_DAYS, 60);
const SEEDS = LONG ? int(process.env.SIM_EYES_SEEDS, 3) : 1;
const BASE = int(process.env.SIM_SEED_BASE, 1);

/** The id of the public item a row came from, where its address carries one. */
export function itemIdOf(source: string): string | null {
  return /[?&]id=(\d+)/.exec(source)?.[1] ?? /\/questions\/(\d+)/.exec(source)?.[1] ?? /\/listing\/(\d+)/.exec(source)?.[1] ?? null;
}

export interface Row { saw: string; source: string; sourceType: string }
export interface OnTopicJudge { id: string; how: string; decide(theme: ThemeKey, subject: string, row: Row, truth: Record<string, string | null>): Verdict }

/** THREE WAYS OF KNOWING WHETHER A ROW IS ABOUT THE CANDIDATE. */
export const ON_TOPIC_JUDGES: readonly OnTopicJudge[] = [
  { id: 'ground-truth', how: 'the twin knows what every item it showed was about; a summary row is judged by the theme its words name',
    decide: (theme, _s, row, truth) => {
      const id = itemIdOf(row.source);
      if (id !== null && id in truth) return truth[id] === theme ? 'yes' : 'no';
      return themeOf(row.saw) === theme ? 'yes' : 'no';
    } },
  { id: 'theme-words', how: 'the row names the candidate\'s theme by the twin\'s vocabulary for it, more than any other theme',
    decide: (theme, _s, row) => (themeOf(row.saw) === theme ? 'yes' : 'no') },
  { id: 'candidate-words', how: 'the row carries a word of the theme\'s vocabulary or its name, as a reader skimming for the subject would',
    decide: (theme, _s, row) => {
      const t = row.saw.toLowerCase();
      return THEMES[theme].words.some((w) => t.includes(w)) || t.includes(THEMES[theme].name) ? 'yes' : 'no';
    } },
];

/** Judge every reviewer row of one world; rows of a candidate whose own words name no theme are counted apart. */
export function judgeWorld(w: Pick<WorldResult, 'reviewerEvidence' | 'truth'>): { rows: number; onTopic: number; untethered: number; verdicts: Verdict[][]; disagreements: Array<{ row: string; verdicts: string }> } {
  const verdicts: Verdict[][] = [];
  let onTopic = 0; let untethered = 0;
  const disagreements: Array<{ row: string; verdicts: string }> = [];
  for (const r of w.reviewerEvidence) {
    const theme = r.theme as ThemeKey | null;
    if (!theme) { untethered += r.rows.length; continue; }
    for (const row of r.rows) {
      const v = ON_TOPIC_JUDGES.map((j) => j.decide(theme, r.subject, row, w.truth));
      verdicts.push(v);
      if (v.filter((x) => x === 'yes').length >= 2) onTopic += 1;
      if (new Set(v).size > 1) disagreements.push({ row: `[${theme}] ${r.subject.slice(0, 80)} || ${row.saw.slice(0, 100)}`, verdicts: v.join('/') });
    }
  }
  return { rows: verdicts.length, onTopic, untethered, verdicts, disagreements };
}

const worlds: WorldResult[] = [];

describe(`the eyes stay fresh and on topic — ${String(SEEDS)} seed(s) × ${String(DAYS)} days`, () => {
  it('runs the real institution with the wider eyes, the monitor after every day', async () => {
    for (let k = 0; k < SEEDS; k++) {
      try { await (await import('../../../src/db/client.js')).closeDb(); } catch { /* nothing open */ }
      vi.resetModules();
      const { runWorld } = await import('./world-run.js');
      const w = await runWorld({ seed: BASE + k, days: DAYS, brain: 'capable', onDay: process.env.SIM_VERBOSE === '1' ? (l) => process.stdout.write(`${l}\n`) : undefined });
      worlds.push(w);
      process.stdout.write(`eyes world seed ${String(w.seed)}: ${String(DAYS)} days in ${(w.wallMs / 1000).toFixed(0)}s — idle days ${String(w.eyesIdleDays)}, `
        + `observations ${String(w.timeline.reduce((s, d) => s + d.newObservations, 0))}, items shown ${String(Object.keys(w.truth).length)}, `
        + `reviewed ${String(w.reviewerEvidence.length)}, hosts ${JSON.stringify(w.hosts)}\n`);
    }
    expect(worlds).toHaveLength(SEEDS);
  }, 6 * 3600_000);

  it('no rule is broken on any day', () => {
    for (const w of worlds) expect(w.violations, `seed ${String(w.seed)}`).toEqual([]);
  });

  it('never idle: every day the eyes record something new, and are shown something new', () => {
    for (const w of worlds) {
      expect(w.timeline.filter((d) => d.newObservations <= 0).map((d) => d.day), `seed ${String(w.seed)}: days the eyes recorded nothing`).toEqual([]);
      expect(w.timeline.filter((d) => d.newItemsShown <= 0).map((d) => d.day), `seed ${String(w.seed)}: days nothing new was shown`).toEqual([]);
      expect(w.eyesIdleDays).toBe(0);
    }
  });

  it('the wider sources were actually read: the second forum and the marketplace, newest first', () => {
    for (const w of worlds) {
      expect(w.hosts['api.stackexchange.com'] ?? 0, `seed ${String(w.seed)}: Stack Exchange`).toBeGreaterThan(0);
      expect(w.hosts['openapi.etsy.com'] ?? 0, `seed ${String(w.seed)}: the marketplace`).toBeGreaterThan(0);
      expect(w.hosts['hn.algolia.com'] ?? 0).toBeGreaterThan(0);
    }
  });

  it('at least 80% of the evidence given to reviewers is on topic, by three scripted judges; their agreement is measured', () => {
    const all = worlds.map((w) => ({ seed: w.seed, ...judgeWorld(w), leftOut: w.reviewerEvidence.reduce((s, r) => s + r.leftOut, 0), reviewed: w.reviewerEvidence.length }));
    const rows = all.reduce((s, a) => s + a.rows, 0);
    const onTopic = all.reduce((s, a) => s + a.onTopic, 0);
    const verdicts = all.flatMap((a) => a.verdicts);
    const kappa = {
      fleiss: fleissKappa(verdicts),
      pairs: [[0, 1], [0, 2], [1, 2]].map(([a, b]) => ({ pair: `${ON_TOPIC_JUDGES[a!]!.id}~${ON_TOPIC_JUDGES[b!]!.id}`,
        cohen: cohenKappa(verdicts.map((v) => v[a!]!), verdicts.map((v) => v[b!]!)) })),
    };
    const card = { writtenAt: new Date().toISOString(), days: DAYS, seeds: all.map(({ verdicts: _v, ...x }) => ({ ...x, disagreements: x.disagreements.slice(0, 10) })),
      rows, onTopic, share: rows ? onTopic / rows : null, judges: ON_TOPIC_JUDGES.map((j) => ({ id: j.id, how: j.how })), kappa,
      eyesIdleDays: worlds.map((w) => w.eyesIdleDays), newObservationsPerDay: worlds.map((w) => w.timeline.map((d) => d.newObservations)) };
    const out = resolve(process.env.CAMPAIGN_OUT ?? 'tests/simulation/out', 'eyes.json');
    mkdirSync(resolve(out, '..'), { recursive: true });
    writeFileSync(out, JSON.stringify(card, null, 1));
    process.stdout.write(`on topic: ${String(onTopic)} of ${String(rows)} (${rows ? ((onTopic / rows) * 100).toFixed(1) : '—'}%), left out by the floor ${String(all.reduce((s, a) => s + a.leftOut, 0))}, `
      + `untethered ${String(all.reduce((s, a) => s + a.untethered, 0))}; Fleiss ${kappa.fleiss.toFixed(2)}; ${kappa.pairs.map((p) => `${p.pair} ${p.cohen.toFixed(2)}`).join(', ')}\n`);
    expect(rows, 'reviewers were given evidence to judge').toBeGreaterThan(20);
    expect(onTopic / rows).toBeGreaterThanOrEqual(0.8);
    // A candidate whose own words name no theme cannot be judged; it must stay the exception.
    expect(all.reduce((s, a) => s + a.untethered, 0)).toBeLessThan(rows * 0.25);
  });
});
