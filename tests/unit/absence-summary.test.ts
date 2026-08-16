import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { executeRaw, query } from '../../src/db/client.js';
import { splitSqlStatements } from '../../src/db/migrate.js';
import { createResponsibility, setResponsibilityDisposition, transitionResponsibility, type ResponsibilityState } from '../../src/services/institution/responsibility.js';
import { getSevenDayResponsibilitySummary } from '../../src/services/institution/absence-summary.js';


// Minimal stand-ins for the canonical ledgers this view reads. They exist so
// the seven-day view can be driven through states the real triggers forbid —
// Operating is frozen by migration 115, and the demotion case below needs it.
//
// They must carry every column the view actually reads, or the view fails here
// for a reason that has nothing to do with what is being tested. Columns from
// migrations 112 (responsibility-bound authority) and 114 (assisted execution)
// are included for exactly that reason.
async function setupCanonicalLedgers() {
  await query('CREATE TABLE IF NOT EXISTS products (id TEXT PRIMARY KEY, name TEXT, owner_id TEXT NOT NULL)');
  await query('CREATE TABLE IF NOT EXISTS signal_events (id TEXT PRIMARY KEY, product_id TEXT NOT NULL)');
  await query(`CREATE TABLE IF NOT EXISTS autonomy_consents (id TEXT PRIMARY KEY, founder_id TEXT,
    product_id TEXT NOT NULL, capability TEXT NOT NULL, from_mode TEXT, to_mode TEXT NOT NULL,
    disclosure_version TEXT, accepted_at DATETIME DEFAULT CURRENT_TIMESTAMP, revoked_at TEXT,
    responsibility_id TEXT, allowed_scope_json TEXT, consequence_boundary TEXT, expires_at TEXT)`);
  await query(`CREATE TABLE IF NOT EXISTS outbound_actions (id TEXT PRIMARY KEY, product_id TEXT NOT NULL,
    responsibility_id TEXT, status TEXT NOT NULL, outcome_status TEXT)`);
  await query('CREATE TABLE IF NOT EXISTS action_executions (id TEXT PRIMARY KEY, product_id TEXT NOT NULL, action_type TEXT, integration TEXT, payload_json TEXT, status TEXT, verify_status TEXT)');
  await query("INSERT OR IGNORE INTO products (id,name,owner_id) VALUES ('p1','P1','f1'),('p2','P2','f2')");
  await query("INSERT OR IGNORE INTO signal_events (id,product_id) VALUES ('sig1','p1'),('sig_other','p2')");
  await query("INSERT OR IGNORE INTO autonomy_consents (id,founder_id,product_id,capability,from_mode,to_mode,disclosure_version) VALUES ('cons1','f1','p1','general','suggest','act','v1'),('cons_other','f2','p2','general','suggest','act','v1')");
  await query("INSERT OR IGNORE INTO action_executions (id,product_id,action_type,integration,payload_json,status,verify_status) VALUES ('out1','p1','test','test','{}','completed','passed'),('out_other','p2','test','test','{}','completed','passed'),('out_unverified','p1','test','test','{}','completed','pending')");
}

beforeAll(async () => {
  await setupCanonicalLedgers();
  for (const file of ['102_responsibility_transfer.sql','103_responsibility_disposition.sql','104_responsibility_reference_provenance.sql'])
    for (const sql of splitSqlStatements(readFileSync(resolve(__dirname, `../../src/db/migrations/${file}`), 'utf8'))) await query(sql);
});
beforeEach(async () => {
  await executeRaw('DELETE FROM responsibility_dispositions;\nDELETE FROM responsibility_transitions;\nDELETE FROM institutional_responsibilities;\n'
    + 'DELETE FROM autonomy_consents WHERE responsibility_id IS NOT NULL;\nDELETE FROM outbound_actions;');
});

/** A responsibility-bound grant, as migration 112 shapes them. */
async function grant(
  responsibilityId: string,
  opts: { expiresInDays: number; revoked?: boolean; acceptedDaysAgo?: number },
) {
  await query(
    `INSERT INTO autonomy_consents (id,founder_id,product_id,capability,from_mode,to_mode,disclosure_version,
       accepted_at,revoked_at,responsibility_id,allowed_scope_json,consequence_boundary,expires_at)
     VALUES (?, 'f1','p1','general','suggest','act','v1', datetime('now', ?), ?, ?, '["reply"]','low', datetime('now', ?))`,
    [`grant_${responsibilityId}_${opts.expiresInDays}_${opts.revoked ? 'rev' : 'live'}`,
      `-${opts.acceptedDaysAgo ?? 0} days`, opts.revoked ? new Date().toISOString() : null,
      responsibilityId, `${opts.expiresInDays} days`],
  );
}

async function advance(title: string, target: ResponsibilityState) {
  let r = await createResponsibility({ productId:'p1', title, capability:'general' });
  const states: ResponsibilityState[] = ['visible','understood','shadowing','assisting','operating','mature','exception_owned'];
  let from: ResponsibilityState = 'unknown';
  for (const to of states) {
    if (states.indexOf(to) > states.indexOf(target)) break;
    r = await transitionResponsibility({ productId:'p1', responsibilityId:r.id, from, to,
      evidenceRef:'signal_event:sig1', authorityRef: ['assisting','operating','mature','exception_owned'].includes(to) ? 'autonomy_consent:cons1' : undefined,
      outcomeRef: ['mature','exception_owned'].includes(to) ? 'action_execution:out1' : undefined,
      reason:`advance ${to}`, actorRef:'owner:f1' });
    from = to;
  }
  return r;
}

describe('seven-day responsibility summary', () => {
  it('classifies only outcome-bearing maturity as HANDLED', async () => {
    await advance('Reconcile billing', 'mature');
    const summary = await getSevenDayResponsibilitySummary('p1');
    expect(summary.HANDLED).toMatchObject([{ title:'Reconcile billing', outcomeRef:'action_execution:out1' }]);
  });

  it('surfaces shadowing as NEEDS_YOU because authority cannot be inferred', async () => {
    await advance('Reply to customers', 'shadowing');
    const summary = await getSevenDayResponsibilitySummary('p1');
    expect(summary.NEEDS_YOU).toMatchObject([{ title:'Reply to customers', authorityRef:null }]);
  });

  it('reports recent movement as CHANGED and stable unknown work as STILL_OPEN', async () => {
    await advance('Publish metrics', 'visible');
    await createResponsibility({ productId:'p1', title:'Unknown operational owner', capability:'general' });
    const summary = await getSevenDayResponsibilitySummary('p1');
    expect(summary.CHANGED.map((x) => x.title)).toContain('Publish metrics');
    expect(summary.STILL_OPEN.map((x) => x.title)).toContain('Unknown operational owner');
  });

  it('never invents DELIBERATELY_NOT_DONE from absence or demotion', async () => {
    const r = await advance('Run campaign', 'operating');
    await transitionResponsibility({ productId:'p1', responsibilityId:r.id, from:'operating', to:'visible', evidenceRef:'signal_event:sig1', reason:'owner paused it', actorRef:'owner:f1' });
    const summary = await getSevenDayResponsibilitySummary('p1');
    expect(summary.DELIBERATELY_NOT_DONE).toEqual([]);
    expect(summary.CHANGED[0]).toMatchObject({ title:'Run campaign', state:'visible' });
  });

  it('does not repeat old mature work as newly handled', async () => {
    const r = await advance('Close books', 'mature');
    await query("UPDATE responsibility_transitions SET created_at=datetime('now','-8 days') WHERE responsibility_id=?", [r.id]);
    const summary = await getSevenDayResponsibilitySummary('p1');
    expect(summary.HANDLED).toEqual([]);
    expect(summary.STILL_OPEN).toEqual([]);
  });
  it('includes deliberate non-action only after an explicit product owner decision', async () => {
    const r = await createResponsibility({ productId:'p1', title:'Launch paid campaign', capability:'general' });
    await expect(setResponsibilityDisposition({ productId:'p1', responsibilityId:r.id, ownerId:'attacker', disposition:'deliberately_not_done', reason:'no', evidenceRef:'signal_event:sig1' })).rejects.toThrow(/not_found/);
    await setResponsibilityDisposition({ productId:'p1', responsibilityId:r.id, ownerId:'f1', disposition:'deliberately_not_done', reason:'CAC evidence is insufficient', evidenceRef:'signal_event:sig1' });
    const summary = await getSevenDayResponsibilitySummary('p1');
    expect(summary.DELIBERATELY_NOT_DONE).toMatchObject([{ title:'Launch paid campaign', reason:'CAC evidence is insufficient' }]);
    expect(summary.STILL_OPEN).toEqual([]);
  });

  // ===========================================================================
  // A founder returning after a week needs more than "this needs you". Four
  // different situations produce that heading, and the difference between them
  // is the difference between one click and an hour of investigation.
  // ===========================================================================

  it('distinguishes watching from being unable to act', async () => {
    const watched = await advance('Reply to customers', 'shadowing');
    const assisting = await advance('Chase failed payments', 'assisting');
    await grant(assisting.id, { expiresInDays: 30 });

    const summary = await getSevenDayResponsibilitySummary('p1');
    expect(summary.NEEDS_YOU).toMatchObject([{ responsibilityId: watched.id, needsYouBecause: 'watching' }]);
    // Live authority is not a reason to interrupt the founder.
    expect(summary.CHANGED.map((x) => x.responsibilityId)).toContain(assisting.id);
  });

  it('reports withdrawn permission as a decision the founder made', async () => {
    const r = await advance('Chase failed payments', 'assisting');
    await grant(r.id, { expiresInDays: 30, revoked: true });

    const summary = await getSevenDayResponsibilitySummary('p1');
    expect(summary.NEEDS_YOU).toMatchObject([{ responsibilityId: r.id, needsYouBecause: 'permission_withdrawn' }]);
    // Revocation is not demotion: the responsibility is still Assisting, and
    // Foundry has not forgotten how to do it.
    expect(summary.NEEDS_YOU[0].state).toBe('assisting');
  });

  it('reports lapsed permission as expiry, not as a withdrawal the founder never made', async () => {
    const r = await advance('Chase failed payments', 'assisting');
    await grant(r.id, { expiresInDays: -1 });

    const summary = await getSevenDayResponsibilitySummary('p1');
    expect(summary.NEEDS_YOU).toMatchObject([{ responsibilityId: r.id, needsYouBecause: 'permission_expired' }]);
  });

  it('does not blame a founder for a revocation they deliberately reversed', async () => {
    // Revoked, re-granted, then allowed to lapse. Only the most recent grant
    // describes the current situation — reporting "you turned this off" would
    // ask the founder to re-examine a decision they already changed their mind
    // about, which is exactly the kind of wrong nudge that erodes trust.
    const r = await advance('Chase failed payments', 'assisting');
    await grant(r.id, { expiresInDays: 30, revoked: true, acceptedDaysAgo: 5 });
    await grant(r.id, { expiresInDays: -1, acceptedDaysAgo: 2 });

    const summary = await getSevenDayResponsibilitySummary('p1');
    expect(summary.NEEDS_YOU).toMatchObject([{ responsibilityId: r.id, needsYouBecause: 'permission_expired' }]);
  });

  it('never reports work as HANDLED while its effect has an unresolved outcome', async () => {
    // The whole point of the receipt/outcome separation, at the surface the
    // founder actually reads. Provider acceptance is not the customer's
    // problem being solved, and a week of silence is not success.
    const r = await advance('Close books', 'mature');
    await query(
      `INSERT INTO outbound_actions (id,product_id,responsibility_id,status,outcome_status)
       VALUES ('act_pending','p1',?, 'executed', NULL)`, [r.id]);

    const summary = await getSevenDayResponsibilitySummary('p1');
    expect(summary.HANDLED).toEqual([]);
    expect(summary.NEEDS_YOU).toMatchObject([{ responsibilityId: r.id, needsYouBecause: 'outcome_unresolved' }]);
  });

  it('reports HANDLED once the outcome is independently established', async () => {
    const r = await advance('Close books', 'mature');
    await query(
      `INSERT INTO outbound_actions (id,product_id,responsibility_id,status,outcome_status)
       VALUES ('act_resolved','p1',?, 'executed', 'resolved')`, [r.id]);

    const summary = await getSevenDayResponsibilitySummary('p1');
    expect(summary.HANDLED).toMatchObject([{ responsibilityId: r.id }]);
    expect(summary.HANDLED[0].needsYouBecause).toBeUndefined();
  });

  it('does not let an old unresolved effect resurrect stale mature work', async () => {
    // An unresolved outcome makes something not-handled; it must not also make
    // week-old finished work reappear as new.
    const r = await advance('Close books', 'mature');
    await query("UPDATE responsibility_transitions SET created_at=datetime('now','-8 days') WHERE responsibility_id=?", [r.id]);
    await query(
      `INSERT INTO outbound_actions (id,product_id,responsibility_id,status,outcome_status)
       VALUES ('act_old','p1',?, 'executed', NULL)`, [r.id]);

    const summary = await getSevenDayResponsibilitySummary('p1');
    expect(summary.HANDLED).toEqual([]);
    // It is genuinely unresolved, so it is surfaced — but as something needing
    // the founder, never as something Foundry finished.
    expect(summary.NEEDS_YOU).toMatchObject([{ responsibilityId: r.id, needsYouBecause: 'outcome_unresolved' }]);
  });

  it('every reason the classifier can produce has founder-facing words, in no ontology', async () => {
    // The failure this catches: someone adds a classification here and the
    // founder sees "this needs you" with no explanation — the exact silence
    // the seven-day view exists to remove. The classifier and the copy must
    // stay in lockstep, so both directions are asserted.
    const source = readFileSync(resolve(__dirname, '../../src/routes/dashboard/letter.ts'), 'utf8');
    const copyKeys = new Set([...source.matchAll(/^  (\w+): "/gm)].map((m) => m[1]));
    const service = readFileSync(resolve(__dirname, '../../src/services/institution/absence-summary.ts'), 'utf8');
    const classifications = new Set(
      [...service.matchAll(/'(watching|permission_withdrawn|permission_expired|outcome_unresolved)'/g)].map((m) => m[1]));

    expect(classifications.size).toBe(4);
    for (const c of classifications) expect(copyKeys, `${c} has no founder-facing line`).toContain(c);

    // And the words themselves must be the founder's, not the institution's.
    const copy = [...source.matchAll(/^  \w+: "([^"]+)"/gm)].map((m) => m[1]).join(' ').toLowerCase();
    for (const term of ['responsibility', 'authority', 'consent', 'assisting', 'shadowing',
      'institutional', 'evidence', 'provenance', 'revocation', 'outcome_status']) {
      expect(copy, `founder copy leaks institutional vocabulary: ${term}`).not.toContain(term);
    }
  });
});
