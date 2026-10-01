// =============================================================================
// Tests: Integration status consistency (Phase 0.1 / 2.4 regression guard)
//
// The sync adapters guard on a healthy integration status. The original bug:
// they checked 'connected' — a value nothing wrote AND that no `integrations`
// schema's status CHECK permits — so every scheduled sync silently no-op'd and
// agents reasoned over zero telemetry.
//
// The invariant, pinned here: the value `connectIntegration` WRITES == the value
// the adapters CHECK == a value the schema CHECK constraint allows ('active').
// An OAuth connect route used to be a second writer of that column and is gone
// with the Commercial Foundry surface; the service is the writer that remains,
// and the agreement is between it, the adapters and the schema.
// =============================================================================

import { describe, it, expect, beforeAll } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';

const base = resolve(__dirname, '../../src');
const read = (rel: string) => readFileSync(resolve(base, rel), 'utf-8');

// posthog, sentry, linear, intercom and github adapters were deleted in Roadmap 2027 R4.
// `services/integration/slack.ts`, the last one, was deleted in Roadmap 2027 R10,
// so the list and the block that walked it went with it; `isResendConnected`
// below is the remaining guard on the value.

let fabricSrc: string;
let resendSrc: string;

beforeAll(() => {
  fabricSrc = read('services/integration/fabric.ts');
  resendSrc = read('services/integration/resend.ts');
});

describe('Integration status consistency', () => {
  it("connectIntegration writes status = 'active', never 'connected'", () => {
    expect(fabricSrc).toMatch(/status\s*=\s*'active'/);
    expect(fabricSrc).toMatch(/VALUES\s*\([^)]*'active'/s);
    // 'connected' fails the schema CHECK constraint — must never be written.
    expect(fabricSrc).not.toMatch(/status\s*=\s*'connected'/);
    expect(fabricSrc).not.toMatch(/VALUES\s*\([^)]*'connected'/s);
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
