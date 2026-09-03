process.env.TURSO_DATABASE_URL = 'file::memory:';
process.env.ENCRYPTION_KEY = '0'.repeat(64);
process.env.FOUNDRY_INSTANCE_POSTURE = 'private_owner';
process.env.FOUNDRY_OWNER_EMAIL = 'owner@example.com';

import { beforeAll, describe, expect, it } from 'vitest';
import { runMigrations } from '../../src/db/migrate.js';
import { query } from '../../src/db/client.js';
import { consequenceAllows, rungOfTool } from '../../src/services/institution/consequence.js';
import {
  capability, noteNeed, recordMaturity, whatItWouldTake,
} from '../../src/services/institution/capabilities.js';
import {
  fingerprint, proposeAct, decideProposedAct, setAllowance, setBoundary,
} from '../../src/services/institution/standing-intent.js';

// =============================================================================
// ABILITY DOES NOT IMPLY AUTHORITY.
//
// Capability answers "can Foundry do this, with what, how proven?" Authority
// answers "may it, here, on what rung, under what policy?" Kept apart so that
// capability can be broad and authority precise. Consequence determines
// governance: one ladder, whatever the interface, and two rungs the owner
// keeps forever.
// =============================================================================

const OWNER = 'cap_owner';
const REAL = 'cap_real';

beforeAll(async () => {
  await runMigrations();
  await query('INSERT INTO founders (id,clerk_user_id,email,name) VALUES (?,?,?,?)',
    [OWNER, 'clerk_cap', 'owner@example.com', 'Owner']);
  await query(`INSERT INTO products (id, name, owner_id, status, ingest_token)
    VALUES (?, 'Real Co', ?, 'active', 'tok_cap')`, [REAL, OWNER]);
});

describe('every tool at the door stands on a rung', () => {
  it('binds the tools that exist today to what they mean', async () => {
    expect((await rungOfTool('send_email'))?.rung).toBe('public');
    expect((await rungOfTool('github_create_pr'))?.rung).toBe('prepare');
    expect((await rungOfTool('stripe_create_refund'))?.rung).toBe('financial');
    expect((await rungOfTool('stripe_update_subscription'))?.rung).toBe('financial');
  });

  it('refuses a tool nothing has classified', async () => {
    const verdict = await consequenceAllows({
      productId: REAL, tool: 'launch_the_missiles', paramsFingerprint: null });
    expect(verdict.allowed).toBe(false);
    expect(verdict.reason).toContain('nothing says what consequence');
  });

  it('lets a draft through: a pull request is a proposal, not a change', async () => {
    const verdict = await consequenceAllows({
      productId: REAL, tool: 'github_create_pr', paramsFingerprint: null });
    expect(verdict.allowed).toBe(true);
    expect(verdict.rung).toBe('prepare');
  });
});

describe('money takes an allowance or an exact approval', () => {
  it('refuses a refund with neither', async () => {
    const verdict = await consequenceAllows({
      productId: REAL, tool: 'stripe_create_refund', paramsFingerprint: fingerprint({ a: 1 }) });
    expect(verdict.allowed).toBe(false);
    expect(verdict.reason).toContain('neither allowed money');
  });

  it('lets it through inside what he allowed', async () => {
    await setAllowance({ productId: REAL, statement: 'Spend up to $20 on this',
      amountCents: 2_000, purpose: 'refunds' });
    const verdict = await consequenceAllows({
      productId: REAL, tool: 'stripe_create_refund', paramsFingerprint: fingerprint({ a: 1 }) });
    expect(verdict.allowed).toBe(true);
    expect(verdict.reason).toContain('within what you allowed');
  });
});

describe('two rungs are never absorbed', () => {
  it('says so in the constitution table', async () => {
    const rows = (await query(
      `SELECT rung FROM consequence_rungs WHERE absorbable = 0 ORDER BY sort_order`, []))
      .rows as unknown as Array<Record<string, unknown>>;
    expect(rows.map((r) => String(r.rung))).toEqual(['legal', 'destructive']);
  });

  it('a legal act proceeds only on an exact approval, allowance or not', async () => {
    // Bind a hypothetical door tool to a legal capability, the way a future
    // contract-signing adapter would be registered.
    await query(
      `INSERT INTO capability_providers (id, capability_key, provider, how, tool, cost_note, maturity)
       VALUES ('cp_test_sign', 'sign_contract', 'test', 'api', 'sign_contract_test', 'nothing', 'available')`);
    const params = { counterparty: 'Acme', terms: 'net 30' };
    const none = await consequenceAllows({
      productId: REAL, tool: 'sign_contract_test', paramsFingerprint: fingerprint(params) });
    // The $20 allowance above changes nothing here.
    expect(none.allowed).toBe(false);
    expect(none.reason).toContain('yours to decide each time');

    await setBoundary({ productId: REAL, subject: 'move_money', mode: 'ask_first',
      statement: 'Ask me before committing to anything' });
    const id = await proposeAct({
      productId: REAL, subject: 'move_money', actionType: 'sign_contract_test', params,
      summary: 'sign with Acme', why: 'terms agreed', expectedEffect: 'a supplier',
      risk: 'low', consequence: 'high', proposedBy: 'foundry' });
    await decideProposedAct({ id, decision: 'approved', decidedBy: `founder:${OWNER}` });
    const once = await consequenceAllows({
      productId: REAL, tool: 'sign_contract_test', paramsFingerprint: fingerprint(params) });
    expect(once.allowed).toBe(true);
    // Spent. The same act again is refused.
    const again = await consequenceAllows({
      productId: REAL, tool: 'sign_contract_test', paramsFingerprint: fingerprint(params) });
    expect(again.allowed).toBe(false);
  });
});

describe('maturity is earned and witnessed', () => {
  it('nothing arrives proven', async () => {
    await expect(query(
      `INSERT INTO capability_providers (id, capability_key, provider, how, cost_note, maturity)
       VALUES ('cp_bad', 'read_reviews', 'magic', 'api', 'nothing', 'reality_proven')`))
      .rejects.toThrow(/cannot_arrive_proven/);
  });

  it('cannot be set directly, only witnessed', async () => {
    await expect(query(
      `UPDATE capability_providers SET maturity = 'reliable' WHERE id = 'cp_send_email_resend'`))
      .rejects.toThrow(/maturity_must_be_witnessed/);
  });

  it('refuses reality-proven on rehearsal evidence', async () => {
    await expect(recordMaturity({
      providerId: 'cp_send_email_resend', to: 'reality_proven',
      evidence: 'the reference company sent one', evidenceMode: 'reference',
      witnessedBy: 'the harness' })).rejects.toThrow(/reality_proven_needs_real_evidence/);
  });

  it('moves with real evidence and a name', async () => {
    await recordMaturity({
      providerId: 'cp_send_email_resend', to: 'controlled_proven',
      evidence: 'the reference world sent through the door and was refused at the world',
      evidenceMode: 'reference', witnessedBy: 'exercise-the-institution' });
    await recordMaturity({
      providerId: 'cp_send_email_resend', to: 'reality_proven',
      evidence: 'delivery receipt for a real trial-ended notice', evidenceMode: 'real',
      witnessedBy: `founder:${OWNER}` });
    const c = await capability('send_email');
    expect(c?.best?.maturity).toBe('reality_proven');
  });
});

describe('what a piece of work would take', () => {
  it('says met, acquirable, missing, or yours - in one sentence each', async () => {
    await noteNeed({ founderId: OWNER, subjectKind: 'company', subjectId: REAL,
      capabilityKey: 'send_email', why: 'to tell customers about a failed payment' });
    await noteNeed({ founderId: OWNER, subjectKind: 'company', subjectId: REAL,
      capabilityKey: 'create_workspace', why: 'to build the fix somewhere isolated' });
    await noteNeed({ founderId: OWNER, subjectKind: 'company', subjectId: REAL,
      capabilityKey: 'run_survey', why: 'to ask why they left' });
    await noteNeed({ founderId: OWNER, subjectKind: 'company', subjectId: REAL,
      capabilityKey: 'license_data', why: 'to use the register data' });
    const needs = await whatItWouldTake({ subjectKind: 'company', subjectId: REAL });
    const by = new Map(needs.map((n) => [n.capability.key, n]));
    expect(by.get('send_email')?.standing).toBe('met');
    expect(by.get('create_workspace')?.standing).toBe('acquirable');
    expect(by.get('create_workspace')?.sentence).toContain('would need proving first');
    expect(by.get('run_survey')?.standing).toBe('missing');
    expect(by.get('run_survey')?.routes[0]).toContain('research source');
    expect(by.get('license_data')?.standing).toBe('owner');
    expect(by.get('license_data')?.sentence).toContain('yours each time');
  });
});
