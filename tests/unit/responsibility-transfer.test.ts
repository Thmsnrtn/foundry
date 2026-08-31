import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { executeRaw, query } from '../../src/db/client.js';
import { splitSqlStatements } from '../../src/db/migrate.js';
import { createResponsibility, transitionResponsibility } from '../../src/services/institution/responsibility.js';


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

beforeAll(async () => { await setupCanonicalLedgers(); for (const file of ['102_responsibility_transfer.sql','103_responsibility_disposition.sql','104_responsibility_reference_provenance.sql','105_responsibility_discovery.sql']) for (const sql of splitSqlStatements(readFileSync(resolve(__dirname, `../../src/db/migrations/${file}`), 'utf8'))) await query(sql); });
beforeEach(async () => executeRaw('DELETE FROM responsibility_transitions;\nDELETE FROM institutional_responsibilities;'));

const step = (id: string, from: Parameters<typeof transitionResponsibility>[0]['from'], to: Parameters<typeof transitionResponsibility>[0]['to'], extra: Record<string,string> = {}) =>
  transitionResponsibility({ productId: 'p1', responsibilityId: id, from, to, evidenceRef: 'signal_event:sig1', reason: `prove ${to}`, actorRef: 'owner:f1', ...extra });

describe('responsibility transfer truth', () => {
  it('starts unknown and advances one evidence-bearing rung at a time', async () => {
    let r = await createResponsibility({ productId: 'p1', title: '  Reconcile customer billing  ', capability:'general', discoveryEvidenceRef:'signal_event:sig1' });
    expect(r).toMatchObject({ title: 'Reconcile customer billing', state: 'unknown', authorityRef: null });
    r = await step(r.id, 'unknown', 'visible');
    r = await step(r.id, 'visible', 'understood');
    r = await step(r.id, 'understood', 'shadowing');
    r = await step(r.id, 'shadowing', 'assisting', { authorityRef: 'autonomy_consent:cons1' });
    r = await step(r.id, 'assisting', 'operating', { authorityRef: 'autonomy_consent:cons1' });
    r = await step(r.id, 'operating', 'mature', { authorityRef: 'autonomy_consent:cons1', outcomeRef: 'action_execution:out1' });
    r = await step(r.id, 'mature', 'exception_owned', { authorityRef: 'autonomy_consent:cons1', outcomeRef: 'action_execution:out1' });
    expect(r).toMatchObject({ state: 'exception_owned', authorityRef: 'autonomy_consent:cons1', outcomeRef: 'action_execution:out1' });
    expect(Number(((await query('SELECT COUNT(*) n FROM responsibility_transitions')).rows[0] as Record<string,number>).n)).toBe(7);
  });

  it('refuses skipped promotions and promotion without evidence, authority, or outcome', async () => {
    const r = await createResponsibility({ productId: 'p1', title: 'Close support loops', capability:'general', discoveryEvidenceRef:'signal_event:sig1' });
    await expect(step(r.id, 'unknown', 'understood')).rejects.toThrow(/cannot_skip/);
    await expect(transitionResponsibility({ productId:'p1', responsibilityId:r.id, from:'unknown', to:'visible', reason:'seen', actorRef:'owner' })).rejects.toThrow(/evidence_required/);
    await step(r.id, 'unknown', 'visible'); await step(r.id, 'visible', 'understood'); await step(r.id, 'understood', 'shadowing');
    await expect(step(r.id, 'shadowing', 'assisting')).rejects.toThrow(/authority_required/);
    await step(r.id, 'shadowing', 'assisting', { authorityRef:'autonomy_consent:cons1' }); await step(r.id, 'assisting', 'operating', { authorityRef:'autonomy_consent:cons1' });
    await expect(step(r.id, 'operating', 'mature', { authorityRef:'autonomy_consent:cons1' })).rejects.toThrow(/outcome_required/);
  });

  it('allows explicit demotion, clears authority, and rejects stale concurrent transitions', async () => {
    let r = await createResponsibility({ productId: 'p1', title: 'Publish weekly report', capability:'general', discoveryEvidenceRef:'signal_event:sig1' });
    r = await step(r.id, 'unknown', 'visible'); r = await step(r.id, 'visible', 'understood');
    r = await step(r.id, 'understood', 'shadowing'); r = await step(r.id, 'shadowing', 'assisting', { authorityRef:'autonomy_consent:cons1' });
    const stale = transitionResponsibility({ productId:'p1', responsibilityId:r.id, from:'assisting', to:'operating', evidenceRef:'signal_event:sig1', authorityRef:'autonomy_consent:cons1', reason:'first', actorRef:'system' });
    const competing = transitionResponsibility({ productId:'p1', responsibilityId:r.id, from:'assisting', to:'operating', evidenceRef:'signal_event:sig1', authorityRef:'autonomy_consent:cons1', reason:'second', actorRef:'system' });
    const results = await Promise.allSettled([stale, competing]);
    expect(results.filter((x) => x.status === 'fulfilled')).toHaveLength(1);
    r = await transitionResponsibility({ productId:'p1', responsibilityId:r.id, from:'operating', to:'visible', evidenceRef:'signal_event:sig1', reason:'authority withdrawn', actorRef:'owner' });
    expect(r).toMatchObject({ state:'visible', authorityRef:null, outcomeRef:null });
  });

  // A RESPONSIBILITY MAY NOT APPEAR FROM NOWHERE. This constructor used to
  // insert with no `discovery_evidence_ref` at all, so an institutional
  // obligation could exist with nothing to point at when a founder asks why
  // Foundry thinks their company owes it. The reference is checked against a
  // real signal of this company, not trusted as a string — a TypeScript
  // parameter is erased at runtime and would refuse nothing.
  it('refuses a responsibility whose discovery evidence names nothing real', async () => {
    for (const ref of ['', 'not-a-reference', 'autonomy_consent:cons1', 'signal_event:missing']) {
      await expect(createResponsibility({
        productId: 'p1', title: 'Appeared from nowhere', capability: 'general',
        discoveryEvidenceRef: ref,
      })).rejects.toThrow(/discovery evidence/);
    }
    // Another company's observation is not this company's evidence.
    await expect(createResponsibility({
      productId: 'p1', title: 'Borrowed provenance', capability: 'general',
      discoveryEvidenceRef: 'signal_event:sig_other',
    })).rejects.toThrow(/no signal of this company/);
    expect(Number(((await query(
      'SELECT COUNT(*) n FROM institutional_responsibilities')).rows[0] as Record<string,number>).n)).toBe(0);
  });

  it('never crosses product boundaries', async () => {
    const r = await createResponsibility({ productId:'p1', title:'Protect tenant truth', capability:'general', discoveryEvidenceRef:'signal_event:sig1' });
    await expect(transitionResponsibility({ productId:'p2', responsibilityId:r.id, from:'unknown', to:'visible', evidenceRef:'signal_event:sig1', reason:'attack', actorRef:'caller' })).rejects.toThrow(/not found/);
  });

  it('rejects fabricated, cross-tenant, stale, wrong-kind, and immature references', async () => {
    const r = await createResponsibility({ productId:'p1', title:'Ground every claim', capability:'general', discoveryEvidenceRef:'signal_event:sig1' });
    for (const evidenceRef of ['signal_event:missing', 'signal_event:sig_other', 'autonomy_consent:cons1']) {
      await expect(transitionResponsibility({ productId:'p1', responsibilityId:r.id, from:'unknown', to:'visible', evidenceRef, reason:'attack', actorRef:'caller' })).rejects.toThrow(/evidence_invalid/);
    }
    await step(r.id, 'unknown', 'visible'); await step(r.id, 'visible', 'understood'); await step(r.id, 'understood', 'shadowing');
    await expect(step(r.id, 'shadowing', 'assisting', { authorityRef:'autonomy_consent:cons_other' })).rejects.toThrow(/authority_invalid/);
    await query("UPDATE autonomy_consents SET revoked_at=CURRENT_TIMESTAMP WHERE id='cons1'");
    await expect(step(r.id, 'shadowing', 'assisting', { authorityRef:'autonomy_consent:cons1' })).rejects.toThrow(/authority_invalid/);
    await query("UPDATE autonomy_consents SET revoked_at=NULL WHERE id='cons1'");
    await step(r.id, 'shadowing', 'assisting', { authorityRef:'autonomy_consent:cons1' });
    await step(r.id, 'assisting', 'operating', { authorityRef:'autonomy_consent:cons1' });
    await expect(step(r.id, 'operating', 'mature', { authorityRef:'autonomy_consent:cons1', outcomeRef:'action_execution:out_other' })).rejects.toThrow(/outcome_invalid/);
    await expect(step(r.id, 'operating', 'mature', { authorityRef:'autonomy_consent:cons1', outcomeRef:'action_execution:out_unverified' })).rejects.toThrow(/outcome_invalid/);
  });
});
