process.env.TURSO_DATABASE_URL = 'file::memory:';
process.env.ENCRYPTION_KEY = '0'.repeat(64);

import { afterEach, describe, expect, it } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { mayBeAdmitted, getOwnerEmail } from '../../src/lib/instance-posture.js';
import { isFounder } from '../../src/services/founder/intelligence.js';

// =============================================================================
// ONE PRINCIPAL, ONE INSTITUTION.
//
// A private Foundry exists to operate one owner's companies. Every other
// account inside it is a stranger. That was enforced nowhere: `authMiddleware`
// auto-provisioned a founder row for ANY Clerk user with a verified primary
// address, so on a public hostname anyone who found the URL could obtain an
// account, create companies inside the owner's institution, and spend his model
// budget doing it. The only check was that the identity provider had verified
// the address — the right question for a commercial service, the wrong one
// here.
//
// The owner's address was also a literal compiled into four files, one of them
// the sole thing standing between a session and the platform-operator surface,
// which performs deliberately unscoped writes across every tenant. An
// authorization boundary in source cannot be changed without a release, and
// silently redirects the owner to /dashboard if his verified primary address
// ever differs from the string somebody typed.
// =============================================================================

const PRIVATE = { FOUNDRY_INSTANCE_POSTURE: 'private_owner', FOUNDRY_OWNER_EMAIL: 'owner@example.com' };
const COMMERCIAL = { FOUNDRY_INSTANCE_POSTURE: 'commercial' };
const saved = { ...process.env };
afterEach(() => {
  delete process.env.FOUNDRY_OWNER_EMAIL;
  if (saved.FOUNDRY_INSTANCE_POSTURE === undefined) delete process.env.FOUNDRY_INSTANCE_POSTURE;
  else process.env.FOUNDRY_INSTANCE_POSTURE = saved.FOUNDRY_INSTANCE_POSTURE;
});

describe('a private institution admits its owner and nobody else', () => {
  it('admits the configured owner', () => {
    expect(mayBeAdmitted('owner@example.com', PRIVATE)).toBe(true);
    expect(mayBeAdmitted('  Owner@Example.COM ', PRIVATE), 'case and spacing are not identity')
      .toBe(true);
  });

  it('refuses every other verified address', () => {
    for (const stranger of ['someone@example.com', 'owner@example.co', 'owner+alias@example.com', '']) {
      expect(mayBeAdmitted(stranger, PRIVATE), stranger).toBe(false);
    }
  });

  it('does not restrict a commercial deployment, which exists to admit people', () => {
    expect(mayBeAdmitted('anyone@example.com', COMMERCIAL)).toBe(true);
  });
});

describe('the owner is deployment configuration, not a literal in source', () => {
  it('reads the configured owner', () => {
    expect(getOwnerEmail({ FOUNDRY_OWNER_EMAIL: 'Someone@Example.com' })).toBe('someone@example.com');
  });

  it('keeps the historic value when unconfigured, so nothing breaks by omission', () => {
    expect(getOwnerEmail({})).toBe('thmsnrtn@gmail.com');
  });

  it('gates the platform-operator surface on that same one definition', () => {
    process.env.FOUNDRY_OWNER_EMAIL = 'owner@example.com';
    expect(isFounder('owner@example.com')).toBe(true);
    expect(isFounder('thmsnrtn@gmail.com'),
      'the old literal must no longer be an authorization answer').toBe(false);
  });

  it('has exactly one definition of the owner address in src/', () => {
    // Four copies is four places a boundary can be forgotten. This asserts the
    // count rather than the value, so changing the owner does not break it.
    const files: string[] = [];
    const walk = (d: string): void => {
      for (const e of readdirSync(d)) {
        const f = join(d, e);
        if (statSync(f).isDirectory()) walk(f);
        else if (f.endsWith('.ts')) files.push(f);
      }
    };
    walk(resolve(import.meta.dirname, '../../src'));
    const hits = files.filter((f) => readFileSync(f, 'utf8').includes('thmsnrtn@gmail.com'));
    expect(hits.map((f) => f.split('/src/')[1]),
      'the owner address should exist once, as a documented default').toEqual(['lib/instance-posture.ts']);
  });
});
