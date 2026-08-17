process.env.TURSO_DATABASE_URL = 'file::memory:';

import { beforeAll, describe, expect, it } from 'vitest';
import { runMigrations } from '../../src/db/migrate.js';
import { query } from '../../src/db/client.js';
import {
  REPORTABLE_OBLIGATIONS, reportCompanyObligation, reportExternalObligation,
} from '../../src/services/founder/company-report.js';

// =============================================================================
// A company's own systems can raise work.
//
// Until now the ladder's first rung was fed by a person or by four SaaS-shaped
// signals, so the more a company had already automated, the less Foundry could
// see. A rota noticing a class has no teacher had no way to say so.
//
// What must stay true: provenance is not laundered. A tool may say what it
// observed; it may not say who said it. And a report is evidence, never
// permission — arriving from a machine makes it neither more nor less true.
// =============================================================================

const P = 'ecr_dance';
const OWNER = 'ecr_owner';

beforeAll(async () => {
  await runMigrations();
  await query(`INSERT INTO founders (id,clerk_user_id,email) VALUES ('${OWNER}','ecr_c','o@example.com')`, []);
  await query(`INSERT INTO products (id,name,owner_id) VALUES ('${P}','Fold Street Dance','${OWNER}')`, []);
});

describe('external company reports', () => {
  it('lets a rota system raise work, at Visible and with nothing granted', async () => {
    const reported = await reportExternalObligation({
      productId: P, reportedBy: 'studio_rota',
      obligationKind: 'exception', what: 'Saturday 10am has no teacher assigned',
    });
    expect(reported!.responsibility).toMatchObject({ state: 'visible', capability: 'operations' });
    expect(reported!.responsibility!.authorityRef).toBeNull();
    expect((await query('SELECT COUNT(*) n FROM autonomy_consents WHERE product_id=?', [P])).rows[0])
      .toMatchObject({ n: 0 });
  });

  it('records who actually said it, and never as the founder', async () => {
    const evidence = (await query(
      `SELECT source,event_type,payload_json FROM signal_events
        WHERE product_id=? AND source='external_company_report'`, [P],
    )).rows[0] as Record<string, unknown>;
    expect(evidence.source).toBe('external_company_report');
    expect(evidence.event_type).toBe('external_reported:exception');
    const payload = JSON.parse(String(evidence.payload_json)) as Record<string, unknown>;
    expect(payload.reported_by).toBe('studio_rota');
    // The distinguishing fact: no founder claim anywhere in it.
    expect(payload.founder_id).toBeUndefined();
  });

  it('refuses a payload that tries to claim a founder', async () => {
    // Identity comes from the credential. A tool holding an ingest token may say
    // what it observed and may not say who said it — otherwise an integration
    // could manufacture the owner's word, which is the one thing in this system
    // that authorises things.
    await expect(query(
      `INSERT INTO signal_events (id,product_id,source,event_type,severity,payload_json,summary)
       VALUES ('ecr_forge',?,'external_company_report','external_reported:exception','medium',
               json_object('obligation_kind','exception','what','x','reported_by','tool',
                           'founder_id','${OWNER}'),'x')`, [P],
    )).rejects.toThrow(/identity_forged/);
  });

  it('accepts only the generic operational vocabulary, and no industry kinds', async () => {
    for (const kind of ['class_cancelled', 'boat_overdue', 'nps_drop', '', 'EXCEPTION']) {
      expect(await reportExternalObligation({
        productId: P, reportedBy: 'tool', obligationKind: kind, what: 'something',
      }), `${kind} must be refused`).toBeNull();
    }
    // The database refuses it too, not only the service.
    await expect(query(
      `INSERT INTO signal_events (id,product_id,source,event_type,severity,payload_json,summary)
       VALUES ('ecr_kind',?,'external_company_report','external_reported:class_cancelled','medium',
               json_object('obligation_kind','class_cancelled','what','x','reported_by','tool'),'x')`, [P],
    )).rejects.toThrow(/kind_invalid/);
  });

  it('refuses an unnamed reporter, empty content, and an oversized description', async () => {
    expect(await reportExternalObligation({
      productId: P, reportedBy: '  ', obligationKind: 'exception', what: 'x' })).toBeNull();
    expect(await reportExternalObligation({
      productId: P, reportedBy: 'tool', obligationKind: 'exception', what: '   ' })).toBeNull();
    expect(await reportExternalObligation({
      productId: P, reportedBy: 'tool', obligationKind: 'exception', what: 'x'.repeat(201) })).toBeNull();
  });

  it('refuses an event type that disagrees with the report it carries', async () => {
    await expect(query(
      `INSERT INTO signal_events (id,product_id,source,event_type,severity,payload_json,summary)
       VALUES ('ecr_mislabel',?,'external_company_report','external_reported:delivery','medium',
               json_object('obligation_kind','exception','what','x','reported_by','tool'),'x')`, [P],
    )).rejects.toThrow(/event_type_mismatch/);
  });

  it('is the same vocabulary the founder uses, so neither path is privileged', async () => {
    // Two sources, one semantics. A machine noticing something is not a
    // different KIND of obligation from a person noticing the same thing.
    const byFounder = await reportCompanyObligation({
      productId: P, founderId: OWNER, obligationKind: 'delivery',
      what: 'Term reports go out by the last Friday',
    });
    const byTool = await reportExternalObligation({
      productId: P, reportedBy: 'reports_job', obligationKind: 'delivery',
      what: 'Term reports go out by the last Friday',
    });
    expect(byFounder!.responsibility!.capability).toBe(byTool!.responsibility!.capability);
    // But they are distinct responsibilities with distinct evidence — one is not
    // silently merged into the other, because two witnesses are not one.
    expect(byFounder!.responsibility!.id).not.toBe(byTool!.responsibility!.id);
    expect(REPORTABLE_OBLIGATIONS).toContain('delivery');
  });

  it('keeps one company\'s reports out of another\'s', async () => {
    await query(`INSERT INTO founders (id,clerk_user_id,email) VALUES ('ecr_o2','ecr_c2','x@example.com')`, []);
    await query(`INSERT INTO products (id,name,owner_id) VALUES ('ecr_other','Other Co','ecr_o2')`, []);
    await reportExternalObligation({
      productId: 'ecr_other', reportedBy: 'their_tool', obligationKind: 'exception', what: 'Their problem',
    });
    const mine = (await query(
      "SELECT COUNT(*) n FROM institutional_responsibilities WHERE product_id=? AND title='Their problem'", [P],
    )).rows[0];
    expect(mine).toMatchObject({ n: 0 });
  });
});
