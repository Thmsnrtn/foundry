process.env.TURSO_DATABASE_URL = 'file::memory:';
process.env.ENCRYPTION_KEY = '0'.repeat(64);

import { readFileSync } from 'node:fs';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { stripComments } from '../../scripts/lib/strip-comments.mjs';
import { runMigrations } from '../../src/db/migrate.js';
import { query } from '../../src/db/client.js';
import {
  checkAndAwardMilestones, getUnseenMilestones, markMilestonesAsSeen,
} from '../../src/services/ux/milestones.js';

// =============================================================================
// FOUR BADGES NOBODY COULD SEE, AND A TOAST FOR THE WRONG COMPANY.
//
// `groupedSidebar` draws exactly one badge — the count beside "Decide". The
// other four numbers in `NavBadges` were computed for every product every six
// hours, written into `lifecycle_state`, read back on every dashboard page
// load, assembled into a struct, and handed to a layout that ignored them: an
// audit's age, unacknowledged competitive signals, unseen milestones and open
// remediation PRs, counted on a schedule for a badge that does not exist. And
// `getLayoutContext` ran its own `remediation_prs` COUNT on every page load for
// the same non-existent badge.
//
// The milestone half was worse than wasted work. `getUnseenMilestones` and
// `markMilestonesAsSeen` were FOUNDER-scoped while both of their callers are
// one company's page: a milestone earned by one company toasted over another
// company's dashboard with nothing to say whose it was, and opening company A's
// journey marked company B's milestones seen — so B's toast never appeared
// again, for a page the founder had not opened.
// =============================================================================

const F = 'f_badge';
const A = 'p_alpha';
const B = 'p_beta';

beforeAll(async () => {
  await runMigrations();
  await query("INSERT INTO founders (id, clerk_user_id, email) VALUES (?,'c_badge','badge@example.com')", [F]);
  await query("INSERT INTO products (id, name, owner_id, status) VALUES (?,'Alpha',?,'active')", [A, F]);
  await query("INSERT INTO products (id, name, owner_id, status) VALUES (?,'Beta',?,'active')", [B, F]);
});

beforeEach(async () => { await query('DELETE FROM milestone_events'); });

async function milestone(id: string, product: string, key: string) {
  await query(
    `INSERT INTO milestone_events (id, founder_id, product_id, milestone_key, milestone_title, milestone_description)
     VALUES (?, ?, ?, ?, 'A milestone', 'You did a thing')`,
    [id, F, product, key],
  );
}

describe('a milestone belongs to the company that earned it', () => {
  it('is not shown on another company’s dashboard', async () => {
    await milestone('m_a', A, 'first_customer');
    await milestone('m_b', B, 'first_customer');

    const alpha = await getUnseenMilestones(F, A);
    expect(alpha.map((m) => m.id)).toEqual(['m_a']);
    const beta = await getUnseenMilestones(F, B);
    expect(beta.map((m) => m.id)).toEqual(['m_b']);
  });

  it('is not marked seen by opening a different company’s journey', async () => {
    await milestone('m_a', A, 'first_customer');
    await milestone('m_b', B, 'first_customer');

    await markMilestonesAsSeen(F, A);

    expect(await getUnseenMilestones(F, A)).toHaveLength(0);
    // The one the founder never looked at is still waiting.
    expect((await getUnseenMilestones(F, B)).map((m) => m.id)).toEqual(['m_b']);
  });

  it('still marks its own as seen', async () => {
    await milestone('m_a', A, 'first_customer');
    await markMilestonesAsSeen(F, A);
    const row = (await query("SELECT seen_at FROM milestone_events WHERE id='m_a'"))
      .rows[0] as unknown as Record<string, unknown>;
    expect(row.seen_at).not.toBeNull();
  });

  it('and awards are per company, so both companies can earn the same one', async () => {
    // `checkAndAwardMilestones` already keys on (founder, product, key); this
    // pins the fact that the reader above must be scoped the same way.
    await milestone('m_a', A, 'first_customer');
    await milestone('m_b', B, 'first_customer');
    const rows = (await query(
      "SELECT product_id FROM milestone_events WHERE milestone_key='first_customer' ORDER BY product_id",
    )).rows as unknown as Array<Record<string, unknown>>;
    expect(rows.map((r) => r.product_id)).toEqual([A, B]);
    expect(await checkAndAwardMilestones(A, F)).toBeInstanceOf(Array);
  });
});

describe('the badges that are not drawn', () => {
  const layout = stripComments(readFileSync('src/views/layout.ts', 'utf8'));
  const shared = stripComments(readFileSync('src/routes/dashboard/_shared.ts', 'utf8'));
  const jobs = stripComments(readFileSync('src/jobs/index.ts', 'utf8'));
  const types = stripComments(readFileSync('src/types/index.ts', 'utf8'));

  it('are gone from the struct rather than computed into it', () => {
    for (const field of ['has_overdue_audit', 'unread_signals', 'unseen_milestones', 'open_prs_count', 'dna_completion']) {
      expect(types, `NavBadges still declares ${field}`).not.toContain(`${field}:`);
      expect(shared, `_shared still computes ${field}`).not.toContain(`${field}:`);
    }
    expect(types).toContain('decisions_count: number;');
  });

  it('are no longer counted on every page load', () => {
    // One COUNT per dashboard page, for a badge that does not exist.
    expect(shared).not.toContain('remediation_prs');
    expect(shared).not.toContain('openPRCount');
    expect(layout).not.toContain('openPRCount');
  });

  it('are no longer swept for every product every six hours', () => {
    expect(jobs).not.toContain('audit_age_days');
    expect(jobs).not.toContain('unread_competitive_signals');
    expect(jobs).not.toContain('open_remediation_prs');
    expect(jobs).not.toContain('unread_milestones');
    // The one that renders is still refreshed.
    expect(jobs).toContain('pending_decisions_count = ?');
  });

  it('and their columns are gone from the schema', async () => {
    const cols = (await query('PRAGMA table_info(lifecycle_state)')).rows as unknown as Array<Record<string, unknown>>;
    const names = cols.map((c) => String(c.name));
    for (const dead of ['audit_age_days', 'unread_competitive_signals', 'open_remediation_prs', 'unread_milestones']) {
      expect(names, `${dead} survived migration 211`).not.toContain(dead);
    }
    expect(names).toContain('pending_decisions_count');
    expect(names, 'dna_completion_pct has a real reader').toContain('dna_completion_pct');
  });
});
