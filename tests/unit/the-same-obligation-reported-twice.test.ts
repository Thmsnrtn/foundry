process.env.TURSO_DATABASE_URL = 'file::memory:';

import { beforeAll, describe, expect, it } from 'vitest';
import { runMigrations } from '../../src/db/migrate.js';
import { query } from '../../src/db/client.js';
import { reportCompanyObligation } from '../../src/services/founder/company-report.js';

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
});
