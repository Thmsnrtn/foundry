process.env.TURSO_DATABASE_URL = 'file::memory:';
process.env.ENCRYPTION_KEY = '0'.repeat(64);
process.env.FOUNDRY_INSTANCE_POSTURE = 'private_owner';
process.env.FOUNDRY_OWNER_EMAIL = 'owner@example.com';

import { beforeAll, describe, expect, it } from 'vitest';
import { Hono } from 'hono';
import { runMigrations } from '../../src/db/migrate.js';
import { query } from '../../src/db/client.js';
import { whatTheNumbersSay } from '../../src/services/founder/what-the-numbers-say.js';
import { establishReferenceCompany } from '../../src/services/reference/world.js';

// =============================================================================
// WHAT THE NUMBERS SAY, AND WHAT THE PAGE SAYS ABOUT THEM.
//
// The owner asked to see metrics per company. The failure modes of that request
// are specific and this file is about them: showing a number without saying
// which way it is going (useless), showing $0.00 for a company nothing reports
// on (false, in the most confident possible format), and — once a reference
// world exists — showing invented numbers on a page that does not say they are
// invented, which would be the most misleading screen in the product.
// =============================================================================

const OWNER = 'wn_owner';
const EMPTY = 'wn_empty';
const REPORTING = 'wn_reporting';
let referenceId = '';

beforeAll(async () => {
  await runMigrations();
  await query('INSERT INTO founders (id,clerk_user_id,email,name) VALUES (?,?,?,?)',
    [OWNER, 'clerk_wn', 'owner@example.com', 'Owner']);
  for (const [id, name] of [[EMPTY, 'Quiet Co'], [REPORTING, 'Reporting Co']] as const) {
    await query("INSERT INTO products (id,name,owner_id,status) VALUES (?,?,?,'active')",
      [id, name, OWNER]);
  }
  // A month ago, and today. Revenue down, support up.
  await query(
    `INSERT INTO metric_snapshots
       (id, product_id, snapshot_date, mrr_cents, new_mrr_cents, support_volume_7d, churn_rate)
     VALUES ('wn_then',?,date('now','-31 day'), 5000000, 400000, 20, 0.02)`, [REPORTING]);
  await query(
    `INSERT INTO metric_snapshots
       (id, product_id, snapshot_date, mrr_cents, new_mrr_cents, support_volume_7d, churn_rate)
     VALUES ('wn_now',?,date('now'), 4600000, 300000, 30, 0.02)`, [REPORTING]);

  const ref = await establishReferenceCompany({
    scenarioKey: 'revenue_quietly_falling', ownerId: OWNER,
  });
  if (!ref) throw new Error('no reference company');
  referenceId = ref.productId;
});

describe('a number an owner can act on', () => {
  it('says where it is and which way it is going, in words', async () => {
    const read = await whatTheNumbersSay(REPORTING);
    expect(read.absence).toBeNull();
    const byLabel = new Map(read.numbers.map((n) => [n.label, n]));

    const revenue = byLabel.get('monthly revenue');
    expect(revenue?.now).toBe('$46.0k');
    expect(revenue?.direction).toBe('fell');
    expect(revenue?.sentence).toContain('down');

    // 400000 → 300000 is a quarter gone. The phrasing rounds, because two
    // readings do not support a decimal place of confidence.
    expect(byLabel.get('new revenue')?.sentence).toMatch(/down about 25% on a month ago/);

    // Rising support is a rise, not a fall dressed up as one.
    expect(byLabel.get('how much support comes in')?.direction).toBe('rose');
  });

  it('calls a flat line flat rather than inventing movement', async () => {
    const read = await whatTheNumbersSay(REPORTING);
    const churn = read.numbers.find((n) => n.label.includes('leave'));
    expect(churn?.direction).toBe('held');
    expect(churn?.sentence).toContain('about the same');
  });

  it('says nothing rather than zero when it can see nothing', async () => {
    // THE FAILURE THIS EXISTS TO PREVENT. A grid of $0.00 is a claim, and it is
    // false: Foundry does not know this company earns nothing, it knows nobody
    // has told it anything.
    const read = await whatTheNumbersSay(EMPTY);
    expect(read.numbers).toEqual([]);
    expect(read.asOf).toBeNull();
    expect(read.absence).toContain('cannot see any numbers');
    expect(JSON.stringify(read)).not.toContain('0.00');
  });

  it('reads a reference company with no special case at all', async () => {
    // The arithmetic is the same arithmetic. That is the point of a reference
    // world: the surface is not rehearsing a different surface.
    const read = await whatTheNumbersSay(referenceId);
    expect(read.absence).toBeNull();
    expect(read.numbers.length).toBeGreaterThan(3);
    expect(read.numbers.every((n) => n.sentence.length > 0)).toBe(true);
  });
});

describe('the page the owner opens', () => {
  const asOwner = async (path: string): Promise<{ status: number; body: string }> => {
    const { foundryShellRoutes } = await import('../../src/routes/dashboard/foundry-shell.js');
    const app = new Hono();
    app.use('*', async (c, next) => {
      c.set('founder' as never,
        { id: OWNER, email: 'owner@example.com', name: 'Owner' } as never);
      c.set('csrfToken' as never, 'test' as never);
      await next();
    });
    app.route('/', foundryShellRoutes as never);
    const res = await app.request(path);
    return { status: res.status, body: await res.text() };
  };

  it('never shows an invented company under "your companies"', async () => {
    const { status, body } = await asOwner('/foundry/companies');
    expect(status).toBe(200);
    const heading = body.indexOf('Companies I made up');
    expect(heading).toBeGreaterThan(-1);
    // The reference company's link exists, and only below that heading.
    const link = body.indexOf(`/foundry/companies/${referenceId}`);
    expect(link).toBeGreaterThan(heading);
    // And the real ones are above it.
    expect(body.indexOf(`/foundry/companies/${REPORTING}`)).toBeLessThan(heading);
  });

  it('says a company is invented before it shows a single number', async () => {
    const { status, body } = await asOwner(`/foundry/companies/${referenceId}`);
    expect(status).toBe(200);
    const disclosure = body.indexOf('This company does not exist');
    expect(disclosure).toBeGreaterThan(-1);
    expect(disclosure).toBeLessThan(body.indexOf('Where the numbers are'));
    expect(body).toContain('can never become a fact I tell you about a real company');
  });

  it('does not put that banner on a real company', async () => {
    const { body } = await asOwner(`/foundry/companies/${REPORTING}`);
    expect(body).not.toContain('This company does not exist');
    expect(body).toContain('Where the numbers are');
    expect(body).toContain('$46.0k');
  });

  it('says out loud that it cannot see a quiet company', async () => {
    const { body } = await asOwner(`/foundry/companies/${EMPTY}`);
    expect(body).toContain('cannot see any numbers');
  });
});
