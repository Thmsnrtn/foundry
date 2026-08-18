// =============================================================================
// Tests: the state machine had a door beside it
//
// Every rule about how a responsibility may move is enforced BEFORE INSERT ON
// `responsibility_transitions`: promotions advance exactly one rung, evidence is
// required, authority is required from 'assisting' upward, the from_state must
// match what the row actually holds, and — migration 115, the frozen boundary —
// nothing may enter 'operating' at all.
//
// None of it was enforced on the responsibility row itself. A plain
//
//   UPDATE institutional_responsibilities SET state = 'operating' WHERE id = ?
//
// skipped all six and left no transition behind. No TypeScript did that; the
// standard this campaign holds is that a rule must be enforced where the
// consequence is, not by everyone remembering. The constitutional invariant is
// "Foundry may not silently redefine what Foundry is allowed to do", and a state
// column writable directly is exactly the silent redefinition it names.
//
// This is the mutation the campaign runs on every governed gate, applied to the
// most consequential one in the institution: can the rule be reached around?
// =============================================================================

process.env.TURSO_DATABASE_URL = 'file::memory:';
process.env.ENCRYPTION_KEY = '0'.repeat(64);

import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { nanoid } from 'nanoid';

import { runMigrations } from '../../src/db/migrate.js';
import { query } from '../../src/db/client.js';

const OWNER = 'st_owner';
const P = 'st_product';

async function responsibility(state = 'unknown'): Promise<string> {
  const id = nanoid();
  await query(
    `INSERT INTO institutional_responsibilities (id, product_id, title, state, capability)
     VALUES (?, ?, 'Answer support mail', ?, 'customer_support')`,
    [id, P, state]);
  return id;
}

const stateOf = async (id: string): Promise<string> => String(((await query(
  'SELECT state FROM institutional_responsibilities WHERE id = ?', [id]))
  .rows[0] as Record<string, unknown>).state);

beforeAll(async () => {
  await runMigrations();
  await query(`INSERT INTO founders (id, clerk_user_id, email) VALUES (?,?,?)`,
    [OWNER, 'clerk_st', 'st@test.local']);
  await query(
    `INSERT INTO products (id, name, owner_id, status) VALUES (?, 'State Co', ?, 'active')`,
    [P, OWNER]);
});

/** Evidence has to name a signal this company actually recorded — the
 *  reference guard checks that, and a fabricated ref is refused before the
 *  state machine is even consulted. */
let evidenceRef = '';

beforeEach(async () => {
  // Children before parents: both tables carry a foreign key back to the
  // responsibility, so deleting it first is what the erasure plan calls a
  // parent-first delete and the database calls an error.
  await query('DELETE FROM responsibility_transitions', []);
  await query('DELETE FROM responsibility_dispositions WHERE product_id = ?', [P]);
  await query('DELETE FROM institutional_responsibilities WHERE product_id = ?', [P]);
  await query('DELETE FROM signal_events WHERE product_id = ?', [P]);
  const signalId = nanoid();
  await query(
    `INSERT INTO signal_events (id, product_id, source, event_type, severity, payload_json, summary)
     VALUES (?, ?, 'stripe', 'payment_failed', 'medium', '{}', 'Payment failed')`,
    [signalId, P]);
  evidenceRef = `signal_event:${signalId}`;
});

describe('a state cannot be reached around the transition ledger', () => {
  it('refuses a direct promotion', async () => {
    const id = await responsibility('unknown');
    await expect(query(
      `UPDATE institutional_responsibilities SET state = 'visible' WHERE id = ?`, [id]))
      .rejects.toThrow(/no_transition/);
    expect(await stateOf(id)).toBe('unknown');
  });

  it('refuses a direct jump straight to operating', async () => {
    // The frozen boundary. The freeze guards INSERTs into the transition
    // ledger; this is the path that never touched it.
    const id = await responsibility('assisting');
    await expect(query(
      `UPDATE institutional_responsibilities SET state = 'operating' WHERE id = ?`, [id]))
      .rejects.toThrow(/no_transition/);
    expect(await stateOf(id)).toBe('assisting');
  });

  it('refuses a direct demotion too', async () => {
    // Lowering autonomy without a record is still redefining what Foundry is
    // allowed to do — and it erases the reason.
    const id = await responsibility('shadowing');
    await expect(query(
      `UPDATE institutional_responsibilities SET state = 'unknown' WHERE id = ?`, [id]))
      .rejects.toThrow(/no_transition/);
  });

  it('allows the move the transition ledger justifies', async () => {
    // The apply trigger runs AFTER the transition insert, so by the time it
    // updates the row the justifying transition exists.
    const id = await responsibility('unknown');
    await query(
      `INSERT INTO responsibility_transitions
         (id, responsibility_id, from_state, to_state, evidence_ref, reason, actor_ref)
       VALUES (?, ?, 'unknown', 'visible', ?, 'observed', 'test')`,
      [nanoid(), id, evidenceRef]);
    expect(await stateOf(id)).toBe('visible');
  });

  it('leaves an update that does not touch the state alone', async () => {
    // The guard is on the state column. Ordinary edits to the row must keep
    // working — a guard that refuses everything is not a guard.
    const id = await responsibility('unknown');
    await query(
      `UPDATE institutional_responsibilities SET title = 'Renamed' WHERE id = ?`, [id]);
    expect(await stateOf(id)).toBe('unknown');
  });

  it('makes operating unreachable by any path, not just one', async () => {
    // The freeze refuses the transition; this refuses the way around it. Both
    // together are what "frozen" has to mean.
    const id = await responsibility('assisting');
    await expect(query(
      `INSERT INTO responsibility_transitions
         (id, responsibility_id, from_state, to_state, evidence_ref, authority_ref, reason, actor_ref)
       VALUES (?, ?, 'assisting', 'operating', ?, 'autonomy_consent:y', 'earned', 'test')`,
      [nanoid(), id, evidenceRef])).rejects.toThrow(/not_earned/);
    await expect(query(
      `UPDATE institutional_responsibilities SET state = 'operating' WHERE id = ?`, [id]))
      .rejects.toThrow(/no_transition/);
    expect(await stateOf(id)).toBe('assisting');
  });
});

describe('the justification must be the move, not merely the destination', () => {
  it('refuses a jump to a state this row reached from somewhere else', async () => {
    // Walk up, then demote by a real transition. A transition INTO 'shadowing'
    // now exists — but it came from 'understood', and the row is at 'visible'.
    // A guard that only checked the destination would let this through, which is
    // how a demoted responsibility climbs back without earning it again.
    const id = await responsibility('unknown');
    for (const [from, to] of [['unknown', 'visible'], ['visible', 'understood'],
      ['understood', 'shadowing']]) {
      await query(
        `INSERT INTO responsibility_transitions
           (id, responsibility_id, from_state, to_state, evidence_ref, reason, actor_ref)
         VALUES (?, ?, ?, ?, ?, 'climbing', 'test')`,
        [nanoid(), id, from, to, evidenceRef]);
    }
    await query(
      `INSERT INTO responsibility_transitions
         (id, responsibility_id, from_state, to_state, evidence_ref, reason, actor_ref)
       VALUES (?, ?, 'shadowing', 'visible', ?, 'demoted', 'test')`,
      [nanoid(), id, evidenceRef]);
    expect(await stateOf(id)).toBe('visible');

    await expect(query(
      `UPDATE institutional_responsibilities SET state = 'shadowing' WHERE id = ?`, [id]))
      .rejects.toThrow(/no_transition/);
    expect(await stateOf(id)).toBe('visible');
  });
});

describe('nothing is born into the frozen boundary', () => {
  for (const state of ['operating', 'mature', 'exception_owned']) {
    it(`refuses a responsibility created directly as ${state}`, async () => {
      // Production never names `state` on insert — the create, the candidate
      // promotion and the discovery path all take the default and transition
      // from there — so nothing legitimate loses anything here. The only place
      // in the codebase a responsibility was ever Operating was a test fixture
      // that did not need it to be.
      await expect(query(
        `INSERT INTO institutional_responsibilities (id, product_id, title, state, capability)
         VALUES (?, ?, 'Born too high', ?, 'customer_support')`,
        [nanoid(), P, state])).rejects.toThrow(/not_a_birth_state/);
    });
  }

  it('still allows the rungs a fixture legitimately starts from', async () => {
    // Deliberately not the whole ladder: dozens of fixtures create a
    // responsibility already Shadowing to set up the case they are about, and
    // refusing those would make this a change about test ergonomics rather than
    // about the constitution.
    const id = await responsibility('shadowing');
    expect(await stateOf(id)).toBe('shadowing');
  });
});

// ── the same door, on the other governed column ─────────────────────────────

describe('a disposition cannot be written around its ledger', () => {
  async function disposed(id: string): Promise<Record<string, unknown>> {
    return (await query(
      `SELECT disposition, disposition_reason, disposition_evidence_ref
         FROM institutional_responsibilities WHERE id = ?`, [id]))
      .rows[0] as Record<string, unknown>;
  }

  it('refuses a direct "deliberately not done"', async () => {
    // This is the institution's record that the founder LOOKED and chose not to
    // act — what the seven-day absence summary reports, and the only thing that
    // lets it tell neglect from a decision. Writing it directly satisfies none
    // of the three guards on the ledger: owner, reason, evidence.
    const id = await responsibility('unknown');
    await expect(query(
      `UPDATE institutional_responsibilities SET disposition = 'deliberately_not_done' WHERE id = ?`,
      [id])).rejects.toThrow(/no_record/);
    expect((await disposed(id)).disposition).toBe('active');
  });

  it('accepts the one the ledger justifies', async () => {
    const id = await responsibility('unknown');
    await query(
      `INSERT INTO responsibility_dispositions
         (id, responsibility_id, product_id, disposition, reason, evidence_ref, owner_id)
       VALUES (?, ?, ?, 'deliberately_not_done', 'Customer already recovered', ?, ?)`,
      [nanoid(), id, P, evidenceRef, OWNER]);
    const row = await disposed(id);
    expect(row.disposition).toBe('deliberately_not_done');
    expect(row.disposition_reason).toBe('Customer already recovered');
  });

  it('refuses a quiet rewrite of the justification afterwards', async () => {
    // The more interesting attack: the decision was properly made, and the
    // REASON for it is edited later. The ledger still says what really happened.
    const id = await responsibility('unknown');
    await query(
      `INSERT INTO responsibility_dispositions
         (id, responsibility_id, product_id, disposition, reason, evidence_ref, owner_id)
       VALUES (?, ?, ?, 'deliberately_not_done', 'Customer already recovered', ?, ?)`,
      [nanoid(), id, P, evidenceRef, OWNER]);

    await expect(query(
      `UPDATE institutional_responsibilities SET disposition_reason = 'It was never our job' WHERE id = ?`,
      [id])).rejects.toThrow(/no_record/);
    expect((await disposed(id)).disposition_reason).toBe('Customer already recovered');
  });

  it('refuses inventing a justification on a row that was never disposed', async () => {
    // The three-valued trap, and the case that matters most. These columns are
    // NULL until the first disposition, `disposition` itself stays 'active',
    // and `NULL <> 'x'` is NULL rather than true — so a guard written with `<>`
    // would not even fire here. This is the FIRST write, the one that invents a
    // judgement nobody made.
    const id = await responsibility('unknown');
    await expect(query(
      `UPDATE institutional_responsibilities SET disposition_reason = 'We decided against it' WHERE id = ?`,
      [id])).rejects.toThrow(/no_record/);
    expect((await disposed(id)).disposition_reason).toBeNull();
  });

  it('leaves an update that touches neither alone', async () => {
    const id = await responsibility('unknown');
    await query(
      `UPDATE institutional_responsibilities SET title = 'Renamed' WHERE id = ?`, [id]);
    expect((await disposed(id)).disposition).toBe('active');
  });
});

// ── the six the gate found ──────────────────────────────────────────────────

describe('a candidate cannot be promoted around its owner', () => {
  async function candidate(): Promise<string> {
    const id = nanoid();
    await query(
      `INSERT INTO responsibility_candidates
         (id, product_id, convergence_key, proposed_responsibility, evidence_refs_json,
          derivation_method, rationale, epistemic_status, observed_at)
       VALUES (?, ?, ?, 'Answer support mail', ?, 'observation', 'seen twice', 'known', datetime('now'))`,
      [id, P, id, JSON.stringify([{ kind: 'signal_event', id: evidenceRef.split(':')[1] }])]);
    return id;
  }

  const statusOfCandidate = async (id: string): Promise<string> => String(((await query(
    'SELECT status FROM responsibility_candidates WHERE id = ?', [id]))
    .rows[0] as Record<string, unknown>).status);

  it('refuses a direct promotion', async () => {
    // Promotion turns a candidate into a real responsibility, and the lifecycle
    // guard is where that means something: the decision must be grounded in an
    // authenticated owner whose ref matches the company's actual owner. A plain
    // UPDATE promotes it with no founder anywhere near the decision. That is not
    // a missing audit trail — it is a missing authorisation.
    const id = await candidate();
    await expect(query(
      `UPDATE responsibility_candidates SET status = 'promoted' WHERE id = ?`, [id]))
      .rejects.toThrow(/no_decision/);
    expect(await statusOfCandidate(id)).toBe('pending');
  });

  it('refuses a direct rejection too', async () => {
    const id = await candidate();
    await expect(query(
      `UPDATE responsibility_candidates SET status = 'rejected' WHERE id = ?`, [id]))
      .rejects.toThrow(/no_decision/);
  });

  it('accepts the move the decision ledger justifies', async () => {
    const id = await candidate();
    await query(
      `INSERT INTO responsibility_candidate_decisions
         (id, candidate_id, product_id, decision, actor_ref, grounding_mechanism, grounding_evidence_json)
       VALUES (?, ?, ?, 'rejected', ?, 'authenticated_owner', '[]')`,
      [nanoid(), id, P, `founder:${OWNER}`]);
    expect(await statusOfCandidate(id)).toBe('rejected');
  });

  it('knows that reconsidering returns a candidate to pending', async () => {
    // The decision and the status it produces are not the same word for one of
    // the four. A guard that assumed they were would refuse the legitimate path.
    const id = await candidate();
    await query(
      `INSERT INTO responsibility_candidate_decisions
         (id, candidate_id, product_id, decision, actor_ref, grounding_mechanism, grounding_evidence_json)
       VALUES (?, ?, ?, 'rejected', ?, 'authenticated_owner', '[]')`,
      [nanoid(), id, P, `founder:${OWNER}`]);
    await query(
      `INSERT INTO responsibility_candidate_decisions
         (id, candidate_id, product_id, decision, actor_ref, grounding_mechanism, grounding_evidence_json)
       VALUES (?, ?, ?, 'reconsidered', ?, 'authenticated_owner', '[]')`,
      [nanoid(), id, P, `founder:${OWNER}`]);
    expect(await statusOfCandidate(id)).toBe('pending');
  });
});

describe('the proof behind a state has to name something real', () => {
  it('refuses an authority that names no consent', async () => {
    const id = await responsibility('unknown');
    await expect(query(
      `UPDATE institutional_responsibilities SET authority_ref = 'autonomy_consent:invented' WHERE id = ?`,
      [id])).rejects.toThrow(/authority_invalid/);
  });

  it('refuses evidence that names no observation', async () => {
    const id = await responsibility('unknown');
    await expect(query(
      `UPDATE institutional_responsibilities SET evidence_ref = 'signal_event:invented' WHERE id = ?`,
      [id])).rejects.toThrow(/evidence_invalid/);
  });

  it('refuses an outcome that names no completed execution', async () => {
    const id = await responsibility('unknown');
    await expect(query(
      `UPDATE institutional_responsibilities SET outcome_ref = 'action_execution:invented' WHERE id = ?`,
      [id])).rejects.toThrow(/outcome_invalid/);
  });

  it('allows a re-grant to point at the authority that is actually current', async () => {
    // The legitimate direct write, and the reason these three columns are
    // guarded differently from `state`: a responsibility already Assisting is
    // not re-admitted when its permission is renewed, and the transition ledger
    // would refuse an assisting->assisting move as a no-change.
    const id = await responsibility('unknown');
    const consentId = nanoid();
    await query(
      `INSERT INTO autonomy_consents
         (id, founder_id, product_id, capability, from_mode, to_mode, disclosure_version)
       VALUES (?, ?, ?, 'customer_support', 'suggest', 'act', 'test')`,
      [consentId, OWNER, P]);
    await query(
      `UPDATE institutional_responsibilities SET authority_ref = ? WHERE id = ?`,
      [`autonomy_consent:${consentId}`, id]);
    const row = (await query(
      'SELECT authority_ref FROM institutional_responsibilities WHERE id = ?', [id]))
      .rows[0] as Record<string, unknown>;
    expect(row.authority_ref).toBe(`autonomy_consent:${consentId}`);
  });

  it('refuses a consent for a different capability than the responsibility has', async () => {
    const id = await responsibility('unknown');
    const consentId = nanoid();
    await query(
      `INSERT INTO autonomy_consents
         (id, founder_id, product_id, capability, from_mode, to_mode, disclosure_version)
       VALUES (?, ?, ?, 'operations', 'suggest', 'act', 'test')`,
      [consentId, OWNER, P]);
    await expect(query(
      `UPDATE institutional_responsibilities SET authority_ref = ? WHERE id = ?`,
      [`autonomy_consent:${consentId}`, id])).rejects.toThrow(/authority_invalid/);
  });

  it('refuses a revoked consent', async () => {
    const id = await responsibility('unknown');
    const consentId = nanoid();
    await query(
      `INSERT INTO autonomy_consents
         (id, founder_id, product_id, capability, from_mode, to_mode, disclosure_version, revoked_at)
       VALUES (?, ?, ?, 'customer_support', 'suggest', 'act', 'test', datetime('now'))`,
      [consentId, OWNER, P]);
    await expect(query(
      `UPDATE institutional_responsibilities SET authority_ref = ? WHERE id = ?`,
      [`autonomy_consent:${consentId}`, id])).rejects.toThrow(/authority_invalid/);
  });
});
