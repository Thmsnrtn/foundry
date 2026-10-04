// =============================================================================
// LAW (Roadmap 2027 R52): IN FLIGHT COUNTS EVERY TEST, WHICHEVER CHARTER LET
// IT IN.
//
// The owner signs "three in flight". A renewal withdraws the standing charter
// and writes a new one, and both the reading and the row guard counted only
// carves under the live charter, so "Renew as it stands" with three tests
// running opened three more places: six in flight against a signed three.
//
// Money stays per charter, by design: each signature is a new total for its
// own term. What a renewal may never do is reset how many tests run at once.
// The reading and the row guard now count every unsettled test the owner has,
// under any charter, and the charter page shows the earlier ones as such.
// =============================================================================
process.env.TURSO_DATABASE_URL = 'file::memory:';
process.env.ENCRYPTION_KEY = 'i'.repeat(64);

import { beforeAll, describe, expect, it } from 'vitest';
import { runMigrations } from '../../src/db/migrate.js';
import { query } from '../../src/db/client.js';
import { carve, envelopeReading, liveCharter, signCharter, chartered } from '../../src/services/institution/charter.js';

const OWNER = 'ifc_owner';

/** An approved real test with its asset, as approval leaves one. */
async function anApprovedTest(n: number): Promise<{ experimentId: string; productId: string }> {
  const x = `ifc_x${String(n)}`;
  await query(
    `INSERT INTO market_unknowns (id, founder_id, opportunity_id, question, blocking, cheapest_test)
     VALUES (?,?,'ifc_opp','whether anyone pays',1,'offer one')`, [`ifc_unk${String(n)}`, OWNER]);
  await query(
    `INSERT INTO venture_experiments (id, founder_id, opportunity_id, unknown_id, what_we_do, what_we_expect, would_disprove, cost_cents, evidence_mode)
     VALUES (?,?,'ifc_opp',?,'offer one','one pays','nobody pays',1000,'real')`, [x, OWNER, `ifc_unk${String(n)}`]);
  const { decideExperiment } = await import('../../src/services/venture/validation.js');
  await decideExperiment({ experimentId: x, decision: 'approved', by: `founder:${OWNER}`, via: 'a test' });
  let p = (await query('SELECT id FROM products WHERE from_experiment_id = ?', [x])).rows[0];
  if (!p) {
    await query(`INSERT INTO products (id, name, owner_id, status, reality, standing, from_experiment_id, from_opportunity_id) VALUES (?,?,?,'active','real','experimental',?,'ifc_opp')`,
      [`ifc_p${String(n)}`, `Test ${String(n)}`, OWNER, x]);
    p = { id: `ifc_p${String(n)}` };
  }
  return { experimentId: x, productId: String(p.id) };
}

beforeAll(async () => {
  await runMigrations();
  await query('INSERT INTO founders (id,clerk_user_id,email,name) VALUES (?,?,?,?)', [OWNER, 'ifc_clk', 'ifc@example.com', 'Owner']);
  const { openMandate } = await import('../../src/services/venture/mandate.js');
  const m = await openMandate({ founderId: OWNER, statement: 'Small things for trades businesses', shape: null, evidenceMode: 'real' });
  if ('refused' in m) throw new Error(m.refused);
  await query(
    `INSERT INTO venture_opportunities (id, mandate_id, founder_id, headline, who_has_it, the_problem, why_it_might, kill_thesis, sources_json, evidence_mode)
     VALUES ('ifc_opp',?,?,'a brief','contractors','by hand','said so','one firm','[]','real')`, [m.id, OWNER]);
});

describe('a renewal does not reset how many tests run at once', () => {
  it('with one place signed and one test in flight, renewing leaves no room for another', async () => {
    await signCharter({ founderId: OWNER, testsTotalCents: 10_000, probesInFlight: 1, cognitionCentsPerDay: 300, days: 30, publicVoice: 'Apex Micro', statement: 'The first term.' });
    const first = (await liveCharter(OWNER))!;
    const a = await anApprovedTest(1);
    await carve({ charterId: first.id, experimentId: a.experimentId, productId: a.productId, cents: 1000 });
    expect((await envelopeReading(OWNER))!).toMatchObject({ inFlight: 1, roomForAnother: false });

    // "Renew as it stands": a new signature, the same numbers.
    await signCharter({ founderId: OWNER, testsTotalCents: 10_000, probesInFlight: 1, cognitionCentsPerDay: 300, days: 30, publicVoice: 'Apex Micro', statement: 'Renewed as it stands.' });
    const second = (await liveCharter(OWNER))!;
    expect(second.id).not.toBe(first.id);

    const reading = (await envelopeReading(OWNER))!;
    expect(reading.inFlight).toBe(1);
    expect(reading.roomForAnother).toBe(false);
    // Money is per signature: the new term's total is whole.
    expect(reading.remainingCents).toBe(10_000);
    // The earlier charter's running test is shown, and said to be the earlier one's.
    expect(reading.carves).toEqual([expect.objectContaining({ experimentId: a.experimentId, settled: false, underEarlierCharter: true })]);

    const b = await anApprovedTest(2);
    const c = await chartered({ founderId: OWNER, experimentId: b.experimentId, costCents: 1000, rungs: ['public', 'financial'] });
    expect(c.inside).toBe(false);
    expect(c.because.join(' ')).toMatch(/1 of 1 probes are already in flight/);
  });

  it('the row guard refuses the carve too, whatever the reading said', async () => {
    const live = (await liveCharter(OWNER))!;
    const b = { experimentId: 'ifc_x2', productId: String((await query("SELECT id FROM products WHERE from_experiment_id = 'ifc_x2'", [])).rows[0]!.id) };
    await expect(carve({ charterId: live.id, experimentId: b.experimentId, productId: b.productId, cents: 1000 }))
      .rejects.toThrow(/portfolio_envelope_carve:no_room_in_flight/);
  });

  it('once the earlier test has an answer, the place is free under the new charter', async () => {
    await query(`UPDATE venture_experiments SET what_happened = 'nobody paid', verdict = 'as_predicted', ran_at = datetime('now') WHERE id = 'ifc_x1'`, []);
    const reading = (await envelopeReading(OWNER))!;
    expect(reading).toMatchObject({ inFlight: 0, roomForAnother: true });
    // A settled test from an earlier charter is history, not this charter's list.
    expect(reading.carves).toEqual([]);
    const live = (await liveCharter(OWNER))!;
    const p = String((await query("SELECT id FROM products WHERE from_experiment_id = 'ifc_x2'", [])).rows[0]!.id);
    await carve({ charterId: live.id, experimentId: 'ifc_x2', productId: p, cents: 1000 });
    expect((await envelopeReading(OWNER))!).toMatchObject({ inFlight: 1, roomForAnother: false, remainingCents: 9_000 });
  });

  it('another owner\'s tests never count against this one', async () => {
    await query('INSERT INTO founders (id,clerk_user_id,email,name) VALUES (?,?,?,?)', ['ifc_other', 'ifc_clk2', 'other@example.com', 'Other']);
    await signCharter({ founderId: 'ifc_other', testsTotalCents: 5_000, probesInFlight: 1, cognitionCentsPerDay: 300, days: 30, publicVoice: 'Other', statement: 'Theirs.' });
    expect((await envelopeReading('ifc_other'))!).toMatchObject({ inFlight: 0, roomForAnother: true, carves: [] });
  });
});
