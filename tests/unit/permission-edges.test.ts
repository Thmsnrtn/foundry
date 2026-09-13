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

// EVERY DOOR, NOT THE THREE THIS FILE HAPPENED TO KNOW. The scan walked
// `src/routes` alone, so a capability enforced anywhere else read as enforced
// by nothing. On 13 September 2026 that nearly cost `can_vote_decisions`: its
// only consumer is `foundry_resolve_decision` in the MCP loop, and with the
// commercial routes deleted the gate reported it dead and the capability was
// very nearly removed from the vocabulary — which would have let any key
// resolve a company's decisions. The institution has four doors; this walks
// all of them, and the services the doors call.
const ROUTES = resolve(__dirname, '../../src/routes');
const SEARCHED = ['src/routes', 'src/mcp', 'src/api', 'src/jobs', 'src/services']
  .map((d) => resolve(__dirname, '../..', d));

function allRouteSource(): Array<{ file: string; src: string }> {
  const out: Array<{ file: string; src: string }> = [];
  const walk = (dir: string): void => {
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      const p = join(dir, e.name);
      if (e.isDirectory()) walk(p);
      else if (p.endsWith('.ts')) out.push({ file: p, src: readFileSync(p, 'utf8') });
    }
  };
  for (const root of SEARCHED) walk(root);
  return out;
}

const SOURCES = allRouteSource();

describe('every capability is consumed by something that runs', () => {
  // The defect this file exists for: a column that is written, typed, shown in
  // an invite form, and never asked.
  for (const capability of MEMBER_CAPABILITIES) {
    it(`${capability} gates at least one live door`, () => {
      const users = SOURCES.filter((f) =>
        new RegExp(`requireCompanyCapability\\('${capability}'\\)|memberMay\\([^)]*'${capability}'`)
          .test(f.src));
      expect(users.map((u) => u.file),
        `${capability} is stored and nothing reads it — that is not governance`)
        .not.toEqual([]);
    });
  }
});

// THE SIX ROUTERS THIS SECTION GUARDED ARE GONE. `audit-log`, `revenue`,
// `roi`, `exit`, `board-packet` and `investors` were Commercial Foundry and
// were deleted on 13 September 2026, and with them the only readers of
// `can_view_audit`, `can_view_financials` and `can_view_decisions` — which is
// why those three are no longer in `MEMBER_CAPABILITIES` at all. The property
// this section held, that a router-level guard must cover every route declared
// inside it, is kept above: the capability scan now walks every entry point,
// so the next router to claim a capability has to actually consult it.

describe('approving an outward effect asks who may', () => {
  // THE PAGE THAT ASKED IS GONE. `routes/dashboard/agents-actions.ts` carried
  // the approve and cancel doors and was deleted on 13 September 2026 with the
  // rest of Commercial Foundry, so the half of this that read its source went
  // with it. What it was really protecting is underneath and still here: the
  // executor must scope an approved action to the company that authorised it,
  // not to whoever owns the company.
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
