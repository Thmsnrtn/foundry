process.env.TURSO_DATABASE_URL = 'file::memory:';
process.env.ENCRYPTION_KEY = '0'.repeat(64);

import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { runMigrations } from '../../src/db/migrate.js';
import { query } from '../../src/db/client.js';
import {
  FRUITLESS_BEFORE_SETTLED, NOTHING, SETTLED_SLEEP_DAYS, cognitionEconomics, consider,
  digestOf, recordOccasion, shouldThink,
} from '../../src/services/ai/cognition.js';

// =============================================================================
// "NOTHING WORTH DOING" IS A RESULT.
//
// Production, 1-14 September 2026: 1,099 settled model calls, $14.88, and more
// than half of it one nightly loop that in eleven nights changed nothing at
// all — most of those nights re-reading the same five sessions, because no new
// one had completed. Nothing in the repository asked whether the call was
// worth making; the loop was scheduled, so the loop ran.
//
// These tests are about the three reasons to sleep and, more importantly, the
// two ways a sleeping institution lies to itself:
//
//   counting a sleep as evidence that thinking would have been fruitless,
//     which is how a loop talks itself into never waking again; and
//   treating a settled question as a closed one, which is how an institution
//     stops noticing that the world moved.
// =============================================================================

const IT = { cognition: 'agent_evolution_synthesis', about: 'p1/oracle' };

async function occasions(): Promise<Array<Record<string, unknown>>> {
  return (await query('SELECT * FROM cognition_occasions ORDER BY rowid'))
    .rows as unknown as Array<Record<string, unknown>>;
}

/** An occasion written at a chosen moment, because backoff is about time. */
async function at(when: string, thought: boolean, changed?: boolean, digest = 'd'): Promise<void> {
  await recordOccasion({
    occasion: IT, overDigest: digest, thought, because: 'test',
    changedSomething: changed,
  });
  await query(
    `UPDATE cognition_occasions SET at = ? WHERE id = (
       SELECT id FROM cognition_occasions ORDER BY rowid DESC LIMIT 1)`, [when]);
}

beforeAll(async () => { await runMigrations(); });
beforeEach(async () => { await query('DELETE FROM cognition_occasions'); });

describe('the digest of the material', () => {
  it('gives no material at all a name, so "nothing to consider" is a state', () => {
    expect(digestOf([])).toBe(NOTHING);
    expect(digestOf([null, undefined, ''])).toBe(NOTHING);
  });

  it('is the same for the same material and different for different material', () => {
    expect(digestOf(['a@1', 'b@2'])).toBe(digestOf(['a@1', 'b@2']));
    expect(digestOf(['a@1', 'b@2'])).not.toBe(digestOf(['a@1', 'b@3']));
  });

  it('treats a reordering as a change, which errs towards thinking', () => {
    // The safe direction. A false sleep is silent; a needless thought costs
    // cents and shows up in the record where somebody can see it.
    expect(digestOf(['a', 'b'])).not.toBe(digestOf(['b', 'a']));
  });
});

describe('the three reasons to sleep', () => {
  it('sleeps when there is nothing to consider', async () => {
    const v = await shouldThink(IT, NOTHING);
    expect(v.think).toBe(false);
    expect(v.because).toContain('nothing here');
  });

  it('thinks the first time, because it has nothing to compare against', async () => {
    const v = await shouldThink(IT, digestOf(['s1@t1']));
    expect(v.think).toBe(true);
  });

  it('sleeps when the material has not moved since last time', async () => {
    const d = digestOf(['s1@t1']);
    await recordOccasion({ occasion: IT, overDigest: d, thought: true, because: 'first', changedSomething: false });
    const v = await shouldThink(IT, d);
    expect(v.think).toBe(false);
    expect(v.because).toContain('nothing has changed');
  });

  it('thinks again once the material moves', async () => {
    await recordOccasion({
      occasion: IT, overDigest: digestOf(['s1@t1']), thought: true, because: 'first',
      changedSomething: false,
    });
    const v = await shouldThink(IT, digestOf(['s2@t2']));
    expect(v.think).toBe(true);
    expect(v.because).toContain('material has changed');
  });

  it('backs off once the question has been asked enough times and never mattered', async () => {
    const now = new Date('2026-09-14T04:00:00Z');
    for (let i = 0; i < FRUITLESS_BEFORE_SETTLED; i++) {
      await at(`2026-09-1${String(i + 3)} 04:00:00`, true, false, `d${String(i)}`);
    }
    const v = await shouldThink(IT, digestOf(['new']), now);
    expect(v.think).toBe(false);
    expect(v.because).toContain('never once');
    expect(v.because).toContain('weekly');
  });

  it('is not a decision to stop: a settled question wakes after the sleep', async () => {
    // THE DIFFERENCE BETWEEN CRYSTALLISING AN ANSWER AND FORGETTING THE
    // QUESTION. A question that has never mattered may come to matter, and an
    // institution that can never be surprised is not cheap — it is blind.
    for (let i = 0; i < FRUITLESS_BEFORE_SETTLED; i++) {
      await at(`2026-09-0${String(i + 1)} 04:00:00`, true, false, `d${String(i)}`);
    }
    const wellAfter = new Date(
      Date.parse('2026-09-05T04:00:00Z') + (SETTLED_SLEEP_DAYS + 1) * 86_400_000);
    const v = await shouldThink(IT, digestOf(['new']), wellAfter);
    expect(v.think).toBe(true);
    expect(v.because).toContain('worth one more look');
  });

  it('never lets a fruitless run outvote an occasion that DID change something', async () => {
    await at('2026-09-01 04:00:00', true, true, 'd0');
    for (let i = 0; i < FRUITLESS_BEFORE_SETTLED; i++) {
      await at(`2026-09-0${String(i + 2)} 04:00:00`, true, false, `dd${String(i)}`);
    }
    const v = await shouldThink(IT, digestOf(['new']), new Date('2026-09-08T04:00:00Z'));
    expect(v.think).toBe(true);
  });

  it('stays settled after a fortnight of weekly asks, rather than un-settling itself', async () => {
    // THE DRIFT THIS WAS FIRST WRITTEN WITH. The counts came from a window of
    // the last fifteen rows. Once the backoff engages the rows are mostly
    // SLEEPS — six a week against one thought — so within a fortnight the
    // thoughts scrolled out of the window, the fruitless count collapsed below
    // the threshold, and the question quietly resumed asking itself nightly.
    // A settled question that un-settles itself on a technicality is worse
    // than one that never settled, because nobody would ever notice.
    let d = 1;
    const night = (): string => `2026-09-${String(d).padStart(2, '0')} 04:00:00`;
    for (let i = 0; i < FRUITLESS_BEFORE_SETTLED; i++, d++) {
      await at(night(), true, false, `t${String(i)}`);
    }
    // Then a fortnight of the settled rhythm: six sleeps, one thought, twice.
    for (let week = 0; week < 2; week++) {
      for (let i = 0; i < 6; i++, d++) await at(night(), false, undefined, `s${String(week)}${String(i)}`);
      await at(night(), true, false, `w${String(week)}`);
      d++;
    }
    expect(d).toBeGreaterThan(16);
    const v = await shouldThink(IT, digestOf(['newer']), new Date('2026-09-20T04:00:00Z'));
    expect(v.think).toBe(false);
    expect(v.because).toContain('never once');
  });

  it('does not count a sleep as evidence that thinking would have been fruitless', async () => {
    // THE FAILURE THIS EXISTS TO PREVENT. If sleeps counted, a loop that slept
    // five nights for want of new material would conclude the question never
    // mattered — from five nights in which it never asked it.
    for (let i = 0; i < FRUITLESS_BEFORE_SETTLED * 2; i++) {
      await at(`2026-09-0${String((i % 9) + 1)} 04:00:00`, false, undefined, `s${String(i)}`);
    }
    const v = await shouldThink(IT, digestOf(['new']), new Date('2026-09-14T04:00:00Z'));
    expect(v.think).toBe(true);
  });
});

describe('what gets written down', () => {
  it('records a sleep with no verdict on whether anything would have changed', async () => {
    await consider(IT, NOTHING, async () => ({ changedSomething: true, value: 'ran' }));
    const [row] = await occasions();
    expect(Number(row.thought)).toBe(0);
    // NULL, not 0. An occasion that did not happen did not fail to change
    // anything, and a 0 here would poison the count that decides the next one.
    expect(row.changed_something).toBeNull();
  });

  it('does not run the work when it sleeps', async () => {
    let ran = 0;
    const out = await consider(IT, NOTHING, async () => {
      ran += 1; return { changedSomething: false, value: 'ran' };
    });
    expect(ran).toBe(0);
    expect(out.thought).toBe(false);
    expect(out.value).toBeNull();
  });

  it('runs the work and records what it cost when it does think', async () => {
    const out = await consider(IT, digestOf(['s1@t1']), async () => ({
      changedSomething: true, cents: 4.2, value: 'evolved',
    }));
    expect(out.value).toBe('evolved');
    const [row] = await occasions();
    expect(Number(row.thought)).toBe(1);
    expect(Number(row.changed_something)).toBe(1);
    expect(Number(row.cents)).toBeCloseTo(4.2);
  });

  it('a run of unchanged nights is one comparison, not a growing scan', async () => {
    const d = digestOf(['s1@t1']);
    for (let i = 0; i < 12; i++) {
      await consider(IT, d, async () => ({ changedSomething: false, value: 1 }));
    }
    const rows = await occasions();
    expect(rows.filter((r) => Number(r.thought) === 1)).toHaveLength(1);
    expect(rows.filter((r) => Number(r.thought) === 0)).toHaveLength(11);
  });
});

describe('what thinking costs', () => {
  it('says plainly when nothing asks itself whether it is worth thinking about', async () => {
    const e = await cognitionEconomics(30);
    expect(e.considered).toHaveLength(0);
    expect(e.sentence).toContain('Nothing yet asks itself');
  });

  it('counts thoughts, sleeps and what came of them, per question', async () => {
    await consider(IT, digestOf(['a']), async () => ({ changedSomething: false, cents: 3, value: 1 }));
    await consider(IT, digestOf(['a']), async () => ({ changedSomething: false, cents: 3, value: 1 }));
    await consider(IT, digestOf(['a']), async () => ({ changedSomething: false, cents: 3, value: 1 }));
    const e = await cognitionEconomics(30);
    expect(e.considered).toHaveLength(1);
    expect(e.considered[0].thought).toBe(1);
    expect(e.considered[0].slept).toBe(2);
    expect(e.considered[0].changedSomething).toBe(0);
    expect(e.considered[0].sleptBecause).toContain('nothing has changed');
    // Two nights at what the one night that ran actually cost.
    expect(e.notSpentCents).toBeCloseTo(6);
  });

  it('reports an unknown saving as unknown rather than as nothing', async () => {
    await consider(IT, digestOf(['a']), async () => ({ changedSomething: false, value: 1 }));
    await consider(IT, digestOf(['a']), async () => ({ changedSomething: false, value: 1 }));
    const e = await cognitionEconomics(30);
    expect(e.considered[0].cents).toBeNull();
    expect(e.notSpentCents).toBeNull();
  });

  it('reads the spend ledger for what was actually settled, by model', async () => {
    await query(
      `INSERT INTO ai_spend_reservations
         (id, product_id, founder_id, date, model, reserved_cents, global_cap_cents,
          status, created_at, updated_at, expires_at, actual_cents)
       VALUES ('r1', NULL, NULL, date('now'), 'anthropic/claude-sonnet-5', 5, 50000,
               'settled', datetime('now'), datetime('now'), datetime('now','+1 hour'), 4.5)`);
    const e = await cognitionEconomics(30);
    expect(e.byModel).toEqual([
      { model: 'anthropic/claude-sonnet-5', calls: 1, cents: 4.5 },
    ]);
    expect(e.totalCents).toBeCloseTo(4.5);
  });
});
