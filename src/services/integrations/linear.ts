// =============================================================================
// FOUNDRY — Linear Integration
// Bi-directional: pull ship cadence as execution health metric.
// Push: create Linear issues from audit blocking issues automatically.
// =============================================================================

import { query } from '../../db/client.js';
import { nanoid } from 'nanoid';

interface LinearCredentials {
  api_key: string;
  team_id?: string;
}

interface LinearIssue {
  id: string;
  identifier: string;
  title: string;
  state: { name: string; type: string };
  completedAt: string | null;
  createdAt: string;
  priority: number;
  labels: { nodes: Array<{ name: string }> };
}

interface LinearTeam {
  id: string;
  name: string;
  key: string;
}

// ─── Core Sync Function ───────────────────────────────────────────────────────

/**
 * Pull ship cadence from Linear: issues completed this week as execution velocity.
 * Stores as custom_metrics.linear_velocity in metric_snapshots.
 */
export async function syncLinearMetrics(
  productId: string,
  integrationId: string,
  credentials: LinearCredentials,
): Promise<{ metricsUpdated: string[]; recordsProcessed: number }> {
  const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
  const today = new Date().toISOString().slice(0, 10);

  const completedIssues = await fetchCompletedIssues(credentials, sevenDaysAgo);

  if (completedIssues.length === 0) {
    await query(
      `UPDATE integrations SET last_synced_at = CURRENT_TIMESTAMP, last_error = NULL WHERE id = ?`,
      [integrationId],
    );
    return { metricsUpdated: [], recordsProcessed: 0 };
  }

  // Store ship velocity in custom_metrics
  const existingResult = await query(
    `SELECT custom_metrics FROM metric_snapshots WHERE product_id = ? AND snapshot_date = ?`,
    [productId, today],
  );

  const existing = existingResult.rows[0] as Record<string, unknown> | undefined;
  const customMetrics = existing?.custom_metrics
    ? JSON.parse(existing.custom_metrics as string) as Record<string, unknown>
    : {};

  customMetrics.linear_velocity_7d = completedIssues.length;
  customMetrics.linear_last_sync = new Date().toISOString();

  await query(
    `INSERT INTO metric_snapshots (id, product_id, snapshot_date, custom_metrics)
     VALUES (?, ?, ?, ?)
     ON CONFLICT(product_id, snapshot_date) DO UPDATE SET custom_metrics = ?`,
    [nanoid(), productId, today, JSON.stringify(customMetrics), JSON.stringify(customMetrics)],
  );

  await query(
    `UPDATE integrations SET last_synced_at = CURRENT_TIMESTAMP, last_error = NULL,
     records_synced_total = records_synced_total + ? WHERE id = ?`,
    [completedIssues.length, integrationId],
  );

  return { metricsUpdated: ['custom_metrics.linear_velocity_7d'], recordsProcessed: completedIssues.length };
}

// ─── Push: Create Linear Issue from Blocking Issue ───────────────────────────

/**
 * Create a Linear issue from a Foundry audit blocking issue.
 * Returns the Linear issue URL for storing in the blocking issue evidence.
 */
export async function createLinearIssueFromBlockingIssue(
  credentials: LinearCredentials,
  blockingIssue: {
    id: string;
    dimension: string;
    issue: string;
    definition_of_done: string;
    evidence: string;
  },
  productName: string,
): Promise<{ url: string; identifier: string } | null> {
  const teamId = credentials.team_id ?? await getFirstTeamId(credentials);
  if (!teamId) return null;

  const mutation = `
    mutation CreateIssue($input: IssueCreateInput!) {
      issueCreate(input: $input) {
        issue {
          id
          identifier
          url
        }
      }
    }
  `;

  const variables = {
    input: {
      teamId,
      title: `[Foundry] ${blockingIssue.dimension}: ${blockingIssue.issue}`,
      description: `**Source:** Foundry Audit — ${blockingIssue.dimension}\n\n**Issue:** ${blockingIssue.issue}\n\n**Evidence:** ${blockingIssue.evidence}\n\n**Definition of Done:** ${blockingIssue.definition_of_done}\n\n*This issue was automatically created by Foundry for ${productName}.*`,
      priority: 2,  // Medium
      labelIds: [],
    },
  };

  try {
    const response = await fetch('https://api.linear.app/graphql', {
      method: 'POST',
      headers: {
        'Authorization': credentials.api_key,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ query: mutation, variables }),
    });

    if (!response.ok) return null;

    const data = await response.json() as {
      data: { issueCreate: { issue: { id: string; identifier: string; url: string } } }
    };

    const issue = data.data?.issueCreate?.issue;
    if (!issue) return null;
    return { url: issue.url, identifier: issue.identifier };
  } catch {
    return null;
  }
}

// ─── List Teams ───────────────────────────────────────────────────────────────

export async function getLinearTeams(credentials: LinearCredentials): Promise<LinearTeam[]> {
  const q = `query { teams { nodes { id name key } } }`;
  try {
    const response = await fetch('https://api.linear.app/graphql', {
      method: 'POST',
      headers: { 'Authorization': credentials.api_key, 'Content-Type': 'application/json' },
      body: JSON.stringify({ query: q }),
    });
    if (!response.ok) return [];
    const data = await response.json() as { data: { teams: { nodes: LinearTeam[] } } };
    return data.data?.teams?.nodes ?? [];
  } catch {
    return [];
  }
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

async function fetchCompletedIssues(
  credentials: LinearCredentials,
  completedAfter: string,
): Promise<LinearIssue[]> {
  const q = `
    query CompletedIssues($filter: IssueFilter) {
      issues(filter: $filter, first: 250) {
        nodes {
          id identifier title completedAt createdAt priority
          state { name type }
          labels { nodes { name } }
        }
      }
    }
  `;

  const variables = {
    filter: {
      completedAt: { gte: completedAfter },
      state: { type: { eq: 'completed' } },
    },
  };

  try {
    const response = await fetch('https://api.linear.app/graphql', {
      method: 'POST',
      headers: { 'Authorization': credentials.api_key, 'Content-Type': 'application/json' },
      body: JSON.stringify({ query: q, variables }),
    });
    if (!response.ok) return [];
    const data = await response.json() as { data: { issues: { nodes: LinearIssue[] } } };
    return data.data?.issues?.nodes ?? [];
  } catch {
    return [];
  }
}

async function getFirstTeamId(credentials: LinearCredentials): Promise<string | null> {
  const teams = await getLinearTeams(credentials);
  return teams[0]?.id ?? null;
}
