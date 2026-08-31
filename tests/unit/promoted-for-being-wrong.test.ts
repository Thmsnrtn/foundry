// =============================================================================
// PROMOTED FOR BEING WRONG.
//
// Promotion out of `shadow` is the whole question of whether Foundry's
// judgement can be trusted enough to start suggesting. And in shadow mode
// Foundry decides nothing — every decision is the founder's. So the ten "clean
// cycles" that earned the promotion were ten occasions on which THE FOUNDER
// decided well.
//
// `processOutcomeFeedback` banked a clean cycle on any positive outcome,
// whatever Foundry had thought. Ten decisions where Foundry recommended one
// option, the founder chose the other, and the founder was right, and Foundry
// came out of shadow with `set_by = 'earned'`. Earned by being overruled.
//
// The comparison that would have caught it was already written, already
// computed on every page load, and already correct. `getShadowStats` reads
// `recommendation` against `chosen_option` on exactly these rows and reports an
// agreement rate to the operator letter, the chat and the MCP loop. It gated
// nothing. The one decision that agreement exists to inform was made on a
// different measurement — the same shape as a level computed and thrown away,
// arriving in the place where it decides what Foundry is allowed to do.
//
// The rule now: an outcome banks a clean cycle only when FOUNDRY'S judgement is
// what was tested. Either the decision was Foundry's own, or Foundry named an
// option and the founder took that option. A founder decision carrying no
// recommendation tested nothing of Foundry's and banks nothing.
//
// THIS IS A NARROWING, and deliberately so. It is harder to leave shadow now,
// and a category where Foundry offers no recommendations cannot leave it at
// all — which is the correct answer to "how much should we trust a judgement
// that was never expressed".
//
// The row is still claimed either way, so an unattributable outcome is retired
// once rather than rescanned on every tick forever.
// =============================================================================

process.env.TURSO_DATABASE_URL = 'file::memory:';
process.env.ENCRYPTION_KEY = '0'.repeat(64);

import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { runMigrations } from '../../src/db/migrate.js';
import { query } from '../../src/db/client.js';
import {
  getPolicy, getShadowStats, processOutcomeFeedback, PROMOTION_THRESHOLD,
} from '../../src/services/autopilot/policy.js';

let seq = 0;
async function seedDecision(pid: string, opts: {
  category?: string; decidedBy?: string;
  recommendation?: string | null; chosen?: string | null; valence?: number;
}): Promise<void> {
  await query(
    `INSERT INTO decisions (id, product_id, category, gate, what, why_now, status,
       decided_by, recommendation, chosen_option, outcome_valence, created_at, decided_at)
     VALUES (?, ?, ?, 1, 'x', 'y', 'approved', ?, ?, ?, ?,
       datetime('now', '-24 hours'), datetime('now', '-1 hour'))`,
    [`pw_d${++seq}`, pid, opts.category ?? 'marketing', opts.decidedBy ?? 'founder',
     opts.recommendation ?? null, opts.chosen ?? null, opts.valence ?? 1],
  );
}

beforeAll(async () => {
  await runMigrations();
  await query('PRAGMA foreign_keys=OFF', []);
  for (const p of ['pw_over', 'pw_silent', 'pw_own', 'pw_mixed', 'pw_agree']) {
    await query(`INSERT INTO products (id, name, owner_id, scp_status) VALUES ('${p}','Co','o1','active')`, []);
  }
});

beforeEach(async () => {
  await query('DELETE FROM autopilot_policies');
});

describe('a clean cycle has to be about Foundry', () => {
  it('banks nothing when the founder overruled Foundry and was right', async () => {
    for (let i = 0; i < PROMOTION_THRESHOLD + 5; i++) {
      await seedDecision('pw_over', {
        decidedBy: 'founder', recommendation: 'raise prices', chosen: 'hold prices', valence: 1,
      });
    }

    const fb = await processOutcomeFeedback('pw_over');

    expect(fb.cleanCycles).toBe(0);
    expect((await getPolicy('pw_over', 'marketing')).mode).toBe('shadow');
    // And the ledger says why, in the number that was always there: Foundry was
    // overruled every single time.
    const stats = await getShadowStats('pw_over');
    expect(stats.find((s) => s.category === 'marketing')?.agreementRate).toBe(0);
  });

  it('retires an unattributable outcome rather than rescanning it forever', async () => {
    await seedDecision('pw_over', {
      decidedBy: 'founder', recommendation: 'a', chosen: 'b', valence: 1,
    });

    await processOutcomeFeedback('pw_over');
    const counted = await query(
      `SELECT COUNT(*) AS n FROM decisions WHERE product_id = 'pw_over' AND autopilot_counted = 0`);
    expect((counted.rows[0] as unknown as { n: number }).n).toBe(0);
  });

  it('banks nothing when Foundry expressed no view at all', async () => {
    for (let i = 0; i < PROMOTION_THRESHOLD + 5; i++) {
      await seedDecision('pw_silent', {
        decidedBy: 'founder', recommendation: null, chosen: 'whatever', valence: 1,
      });
    }

    const fb = await processOutcomeFeedback('pw_silent');

    expect(fb.cleanCycles).toBe(0);
    expect((await getPolicy('pw_silent', 'marketing')).mode).toBe('shadow');
  });

  it('banks when the founder took Foundry\'s recommendation and it worked', async () => {
    for (let i = 0; i < PROMOTION_THRESHOLD; i++) {
      await seedDecision('pw_own', {
        // Case and whitespace differ on BOTH sides, so dropping the
        // normalisation from either one is caught.
        decidedBy: 'founder', recommendation: 'Raise Prices', chosen: '  RAISE prices ', valence: 1,
      });
    }

    const fb = await processOutcomeFeedback('pw_own');

    // Compared case- and whitespace-insensitively, the same way the shadow
    // ledger compares them, so the two cannot disagree about what agreement is.
    expect(fb.cleanCycles).toBe(PROMOTION_THRESHOLD);
    expect((await getPolicy('pw_own', 'marketing')).mode).toBe('suggest');
    expect((await getPolicy('pw_own', 'marketing')).set_by).toBe('earned');
  });

  it('banks a decision Foundry made itself, which needs no agreement', async () => {
    for (let i = 0; i < PROMOTION_THRESHOLD; i++) {
      await seedDecision('pw_mixed', {
        decidedBy: 'second_self', recommendation: null, chosen: null, valence: 1,
      });
    }

    const fb = await processOutcomeFeedback('pw_mixed');

    expect(fb.cleanCycles).toBe(PROMOTION_THRESHOLD);
  });

  it('does not count an empty recommendation as agreement with an empty choice', async () => {
    for (let i = 0; i < PROMOTION_THRESHOLD; i++) {
      await seedDecision('pw_silent', {
        category: 'product', decidedBy: 'founder', recommendation: '  ', chosen: '', valence: 1,
      });
    }

    const fb = await processOutcomeFeedback('pw_silent');

    expect(fb.cleanCycles).toBe(0);
  });
});

describe('the ledger and the letter agree about what agreement is', () => {
  it('banks exactly as many clean cycles as the shadow ledger counts agreements', async () => {
    // Two copies of one comparison: `getShadowStats` does TRIM(LOWER(...)) in
    // SQL for the operator letter, and the feedback edge does trim/toLowerCase
    // in TypeScript for the promotion ledger. Two copies are fine when they are
    // pinned. Two copies nobody compares are one rule with two answers — and
    // the two answers here would be "the letter says Foundry was right" beside
    // "Foundry was not promoted", with no way to tell which is the truth.
    const cases: Array<[string | null, string | null]> = [
      ['Raise Prices', '  RAISE prices '],   // agreement, differently cased
      ['raise prices', 'raise prices'],      // agreement, exact
      ['raise prices', 'hold prices'],       // overruled
      ['  ', ''],                            // no view expressed
      ['ship it', ' Ship It'],               // agreement, padded
      [null, 'anything'],                    // no recommendation at all
    ];
    for (const [rec, chosen] of cases) {
      await seedDecision('pw_agree', {
        category: 'strategic', decidedBy: 'founder', recommendation: rec, chosen, valence: 1,
      });
    }

    const fb = await processOutcomeFeedback('pw_agree');
    const stats = await getShadowStats('pw_agree');
    const ops = stats.find((s) => s.category === 'strategic');

    expect(fb.cleanCycles).toBe(3);
    expect(ops?.agreed).toBe(3);
    // Four samples, not five. The whitespace-only recommendation is out of the
    // DENOMINATOR too — it was never a sample of Foundry's judgement, and
    // leaving it in would understate the agreement rate the letter prints.
    expect(ops?.sampled).toBe(4);
    // And with four, the rate abstains rather than reporting 3/4. Dropping the
    // non-sample took the category below SHADOW_MIN_SAMPLE, so the letter says
    // "not enough shadow data yet" instead of a number — which is the honest
    // consequence of not counting a decision that tested nothing.
    expect(ops?.agreementRate).toBeNull();
    // Same rows, same rule, same number — asserted against each other rather
    // than each against a constant, so a change to either side has to move both.
    expect(fb.cleanCycles).toBe(ops?.agreed);
  });
});
