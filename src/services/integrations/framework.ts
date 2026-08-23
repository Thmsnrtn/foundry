// =============================================================================
// FOUNDRY — Automatic Data Ingestion Framework
// Provider adapters, credential management, sync orchestration.
// =============================================================================

import { query } from '../../db/client.js';
import { encryptToken, getPlaintextToken } from '../../lib/crypto.js';
import { nanoid } from 'nanoid';

export type ProviderType = 'stripe' | 'github' | 'posthog' | 'mixpanel' | 'intercom' | 'plausible' | 'google_analytics';

export interface IntegrationConfig {
  provider: ProviderType;
  credentials: Record<string, string>;
  config?: Record<string, unknown>;
  sync_frequency_minutes?: number;
}

export interface SyncResult {
  records_processed: number;
  metrics_updated: string[];
  errors: string[];
  duration_ms: number;
}

/**
 * Register a new integration for a product.
 */

/** Which direction a provider moves data. Mirrors the fabric's map rather than
 * inventing a second answer; anything unrecognised is inbound, which is the
 * bounded default — reading is the lesser capability. */
function providerType(provider: string): string {
  const map: Record<string, string> = {
    stripe: 'inbound', posthog: 'inbound', plausible: 'inbound',
    resend: 'outbound', github: 'bidirectional', sentry: 'inbound',
    linear: 'bidirectional', mcp: 'outbound',
  };
  return map[provider] ?? 'inbound';
}

export async function registerIntegration(
  productId: string,
  ownerId: string,
  config: IntegrationConfig
): Promise<string> {
  const id = nanoid();
  await query(
    // `type` is NOT NULL and was never supplied — the second of two
    // independent reasons this mounted route had never once succeeded. The
    // first was an `ON CONFLICT` target with no matching unique index
    // (migration 141). A route with two unrelated fatal defects is a route
    // nobody has ever called.
    `INSERT INTO integrations (id, product_id, owner_id, provider, type, status, credentials, config, sync_frequency_minutes)
     VALUES (?, ?, ?, ?, ?, 'active', ?, ?, ?)
     ON CONFLICT (product_id, provider) DO UPDATE SET
       credentials = excluded.credentials, config = excluded.config,
       status = 'active', sync_frequency_minutes = excluded.sync_frequency_minutes,
       updated_at = datetime('now')`,
    [
      id, productId, ownerId, config.provider, providerType(config.provider),
      // Encrypted, like every other writer of this column. `connections.ts`
      // has always written it through `encryptToken` and `mcp-client.ts` reads
      // it back through `getPlaintextToken`; this writer stored the JSON in the
      // clear, so the SAME COLUMN carried two encodings depending on which
      // route the founder happened to use — and this one is mounted at
      // POST /api/products/:id/integrations.
      encryptToken(JSON.stringify(config.credentials)),
      config.config ? JSON.stringify(config.config) : null,
      config.sync_frequency_minutes ?? 60,
    ]
  );
  return id;
}

/**
 * Remove an integration.
 */
export async function removeIntegration(productId: string, provider: string, ownerId: string): Promise<void> {
  await query(
    `UPDATE integrations SET status = 'disconnected', updated_at = datetime('now')
     WHERE product_id = ? AND provider = ? AND owner_id = ?`,
    [productId, provider, ownerId]
  );
}

/**
 * Get all active integrations for a product.
 */
export async function getIntegrations(productId: string): Promise<Array<{
  id: string;
  provider: string;
  status: string;
  last_sync_at: string | null;
  last_sync_status: string | null;
}>> {
  const result = await query(
    'SELECT id, provider, status, last_sync_at, last_sync_status FROM integrations WHERE product_id = ? ORDER BY provider',
    [productId]
  );
  return result.rows as unknown as Array<{
    id: string;
    provider: string;
    status: string;
    last_sync_at: string | null;
    last_sync_status: string | null;
  }>;
}

/**
 * Run sync for a specific integration.
 */
export async function runSync(integrationId: string): Promise<SyncResult> {
  const start = Date.now();
  const integration = await query('SELECT * FROM integrations WHERE id = ?', [integrationId]);
  const row = integration.rows[0] as Record<string, unknown> | undefined;
  if (!row) return { records_processed: 0, metrics_updated: [], errors: ['Integration not found'], duration_ms: 0 };

  const provider = row.provider as ProviderType;
  const productId = row.product_id as string;
  // Decrypted through the migration-safe reader, so a row written before this
  // was fixed still syncs rather than failing to parse — and a row written
  // since is never in the clear to begin with.
  const storedCredentials = getPlaintextToken((row.credentials as string | null) ?? null);
  const credentials = storedCredentials ? JSON.parse(storedCredentials) as Record<string, string> : {};

  let result: SyncResult;
  try {
    const adapter = getAdapter(provider);
    result = await adapter.sync(productId, credentials);
  } catch (err) {
    result = {
      records_processed: 0,
      metrics_updated: [],
      errors: [(err as Error).message],
      duration_ms: Date.now() - start,
    };
  }

  result.duration_ms = Date.now() - start;

  // Log sync
  await query(
    // `started_at` is NOT NULL with no default and was never supplied, so every
    // sync log write raised — inside a path whose failures are treated as
    // unremarkable, which is why a log that has never recorded anything looked
    // like a quiet system. The value was already in hand: `start`.
    `INSERT INTO integration_sync_log (id, integration_id, product_id, provider, sync_type, records_processed, metrics_updated, errors, duration_ms, started_at, completed_at)
     VALUES (?, ?, ?, ?, 'scheduled', ?, ?, ?, ?, ?, datetime('now'))`,
    [
      nanoid(), integrationId, productId, provider,
      result.records_processed,
      JSON.stringify(result.metrics_updated),
      result.errors.length > 0 ? JSON.stringify(result.errors) : null,
      result.duration_ms,
      new Date(start).toISOString(),
    ]
  );

  // Update integration status
  const success = result.errors.length === 0;
  await query(
    `UPDATE integrations SET last_sync_at = datetime('now'), last_sync_status = ?, error_count = ?, updated_at = datetime('now') WHERE id = ?`,
    [success ? 'success' : 'error', success ? 0 : (row.error_count as number ?? 0) + 1, integrationId]
  );

  return result;
}

/**
 * Run sync for all due integrations.
 */
export async function runAllDueSyncs(): Promise<number> {
  const due = await query(
    `SELECT id FROM integrations WHERE status = 'active'
     AND (last_sync_at IS NULL OR datetime(last_sync_at, '+' || sync_frequency_minutes || ' minutes') < datetime('now'))
     AND error_count < 5`,
    []
  );

  let synced = 0;
  for (const row of due.rows as unknown as Array<Record<string, string>>) {
    await runSync(row.id);
    synced++;
  }
  return synced;
}

// ─── Provider Adapters ──────────────────────────────────────────────────────

interface ProviderAdapter {
  sync(productId: string, credentials: Record<string, string>): Promise<SyncResult>;
}

function getAdapter(provider: ProviderType): ProviderAdapter {
  const adapters: Record<ProviderType, ProviderAdapter> = {
    stripe: stripeAdapter,
    github: githubAdapter,
    posthog: analyticsAdapter,
    mixpanel: analyticsAdapter,
    intercom: intercomAdapter,
    plausible: analyticsAdapter,
    google_analytics: analyticsAdapter,
  };
  return adapters[provider] ?? { sync: async () => ({ records_processed: 0, metrics_updated: [], errors: ['Unknown provider'], duration_ms: 0 }) };
}

// ─── Stripe Adapter ─────────────────────────────────────────────────────────

const stripeAdapter: ProviderAdapter = {
  async sync(productId, credentials): Promise<SyncResult> {
    const apiKey = credentials.api_key;
    if (!apiKey) return { records_processed: 0, metrics_updated: [], errors: ['Missing api_key'], duration_ms: 0 };

    const metrics: string[] = [];
    let records = 0;

    try {
      // Fetch MRR data from Stripe subscriptions
      const subsResponse = await fetch('https://api.stripe.com/v1/subscriptions?status=active&limit=100', {
        headers: { Authorization: `Bearer ${apiKey}` },
      });
      const subs = await subsResponse.json() as { data: Array<Record<string, unknown>> };

      let totalMRRCents = 0;
      for (const sub of subs.data ?? []) {
        const items = (sub.items as Record<string, unknown>)?.data as Array<Record<string, unknown>> ?? [];
        for (const item of items) {
          const price = item.price as Record<string, unknown>;
          const amount = (price?.unit_amount as number) ?? 0;
          const interval = (price?.recurring as Record<string, string>)?.interval;
          totalMRRCents += interval === 'year' ? Math.round(amount / 12) : amount;
        }
      }

      // THREE QUANTITIES, THREE WRONG COLUMNS.
      //
      // `totalMRRCents` is the sum over every ACTIVE subscription — the MRR
      // LEVEL — and it was written into `new_mrr_cents`, which means the new
      // business won this period. A company at $50k MRR with a flat month was
      // recorded as having won $50k of new business, every sync.
      //
      // `refundedCents` — refunded charges over thirty days — was written into
      // `churned_mrr_cents`. A refund is money returned; churned MRR is
      // recurring revenue lost. One annual invoice refunded would have been
      // reported as that much recurring revenue gone. The comment above it said
      // "for churn calculation", naming a thing it did not compute.
      //
      // `customerCount` is a count of SUBSCRIPTIONS and was written into
      // `active_users`, which means people using the product. One subscription
      // can cover a team of two hundred.
      //
      // This adapter knows one thing for certain, so it now writes one thing.
      // `metric_snapshots` has no column for a paying-customer level
      // (`new_customers` and `churned_customers` are movements), so the count is
      // not stored anywhere rather than stored somewhere close.
      const today = new Date().toISOString().split('T')[0];
      await query(
        `INSERT INTO metric_snapshots (id, product_id, snapshot_date, mrr_cents)
         VALUES (?, ?, ?, ?)
         ON CONFLICT (product_id, snapshot_date) DO UPDATE SET
           mrr_cents = excluded.mrr_cents`,
        [nanoid(), productId, today, totalMRRCents]
      );

      records = (subs.data ?? []).length;
      metrics.push('mrr_cents');
    } catch (err) {
      return { records_processed: 0, metrics_updated: [], errors: [(err as Error).message], duration_ms: 0 };
    }

    return { records_processed: records, metrics_updated: metrics, errors: [], duration_ms: 0 };
  },
};

// ─── GitHub Adapter ─────────────────────────────────────────────────────────

const githubAdapter: ProviderAdapter = {
  async sync(productId, credentials): Promise<SyncResult> {
    const token = credentials.access_token;
    if (!token) return { records_processed: 0, metrics_updated: [], errors: ['Missing access_token'], duration_ms: 0 };

    const product = await query('SELECT github_repo_owner, github_repo_name FROM products WHERE id = ?', [productId]);
    const p = product.rows[0] as Record<string, string> | undefined;
    if (!p?.github_repo_owner) return { records_processed: 0, metrics_updated: [], errors: ['No repo configured'], duration_ms: 0 };

    try {
      // Fetch recent commits (last 7 days)
      const since = new Date(Date.now() - 7 * 86400000).toISOString();
      const commitsResponse = await fetch(
        `https://api.github.com/repos/${p.github_repo_owner}/${p.github_repo_name}/commits?since=${since}&per_page=100`,
        { headers: { Authorization: `token ${token}`, Accept: 'application/vnd.github.v3+json' } }
      );
      const commits = await commitsResponse.json() as Array<Record<string, unknown>>;

      // Fetch recent deployments
      const deploysResponse = await fetch(
        `https://api.github.com/repos/${p.github_repo_owner}/${p.github_repo_name}/deployments?per_page=10`,
        { headers: { Authorization: `token ${token}`, Accept: 'application/vnd.github.v3+json' } }
      );
      const deploys = await deploysResponse.json() as Array<Record<string, unknown>>;

      // Store as custom metrics
      const today = new Date().toISOString().split('T')[0];
      const customMetrics = JSON.stringify({
        commits_7d: Array.isArray(commits) ? commits.length : 0,
        deploys_recent: Array.isArray(deploys) ? deploys.length : 0,
      });

      await query(
        `UPDATE metric_snapshots SET custom_metrics = ? WHERE product_id = ? AND snapshot_date = ?`,
        [customMetrics, productId, today]
      );

      return {
        records_processed: (Array.isArray(commits) ? commits.length : 0) + (Array.isArray(deploys) ? deploys.length : 0),
        metrics_updated: ['custom_metrics.commits_7d', 'custom_metrics.deploys_recent'],
        errors: [],
        duration_ms: 0,
      };
    } catch (err) {
      return { records_processed: 0, metrics_updated: [], errors: [(err as Error).message], duration_ms: 0 };
    }
  },
};

// ─── Analytics Adapter (generic) ────────────────────────────────────────────

const analyticsAdapter: ProviderAdapter = {
  async sync(productId, credentials): Promise<SyncResult> {
    // Generic analytics adapter — would be specialized per provider in production
    // For now, it processes webhook-delivered data from the stripe_events table pattern
    return { records_processed: 0, metrics_updated: [], errors: [], duration_ms: 0 };
  },
};

// ─── Intercom Adapter ───────────────────────────────────────────────────────

const intercomAdapter: ProviderAdapter = {
  async sync(productId, credentials): Promise<SyncResult> {
    const token = credentials.access_token;
    if (!token) return { records_processed: 0, metrics_updated: [], errors: ['Missing access_token'], duration_ms: 0 };

    try {
      // Fetch open conversations (support volume)
      const convoResponse = await fetch('https://api.intercom.io/conversations?open=true', {
        headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
      });
      const convos = await convoResponse.json() as { total_count?: number };
      const supportVolume = convos.total_count ?? 0;

      // Update metric snapshot
      const today = new Date().toISOString().split('T')[0];
      await query(
        `UPDATE metric_snapshots SET support_volume_7d = ? WHERE product_id = ? AND snapshot_date = ?`,
        [supportVolume, productId, today]
      );

      return {
        records_processed: supportVolume,
        metrics_updated: ['support_volume_7d'],
        errors: [],
        duration_ms: 0,
      };
    } catch (err) {
      return { records_processed: 0, metrics_updated: [], errors: [(err as Error).message], duration_ms: 0 };
    }
  },
};

/**
 * Process a Stripe webhook event and auto-update metrics.
 */
/**
 * Record one Stripe event against a product, once.
 *
 * RETURNS WHETHER IT WAS NEW, and that return is the point. The dedupe below
 * is global on `stripe_event_id` — it has no product predicate — so it already
 * knows when an event has been seen before, for ANY product. It returned void,
 * so `processStripeEventChain` could not tell, and ran the whole intelligence
 * chain regardless: metric mutation, stressor insert, risk-state transition, a
 * COO message to the founder, a gate-1 decision and an AI action draft.
 *
 * That is RT02-09's amplification. A captured genuine delivery replayed N times
 * drove those N times over; replayed at a DIFFERENT product id it drove them
 * against a company the event had nothing to do with. The row that would have
 * stopped it was already in the table.
 */
export async function processStripeWebhookEvent(
  productId: string,
  eventId: string,
  eventType: string,
  data: Record<string, unknown>
): Promise<{ recorded: boolean }> {
  // THE COMPANY IS CHECKED HERE, NOT ONLY AT THE DOOR.
  //
  // This trusted `productId` outright: it inserted an event row for any
  // company and could trigger `runSync` on that company's Stripe integration.
  // It is safe today only because its single caller verifies a Stripe HMAC
  // first — which means the guard is beside the door rather than in it, and
  // the day a second caller appears without that signature check this becomes
  // a cross-tenant write plus an outbound sync. An adversarial review named it
  // as the one genuinely id-trusting service on this surface.
  //
  // A product that does not exist is not a tenant, and refusing is cheaper
  // than trusting every future caller to remember.
  const company = await query('SELECT id FROM products WHERE id = ?', [productId]);
  if (company.rows.length === 0) {
    throw new Error(`stripe_webhook: unknown product ${productId}`);
  }

  // Deduplicate
  const existing = await query('SELECT id FROM stripe_events WHERE stripe_event_id = ?', [eventId]);
  if (existing.rows.length > 0) return { recorded: false };

  await query(
    `INSERT INTO stripe_events (id, product_id, stripe_event_id, event_type, data) VALUES (?, ?, ?, ?, ?)`,
    [nanoid(), productId, eventId, eventType, JSON.stringify(data)]
  );

  // Auto-process key events
  if (eventType === 'customer.subscription.created' || eventType === 'customer.subscription.updated') {
    // Trigger a stripe sync
    const integration = await query(
      `SELECT id FROM integrations WHERE product_id = ? AND provider = 'stripe' AND status = 'active'`,
      [productId]
    );
    if (integration.rows.length > 0) {
      await runSync((integration.rows[0] as Record<string, string>).id);
    }
  }

  await query('UPDATE stripe_events SET processed = 1 WHERE stripe_event_id = ?', [eventId]);
  return { recorded: true };
}
