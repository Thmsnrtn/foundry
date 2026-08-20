process.env.TURSO_DATABASE_URL = 'file::memory:';
process.env.ENCRYPTION_KEY = '0'.repeat(64);

import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { runMigrations } from '../../src/db/migrate.js';
import { query } from '../../src/db/client.js';
import {
  eraseFounderAccount, PERSON_ACROSS_COMPANIES_DISPOSITIONS,
} from '../../src/services/privacy/consent.js';

// =============================================================================
// OWNER DECISION §10, ANSWERED: SPLIT BY KIND.
//
// Five tables sat undecided while every other table in an account erasure was
// settled. Each held a row that is a COMPANY ASSET the company is still running
// on, keyed to a person who is leaving, on a NOT NULL column — so severing was
// not even available. Deleting takes a working capability from a company that
// did nothing wrong; keeping leaves an erased person's identity inside a live
// company, which is what an erasure exists to prevent.
//
// The owner's answer is that AUTHORITY and ARTEFACT are different things:
//
//   AUTHORITY (api_keys, mcp_grants) is REVOKED and never transferred. An
//   authority held by a principal that no longer exists must not act, and
//   handing it to the company owner would be inventing a grant nobody made.
//
//   ARTEFACT (webhooks, deal_rooms, decision_votes) is PRESERVED and its author
//   SEVERED. The company authored the work and keeps it. NULL says NOBODY;
//   another founder's id would say somebody who did not do it, and authorship
//   is not reassigned.
//
// Migration 175 made the three artefact columns nullable, which is the whole
// reason this was blocked: not indecision, an absent column state.
//
// THE COST OF REVOKING WAS NAMED WHEN THE CHOICE WAS MADE — a credential stops
// working in a company that did nothing wrong. What makes that acceptable is
// that it is visible: each revocation lands in the company's own audit trail,
// naming no person, because naming one would undo the erasure that caused it.
// =============================================================================

const LEAVING = 'ark_leaving';
const HOST = 'ark_host';
const HOSTCO = 'ark_hostco';

beforeAll(async () => { await runMigrations(); });

beforeEach(async () => {
  for (const t of ['agent_audit_log', 'api_keys', 'mcp_grants', 'webhooks', 'deal_rooms',
    'decision_votes', 'decisions', 'team_members', 'products', 'founders']) {
    await query(`DELETE FROM ${t}`);
  }
  await query(`INSERT INTO founders (id,clerk_user_id,email) VALUES (?,'ark_cl','leaving@example.com')`, [LEAVING]);
  await query(`INSERT INTO founders (id,clerk_user_id,email) VALUES (?,'ark_ch','host@example.com')`, [HOST]);
  await query(
    `INSERT INTO products (id,name,owner_id,status,scp_status) VALUES (?,'Host Co',?,'active','active')`,
    [HOSTCO, HOST]);
  await query(
    `INSERT INTO team_members (id,product_id,founder_id,role,status,invited_by)
     VALUES ('ark_tm',?,?,'co_founder','active',?)`, [HOSTCO, LEAVING, HOST]);
});

const rows = async (sql: string, args: unknown[] = []) =>
  (await query(sql, args as never)).rows as unknown as Array<Record<string, unknown>>;

describe('authority the person held', () => {
  beforeEach(async () => {
    await query(
      `INSERT INTO api_keys (id, founder_id, name, key_hash, key_prefix, product_id)
       VALUES ('ark_key', ?, 'CI key', 'hash_ark', 'fk_ark', ?)`, [LEAVING, HOSTCO]);
    await query(
      `INSERT INTO mcp_grants (id, product_id, server_name, tool_pattern, expires_at, created_by)
       VALUES ('ark_grant', ?, 'linear', '*', datetime('now','+30 days'), ?)`, [HOSTCO, LEAVING]);
  });

  it('stops acting, and is not handed to somebody else', async () => {
    await eraseFounderAccount(LEAVING);

    expect(await rows(`SELECT id FROM api_keys`), 'the credential is gone, not reassigned')
      .toEqual([]);
    expect(await rows(`SELECT id FROM mcp_grants`), 'and so is the grant').toEqual([]);
  });

  it('tells the company what stopped, without naming who it belonged to', async () => {
    await eraseFounderAccount(LEAVING);

    const trail = await rows(
      `SELECT target_type, actor_id, metadata_json FROM agent_audit_log
        WHERE product_id = ? AND event_type = 'credential.revoked_on_erasure'
        ORDER BY target_type`, [HOSTCO]);

    expect(trail.map((r) => r.target_type)).toEqual(['api_keys', 'mcp_grants']);
    for (const entry of trail) {
      expect(entry.actor_id).toBe('account_erasure');
      expect(String(entry.metadata_json)).toContain('re-establish it');
      expect(String(entry.metadata_json), 'the erased person is not named here')
        .not.toContain(LEAVING);
      expect(String(entry.metadata_json)).not.toContain('leaving@example.com');
    }
  });
});

describe('artefacts the company is running on', () => {
  beforeEach(async () => {
    await query(
      `INSERT INTO webhooks (id, founder_id, url, events, secret, product_id, created_by)
       VALUES ('ark_wh', ?, 'https://hooks.example/x', '["decision"]', 's3cr3t', ?, ?)`,
      [LEAVING, HOSTCO, LEAVING]);
    await query(
      `INSERT INTO deal_rooms (id, product_id, created_by, title, access_token)
       VALUES ('ark_dr', ?, ?, 'Series A room', 'tok_ark')`, [HOSTCO, LEAVING]);
    await query(
      `INSERT INTO decisions (id, product_id, what, why_now, category, gate, status)
       VALUES ('ark_d', ?, 'Raise', 'Runway', 'strategic', 1, 'pending')`, [HOSTCO]);
    await query(
      `INSERT INTO decision_votes (id, decision_id, product_id, founder_id, vote, rationale)
       VALUES ('ark_v','ark_d',?,?,'approve','the pipeline supports it')`, [HOSTCO, LEAVING]);
  });

  it('keep working, and stop naming the person', async () => {
    await eraseFounderAccount(LEAVING);

    const [webhook] = await rows(`SELECT id, url, active, founder_id, created_by FROM webhooks`);
    expect(webhook, 'the integration still exists').toBeDefined();
    expect(webhook.url, 'and still points where it did').toBe('https://hooks.example/x');
    expect(webhook.active, 'and is still delivering').toBe(1);
    expect(webhook.founder_id, 'NULL says nobody').toBeNull();
    expect(webhook.created_by).toBeNull();

    const [room] = await rows(`SELECT id, title, created_by FROM deal_rooms`);
    expect(room.title).toBe('Series A room');
    expect(room.created_by).toBeNull();
  });

  it('keep the company’s decision record truthful about what was decided', async () => {
    await eraseFounderAccount(LEAVING);

    const [vote] = await rows(`SELECT vote, rationale, founder_id FROM decision_votes`);
    expect(vote, 'the company did not lose a vote because a member left').toBeDefined();
    expect(vote.vote, 'and it still says which way').toBe('approve');
    expect(vote.founder_id, 'and no longer says who').toBeNull();
    // The free text is the reasoning behind a company decision AND the person's
    // own words. Kept for now with the attribution gone, and the question of
    // whether it may be retained is counsel debt (§9) rather than a guess.
    expect(vote.rationale).toBe('the pipeline supports it');
  });

  it('do not reassign authorship to the company owner', async () => {
    await eraseFounderAccount(LEAVING);
    const all = await rows(
      `SELECT founder_id AS a, created_by AS b FROM webhooks
        UNION ALL SELECT NULL, created_by FROM deal_rooms
        UNION ALL SELECT founder_id, NULL FROM decision_votes`);
    for (const row of all) {
      expect(row.a, 'the host owner did not write these').not.toBe(HOST);
      expect(row.b, 'the host owner did not write these').not.toBe(HOST);
    }
  });
});

describe('nothing is left undecided', () => {
  it('has no disposition meaning "nobody has decided"', () => {
    const ops = Object.values(PERSON_ACROSS_COMPANIES_DISPOSITIONS).map((d) => d.op);
    expect(ops).not.toContain('owner_decision');
    expect(new Set(ops)).toEqual(new Set(['delete', 'sever', 'revoke']));
  });

  it('revokes only what is authority, and severs only what is artefact', () => {
    const d = PERSON_ACROSS_COMPANIES_DISPOSITIONS as Record<string, { op: string }>;
    expect(d.api_keys.op).toBe('revoke');
    expect(d.mcp_grants.op).toBe('revoke');
    expect(d.webhooks.op).toBe('sever');
    expect(d.deal_rooms.op).toBe('sever');
    expect(d.decision_votes.op).toBe('sever');
  });
});
