process.env.TURSO_DATABASE_URL = 'file::memory:';

import { beforeAll, describe, expect, it } from 'vitest';
import { runMigrations } from '../../src/db/migrate.js';
import { query } from '../../src/db/client.js';
import { reportCompanyObligation } from '../../src/services/founder/company-report.js';
import { setResponsibilityDisposition } from '../../src/services/institution/responsibility.js';
import { reportExternalObligation } from '../../src/services/founder/company-report.js';

// =============================================================================
// A COMPANY THAT SAYS THE SAME THING TWICE DOES NOT OWE IT TWICE.
//
// A founder reports an obligation, does not see it land the way they expected,
// and reports it again. Or a co-founder reports what the founder already did.
// Each report was its own signal, so discovery made its own responsibility for
// each, and the company now owes the same thing twice.
//
// It is not cosmetic. Every downstream reading of a responsibility counts it
// once: the seven-day view lists it twice, resource demand is summed twice into
// a capacity judgment, permission has to be granted twice, and the founder is
// asked to understand the same work twice before either copy can move.
//
// The second REPORT is still real evidence and is kept — a company saying a
// thing again is something that happened. What converges is the obligation.
// =============================================================================

const P = 'dup_product';
const OWNER = 'dup_owner';

beforeAll(async () => {
  await runMigrations();
  await query(`INSERT INTO founders (id,clerk_user_id,email) VALUES (?,'dup_c','o@example.com')`, [OWNER]);
  await query(`INSERT INTO products (id,name,owner_id) VALUES (?,'Fold Street Dance',?)`, [P, OWNER]);
});

describe('the same obligation reported twice', () => {
  it('is one responsibility, and both reports are kept as evidence', async () => {
    const first = await reportCompanyObligation({
      productId: P, founderId: OWNER, obligationKind: 'revenue_collection',
      what: 'Collect the payments customers still owe',
    });
    const second = await reportCompanyObligation({
      productId: P, founderId: OWNER, obligationKind: 'revenue_collection',
      what: 'Collect the payments customers still owe',
    });

    expect(first?.responsibility).not.toBeNull();
    expect(second?.responsibility).not.toBeNull();
    expect(second!.responsibility!.id).toBe(first!.responsibility!.id);

    expect((await query(
      'SELECT COUNT(*) n FROM institutional_responsibilities WHERE product_id=?', [P])).rows[0])
      .toMatchObject({ n: 1 });

    // The company said it twice. That is a fact, and it stays a fact.
    expect((await query(
      `SELECT COUNT(*) n FROM signal_events WHERE product_id=? AND source='founder_report'`, [P])).rows[0])
      .toMatchObject({ n: 2 });
  });

  it('still tells two genuinely different obligations apart', async () => {
    const other = await reportCompanyObligation({
      productId: P, founderId: OWNER, obligationKind: 'revenue_collection',
      what: 'Chase the deposit for the summer showcase',
    });
    expect(other?.responsibility).not.toBeNull();
    expect((await query(
      'SELECT COUNT(*) n FROM institutional_responsibilities WHERE product_id=?', [P])).rows[0])
      .toMatchObject({ n: 2 });
  });

  it('does not converge the same words onto a different stated deadline', async () => {
    // A deadline is part of what is owed. Converging these would discard a date
    // the company just stated, and no path here may do that — the institution
    // is forbidden from stating a deadline itself, so it cannot replace one.
    const tomorrow = new Date(Date.now() + 86_400_000).toISOString();
    const nextWeek = new Date(Date.now() + 7 * 86_400_000).toISOString();
    const a = await reportCompanyObligation({
      productId: P, founderId: OWNER, obligationKind: 'customer_commitment',
      what: 'Confirm the Saturday cover', dueAt: tomorrow,
    });
    const b = await reportCompanyObligation({
      productId: P, founderId: OWNER, obligationKind: 'customer_commitment',
      what: 'Confirm the Saturday cover', dueAt: nextWeek,
    });
    expect(a?.responsibility?.id).not.toBe(b?.responsibility?.id);

    // And the same words with the same date still converge.
    const again = await reportCompanyObligation({
      productId: P, founderId: OWNER, obligationKind: 'customer_commitment',
      what: 'Confirm the Saturday cover', dueAt: tomorrow,
    });
    expect(again?.responsibility?.id).toBe(a?.responsibility?.id);
  });

  it('treats a report after a deliberate no as the company changing its mind', async () => {
    const first = await reportCompanyObligation({
      productId: P, founderId: OWNER, obligationKind: 'maintenance',
      what: 'Service the studio floor before term starts',
    });
    const id = first!.responsibility!.id;
    await setResponsibilityDisposition({
      productId: P, responsibilityId: id, ownerId: OWNER,
      disposition: 'deliberately_not_done', reason: 'No budget this term',
      evidenceRef: `signal_event:${first!.signalId}`,
    });

    // Reporting it again is not a duplicate. Absorbing it into the decision not
    // to do it would answer the founder with their own earlier no.
    const second = await reportCompanyObligation({
      productId: P, founderId: OWNER, obligationKind: 'maintenance',
      what: 'Service the studio floor before term starts',
    });
    expect(second?.responsibility).not.toBeNull();
    expect(second!.responsibility!.id).not.toBe(id);
  });

  it('converges a tool onto a tool, and does not merge a tool onto a founder', async () => {
    // Same source converges. A rota system that reports twice has reported one
    // thing twice.
    const a = await reportExternalObligation({
      productId: P, reportedBy: 'rota_job', obligationKind: 'recurring_work',
      what: 'Every timetabled class has a teacher',
    });
    const b = await reportExternalObligation({
      productId: P, reportedBy: 'rota_job', obligationKind: 'recurring_work',
      what: 'Every timetabled class has a teacher',
    });
    expect(b?.responsibility?.id).toBe(a?.responsibility?.id);

    // Across sources it does not, deliberately: merging is a decision about
    // what provenance a responsibility carries when two independent witnesses
    // agree, and discovery.ts records why it is not taken there.
    const founder = await reportCompanyObligation({
      productId: P, founderId: OWNER, obligationKind: 'recurring_work',
      what: 'Every timetabled class has a teacher',
    });
    expect(founder?.responsibility?.id).not.toBe(a?.responsibility?.id);
  });
});
