// =============================================================================
// PRINTABLES ARE HIS TO ALLOW (PENDING 41, decided 8 October 2026).
//
//   the owner said "ship on panel yes now" → nothing turns the kind on but HIS
//   own `make_printable_pdf` row → Control carries the one button that writes
//   it, from his session → the row is his (`ownersOwn`, set_by founder:) →
//   the decision reads done → he can take it back, and every earlier row stays
//   → nothing that is not a person can write it → and the panel's gate is
//   untouched by his yes: a split verdict is still held for him.
//
// The decision is NOT forged here: no migration and no seed writes his row.
// The button exists and works; pressing it is his.
// =============================================================================
process.env.TURSO_DATABASE_URL = 'file::memory:';
process.env.ENCRYPTION_KEY = 'p'.repeat(64);
process.env.FOUNDRY_INSTANCE_POSTURE = 'private_owner';
process.env.FOUNDRY_OWNER_EMAIL = 'print@example.com';

import { readdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import { Hono } from 'hono';
import { runMigrations } from '../../src/db/migrate.js';
import { query } from '../../src/db/client.js';
import { originationPolicyFor, supersedeOriginationPolicy } from '../../src/services/venture/legal-surface.js';
import { yourDecisions } from '../../src/services/control/decisions.js';
import { PANEL, PRINTABLE_POLICY, mayMakePrintables, panelVerdict, useRenderer } from '../../src/services/venture/products/printable.js';

const OWNER = 'print_owner';
let app: Hono;
const tap = (allow: 'yes' | 'no') => app.request('https://f.test/foundry/controls/printables', {
  method: 'POST', body: new URLSearchParams({ allow }), headers: { 'content-type': 'application/x-www-form-urlencoded' } });
const row = async () => (await originationPolicyFor(OWNER)).find((p) => p.requirement === PRINTABLE_POLICY)!;
const decision = async () => (await yourDecisions(OWNER, {})).find((x) => x.key === 'printables')!;
const controls = async () => {
  const html = await (await app.request('https://f.test/foundry/controls')).text();
  return /<section class="card your-decisions"[\s\S]*?<\/section>/.exec(html)?.[0] ?? '';
};

beforeAll(async () => {
  await runMigrations();
  await query('INSERT INTO founders (id,clerk_user_id,email,name) VALUES (?,?,?,?)', [OWNER, 'print_clk', 'print@example.com', 'Owner']);
  // A renderer stands in for Chromium, so "may" is decided by his row alone.
  useRenderer(async () => ({ pdf: Buffer.from('%PDF-'), sections: 5, overflow: [] }));
  const { letterRoutes } = await import('../../src/routes/dashboard/letter.js');
  app = new Hono();
  app.use('*', async (c, next) => { c.set('founder' as never, { id: OWNER, email: 'print@example.com', name: 'Owner' } as never); c.set('csrfToken' as never, 't' as never); await next(); });
  app.route('/', letterRoutes);
});

describe('until he presses it, the kind stays off', () => {
  it('starts at the institution\'s "not yet", and nothing in the migrations writes his yes', async () => {
    expect((await row()).value).toBe('not_yet');
    expect((await row()).ownersOwn).toBe(false);
    expect((await mayMakePrintables(OWNER)).may).toBe(false);
    expect((await decision()).state).toBe('open');
    const dir = resolve(import.meta.dirname, '../../src/db/migrations');
    for (const f of readdirSync(dir)) {
      const sql = readFileSync(resolve(dir, f), 'utf8');
      if (!sql.includes(PRINTABLE_POLICY)) continue;
      expect(sql, f).not.toMatch(/'make_printable_pdf',\s*'policy',\s*'yes'/);
    }
  });

  it('Control carries the button that would turn it on', async () => {
    const sheet = await controls();
    expect(sheet).toContain('action="/foundry/controls/printables"');
    expect(sheet).toMatch(/<input type="hidden" name="allow" value="yes" \/>\s*<button class="btn go" type="submit">Allow printables, shipped on a clear panel yes<\/button>/);
  });
});

describe('his press, from his session', () => {
  it('writes his own row, and the kind is on', async () => {
    const r = await tap('yes');
    expect(r.status).toBe(302);
    expect(r.headers.get('location')).toMatch(/printables=allowed/);
    const mine = await row();
    expect(mine.ownersOwn).toBe(true);
    expect(mine.value).toBe('yes');
    expect(mine.setBy).toBe(`founder:${OWNER}`);
    expect(mine.why).toMatch(/PENDING 41/);
    expect((await mayMakePrintables(OWNER)).may).toBe(true);
    expect((await decision()).state).toBe('done');
    expect(await controls()).toContain('Stop making printables');
  });

  it('can be taken back, and every earlier row stays on record', async () => {
    const r = await tap('no');
    expect(r.headers.get('location')).toMatch(/printables=refused_again/);
    expect((await row()).value).toBe('not_yet');
    expect((await mayMakePrintables(OWNER)).may).toBe(false);
    const all = (await query(`SELECT value, superseded_by FROM origination_policy
      WHERE requirement = ? ORDER BY set_at, rowid`, [PRINTABLE_POLICY])).rows as unknown as Array<Record<string, unknown>>;
    expect(all.map((x) => x.value)).toEqual(['not_yet', 'yes', 'not_yet']);
    expect(all[1]!.superseded_by).toBe(`founder:${OWNER}`);
  });

  it('cannot be written by anything that is not a person', async () => {
    const r = await supersedeOriginationPolicy({ founderId: OWNER, requirement: PRINTABLE_POLICY, treatment: 'policy', value: 'yes', why: 'the forge decided', by: 'institution:forge' });
    expect('refused' in r && r.refused).toMatch(/founder_row_is_the_owners|supersession_needs_a_person/);
    expect((await mayMakePrintables(OWNER)).may).toBe(false);
  });
});

describe('his yes changes who decides a clear verdict, never the gate', () => {
  it('a clear yes ships, a split is held for him, a clear no is refused', () => {
    const at = (v: Array<'yes' | 'maybe' | 'no'>, price = 10) => panelVerdict(v.map((verdict, i) => ({ persona: `p${String(i)}`, verdict, maxPriceDollars: 12, why: '' })), price).outcome;
    expect(PANEL).toEqual({ minimum: 3, shipAt: 0.6, refuseBelow: 0.3 });
    expect(at(['yes', 'yes', 'yes', 'maybe'])).toBe('ship');
    expect(at(['maybe', 'maybe', 'maybe', 'maybe'])).toBe('hold');
    expect(at(['no', 'no', 'no', 'maybe'])).toBe('refuse');
  });
});
