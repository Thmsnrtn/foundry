// =============================================================================
// A FORM IS KNOWN ONLY AS FAR AS IT IS SOURCED.
//
// Integrated plan §6 asks for "an economic-forms library as decision
// knowledge": the customers and jobs a form serves, its pricing and payment
// patterns, rights, channels and provider eligibility, service burden, failure
// and exit, "what is observed versus assumed; and which current capability can
// serve it". The owner prompted it with a vendor's list of digital products
// whose figures are its own and evidence of nothing.
//
// So the library is held to four rules, and this file is where they live:
//   · every fact names a source it can be checked against, the day it was
//     read, and a grade — and a vendor's promotion (grade D) is refused;
//   · every aspect of every form is either known or SAID to be unknown, never
//     silently absent and never filled in by assumption;
//   · no fact about buyers claims demand: that is what tests are for;
//   · what can serve a form is read from live state at the moment of asking,
//     never stored as a claim — and knowing about a form causes nothing.
// =============================================================================
process.env.TURSO_DATABASE_URL = 'file::memory:';
process.env.ENCRYPTION_KEY = '3'.repeat(64);

import { beforeAll, describe, expect, it } from 'vitest';
import { runMigrations } from '../../src/db/migrate.js';
import { query } from '../../src/db/client.js';
import { ECONOMIC_FORMS } from '../../src/services/venture/economic-forms.js';
import { ASPECTS, FORM_KNOWLEDGE, whatAFormTakes } from '../../src/services/venture/form-knowledge.js';

const OWNER = 'fk_owner';

beforeAll(async () => {
  await runMigrations();
  await query('INSERT INTO founders (id,clerk_user_id,email,name) VALUES (?,?,?,?)', [OWNER, 'clerk_fk', 'fk@example.com', 'Owner']);
  await query(`INSERT INTO products (id, name, owner_id, status, reality) VALUES ('fk_co','Apex Micro',?,'active','real')`, [OWNER]);
});

describe('every fact can be checked', () => {
  const all = Object.entries(FORM_KNOWLEDGE).flatMap(([form, facts]) => (facts ?? []).map((f) => ({ form, ...f })));

  it('has facts at all, and only for forms that exist', () => {
    expect(all.length).toBeGreaterThan(0);
    const keys = new Set(ECONOMIC_FORMS.map((f) => f.key));
    for (const form of Object.keys(FORM_KNOWLEDGE)) expect(keys.has(form), form).toBe(true);
  });

  it('names an https source, the day it was read, and a grade — and never a vendor\'s promotion', () => {
    for (const f of all) {
      expect(f.source.url, `${f.form}: ${f.claim}`).toMatch(/^https:\/\//);
      expect(f.source.title.trim().length).toBeGreaterThan(0);
      expect(f.read, `${f.form}: ${f.claim}`).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(['A', 'B', 'C']).toContain(f.grade);
      expect(ASPECTS).toContain(f.aspect);
    }
  });

  it('claims no demand about buyers: that is what a test is for', () => {
    const demand = /\bsells?\b|\bselling\b|best.?sell|passive income|\$\s?\d[\d,.]*\s*(\/|a |per )?(month|mo|year|week)|in demand|people buy|will buy/i;
    for (const f of all) expect(f.claim, `${f.form}: ${f.claim}`).not.toMatch(demand);
  });
});

describe('what is not known is said to be unknown', () => {
  it('accounts for every aspect of every form, known or unknown, and nothing twice', async () => {
    for (const form of ECONOMIC_FORMS) {
      const t = await whatAFormTakes(form.key, OWNER);
      const known = new Set(t.known.map((k) => k.aspect));
      const unknown = new Set(t.unknown);
      for (const a of ASPECTS) expect(known.has(a) !== unknown.has(a), `${form.key}: ${a}`).toBe(true);
    }
  });

  it('knows a workbook on Etsy by Etsy\'s own rules, and names what it does not know', async () => {
    const t = await whatAFormTakes('guide', OWNER);
    const said = t.known.map((k) => k.claim).join('\n');
    expect(said).toMatch(/6\.5%/);
    expect(said).toMatch(/AI/);
    expect(t.known.every((k) => k.grade === 'A')).toBe(true);
    expect(t.unknown).toContain('buyers');
  });
});

describe('what can serve a form is read now, not stored', () => {
  it('says no Etsy shop is connected, when none is', async () => {
    expect((await whatAFormTakes('guide', OWNER)).canServe).toMatch(/no Etsy shop is connected/i);
  });

  it('names the shop, read-only, once one is connected and confirmed', async () => {
    await query(`INSERT INTO company_senses (id, product_id, sense_key, provider, mode, disclosure, provider_account_label, identity_confirmed_at, identity_confirmed_by)
      VALUES ('fk_cs','fk_co','revenue','etsy','real','read only','ApexMicro',datetime('now'),?)`, [`founder:${OWNER}`]);
    const s = (await whatAFormTakes('guide', OWNER)).canServe;
    expect(s).toMatch(/ApexMicro/);
    expect(s).toMatch(/read-only/);
  });

  it('names the payment a form would need when Foundry cannot take it', async () => {
    const r = (await query(`SELECT available FROM probe_exchanges WHERE exchange = 'subscription'`)).rows[0] as Record<string, unknown> | undefined;
    const s = (await whatAFormTakes('saas', OWNER)).canServe;
    if (r && Number(r.available) === 1) expect(s).not.toMatch(/cannot take/);
    else expect(s).toMatch(/cannot take .*subscription/);
  });

  it('causes nothing: asking about every form adds no candidate and no row', async () => {
    const count = async () => Number(((await query('SELECT COUNT(*) AS n FROM venture_opportunities')).rows[0] as Record<string, unknown>).n);
    const before = await count();
    for (const f of ECONOMIC_FORMS) await whatAFormTakes(f.key, OWNER);
    expect(await count()).toBe(before);
  });
});
