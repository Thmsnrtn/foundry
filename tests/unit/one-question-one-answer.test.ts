// =============================================================================
// Tests: The Letter answers its own central question once.
//
// The headline card says "the one thing that needs you". It read the
// highest-gate pending row of `decisions` and linked to /decisions.
// Twenty-seven lines below, the same page rendered the institution's NEEDS_YOU
// list, computed independently from `institutional_responsibilities`. Nothing
// reconciled them.
//
// So the page answered its own central question twice, differently — and the
// headline could say "Gate-2: pick a pricing page" while an obligation whose
// stated date had passed sat further down under a quieter heading. A page that
// contradicts itself about what matters most is false institutional truth on
// the surface the founder reads first.
//
// Both ledgers stay canonical for what they hold. No new store, no copy: this
// is a projection over them, which is what the page was already pretending to
// be.
//
// THERE ARE THREE, not two. `strategic_decisions_log` holds the judgments
// Foundry raised about the company — two responsibilities wanting the same
// resource, and the owner having to allocate or change capacity. Those rendered
// in their own section and could never be the one thing, however material, so
// the headline was still projecting over a subset. A contradicted judgment is
// LATE in exactly the sense `overdue` is: the observation pass may only report
// it against a date the company itself gave. An open one is real and is not
// late, so it ranks below the founder's own queue — and it is the one thing
// when nothing else is, because Foundry asked and nobody answered.
// =============================================================================

process.env.TURSO_DATABASE_URL = 'file::memory:';
process.env.ENCRYPTION_KEY = '0'.repeat(64);

import { beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { runMigrations } from '../../src/db/migrate.js';
import { query } from '../../src/db/client.js';
import { composeLetter } from '../../src/services/letter/composer.js';

const F = 'oq_founder';
const P = 'oq_product';

const inDays = (n: number) => new Date(Date.now() + n * 86_400_000).toISOString();

beforeAll(async () => { await runMigrations(); });

beforeEach(async () => {
  await query(`DELETE FROM responsibility_transitions`);
  await query(`DELETE FROM institutional_responsibilities WHERE product_id = ?`, [P]);
  await query(`DELETE FROM decisions WHERE product_id = ?`, [P]);
  await query(`DELETE FROM institutional_judgment_evaluations WHERE product_id = ?`, [P]);
  await query(`DELETE FROM strategic_decisions_log WHERE product_id = ?`, [P]);
  await query(`DELETE FROM signal_events WHERE product_id = ?`, [P]);
  await query(`DELETE FROM products WHERE id = ?`, [P]);
  await query(`DELETE FROM founders WHERE id = ?`, [F]);
  await query(`INSERT INTO founders (id, clerk_user_id, email) VALUES (?,?,?)`,
    [F, 'clerk_oq', 'oq@test.local']);
  await query(
    `INSERT INTO products (id, name, owner_id, status, scp_status)
     VALUES (?, 'Asking Co', ?, 'active', 'active')`, [P, F]);
});

async function pendingDecision(gate: number, what: string): Promise<void> {
  await query(
    `INSERT INTO decisions (id, product_id, what, why_now, category, gate, status)
     VALUES (?, ?, ?, 'Now', 'strategic', ?, 'pending')`,
    [`d_${gate}_${what.slice(0, 6)}`, P, what, gate]);
}

async function overdueResponsibility(title: string): Promise<void> {
  await query(
    `INSERT INTO institutional_responsibilities
       (id, product_id, title, capability, state, due_at, due_stated_by)
     VALUES ('oq_r', ?, ?, 'customer_support', 'visible', ?, ?)`,
    [P, title, inDays(1), F]);
  await query(
    `UPDATE institutional_responsibilities SET due_at = ? WHERE id = 'oq_r'`, [inDays(-2)]);
}

/** A material institutional judgment: raised, evidence-backed, no direction
 *  given. The guards require the referenced responsibilities to be real and on
 *  this product, which is why they are seeded rather than named. */
async function openJudgment(title: string): Promise<void> {
  await query(
    `INSERT INTO signal_events (id,product_id,source,event_type,severity,payload_json,summary)
     VALUES ('oq_j_sig', ?, 'operations','capacity_observed','medium','{}','Evidence')`, [P]);
  await query(
    `INSERT INTO institutional_responsibilities (id,product_id,title,capability,state) VALUES
       ('oq_ja', ?, 'Urgent support obligation','customer_support','understood'),
       ('oq_jb', ?, 'Planned development','development','understood')`, [P, P]);
  await query(
    `INSERT INTO strategic_decisions_log
       (id,product_id,decision_title,decision_description,decision_category,made_by,status,
        agent_context_json,responsibility_refs_json,evidence_refs_json)
     VALUES ('oq_j', ?, ?, 'Allocate or change capacity','operations','agent_recommendation',
             'active','{}','["oq_ja","oq_jb"]','["signal_event:oq_j_sig"]')`, [P, title]);
}

describe('the one thing is chosen across all three canonical sources', () => {
  it('prefers a date the company gave that has passed', async () => {
    // A stated date passing is a fact about the COMPANY. A pending decision is
    // a fact about Foundry's queue. When both exist the founder is told about
    // the one the world has already decided.
    await pendingDecision(3, 'Pick a pricing page');
    await overdueResponsibility('Renew the insurance');

    const letter = await composeLetter(P);
    expect(letter.needsYou).toContain('Renew the insurance');
    expect(letter.needsYou, 'the founder is told it is late, not just that it exists')
      .toMatch(/due|not been handled/);
    expect(letter.needsYouHref, 'the button must go where the thing actually is')
      .toBe('/letter');
  });

  it('falls back to the decision queue when nothing is overdue', async () => {
    // The old behaviour, preserved: this was never wrong, it was incomplete.
    await pendingDecision(3, 'Pick a pricing page');
    const letter = await composeLetter(P);
    expect(letter.needsYou).toContain('Pick a pricing page');
    expect(letter.needsYouHref).toBe('/decisions');
  });

  it('still speaks when the queue is empty but a responsibility needs them', async () => {
    // The gap that made the page contradict itself: with no pending decision
    // the headline said nothing at all, while NEEDS_YOU below it had items.
    await query(
      `INSERT INTO institutional_responsibilities
         (id, product_id, title, capability, state)
       VALUES ('oq_watch', ?, 'Answer support mail', 'customer_support', 'shadowing')`, [P]);
    const letter = await composeLetter(P);
    expect(letter.needsYou, 'the headline was silent while the page listed work')
      .toContain('Answer support mail');
    expect(letter.needsYouHref).toBe('/letter');
  });

  it('speaks for a judgment it raised when nothing else does', async () => {
    // The third store. This was rendered in its own section and could never be
    // the headline, so a founder with an empty decision queue and no
    // responsibility ask was told nothing needed them while Foundry was waiting
    // on a direction it had asked for.
    await openJudgment('Two things want the same week');
    const letter = await composeLetter(P);
    expect(letter.needsYou).toContain('Two things want the same week');
    expect(letter.needsYou, 'it must say that Foundry asked and got no answer')
      .toMatch(/you have not said which way to go/);
    expect(letter.needsYouHref).toBe('/letter');
  });

  it('ranks an open judgment below the founder own queue, and a late one above it', async () => {
    // Nothing about an open judgment is late, so the founder's own pending
    // decision comes first.
    await openJudgment('Two things want the same week');
    await pendingDecision(3, 'Pick a pricing page');
    expect((await composeLetter(P)).needsYou).toContain('Pick a pricing page');

    // Contradicted is a different thing: the observation pass may only report
    // it against a date the COMPANY gave, so it means that date passed with the
    // conflict still standing.
    await query(
      `INSERT INTO institutional_judgment_evaluations
         (id,judgment_id,product_id,state,evidence_refs_json,economic_result_json)
       VALUES ('oq_ev','oq_j', ?, 'contradicted','[]','{"status":"unknown","value":null}')`, [P]);
    const later = await composeLetter(P);
    expect(later.needsYou).toContain('Two things want the same week');
    expect(later.needsYou).toMatch(/the date you gave passed/);
  });

  it('says nothing when there is genuinely nothing', async () => {
    const letter = await composeLetter(P);
    expect(letter.needsYou).toBeNull();
  });

  it('uses founder words, never the internal reason', async () => {
    await query(
      `INSERT INTO institutional_responsibilities
         (id, product_id, title, capability, state)
       VALUES ('oq_watch', ?, 'Answer support mail', 'customer_support', 'shadowing')`, [P]);
    const letter = await composeLetter(P);
    // The snake_case identifiers, not the English words they were named
    // after: "I have been watching this" is the founder's sentence and
    // legitimately contains "watching". What must never appear is the token.
    for (const internal of ['permission_withdrawn', 'permission_expired',
      'outcome_unresolved', 'needsYouBecause']) {
      expect(letter.needsYou, `${internal} leaked onto the page`).not.toContain(internal);
    }
    expect(letter.needsYou, 'a sentence, not a status')
      .toMatch(/I have been watching this/);
  });
});
