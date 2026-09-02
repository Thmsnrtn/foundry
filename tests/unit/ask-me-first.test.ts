process.env.TURSO_DATABASE_URL = 'file::memory:';
process.env.ENCRYPTION_KEY = '0'.repeat(64);
process.env.FOUNDRY_INSTANCE_POSTURE = 'private_owner';
process.env.FOUNDRY_OWNER_EMAIL = 'owner@example.com';

import { beforeAll, describe, expect, it } from 'vitest';
import { Hono } from 'hono';
import { runMigrations } from '../../src/db/migrate.js';
import { query } from '../../src/db/client.js';
import {
  decideProposedAct, fingerprint, interpret, openProposals, proposeAct,
  revokeApproval, setBoundary, spendApprovalFor,
} from '../../src/services/institution/standing-intent.js';

// =============================================================================
// ASK ME FIRST.
//
// Migration 225 shipped boundaries with one mode and said why: "without asking"
// could not be honestly enforced, because nothing reaching the outbound door
// carried proof that the OWNER decided THIS PARTICULAR ACT. The owner's answer
// was that the finding exposed a missing primitive, not a reason to accept hard
// refusal as the mature model.
//
// THE ATTACK THIS IS REALLY ABOUT is not a forged approval. It is a REAL one,
// used for something else: propose a reasonable message to one customer, obtain
// a yes, then send a different message to everyone. So the assertions that
// matter here are the ones about binding — to the owner, to the company, to the
// exact act, once.
// =============================================================================

const OWNER = 'af_owner';
const CO = 'af_co';
const AGENT = 'agent:support';

beforeAll(async () => {
  await runMigrations();
  await query('INSERT INTO founders (id,clerk_user_id,email,name) VALUES (?,?,?,?)',
    [OWNER, 'clerk_af', 'owner@example.com', 'Owner']);
  await query("INSERT INTO products (id,name,owner_id,status) VALUES (?,'AcreOS',?,'active')",
    [CO, OWNER]);
});

describe('the sentence he actually said', () => {
  it('hears "without asking" as a different instruction from "never"', () => {
    const asked = interpret('Do not change pricing without asking me');
    expect(asked.kind).toBe('boundary');
    if (asked.kind === 'boundary') {
      expect(asked.subject).toBe('set_prices');
      expect(asked.mode).toBe('ask_first');
    }
    const never = interpret('Never change pricing');
    if (never.kind === 'boundary') expect(never.mode).toBe('never');
  });

  it('defaults to never, which is the safe direction', () => {
    // A misheard boundary that refuses too much bites once and he lifts it in
    // one tap. One that refuses too little is invisible.
    for (const said of ["Don't contact anyone", 'Do not publish anything']) {
      const read = interpret(said);
      if (read.kind === 'boundary') expect(read.mode, said).toBe('never');
    }
  });
});

describe('a boundary that can be worked inside', () => {
  it('refuses at the door until he has approved this exact act', async () => {
    const { checkKillSwitch } = await import('../../src/services/outbound/kill-switch.js');
    await setBoundary({ productId: CO, subject: 'contact_people', mode: 'ask_first',
      statement: 'Do not contact anyone without asking me' });

    const params = { to: 'someone@example.com', subject: 'Your invoice' };
    const refused = await checkKillSwitch(CO, 'send_email', null,
      { paramsFingerprint: fingerprint(params) });
    expect(refused.blocked).toBe(true);
    expect(refused.reason).toContain('without asking you first');
    expect(refused.reason).toContain('Do not contact anyone without asking me');

    const id = await proposeAct({
      productId: CO, subject: 'contact_people', actionType: 'send_email', params,
      summary: 'Email one customer about a failed payment',
      why: 'their card was declined and they have not been told',
      expectedEffect: 'they update the card and the subscription continues',
      risk: 'if the decline was a bank glitch this is an unnecessary message',
      consequence: 'low', proposedBy: AGENT,
    });
    // Proposing changes nothing on its own.
    expect((await checkKillSwitch(CO, 'send_email', null,
      { paramsFingerprint: fingerprint(params) })).blocked).toBe(true);

    await decideProposedAct({ id, decision: 'approved', decidedBy: `founder:${OWNER}` });
    const allowed = await checkKillSwitch(CO, 'send_email', null,
      { paramsFingerprint: fingerprint(params) });
    expect(allowed.blocked).toBe(false);

    // SPENT ONCE. Approving one message does not open the door for the next.
    expect((await checkKillSwitch(CO, 'send_email', null,
      { paramsFingerprint: fingerprint(params) })).blocked).toBe(true);
  });

  it('will not let an approval be used for a different act', async () => {
    // The attack: propose something reasonable, execute something else.
    const params = { to: 'one@example.com', subject: 'Hello' };
    const id = await proposeAct({
      productId: CO, subject: 'contact_people', actionType: 'send_email', params,
      summary: 'Email one customer', why: 'they asked', expectedEffect: 'they reply',
      risk: 'none worth naming', consequence: 'low', proposedBy: AGENT,
    });
    await decideProposedAct({ id, decision: 'approved', decidedBy: `founder:${OWNER}` });

    const { checkKillSwitch } = await import('../../src/services/outbound/kill-switch.js');
    const somethingElse = { to: 'everyone@example.com', subject: 'Hello' };
    expect((await checkKillSwitch(CO, 'send_email', null,
      { paramsFingerprint: fingerprint(somethingElse) })).blocked).toBe(true);
    // And the real one still works, because it was never spent.
    expect((await checkKillSwitch(CO, 'send_email', null,
      { paramsFingerprint: fingerprint(params) })).blocked).toBe(false);
  });

  it('fingerprints meaning, not key order', () => {
    expect(fingerprint({ a: 1, b: { c: 2, d: 3 } }))
      .toBe(fingerprint({ b: { d: 3, c: 2 }, a: 1 }));
    expect(fingerprint({ a: 1 })).not.toBe(fingerprint({ a: 2 }));
  });
});

describe('who may answer', () => {
  it('refuses an approval from anyone but this company\'s owner', async () => {
    await query('INSERT INTO founders (id,clerk_user_id,email) VALUES (?,?,?)',
      ['af_other', 'c_o', 'o@e.com']);
    const id = await proposeAct({
      productId: CO, subject: 'contact_people', actionType: 'send_email',
      params: { to: 'x@example.com' }, summary: 'Email x', why: 'because',
      expectedEffect: 'a reply', risk: 'none', consequence: 'low', proposedBy: AGENT,
    });
    // Not "a founder" — the one who owns this company. The database resolves it
    // through the product rather than trusting a route to have checked.
    await expect(decideProposedAct({ id, decision: 'approved', decidedBy: 'founder:af_other' }))
      .rejects.toThrow(/not_the_owner/);
    await expect(decideProposedAct({ id, decision: 'approved', decidedBy: AGENT }))
      .rejects.toThrow(/not_the_owner/);
  });

  it('refuses a proposal that arrives already approved', async () => {
    // An agent approving itself in one statement, refused in the one place that
    // cannot be bypassed by writing the columns in a different order.
    await expect(query(
      `INSERT INTO proposed_acts
         (id,product_id,subject,action_type,params_fingerprint,summary,why,expected_effect,
          risk,consequence,proposed_by,expires_at,decision,decided_by,decided_at)
       VALUES ('af_self',?,'contact_people','send_email','ff','s','w','e','r','low',?,
               datetime('now','+1 hour'),'approved',?,datetime('now'))`,
      [CO, AGENT, `founder:${OWNER}`])).rejects.toThrow(/cannot_arrive_decided/);
  });

  it('refuses a proposal nothing asked for', async () => {
    // His attention is the scarcest thing here. A proposal about something he
    // never asked to be consulted on is an interruption made out of nothing.
    await expect(proposeAct({
      productId: CO, subject: 'publish', actionType: null, params: {},
      summary: 'Post something', why: 'because', expectedEffect: 'reach',
      risk: 'none', consequence: 'low', proposedBy: AGENT,
    })).rejects.toThrow(/nothing_asked_for_this/);
  });

  it('cannot be re-decided, and the record cannot drift', async () => {
    const id = await proposeAct({
      productId: CO, subject: 'contact_people', actionType: 'send_email',
      params: { to: 'y@example.com' }, summary: 'Email y', why: 'because',
      expectedEffect: 'a reply', risk: 'none', consequence: 'low', proposedBy: AGENT,
    });
    await decideProposedAct({ id, decision: 'refused', decidedBy: `founder:${OWNER}` });
    await expect(query(
      "UPDATE proposed_acts SET decision='approved' WHERE id=?", [id]))
      .rejects.toThrow(/already_decided/);
    await expect(query(
      "UPDATE proposed_acts SET summary='something else' WHERE id=?", [id]))
      .rejects.toThrow(/immutable/);
    await expect(query('DELETE FROM proposed_acts WHERE id=?', [id]))
      .rejects.toThrow(/immutable/);
  });

  it('is revocable until it is used, and not after', async () => {
    const params = { to: 'z@example.com' };
    const id = await proposeAct({
      productId: CO, subject: 'contact_people', actionType: 'send_email', params,
      summary: 'Email z', why: 'because', expectedEffect: 'a reply', risk: 'none',
      consequence: 'low', proposedBy: AGENT,
    });
    await decideProposedAct({ id, decision: 'approved', decidedBy: `founder:${OWNER}` });
    await revokeApproval(id, 'changed my mind');
    expect(await spendApprovalFor({
      productId: CO, actionType: 'send_email', paramsFingerprint: fingerprint(params),
    })).toBe(false);
  });

  it('will not spend an expired approval', async () => {
    // A PROPOSAL MADE TWO DAYS AGO THAT EXPIRED YESTERDAY, written as one.
    // Moving `expires_at` afterwards is refused by the immutability trigger —
    // correctly, since an expiry that can be extended after approval is not an
    // expiry — so the fixture is a genuinely old row rather than an edited one.
    const params = { to: 'stale@example.com' };
    await query(
      `INSERT INTO proposed_acts
         (id,product_id,subject,action_type,params_fingerprint,summary,why,expected_effect,
          risk,consequence,proposed_by,proposed_at,expires_at)
       VALUES ('af_stale',?,'contact_people','send_email',?,'Email stale','because',
               'a reply','none','low',?,
               datetime('now','-2 day'), datetime('now','-1 day'))`,
      [CO, fingerprint(params), AGENT]);
    await decideProposedAct({
      id: 'af_stale', decision: 'approved', decidedBy: `founder:${OWNER}` });
    expect(await spendApprovalFor({
      productId: CO, actionType: 'send_email', paramsFingerprint: fingerprint(params),
    })).toBe(false);
  });
});

describe('the owner surface', () => {
  const asOwner = async (path: string, body?: string): Promise<{
    status: number; text: string; location: string | null;
  }> => {
    const { foundryShellRoutes } = await import('../../src/routes/dashboard/foundry-shell.js');
    const app = new Hono();
    app.use('*', async (c, next) => {
      c.set('founder' as never,
        { id: OWNER, email: 'owner@example.com', name: 'Owner' } as never);
      c.set('csrfToken' as never, 'test' as never);
      await next();
    });
    app.route('/', foundryShellRoutes as never);
    const res = await app.request(path, body == null ? undefined : {
      method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body,
    });
    return { status: res.status, text: await res.text(), location: res.headers.get('location') };
  };

  it('puts the whole proposal in front of him', async () => {
    await proposeAct({
      productId: CO, subject: 'contact_people', actionType: 'send_email',
      params: { to: 'jane@example.com' },
      summary: 'Email Jane about her failed payment',
      why: 'her card was declined on Tuesday and nobody has told her',
      expectedEffect: 'she updates the card and keeps her subscription',
      risk: 'if the decline was a bank glitch this is an unnecessary message',
      consequence: 'low', proposedBy: AGENT,
    });
    const page = await asOwner(`/foundry/companies/${CO}`);
    expect(page.text).toMatch(/I need you to decide (this|these)/);
    expect(page.text).toContain('Email Jane about her failed payment');
    expect(page.text).toContain('nobody has told her');
    expect(page.text).toContain('she updates the card');
    expect(page.text).toContain('unnecessary message');
    // The consequence of doing nothing, stated.
    expect(page.text).toContain('If you do nothing, I do not do it');
  });

  it('approves one act without lifting the boundary', async () => {
    // The whole point: he keeps the control AND the institution can work.
    const open = await openProposals(CO);
    const one = open.find((p) => p.summary.includes('Jane'));
    if (!one) throw new Error('expected an open proposal');
    const done = await asOwner(`/foundry/proposals/${one.id}/approve`, '');
    expect(done.location).toBe(`/foundry/companies/${CO}?done=approved`);

    const page = await asOwner(`/foundry/companies/${CO}?done=approved`);
    expect(page.text).toContain('The boundary stays exactly as it was');
    const { boundariesFor } = await import('../../src/services/institution/standing-intent.js');
    const still = (await boundariesFor(CO)).find((b) => b.subject === 'contact_people');
    expect(still?.mode).toBe('ask_first');
  });

  it('refuses a proposal for someone else\'s company', async () => {
    await query("INSERT INTO products (id,name,owner_id,status) VALUES ('af_theirs','T','af_other','active')");
    await query(
      `INSERT INTO owner_boundaries (id,product_id,subject,statement,mode)
       VALUES ('af_b','af_theirs','contact_people','no','ask_first')`);
    await query(
      `INSERT INTO proposed_acts
         (id,product_id,subject,action_type,params_fingerprint,summary,why,expected_effect,
          risk,consequence,proposed_by,expires_at)
       VALUES ('af_foreign','af_theirs','contact_people','send_email','ff','s','w','e','r',
               'low','agent:x',datetime('now','+1 hour'))`);
    expect((await asOwner('/foundry/proposals/af_foreign/approve', '')).status).toBe(404);
  });
});
