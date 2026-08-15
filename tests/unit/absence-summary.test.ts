import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { executeRaw, query } from '../../src/db/client.js';
import { splitSqlStatements } from '../../src/db/migrate.js';
import { createResponsibility, setResponsibilityDisposition, transitionResponsibility, type ResponsibilityState } from '../../src/services/institution/responsibility.js';
import { getSevenDayResponsibilitySummary } from '../../src/services/institution/absence-summary.js';


async function setupCanonicalLedgers() {
  await query('CREATE TABLE IF NOT EXISTS products (id TEXT PRIMARY KEY, name TEXT, owner_id TEXT NOT NULL)');
  await query('CREATE TABLE IF NOT EXISTS signal_events (id TEXT PRIMARY KEY, product_id TEXT NOT NULL)');
  await query('CREATE TABLE IF NOT EXISTS autonomy_consents (id TEXT PRIMARY KEY, founder_id TEXT, product_id TEXT NOT NULL, capability TEXT NOT NULL, from_mode TEXT, to_mode TEXT NOT NULL, disclosure_version TEXT, revoked_at TEXT)');
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
beforeEach(async () => { await executeRaw('DELETE FROM responsibility_dispositions;\nDELETE FROM responsibility_transitions;\nDELETE FROM institutional_responsibilities;'); });

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

});
