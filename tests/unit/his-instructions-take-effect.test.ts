process.env.TURSO_DATABASE_URL = 'file::memory:';
process.env.ENCRYPTION_KEY = '0'.repeat(64);
process.env.FOUNDRY_INSTANCE_POSTURE = 'private_owner';
process.env.FOUNDRY_OWNER_EMAIL = 'owner@example.com';

import { Hono } from 'hono';
import { beforeAll, describe, expect, it } from 'vitest';
import { runMigrations } from '../../src/db/migrate.js';
import { query } from '../../src/db/client.js';
import {
  boundariesFor, interpret, setBoundary,
} from '../../src/services/institution/standing-intent.js';

// =============================================================================
// HIS INSTRUCTIONS TAKE EFFECT.
//
// Two defects found by a senior review of the owner product, both in the path
// where what he says becomes what Foundry may do. Neither had a symptom he
// could see; both made the product affirm something that had not happened.
//
// ONE. "Ask me first before you email customers" produced no boundary. The gate
// that leads to the boundary branch asks whether the sentence forbids
// something, and only then looks at the ask-markers to decide "never" versus
// "ask me first" — but four of the five ask-markers appear in no prohibition
// phrase, so a sentence carrying one and nothing else never reached the branch.
// It fell through and was filed as what the company is FOR.
//
// TWO. Changing his mind was a silent no-op. setBoundary returned any live
// boundary on the same subject without comparing what it said, so replacing
// "ask me first" with "never" kept the permissive one — and the confirmation
// page told him it had been done.
// =============================================================================

const OWNER = 'effect_owner';
let productId = '';
let app: Hono;

beforeAll(async () => {
  await runMigrations();
  await query('INSERT INTO founders (id,clerk_user_id,email,name) VALUES (?,?,?,?)',
    [OWNER, 'clerk_effect', 'owner@example.com', 'Thomas Norton']);
  const { foundryShellRoutes } = await import('../../src/routes/dashboard/foundry-shell.js');
  app = new Hono();
  app.use('*', async (c, next) => {
    c.set('founder' as never,
      { id: OWNER, email: 'owner@example.com', name: 'Thomas Norton' } as never);
    c.set('csrfToken' as never, 'test' as never);
    await next();
  });
  app.route('/', foundryShellRoutes);
  await app.request('/foundry/companies', { method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ name: 'Tidewater' }).toString() });
  productId = String(((await query(
    'SELECT id FROM products WHERE owner_id = ?', [OWNER])).rows[0] as Record<string, unknown>).id);
});

describe('asking to be consulted', () => {
  it('is heard as a boundary, in the words he would actually use', () => {
    for (const said of [
      'Ask me first before you email customers',
      'Check with me before you email customers',
      'Run it by me before you email any customer',
    ]) {
      const out = interpret(said);
      expect(out.kind, said).toBe('boundary');
      if (out.kind !== 'boundary') return;
      expect(out.mode, said).toBe('ask_first');
      expect(out.subject, said).toBe('contact_people');
    }
  });

  it('is never mistaken for what the company is for', () => {
    // The failure this had: it fell past the boundary branch entirely and was
    // filed as an objective, quietly replacing what the company was for.
    expect(interpret('Ask me first before you email customers').kind).not.toBe('objective');
  });

  it('still hears a flat refusal as a flat refusal', () => {
    const out = interpret('Never email customers');
    expect(out.kind).toBe('boundary');
    if (out.kind !== 'boundary') return;
    expect(out.mode).toBe('never');
  });
});

describe('changing his mind', () => {
  it('replaces a permissive boundary with a stricter one', async () => {
    await setBoundary({ productId, subject: 'contact_people', mode: 'ask_first',
      statement: 'ask me first before you email customers' });
    await setBoundary({ productId, subject: 'contact_people', mode: 'never',
      statement: 'never email customers' });
    const live = await boundariesFor(productId);
    const contact = live.filter((b) => b.subject === 'contact_people');
    // One live boundary, and it is the one he last said.
    expect(contact).toHaveLength(1);
    expect(contact[0]?.mode).toBe('never');
  });

  it('keeps the one it replaced, with the reason', async () => {
    const lifted = (await query(
      `SELECT mode, lifted_reason FROM owner_boundaries
        WHERE subject = 'contact_people' AND lifted_at IS NOT NULL`))
      .rows as unknown as Array<Record<string, unknown>>;
    expect(lifted).toHaveLength(1);
    expect(String(lifted[0]?.mode)).toBe('ask_first');
    expect(String(lifted[0]?.lifted_reason)).toContain('replaced');
  });

  it('still does nothing when he says the same thing twice', async () => {
    const before = (await query(
      "SELECT COUNT(*) AS n FROM owner_boundaries WHERE subject = 'contact_people'"))
      .rows[0] as Record<string, unknown>;
    await setBoundary({ productId, subject: 'contact_people', mode: 'never',
      statement: 'never email customers' });
    const after = (await query(
      "SELECT COUNT(*) AS n FROM owner_boundaries WHERE subject = 'contact_people'"))
      .rows[0] as Record<string, unknown>;
    expect(Number(after.n)).toBe(Number(before.n));
  });
});

describe('a question at the universal entrance', () => {
  it('is answered rather than apologised for', async () => {
    // It used to render a page headed "Let me answer that" whose next sentence
    // was "I cannot answer questions in words yet" — and the first screen had
    // been answering these all along.
    const res = await app.request('/foundry/ask', { method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ said: 'How are things?' }).toString() });
    expect(res.status).toBe(302);
    expect(String(res.headers.get('location'))).toContain('/foundry?q=');
    const answered = await (await app.request(
      String(res.headers.get('location')))).text();
    expect(answered).not.toContain('I cannot answer questions in words yet');
  });
});
