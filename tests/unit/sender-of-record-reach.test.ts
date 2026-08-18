// =============================================================================
// Tests: the sender-of-record rule had zero callers
//
// `services/outbound/sender-of-record.ts` states it plainly: Foundry must never
// be the From on a message to a THIRD PARTY — a founder's customer. Those go
// out under the founder's own connected sender, their domain, their opt-out
// footer, their CAN-SPAM responsibility. Foundry's domain is the From only on
// mail to the FOUNDER.
//
// Its own header adds: "Department third-party paths must call it before
// dispatch. (Departments currently draft-only; this lights the rule up BEFORE
// the live path exists, so it can never regress open.)"
//
// It regressed open. `assertSenderOfRecord` had no callers anywhere in the
// system, while the live send handler defaults `from` to
// 'Foundry <noreply@foundry.app>' and the SendGrid fallback hard-codes
// 'briefings@foundry.app'. The live path was built in a different file from the
// one the comment was written in — which is the whole shape of this defect
// class: a rule, an implementation, and no edge between them.
//
// The rule now runs at the send boundary, and is enforceable because the thing
// it presupposes finally exists: migration 150 gives every company its own
// sending identity — its own From, through its own provider account — so a
// third-party message has somebody to be sent as. With none connected the send
// refuses, which is the owner's decision and the rule's plain meaning.
// =============================================================================

process.env.TURSO_DATABASE_URL = 'file::memory:';
process.env.ENCRYPTION_KEY = '0'.repeat(64);

import { beforeAll, describe, expect, it } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';

import { runMigrations } from '../../src/db/migrate.js';
import { query } from '../../src/db/client.js';
import {
  assertSenderOfRecord, isFoundryDomain, SenderOfRecordError,
} from '../../src/services/outbound/sender-of-record.js';

const F = 'sor_f';
const MATE = 'sor_mate';
const P = 'sor_p';

beforeAll(async () => {
  await runMigrations();
  await query(`INSERT INTO founders (id, clerk_user_id, email) VALUES (?,?,?)`,
    [F, 'clerk_sor', 'owner@company.example']);
  await query(`INSERT INTO founders (id, clerk_user_id, email) VALUES (?,?,?)`,
    [MATE, 'clerk_mate', 'colleague@company.example']);
  await query(`INSERT INTO products (id, name, owner_id) VALUES (?,'Sender Co',?)`, [P, F]);
  await query(
    `INSERT INTO team_members (id, product_id, founder_id, role, status)
     VALUES ('sor_tm', ?, ?, 'co_founder', 'active')`, [P, MATE]);
});

describe('the rule itself', () => {
  it('refuses a Foundry domain to a third party', () => {
    expect(() => assertSenderOfRecord({
      from: 'Foundry <noreply@foundry.app>', recipientIsFounder: false,
    })).toThrow(SenderOfRecordError);
  });

  it('allows a Foundry domain to the founder', () => {
    expect(() => assertSenderOfRecord({
      from: 'Foundry <noreply@foundry.app>', recipientIsFounder: true,
    })).not.toThrow();
  });

  it('allows the founder’s own domain to a third party', () => {
    expect(() => assertSenderOfRecord({
      from: 'Ada <ada@company.example>', recipientIsFounder: false,
    })).not.toThrow();
  });

  it('catches a subdomain of a Foundry domain', () => {
    expect(isFoundryDomain('x@mail.foundry.app')).toBe(true);
    expect(isFoundryDomain('x@notfoundry.app')).toBe(false);
  });
});

describe('who counts as the founder', () => {
  // The determination is made from the database, not from what the caller
  // says the message is: `dataClass` and `surface` are the caller's
  // description, and the rule is about who actually receives it.
  async function isFounderMail(to: string[]): Promise<boolean> {
    const mod = await import('../../src/services/integration/resend.js');
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return (mod as any).__recipientIsFounderForTest(P, to.map((t) => t.toLowerCase()));
  }

  it('recognises the product owner', async () => {
    expect(await isFounderMail(['owner@company.example'])).toBe(true);
  });

  it('recognises an active team member', async () => {
    expect(await isFounderMail(['colleague@company.example'])).toBe(true);
  });

  it('does not recognise a customer', async () => {
    expect(await isFounderMail(['buyer@elsewhere.example'])).toBe(false);
  });

  it('treats a mixed audience as third-party', async () => {
    // The strictest recipient decides. A message to the founder AND a customer
    // is a message a customer receives.
    expect(await isFounderMail(['owner@company.example', 'buyer@elsewhere.example']))
      .toBe(false);
  });

  it('does not recognise another company’s founder', async () => {
    await query(`INSERT INTO founders (id, clerk_user_id, email) VALUES (?,?,?)`,
      ['sor_other', 'clerk_other', 'other@other.example']);
    await query(`INSERT INTO products (id, name, owner_id) VALUES ('sor_p2','Other Co','sor_other')`);
    expect(await isFounderMail(['other@other.example']),
      'a founder is the founder OF THIS PRODUCT, not any founder').toBe(false);
  });
});

describe('the boundary is wired', () => {
  // The defect was not that the rule was wrong. It was that nothing called it.
  const source = readFileSync(
    resolve(__dirname, '../../src/services/integration/resend.ts'), 'utf8');

  it('the live send handler applies it', () => {
    const handler = source.slice(source.indexOf('export async function sendEmailHandler'));
    expect(handler.slice(0, 4000)).toMatch(/resolveSender/);
  });

  it('both providers send under the From the rule was applied to', () => {
    // The SendGrid fallback used to hard-code its own address, so a message
    // could go out under a From the check never saw.
    expect(source).toMatch(/DEFAULT_FOUNDRY_FROM/);
    const sendgrid = source.slice(source.indexOf('api.sendgrid.com'));
    expect(sendgrid.slice(0, 800)).toMatch(/sender\.from/);
  });
});
