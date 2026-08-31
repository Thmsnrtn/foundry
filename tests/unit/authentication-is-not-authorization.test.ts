// =============================================================================
// Tests: the address that decides who is the operator.
//
// `founders.email` looks like a contact field. It is not:
//
//   isFounder(founder.email)  →  the platform-operator surface
//
// and that surface performs deliberately unscoped writes across every tenant
// (`/api/founder/intelligence/decisions-inbox/:id/approve` updates a decision
// row by id with no product scope, by design — it is cross-tenant triage).
//
// Both provisioning paths wrote that column from `emailAddresses[0]` — the
// first entry in an array, which is neither necessarily the PRIMARY address
// nor necessarily VERIFIED. So the entire admin boundary rested on whichever
// address happened to sort first, and on an assumption about the identity
// provider's verification policy rather than on anything checked here.
//
// An adversarial review found it. It is not exploitable against Clerk's
// default policy — which is exactly why it needed a test: the boundary was
// holding for a reason outside this codebase.
// =============================================================================

import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

import { verifiedPrimaryEmail } from '../../src/middleware/auth.js';

const VERIFIED = { status: 'verified' };

describe('only a verified primary address identifies a person', () => {
  it('accepts the verified primary address', () => {
    expect(verifiedPrimaryEmail({
      primaryEmailAddressId: 'e2',
      emailAddresses: [
        { id: 'e1', emailAddress: 'other@example.com', verification: VERIFIED },
        { id: 'e2', emailAddress: 'real@example.com', verification: VERIFIED },
      ],
    })).toBe('real@example.com');
  });

  it('refuses an unverified primary address', () => {
    expect(verifiedPrimaryEmail({
      primaryEmailAddressId: 'e1',
      emailAddresses: [
        { id: 'e1', emailAddress: 'claimed@example.com', verification: { status: 'unverified' } },
      ],
    }), 'an unverified address is not even authentication').toBeNull();
  });

  it('refuses an address with no verification information at all', () => {
    // Absence of a status is not a passing status.
    expect(verifiedPrimaryEmail({
      primaryEmailAddressId: 'e1',
      emailAddresses: [{ id: 'e1', emailAddress: 'silent@example.com' }],
    })).toBeNull();
  });

  it('does not fall back to the first address when no primary is declared', () => {
    // THE ORIGINAL DEFECT. A provider that cannot say which address is primary
    // cannot answer the question this is asking, and picking one is guessing
    // at an identity.
    expect(verifiedPrimaryEmail({
      emailAddresses: [
        { id: 'e1', emailAddress: 'first@example.com', verification: VERIFIED },
      ],
    })).toBeNull();
  });

  it('does not return a verified address that is not the primary one', () => {
    // The attack shape: add a verified address that sorts first while the
    // primary is somebody else's.
    expect(verifiedPrimaryEmail({
      primaryEmailAddressId: 'e2',
      emailAddresses: [
        { id: 'e1', emailAddress: 'attacker@example.com', verification: VERIFIED },
        { id: 'e2', emailAddress: 'owner@example.com', verification: { status: 'unverified' } },
      ],
    })).toBeNull();
  });

  it('refuses an empty or malformed address', () => {
    expect(verifiedPrimaryEmail({
      primaryEmailAddressId: 'e1',
      emailAddresses: [{ id: 'e1', emailAddress: '', verification: VERIFIED }],
    })).toBeNull();
    expect(verifiedPrimaryEmail({
      primaryEmailAddressId: 'e1',
      emailAddresses: [{ id: 'e1', emailAddress: 'not-an-address', verification: VERIFIED }],
    })).toBeNull();
  });
});

describe('both provisioning paths use it', () => {
  it('the session path does not read emailAddresses[0]', () => {
    const src = readFileSync('src/middleware/auth.ts', 'utf8');
    expect(src).toContain('verifiedPrimaryEmail(user)');
    expect(src, 'the first address in an array is not an identity')
      .not.toMatch(/emailAddresses\?\.\[0\]/);
  });

  it('the identity-provider webhook does not read email_addresses[0]', () => {
    const src = readFileSync('src/routes/auth/clerk.ts', 'utf8');
    expect(src).toContain('verifiedPrimaryEmail(');
    expect(src).not.toMatch(/email_addresses[^\n]*\)\?\.\[0\]/);
  });
});

describe('the stripe webhook service checks the company itself', () => {
  it('refuses a product that does not exist, rather than trusting its caller', () => {
    // It was safe only because its single caller verifies an HMAC first — the
    // guard beside the door rather than in it. A second caller added without
    // that check would have made this a cross-tenant write plus an outbound
    // sync of another company's Stripe integration.
    const src = readFileSync('src/services/integrations/framework.ts', 'utf8');
    const fn = src.slice(src.indexOf('export async function processStripeWebhookEvent'));
    const body = fn.slice(0, fn.indexOf('\n}'));
    expect(body).toMatch(/SELECT id FROM products WHERE id = \?/);
    expect(body).toMatch(/throw new Error\(`stripe_webhook: unknown product/);
  });
});

describe('acting on a priority action does not depend on row order', () => {
  it('scopes by ownership across all the founder\'s companies', () => {
    // It resolved `products.rows[0]` — one arbitrary company — so a founder
    // with more than one could only act on whichever the database returned
    // first, and every other action silently did nothing and returned 200.
    const src = readFileSync('src/routes/api/priority.ts', 'utf8');
    const guards = src.match(/JOIN products p ON p\.id = a\.product_id/g) ?? [];
    expect(guards.length, 'both dismiss and complete must scope by owner')
      .toBeGreaterThanOrEqual(2);
  });
});
