// =============================================================================
// Tests: every permission column has a real enforcement edge
//
// The five `team_members` permission columns were written by the invite flow
// and read by nothing. Batch 51 gave two of them an edge — the decision vote
// and the votes read. This is the other three, and they became urgent the
// moment membership started making the company VISIBLE: before that, an
// invited member could not reach any page at all, so a decorative permission
// was survivable by accident. It is not survivable now.
//
//   can_view_financials  → revenue, ROI, exit, board packet, investor material
//   can_view_audit       → the company's audit trail
//   can_trigger_actions  → approving or cancelling an outward effect
//   can_manage_company   → credentials, integrations, sending address, invites
//
// Router-level rather than per-route, deliberately: a capability that has to be
// remembered on each new handler is one that will be forgotten on one of them.
//
// A stored permission with no reader is not governance. This file is the list
// of readers.
// =============================================================================

process.env.TURSO_DATABASE_URL = 'file::memory:';
process.env.ENCRYPTION_KEY = '0'.repeat(64);

import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync } from 'fs';
import { join, resolve } from 'path';

import { MEMBER_CAPABILITIES } from '../../src/services/team/members.js';

const ROUTES = resolve(__dirname, '../../src/routes');

function allRouteSource(): Array<{ file: string; src: string }> {
  const out: Array<{ file: string; src: string }> = [];
  const walk = (dir: string): void => {
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      const p = join(dir, e.name);
      if (e.isDirectory()) walk(p);
      else if (p.endsWith('.ts')) out.push({ file: p, src: readFileSync(p, 'utf8') });
    }
  };
  walk(ROUTES);
  return out;
}

const SOURCES = allRouteSource();

describe('every capability is consumed by a real route', () => {
  // The defect this file exists for: a column that is written, typed, shown in
  // an invite form, and never asked.
  for (const capability of MEMBER_CAPABILITIES) {
    it(`${capability} gates at least one route`, () => {
      const users = SOURCES.filter((f) =>
        new RegExp(`requireCompanyCapability\\('${capability}'\\)|memberMay\\([^)]*'${capability}'`)
          .test(f.src));
      expect(users.map((u) => u.file),
        `${capability} is stored and nothing reads it — that is not governance`)
        .not.toEqual([]);
    });
  }
});

describe('the financial and audit surfaces are gated at the router', () => {
  const expected: Array<[string, string]> = [
    ['dashboard/audit-log.ts', 'can_view_audit'],
    ['dashboard/revenue.ts', 'can_view_financials'],
    ['dashboard/roi.ts', 'can_view_financials'],
    ['dashboard/exit.ts', 'can_view_financials'],
    ['dashboard/board-packet.ts', 'can_view_financials'],
    ['dashboard/investors.ts', 'can_view_financials'],
  ];

  for (const [file, capability] of expected) {
    it(`${file} requires ${capability} for every route in it`, () => {
      const src = readFileSync(join(ROUTES, file), 'utf8');
      expect(src,
        'router-level: a capability remembered per handler is forgotten on one of them')
        .toMatch(new RegExp(`use\\('\\*',\\s*requireCompanyCapability\\('${capability}'\\)\\)`));
    });
  }
});

describe('approving an outward effect asks who may', () => {
  const src = readFileSync(join(ROUTES, 'dashboard/agents-actions.ts'), 'utf8');

  it('gates approve and cancel on can_trigger_actions', () => {
    for (const route of ['approve', 'cancel']) {
      const at = src.indexOf(`/agents/actions/:id/${route}`);
      expect(at, `the ${route} route must exist`).toBeGreaterThan(-1);
      expect(src.slice(at, at + 400)).toMatch(/requireCompanyCapability\('can_trigger_actions'\)/);
    }
  });

  it('scopes the execution to the company that was authorized, not to ownership', () => {
    // The ownership scope was the only thing keeping a non-owner out, which
    // made approving an outward effect owner-only by accident rather than by
    // decision.
    const executor = readFileSync(
      resolve(__dirname, '../../src/services/scp/actions/executor.ts'), 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, ' ')
      .split('\n').map((l) => l.replace(/^\s*\/\/.*$/, '')).join('\n');
    expect(executor).toMatch(/scopeProductId/);
    expect(executor,
      'scoping approval on owner_id makes the capability column unreachable')
      .not.toMatch(/action_executions[\s\S]{0,200}owner_id/);
  });
});

describe('ownership stays separate from capability', () => {
  const settings = readFileSync(join(ROUTES, 'dashboard/settings.ts'), 'utf8');

  it('keeps the owner-only acts behind an ownership check', () => {
    // Ending the subscription, pausing the company, archiving the product.
    // These are not capabilities anybody can be granted.
    for (const route of ['/checkout', '/settings/manage-subscription',
      '/settings/pause-company', '/settings/resume-company',
      '/settings/toggle-product-status']) {
      const at = settings.indexOf(`'${route}'`);
      expect(at, `${route} must exist`).toBeGreaterThan(-1);
      expect(settings.slice(at, at + 200),
        `${route} is the owner's alone`).toMatch(/requireOwner\(\)/);
    }
  });

  it('puts ordinary company management behind a capability, not ownership', () => {
    for (const route of ['/settings/api-keys', '/settings/sending-identity',
      '/settings/generate-ingest', '/settings/wisdom-toggle']) {
      const at = settings.indexOf(`'${route}'`);
      expect(at, `${route} must exist`).toBeGreaterThan(-1);
      expect(settings.slice(at, at + 200))
        .toMatch(/requireCompanyCapability\('can_manage_company'\)/);
    }
  });
});
