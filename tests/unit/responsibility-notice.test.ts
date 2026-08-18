process.env.TURSO_DATABASE_URL = 'file::memory:';

import { beforeAll, describe, expect, it } from 'vitest';
import { runMigrations } from '../../src/db/migrate.js';
import { query } from '../../src/db/client.js';
import {
  getResponsibilityNotices, planResponsibilityNotice, proposeResponsibilityNotice,
} from '../../src/services/institution/responsibility-notice.js';
import {
  RESPONSIBILITY_NOTICE_SCOPE, executeAssistedSupportEmail,
} from '../../src/services/institution/responsibility-assisted-email.js';
import { moveResponsibilityTo } from '../fixtures/responsibility-state.js';

// =============================================================================
// A dance school tells a teacher their class needs cover.
//
// The support path assumes a customer wrote in first. Most companies are not
// doing customer support, and waiting for an inbound message would mean the
// work never happens. This is the same governed boundary reached by a different
// capability — which only became possible when migration 136 stopped the effect
// guard naming `customer_support`.
//
// Every separation the support path keeps is kept here: the founder writes the
// words, authoring is not planning, planning is not sending, and dispatch is
// not the teacher turning up.
// =============================================================================

const P = 'rn_dance';
const OWNER = 'rn_owner';
const RESP = 'rn_resp';

beforeAll(async () => {
  await runMigrations();
  await query(`INSERT INTO founders (id,clerk_user_id,email) VALUES ('${OWNER}','rn_c','o@example.com')`, []);
  await query(`INSERT INTO products (id,name,owner_id) VALUES ('${P}','Fold Street Dance','${OWNER}')`, []);
  await query(
    `INSERT INTO signal_events (id,product_id,source,event_type,severity,payload_json,summary)
     VALUES ('rn_sig',?,'repository','development_need_observed','low','{}','seed')`, [P]);
  await query(
    `INSERT INTO institutional_responsibilities (id,product_id,title,capability,state,discovery_evidence_ref)
     VALUES (?,?,'Every timetabled class has a teacher','operations','shadowing','signal_event:rn_sig')`, [RESP, P]);
  await query(
    `INSERT INTO autonomy_consents
       (id,founder_id,product_id,capability,from_mode,to_mode,disclosure_version,
        responsibility_id,allowed_scope_json,consequence_boundary,expires_at)
     VALUES ('rn_consent',?,?,'operations','suggest','act','v1',?,?, 'low',datetime('now','+1 day'))`,
    [OWNER, P, RESP, JSON.stringify([RESPONSIBILITY_NOTICE_SCOPE])]);
  await moveResponsibilityTo(RESP, 'assisting',
    { productId: P, authorityRef: 'autonomy_consent:rn_consent' });
});

describe('founder-authored responsibility notices', () => {
  it('records what the founder wrote, and sends nothing', async () => {
    const written = await proposeResponsibilityNotice({
      productId: P, founderId: OWNER, responsibilityId: RESP,
      recipient: 'teacher@example.com', subject: 'Saturday 10am needs cover',
      body: 'Marta is off on Saturday — can you take the 10am?',
    });
    expect('notice' in written).toBe(true);

    // Authoring is evidence, not a plan and not a send.
    expect((await query('SELECT COUNT(*) n FROM outbound_actions WHERE product_id=?', [P])).rows[0])
      .toMatchObject({ n: 0 });
    const evidence = (await query(
      `SELECT source,payload_json FROM signal_events WHERE product_id=? AND source='founder_responsibility_notice'`,
      [P])).rows[0] as Record<string, unknown>;
    expect(String(evidence.payload_json)).toContain('teacher@example.com');
    // Foundry composed none of it.
    expect(String(evidence.payload_json)).toContain('can you take the 10am?');
  });

  it('refuses a bad recipient, empty content, and an oversized body', async () => {
    const base = {
      productId: P, founderId: OWNER, responsibilityId: RESP,
      recipient: 'teacher@example.com', subject: 'x', body: 'y',
    };
    expect(await proposeResponsibilityNotice({ ...base, recipient: 'not-an-address' }))
      .toEqual({ refused: 'recipient_required' });
    expect(await proposeResponsibilityNotice({ ...base, body: '   ' }))
      .toEqual({ refused: 'content_required' });
    expect(await proposeResponsibilityNotice({ ...base, body: 'x'.repeat(9000) }))
      .toEqual({ refused: 'content_too_large' });
    // A stranger cannot write for this company.
    expect(await proposeResponsibilityNotice({ ...base, founderId: 'someone-else' }))
      .toEqual({ refused: 'responsibility_invalid' });
  });

  it('converges when the same words are written to the same person twice', async () => {
    const args = {
      productId: P, founderId: OWNER, responsibilityId: RESP,
      recipient: 'teacher@example.com', subject: 'Saturday 10am needs cover',
      body: 'Marta is off on Saturday — can you take the 10am?',
    };
    const again = await proposeResponsibilityNotice(args);
    expect(again).toMatchObject({ duplicate: true });
    expect((await getResponsibilityNotices(P, RESP)).length).toBe(1);
  });

  it('carries it under exact authority, and revalidates before dispatch', async () => {
    const notice = (await getResponsibilityNotices(P, RESP))[0];
    const planned = await planResponsibilityNotice({
      productId: P, founderId: OWNER, noticeId: notice.id,
    });
    expect('actionId' in planned).toBe(true);
    const actionId = (planned as { actionId: string }).actionId;

    const row = (await query(
      'SELECT authority_scope,authority_consent_id,effect_id,status,outcome_status FROM outbound_actions WHERE id=?',
      [actionId])).rows[0];
    expect(row).toMatchObject({
      authority_scope: RESPONSIBILITY_NOTICE_SCOPE, authority_consent_id: 'rn_consent',
      effect_id: notice.id, status: 'approved', outcome_status: 'unresolved',
    });

    // Planning twice converges rather than sending the same words twice.
    expect(await planResponsibilityNotice({ productId: P, founderId: OWNER, noticeId: notice.id }))
      .toEqual({ actionId, duplicate: true });

    // Withdrawn between planning and dispatch: nothing is sent. The hardest
    // window the architecture supports, on a capability that is not support.
    const result = await executeAssistedSupportEmail(actionId, {
      afterClaim: async () => {
        await query("UPDATE autonomy_consents SET revoked_at=datetime('now') WHERE id='rn_consent'");
      },
    });
    expect(result.dispatched).toBe(false);
    expect(result.certainty).toBe('not_attempted');
  });

  it('refuses to carry anything once authority is gone', async () => {
    const notice = (await getResponsibilityNotices(P, RESP))[0];
    expect(await planResponsibilityNotice({ productId: P, founderId: OWNER, noticeId: notice.id }))
      .toEqual({ refused: 'no_authority' });
  });

  it('refuses to carry a notice for a responsibility that is not Assisting', async () => {
    await query(
      `INSERT INTO signal_events (id,product_id,source,event_type,severity,payload_json,summary)
       VALUES ('rn_sig2',?,'repository','development_need_observed','low','{}','seed')`, [P]);
    await query(
      `INSERT INTO institutional_responsibilities (id,product_id,title,capability,state,discovery_evidence_ref)
       VALUES ('rn_watching',?,'Something watched','operations','shadowing','signal_event:rn_sig2')`, [P]);
    const written = await proposeResponsibilityNotice({
      productId: P, founderId: OWNER, responsibilityId: 'rn_watching',
      recipient: 'someone@example.com', subject: 'Hello', body: 'A note.',
    });
    // Writing is fine — a founder may write about anything they are responsible
    // for. Carrying is not: watching is not permission.
    expect('notice' in written).toBe(true);
    expect(await planResponsibilityNotice({
      productId: P, founderId: OWNER, noticeId: (written as { notice: { id: string } }).notice.id,
    })).toEqual({ refused: 'not_assisting' });
  });

  it('has no model on this path, and none implied by it', async () => {
    const { readFileSync } = await import('node:fs');
    const { resolve } = await import('node:path');
    const source = readFileSync(
      resolve(process.cwd(), 'src/services/institution/responsibility-notice.ts'), 'utf8');
    expect(source).not.toMatch(/from '.*\/ai\//);
    expect(source).not.toMatch(/\bcomposer\b|anthropic|openai/i);
  });
});
