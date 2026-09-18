process.env.TURSO_DATABASE_URL = 'file::memory:';
process.env.ENCRYPTION_KEY = '7'.repeat(64);
process.env.FOUNDRY_INSTANCE_POSTURE = 'private_owner';
process.env.FOUNDRY_OWNER_EMAIL = 'owner@example.com';
process.env.APP_URL = 'http://localhost:8080';

import { Hono } from 'hono';
import { beforeAll, describe, expect, it } from 'vitest';
import { runMigrations } from '../../src/db/migrate.js';
import { query } from '../../src/db/client.js';
import { recordMaterial } from '../../src/services/venture/hand.js';

// =============================================================================
// THE CHARTER IS THE ONE THING WHEN THE REST IS READY.
//
// An unsigned charter produced no attention anywhere: Home ranked a pending
// development-authority row above the one signature that starts money moving,
// and the charter itself sat in the middle of Controls. Now, when a real test
// is ready and a Workshop exists to speak as, and no charter stands, Home says
// so as its one thing and the button opens the charter's own place. Without a
// Workshop nothing is said, because the signature would be refused. Signed,
// the card is gone and the Autonomy tile says Chartered.
// =============================================================================

const OWNER = 'ot_owner'; const FOUNDRY = 'ot_foundry'; const WORKSHOP = 'ot_workshop'; const X = 'ot_x';
let app: Hono;
const page = async (path: string) => { const r = await app.request(path); return { status: r.status, text: await r.text() }; };
const oneThing = (t: string): string => t.includes('id="the-one-thing"') ? t.slice(t.indexOf('id="the-one-thing"'), t.indexOf('</section>', t.indexOf('id="the-one-thing"'))) : '';

beforeAll(async () => {
  await runMigrations();
  await query('INSERT INTO founders (id,clerk_user_id,email,name) VALUES (?,?,?,?)', [OWNER, 'clerk_ot', 'owner@example.com', 'Owner']);
  await query(`INSERT INTO products (id,name,owner_id,status,operating_budget_monthly_usd) VALUES (?,'Foundry',?,'active',50)`, [FOUNDRY, OWNER]);
  await query(`INSERT INTO system_identities (identity_key,product_id,established_reason) VALUES ('foundry',?,'test')`, [FOUNDRY]);
  const { openMandate } = await import('../../src/services/venture/mandate.js');
  const m = await openMandate({ founderId: OWNER, statement: 'Small things for shops', shape: null, evidenceMode: 'real' });
  if ('refused' in m) throw new Error(m.refused);
  await query(
    `INSERT INTO venture_opportunities (id, mandate_id, founder_id, headline, who_has_it, the_problem, why_it_might, kill_thesis, sources_json, evidence_mode)
     VALUES ('ot_opp',?,?,'a brief worth paying for','shops','scattered notices','somebody pays','nobody pays','[]','real')`, [m.id, OWNER]);
  await query(`INSERT INTO market_unknowns (id, founder_id, opportunity_id, question, blocking, cheapest_test) VALUES ('ot_unk',?,'ot_opp','will anyone pay',1,'write once')`, [OWNER]);
  await query(
    `INSERT INTO venture_experiments (id, founder_id, opportunity_id, unknown_id, what_we_do, what_we_expect, would_disprove, cost_cents, evidence_mode)
     VALUES (?,?,'ot_opp','ot_unk','sell a brief','someone pays','nobody pays',2000,'real')`, [X, OWNER]);
  await recordMaterial({ founderId: OWNER, experimentId: X, kind: 'deliverable', title: 'The brief', body: '# The brief\n\nA row.', by: 'test' });
  const { letterRoutes } = await import('../../src/routes/dashboard/letter.js');
  app = new Hono();
  app.use('*', async (c, next) => { c.set('founder' as never, { id: OWNER, email: 'owner@example.com', name: 'Owner', preferences: {} } as never); c.set('csrfToken' as never, 't' as never); await next(); });
  app.route('/', letterRoutes);
});

describe('what Home puts first', () => {
  it('without a Workshop, no charter is asked for: the signature would be refused', async () => {
    const t = (await page('/foundry')).text;
    expect(t).not.toContain('Needs your operating charter');
    expect(oneThing(t)).not.toContain('/foundry/charter');
  });

  it('with a Workshop and a real test ready, the charter is the one thing, and its button opens the charter place', async () => {
    await query("INSERT INTO products (id, name, owner_id, status, reality) VALUES (?,'Apex Micro',?,'active','real')", [WORKSHOP, OWNER]);
    await query(
      `INSERT INTO public_workshop (founder_id, product_id, public_name, operator_name, origin, zone_name, contact_email, statement, about)
       VALUES (?,?,?,?,?,?,?,?,?)`, [OWNER, WORKSHOP, 'Apex Micro', 'Owner', 'https://apexmicro.example', 'apexmicro.example', 'hello@apexmicro.example', 'A small workshop.', '']);
    const t = (await page('/foundry')).text;
    const card = oneThing(t);
    expect(card).toContain('Foundry is ready to begin testing.');
    expect(card).toContain('Needs your operating charter.');
    expect(card).toContain('1 real test is ready');
    expect(card).toContain('<a class="btn go" href="/foundry/charter">Review charter</a>');
    expect(card).toContain('Apex Micro, never you');
    // A door, not a decision: nothing on the card posts anywhere.
    expect(card).not.toContain('<form');
    expect(t).toContain('One thing needs you.');
    // And the place it opens is the charter, unsigned, with the signature offered.
    const place = (await page('/foundry/charter')).text;
    expect(place).toContain('Unsigned');
    expect(place).toContain('Sign for 90 days');
  });

  it('signed, the card is gone and the tile says Chartered', async () => {
    const r = await app.request('/foundry/controls/charter', {
      method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: 'monthly_dollars=100&probes=3&thinking_dollars=3&statement=A+river+of+nickels%2C+none+needing+me.',
    });
    expect(r.headers.get('location')).toBe('/foundry/charter?charter=signed');
    const t = (await page('/foundry')).text;
    expect(t).not.toContain('Needs your operating charter');
    expect(t).toContain('Chartered');
    expect(t).toContain('$100 of $100 left');
    const place = (await page('/foundry/charter?charter=signed')).text;
    expect(place).toContain('<strong>Signed.</strong>');
    expect(place).toContain('The charter <span class="state watch">Active</span>');
  });
});
