// =============================================================================
// FOUNDRY — GitHub Integration
// Pulls repository activity, PR/issue signals, and deployment status.
// Normalizes into integration_events for Atlas, Crucible, and Sentinel agents.
// =============================================================================

import { query } from '../../db/client.js';
import { storeEvent, getIntegration, getIntegrationCredentials } from './fabric.js';

// ─── Types ────────────────────────────────────────────────────────────────────

interface GitHubPR {
  number: number;
  title: string;
  state: 'open' | 'closed' | 'merged';
  user: { login: string };
  created_at: string;
  merged_at: string | null;
  draft: boolean;
  /** Absent on list responses. Averaging `|| 0` over it counted misses as zeros. */
  additions?: number;
  deletions: number;
}

interface GitHubIssue {
  number: number;
  title: string;
  state: 'open' | 'closed';
  labels: Array<{ name: string }>;
  created_at: string;
}

interface GitHubDeployment {
  id: number;
  environment: string;
  created_at: string;
}

interface GitHubDeploymentStatus {
  state: 'success' | 'failure' | 'pending' | 'in_progress' | 'error';
  created_at: string;
}

// ─── Public API ───────────────────────────────────────────────────────────────

export async function isGitHubConnected(productId: string): Promise<boolean> {
  const integration = await getIntegration(productId, 'github');
  return integration?.status === 'active';
}

/**
 * Pull recent GitHub activity and store as normalized integration_events.
 * Called by the hourly cron job.
 */
export async function syncGitHubEvents(productId: string): Promise<{ synced: number; error?: string }> {
  const integration = await getIntegration(productId, 'github');
  if (!integration || integration.status !== 'active') {
    return { synced: 0 };
  }

  const token = (await getIntegrationCredentials(productId, 'github')).access_token;
  const org = integration.config_json.org as string | undefined;
  const repo = integration.config_json.repo as string | undefined;

  if (!token) return { synced: 0, error: 'Missing GitHub access token' };

  // Use org/repo if specified, else fall back to user repos
  const repoPath = org && repo ? `${org}/${repo}` : null;

  let synced = 0;

  try {
    if (repoPath) {
      // PR activity (Atlas — code quality)
      const prData = await fetchPRActivity(token, repoPath);
      if (prData) {
        await storeEvent(productId, {
          integration_name: 'github',
          event_type: 'pr_activity',
          actor_type: 'repository',
          actor_id: repoPath,
          data: prData,
        });
        synced++;
      }

      // Issue summary (Crucible — QA)
      const issueData = await fetchIssueSummary(token, repoPath);
      if (issueData) {
        await storeEvent(productId, {
          integration_name: 'github',
          event_type: 'issue_summary',
          actor_type: 'repository',
          actor_id: repoPath,
          data: issueData,
        });
        synced++;
      }

      // Deployment status (Sentinel — DevOps)
      const deployData = await fetchLatestDeployment(token, repoPath);
      if (deployData) {
        await storeEvent(productId, {
          integration_name: 'github',
          event_type: 'deployment_status',
          actor_type: 'repository',
          actor_id: repoPath,
          data: deployData,
        });
        synced++;
      }
    }

    // Commit frequency (Atlas)
    const commitData = await fetchCommitFrequency(token, org, repoPath);
    if (commitData) {
      await storeEvent(productId, {
        integration_name: 'github',
        event_type: 'commit_frequency',
        actor_type: 'repository',
        actor_id: repoPath ?? org ?? 'unknown',
        data: commitData,
      });
      synced++;
    }

    await query(
      `UPDATE integrations SET last_synced_at=CURRENT_TIMESTAMP, last_error=NULL WHERE product_id=? AND name='github'`,
      [productId]
    );

    return { synced };
  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    await query(
      `UPDATE integrations SET last_error=?, error_count_trailing_7d=error_count_trailing_7d+1 WHERE product_id=? AND name='github'`,
      [errorMsg, productId]
    );
    return { synced, error: errorMsg };
  }
}

/**
 * Get a summary of GitHub activity for dashboard display.
 */
export async function getGitHubSummary(productId: string): Promise<{
  connected: boolean;
  openPRs: number | null;
  openIssues: number | null;
  lastDeploymentStatus: string | null;
  lastDeploymentEnv: string | null;
  commitsThisWeek: number | null;
}> {
  const integration = await getIntegration(productId, 'github');
  if (!integration || integration.status !== 'active') {
    return {
      connected: false,
      openPRs: null,
      openIssues: null,
      lastDeploymentStatus: null,
      lastDeploymentEnv: null,
      commitsThisWeek: null,
    };
  }

  const eventsResult = await query(
    `SELECT event_type, data_json FROM integration_events
     WHERE product_id=? AND integration_name='github'
       AND created_at >= datetime('now', '-25 hours')
     ORDER BY created_at DESC`,
    [productId]
  );

  let openPRs: number | null = null;
  let openIssues: number | null = null;
  let lastDeploymentStatus: string | null = null;
  let lastDeploymentEnv: string | null = null;
  let commitsThisWeek: number | null = null;

  for (const row of eventsResult.rows as Record<string, unknown>[]) {
    const data = (() => { try { return JSON.parse(row.data_json as string || '{}'); } catch { return {}; } })();
    if (row.event_type === 'pr_activity') openPRs = Number(data.open_count) || null;
    if (row.event_type === 'issue_summary') openIssues = Number(data.open_count) || null;
    if (row.event_type === 'deployment_status') {
      lastDeploymentStatus = data.status as string ?? null;
      lastDeploymentEnv = data.environment as string ?? null;
    }
    if (row.event_type === 'commit_frequency') commitsThisWeek = Number(data.commits_this_week) || null;
  }

  return { connected: true, openPRs, openIssues, lastDeploymentStatus, lastDeploymentEnv, commitsThisWeek };
}

// ─── Internal API helpers ─────────────────────────────────────────────────────

async function ghFetch<T>(url: string, token: string): Promise<T | null> {
  const resp = await fetch(`https://api.github.com${url}`, {
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
    },
    signal: AbortSignal.timeout(10000),
  });
  if (!resp.ok) return null;
  return resp.json() as Promise<T>;
}

/** One page. A full page means there is probably another, and this says so. */
const PR_PAGE = 100;

/**
 * WHAT ONE PAGE OF PULL REQUESTS CAN AND CANNOT SAY.
 *
 * This is stored as an `integration_events` row and read by Atlas. Three of the
 * five numbers it produced were not what their names said:
 *
 *   `open_count` was the LENGTH OF A CAPPED PAGE — `per_page=20`. A repository
 *   with two hundred open pull requests reported twenty, and an agent reasoning
 *   about engineering load was told the backlog was small. The same shape as a
 *   COUNT taken from `rows.length` under a LIMIT, at the API layer.
 *
 *   `oldest_open_pr_days` took the LAST ITEM OF THE PAGE and called it the
 *   oldest. The request specifies no sort, so position carries no meaning at
 *   all; even under the default order it would be the oldest ON THAT PAGE.
 *
 *   `avg_pr_size_lines` averaged `pr.additions || 0` — so every pull request
 *   whose `additions` was absent counted as a real zero and dragged the mean
 *   down. An average over values that were never reported is not an average of
 *   anything.
 *
 * Each now says what it is. `open_count` is exact when the page was not full and
 * `open_count_at_least` when it was; `oldest_open_pr_days` is computed from the
 * minimum creation date rather than a position, and is null when the page was
 * full because the true oldest is then unseen; the average is over the pull
 * requests that actually reported a size, and null when none did.
 */
async function fetchPRActivity(token: string, repoPath: string): Promise<Record<string, unknown> | null> {
  const [openPRs, recentMerged] = await Promise.all([
    ghFetch<GitHubPR[]>(`/repos/${repoPath}/pulls?state=open&per_page=${PR_PAGE}`, token),
    ghFetch<GitHubPR[]>(`/repos/${repoPath}/pulls?state=closed&per_page=10&sort=updated`, token),
  ]);

  if (!openPRs) return null;

  const truncated = openPRs.length >= PR_PAGE;
  const mergedPRs = (recentMerged ?? []).filter(pr => pr.merged_at !== null);

  const sizes = openPRs
    .map(pr => pr.additions)
    .filter((n): n is number => typeof n === 'number');
  const avgAdditions = sizes.length > 0
    ? Math.round(sizes.reduce((sum, n) => sum + n, 0) / sizes.length)
    : null;

  const oldestCreated = openPRs.length > 0
    ? Math.min(...openPRs.map(pr => new Date(pr.created_at).getTime()))
    : null;

  return {
    // Exact, or a floor — never a floor wearing the name of a total.
    ...(truncated
      ? { open_count_at_least: openPRs.length, open_page_truncated: true }
      : { open_count: openPRs.length, open_page_truncated: false }),
    draft_count_in_page: openPRs.filter(pr => pr.draft).length,
    merged_last_7d: mergedPRs.filter(pr =>
      new Date(pr.merged_at!).getTime() > Date.now() - 7 * 86400 * 1000
    ).length,
    avg_pr_size_lines: avgAdditions,
    pr_sizes_reported: sizes.length,
    oldest_open_pr_days: truncated || oldestCreated === null
      ? null
      : Math.floor((Date.now() - oldestCreated) / 86400000),
  };
}

const ISSUE_PAGE = 100;

async function fetchIssueSummary(token: string, repoPath: string): Promise<Record<string, unknown> | null> {
  const issues = await ghFetch<GitHubIssue[]>(
    `/repos/${repoPath}/issues?state=open&per_page=${ISSUE_PAGE}`,
    token
  );
  if (!issues) return null;

  // Filter out PRs (GitHub API returns PRs as issues too)
  const realIssues = issues.filter(i => !((i as unknown as Record<string, unknown>).pull_request));

  const bugCount = realIssues.filter(i =>
    i.labels.some(l => l.name.toLowerCase().includes('bug') || l.name.toLowerCase().includes('defect'))
  ).length;

  // Same three corrections as the pull-request summary above, for the same
  // reasons. This one is read by Crucible. Note the page is filtered before it
  // is counted — GitHub returns pull requests from the issues endpoint too — so
  // a full page of raw issues can leave far fewer than the cap here and still be
  // truncated; `truncated` is therefore taken from the RAW page length.
  const truncated = issues.length >= ISSUE_PAGE;
  const oldestCreated = realIssues.length > 0
    ? Math.min(...realIssues.map(i => new Date(i.created_at).getTime()))
    : null;

  return {
    ...(truncated
      ? { open_count_at_least: realIssues.length, open_page_truncated: true }
      : { open_count: realIssues.length, open_page_truncated: false }),
    bug_count_in_page: bugCount,
    oldest_issue_days: truncated || oldestCreated === null
      ? null
      : Math.floor((Date.now() - oldestCreated) / 86400000),
    labels: [...new Set(realIssues.flatMap(i => i.labels.map(l => l.name)))].slice(0, 10),
  };
}

async function fetchLatestDeployment(token: string, repoPath: string): Promise<Record<string, unknown> | null> {
  const deployments = await ghFetch<GitHubDeployment[]>(
    `/repos/${repoPath}/deployments?per_page=5`,
    token
  );
  if (!deployments || deployments.length === 0) return null;

  const latest = deployments[0];
  const statuses = await ghFetch<GitHubDeploymentStatus[]>(
    `/repos/${repoPath}/deployments/${latest.id}/statuses?per_page=1`,
    token
  );

  const latestStatus = statuses?.[0];

  return {
    environment: latest.environment,
    status: latestStatus?.state ?? 'unknown',
    deployed_at: latest.created_at,
    hours_since_deploy: Math.floor((Date.now() - new Date(latest.created_at).getTime()) / 3600000),
  };
}

async function fetchCommitFrequency(
  token: string,
  org: string | undefined,
  repoPath: string | null
): Promise<Record<string, unknown> | null> {
  if (!repoPath) return null;

  const commits = await ghFetch<Array<{ commit: { author: { date: string } } }>>(
    `/repos/${repoPath}/commits?per_page=50&since=${new Date(Date.now() - 7 * 86400 * 1000).toISOString()}`,
    token
  );

  if (!commits) return null;

  return {
    commits_this_week: commits.length,
    daily_average: (commits.length / 7).toFixed(1),
    most_active_day: commits.length > 0
      ? new Date(commits[0].commit.author.date).toLocaleDateString('en-US', { weekday: 'long' })
      : null,
  };
}
