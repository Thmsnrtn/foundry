process.env.TURSO_DATABASE_URL = 'file::memory:';
process.env.ENCRYPTION_KEY = '0'.repeat(64);

import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { Hono } from 'hono';
import { runMigrations } from '../../src/db/migrate.js';
import { query } from '../../src/db/client.js';
import { registerToolHandler, invoke } from '../../src/services/outbound/gateway.js';
import { SEND_EMAIL_POLICY } from '../../src/services/integration/resend.js';
import {
  contactIsRefused, getContactConstraints, recordContactConstraint,
} from '../../src/services/institution/contact-constraint.js';

// =============================================================================
// THE PERSON AN EFFECT REACHES IS NOT REPRESENTED BY THE FOUNDER'S AUTHORITY.
//
// Migration 094 created a suppression list and stated the law on its face: "an
// address on this list is never contacted again, by any mode, at any trust
// level." One department consulted it. The governed email path — the one that
// actually reaches a customer — never did. And `addSuppression` had no caller
// anywhere in `src/`, so nobody could get onto the list at all: the one reader
// always found it empty.
//
// A control with no way in and no consequence path is a sentence in a
// migration. This is the architecture's affected-party term made real: checked
// where every outward effect converges, so no caller has to remember it.
//
// RECORDED, NEVER INFERRED. Foundry does not read a customer's reply and decide
// they meant stop. The company states it.
// =============================================================================

const P = 'dnc_product';
const OWNER = 'dnc_owner';
const PERSON = 'ines@example.com';
const OBSERVER = 'dnc_observer';

let dispatches = 0;
let acting = OWNER;
let app: Hono;

beforeAll(async () => {
  await runMigrations();
  await query(`INSERT INTO founders (id,clerk_user_id,email,tier) VALUES (?,'dnc_c','o@example.com','growth')`, [OWNER]);
  await query(`INSERT INTO products (id,name,owner_id,status) VALUES (?,'Fold Street Dance',?,'active')`, [P, OWNER]);
  await query(`INSERT INTO founders (id,clerk_user_id,email,tier) VALUES (?,'dnc_obs','obs@example.com','growth')`, [OBSERVER]);
  await query(
    `INSERT INTO team_members (id,product_id,founder_id,role,status,can_manage_company)
     VALUES ('dnc_tm',?,?,'investor_observer','active',0)`, [P, OBSERVER]);

  const { letterRoutes } = await import('../../src/routes/dashboard/letter.js');
  app = new Hono();
  app.use('*', async (c, next) => {
    c.set('founder' as never, { id: acting, email: 'o@example.com', tier: 'growth', preferences: {} } as never);
    c.set('csrfToken' as never, 't' as never);
    await next();
  });
  app.route('/', letterRoutes);
});

beforeEach(async () => {
  dispatches = 0;
  acting = OWNER;
  registerToolHandler('send_email', async () => { dispatches += 1; return { message_id: 'provider-1' }; }, SEND_EMAIL_POLICY);
  await query('DELETE FROM outreach_suppressions');
});

const send = (to: string): Promise<{ ok: boolean; phase?: string }> => invoke({
  productId: P, tool: 'send_email', action: `send to ${to}`,
  params: { to: [to], subject: 'Saturday cover', html: 'Can you take the 10am?' },
  dedupKey: `dk_${to}_${Math.random()}`, customerExternalId: to,
  surface: 'email_outbound', dataClass: 'customer',
}) as never;

describe('somebody who asked this company to stop', () => {
  it('is not written to, at the boundary every send passes through', async () => {
    expect((await send(PERSON)).ok).toBe(true);
    expect(dispatches).toBe(1);

    expect(await recordContactConstraint({
      productId: P, founderId: OWNER, email: PERSON, reason: 'they_asked' }))
      .toEqual({ recorded: true });

    dispatches = 0;
    const refused = await send(PERSON);
    expect(refused.ok).toBe(false);
    expect(refused.phase).toBe('contact_refused');
    expect(dispatches, 'nothing reached the provider').toBe(0);
  });

  it('has said nothing about a different company', async () => {
    await recordContactConstraint({
      productId: P, founderId: OWNER, email: PERSON, reason: 'they_asked' });
    expect(await contactIsRefused('some_other_product', PERSON)).toEqual({ refused: false });
  });

  it('does not silence everybody else', async () => {
    await recordContactConstraint({
      productId: P, founderId: OWNER, email: PERSON, reason: 'they_asked' });
    expect((await send('someone.else@example.com')).ok).toBe(true);
  });
});

describe('recording the constraint', () => {
  it('is refused for somebody the company has not given that permission', async () => {
    expect(await recordContactConstraint({
      productId: P, founderId: 'a-stranger', email: PERSON, reason: 'they_asked' }))
      .toEqual({ refused: 'not_permitted' });
  });

  it('is refused for a member the company has not given company management', async () => {
    // An investor observer reaching the letter is the point of the membership
    // model — but the list is append-only, so writing to it silently stops the
    // company writing to whoever is on it, and nothing on this page undoes
    // that. The brake is not the same as an ordinary read.
    acting = OBSERVER;
    const posted = await app.request('/letter/do-not-contact', {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ email: PERSON, reason: 'they_asked' }).toString(),
    });
    expect(posted.status).toBe(403);
    expect(await getContactConstraints(P)).toEqual([]);
  });

  it('is refused for a reason outside the closed set', async () => {
    expect(await recordContactConstraint({
      productId: P, founderId: OWNER, email: PERSON, reason: 'they seemed annoyed' as never }))
      .toEqual({ refused: 'reason_invalid' });
  });

  it('is refused for something that is not an address', async () => {
    expect(await recordContactConstraint({
      productId: P, founderId: OWNER, email: 'not-an-address', reason: 'they_asked' }))
      .toEqual({ refused: 'email_invalid' });
  });
});

describe('the founder', () => {
  it('can add somebody and see who is on the list', async () => {
    // A brand-new company sees the first-run welcome instead of the body, and
    // that branch is deliberately overridden by real institutional state — the
    // rule beside it is that it may not hide a person. Recording a constraint
    // creates one, so the letter shows it rather than "let's get your first
    // signal".
    const posted = await app.request('/letter/do-not-contact', {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ email: PERSON, reason: 'they_asked' }).toString(),
    });
    expect(posted.status).toBe(302);

    expect((await getContactConstraints(P)).map((c) => c.email)).toContain(PERSON);
    const after = await (await app.request('/letter')).text();
    expect(after).toContain('Who I will not contact');
    expect(after).toContain(PERSON);
    expect(after).toContain('they asked not to be contacted');
    expect(after, 'a recorded person overrides the first-run welcome')
      .not.toContain("let's get your first signal");
  });
});
