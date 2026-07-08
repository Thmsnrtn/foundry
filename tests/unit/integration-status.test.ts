// =============================================================================
// Tests: Integration status consistency (Phase 0.1 regression guard)
//
// A previous version wrote status = 'active' when connecting an integration,
// while every sync adapter guards on status === 'connected'. Nothing wrote
// 'connected', so every scheduled sync was a silent no-op and agents reasoned
// over zero telemetry.
//
// These static-analysis tests pin the invariant: the value the connect paths
// WRITE must equal the value the sync adapters CHECK. If they ever diverge
// again, this suite fails instead of the bug silently shipping.
// =============================================================================

import { describe, it, expect, beforeAll } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';

const CONNECTED = 'connected';

const base = resolve(__dirname, '../../src');
const read = (rel: string) => readFileSync(resolve(base, rel), 'utf-8');

// Adapters that gate their sync on the integration being connected.
const SYNC_ADAPTERS = [
  'services/integration/posthog.ts',
  'services/integration/sentry.ts',
  'services/integration/linear.ts',
  'services/integration/slack.ts',
  'services/integration/intercom.ts',
  'services/integration/github.ts',
];

let fabricSrc: string;
let resendSrc: string;
let oauthRouteSrc: string;

beforeAll(() => {
  fabricSrc = read('services/integration/fabric.ts');
  resendSrc = read('services/integration/resend.ts');
  oauthRouteSrc = read('routes/dashboard/integrations.ts');
});

describe('Integration status consistency', () => {
  it("connectIntegration writes status = 'connected', never 'active'", () => {
    // The two write sites (UPDATE + INSERT) in connectIntegration.
    expect(fabricSrc).toMatch(/status\s*=\s*'connected'/);
    expect(fabricSrc).toMatch(/VALUES\s*\([^)]*'connected'/s);
    // Guard against the regression returning.
    expect(fabricSrc).not.toMatch(/status\s*=\s*'active'/);
    expect(fabricSrc).not.toMatch(/VALUES\s*\([^)]*'active'/s);
  });

  it("the OAuth connect route writes status = 'connected', never 'active'", () => {
    expect(oauthRouteSrc).toMatch(/status\s*=\s*'connected'/);
    expect(oauthRouteSrc).not.toMatch(/SET[^;]*status\s*=\s*'active'/s);
    expect(oauthRouteSrc).not.toMatch(/VALUES\s*\([^)]*'active'/s);
  });

  it('every sync adapter guards on the same value the connect paths write', () => {
    for (const rel of SYNC_ADAPTERS) {
      const src = read(rel);
      // Each adapter has a connection check and at least one sync guard.
      expect(src, `${rel} should compare status to '${CONNECTED}'`).toMatch(
        new RegExp(`status\\s*[!=]==\\s*'${CONNECTED}'`),
      );
      // No adapter should be checking the stale 'active' value.
      expect(src, `${rel} must not guard on stale 'active'`).not.toMatch(
        /integration[^\n]*status\s*[!=]==\s*'active'/,
      );
    }
  });

  it("isResendConnected checks the canonical 'connected' status", () => {
    expect(resendSrc).toMatch(/status\s*===\s*'connected'/);
    expect(resendSrc).not.toMatch(/status\s*===\s*'active'/);
  });

  it('a data migration repairs legacy active rows', () => {
    const migration = readFileSync(
      resolve(base, 'db/migrations/074_integration_status_fix.sql'),
      'utf-8',
    );
    expect(migration).toMatch(
      /UPDATE\s+integrations\s+SET\s+status\s*=\s*'connected'\s+WHERE\s+status\s*=\s*'active'/i,
    );
  });
});
