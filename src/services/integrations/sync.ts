// =============================================================================
// FOUNDRY — Integration Sync Orchestrator
// Runs all active integrations for a product, logs results, surfaces errors.
// Called by the hourly integration_sync cron job.
// =============================================================================

import { query, getAllActiveProducts } from '../../db/client.js';
import { nanoid } from 'nanoid';
import { syncStripeMetrics } from './stripe.js';
import { syncPostHogMetrics } from './posthog.js';
import { syncIntercomMetrics } from './intercom.js';
import { syncLinearMetrics } from './linear.js';
import type { IntegrationType } from '../../types/index.js';

interface IntegrationRow {
  id: string;
  product_id: string;
  type: IntegrationType;
  status: string;
  credentials_json: string | null;
  config_json: string | null;
  sync_cursor: string | null;
}

// ─── Sync All Active Integrations for One Product ────────────────────────────

export async function syncProductIntegrations(productId: string): Promise<void> {
  const result = await query(
    `SELECT id, product_id, type, status, credentials_json, config_json, sync_cursor
     FROM integrations WHERE product_id = ? AND status = 'active'`,
    [productId],
  );

  for (const row of result.rows) {
    const integration = row as unknown as IntegrationRow;
    await runIntegrationSync(integration);
  }
}

// ─── Sync All Products (Cron) ─────────────────────────────────────────────────

export async function syncAllIntegrations(): Promise<void> {
  console.log('[integrations] sync_all starting');
  const products = await getAllActiveProducts();

  for (const productRow of products.rows) {
    const productId = (productRow as Record<string, string>).id;
    try {
      await syncProductIntegrations(productId);
    } catch (err) {
      console.error(`[integrations] sync_all error for product ${productId}:`, err);
    }
  }

  console.log('[integrations] sync_all complete');
}

// ─── Single Integration Sync ─────────────────────────────────────────────────

async function runIntegrationSync(integration: IntegrationRow): Promise<void> {
  const logId = nanoid();

  // Start log entry
  await query(
    `INSERT INTO integration_sync_log (id, integration_id, product_id, started_at, status)
     VALUES (?, ?, ?, CURRENT_TIMESTAMP, 'running')`,
    [logId, integration.id, integration.product_id],
  );

  let credentials: Record<string, string> = {};
  let config: Record<string, unknown> = {};

  try {
    if (integration.credentials_json) {
      credentials = JSON.parse(integration.credentials_json) as Record<string, string>;
    }
    if (integration.config_json) {
      config = JSON.parse(integration.config_json) as Record<string, unknown>;
    }
  } catch {
    await markSyncFailed(logId, integration.id, 'Failed to parse credentials or config');
    return;
  }

  try {
    let metricsUpdated: string[] = [];
    let recordsProcessed = 0;

    switch (integration.type) {
      case 'stripe': {
        const result = await syncStripeMetrics(
          integration.product_id,
          integration.id,
          credentials as { access_token: string; stripe_account_id?: string },
          integration.sync_cursor,
        );
        metricsUpdated = result.metricsUpdated;
        recordsProcessed = result.recordsProcessed;
        break;
      }

      case 'posthog': {
        const result = await syncPostHogMetrics(
          integration.product_id,
          integration.id,
          credentials as { api_key: string; project_id: string; host?: string },
          config as { activation_event: string; active_user_event?: string; retention_event?: string },
        );
        metricsUpdated = result.metricsUpdated;
        recordsProcessed = result.recordsProcessed;
        break;
      }

      case 'intercom': {
        const result = await syncIntercomMetrics(
          integration.product_id,
          integration.id,
          credentials as { access_token: string },
        );
        metricsUpdated = result.metricsUpdated;
        recordsProcessed = result.recordsProcessed;

        // Support spike → auto-create stressor
        if (result.supportSpikeDetected) {
          await createSupportSpikeStressor(integration.product_id);
        }
        break;
      }

      case 'linear': {
        const result = await syncLinearMetrics(
          integration.product_id,
          integration.id,
          credentials as { api_key: string; team_id?: string },
        );
        metricsUpdated = result.metricsUpdated;
        recordsProcessed = result.recordsProcessed;
        break;
      }

      default:
        await markSyncFailed(logId, integration.id, `Integration type '${integration.type}' not yet implemented`);
        return;
    }

    // Mark sync successful
    await query(
      `UPDATE integration_sync_log
       SET completed_at = CURRENT_TIMESTAMP, status = 'success',
           records_processed = ?, metrics_updated = ?
       WHERE id = ?`,
      [recordsProcessed, JSON.stringify(metricsUpdated), logId],
    );

  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : String(err);
    await markSyncFailed(logId, integration.id, errorMessage);
  }
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

async function markSyncFailed(logId: string, integrationId: string, errorMessage: string): Promise<void> {
  await query(
    `UPDATE integration_sync_log
     SET completed_at = CURRENT_TIMESTAMP, status = 'failed', error_message = ?
     WHERE id = ?`,
    [errorMessage, logId],
  );
  await query(
    `UPDATE integrations SET last_error = ?, status = 'error' WHERE id = ?`,
    [errorMessage, integrationId],
  );
}

async function createSupportSpikeStressor(productId: string): Promise<void> {
  // Check if this stressor already exists and is active
  const existing = await query(
    `SELECT id FROM stressor_history
     WHERE product_id = ? AND stressor_name = 'Support Volume Spike' AND status = 'active'`,
    [productId],
  );
  if (existing.rows.length > 0) return;

  await query(
    `INSERT INTO stressor_history
     (id, product_id, stressor_name, signal, timeframe_days, neutralizing_action, severity, status)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      nanoid(),
      productId,
      'Support Volume Spike',
      'Support conversation volume increased >50% vs 30-day average, detected via Intercom integration.',
      14,
      'Review top support categories, identify if spike correlates with recent ship, prioritize top 3 ticket types for self-serve fixes.',
      'elevated',
      'active',
    ],
  );
}
