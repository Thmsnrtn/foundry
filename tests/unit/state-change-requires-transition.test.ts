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
  await query('DELETE FROM responsibility_transitions', []);
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
