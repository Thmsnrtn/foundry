import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

// =============================================================================
// One authenticator for one credential.
//
// `api_keys` had two readers with the same exported name, `apiKeyAuth`, in two
// obvious places. They did not agree:
//
//   src/api/middleware/auth.ts     checks revoked, checks EXPIRY, reads SCOPES,
//                                  binds to one product.       ← mounted
//   src/middleware/api-key.ts      checks revoked only. No expiry. No scopes.
//                                  Sets the FULL founder.      ← no importers
//
// The dead one was never mounted, so nothing was exploitable. That is not the
// same as harmless: it sat in the more obvious location under the more obvious
// name, and mounting it — the single most natural mistake available — would
// have silently turned every scoped, expiring key into an unscoped, immortal
// one carrying the founder's whole identity.
//
// Worse, `docs/roadmap/SCHEMA-DRIFT-FINDINGS.md` recorded the two BACKWARDS,
// naming the dead module as "the live path used by the mounted v1 routes".
// Acting on that record would have deleted the real authenticator. A stale
// audit is not neutral; it is a confident instruction to do the wrong thing.
//
// So the gate is on the invariant, not on the file: one credential, one
// authenticator, and the checks it must actually perform.
// =============================================================================

const ROOT = resolve(__dirname, '../..');

function walk(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = resolve(dir, e.name);
    return e.isDirectory() ? walk(p) : p.endsWith('.ts') ? [p] : [];
  });
}

/** Every module that resolves a raw API key to an identity. */
function authenticators(): string[] {
  return walk(resolve(ROOT, 'src'))
    .filter((f) => {
      const source = readFileSync(f, 'utf8');
      return /FROM\s+api_keys/i.test(source) && /key_hash\s*=\s*\?/i.test(source);
    })
    .map((f) => f.slice(ROOT.length + 1))
    .sort();
}

describe('api key authentication', () => {
  it('has exactly one module that resolves a key to an identity', () => {
    expect(authenticators(),
      'More than one module authenticates an API key. Two authenticators for one '
      + 'credential means the checks that apply depend on which route you hit:\n'
      + authenticators().join('\n')).toEqual(['src/services/rbac/permissions.ts']);
  });

  it('that one checks revocation, expiry, and scope', () => {
    // The dead duplicate checked only the first. Each of these is a real
    // difference in what a stolen or stale key can still do.
    const source = readFileSync(resolve(ROOT, 'src/services/rbac/permissions.ts'), 'utf8');
    expect(source, 'a revoked key must stop working').toMatch(/revoked_at/);
    expect(source, 'an expired key must stop working').toMatch(/expires_at/);
    expect(source, 'scopes must be resolved, not ignored').toMatch(/scopes/);
  });

  it('every mounted API-key middleware enforces the scope it resolved', () => {
    // Resolving scopes and then not checking them is the same defect one layer
    // along. `requireScope` is the enforcement, and it must exist beside the
    // middleware that sets them.
    const middleware = readFileSync(resolve(ROOT, 'src/api/middleware/auth.ts'), 'utf8');
    expect(middleware).toContain("c.set('scopes'");
    expect(middleware).toMatch(/export const requireScope/);
    expect(middleware, 'a wildcard scope is deliberate and must stay explicit')
      .toMatch(/scopes\.includes\('\*'\)/);
  });

  it('the surfaces behind that credential are the ones we think they are', () => {
    // Both live consumers, named. If a third appears it should be a visible
    // edit here rather than an inherited consequence of importing a helper.
    // Comments are stripped first. A module that MENTIONS the authenticator in
    // prose is not a consumer of it, and counting one as such would make this
    // list drift every time someone explains the design.
    const consumers = walk(resolve(ROOT, 'src'))
      .filter((f) => /validateApiKey/.test(
        readFileSync(f, 'utf8')
          .replace(/^[ \t]*\/\*[\s\S]*?\*\//gm, ' ')
          .split('\n').map((l) => l.replace(/^\s*\/\/.*$/, '')).join('\n')))
      .map((f) => f.slice(ROOT.length + 1))
      .filter((f) => f !== 'src/services/rbac/permissions.ts')
      .sort();
    expect(consumers).toEqual([
      'src/api/middleware/auth.ts',
      'src/routes/api/webhooks/transcripts.ts',
      'src/routes/api/webhooks/voice-reply.ts',
    ]);
  });
});
