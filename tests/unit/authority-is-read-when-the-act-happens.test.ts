// =============================================================================
// AUTHORITY IS READ WHEN THE ACT HAPPENS, NOT WHEN IT WAS PLANNED.
//
// The owner, 22 September 2026: "Investigate the complete lifecycle of a
// consequential operation: authorization, queuing, dispatch, execution,
// retries, and completion. Determine whether the existing qualification
// boundary is reached and evaluated against current authority at the point
// where the external operation is actually attempted. An operation authorized
// before disconnection or an account-identity change must not retain authority
// merely because it was previously queued."
//
// WHAT THE INVESTIGATION FOUND, AND WHY THERE IS NO NEW FRAMEWORK HERE.
//
// An agent's proposed action is stored, approved by the founder, and executed
// later — a queue in every respect that matters. `executor.ts` calls the
// outbound door's `invoke` at EXECUTION, and `invoke` resolves the experiment
// act and calls `qualificationStandsInTheWay` inside that same call. So the
// question is not whether a second check should be added; it is whether the
// existing one is a READ of current state or a verdict captured earlier.
//
// It is a read — `qualificationOf` issues its queries when called and holds
// nothing — and this file is what makes that a proven property rather than an
// observation about today's code. A change that memoised a verdict, cached a
// readiness row, or resolved a connection at approval time would break these.
//
// AND THE OTHER HALF OF THE SAME BOUNDARY: what must NOT be stopped. Somebody
// who has already paid is owed their thing whatever has since gone wrong with
// the machinery, and this proves the exemption survives every refusal added
// above it — and that its scope is one act, resolved from a row, rather than a
// mode a caller can ask to be in.
// =============================================================================
process.env.TURSO_DATABASE_URL = 'file::memory:';
process.env.ENCRYPTION_KEY = '7'.repeat(64);

import { readFileSync } from 'node:fs';
import { beforeAll, describe, expect, it } from 'vitest';
import { runMigrations } from '../../src/db/migrate.js';
import { query } from '../../src/db/client.js';
import { qualificationOf, qualificationStandsInTheWay } from '../../src/services/venture/qualification.js';

process.env.FOUNDRY_INSTANCE_POSTURE = 'private_owner';
process.env.FOUNDRY_OWNER_EMAIL = 'when@example.com';

const OWNER = 'f_when';
const SHOP = 'the shop it would act on is confirmed';
let X = '', P = '';

const because = async (): Promise<string> => {
  const r = await qualificationOf(X);
  return r.conditions.find((c) => c.name === SHOP)!.because;
};
const blocks = async (): Promise<boolean> =>
  (await qualificationOf(X)).blocking.includes(SHOP);

beforeAll(async () => {
  await runMigrations();
  await query('INSERT INTO founders (id,clerk_user_id,email,name) VALUES (?,?,?,?)',
    [OWNER, 'clerk_when', 'when@example.com', 'Owner']);
  const { seedProof2, approveListing } = await import('../../src/services/venture/proof-2.js');
  X = (await seedProof2(OWNER)).experimentId;
  await approveListing({ founderId: OWNER, experimentId: X });
  P = String(((await query(
    'SELECT id FROM products WHERE from_experiment_id = ? AND deleted_at IS NULL', [X]))
    .rows[0] as Record<string, unknown>).id);

  const r = (await query(
    "SELECT sense_key, mode FROM sense_providers WHERE provider = 'etsy' LIMIT 1"))
    .rows[0] as Record<string, unknown>;
  await query(
    `INSERT INTO company_senses (id, product_id, sense_key, provider, mode, disclosure)
     VALUES (?,?,?,?,?,?)`,
    ['cs_when', P, String(r.sense_key), 'etsy', String(r.mode), 'I would read the shop.']);
  await query(
    `INSERT INTO sense_credentials (id, company_sense_id, product_id, provider,
       granted_scopes_json, secret_json) VALUES (?,?,?,?,?,?)`,
    ['sc_when', 'cs_when', P, 'etsy', JSON.stringify(['shops_r']), 'iv:cipher:tag']);
  await query(
    `UPDATE company_senses SET provider_account_ref = '12345678',
            provider_account_label = 'ApexMicro', identity_verified_at = datetime('now')
      WHERE id = 'cs_when'`);
  await query(
    `UPDATE company_senses SET identity_confirmed_at = datetime('now'),
            identity_confirmed_by = ? WHERE id = 'cs_when'`, [`founder:${OWNER}`]);
});

describe('the verdict is issued now, from rows, every time it is asked for', () => {
  it('starts satisfied, which is what makes the rest of this file mean anything', async () => {
    expect(await because()).toContain('you confirmed it is yours');
    expect(await blocks()).toBe(false);
  });

  it('stops the moment the provider starts naming a different account', async () => {
    // Nothing re-approved anything and nothing re-ran a pipeline. The same
    // function asked the same question a second time and the world had moved.
    await query(
      `UPDATE company_senses SET identity_disputed_at = datetime('now'),
              identity_disputed_ref = '99999999',
              identity_disputed_detail = 'SomeoneElse (99999999)' WHERE id = 'cs_when'`);
    expect(await blocks()).toBe(true);
    expect(await because()).toContain('naming a different account');
  });

  it('resumes when the disagreement ends, without asking him to reaffirm anything', async () => {
    // "Once identity and authority are established, Foundry should continue
    // operating within its permitted envelope without repeatedly involving me."
    await query(
      `UPDATE company_senses SET identity_disputed_at = NULL, identity_disputed_ref = NULL,
              identity_disputed_detail = NULL WHERE id = 'cs_when'`);
    expect(await blocks()).toBe(false);
  });

  it('will not take a recognition made by somebody who does not own the company', async () => {
    // `identity_confirmed_by` was written by the confirm route and read by
    // nothing — provenance recorded for an incident and never used to decide
    // anything. A recognition has an author, and an author who does not own
    // this company has not given it authority here.
    await query(
      "UPDATE company_senses SET identity_confirmed_by = 'founder:somebody_else' WHERE id = 'cs_when'");
    expect(await blocks()).toBe(true);
    expect(await because()).toContain('does not own this company');
    await query(
      'UPDATE company_senses SET identity_confirmed_by = ? WHERE id = ?',
      [`founder:${OWNER}`, 'cs_when']);
    expect(await blocks()).toBe(false);
  });

  it('stops when the connection is withdrawn, for work approved before it was', async () => {
    // THE QUEUED-WORK CASE, stated as the owner stated it. Everything above
    // this line was authorised while the connection stood. Disconnection is
    // the only thing that changed, and the next evaluation refuses.
    const { disconnectSense } = await import('../../src/services/senses/index.js');
    await query(
      "UPDATE sense_credentials SET revoked_at = datetime('now'), revoke_reason = 'gone', revoked_at_provider = 1 WHERE id = 'sc_when'");
    await disconnectSense('cs_when', 'the owner withdrew it');
    expect(await blocks()).toBe(true);
    expect(await because()).toContain('no Etsy account is connected');
  });

  it('does not resolve to some other connection that happens to be lying around', async () => {
    // "Ensure that execution is bound to the intended connection and verified
    // provider account, rather than resolving to an arbitrary currently
    // available connection at execution time."
    //
    // It cannot, and the guarantee is structural rather than a rule somebody
    // remembered to write: `idx_company_sense_one_live` is unique on
    // (product_id, sense_key) where not disconnected, so "the live connection
    // for this company and this sense" is at most one row. There is no set for
    // a resolver to pick from.
    const r = (await query(
      "SELECT sense_key, mode FROM sense_providers WHERE provider = 'etsy' LIMIT 1"))
      .rows[0] as Record<string, unknown>;
    await query(
      `INSERT INTO company_senses (id, product_id, sense_key, provider, mode, disclosure)
       VALUES (?,?,?,?,?,?)`,
      ['cs_when2', P, String(r.sense_key), 'etsy', String(r.mode), 'I would read the shop.']);
    await query(
      `INSERT INTO sense_credentials (id, company_sense_id, product_id, provider,
         granted_scopes_json, secret_json) VALUES (?,?,?,?,?,?)`,
      ['sc_when2', 'cs_when2', P, 'etsy', JSON.stringify(['shops_r']), 'iv:cipher:tag']);
    await expect(query(
      `INSERT INTO company_senses (id, product_id, sense_key, provider, mode, disclosure)
       VALUES (?,?,?,?,?,?)`,
      ['cs_when3', P, String(r.sense_key), 'etsy', String(r.mode), 'I would read the shop.']))
      .rejects.toThrow(/UNIQUE|constraint/i);
  });

  it('is unrecognised again on the replacement, and says so in his words', async () => {
    // The new row carries none of the old row's recognition, so the same
    // experiment that was ready five assertions ago is not ready now. And the
    // words are the replacement's own state — a live connection that has not
    // said which shop it opens — not the absence of one.
    expect(await blocks()).toBe(true);
    expect(await because()).toContain('has not yet told me which shop it opens');
  });
});

describe('what the boundary must never stop', () => {
  it('lets a delivery, a refund and a withdrawal through while everything else is blocked', async () => {
    // The experiment is blocked — the assertion above says so — and these
    // three return null from the gate regardless, before any clause is read.
    expect(await blocks()).toBe(true);
    for (const kind of ['delivery', 'refund', 'withdrawal'] as const) {
      expect(await qualificationStandsInTheWay({ experimentId: X, tool: 'send_email', kind }),
        kind).toBeNull();
    }
  });

  it('refuses an offer through the same tool, on the same experiment, in the same breath', async () => {
    // The distinction is the ACT, not the tool: an offer and a delivery both
    // leave through `send_email`. Proving both in one file is what stops the
    // exemption quietly widening into "email is exempt".
    const stood = await qualificationStandsInTheWay({ experimentId: X, tool: 'send_email', kind: 'offer' });
    expect(stood).not.toBeNull();
    expect(stood!.blocking).toContain(SHOP);
  });

  it('does not let the exemption be asked for — the act is read from a row', async () => {
    // WHAT THE EXEMPTION'S SCOPE ACTUALLY IS. `kind` reaches the gate only
    // from `experimentActFor`, which resolves it from `outbound_actions`,
    // `experiment_fulfilments` or a withdrawn exposure — server-held rows, one
    // of them immutable by trigger since migration 284. The gateway's own
    // request type has no field for it, so a caller cannot declare itself to
    // be discharging an obligation, and this asserts that absence rather than
    // trusting it.
    const gateway = readFileSync('src/services/outbound/gateway.ts', 'utf8');
    const request = /export interface GatewayRequest \{[\s\S]*?\n\}/.exec(gateway)![0];
    expect(request).not.toMatch(/\bkind\??:/);
    expect(request).not.toMatch(/experimentAct/);
    // And the door hands the gate what the RESOLVER said, never the request.
    expect(gateway).toContain('kind: experimentAct.kind');
  });

  it('is reached through exactly one door, so there is nowhere to go around it', async () => {
    // One call site, in the outbound gateway. A second one would be a second
    // place this policy could drift, and a policy with two homes is one an
    // origin can be routed past. If this ever fails, the question to ask is
    // not how to update the number.
    const { execSync } = await import('node:child_process');
    const hits = execSync(
      "grep -rln 'qualificationStandsInTheWay' src/ --include=*.ts || true",
      { encoding: 'utf8' }).trim().split('\n').filter(Boolean).sort();
    expect(hits).toEqual([
      'src/services/outbound/gateway.ts',
      'src/services/venture/qualification.ts',
    ]);
  });
});

describe('the marketplace-write path, proved without enabling it', () => {
  // The owner: "The current NULL capability mapping is an independent obstacle
  // to Etsy write operations. Preserve that fail-closed behaviour until the
  // capability mapping is intentionally implemented. Before enabling
  // marketplace writes, prove that the actual Etsy execution path reaches the
  // corrected recognition and qualification boundary… Do not rely exclusively
  // on tests of the offer path as evidence that marketplace writes are
  // protected."
  //
  // So the binding happens HERE, in this file's own in-memory database, and
  // never in a migration. Production keeps `tool = NULL` on every Etsy write
  // provider — `etsy-is-declared-and-cannot-act` asserts it, and nothing here
  // touches that. What this proves is what WOULD happen on the day somebody
  // binds one: the act arrives at the corrected boundary rather than at a
  // gate that cannot see it.
  it('is still fail-closed in the institution as shipped', async () => {
    const bound = (await query(
      `SELECT p.id, p.tool FROM capability_providers p
        WHERE p.capability_key = 'list_on_marketplace'`))
      .rows as unknown as Array<Record<string, unknown>>;
    expect(bound.length).toBeGreaterThan(0);
    for (const r of bound) expect(r.tool, String(r.id)).toBeNull();
    // With nothing bound the gate resolves no family and returns null — the
    // act was already impossible one layer out, because the outbound door
    // cannot resolve a tool that is not bound.
    expect(await qualificationStandsInTheWay({
      experimentId: X, tool: 'post_listing', kind: null })).toBeNull();
  });

  it('reaches the recognition boundary the moment a tool is bound', async () => {
    await query(
      `UPDATE capability_providers SET tool = 'post_listing'
        WHERE capability_key = 'list_on_marketplace' AND provider = 'etsy'`);
    // `cs_when2` is the replacement connection from above: live, credentialed,
    // and unrecognised. This is the state the owner asked to see refused.
    const stood = await qualificationStandsInTheWay({
      experimentId: X, tool: 'post_listing', kind: null });
    expect(stood, 'a bound marketplace write did not reach the gate').not.toBeNull();
    expect(stood!.blocking).toContain(SHOP);
    expect(stood!.refusal).toContain('the test is not ready');
  });

  it('lets the recognition boundary go once he has recognised the account', async () => {
    // The other half of the pair. Other conditions may still block this
    // experiment — that is their job — but the SHOP condition, which is what
    // recognition governs, is satisfied and stops appearing.
    // IN LIFECYCLE ORDER, because the database enforces it: the provider names
    // the shop, and only then can he recognise it. Confirming first is refused
    // by `company_sense_confirmation:nothing_to_confirm`, which is the trigger
    // doing exactly its job — a recognition with no named account behind it is
    // an approval of whatever the connection later turns out to reach.
    await query(
      `UPDATE company_senses SET provider_account_ref = '12345678',
              provider_account_label = 'ApexMicro',
              identity_verified_at = datetime('now') WHERE id = 'cs_when2'`);
    await query(
      `UPDATE company_senses SET identity_confirmed_at = datetime('now'),
              identity_confirmed_by = ? WHERE id = 'cs_when2'`, [`founder:${OWNER}`]);
    const stood = await qualificationStandsInTheWay({
      experimentId: X, tool: 'post_listing', kind: null });
    if (stood) expect(stood.blocking).not.toContain(SHOP);
    expect((await qualificationOf(X)).blocking).not.toContain(SHOP);
  });

  it('still never stands in the way of what a buyer is owed', async () => {
    for (const kind of ['delivery', 'refund', 'withdrawal'] as const) {
      expect(await qualificationStandsInTheWay({
        experimentId: X, tool: 'post_listing', kind }), kind).toBeNull();
    }
  });
});
