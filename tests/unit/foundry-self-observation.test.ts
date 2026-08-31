process.env.TURSO_DATABASE_URL = 'file::memory:';

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import { runMigrations } from '../../src/db/migrate.js';
import { query } from '../../src/db/client.js';
import { establishSystemIdentity } from '../../src/services/system-identity.js';
import {
  SCHEMA_SNAPSHOT_CHECK, SNAPSHOT_PATH, compareSchemaToSnapshot,
  observeFoundryRepositoryReality, snapshotObjectNames,
} from '../../src/services/foundry/self-observation.js';

// =============================================================================
// Foundry becomes an ordinary customer of its own institution.
//
// The only special thing on this path is that the outermost module resolves the
// canonical Foundry identity. Past that boundary there is a product id and
// nothing else, and the fact recorded is a real one about this repository.
//
// The observation had to be checked against reality before anything was built
// on it: an observer that reports drift when there is none is not a recursive
// proof, it is a fabricated fact about the company.
// =============================================================================

beforeAll(async () => {
  await runMigrations();
  await query("INSERT INTO founders (id,clerk_user_id,email) VALUES ('fso_owner','fso_clerk','owner@example.com')", []);
  await query("INSERT INTO products (id,name,owner_id) VALUES ('fso_prod','Anything At All','fso_owner')", []);
});

describe('foundry self-observation', () => {
  it('reads the real repository and reports the truth about it', async () => {
    // The committed snapshot and the schema the migrations actually produce
    // agree today. A test that only asserted "passed" would also pass against
    // an observer hardcoded to say so, which is why the object counts are
    // compared directly here.
    const snapshotSql = readFileSync(resolve(process.cwd(), SNAPSHOT_PATH), 'utf8');
    const live = (await query(
      "SELECT name FROM sqlite_master WHERE name NOT LIKE 'sqlite_%' AND name<>''",
    )).rows as unknown as Array<Record<string, unknown>>;
    const liveNames = live.map((r) => String(r.name));

    expect(liveNames.length).toBeGreaterThan(100);
    expect(snapshotObjectNames(snapshotSql).size).toBe(new Set(liveNames).size);
    expect(compareSchemaToSnapshot({ liveObjectNames: liveNames, snapshotSql }))
      .toMatchObject({ result: 'passed' });
  });

  it('actually detects drift in both directions', async () => {
    // Mutation, not assertion: an observer that cannot report failure cannot
    // report anything. Both directions are drift — an object the snapshot omits
    // means it was not regenerated, and one it invents means it describes a
    // schema this database is not running.
    const undescribed = compareSchemaToSnapshot({
      liveObjectNames: ['a', 'b'], snapshotSql: 'CREATE TABLE a (id TEXT);',
    });
    expect(undescribed.result).toBe('failed');
    expect(undescribed.detail).toContain('not in the snapshot');

    const phantom = compareSchemaToSnapshot({
      liveObjectNames: ['a'], snapshotSql: 'CREATE TABLE a (id TEXT);\nCREATE INDEX ghost ON a(id);',
    });
    expect(phantom.result).toBe('failed');
    expect(phantom.detail).toContain('do not exist');
  });

  it('declines rather than guessing when the identity has never been established', async () => {
    // Absence is unknown, not a fallback. Attributing an observation to a
    // wrongly-guessed company is worse than recording nothing, and guessing at
    // a display name is the exact defect migration 123 removed.
    expect(await observeFoundryRepositoryReality()).toEqual({
      observed: false, reason: 'identity_not_established',
    });
    expect((await query(
      "SELECT COUNT(*) n FROM signal_events WHERE source='development_verification'", [],
    )).rows[0]).toMatchObject({ n: 0 });
  });

  it('records an ordinary observation once the identity exists', async () => {
    await establishSystemIdentity('foundry', 'fso_prod', 'test fixture');
    const outcome = await observeFoundryRepositoryReality();

    expect(outcome).toMatchObject({ observed: true, productId: 'fso_prod', result: 'passed' });
    // Ordinary canonical evidence on an ordinary product — nothing in the row
    // records that this company is the one running the platform.
    const row = (await query(
      "SELECT product_id,source,event_type,payload_json FROM signal_events WHERE source='development_verification'", [],
    )).rows[0] as Record<string, unknown>;
    expect(row).toMatchObject({ product_id: 'fso_prod', source: 'development_verification' });
    expect(String(row.event_type)).toContain(SCHEMA_SNAPSHOT_CHECK);
    expect(JSON.stringify(row)).not.toMatch(/foundry/i);
  });

  it('converges rather than inflating the evidence when it runs again', async () => {
    // The scheduled pass runs every six hours. Re-observing an unchanged
    // reality is not new evidence, and a ladder fed by a repeating job must not
    // be able to accumulate confidence by looking twice.
    const at = new Date('2026-08-16T12:00:00.000Z');
    await observeFoundryRepositoryReality({ observedAt: at });
    const before = (await query(
      "SELECT COUNT(*) n FROM signal_events WHERE source='development_verification'", [],
    )).rows[0] as Record<string, unknown>;
    await observeFoundryRepositoryReality({ observedAt: at });
    const after = (await query(
      "SELECT COUNT(*) n FROM signal_events WHERE source='development_verification'", [],
    )).rows[0] as Record<string, unknown>;
    expect(after.n).toBe(before.n);
  });

  it('records a failing observation when the repository really has drifted', async () => {
    // Without this, every test above is satisfied by an observer hardcoded to
    // report success — the true answer for this repository today happens to be
    // "passed". Pointed at a repository whose snapshot describes a different
    // schema, the observer must say so, and the recorded evidence must carry
    // the failure rather than the caller's opinion of it.
    const { mkdtempSync, mkdirSync, writeFileSync } = await import('node:fs');
    const { tmpdir } = await import('node:os');
    const { join } = await import('node:path');
    const drifted = mkdtempSync(join(tmpdir(), 'foundry-drift-'));
    mkdirSync(join(drifted, 'docs/db'), { recursive: true });
    writeFileSync(join(drifted, SNAPSHOT_PATH), 'CREATE TABLE only_this_one (id TEXT);\n');

    const outcome = await observeFoundryRepositoryReality({
      repositoryRoot: drifted, observedAt: new Date('2026-08-16T13:00:00.000Z'),
    });
    expect(outcome).toMatchObject({ observed: true, result: 'failed' });

    const row = (await query(
      `SELECT severity,payload_json FROM signal_events WHERE id=?`,
      [(outcome as { observation: { id: string } }).observation.id],
    )).rows[0] as Record<string, unknown>;
    // A failing check is not low severity, and the detail names what drifted.
    expect(row.severity).toBe('medium');
    expect(String(row.payload_json)).toContain('not in the snapshot');
  });

  it('refuses to invent a fact when the evidence cannot be gathered', async () => {
    // An unreadable snapshot is not a failing check. Reporting drift because
    // the evidence was missing would be manufacturing company truth from an
    // absence — the thing the whole evidence ladder exists to forbid.
    expect(await observeFoundryRepositoryReality({ repositoryRoot: '/nonexistent-repo-root' }))
      .toEqual({ observed: false, reason: 'snapshot_unreadable' });
  });

  it('is semantically identical to the same evidence from any other company', async () => {
    // The owner's test of whether recursion became privilege: run the identical
    // evidence through the identical intake for the platform's own company and
    // for an unrelated one, and the institution must not be able to tell them
    // apart. Anything that differs here is a special case, however well meant.
    await query("INSERT INTO founders (id,clerk_user_id,email) VALUES ('eq_owner','eq_clerk','eq@example.com')", []);
    await query("INSERT INTO products (id,name,owner_id) VALUES ('eq_prod','Ordinary Co','eq_owner')", []);

    const at = new Date('2026-08-15T08:00:00.000Z');
    const args = { check: SCHEMA_SNAPSHOT_CHECK, result: 'failed', detail: 'identical detail', observedAt: at };
    const { recordDevelopmentObservation } = await import(
      '../../src/services/institution/development-observation.js');
    const mine = await recordDevelopmentObservation({ productId: 'fso_prod', ...args });
    const theirs = await recordDevelopmentObservation({ productId: 'eq_prod', ...args });

    // Same canonical event identity, derived from the fact and not the company.
    expect(mine.eventType).toBe(theirs.eventType);
    expect(mine.check).toBe(theirs.check);
    expect(mine.result).toBe(theirs.result);

    const rowOf = async (observationId: string) => (await query(
      'SELECT source,event_type,severity,payload_json,summary FROM signal_events WHERE id=?',
      [observationId],
    )).rows[0] as Record<string, unknown>;
    // Byte-for-byte equal once the product id is set aside.
    expect(await rowOf(mine.id)).toEqual(await rowOf(theirs.id));
  });

  it('does not let observing become recognition, understanding, or authority', async () => {
    // A recurring job that observes its own company is exactly where a
    // shortcut would hide: the evidence is plentiful, it is self-produced, and
    // nobody is watching. Every rung must still cost what it costs.
    const { earnResponsibilityUnderstanding } = await import(
      '../../src/services/institution/responsibility-understanding.js');

    await observeFoundryRepositoryReality();
    // Observation is evidence, not a responsibility. `development_verified:*`
    // has no discovery contract, so no rung is reached by producing facts.
    expect((await query(
      "SELECT COUNT(*) n FROM institutional_responsibilities WHERE product_id='fso_prod'", [],
    )).rows[0]).toMatchObject({ n: 0 });

    // And a responsibility that does exist cannot be understood from this.
    await query(
      `INSERT INTO signal_events (id,product_id,source,event_type,severity,payload_json,summary)
       VALUES ('fso_seed','fso_prod','repository','development_need_observed','low','{}','seed')`, []);
    await query(
      `INSERT INTO institutional_responsibilities (id,product_id,title,capability,state,discovery_evidence_ref)
       VALUES ('fso_resp','fso_prod','Keep the snapshot consistent','development','visible','signal_event:fso_seed')`, []);
    await expect(earnResponsibilityUnderstanding('fso_prod', 'fso_resp')).rejects.toThrow(/insufficient/);
  });

  it('observes only — it repairs nothing and grants nothing', async () => {
    const source = readFileSync(
      resolve(process.cwd(), 'src/services/foundry/self-observation.ts'), 'utf8');
    // No command execution, no repository mutation, no authority.
    for (const forbidden of [
      'execSync', 'spawn', 'exec(', 'writeFileSync', 'appendFileSync', 'unlink',
      'grantAssistingAuthority', 'grantDevelopmentAuthority', 'autonomy_consents',
      'enterResponsibilityAssisting', 'transitionResponsibility',
    ]) {
      expect(source, `self-observation must not reach ${forbidden}`).not.toContain(forbidden);
    }
    // And observing did not move anything up the ladder.
    expect((await query(
      'SELECT COUNT(*) n FROM responsibility_transitions', [],
    )).rows[0]).toMatchObject({ n: 0 });
    expect((await query('SELECT COUNT(*) n FROM autonomy_consents', [])).rows[0])
      .toMatchObject({ n: 0 });
  });
});
