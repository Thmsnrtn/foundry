process.env.TURSO_DATABASE_URL = 'file::memory:';
process.env.ENCRYPTION_KEY = '0'.repeat(64);

import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { stripComments } from '../../scripts/lib/strip-comments.mjs';
import { runMigrations } from '../../src/db/migrate.js';
import { query } from '../../src/db/client.js';
import { syncGitHubEvents } from '../../src/services/integration/github.js';

// =============================================================================
// ONE PAGE IS NOT THE WHOLE BACKLOG.
//
// These summaries are stored as `integration_events` and read by Atlas (pull
// requests) and Crucible (issues). Three of the numbers were not what their
// names said:
//
//   `open_count` was THE LENGTH OF A CAPPED PAGE — `per_page=20` for pull
//   requests, 50 for issues. A repository with two hundred open pull requests
//   reported twenty, and the agent reasoning about engineering load was told
//   the backlog was small. The same shape as a COUNT taken from `rows.length`
//   under a LIMIT, one layer out at the API.
//
//   `oldest_open_pr_days` took the LAST ITEM OF THE PAGE and called it the
//   oldest. The request specifies no sort at all, so position carries no
//   meaning; even under a default order it would be the oldest ON THAT PAGE.
//
//   `avg_pr_size_lines` averaged `pr.additions || 0`, so every pull request
//   whose size was absent counted as a real zero. An average over values that
//   were never reported is not an average of anything.
//
// Each says what it is now: an exact count or a floor that is NAMED a floor;
// an age computed from the minimum creation date, null when the page was full
// because the true oldest is then unseen; and a mean over the pull requests
// that actually reported a size.
// =============================================================================

const P = 'p_gh';

beforeAll(async () => {
  await runMigrations();
  await query("INSERT INTO founders (id, clerk_user_id, email) VALUES ('f_gh','c_gh','g@example.com')");
  await query(
    `INSERT INTO products (id, name, owner_id, status, github_repo_url)
     VALUES (?,'Acme','f_gh','active','https://github.com/acme/app')`, [P]);
  await query(
    `INSERT INTO integrations (id, product_id, type, provider, name, status,
                               credentials_json, config_json)
     VALUES ('int_gh', ?, 'github', 'github', 'github', 'active', ?, ?)`,
    [P, JSON.stringify({ access_token: 'ghp_test' }),
     JSON.stringify({ org: 'acme', repo: 'app' })]);
});
beforeEach(async () => { await query('DELETE FROM integration_events'); });
afterEach(() => { vi.unstubAllGlobals(); });

function pr(i: number, extra: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    number: i, draft: false, merged_at: null, title: `PR ${i}`, user: { login: 'a' },
    created_at: new Date(Date.now() - i * 86400000).toISOString(),
    updated_at: new Date().toISOString(), ...extra,
  };
}

function githubReturns(openPRs: unknown[], issues: unknown[] = []): void {
  vi.stubGlobal('fetch', async (url: string) => {
    const u = String(url);
    const body = u.includes('/pulls?state=open') ? openPRs
      : u.includes('/issues?state=open') ? issues
      : [];
    return { ok: true, status: 200, json: async () => body, text: async () => '[]' };
  });
}

async function prSummary(): Promise<Record<string, unknown>> {
  const row = (await query(
    "SELECT data_json FROM integration_events WHERE product_id=? AND event_type='pr_activity'", [P]))
    .rows[0] as Record<string, unknown>;
  return JSON.parse(String(row.data_json)) as Record<string, unknown>;
}

describe('a count from one page', () => {
  it('is exact when the page was not full', async () => {
    githubReturns([pr(1), pr(2), pr(3)]);
    await syncGitHubEvents(P);

    const s = await prSummary();
    expect(s.open_count).toBe(3);
    expect(s.open_page_truncated).toBe(false);
    expect(s.open_count_at_least).toBeUndefined();
  });

  it('is named a floor when the page was full', async () => {
    githubReturns(Array.from({ length: 100 }, (_, i) => pr(i + 1)));
    await syncGitHubEvents(P);

    const s = await prSummary();
    expect(s.open_count, 'a floor must not wear the name of a total').toBeUndefined();
    expect(s.open_count_at_least).toBe(100);
    expect(s.open_page_truncated).toBe(true);
  });
});

describe('the oldest open pull request', () => {
  it('is the minimum creation date, not the last position', async () => {
    // Deliberately unsorted: the oldest is in the middle.
    githubReturns([pr(1), pr(90), pr(5)]);
    await syncGitHubEvents(P);

    const s = await prSummary();
    expect(Number(s.oldest_open_pr_days),
      'position carries no meaning in a request that specifies no sort').toBe(90);
  });

  it('is unknown when the page was full', async () => {
    githubReturns(Array.from({ length: 100 }, (_, i) => pr(i + 1)));
    await syncGitHubEvents(P);
    expect((await prSummary()).oldest_open_pr_days,
      'the true oldest is on a page nobody fetched').toBeNull();
  });
});

describe('the average pull request size', () => {
  it('averages only the ones that reported a size', async () => {
    githubReturns([pr(1, { additions: 100 }), pr(2, { additions: 300 }), pr(3)]);
    await syncGitHubEvents(P);

    const s = await prSummary();
    expect(Number(s.avg_pr_size_lines), 'the third would have averaged in as a real 0').toBe(200);
    expect(Number(s.pr_sizes_reported)).toBe(2);
  });

  it('is unknown when none of them did', async () => {
    githubReturns([pr(1), pr(2)]);
    await syncGitHubEvents(P);

    const s = await prSummary();
    expect(s.avg_pr_size_lines).toBeNull();
    expect(Number(s.pr_sizes_reported)).toBe(0);
  });
});

describe('the arithmetic that produced them is gone', () => {
  it('no positional oldest, no zero-filled average', () => {
    const code = stripComments(
      readFileSync('src/services/integration/github.ts', 'utf8'), { lineComments: true });
    expect(code).not.toMatch(/openPRs\[openPRs\.length - 1\]/);
    expect(code).not.toMatch(/realIssues\[realIssues\.length - 1\]/);
    expect(code).not.toMatch(/pr\.additions \|\| 0/);
  });
});
