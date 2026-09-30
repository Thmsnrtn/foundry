process.env.TURSO_DATABASE_URL = 'file::memory:';
process.env.ENCRYPTION_KEY = '8'.repeat(64);
process.env.FOUNDRY_INSTANCE_POSTURE = 'private_owner';
process.env.FOUNDRY_OWNER_EMAIL = 'owner@example.com';

import { readFileSync } from 'node:fs';
import { Hono } from 'hono';
import { beforeAll, describe, expect, it } from 'vitest';
import { runMigrations } from '../../src/db/migrate.js';
import { query } from '../../src/db/client.js';
import { boundaryStandingInTheWay, liftBoundary, setBoundary } from '../../src/services/institution/standing-intent.js';
import { authorityTable, effectiveAuthority, type AuthorityDomain } from '../../src/services/control/authority.js';

// =============================================================================
// EFFECTIVE AUTHORITY AGREES WITH THE DOORS (Institution V6c, 30 September
// 2026; INSTITUTION_MODEL §6.1, §12 "no external act without effective
// permission").
//
// One reading says, per area, whether Foundry may act, why, and how to change
// it. It explains; the doors enforce. So on the same rows it must give the
// doors' answer: every case below is set up afresh, read by the reader, and
// then put to the door itself — a refusal at the door is "Not allowed" or
// "Asks you first" in the reader, and nothing else is. The reader consumes
// nothing: the door spends a one-time approval when it lets something through,
// and a reading that did would change what it describes.
// =============================================================================

const OWNER = 'f_auth';
let app: Hono;
let n = 0;

beforeAll(async () => {
  await runMigrations();
  await query('INSERT INTO founders (id,clerk_user_id,email,name) VALUES (?,?,?,?)', [OWNER, 'clk_auth', 'owner@example.com', 'Owner']);
  const { letterRoutes } = await import('../../src/routes/dashboard/letter.js');
  app = new Hono();
  app.use('*', async (c, next) => { c.set('founder' as never, { id: OWNER, email: 'owner@example.com', name: 'Owner' } as never); c.set('csrfToken' as never, 't' as never); await next(); });
  app.route('/', letterRoutes);
});

async function aCompany(): Promise<string> {
  const id = `p_auth_${String(++n)}`;
  await query(`INSERT INTO products (id,name,owner_id,status,scp_status,reality) VALUES (?,?,?,'active','active','real')`, [id, `Co ${id}`, OWNER]);
  return id;
}

const DOOR: Record<'spending' | 'customer_contact', { door: 'spend' | 'outbound'; subject: string; tool?: string }> = {
  spending: { door: 'spend', subject: 'spend_money' },
  customer_contact: { door: 'outbound', subject: 'contact_people', tool: 'send_email' },
};

describe('the reader and the doors', () => {
  for (const domain of ['spending', 'customer_contact'] as const) {
    for (const mode of [null, 'never', 'ask_first'] as const) {
      for (const scope of ['company', 'everywhere'] as const) {
        it(`${domain}, ${mode ?? 'no rule'}, set ${scope}: the same answer`, async () => {
          const productId = await aCompany();
          const d = DOOR[domain];
          const id = mode ? await setBoundary({ productId: scope === 'company' ? productId : null, subject: d.subject, mode, statement: `${mode} ${d.subject}` }) : null;
          const reading = await effectiveAuthority(OWNER, { domain, productId });
          const approvalsBefore = (await query(`SELECT COUNT(*) AS n FROM proposed_acts WHERE consumed_at IS NOT NULL`)).rows[0];
          const refused = await boundaryStandingInTheWay({ productId, door: d.door, tool: d.tool });
          // THE OWNER'S RULE: the reader names one exactly when the door refuses on one.
          expect(reading.rule !== null, `${domain}/${String(mode)}/${scope}`).toBe(refused !== null);
          if (refused) expect(reading.rule!.statement).toBe(refused.statement);
          if (mode === 'never') expect(reading.verdict).toBe('prohibited');
          if (mode === 'ask_first') expect(reading.verdict).toBe('needs_approval');
          expect((await query(`SELECT COUNT(*) AS n FROM proposed_acts WHERE consumed_at IS NOT NULL`)).rows[0]).toEqual(approvalsBefore);
          if (id) await liftBoundary(id, 'test tidy');
        });
      }
    }
  }

  it('never reports a tool the door does not bind as refused by "contact anyone"', async () => {
    const productId = await aCompany();
    const id = await setBoundary({ productId, subject: 'contact_people', mode: 'never', statement: 'never contact anyone' });
    expect(await boundaryStandingInTheWay({ productId, door: 'outbound', tool: 'update_listing' })).toBeNull();
    expect((await effectiveAuthority(OWNER, { domain: 'customer_contact', productId })).verdict).toBe('prohibited');
    await liftBoundary(id, 'test tidy');
  });
});

describe('the areas no rule can open', () => {
  it('says trading does not exist, whatever is set', async () => {
    const r = await effectiveAuthority(OWNER, { domain: 'financial_assets' });
    expect(r.verdict).toBe('unavailable');
    expect(r.resolveBy).toEqual([]);
    expect((await query(`SELECT COUNT(*) AS n FROM sqlite_master WHERE type='table' AND name LIKE '%order%' AND name NOT LIKE 'venue_orders%'`)).rows[0]).toMatchObject({ n: 0 });
  });

  it('answers only about the owner\'s own companies', async () => {
    await query('INSERT INTO founders (id,clerk_user_id,email,name) VALUES (?,?,?,?)', ['f_auth_other', 'clk_auth_o', 'o@example.com', 'O']);
    await query(`INSERT INTO products (id,name,owner_id,status,scp_status,reality) VALUES ('p_auth_theirs','Theirs','f_auth_other','active','active','real')`);
    expect((await effectiveAuthority(OWNER, { domain: 'spending', productId: 'p_auth_theirs' })).verdict).toBe('unavailable');
  });

  it('is a reader: it writes nothing and never calls a door', () => {
    const src = readFileSync('src/services/control/authority.ts', 'utf8');
    expect(src).not.toMatch(/\b(?:INSERT INTO|UPDATE|DELETE FROM)\b/);
    expect(src).not.toMatch(/boundaryStandingInTheWay\(|spendApprovalFor\(/);
  });
});

describe('Control', () => {
  it('shows one row per area, with why and how to change it', async () => {
    const html = await (await app.request('/foundry/controls')).text();
    const card = /<section class="card may-do"[\s\S]*?<\/section>/.exec(html)?.[0] ?? '';
    for (const d of ['Research', 'Spending', 'Contacting people', 'Trading'] as const) expect(card).toContain(`<b>${d}</b>`);
    expect(card).toContain('Does not exist');
    expect((await authorityTable(OWNER)).map((a) => a.domain)).toEqual(['research', 'spending', 'customer_contact', 'financial_assets'] as AuthorityDomain[]);
  });
});
