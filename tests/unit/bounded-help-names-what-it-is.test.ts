process.env.TURSO_DATABASE_URL = 'file::memory:';

import { beforeAll, describe, expect, it } from 'vitest';
import { runMigrations } from '../../src/db/migrate.js';
import { query } from '../../src/db/client.js';
import { proposeResponsibilityNotice, planResponsibilityNotice }
  from '../../src/services/institution/responsibility-notice.js';
import {
  RESPONSIBILITY_NOTICE_SCOPE, getFounderAssistingActivity,
} from '../../src/services/institution/responsibility-assisted-email.js';
import { moveResponsibilityTo } from '../fixtures/responsibility-state.js';

// =============================================================================
// THE ONLY PLACE A FOUNDER SEES WHAT THEY AUTHORISED SHOULD SAY WHAT IT IS.
//
// Two different capabilities reach the same governed email boundary: a reply to
// a customer who wrote in, and a notice the founder wrote to somebody who did
// not. "Written, not sent" shows a notice until it is planned, and then drops
// it — deliberately, so nobody is invited to send the same words twice. From
// that moment the founder's only view of it is the letter's "Bounded help"
// line.
//
// That line described every authorised effect as a "bounded support reply". A
// dance school that told a teacher their Saturday class needs cover read back
// that Foundry was authorised to help with a support reply — to a customer who
// does not exist, about a message nobody sent. The responsibility title is the
// same for every notice under it, so the line could not distinguish two notices
// to two different people either.
//
// A founder is being asked to trust an authorisation. Naming it wrongly is not
// a cosmetic defect: it is the record of what they permitted.
// =============================================================================

const P = 'bh_dance';
const OWNER = 'bh_owner';
const RESP = 'bh_resp';

beforeAll(async () => {
  await runMigrations();
  await query(`INSERT INTO founders (id,clerk_user_id,email) VALUES (?,'bh_c','o@example.com')`, [OWNER]);
  await query(`INSERT INTO products (id,name,owner_id) VALUES (?,'Fold Street Dance',?)`, [P, OWNER]);
  await query(
    `INSERT INTO signal_events (id,product_id,source,event_type,severity,payload_json,summary)
     VALUES ('bh_sig',?,'repository','development_need_observed','low','{}','seed')`, [P]);
  await query(
    `INSERT INTO institutional_responsibilities (id,product_id,title,capability,state,discovery_evidence_ref)
     VALUES (?,?,'Every timetabled class has a teacher','operations','shadowing','signal_event:bh_sig')`,
    [RESP, P]);
  await query(
    `INSERT INTO autonomy_consents
       (id,founder_id,product_id,capability,from_mode,to_mode,disclosure_version,
        responsibility_id,allowed_scope_json,consequence_boundary,expires_at)
     VALUES ('bh_consent',?,?,'operations','suggest','act','v1',?,?, 'low',datetime('now','+1 day'))`,
    [OWNER, P, RESP, JSON.stringify([RESPONSIBILITY_NOTICE_SCOPE])]);
  await moveResponsibilityTo(RESP, 'assisting',
    { productId: P, authorityRef: 'autonomy_consent:bh_consent' });
});

describe('the bounded-help line', () => {
  it('calls a founder-authored notice a notice, and says who it goes to', async () => {
    const written = await proposeResponsibilityNotice({
      productId: P, founderId: OWNER, responsibilityId: RESP,
      recipient: 'teacher@example.com', subject: 'Saturday 10am needs cover',
      body: 'Marta is off on Saturday — can you take the 10am?',
    });
    expect('notice' in written).toBe(true);
    const noticeId = (written as { notice: { id: string } }).notice.id;

    expect(await planResponsibilityNotice({ productId: P, founderId: OWNER, noticeId }))
      .toMatchObject({ duplicate: false });

    const activity = await getFounderAssistingActivity(P);
    expect(activity).toHaveLength(1);
    const detail = activity[0].detail;

    // Nobody wrote in. Calling this a support reply misdescribes what the
    // founder permitted.
    expect(detail).not.toContain('support reply');
    // Two notices under one responsibility are told apart by the person, not
    // the title — so the person has to be in the line.
    expect(detail).toContain('teacher@example.com');
    expect(detail).toContain('not yet performed');
  });
});
