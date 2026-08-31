// =============================================================================
// Tests: an expired permission is not a permission
//
// `autonomy_consents.expires_at` exists (migration 112) and two readers
// disagree about whether it matters:
//
//   activeResponsibilityAuthority   AND datetime(expires_at) > datetime('now')
//   activeConsent / hasActConsent   nothing
//
// The second is the gate the autopilot uses — "a live recorded consent must
// exist (Consent Ledger)" — so a time-boxed grant kept licensing autonomous
// action after the hour it was given for. The rule exists, it is enforced in
// one reader, and the other binds to a weaker predicate.
//
// The three-valued trap on the way in: `expires_at` is NULL for a standing
// grant, and `datetime(NULL) > datetime('now')` is NULL, which is not true. A
// bare comparison would have revoked every open-ended consent in the system —
// the fix for a fail-open must not be a fail-closed that silently disarms the
// product.
// =============================================================================

process.env.TURSO_DATABASE_URL = 'file::memory:';
process.env.ENCRYPTION_KEY = '0'.repeat(64);

import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { nanoid } from 'nanoid';

import { runMigrations } from '../../src/db/migrate.js';
import { query } from '../../src/db/client.js';
import { activeConsent, hasActConsent } from '../../src/services/autopilot/consent.js';

const F = 'ce_founder';
const P = 'ce_product';
const CAP = 'customer_success';

async function grant(expiresAt: string | null): Promise<void> {
  await query(
    `INSERT INTO autonomy_consents
       (id, founder_id, product_id, capability, from_mode, to_mode,
        disclosure_version, expires_at)
     VALUES (?, ?, ?, ?, 'suggest', 'act', 'v1', ?)`,
    [nanoid(), F, P, CAP, expiresAt]);
}

beforeAll(async () => {
  await runMigrations();
  await query(`INSERT INTO founders (id, clerk_user_id, email) VALUES (?,?,?)`,
    [F, 'ce_clerk', 'ce@example.com']);
  await query(
    `INSERT INTO products (id, name, owner_id, status) VALUES (?,'Consent Co',?, 'active')`,
    [P, F]);
});

beforeEach(async () => {
  await query('DELETE FROM autonomy_consents WHERE product_id = ?', [P]);
});

describe('the act gate reads the expiry', () => {
  it('does not license action on a grant that has run out', async () => {
    await grant(new Date(Date.now() - 3600_000).toISOString());
    expect(await hasActConsent(P, CAP),
      'an hour-long grant given yesterday is not permission today').toBe(false);
    expect(await activeConsent(P, CAP)).toBeNull();
  });

  it('licenses action on a grant that is still live', async () => {
    await grant(new Date(Date.now() + 3600_000).toISOString());
    expect(await hasActConsent(P, CAP)).toBe(true);
  });

  it('licenses action on a standing grant with no expiry', async () => {
    // NULL means "until revoked". A predicate that treated it as expired would
    // revoke every open-ended consent in the system — the fix for a fail-open
    // must not be a fail-closed that disarms the product.
    await grant(null);
    expect(await hasActConsent(P, CAP)).toBe(true);
  });

  it('still honours revocation, whatever the expiry says', async () => {
    await grant(new Date(Date.now() + 3600_000).toISOString());
    await query(
      `UPDATE autonomy_consents SET revoked_at = datetime('now') WHERE product_id = ?`, [P]);
    expect(await hasActConsent(P, CAP)).toBe(false);
  });

  it('prefers a live grant over an expired one for the same capability', async () => {
    // The reader takes the most recent by acceptance, so an expired grant
    // accepted later must not shadow a live one.
    await grant(null);
    await grant(new Date(Date.now() - 60_000).toISOString());
    expect(await hasActConsent(P, CAP),
      'a lapsed grant must not hide a standing one').toBe(true);
  });
});

describe('the two readers agree', () => {
  it('both bind the expiry, rather than one of them', async () => {
    const { readFileSync } = await import('fs');
    const { resolve } = await import('path');
    const source = readFileSync(
      resolve(__dirname, '../../src/services/autopilot/consent.ts'), 'utf8');
    const readers = source.match(/expires_at/g) ?? [];
    expect(readers.length,
      'one reader honouring an expiry and another ignoring it is the whole defect')
      .toBeGreaterThanOrEqual(2);
  });
});
