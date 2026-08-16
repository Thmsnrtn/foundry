// =============================================================================
// FOUNDRY — Metric Ingest Webhook
// Public route: POST /ingest/:token
// Any tool (Stripe, Zapier, cron) posts metric fields here.
// Foundry maps them to metric_snapshots, recomputes Signal automatically.
// =============================================================================

import { Hono } from 'hono';
import { z } from 'zod';
import { query } from '../../db/client.js';
import { nanoid } from 'nanoid';
import { invalidateSignalCache } from '../../services/signal.js';

export const ingestRoutes = new Hono();

// ─── Validation (security close-out 2026-07-13) ──────────────────────────────
// This is a PUBLIC endpoint (token-authed). Before this schema, parseFloat
// let Infinity through ("1e999"), rates accepted 500%, and unknown fields
// were stored verbatim without any size bound. Rules: finite numbers only,
// rates in [0,1], counts are non-negative integers, dollars bounded, NPS in
// [-100,100], custom metrics capped in count and size.
const RATE_FIELDS = new Set(['activation_rate', 'day_30_retention', 'churn_rate', 'mrr_health_ratio']);
const COUNT_FIELDS = new Set(['signups', 'signups_7d', 'active_users', 'support_volume', 'support_volume_7d']);
const NPS_FIELDS = new Set(['nps', 'nps_score']);
const MAX_BODY_FIELDS = 40;
const MAX_CUSTOM_KEYS = 20;

const ingestBodySchema = z.record(z.string().max(64), z.unknown())
  .refine((b) => Object.keys(b).length <= MAX_BODY_FIELDS, `at most ${MAX_BODY_FIELDS} fields`);

function validateMetricValue(field: string, raw: unknown): number | null {
  const n = typeof raw === 'number' ? raw : parseFloat(String(raw));
  if (!Number.isFinite(n)) return null;
  if (RATE_FIELDS.has(field)) return n >= 0 && n <= 1 ? n : null;
  if (COUNT_FIELDS.has(field)) return n >= 0 && Number.isInteger(n) ? n : null;
  if (NPS_FIELDS.has(field)) return n >= -100 && n <= 100 ? n : null;
  // Dollar fields: bounded to ±$1B
  return Math.abs(n) <= 1_000_000_000 ? n : null;
}

// ─── Field → Column Mapping ───────────────────────────────────────────────────

// Dollar values (mrr, new_mrr, churned_mrr) are accepted as dollars and
// stored as cents. Rate values (0.0–1.0) stored as-is.
const DOLLAR_FIELDS = new Set(['mrr', 'new_mrr', 'expansion_mrr', 'contraction_mrr', 'churned_mrr']);

const FIELD_MAP: Record<string, string> = {
  // MRR (dollars → cents)
  mrr:               'new_mrr_cents',
  new_mrr:           'new_mrr_cents',
  expansion_mrr:     'expansion_mrr_cents',
  contraction_mrr:   'contraction_mrr_cents',
  churned_mrr:       'churned_mrr_cents',
  // Rates (0.0–1.0)
  activation_rate:   'activation_rate',
  day_30_retention:  'day_30_retention',
  churn_rate:        'churn_rate',
  mrr_health_ratio:  'mrr_health_ratio',
  // Counts
  signups:           'signups_7d',
  signups_7d:        'signups_7d',
  active_users:      'active_users',
  support_volume:    'support_volume_7d',
  support_volume_7d: 'support_volume_7d',
  // NPS
  nps:               'nps_score',
  nps_score:         'nps_score',
};

// ─── POST /ingest/:token ──────────────────────────────────────────────────────

ingestRoutes.post('/ingest/:token', async (c) => {
  const token = c.req.param('token');
  if (!token || !/^[\w-]{8,64}$/.test(token)) {
    return c.json({ error: 'Invalid token' }, 400);
  }

  // Look up the product
  const productResult = await query(
    `SELECT id FROM products WHERE ingest_token = ?`,
    [token],
  );
  if (productResult.rows.length === 0) {
    return c.json({ error: 'Unknown ingest token' }, 401);
  }
  const productId = (productResult.rows[0] as Record<string, string>).id;

  // Parse + validate body
  let rawBody: unknown;
  try {
    rawBody = await c.req.json();
  } catch {
    return c.json({ error: 'Invalid JSON body' }, 400);
  }
  const parsed = ingestBodySchema.safeParse(rawBody);
  if (!parsed.success) {
    return c.json({ error: 'Validation failed', details: parsed.error.issues.map((i) => i.message) }, 422);
  }
  const body = parsed.data;

  // Build column update pairs
  const columns: string[] = [];
  const values: unknown[] = [];
  const customMetrics: Record<string, unknown> = {};
  const rejected: string[] = [];

  for (const [key, value] of Object.entries(body)) {
    if (key === 'custom' && typeof value === 'object' && value !== null) {
      // custom metrics → stored as JSON (bounded below)
      Object.assign(customMetrics, value);
      continue;
    }

    const col = FIELD_MAP[key];
    if (col) {
      const numVal = validateMetricValue(key, value);
      if (numVal == null) {
        rejected.push(key); // out of range / non-finite — refuse rather than store poison
        continue;
      }
      columns.push(col);
      values.push(DOLLAR_FIELDS.has(key) ? Math.round(numVal * 100) : numVal);
    } else {
      // Unknown fields go into custom_metrics
      customMetrics[key] = value;
    }
  }

  if (rejected.length > 0) {
    return c.json({ error: 'Out-of-range or non-finite metric values', fields: rejected }, 422);
  }

  const customKeys = Object.keys(customMetrics);
  if (customKeys.length > 0) {
    const customJson = JSON.stringify(customMetrics);
    if (customKeys.length > MAX_CUSTOM_KEYS || customJson.length > 8_192) {
      return c.json({ error: `custom metrics bounded to ${MAX_CUSTOM_KEYS} keys / 8KB` }, 422);
    }
    columns.push('custom_metrics');
    values.push(customJson);
  }

  if (columns.length === 0) {
    return c.json({ error: 'No recognized metric fields in body', accepted_fields: Object.keys(FIELD_MAP) }, 400);
  }

  // Compute MRR health ratio if both new and churned are being set
  const newMrrIdx = columns.indexOf('new_mrr_cents');
  const churnedIdx = columns.indexOf('churned_mrr_cents');
  if (newMrrIdx !== -1 && churnedIdx !== -1) {
    const newMrr = values[newMrrIdx] as number;
    const churned = values[churnedIdx] as number;
    if (newMrr > 0) {
      columns.push('mrr_health_ratio');
      values.push(parseFloat((churned / newMrr).toFixed(4)));
    }
  }

  // UPSERT today's metric snapshot
  const today = new Date().toISOString().slice(0, 10);
  const setClause = columns.map((col) => `${col} = ?`).join(', ');

  try {
    await query(
      `INSERT INTO metric_snapshots (id, product_id, snapshot_date, ${columns.join(', ')})
       VALUES (?, ?, ?, ${columns.map(() => '?').join(', ')})
       ON CONFLICT(product_id, snapshot_date) DO UPDATE SET ${setClause}`,
      [nanoid(), productId, today, ...values, ...values],
    );

    // Invalidate Signal cache so next read recomputes fresh
    invalidateSignalCache(productId);

    // The institution's only source of evidence it did not produce itself.
    // This reading came from outside over an authenticated tenant-bound
    // channel and knows nothing about any expectation, which is what makes it
    // usable as independent observation for Shadowing. Recording it must never
    // fail the founder's ingest.
    try {
      const { recordExternalMetricObservations } = await import(
        '../../services/institution/external-observation.js'
      );
      await recordExternalMetricObservations({
        productId, origin: 'ingest_endpoint',
        readings: columns.map((field, i) => ({ field, observedValue: Number(values[i]) }))
          .filter((r) => Number.isFinite(r.observedValue)),
      });
    } catch (err) {
      const { log } = await import('../../lib/logger.js');
      log.error(
        `external observation failed: ${err instanceof Error ? err.message : String(err)}`,
        { productId },
      );
    }

    return c.json({
      status: 'accepted',
      updated_fields: columns,
      snapshot_date: today,
    });
  } catch (err) {
    console.error('[ingest] DB error:', err);
    return c.json({ error: 'Failed to store metrics' }, 500);
  }
});

// ─── POST /ingest/customer-message/:channelKey ────────────────────────────────
// Provider-neutral inbound customer communication. A sibling of the metric
// intake above, sharing its authentication pattern and nothing else: messages
// do not belong in a numeric store, and a body schema built for metrics would
// swallow them into `custom_metrics`.
//
// The key establishes both tenant and channel, so nothing about identity is
// taken from the body — there is no channel field to forge. An adapter for any
// helpdesk, mailbox, or form is an ordinary caller.
ingestRoutes.post('/ingest/customer-message/:channelKey', async (c) => {
  const channelKey = c.req.param('channelKey');
  if (!channelKey || !/^[\w-]{24,128}$/.test(channelKey)) {
    return c.json({ error: 'Invalid channel key' }, 400);
  }
  let raw: unknown;
  try {
    raw = await c.req.json();
  } catch {
    return c.json({ error: 'Invalid JSON body' }, 400);
  }
  const parsed = z.object({
    external_message_id: z.string().min(1).max(200),
    contact_email: z.string().min(3).max(320),
    body: z.string().min(1).max(8192),
    subject: z.string().max(512).optional(),
    conversation_ref: z.string().max(200).optional(),
    source_observed_at: z.string().max(64).optional(),
  }).safeParse(raw);
  if (!parsed.success) {
    return c.json({ error: 'Validation failed', details: parsed.error.issues.map((i) => i.message) }, 422);
  }

  const { ingestCustomerMessage } = await import(
    '../../services/institution/customer-message-intake.js'
  );
  const result = await ingestCustomerMessage({
    intakeKey: channelKey,
    externalMessageId: parsed.data.external_message_id,
    contactEmail: parsed.data.contact_email,
    body: parsed.data.body,
    subject: parsed.data.subject,
    conversationRef: parsed.data.conversation_ref,
    sourceObservedAt: parsed.data.source_observed_at,
  });
  if ('refused' in result) {
    // An unknown or revoked key is answered exactly like a wrong one: the
    // caller learns nothing about which channels exist.
    const status = result.refused === 'unknown_channel' ? 401 : 422;
    return c.json({ error: result.refused }, status);
  }
  return c.json({ status: result.duplicate ? 'already_received' : 'accepted', message_id: result.message.id });
});
