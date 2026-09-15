process.env.TURSO_DATABASE_URL = 'file::memory:';
process.env.ENCRYPTION_KEY = '0'.repeat(64);

import { beforeAll, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { runMigrations } from '../../src/db/migrate.js';
import { query } from '../../src/db/client.js';
import { DIMENSIONS, genomeOf, likeness } from '../../src/services/venture/genome.js';

// =============================================================================
// A RATE DERIVED FROM ONE RESULT.
//
// §19 asks for a structured fingerprint so experiments can be compared, and
// then says the thing that matters more than the fingerprint: "without
// overfitting tiny history". The history here is ONE experiment, which sold
// nothing to twenty-one businesses.
//
// A fingerprint invites a score; a score invites a ranking; a ranking built on
// one observation would tell the owner that cold email to millwork shops "does
// not work". It does not support that. One null result at one price through one
// channel to one population is an observation, and an observation is not a rate.
// The institution has made this mistake before in the other direction — two
// recipients were "safe" and taught nothing — and the lesson written into the
// curriculum is that sample size must match the uncertainty.
//
// So what these hold is mostly refusal:
//   the comparison will not speak at all until two experiments have settled;
//   two unknowns are never counted as a match;
//   a mixed population is its own value, not whichever came first;
//   a running experiment has no result, rather than an empty one;
//   and no scoring vocabulary exists in the module, held from the source,
//     because the way a score arrives is somebody adding one helpfully later.
// =============================================================================

const ROOT = resolve(import.meta.dirname, '../..');
const F = 'gn_founder';

/**
 * THE ORDER THE INSTITUTION INSISTS ON, walked rather than declared.
 *
 * An experiment cannot arrive already run. A recipient cannot be attached to
 * one that has run — the population is fixed before exposure, which is what
 * makes the prediction mean anything. And a recipient is never born approved:
 * approval is the owner's act, and the database says so rather than a service
 * remembering to. Three separate triggers, each of which refused a shortcut
 * here, and each of which is the reason a fixture that declares an end state
 * would be testing a state the product cannot reach.
 */
async function propose(id: string, what: string): Promise<void> {
  await query(
    `INSERT INTO venture_experiments
       (id, founder_id, opportunity_id, unknown_id, what_we_do, what_we_expect,
        would_disprove, evidence_mode, cost_cents)
     VALUES (?,?, 'gn_opp', 'gn_unknown', ?, 'some replies', 'silence', 'real', 2900)`,
    [id, F, what]);
}

async function recipient(id: string, experimentId: string, kind: string, stratum: string): Promise<void> {
  await query(
    `INSERT INTO experiment_recipients
       (id, founder_id, experiment_id, counterparty_ref, email, channel, review_status,
        contact_kind, evidence_stratum)
     VALUES (?,?,?,?,?, 'email', 'pending', ?, ?)`,
    [id, F, experimentId, `co_${id}`, `${id}@example.com`, kind, stratum]);
  await query(
    `UPDATE experiment_recipients SET review_status = 'approved', reviewed_by = ?,
            reviewed_at = datetime('now') WHERE id = ?`, [`founder:${F}`, id]);
}

async function settle(id: string, ranAt: string, verdict: string): Promise<void> {
  await query(
    `UPDATE venture_experiments SET decision = 'approved', decided_at = datetime('now'), decided_by = ?
      WHERE id = ?`, [F, id]);
  await query(
    `UPDATE venture_experiments SET ran_at = ?, verdict = ?, what_happened = 'nobody bought'
      WHERE id = ?`, [ranAt, verdict, id]);
}

beforeAll(async () => {
  await runMigrations();
  await query("INSERT INTO founders (id, clerk_user_id, email) VALUES (?,'gn_c','gn@test.local')", [F]);
  // THE CHAIN AN EXPERIMENT HANGS FROM, because it cannot exist without one:
  // a mandate, an opportunity under it, and the unknown the test exists to
  // answer. Every link carries `evidence_mode`, and the database refuses an
  // experiment whose mode disagrees with the opportunity's — a real test
  // cannot be quietly hung off a rehearsal.
  await query(
    `INSERT INTO venture_mandates (id, founder_id, statement, evidence_mode)
     VALUES ('gn_mandate', ?, 'digitally native, low touch', 'real')`, [F]);
  await query(
    `INSERT INTO venture_opportunities
       (id, mandate_id, founder_id, headline, who_has_it, the_problem, why_it_might,
        kill_thesis, evidence_mode)
     VALUES ('gn_opp', 'gn_mandate', ?, 'bid notices', 'millwork shops',
             'finding relevant public bids takes hours',
             'the notices are public and nobody filters them',
             'nobody pays because they already have somebody who does it', 'real')`, [F]);
  await query(
    `INSERT INTO market_unknowns (id, founder_id, opportunity_id, question)
     VALUES ('gn_unknown', ?, 'gn_opp', 'will a millwork shop pay for a filtered brief?')`, [F]);
  await propose('gn_first', 'write once to millwork shops');
  await recipient('gn_r1', 'gn_first', 'general', 'public_work_observed');
  await recipient('gn_r2', 'gn_first', 'general', 'public_work_observed');
  await settle('gn_first', '2026-09-12 10:00:00', 'surprised');

  await propose('gn_running', 'write once to cabinet shops');
  await recipient('gn_r3', 'gn_running', 'general', 'public_work_observed');
  await recipient('gn_r4', 'gn_running', 'named', 'commercial_institutional_capable');
});

describe('the shape of a test, read from rows', () => {
  it('records what is written down and leaves the rest unknown', async () => {
    const g = await genomeOf('gn_first');
    expect(g?.traits.sample_size.value).toBe('2');
    expect(g?.traits.contact_type.value).toBe('general');
    expect(g?.traits.cost_cents.value).toBe('2900');
    // Nothing recorded a price on a payment link, so there is no price. Not
    // zero, not inferred from the cost ceiling — absent.
    expect(g?.traits.price_cents.value).toBeNull();
    expect(g?.traits.offer_type.value).toBeNull();
  });

  it('every trait that has a value says which row it came from', async () => {
    const g = await genomeOf('gn_first');
    for (const d of DIMENSIONS) {
      const t = g?.traits[d];
      if (t?.value != null) expect(t.from, d).not.toBeNull();
    }
  });

  it('a mixed population is mixed, not whichever came first', async () => {
    // The confound §17's design lens exists to catch: a population contacted
    // partly at named people and partly at general inboxes is a third shape,
    // and collapsing it hides the thing most likely to explain the result.
    const g = await genomeOf('gn_running');
    expect(g?.traits.contact_type.value).toBe('mixed');
    expect(g?.traits.trust_level.value).toBe('mixed');
  });

  it('an experiment still running has no result rather than an empty one', async () => {
    const g = await genomeOf('gn_running');
    expect(g?.settledAt).toBeNull();
    expect(g?.traits.result.value).toBeNull();
  });
});

describe('what it refuses to conclude', () => {
  it('says nothing at all until two experiments have settled', async () => {
    // One has settled. The running one cannot be compared to it, and the
    // settled one has nothing to compare to but itself.
    const g = await genomeOf('gn_first');
    if (!g) throw new Error('no genome');
    const l = await likeness(F, g);
    expect(l.against).toBeNull();
    expect(l.shared).toEqual([]);
    expect(l.because).toContain('not a rate');
  });

  it('never counts two unknowns as a match', async () => {
    await propose('gn_second', 'write once to joinery shops');
    await recipient('gn_r5', 'gn_second', 'general', 'public_work_observed');
    await settle('gn_second', '2026-09-13 10:00:00', 'surprised');
    const g = await genomeOf('gn_first');
    if (!g) throw new Error('no genome');
    const l = await likeness(F, g);
    expect(l.against).toBe('gn_second');
    // Both are missing a price and an offer type. Neither may appear on either
    // side: two experiments that both failed to record their price are not two
    // experiments at the same price.
    expect(l.shared).not.toContain('price_cents');
    expect(l.differs).not.toContain('price_cents');
    expect(l.shared).toContain('contact_type');
  });

  it('carries no scoring vocabulary at all, in source', () => {
    // A fingerprint invites a score and a score invites a ranking. Held from
    // the source because the way it arrives is somebody adding a similarity
    // percentage helpfully, months from now, when nobody remembers why not.
    const src = readFileSync(resolve(ROOT, 'src/services/venture/genome.ts'), 'utf8');
    const code = src.split('\n').filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l)).join('\n');
    for (const word of ['score', 'similarity', 'rank', 'probability', 'confidence', 'predict']) {
      expect(code.toLowerCase(), word).not.toContain(word);
    }
    expect(code).not.toMatch(/\.length\s*\/\s*|\*\s*100|toFixed\(/);
  });
});
