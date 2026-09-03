process.env.TURSO_DATABASE_URL = 'file::memory:';
process.env.ENCRYPTION_KEY = '0'.repeat(64);
process.env.FOUNDRY_INSTANCE_POSTURE = 'private_owner';
process.env.FOUNDRY_OWNER_EMAIL = 'owner@example.com';

import { beforeAll, describe, expect, it, vi } from 'vitest';
import { runMigrations } from '../../src/db/migrate.js';
import { query } from '../../src/db/client.js';
import { capability } from '../../src/services/institution/capabilities.js';
import {
  checkOwnDependencies, directDependencies, verifyRealEvidenceLanded,
} from '../../src/services/institution/dependency-health.js';
import { formClaim, observe } from '../../src/services/venture/market-evidence.js';
import { JOB_REGISTRY } from '../../src/jobs/index.js';

// =============================================================================
// A PROOF THE INSTITUTION EARNS.
//
// A capability becomes reality-proven when it performed its intended work and
// the RESULT was checked — not when a development harness called a provider,
// and not when a call failed to throw. So the institution needs real work of
// its own: the packages Foundry runs on are a real provider dependency of a
// real company, and whether anybody still maintains them is a question a public
// registry can honestly answer. It would be worth doing if no capability needed
// proving.
//
// AND MATURITY IS PER-DATABASE, deliberately. A proof earned here says nothing
// about the deployed institution, which earns its own on its own tick, against
// its own registry reads. That is the point of the rule.
// =============================================================================

const OWNER = 'proof_owner';

function record(name: string, lastPublished: string): Response {
  return new Response(JSON.stringify({
    'dist-tags': { latest: '1.0.0' },
    time: { created: '2020-01-01T00:00:00Z', modified: lastPublished },
    versions: { '1.0.0': {} }, maintainers: [{ name: 'someone' }],
    description: `the ${name} package`,
  }), { status: 200, headers: { 'content-type': 'application/json' } });
}

beforeAll(async () => {
  await runMigrations();
  await query('INSERT INTO founders (id,clerk_user_id,email,name) VALUES (?,?,?,?)',
    [OWNER, 'clerk_proof', 'owner@example.com', 'Owner']);
});

describe('real work of its own', () => {
  it('asks about the packages Foundry actually depends on', () => {
    const deps = directDependencies();
    expect(deps.length).toBeGreaterThan(0);
    // Direct dependencies from the manifest, not the transitive world — a
    // thousand packages would be a different and much less answerable question.
    expect(deps).toContain('hono');
  });

  it('forms a real claim and files what the registry said about each', async () => {
    const fresh = new Date(Date.now() - 30 * 86_400_000).toISOString();
    const stale = new Date(Date.now() - 900 * 86_400_000).toISOString();
    let call = 0;
    vi.spyOn(globalThis, 'fetch').mockImplementation(async () => {
      call += 1;
      return record(`p${String(call)}`, call === 2 ? stale : fresh);
    });

    const health = await checkOwnDependencies({ founderId: OWNER, limit: 3 });
    expect(health?.checked).toBe(3);
    expect(health?.abandoned).toHaveLength(1);
    expect(health?.sentence).toContain('not been published to in eighteen months');
    // A risk to the company rather than a fault in it — the distinction the
    // sentence has to carry, because one is actionable and the other is blame.
    expect(health?.sentence).toContain('risk to this company');

    const obs = (await query(
      `SELECT bearing, evidence_mode, directness FROM market_observations WHERE claim_id = ?`,
      [health?.claimId])).rows as unknown as Array<Record<string, unknown>>;
    expect(obs).toHaveLength(3);
    expect(obs.every((o) => String(o.evidence_mode) === 'real')).toBe(true);
    // Seen, never worked out: the registry says the date outright.
    expect(obs.every((o) => String(o.directness) === 'direct')).toBe(true);
    expect(obs.filter((o) => String(o.bearing) === 'contradicts')).toHaveLength(1);
    vi.restoreAllMocks();
  });
});

describe('the proof is about the result, never the call', () => {
  it('refuses a call that left no observation behind', async () => {
    const empty = await formClaim({ founderId: OWNER, evidenceMode: 'real',
      claim: 'Something nobody looked into' });
    const verdict = await verifyRealEvidenceLanded(empty);
    expect(verdict.ok).toBe(false);
    expect(verdict.because).toContain('left no real observation behind');
  });

  it('refuses evidence that was all worked out rather than seen', async () => {
    const claimId = await formClaim({ founderId: OWNER, evidenceMode: 'real',
      claim: 'Something only inferred' });
    await observe({ founderId: OWNER, claimId, sourceType: 'directory',
      source: 'https://registry.example/thing', saw: 'nothing turned up',
      bearing: 'supports', directness: 'inferred', observedAt: new Date(),
      evidenceMode: 'real' });
    const verdict = await verifyRealEvidenceLanded(claimId);
    expect(verdict.ok).toBe(false);
    expect(verdict.because).toContain('worked out');
  });

  it('refuses a source nobody could go and visit', async () => {
    const claimId = await formClaim({ founderId: OWNER, evidenceMode: 'real',
      claim: 'Something with a source that is not an address' });
    await observe({ founderId: OWNER, claimId, sourceType: 'directory',
      source: 'somewhere', saw: 'a thing', bearing: 'supports',
      directness: 'direct', observedAt: new Date(), evidenceMode: 'real' });
    const verdict = await verifyRealEvidenceLanded(claimId);
    expect(verdict.ok).toBe(false);
    expect(verdict.because).toContain('nobody could go and visit');
  });
});

describe('a second way of knowing, only where there is something to know', () => {
  it('asks nobody when nothing has gone quiet, and stays unproven', async () => {
    const { askAboutQuietDependencies } = await import(
      '../../src/services/institution/dependency-health.js');
    const nothing = await askAboutQuietDependencies({
      founderId: OWNER, claimId: 'irrelevant', abandoned: [] });
    expect(nothing.asked).toBe(0);
    // Manufacturing a question so a capability could earn a proof would be
    // staging exactly what the proof exists to rule out.
    const community = await capability('read_community_discussion');
    expect(community?.providers[0]?.maturity).toBe('declared');
  });

  it('asks when something has, and the registry could not have told us', async () => {
    const claimId = await formClaim({ founderId: OWNER, evidenceMode: 'real',
      claim: 'The quiet packages Foundry depends on are fine' });
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({
      nbHits: 1,
      hits: [{ objectID: '9', created_at: '2026-02-01T00:00:00Z',
        comment_text: 'That old-thing package has been broken since the node 20 '
          + 'change and nobody has merged the fix. We forked it.' }],
    }), { status: 200, headers: { 'content-type': 'application/json' } }));

    const { askAboutQuietDependencies } = await import(
      '../../src/services/institution/dependency-health.js');
    const talk = await askAboutQuietDependencies({
      founderId: OWNER, claimId, abandoned: ['old-thing'] });
    vi.restoreAllMocks();

    expect(talk.asked).toBe(1);
    // The distinction a registry structurally cannot draw: quiet-and-finished
    // versus quiet-and-broken.
    const obs = (await query(
      `SELECT saw FROM market_observations WHERE claim_id = ? AND source_type = 'community'`,
      [claimId])).rows as unknown as Array<Record<string, unknown>>;
    expect(obs.some((o) => String(o.saw).includes('broken since'))).toBe(true);
  });
});

describe('the whole loop, run by the job', () => {
  it('moves the capability one rung at a time, each with what was seen', async () => {
    const before = await capability('read_package_registry');
    expect(before?.providers.find((p) => p.provider === 'npm_registry')?.maturity)
      .toBe('declared');

    const fresh = new Date(Date.now() - 20 * 86_400_000).toISOString();
    vi.spyOn(globalThis, 'fetch').mockImplementation(async () => record('x', fresh));
    await JOB_REGISTRY.dependency_health_tick.fn();
    vi.restoreAllMocks();

    const after = await capability('read_package_registry');
    expect(after?.providers.find((p) => p.provider === 'npm_registry')?.maturity)
      .toBe('reality_proven');

    const changes = (await query(
      `SELECT from_maturity, to_maturity, witnessed_by, evidence, evidence_mode
         FROM capability_maturity_changes ORDER BY rowid`, []))
      .rows as unknown as Array<Record<string, unknown>>;
    expect(changes).toHaveLength(2);
    // ONE RUNG AT A TIME, and each carries different evidence: reaching the
    // provider is not the same fact as the result being usable.
    expect(String(changes[0]?.to_maturity)).toBe('available');
    expect(String(changes[0]?.evidence)).toContain('reached the registry');
    expect(String(changes[1]?.to_maturity)).toBe('reality_proven');
    expect(String(changes[1]?.evidence)).toContain('the result was checked');
    expect(String(changes[1]?.evidence)).toContain('addresses that can each be visited');
    // Real evidence, or the table itself would have refused the change.
    expect(changes.every((c) => String(c.evidence_mode) === 'real')).toBe(true);
    // Witnessed by the institution's own job, not by a person or a harness.
    expect(String(changes[1]?.witnessed_by)).toBe('dependency_health_tick');
  });

  it('does not award anything twice on a second run', async () => {
    const fresh = new Date(Date.now() - 20 * 86_400_000).toISOString();
    vi.spyOn(globalThis, 'fetch').mockImplementation(async () => record('x', fresh));
    await JOB_REGISTRY.dependency_health_tick.fn();
    vi.restoreAllMocks();
    const changes = (await query(
      'SELECT COUNT(*) AS n FROM capability_maturity_changes', []))
      .rows[0] as Record<string, unknown>;
    expect(Number(changes.n)).toBe(2);
  });
});
