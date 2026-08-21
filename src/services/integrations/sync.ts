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
import { decryptCredentialPayload } from '../encryption.js';
import { logger } from '../logger.js';
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

/**
 * How many consecutive failures before Foundry stops trying an integration.
 *
 * There used to be no such number, because there was no retry. A single failed
 * sync set `integrations.status = 'error'`, and this query selected
 * `status = 'active'` — so the hourly job never touched that integration again.
 * One timed-out request, one expired token, one bad night at the provider, and
 * the company's revenue numbers quietly stopped updating until the founder
 * happened to visit the Integrations page and press Connect again.
 *
 * Nothing announced it. The evidence of the stop was a red card on a page you
 * only visit when you already suspect something.
 */
export const MAX_CONSECUTIVE_SYNC_FAILURES = 5;

export async function syncProductIntegrations(productId: string): Promise<void> {
  // An errored integration is retried, up to the limit above. Giving up is a
  // decision, and a decision has to be taken deliberately and said out loud.
  const result = await query(
    `SELECT id, product_id, type, status, credentials_json, config_json, sync_cursor
     FROM integrations
      WHERE product_id = ?
        AND status IN ('active', 'error')
        AND COALESCE(error_count, 0) < ?`,
    [productId, MAX_CONSECUTIVE_SYNC_FAILURES],
  );

  for (const row of result.rows) {
    const integration = row as unknown as IntegrationRow;
    await runIntegrationSync(integration);
  }
}

// ─── Sync All Products (Cron) ─────────────────────────────────────────────────

export async function syncAllIntegrations(): Promise<void> {
  logger.info('[integrations] sync_all starting', { jobName: 'integrations_sync_all' });
  const products = await getAllActiveProducts();

  for (const productRow of products.rows) {
    const productId = (productRow as Record<string, string>).id;
    try {
      await syncProductIntegrations(productId);
    } catch (err) {
      logger.error('[integrations] sync_all error', { jobName: 'integrations_sync_all', productId, error: String(err) });
    }
  }

  logger.info('[integrations] sync_all complete', { jobName: 'integrations_sync_all' });
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
      // Decrypt at-rest credentials. Backward compatible with legacy
      // plaintext rows: decryptCredentialPayload returns plaintext as-is
      // when the value isn't recognizably encrypted.
      const plaintext = decryptCredentialPayload(integration.credentials_json);
      if (plaintext) {
        credentials = JSON.parse(plaintext) as Record<string, string>;
      }
    }
    if (integration.config_json) {
      config = JSON.parse(integration.config_json) as Record<string, unknown>;
    }
  } catch {
    await markSyncFailed(logId, integration, 'Failed to parse credentials or config');
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
        await markSyncFailed(logId, integration, `Integration type '${integration.type}' not yet implemented`);
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

    // And return the integration to health. The per-provider modules each clear
    // `last_error` on success, but none of them restored `status` — so an
    // integration that failed once and has worked every hour since still read
    // as errored, which is also why it was never retried.
    await query(
      `UPDATE integrations
          SET status = 'active', last_error = NULL, error_count = 0,
              updated_at = CURRENT_TIMESTAMP
        WHERE id = ?`,
      [integration.id],
    );

  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : String(err);
    await markSyncFailed(logId, integration, errorMessage);
  }
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

async function markSyncFailed(
  logId: string,
  integration: Pick<IntegrationRow, 'id' | 'product_id' | 'type'>,
  errorMessage: string,
): Promise<void> {
  await query(
    `UPDATE integration_sync_log
     SET completed_at = CURRENT_TIMESTAMP, status = 'failed', error_message = ?
     WHERE id = ?`,
    [errorMessage, logId],
  );
  await query(
    `UPDATE integrations
        SET last_error = ?, status = 'error',
            error_count = COALESCE(error_count, 0) + 1,
            updated_at = CURRENT_TIMESTAMP
      WHERE id = ?`,
    [errorMessage, integration.id],
  );

  const after = (await query(
    'SELECT COALESCE(error_count, 0) AS n FROM integrations WHERE id = ?',
    [integration.id],
  )).rows[0] as Record<string, unknown> | undefined;
  const failures = Number(after?.n ?? 0);

  // Crossing the limit is the moment Foundry stops trying. Announce it exactly
  // once — on the crossing, not on every subsequent skip, which would be noise
  // about a thing that is no longer happening.
  //
  // NOT through `emitSignalEvent`. That function is the single door into
  // responsibility discovery, and it has exactly one caller by design: the
  // company reporting something about itself. A Foundry integration timing out
  // is Foundry's own plumbing, not the company stating a fact, and admitting it
  // through that door would let internal failures enter the responsibility
  // ladder. `discovery-is-not-reachable-from-integrations.test.ts` holds that
  // boundary, and it caught this.
  //
  // The interruption ladder is the right authority: it decides against the
  // founder's own ceiling whether this reaches their phone, their Letter or
  // only the log, and it leaves a record either way.
  if (failures === MAX_CONSECUTIVE_SYNC_FAILURES) {
    try {
      const ownerRow = (await query(
        'SELECT owner_id FROM products WHERE id = ?', [integration.product_id],
      )).rows[0] as Record<string, unknown> | undefined;
      const founderId = ownerRow?.owner_id == null ? null : String(ownerRow.owner_id);

      if (founderId) {
        const { deliver } = await import('../ux/interruption.js');
        await deliver(founderId, integration.product_id, {
          importance: 'action_needed',
          title: `Foundry stopped syncing ${integration.type}`,
          // The provider's error text is external content. It is already stored
          // on the integration row and shown, escaped, on the Integrations page;
          // it does not need a second home in a notification body.
          body: `${failures} syncs failed in a row, so Foundry is no longer trying. `
            + `Anything this integration supplies has stopped updating. `
            + `Reconnect it to start again.`,
          actionUrl: '/integrations',
          actionLabel: 'Open integrations',
        });
      }
    } catch (err) {
      logger.error('[integrations] could not announce a stopped integration', {
        productId: integration.product_id, error: String(err),
      });
    }
  }
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
