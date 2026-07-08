// =============================================================================
// Tests: Async onboarding audit progress (Phase 1.1 / 1.2)
//
// The onboarding audit used to be a blocking 2-5 minute POST that redirected
// straight to the dashboard (often with an empty briefing card). It now runs
// async with a polled progress page, and awaits the first briefing before
// redirecting. These static checks pin that structure.
// =============================================================================

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';

const base = resolve(__dirname, '../../src');
const read = (rel: string) => readFileSync(resolve(base, rel), 'utf-8');

describe('onboarding audit is asynchronous with progress', () => {
  const route = read('routes/dashboard/onboarding.ts');

  it('run-audit starts progress tracking and returns a progress page (not a blocking redirect)', () => {
    expect(route).toMatch(/startAuditProgress\(/);
    expect(route).toMatch(/auditProgressPage\(/);
    // The handler must not synchronously redirect to the dashboard anymore —
    // the redirect happens via HX-Redirect once the poll sees completion.
    const handler = route.slice(route.indexOf("post('/onboarding/run-audit'"));
    const postHandler = handler.slice(0, handler.indexOf("get('/onboarding/audit-status'"));
    expect(postHandler).not.toMatch(/c\.redirect\('\/dashboard/);
  });

  it('exposes a tenant-scoped audit-status poll endpoint', () => {
    expect(route).toMatch(/get\('\/onboarding\/audit-status'/);
    // Poll must scope by owner_id — a cross-tenant progress read is a leak.
    const poll = route.slice(route.indexOf("get('/onboarding/audit-status'"));
    expect(poll).toMatch(/owner_id\s*=\s*\?/);
    expect(poll).toMatch(/HX-Redirect/);
  });

  it('awaits the first briefing before completing (never an empty flagship card)', () => {
    expect(route).toMatch(/Writing your first briefing/);
    expect(route).toMatch(/await generateDailyBriefing/);
    expect(route).toMatch(/completeAuditProgress\(/);
  });

  it('runAudit reports progress via an onProgress callback', () => {
    const engine = read('services/audit/engine.ts');
    expect(engine).toMatch(/onProgress\?:\s*AuditProgressReporter/);
    expect(engine).toMatch(/await report\(\d+,/);
    expect(engine).toMatch(/Scoring across 10 dimensions/);
  });
});
