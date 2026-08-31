process.env.TURSO_DATABASE_URL = 'file::memory:';
process.env.ENCRYPTION_KEY = '0'.repeat(64);

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import { runMigrations } from '../../src/db/migrate.js';
import { query } from '../../src/db/client.js';
import { getCohortPatterns, seedDefaultCohortPatterns } from '../../src/services/network/cohort-patterns.js';
import { stripComments } from '../../scripts/lib/strip-comments.mjs';

// =============================================================================
// FOUNDRY MAY CREATE PRESENTATION. IT MAY NOT FABRICATE EVIDENCE.
//
// Three surfaces asserted things nobody observed:
//
//   • The network-intelligence page said "Observed across 38 similar
//     companies." The only writer of `cohort_patterns` is a seed with 38, 52,
//     44, 29 and 18 typed into the source, and it runs on first page load. Zero
//     companies were counted, and the reader is on a paid tier.
//   • The landing page headed an invented company's invented MRR "A Real
//     Briefing".
//   • `/case-studies` called machine-composed artifacts "Documented evidence
//     from real products, timestamped and verifiable", and the tier-gate sold
//     "cryptographic timestamps" for a `toISOString()`.
//
// The patterns and the example briefing are worth keeping — a prior and an
// illustration are legitimate. What is not legitimate is presenting either as
// something that happened.
// =============================================================================

const ROOT = resolve(__dirname, '../..');

beforeAll(async () => { await runMigrations(); });

describe('a seeded cohort pattern', () => {
  it('is labelled a prior and never claims companies were observed', async () => {
    await seedDefaultCohortPatterns();
    const rows = (await query(
      "SELECT id, evidence_source FROM cohort_patterns")).rows as unknown as Array<Record<string, unknown>>;
    expect(rows.length).toBeGreaterThan(0);
    for (const row of rows) {
      expect(row.evidence_source, `${String(row.id)} was seeded, not observed`).toBe('reference');
    }

    await query(`INSERT OR IGNORE INTO founders (id,clerk_user_id,email) VALUES ('pr_o','pr_c','o@example.com')`);
    await query(`INSERT OR IGNORE INTO products (id,name,owner_id,status,market_category)
                 VALUES ('pr_p','Co','pr_o','active','b2b_saas')`);
    await query(`INSERT OR IGNORE INTO lifecycle_state (product_id,current_prompt)
                 VALUES ('pr_p','prompt_2')`);
    const patterns = await getCohortPatterns('pr_p');
    expect(patterns.length).toBeGreaterThan(0);
    for (const p of patterns) {
      expect(p.insight).not.toContain('Observed across');
      expect(p.insight).toContain('not something it observed');
    }
  });

  it('refuses a source outside the vocabulary, in the database', async () => {
    await expect(query(
      "UPDATE cohort_patterns SET evidence_source='probably observed'"))
      .rejects.toThrow();
  });
});

describe('public surfaces', () => {
  // Comments stripped: an explanatory note that QUOTES the old claim is not
  // the old claim, and a grep cannot tell them apart. Same instrument the
  // gates use.
  const landing = (): string => stripComments(
    readFileSync(resolve(ROOT, 'src/routes/public/landing.ts'), 'utf8'));

  it('does not call an invented company a real briefing', () => {
    const page = landing();
    expect(page).not.toContain('A Real Briefing');
    expect(page).not.toContain('MailDeck');
    expect(page).toContain('an illustration, not a customer');
  });

  it('does not call founder-published artifacts verified evidence', () => {
    expect(landing()).not.toContain('Documented evidence from real products');
  });

  it('does not sell a cryptographic timestamp it does not compute', () => {
    const gate = stripComments(readFileSync(resolve(ROOT, 'src/middleware/tier-gate.ts'), 'utf8'));
    const story = stripComments(readFileSync(resolve(ROOT, 'src/services/story/engine.ts'), 'utf8'));
    expect(gate).not.toContain('cryptographic timestamp');
    expect(story).not.toContain('Cryptographic timestamp');
  });
});
