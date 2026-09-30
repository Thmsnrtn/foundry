process.env.TURSO_DATABASE_URL = 'file::memory:';
process.env.ENCRYPTION_KEY = '8'.repeat(64);
process.env.FOUNDRY_INSTANCE_POSTURE = 'private_owner';
process.env.FOUNDRY_OWNER_EMAIL = 'owner@example.com';

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { Hono } from 'hono';
import { beforeAll, describe, expect, it } from 'vitest';
import { runMigrations } from '../../src/db/migrate.js';
import { query } from '../../src/db/client.js';
import { mandateOf, readMandate, stateMandate } from '../../src/services/mandate/statements.js';
import { compileIntent, touchesAuthority } from '../../src/services/intent/compile.js';
import { directReading } from '../../src/routes/dashboard/mandate-place.js';

// =============================================================================
// THE MANDATE IS WHAT THE OWNER WANTS (long-horizon directive, 30 September
// 2026; INSTITUTION_MODEL §3.2, §4, §7; scenario 610, "No SaaS for now").
//
// A sentence nothing else could place — "No SaaS for now", "Prioritize cash
// flow", "Spend less this month" — is read into one typed statement with its
// scope and how long it lasts, shown with what it replaces and what it leaves
// alone, and bound only when the reading confirmed is the reading shown. The
// card on Control writes the same rows. A change supersedes, never edits; it
// can be undone and taken back. And none of it can let Foundry do, spend or
// send anything more: no gate reads these rows.
// =============================================================================

const OWNER = 'f_mandate';
const OTHER = 'f_mandate_other';
const NOW = new Date('2026-09-30T12:00:00Z');
let app: Hono;

const form = (fields: Record<string, string>): RequestInit => ({
  method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams(fields).toString(),
});

beforeAll(async () => {
  await runMigrations();
  for (const [id, email] of [[OWNER, 'owner@example.com'], [OTHER, 'x@example.com']]) {
    await query('INSERT INTO founders (id,clerk_user_id,email,name) VALUES (?,?,?,?)', [id, `clk_${id}`, email, 'X']);
  }
  await query(`INSERT INTO products (id,name,owner_id,status,scp_status,reality) VALUES ('p_m','Lamplight',?,'active','active','real')`, [OWNER]);
  const { letterRoutes } = await import('../../src/routes/dashboard/letter.js');
  app = new Hono();
  app.use('*', async (c, next) => { c.set('founder' as never, { id: OWNER, email: 'owner@example.com', name: 'Owner' } as never); c.set('csrfToken' as never, 't' as never); await next(); });
  app.route('/', letterRoutes);
});

describe('the reader', () => {
  it('reads what the owner wants, with its scope and how long it lasts', () => {
    expect(readMandate('No SaaS for now', NOW)).toMatchObject({ dimension: 'avoid', subject: 'saas', label: 'SaaS', until: null, reviewAt: '2026-10-30', scope: { kind: 'portfolio' } });
    expect(readMandate('Spend less this month', NOW)).toMatchObject({ dimension: 'posture', subject: 'conserve', until: '2026-10-01', reviewAt: null });
    expect(readMandate('Spend less', NOW)).toMatchObject({ dimension: 'posture', until: null, reviewAt: '2026-10-30' });
    expect(readMandate('Keep trading theoretical', NOW)).toMatchObject({ dimension: 'posture', scope: { kind: 'domain', ref: 'trading' } });
    expect(readMandate('Prioritize cash flow', NOW)).toMatchObject({ dimension: 'optimize', subject: 'cash_flow' });
    expect(readMandate('Focus on digital downloads until November', NOW)).toMatchObject({ dimension: 'interest', subject: 'digital_downloads', until: '2026-11-01' });
    expect(readMandate('Avoid SaaS', NOW)).toMatchObject({ dimension: 'avoid', until: null, reviewAt: null });
  });

  it('refuses anything that is an act or a rule, and anything it would have to guess', () => {
    for (const s of ['Never use cold SMS', "Don't contact anyone", 'Spend up to $50 a month', 'No', 'No, I meant the other one',
      'Stop everything', 'Always ask me first', 'No it', 'Send the report', 'Focus on emailing every customer today']) {
      expect(readMandate(s, NOW), s).toBeNull();
    }
  });
});

describe('the compiler', () => {
  it('proposes it as steering, never authority, only when nothing else placed it', () => {
    const p = compileIntent('No SaaS for now', { searching: false, now: NOW });
    expect(p).toMatchObject({ kind: 'steer', destination: 'mandate', needsConfirm: true });
    expect(touchesAuthority(p)).toBe(false);
    // "Spend less this month" used to ask which company; said about none, it is the portfolio's.
    expect(compileIntent('Spend less this month', { searching: false, now: NOW }).destination).toBe('mandate');
    // Said on a company's page, it stays that company's work.
    expect(compileIntent('Spend less this month', { searching: false, now: NOW, scope: { kind: 'company', id: 'p_m', name: 'Lamplight' } }).destination).toBe('undertaking');
    // A rule is still a rule.
    expect(compileIntent('Never email anyone without asking me', { searching: false, now: NOW }).destination).not.toBe('mandate');
    // The same sentence on the same day compiles to the same hash; the reading is in it.
    expect(compileIntent('No SaaS for now', { searching: false, now: NOW }).hash).toBe(p.hash);
    expect(compileIntent('No SaaS for now', { searching: false, now: new Date('2026-10-05T12:00:00Z') }).hash).not.toBe(p.hash);
  });
});

describe('from a sentence to what is in force', () => {
  it('shows before, after and what is unchanged, then binds only the reading it showed', async () => {
    const shown = await (await app.request('/foundry/ask', form({ said: 'No SaaS for now' }))).text();
    expect(shown).toContain('Change what you want?');
    expect(shown).toContain('What Foundry may do, spend or send. This is steering, not permission.');
    const hash = /name="hash" value="([0-9a-f]+)"/.exec(shown)![1]!;

    // A tampered reading binds nothing and shows what the sentence reads as now.
    const forged = await app.request('/foundry/mandate/confirm', form({ said: 'No SaaS for now', hash: '0'.repeat(24) }));
    expect(forged.status).toBe(409);
    expect(await mandateOf(OWNER)).toHaveLength(0);
    // A sentence that is not a Mandate cannot be pushed through this door.
    const rule = await app.request('/foundry/mandate/confirm', form({ said: 'Never email anyone without asking me', hash }));
    expect(rule.status).toBe(302);
    expect(await mandateOf(OWNER)).toHaveLength(0);

    const r = await app.request('/foundry/mandate/confirm', form({ said: 'No SaaS for now', hash }));
    expect(r.status).toBe(302);
    const [s] = await mandateOf(OWNER);
    expect(s).toMatchObject({ dimension: 'avoid', subject: 'saas' });
    expect(s!.source).toMatch(/^intent:/);
    expect((await query(`SELECT outcome FROM owner_intents WHERE founder_id = ? AND said = 'No SaaS for now' ORDER BY shown_at DESC LIMIT 1`, [OWNER])).rows[0]).toMatchObject({ outcome: 'confirmed' });

    // A browser never sends the fragment; the page is asked for without it.
    const control = await (await app.request(r.headers.get('location')!.split('#')[0]!)).text();
    expect(control).toContain('What you want');
    expect(control).toMatch(/Changed:<\/b> nothing said → Leave alone: SaaS, review \d{4}-\d{2}-\d{2}/);
    expect(control).toContain('What Foundry may do, spend or send: unchanged.');
  });

  it('supersedes rather than edits, and Undo says the older one again', async () => {
    const [before] = await mandateOf(OWNER);
    const { after } = await stateMandate(OWNER, readMandate('Focus on SaaS')!, 'direct');
    const live = await mandateOf(OWNER);
    expect(live.map((s) => s.id)).toEqual([after.id]);
    expect((await query(`SELECT superseded_by FROM mandate_statements WHERE id = ?`, [before!.id])).rows[0]).toMatchObject({ superseded_by: after.id });
    await expect(query(`UPDATE mandate_statements SET statement = 'x' WHERE id = ?`, [after.id])).rejects.toThrow(/never edited/);
    await expect(query(`UPDATE mandate_statements SET superseded_by = NULL WHERE id = ?`, [before!.id])).rejects.toThrow(/never edited/);

    const undo = await app.request('/foundry/mandate/undo', form({ was: before!.id, now: after.id }));
    expect(undo.status).toBe(302);
    const restored = await mandateOf(OWNER);
    expect(restored).toHaveLength(1);
    expect(restored[0]).toMatchObject({ dimension: 'avoid', subject: 'saas', source: `undo:${after.id}` });
  });

  it('writes the same statement from a tap as from a sentence, and takes one back', async () => {
    const tap = directReading('avoid', 'SaaS', 'this month', NOW)!;
    expect(tap).toMatchObject({ dimension: 'avoid', subject: 'saas', until: '2026-10-01' });
    expect(directReading('never', 'SaaS', '', NOW)).toBeNull();
    expect(directReading('avoid', 'everything and anything at all times', '', NOW)).toBeNull();

    const r = await app.request('/foundry/mandate', form({ dimension: 'optimize', subject: 'cash flow', lasting: '' }));
    expect(r.status).toBe(302);
    const cash = (await mandateOf(OWNER)).find((s) => s.subject === 'cash_flow')!;
    expect(cash).toMatchObject({ dimension: 'optimize', source: 'direct' });
    expect((await app.request(`/foundry/mandate/${cash.id}/withdraw`, form({}))).status).toBe(302);
    expect((await mandateOf(OWNER)).some((s) => s.subject === 'cash_flow')).toBe(false);
    expect((await query(`SELECT superseded_by FROM mandate_statements WHERE id = ?`, [cash.id])).rows[0]).toMatchObject({ superseded_by: 'withdrawn' });
  });

  it('never touches another owner\'s statement, and lets a temporary one lapse by itself', async () => {
    const { after } = await stateMandate(OTHER, readMandate('No services', NOW)!, 'direct', NOW);
    expect((await app.request(`/foundry/mandate/${after.id}/withdraw`, form({}))).status).toBe(404);
    const ctl = await (await app.request(`/foundry/controls?mandate=1&now=${after.id}`)).text();
    expect(ctl).not.toContain('services');
    await stateMandate(OWNER, readMandate('Spend less this month', NOW)!, 'direct', NOW);
    expect((await mandateOf(OWNER, NOW)).some((s) => s.subject === 'conserve')).toBe(true);
    expect((await mandateOf(OWNER, new Date('2026-10-02T00:00:00Z'))).some((s) => s.subject === 'conserve')).toBe(false);
  });
});

describe('what the Mandate cannot do', () => {
  it('is read by no gate that decides whether Foundry may act', () => {
    const gates = ['src/services/outbound', 'src/services/ai/client.ts', 'src/services/institution/charter.ts',
      'src/services/institution/standing-intent.ts', 'src/services/institution/spending.ts', 'src/services/autopilot',
      'src/services/founder/authority.ts', 'src/services/venture/hand.ts'];
    const files = (p: string): string[] => statSync(p).isDirectory()
      ? readdirSync(p).flatMap((f) => files(join(p, f))) : p.endsWith('.ts') ? [p] : [];
    for (const f of gates.flatMap(files)) {
      const src = readFileSync(f, 'utf8');
      expect(src, f).not.toMatch(/mandate_statements|mandate\/statements/);
      // ONE NAMED EXCEPTION: the thinking ceiling may be LOWERED by "spend
      // less", through the one module whose factor is proven never above 1
      // (a-mandate-narrows-and-never-widens).
      const reach = [...src.matchAll(/mandate\/([a-z-]+)\.js/g)].map((m) => m[1]);
      expect(reach.every((r) => r === 'narrowing') && (reach.length === 0 || f.endsWith('institution/spending.ts')), f).toBe(true);
    }
  });

  it('writes nothing but its own table', () => {
    const src = readFileSync('src/services/mandate/statements.ts', 'utf8');
    const written = [...src.matchAll(/\b(?:INSERT INTO|UPDATE)\s+([a-z_]+)/g)].map((m) => m[1]);
    expect(new Set(written)).toEqual(new Set(['mandate_statements']));
  });
});
