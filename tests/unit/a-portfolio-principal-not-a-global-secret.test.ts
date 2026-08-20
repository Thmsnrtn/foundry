process.env.TURSO_DATABASE_URL = 'file::memory:';
process.env.ENCRYPTION_KEY = '0'.repeat(64);
process.env.ECOSYSTEM_SERVICE_KEY = 'the-old-global-secret';

import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { Hono } from 'hono';
import { runMigrations } from '../../src/db/migrate.js';
import { query } from '../../src/db/client.js';
import {
  issueEcosystemPrincipal, listEcosystemPrincipals, principalMayRead,
  resolveEcosystemPrincipal, revokeEcosystemPrincipal,
} from '../../src/services/institution/ecosystem-principal.js';

// =============================================================================
// OWNER INSTRUCTION §12: A PORTFOLIO PRINCIPAL, NOT ONE GLOBAL SECRET.
//
// `GET /internal/operator/dashboard-data?product_id=…` returned a named
// company's entire operating picture — risk state and its reason, stressors,
// MRR by new/expansion/contraction/churn, signups, activation, retention,
// support volume, NPS, churn, cohort summary — behind a single process-wide
// `ECOSYSTEM_SERVICE_KEY` compared timing-safely, and nothing else. The key is
// issued to nobody, so HOLDING IT WAS INDISTINGUISHABLE FROM BEING EVERY
// COMPANY AT ONCE, and the company id is a query parameter.
//
// The owner's instruction: treat distribution as unknown, rotate, and represent
// portfolio access as "an explicit service/portfolio principal with scoped
// company membership rather than possession of one global secret plus arbitrary
// product_id". Commercial customer access must remain isolated.
//
// ROTATION IS THE OWNER'S ACT and is recorded as such rather than reported as
// done. What the code does is make the old shape INSUFFICIENT.
// =============================================================================

const OWNER = 'epp_owner';
const STRANGER = 'epp_stranger';
const MINE_A = 'epp_mine_a';
const MINE_B = 'epp_mine_b';
const THEIRS = 'epp_theirs';

let app: Hono;

beforeAll(async () => {
  await runMigrations();
  for (const [id, mail] of [[OWNER, 'owner@example.com'], [STRANGER, 'stranger@example.com']]) {
    await query(`INSERT INTO founders (id,clerk_user_id,email) VALUES (?,?,?)`, [id, `c_${id}`, mail]);
  }
  for (const [id, owner] of [[MINE_A, OWNER], [MINE_B, OWNER], [THEIRS, STRANGER]]) {
    await query(
      `INSERT INTO products (id,name,owner_id,status,scp_status) VALUES (?,?,?,'active','active')`,
      [id, `Co ${id}`, owner]);
  }
  const { ecosystemRoutes } = await import('../../src/routes/internal/ecosystem.js');
  app = new Hono();
  app.route('/', ecosystemRoutes);
});

beforeEach(async () => {
  await query('DELETE FROM ecosystem_principal_companies');
  await query('DELETE FROM ecosystem_principals');
});

const readCompany = (productId: string, key?: string) => app.request(
  `/internal/operator/dashboard-data?product_id=${productId}`,
  key ? { headers: { 'X-Ecosystem-Key': key } } : {});

describe('the global secret', () => {
  it('no longer reads any company', async () => {
    const res = await readCompany(MINE_A, 'the-old-global-secret');
    expect(res.status, 'possession of a shared secret is not an answer to "may you see this company"')
      .toBe(404);
  });

  it('no longer writes into any company either', async () => {
    const res = await app.request('/internal/conversion-signal', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'X-Ecosystem-Key': 'the-old-global-secret' },
      body: JSON.stringify({ product_id: MINE_A, event_type: 'signup', event_data: {} }),
    });
    expect(res.status).toBe(404);
    expect((await query('SELECT id FROM audit_log WHERE product_id = ?', [MINE_A])).rows)
      .toEqual([]);
  });

  it('leaves the surface serving nobody until a principal is issued', async () => {
    // The correct state for a surface whose key distribution the owner has
    // instructed us to treat as unknown.
    expect((await readCompany(MINE_A)).status).toBe(404);
  });
});

describe('a principal scoped to a portfolio', () => {
  it('reads the companies it was scoped to', async () => {
    const issued = await issueEcosystemPrincipal({
      founderId: OWNER, label: 'Apex Micro', companyIds: [MINE_A] });
    if ('refused' in issued) throw new Error(issued.refused);

    const res = await readCompany(MINE_A, issued.key);
    expect(res.status).toBe(200);
    expect((await res.json() as Record<string, unknown>).app).toBe(`Co ${MINE_A}`);
  });

  it('reads nothing else in the same owner’s portfolio', async () => {
    const issued = await issueEcosystemPrincipal({
      founderId: OWNER, label: 'Apex Micro', companyIds: [MINE_A] });
    if ('refused' in issued) throw new Error(issued.refused);

    expect((await readCompany(MINE_B, issued.key)).status,
      'scope is enumerated membership; a company not on the list is a row that does not exist')
      .toBe(404);
  });

  it('cannot be scoped into somebody else’s company at all', async () => {
    const refused = await issueEcosystemPrincipal({
      founderId: OWNER, label: 'Reaching', companyIds: [MINE_A, THEIRS] });
    expect(refused).toEqual({ refused: 'not_owned' });
    // All or nothing: nothing was issued, rather than a principal quietly
    // narrower than what was asked for.
    expect(await listEcosystemPrincipals(OWNER)).toEqual([]);
  });

  it('is refused by the database as well as by the service', async () => {
    const issued = await issueEcosystemPrincipal({
      founderId: OWNER, label: 'Apex Micro', companyIds: [MINE_A] });
    if ('refused' in issued) throw new Error(issued.refused);
    // The service check is a property of one function; this is a property of
    // the table, and ownership can change after issuance.
    await expect(query(
      `INSERT INTO ecosystem_principal_companies (id, principal_id, product_id)
       VALUES ('epp_forced', ?, ?)`, [issued.id, THEIRS]))
      .rejects.toThrow(/company_not_in_issuers_portfolio/);
  });

  it('has no wildcard, so an empty scope reads nothing', async () => {
    expect(await issueEcosystemPrincipal({
      founderId: OWNER, label: 'Everything', companyIds: [] }))
      .toEqual({ refused: 'companies_required' });
  });
});

describe('the credential itself', () => {
  it('is stored as a hash and shown once', async () => {
    const issued = await issueEcosystemPrincipal({
      founderId: OWNER, label: 'Apex Micro', companyIds: [MINE_A, MINE_B] });
    if ('refused' in issued) throw new Error(issued.refused);

    const stored = (await query('SELECT key_hash, key_prefix FROM ecosystem_principals'))
      .rows[0] as Record<string, unknown>;
    expect(String(stored.key_hash)).not.toContain(issued.key);
    expect(issued.key.startsWith(String(stored.key_prefix))).toBe(true);

    const [summary] = await listEcosystemPrincipals(OWNER);
    expect(JSON.stringify(summary), 'nothing readable can reproduce it')
      .not.toContain(issued.key);
    expect(summary.companyIds.sort()).toEqual([MINE_A, MINE_B].sort());
  });

  it('stops resolving once revoked', async () => {
    const issued = await issueEcosystemPrincipal({
      founderId: OWNER, label: 'Apex Micro', companyIds: [MINE_A] });
    if ('refused' in issued) throw new Error(issued.refused);
    expect(await resolveEcosystemPrincipal(issued.key)).not.toBeNull();

    expect(await revokeEcosystemPrincipal(issued.id, OWNER)).toEqual({ revoked: true });
    expect(await resolveEcosystemPrincipal(issued.key)).toBeNull();
    expect((await readCompany(MINE_A, issued.key)).status).toBe(404);
  });

  it('cannot be revoked by somebody who did not issue it', async () => {
    const issued = await issueEcosystemPrincipal({
      founderId: OWNER, label: 'Apex Micro', companyIds: [MINE_A] });
    if ('refused' in issued) throw new Error(issued.refused);
    expect(await revokeEcosystemPrincipal(issued.id, STRANGER)).toEqual({ revoked: false });
  });

  it('stops resolving once expired', async () => {
    const issued = await issueEcosystemPrincipal({
      founderId: OWNER, label: 'Apex Micro', companyIds: [MINE_A], days: 1 });
    if ('refused' in issued) throw new Error(issued.refused);
    await query(
      `UPDATE ecosystem_principals SET expires_at = datetime('now','-1 day') WHERE id = ?`,
      [issued.id]);
    expect(await resolveEcosystemPrincipal(issued.key),
      'a credential with no end is one nobody revisits').toBeNull();
  });

  it('says nothing to a key it does not know', async () => {
    expect(await resolveEcosystemPrincipal('eco_not_a_real_key')).toBeNull();
    expect(await resolveEcosystemPrincipal('')).toBeNull();
    expect(await resolveEcosystemPrincipal(undefined)).toBeNull();
  });

  it('reads nothing when it has been scoped to nothing', async () => {
    const issued = await issueEcosystemPrincipal({
      founderId: OWNER, label: 'Apex Micro', companyIds: [MINE_A] });
    if ('refused' in issued) throw new Error(issued.refused);
    await query('DELETE FROM ecosystem_principal_companies WHERE principal_id = ?', [issued.id]);
    expect(await principalMayRead(issued.id, MINE_A)).toBe(false);
  });
});
