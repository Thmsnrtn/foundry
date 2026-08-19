// =============================================================================
// Tests: a responsibility can be due, and Foundry can notice when it is.
//
// `institutional_responsibilities` recorded what a company owes, who carries
// it, what evidence found it and what authority permits acting — and not when
// it is due. Meanwhile the vocabulary Foundry offers the founder is entirely
// date-shaped: "Something we owe someone by a date", "Something that has to
// happen regularly", "Something a customer is waiting on". A founder could say
// "renew the insurance by 1 March" and Foundry stored the sentence and could
// never learn that 1 March arrived.
//
// The code said so twice, unprompted. `institutional-judgment.ts` emitted
// `deadline unknown` as an uncertainty on EVERY judgment, because
// `Demand.deadline` had no supply anywhere. And the judgment observer records
// that it can never report `contradicted` because "contradiction needs an
// observer that can see a deadline pass, which does not exist yet".
//
// Time is also the only fact about a company Foundry can establish with no
// founder, no provider and no integration — every other independent
// observation needs an outside system to speak. This one needs a clock.
//
// THE DATE COMES FROM THE COMPANY. Same line migration 137 draws for
// outcomes: if Foundry may invent a deadline, it may later judge itself
// against a deadline it invented.
// =============================================================================

process.env.TURSO_DATABASE_URL = 'file::memory:';
process.env.ENCRYPTION_KEY = '0'.repeat(64);

import { beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { runMigrations } from '../../src/db/migrate.js';
import { query } from '../../src/db/client.js';
import { reportCompanyObligation, statedDueDate } from '../../src/services/founder/company-report.js';
import { getSevenDayResponsibilitySummary } from '../../src/services/institution/absence-summary.js';

const F = 'tt_founder';
const P = 'tt_product';

const inDays = (n: number) => new Date(Date.now() + n * 86_400_000).toISOString();

beforeAll(async () => {
  await runMigrations();
});

beforeEach(async () => {
  // Children before parents: dispositions and transitions reference the
  // responsibilities, and both reference signal events.
  await query(`DELETE FROM responsibility_dispositions WHERE product_id = ?`, [P]);
  await query(`DELETE FROM responsibility_transitions`);
  await query(`DELETE FROM institutional_responsibilities WHERE product_id = ?`, [P]);
  await query(`DELETE FROM signal_events WHERE product_id = ?`, [P]);
  await query(`DELETE FROM products WHERE id = ?`, [P]);
  await query(`DELETE FROM founders WHERE id = ?`, [F]);
  await query(`INSERT INTO founders (id, clerk_user_id, email) VALUES (?,?,?)`,
    [F, 'clerk_tt', 'tt@test.local']);
  await query(
    `INSERT INTO products (id, name, owner_id, status, scp_status)
     VALUES (?, 'Timed Co', ?, 'active', 'active')`, [P, F]);
});

describe('only the company states a date, and only a usable one', () => {
  it('takes an explicit date the company supplied', () => {
    const d = statedDueDate(inDays(7));
    expect(d).not.toBeNull();
    expect(Date.parse(d!)).toBeGreaterThan(Date.now());
  });

  it('refuses prose', () => {
    // "by the end of the month" is a sentence, not a deadline. Turning one
    // into the other would be Foundry authoring the thing it later judges
    // itself against.
    for (const v of ['by the end of the month', 'soon', 'next quarter', '']) {
      expect(statedDueDate(v), `${v} is not a date`).toBeNull();
    }
  });

  it('refuses a date already past', () => {
    // Almost always a typo or a timezone confusion, and the one thing worse
    // than no sense of time is a sense of time that opens by reporting a
    // fabricated overdue.
    expect(statedDueDate(inDays(-3))).toBeNull();
  });

  it('refuses a non-string', () => {
    for (const v of [null, undefined, 42, {}, []]) {
      expect(statedDueDate(v)).toBeNull();
    }
  });
});

describe('the database refuses a date with no author', () => {
  it('will not store a due date without who stated it', async () => {
    await expect(query(
      `INSERT INTO institutional_responsibilities (id, product_id, title, capability, due_at)
       VALUES ('tt_r1', ?, 'A thing', 'outreach', ?)`, [P, inDays(3)]))
      .rejects.toThrow(/date_and_source_go_together/);
  });

  it('will not store an author without a date', async () => {
    await expect(query(
      `INSERT INTO institutional_responsibilities (id, product_id, title, capability, due_stated_by)
       VALUES ('tt_r2', ?, 'A thing', 'outreach', ?)`, [P, F]))
      .rejects.toThrow(/date_and_source_go_together/);
  });

  it('will not let Foundry state a deadline on anybody', async () => {
    // The constitutional line. `system_identities` names Foundry's own product;
    // its owner is the one principal that must not author a due date, because
    // a deadline it wrote is one it could then report itself as having met.
    // Establish the identity for real rather than asserting the trigger
    // exists. A first attempt at this test took a fallback branch when no
    // Foundry identity was present, and a mutation that removed the guard
    // entirely still passed — a test that checks a trigger is DEFINED proves
    // nothing about whether it FIRES.
    const { establishSystemIdentity } = await import('../../src/services/system-identity.js');
    const FOUNDRY_OWNER = 'tt_foundry_owner';
    await query(`INSERT OR IGNORE INTO founders (id, clerk_user_id, email) VALUES (?,?,?)`,
      [FOUNDRY_OWNER, 'clerk_tt_f', 'foundry@test.local']);
    await query(
      `INSERT OR IGNORE INTO products (id, name, owner_id, status)
       VALUES ('tt_foundry','Foundry',?, 'active')`, [FOUNDRY_OWNER]);
    const claim = await establishSystemIdentity('foundry', 'tt_foundry', 'test fixture');
    const foundryOwner = claim.productId === 'tt_foundry'
      ? FOUNDRY_OWNER
      : String(((await query(
        `SELECT p.owner_id FROM system_identities s JOIN products p ON p.id = s.product_id
          WHERE s.identity_key = 'foundry'`, [])).rows[0] as Record<string, unknown>).owner_id);

    await expect(query(
      `INSERT INTO institutional_responsibilities (id, product_id, title, capability, due_at, due_stated_by)
       VALUES ('tt_r3', ?, 'A thing', 'outreach', ?, ?)`,
      [P, inDays(3), foundryOwner]),
      'the institution set a deadline on a customer company')
      .rejects.toThrow(/institution_may_not_state_a_deadline/);

    // And a real company's founder still can.
    await query(
      `INSERT INTO institutional_responsibilities (id, product_id, title, capability, due_at, due_stated_by)
       VALUES ('tt_r4', ?, 'A thing', 'outreach', ?, ?)`, [P, inDays(3), F]);

  });
});

describe('a date the founder states reaches the responsibility', () => {
  it('carries through the report and onto the row', async () => {
    const due = inDays(5);
    const out = await reportCompanyObligation({
      productId: P, founderId: F, obligationKind: 'delivery',
      what: 'Renew the insurance', dueAt: due,
    });
    expect(out?.responsibility, 'the report did not become a responsibility').toBeTruthy();
    const row = (await query(
      `SELECT due_at, due_stated_by FROM institutional_responsibilities WHERE id = ?`,
      [out!.responsibility!.id])).rows[0] as Record<string, unknown>;
    expect(row.due_at).not.toBeNull();
    expect(row.due_stated_by, 'the founder said it, and the row records that').toBe(F);
  });

  it('records nothing when the company stated nothing', async () => {
    const out = await reportCompanyObligation({
      productId: P, founderId: F, obligationKind: 'maintenance',
      what: 'Keep the boiler serviced',
    });
    const row = (await query(
      `SELECT due_at, due_stated_by FROM institutional_responsibilities WHERE id = ?`,
      [out!.responsibility!.id])).rows[0] as Record<string, unknown>;
    expect(row.due_at, 'a missing date must stay missing, not become today').toBeNull();
    expect(row.due_stated_by).toBeNull();
  });
});

describe('a date that has passed is what needs the founder', () => {
  async function withDue(id: string, dueAt: string | null): Promise<void> {
    await query(
      `INSERT INTO institutional_responsibilities
         (id, product_id, title, capability, state, due_at, due_stated_by)
       VALUES (?, ?, ?, 'outreach', 'visible', ?, ?)`,
      [id, P, `Thing ${id}`, dueAt, dueAt === null ? null : F]);
  }

  it('reports overdue, and says when it was due', async () => {
    await withDue('tt_late', inDays(2));
    // The company said two days out; move the clock past it by editing the
    // stated date directly, which is what the passage of time looks like.
    await query(
      `UPDATE institutional_responsibilities SET due_at = ? WHERE id = 'tt_late'`,
      [inDays(-1)]);

    const summary = await getSevenDayResponsibilitySummary(P);
    const item = summary.NEEDS_YOU.find((i) => i.responsibilityId === 'tt_late');
    expect(item, 'a passed deadline did not reach the founder').toBeTruthy();
    expect(item!.needsYouBecause).toBe('overdue');
    expect(item!.dueAt, 'an interruption must carry its deadline').toBeTruthy();
  });

  it('does not report overdue before the date', async () => {
    await withDue('tt_soon', inDays(2));
    const summary = await getSevenDayResponsibilitySummary(P);
    const found = summary.NEEDS_YOU.find((i) => i.responsibilityId === 'tt_soon');
    expect(found?.needsYouBecause, 'a future date is not a late one').not.toBe('overdue');
  });

  it('does not report overdue for something deliberately not done', async () => {
    // The founder decided against it. That is a finished decision, not a late
    // obligation, and re-raising it would spend attention to say nothing.
    await withDue('tt_declined', inDays(1));
    await query(
      `UPDATE institutional_responsibilities SET due_at = ? WHERE id = 'tt_declined'`,
      [inDays(-2)]);
    // The disposition needs real same-product evidence; migration 104 refuses
    // a reference that does not resolve, which is the point of it.
    await query(
      `INSERT INTO signal_events (id, product_id, source, event_type, severity, payload_json, summary)
       VALUES ('tt_sig', ?, 'external_observation', 'company_observation', 'medium', '{}', 'declined')`,
      [P]);
    await query(
      `INSERT INTO responsibility_dispositions
         (id, responsibility_id, product_id, disposition, reason, owner_id, evidence_ref)
       VALUES ('tt_disp', 'tt_declined', ?, 'deliberately_not_done', 'Not this year', ?, 'signal_event:tt_sig')`,
      [P, F]);
    await query(
      `UPDATE institutional_responsibilities
          SET disposition='deliberately_not_done', disposition_reason='Not this year'
        WHERE id='tt_declined'`);

    const summary = await getSevenDayResponsibilitySummary(P);
    const found = summary.NEEDS_YOU.find((i) => i.responsibilityId === 'tt_declined');
    expect(found?.needsYouBecause).not.toBe('overdue');
  });

  it('ranks overdue above the reasons that describe Foundry rather than the company', async () => {
    // A withdrawn permission, an unresolved outcome and a shadowing watch are
    // all descriptions of where Foundry has got to. Being late is a fact about
    // the company, which is what the founder is trying to find out.
    const src = await import('node:fs').then((fs) =>
      fs.readFileSync('src/services/institution/absence-summary.ts', 'utf8'));
    const order = src.slice(src.indexOf('const needsYouBecause'));
    const clause = order.slice(0, order.indexOf(';'));
    expect(clause.indexOf('overdue')).toBeLessThan(clause.indexOf('permission_withdrawn'));
    expect(clause.indexOf('overdue')).toBeLessThan(clause.indexOf('outcome_unresolved'));
  });
});

describe('the judgment stops claiming an uncertainty it manufactured', () => {
  it('reads a stated deadline instead of reporting it unknown', async () => {
    // `Demand.deadline` was declared and never filled, so every judgment ever
    // raised listed `deadline unknown` for every responsibility in it — an
    // uncertainty that was structurally guaranteed rather than observed.
    const src = await import('node:fs').then((fs) =>
      fs.readFileSync('src/services/institution/institutional-judgment.ts', 'utf8'));
    expect(src, 'the judgment must read the date the company stated')
      .toContain('statedDue');
    expect(src, 'and still report the uncertainty when there genuinely is none')
      .toContain('deadline unknown for');
  });
});

// ── the sense has to be reachable by a person ──────────────────────────────

describe('a founder can actually state a date', () => {
  const letter = () => import('node:fs')
    .then((fs) => fs.readFileSync('src/routes/dashboard/letter.ts', 'utf8'));

  it('offers a date field on the form that reports an obligation', async () => {
    // The plumbing existed and nothing on screen could reach it. CODE EXISTS
    // is not PRODUCTION REACHABLE, and production reachable is not HUMAN
    // reachable — the law this repository keeps re-learning.
    const src = await letter();
    const form = src.slice(src.indexOf('const reportObligationSection'));
    const body = form.slice(0, form.indexOf('</div>`;'));
    expect(body).toContain("name=\"due_at\"");
    expect(body).toContain('type="date"');
    expect(body, 'the founder must be told a date is optional and what it buys')
      .toMatch(/optional|can't tell you when it's late/);
  });

  it('reads the day as end of day, so "by the 1st" is not late at 00:01', async () => {
    const src = await letter();
    expect(src).toContain('T23:59:59.000Z');
  });

  it('leaves the entry forms reachable but out of the attention stream', async () => {
    // They were the only two sections on the page with no empty-state guard,
    // so a quiet day still produced two blank forms competing with real work.
    // Hiding them would have been the opposite defect: they are the founder's
    // way IN.
    const src = await letter();
    const page = src.slice(src.indexOf('${uncarriedNoticeSection'));
    const disclosure = page.slice(0, page.indexOf('</details>'));
    expect(disclosure).toContain('<details');
    expect(disclosure).toContain('reportObligationSection(obligationOptions)');
    expect(disclosure).toContain('observationChannelSection(observationChannels)');
  });
});
