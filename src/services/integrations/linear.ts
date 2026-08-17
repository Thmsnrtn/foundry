// =============================================================================
// FOUNDRY — Linear Integration (READ ONLY)
//
// Pulls ship cadence as an execution health metric. Nothing here writes to a
// customer's Linear workspace.
//
// It used to. `createLinearIssueFromBlockingIssue` posted an `issueCreate`
// mutation straight to the Linear API — an irreversible write into somebody
// else's workspace, outside the outbound gateway, so with no kill-switch, no
// classification, no budget, no idempotency key and no receipt. The repo's own
// consequential-effects audit had flagged it for years as `unresolved`,
// meaning nobody had yet traced whether it read or wrote.
//
// Tracing it settled two things: it wrote, and it had no callers. The live path
// for creating a Linear issue is the approved action in
// `services/scp/actions/executor.ts`, which carries a durable receipt. So this
// was a second, ungoverned writer for an effect that already had a governed
// one — deleted rather than classified.
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

