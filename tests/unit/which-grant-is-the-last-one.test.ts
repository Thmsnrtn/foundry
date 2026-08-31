process.env.TURSO_DATABASE_URL = 'file::memory:';

import { beforeAll, describe, expect, it } from 'vitest';
import { runMigrations } from '../../src/db/migrate.js';
import { query } from '../../src/db/client.js';
import { getSevenDayResponsibilitySummary } from '../../src/services/institution/absence-summary.js';
import { grantAuthority, moveResponsibilityTo } from '../fixtures/responsibility-state.js';

// =============================================================================
// WHICH PERMISSION IS THE CURRENT ONE MUST NOT DEPEND ON A NANOID.
//
// The seven-day view tells a founder when a permission has been withdrawn. It
// works out the latest grant per responsibility with
// `ORDER BY accepted_at DESC, id DESC` and takes the first row — a single
// winner, decided by the tiebreak whenever two consents share a timestamp.
// `accepted_at` is second-granular and consent ids are nanoids, so a founder
// who revoked a permission and immediately granted a new one had the answer
// decided by which random id sorted higher.
//
// The same defect as ordering reconstruction claims by claim id, and as
// ordering reply proposals by their content hash. Third time in one campaign,
// in a third module. Ties break on insertion order.
// =============================================================================

const P = 'lg_product';
const OWNER = 'lg_owner';
const RESP = 'lg_resp';

beforeAll(async () => {
  await runMigrations();
  await query(`INSERT INTO founders (id,clerk_user_id,email) VALUES (?,'lg_c','o@example.com')`, [OWNER]);
  await query(`INSERT INTO products (id,name,owner_id,status) VALUES (?,'Fold Street Dance',?,'active')`, [P, OWNER]);
  await query(
    `INSERT INTO signal_events (id,product_id,source,event_type,severity,payload_json,summary)
     VALUES ('lg_sig',?,'repository','development_need_observed','low','{}','seed')`, [P]);
  await query(
    `INSERT INTO institutional_responsibilities (id,product_id,title,capability,state,discovery_evidence_ref)
     VALUES (?,?,'Every timetabled class has a teacher','operations','shadowing','signal_event:lg_sig')`,
    [RESP, P]);

  // The ladder's own grant, pushed back in time so it takes no part in the
  // contest below: what is being tested is which of two SAME-SECOND consents
  // counts as the last one.
  await moveResponsibilityTo(RESP, 'assisting',
    { productId: P, authorityRef: await grantAuthority(P, OWNER, 'operations', RESP) });
  await query(
    `UPDATE autonomy_consents SET accepted_at=datetime('now','-1 hour'),
       expires_at=datetime('now','-30 minutes')
      WHERE product_id=? AND responsibility_id=?`, [P, RESP]);

  // Revoked first, then re-granted in the same second. Insertion order is the
  // only honest record of which came last. The ids are chosen so the REVOKED
  // one sorts higher: if the tiebreak is the id, the founder is told their
  // permission is withdrawn when they had just restored it.
  const stamp = "datetime('now')";
  await query(
    `INSERT INTO autonomy_consents
       (id,founder_id,product_id,capability,from_mode,to_mode,disclosure_version,
        responsibility_id,allowed_scope_json,consequence_boundary,accepted_at,expires_at,revoked_at)
     VALUES ('zzz_withdrawn',?,?,'operations','suggest','act','v1',?,'["send_email:responsibility_notice"]','low',${stamp},datetime('now','+1 day'),NULL)`,
    [OWNER, P, RESP]);
  await query(
    `INSERT INTO autonomy_consents
       (id,founder_id,product_id,capability,from_mode,to_mode,disclosure_version,
        responsibility_id,allowed_scope_json,consequence_boundary,accepted_at,expires_at)
     VALUES ('aaa_restored',?,?,'operations','suggest','act','v1',?,'["send_email:responsibility_notice"]','low',${stamp},datetime('now','+1 day'))`,
    [OWNER, P, RESP]);
  // Withdrawn after the fact, which is the only way the ledger allows it: a
  // consent born revoked is refused, and it is right to be.
  await query("UPDATE autonomy_consents SET revoked_at=datetime('now') WHERE id='zzz_withdrawn'");
  // And the restored one has since run out. Foundry's clock ended it, not the
  // founder — which is the whole distinction the view is trying to draw.
  await query("UPDATE autonomy_consents SET expires_at=datetime('now','-1 hour') WHERE id='aaa_restored'");
});

describe('a permission revoked, restored, and then left to run out', () => {
  it('reads as expired, not as the founder taking it away', async () => {
    const summary = await getSevenDayResponsibilitySummary(P);
    const item = [...summary.NEEDS_YOU, ...summary.STILL_OPEN, ...summary.CHANGED,
      ...summary.HANDLED, ...summary.DELIBERATELY_NOT_DONE]
      .find((i) => i.responsibilityId === RESP);
    expect(item, 'the responsibility should appear somewhere in the view').toBeTruthy();
    // The code says it plainly: a responsibility that was revoked, deliberately
    // re-granted, and then allowed to expire was not withdrawn — saying so
    // blames the founder for a decision they reversed.
    expect(item!.needsYouBecause).toBe('permission_expired');
  });
});
