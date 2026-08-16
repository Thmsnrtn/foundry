process.env.TURSO_DATABASE_URL = 'file::memory:';

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { resolve } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import { runMigrations } from '../../src/db/migrate.js';
import { query } from '../../src/db/client.js';
import {
  FOUNDRY_IDENTITY_KEY, establishSystemIdentity, resolveFoundryProductId,
  resolveSystemIdentityProductId,
} from '../../src/services/system-identity.js';
import { sendFounderWelcome } from '../../src/services/founder/welcome-sequence.js';

// =============================================================================
// Canonical system identity (migration 123).
//
// Owner decision: Foundry is a first-class internally owned institutional
// company/product with a stable canonical identity in the ordinary product
// model. The display name is presentation only.
//
// The constitutional half of that decision is the harder half: identity is not
// authority. Being the company that runs the platform must buy Foundry exactly
// one thing — being findable — and nothing else. Every test below either proves
// identity is robust, or proves it is inert.
// =============================================================================

// The impostor is created FIRST and is literally named "Foundry". Under the old
// `WHERE name='Foundry' ORDER BY created_at ASC LIMIT 1` resolution it would
// have become the platform's institution. It is owned by a different founder.
const IMPOSTOR = 'si_impostor';
const CANONICAL = 'si_canonical';

async function countOf(sql: string, args: unknown[] = []): Promise<number> {
  const r = await query(sql, args);
  return Number((r.rows[0] as Record<string, unknown>).n);
}

beforeAll(async () => {
  await runMigrations();
  await query(`INSERT INTO founders (id,clerk_user_id,email) VALUES
    ('si_owner','si_owner_clerk','owner@foundry.example'),
    ('si_other','si_other_clerk','someone@customer.example')`, []);
  // Impostor first (earlier created_at), canonical second and NOT named Foundry.
  await query(`INSERT INTO products (id,name,owner_id,created_at) VALUES
    (?, 'Foundry','si_other','2020-01-01T00:00:00Z'),
    (?, 'Foundry Internal','si_owner','2026-01-01T00:00:00Z')`, [IMPOSTOR, CANONICAL]);
});

describe('canonical system identity', () => {
  it('is unknown until established — it never falls back to a display name', async () => {
    // A product named exactly "Foundry" exists and is the oldest row in the
    // table. Resolution still refuses to guess. Unknown is a legitimate state.
    expect(await resolveFoundryProductId()).toBeNull();

    // And the consequence of unknown is declining to act, not acting on a
    // guess: the welcome send stops rather than borrowing the impostor's scope.
    const before = await countOf(
      "SELECT COUNT(*) n FROM audit_log WHERE product_id=? AND action_type='gateway:send_email'", [IMPOSTOR]);
    const result = await sendFounderWelcome({
      id: 'si_owner', email: 'owner@foundry.example', name: 'Owner',
      created_at: new Date().toISOString(),
    });
    expect(result).toMatchObject({ ok: false, reason: 'foundry_product_not_seeded' });
    expect(await countOf(
      "SELECT COUNT(*) n FROM audit_log WHERE product_id=? AND action_type='gateway:send_email'", [IMPOSTOR]))
      .toBe(before);
  });

  it('binds to a product row, and a customer named Foundry does not acquire it', async () => {
    const established = await establishSystemIdentity(
      FOUNDRY_IDENTITY_KEY, CANONICAL, 'test: the Foundry company');
    expect(established).toEqual({ established: true, productId: CANONICAL });

    // Resolution ignores name and creation order entirely.
    expect(await resolveFoundryProductId()).toBe(CANONICAL);
    expect(await resolveFoundryProductId()).not.toBe(IMPOSTOR);
  });

  it('survives renaming the canonical product', async () => {
    await query('UPDATE products SET name=? WHERE id=?', ['Something Else Entirely', CANONICAL]);
    expect(await resolveFoundryProductId()).toBe(CANONICAL);

    // And survives the impostor keeping the name.
    expect((await query('SELECT name FROM products WHERE id=?', [IMPOSTOR])).rows[0])
      .toMatchObject({ name: 'Foundry' });
    expect(await resolveFoundryProductId()).toBe(CANONICAL);
    await query('UPDATE products SET name=? WHERE id=?', ['Foundry Internal', CANONICAL]);
  });

  it('cannot be claimed, transferred, or destroyed by another entity', async () => {
    // A second claimant is refused by the database, not by the caller.
    await expect(query(
      'INSERT INTO system_identities (identity_key,product_id,established_reason) VALUES (?,?,?)',
      [FOUNDRY_IDENTITY_KEY, IMPOSTOR, 'take it'],
    )).rejects.toThrow(/already_claimed/);

    // The binding is immutable in both directions.
    await expect(query('UPDATE system_identities SET product_id=? WHERE identity_key=?',
      [IMPOSTOR, FOUNDRY_IDENTITY_KEY])).rejects.toThrow(/immutable/);
    await expect(query('DELETE FROM system_identities WHERE identity_key=?',
      [FOUNDRY_IDENTITY_KEY])).rejects.toThrow(/immutable/);

    // New system identities cannot be invented at runtime. Widening the closed
    // vocabulary requires editing a migration, and migrations are inside the
    // constitutional ring ordinary development authority cannot reach.
    await expect(query(
      'INSERT INTO system_identities (identity_key,product_id,established_reason) VALUES (?,?,?)',
      ['platform', IMPOSTOR, 'invented at runtime'],
    )).rejects.toThrow(/unknown_identity/);

    // The service refuses to move it too, and reports the truth rather than
    // silently succeeding.
    expect(await establishSystemIdentity(FOUNDRY_IDENTITY_KEY, IMPOSTOR, 'take it'))
      .toEqual({ established: false, productId: CANONICAL });

    expect(await resolveFoundryProductId()).toBe(CANONICAL);
  });

  it('cannot be substituted by a caller-controlled value', async () => {
    // Resolution accepts no arguments at all: there is nothing to pass.
    expect(resolveFoundryProductId.length).toBe(0);

    // And the keyed form is a closed vocabulary, not a lookup by anything a
    // caller might present — a product id, a name, or a token resolves to
    // nothing rather than to itself.
    for (const attempt of [CANONICAL, IMPOSTOR, 'Foundry', 'foundry.so', '']) {
      expect(await resolveSystemIdentityProductId(attempt as 'foundry'))
        .toBe(attempt === FOUNDRY_IDENTITY_KEY ? CANONICAL : null);
    }
  });

  it('grants zero authority — structurally, not by promise', async () => {
    // There is nothing in the identity record for an authority lookup to read.
    // This is the same constitutional move as migration 118: the absence of a
    // column is the guarantee.
    const cols = (await query('PRAGMA table_info(system_identities)', [])).rows
      .map((r) => String((r as Record<string, unknown>).name));
    expect(cols.sort()).toEqual(
      ['established_at', 'established_reason', 'identity_key', 'product_id']);
    for (const forbidden of ['capability', 'scope', 'consent', 'authority', 'permission',
      'expires_at', 'allowed_path_prefixes_json', 'consequence_boundary']) {
      expect(cols).not.toContain(forbidden);
    }

    // Holding the identity confers no consent, no responsibility, and no
    // standing effect permission. Foundry starts from Unknown like anyone.
    expect(await countOf('SELECT COUNT(*) n FROM autonomy_consents WHERE product_id=?', [CANONICAL])).toBe(0);
    expect(await countOf('SELECT COUNT(*) n FROM institutional_responsibilities WHERE product_id=?', [CANONICAL])).toBe(0);
  });

  it('cannot reach another tenant through being the platform identity', async () => {
    // The identity is an ordinary product id. It carries no cross-tenant read,
    // and nothing about it widens a scope: an effect scoped to the canonical
    // product touches only the canonical product.
    await sendFounderWelcome({
      id: 'si_owner', email: 'owner@foundry.example', name: 'Owner',
      created_at: new Date().toISOString(),
    });
    expect(await countOf(
      "SELECT COUNT(*) n FROM audit_log WHERE product_id=? AND action_type='gateway:send_email'", [IMPOSTOR]))
      .toBe(0);
    expect(await countOf(
      'SELECT COUNT(*) n FROM audit_log WHERE product_id NOT IN (?,?)', [CANONICAL, IMPOSTOR]))
      .toBe(0);
  });

  it('still crosses the ordinary governed consequential-effect boundary', async () => {
    // The point of resolving Foundry's product at all is to give the gateway a
    // scope for its kill-switch and classification checks. Identity must not
    // become a way around that gateway — the send is recorded as a governed
    // invocation against the canonical product, exactly like a customer's.
    expect(await countOf(
      "SELECT COUNT(*) n FROM audit_log WHERE product_id=? AND action_type='gateway:send_email'", [CANONICAL]))
      .toBeGreaterThan(0);

    // The welcome path itself contains no direct send: it goes through invoke().
    const src = readFileSync(
      resolve(process.cwd(), 'src/services/founder/welcome-sequence.ts'), 'utf8');
    expect(src).toMatch(/invoke\(\{/);
    // No provider client, no direct HTTP: the only way out is the gateway.
    // (`RESEND_FROM_ADDRESS` is a From header handed *to* the gateway, not a
    // provider call, so the assertion is about imports and requests.)
    expect(src).not.toMatch(/from '.*integration\/resend/);
    expect(src).not.toMatch(/\bfetch\s*\(/);
  });

  it('is invisible to the institutional kernel', () => {
    // The kernel must not be able to recognise that it is operating Foundry —
    // otherwise canonical identity becomes exactly the special case this
    // migration was meant to avoid. Enforced structurally in
    // tests/unit/recursive-institution.test.ts; asserted here at the import
    // boundary so a new kernel dependency fails loudly.
    const walk = (dir: string): string[] => readdirSync(dir).flatMap((entry) => {
      const path = resolve(dir, entry);
      return statSync(path).isDirectory() ? walk(path)
        : path.endsWith('.ts') ? [path] : [];
    });
    const kernel = [
      ...walk(resolve(process.cwd(), 'src/services/institution')),
      ...walk(resolve(process.cwd(), 'src/services/outbound')),
    ];
    const importers = kernel.filter((p) => /system-identity/.test(readFileSync(p, 'utf8')));
    expect(importers).toEqual([]);
  });
});
