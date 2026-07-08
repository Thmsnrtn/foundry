// =============================================================================
// Tests: Integration status consistency (Phase 0.1 / 2.4 regression guard)
//
// The sync adapters guard on a healthy integration status. The original bug:
// they checked 'connected' — a value nothing wrote AND that no `integrations`
// schema's status CHECK permits — so every scheduled sync silently no-op'd and
// agents reasoned over zero telemetry.
//
// The invariant, pinned here: the value the connect paths WRITE == the value
// the adapters CHECK == a value the schema CHECK constraint allows ('active').
// =============================================================================

import { describe, it, expect, beforeAll } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';

const ACTIVE = 'active';

const base = resolve(__dirname, '../../src');
const read = (rel: string) => readFileSync(resolve(base, rel), 'utf-8');

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
  it("connectIntegration writes status = 'active', never 'connected'", () => {
    expect(fabricSrc).toMatch(/status\s*=\s*'active'/);
    expect(fabricSrc).toMatch(/VALUES\s*\([^)]*'active'/s);
    // 'connected' fails the schema CHECK constraint — must never be written.
    expect(fabricSrc).not.toMatch(/status\s*=\s*'connected'/);
    expect(fabricSrc).not.toMatch(/VALUES\s*\([^)]*'connected'/s);
  });

  it("the OAuth connect route writes status = 'active', never 'connected'", () => {
    expect(oauthRouteSrc).toMatch(/status\s*=\s*'active'/);
    expect(oauthRouteSrc).not.toMatch(/SET[^;]*status\s*=\s*'connected'/s);
  });

  it('every sync adapter guards on the same value the connect paths write', () => {
    for (const rel of SYNC_ADAPTERS) {
      const src = read(rel);
      expect(src, `${rel} should compare status to '${ACTIVE}'`).toMatch(
        new RegExp(`status\\s*[!=]==\\s*'${ACTIVE}'`),
      );
      expect(src, `${rel} must not guard on schema-invalid 'connected'`).not.toMatch(
        /status\s*[!=]==\s*'connected'/,
      );
    }
  });

  it("isResendConnected checks the canonical 'active' status", () => {
    expect(resendSrc).toMatch(/status\s*===\s*'active'/);
    expect(resendSrc).not.toMatch(/status\s*===\s*'connected'/);
  });

  it('the migration repairs any stray connected rows to active', () => {
    const migration = readFileSync(
      resolve(base, 'db/migrations/074_integration_status_fix.sql'),
      'utf-8',
    );
    expect(migration).toMatch(
      /UPDATE\s+integrations\s+SET\s+status\s*=\s*'active'\s+WHERE\s+status\s*=\s*'connected'/i,
    );
  });
});
