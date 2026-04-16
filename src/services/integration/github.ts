// =============================================================================
// FOUNDRY — GitHub Integration
// Pulls repository activity, PR/issue signals, and deployment status.
// Normalizes into integration_events for Atlas, Crucible, and Sentinel agents.
// =============================================================================

import { query } from '../../db/client.js';
import { storeEvent, getIntegration } from './fabric.js';

// ─── Types ────────────────────────────────────────────────────────────────────

interface GitHubPR {
  number: number;
  title: string;
  state: 'open' | 'closed' | 'merged';
  user: { login: string };
  created_at: string;
  merged_at: string | null;
  draft: boolean;
  additions: number;
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
  return integration?.status === 'connected';
}

/**
 * Pull recent GitHub activity and store as normalized integration_events.
 * Called by the hourly cron job.
 */
export async function syncGitHubEvents(productId: string): Promise<{ synced: number; error?: string }> {
  const integration = await getIntegration(productId, 'github');
  if (!integration || integration.status !== 'connected') {
    return { synced: 0 };
  }

  const token = integration.config_json.access_token as string | undefined;
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
  if (!integration || integration.status !== 'connected') {
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

async function fetchPRActivity(token: string, repoPath: string): Promise<Record<string, unknown> | null> {
  const [openPRs, recentMerged] = await Promise.all([
    ghFetch<GitHubPR[]>(`/repos/${repoPath}/pulls?state=open&per_page=20`, token),
    ghFetch<GitHubPR[]>(`/repos/${repoPath}/pulls?state=closed&per_page=10&sort=updated`, token),
  ]);

  if (!openPRs) return null;

  const mergedPRs = (recentMerged ?? []).filter(pr => pr.merged_at !== null);
  const avgAdditions = openPRs.length > 0
    ? openPRs.reduce((sum, pr) => sum + (pr.additions || 0), 0) / openPRs.length
    : 0;

  return {
    open_count: openPRs.length,
    draft_count: openPRs.filter(pr => pr.draft).length,
    merged_last_7d: mergedPRs.filter(pr =>
      new Date(pr.merged_at!).getTime() > Date.now() - 7 * 86400 * 1000
    ).length,
    avg_pr_size_lines: Math.round(avgAdditions),
    oldest_open_pr_days: openPRs.length > 0
      ? Math.floor((Date.now() - new Date(openPRs[openPRs.length - 1].created_at).getTime()) / 86400000)
      : 0,
  };
}

async function fetchIssueSummary(token: string, repoPath: string): Promise<Record<string, unknown> | null> {
  const issues = await ghFetch<GitHubIssue[]>(
    `/repos/${repoPath}/issues?state=open&per_page=50`,
    token
  );
  if (!issues) return null;

  // Filter out PRs (GitHub API returns PRs as issues too)
  const realIssues = issues.filter(i => !((i as unknown as Record<string, unknown>).pull_request));

  const bugCount = realIssues.filter(i =>
    i.labels.some(l => l.name.toLowerCase().includes('bug') || l.name.toLowerCase().includes('defect'))
  ).length;

  return {
    open_count: realIssues.length,
    bug_count: bugCount,
    oldest_issue_days: realIssues.length > 0
      ? Math.floor((Date.now() - new Date(realIssues[realIssues.length - 1].created_at).getTime()) / 86400000)
      : 0,
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
