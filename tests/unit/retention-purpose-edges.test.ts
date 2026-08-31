// =============================================================================
// Tests: the retention dispositions have a real reader-side edge
//
// Four tables survive an erasure, each with a stated `processing` disposition:
//
//   agent_audit_log        compliance evidence only — never product cognition,
//                          model context, network insight or analytics
//   ai_spend_reservations  accounting and ceiling enforcement only
//   idempotency_keys       duplicate suppression only
//   products               identity resolution only (redacted shell)
//
// A disposition is a claim about what may READ the data afterwards. Until
// something checks it, it is a sentence in a comment: the erasure enforces what
// is KEPT, and nothing enforced what it could then be used FOR.
//
// This is that edge. Every module that selects from a retained table has to be
// one of the purposes its disposition names. A model-context builder, a
// network-insight aggregator, an analytics rollup or a growth system reaching
// into the audit log for an erased company would be exactly the prohibited
// later use — and would land here rather than in a review.
//
// The list is small on purpose. It is not a policy engine; it is the answer to
// "which selector prevents this", written where it can fail.
// =============================================================================

import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'fs';
import { join, relative, resolve } from 'path';

import { RETAINED_ON_ERASURE_REASONS } from '../../src/services/privacy/consent.js';

const SRC = resolve(__dirname, '../../src');

function tsFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((e) => {
    const p = join(dir, e);
    return statSync(p).isDirectory() ? tsFiles(p) : p.endsWith('.ts') ? [p] : [];
  });
}

/** Source with comments blanked: prose about a table is not a read of it. */
function code(file: string): string {
  return readFileSync(file, 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '))
    .split('\n').map((l) => l.replace(/^(\s*)\/\/.*$/, '$1')).join('\n');
}

/**
 * Who may read each retained table, and under which stated purpose. A module
 * added here is a decision that its purpose matches the disposition — which is
 * why the disposition is quoted beside it.
 */
const PERMITTED_READERS: Record<string, { purpose: string; modules: string[] }> = {
  agent_audit_log: {
    purpose: 'compliance evidence only',
    modules: [
      'routes/dashboard/audit-log.ts',   // the founder reading their own trail
      'services/audit/log.ts',           // the trail itself
      'services/privacy/consent.ts',     // the erasure that writes the evidence
    ],
  },
  ai_spend_reservations: {
    purpose: 'accounting and ceiling enforcement only',
    modules: [
      'services/ai/spend-ledger.ts',
      'services/privacy/consent.ts',
    ],
  },
  idempotency_keys: {
    purpose: 'duplicate suppression only',
    modules: [
      'services/outbound/idempotency.ts',
      'services/privacy/consent.ts',
    ],
  },
};

describe('the dispositions this gate covers are the ones that exist', () => {
  it('names a purpose for every retained table it claims to cover', () => {
    for (const table of Object.keys(PERMITTED_READERS)) {
      expect(RETAINED_ON_ERASURE_REASONS[table],
        `${table} is gated here but no longer retained — one of the two is stale`)
        .toBeDefined();
    }
  });

  it('and the purposes still say what this gate says they say', () => {
    for (const [table, { purpose }] of Object.entries(PERMITTED_READERS)) {
      const stated = RETAINED_ON_ERASURE_REASONS[table].processing.toLowerCase();
      const head = purpose.split(' ')[0].toLowerCase();
      expect(stated,
        `${table}'s disposition changed; this gate's reader list was written against the old one`)
        .toContain(head);
    }
  });
});

describe('nothing outside the stated purpose reads a retained table', () => {
  for (const [table, { purpose, modules }] of Object.entries(PERMITTED_READERS)) {
    it(`${table} is read only for ${purpose}`, () => {
      const offenders: string[] = [];
      for (const file of tsFiles(SRC)) {
        const rel = relative(SRC, file);
        if (modules.includes(rel)) continue;
        const src = code(file);
        const re = new RegExp(`FROM\\s+${table}\\b`, 'i');
        if (re.test(src)) offenders.push(rel);
      }
      expect(offenders,
        `${table} survives an erasure for ${purpose}. A reader outside that purpose `
        + 'is the prohibited later use the disposition exists to prevent — add it to '
        + 'PERMITTED_READERS only if its purpose genuinely matches.')
        .toEqual([]);
    });
  }
});

describe('the redacted product shell is not a company record', () => {
  it('erasure clears everything that described the company', () => {
    // `products` is retained for identity resolution: the id must not be
    // reissued and foreign keys must stay resolvable. Everything that made the
    // row a description of a company is cleared, so a reader that does reach
    // it finds a shell rather than a business.
    const disposition = RETAINED_ON_ERASURE_REASONS.products;
    const cleared = new Set([
      ...(disposition.redactColumns ?? []), ...(disposition.redactToMarker ?? []),
    ]);
    for (const column of ['name', 'stack_description', 'market_category',
      'github_repo_url', 'github_access_token', 'ingest_token', 'share_token']) {
      expect(cleared.has(column), `${column} still describes the company`).toBe(true);
    }
  });
});
