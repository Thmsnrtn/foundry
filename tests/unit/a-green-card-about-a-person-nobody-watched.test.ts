process.env.TURSO_DATABASE_URL = 'file::memory:';
process.env.ENCRYPTION_KEY = '0'.repeat(64);

import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { nanoid } from 'nanoid';
import { stripComments } from '../../scripts/lib/strip-comments.mjs';
import { runMigrations } from '../../src/db/migrate.js';
import { query } from '../../src/db/client.js';
import { getWellbeing } from '../../src/services/founder/intelligence.js';

// =============================================================================
// A GREEN CARD ABOUT A PERSON NOBODY WATCHED.
//
// The Founder Wellbeing card carries a coloured left border: green above 60,
// amber above 35, red below. A founder with no `founder_health` row at all
// took `motivation ?? 50` and `engagement ?? 'stable'`, which made
// `energy_score: 70` — a GREEN card reading "70/100", "Trajectory: stable",
// "Stress Signals: 0" — about a person this system had never observed once.
//
// Of every claim-without-evidence found in this file, this is the one that
// matters most, and not because the number is large. It is about a person, a
// person reads it, and what they take from it is that something has been
// watching them. Three defaults are not watching. The reassurance IS the harm.
//
// Two constants sat beside it. `days_since_break: 0` carried the comment
// "Would track from activity gaps" and rendered as "you had a break today".
// `override_count_7d: 0` told a founder they had not overridden Foundry once
// this week — drawn from nothing, and it would still be zero if it were wired
// up, because `decision_quality_scores` has no writer at all:
// `recordDecisionContext` is exported and called from nowhere, which is also
// why the override rates in `scp/founder/decision-tracker.ts` are permanently
// zero.
// =============================================================================

beforeAll(async () => { await runMigrations(); });
beforeEach(async () => {
  await query('DELETE FROM founder_health_snapshots');
  await query('DELETE FROM founder_health');
  await query('DELETE FROM founders');
});

function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = join(dir, e.name);
    if (e.isDirectory()) return sourceFiles(p);
    return e.isFile() && p.endsWith('.ts') ? [p] : [];
  });
}

async function addFounder(): Promise<string> {
  const id = `f_${nanoid(8)}`;
  await query(
    'INSERT INTO founders (id, clerk_user_id, email) VALUES (?,?,?)',
    [id, `clerk_${id}`, `${id}@example.com`]);
  return id;
}

describe('a founder nothing has been recorded about', () => {
  it('is not scored', async () => {
    const id = await addFounder();
    const w = await getWellbeing(id);
    expect(w.energy_score, 'seventy out of a hundred, from three defaults').toBeNull();
  });

  it('is not given a trajectory', async () => {
    const id = await addFounder();
    const w = await getWellbeing(id);
    expect(w.burnout_trajectory, '"stable" is a finding, not an absence of one').toBe('unknown');
  });

  it('is not told they have no stress signals', async () => {
    const id = await addFounder();
    const w = await getWellbeing(id);
    expect(w.stress_signals).toEqual([]);
    expect(w.energy_score, 'the empty list only reads correctly beside a null score').toBeNull();
  });

  it('is given no advice either way', async () => {
    const id = await addFounder();
    const w = await getWellbeing(id);
    expect(w.recommendation).toBeNull();
  });

  it('is still unscored when the row exists but holds none of the inputs', async () => {
    const id = await addFounder();
    await query(
      'INSERT INTO founder_health (id, founder_id, last_login_streak) VALUES (?,?,3)',
      [nanoid(), id]);
    const w = await getWellbeing(id);
    expect(w.energy_score, 'a row is not an observation').toBeNull();
  });
});

describe('a founder something IS recorded about', () => {
  it('is scored from what was recorded', async () => {
    const id = await addFounder();
    await query(
      'INSERT INTO founder_health (id, founder_id, motivation_score, engagement_trend) VALUES (?,?,?,?)',
      [nanoid(), id, 20, 'declining']);
    const w = await getWellbeing(id);
    expect(w.energy_score, '70 - 25 low motivation - 15 declining').toBe(30);
    expect(w.stress_signals).toContain('Low motivation score');
    expect(w.stress_signals).toContain('Declining engagement');
    expect(w.recommendation).toMatch(/energy is low/);
  });

  it('is scored from a partial record without inventing the rest', async () => {
    const id = await addFounder();
    await query(
      'INSERT INTO founder_health (id, founder_id, personal_runway_months) VALUES (?,?,2)',
      [nanoid(), id]);
    const w = await getWellbeing(id);
    expect(w.energy_score, 'runway alone: 70 - 15').toBe(55);
    expect(w.stress_signals, 'nothing said about motivation, which is unknown')
      .toEqual(['Only 2 months runway']);
  });

  it('gets a trajectory only once there are enough snapshots to compare', async () => {
    const id = await addFounder();
    await query(
      'INSERT INTO founder_health (id, founder_id, motivation_score) VALUES (?,?,60)',
      [nanoid(), id]);
    for (const [date, score] of [['2026-01-01', 80], ['2026-01-02', 70]] as const) {
      await query(
        'INSERT INTO founder_health_snapshots (id, founder_id, snapshot_date, motivation_score) VALUES (?,?,?,?)',
        [nanoid(), id, date, score]);
    }
    expect((await getWellbeing(id)).burnout_trajectory, 'two is not enough to compare').toBe('unknown');

    await query(
      'INSERT INTO founder_health_snapshots (id, founder_id, snapshot_date, motivation_score) VALUES (?,?,?,?)',
      [nanoid(), id, '2026-01-03', 30]);
    expect((await getWellbeing(id)).burnout_trajectory,
      'newest first: the two most recent average 50 against the older 80').toBe('declining');
  });
});

describe('what is not recorded at all', () => {
  it('reports no days since a break, because nothing records activity gaps', async () => {
    const id = await addFounder();
    await query(
      'INSERT INTO founder_health (id, founder_id, motivation_score) VALUES (?,?,70)',
      [nanoid(), id]);
    const w = await getWellbeing(id);
    expect(w.days_since_break, 'zero read as "you had a break today"').toBeNull();
  });

  it('reports no override count, because nothing writes the store that answers it', async () => {
    const id = await addFounder();
    const w = await getWellbeing(id);
    expect(w.override_count_7d).toBeNull();

    const tracker = 'src/services/scp/founder/decision-tracker.ts';
    expect(readFileSync(tracker, 'utf8'), 'the only writer')
      .toMatch(/INSERT INTO decision_quality_scores/);

    // Comments stripped: this file and that one both NAME the function while
    // explaining why it is never called.
    const callers = sourceFiles('src').filter((f) => f !== tracker
      && /recordDecisionContext/.test(
        stripComments(readFileSync(f, 'utf8'), { lineComments: true })));
    expect(callers, 'if a caller ever appears, this count becomes computable').toEqual([]);
  });
});

describe('the card the founder reads', () => {
  it('is grey rather than green when nothing was observed', () => {
    const src = readFileSync('src/routes/dashboard/founder-ops.ts', 'utf8');
    expect(src).toMatch(/a green one would be a guess/);
    expect(src).toMatch(/wellbeing\.energy_score == null \? '#9ca3af'/);
    expect(src).toMatch(/wellbeing\.energy_score == null \? 'not observed'/);
  });

  it('holds no default that scores an unobserved person', () => {
    const ops = stripComments(
      readFileSync('src/routes/dashboard/founder-ops.ts', 'utf8'), { lineComments: true });
    expect(ops, 'the error fallback was a green 70 too').not.toMatch(/energy_score:\s*70/);

    const src = stripComments(
      readFileSync('src/services/founder/intelligence.ts', 'utf8'), { lineComments: true });
    const fn = src.slice(src.indexOf('export async function getWellbeing'));
    const body = fn.slice(0, fn.indexOf('\n}\n') + 3);
    expect(body, 'motivation ?? 50 is where the green card came from').not.toMatch(/\?\?\s*50/);
    expect(body).not.toMatch(/\?\?\s*'stable'/);
  });
});
