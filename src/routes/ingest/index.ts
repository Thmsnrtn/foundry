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
// `mrr_cents` is accepted under its own name too, already in cents, for a
// caller that has read the schema rather than the example.
const CENTS_FIELDS = new Set(['mrr_cents']);

// MRR THE LEVEL AND MRR THE MOVEMENT ARE DIFFERENT QUANTITIES.
//
// `mrr` used to map to `new_mrr_cents`. A company POSTing `{"mrr": 50000}` —
// meaning "our MRR is fifty thousand dollars", which is what the word means —
// had that recorded as NEW BUSINESS WON THIS PERIOD, alongside its real
// expansion, contraction and churn figures. Everything downstream inherited it:
// `mrr_health_ratio` is computed here as churned/new, so a level in the
// denominator made every company look healthy; the operator's portfolio figure
// sums new + expansion - contraction - churned and was adding a level to
// movements; and Forge and Oracle put `new=$50,000.00` into their prompts.
//
// Meanwhile `metric_snapshots.mrr_cents` — the column that means the level, and
// the one every investor-facing surface reads — had NO WRITER on this door at
// all. So `scp/investor/board-packet.ts`, `investor-update.ts`,
// `fundraising-readiness.ts` and both briefings showed "N/A" for MRR to any
// company that reported through the founder's own ingest token, while the same
// company's number sat in the wrong column.
//
// `mrr` now means the level. Nothing needs migrating: no company has reported
// through this door yet.
const FIELD_MAP: Record<string, string> = {
  // MRR (dollars → cents)
  mrr:               'mrr_cents',
  mrr_cents:         'mrr_cents',
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

  // Either the product-wide token — which is what this route was always for,
  // and what existing integrations hold — or a credential the owner scoped for
  // `metrics`. The legacy token keeps working HERE and nowhere else: narrowing
  // it to its documented purpose is the whole point of migration 139, and
  // breaking the one route it was honestly issued for would not be that.
  const { authenticateIngest } = await import('../../services/institution/ingest-credentials.js');
  const scoped = await authenticateIngest(token, 'metrics');
  let productId: string;
  if (scoped) {
    productId = scoped.productId;
  } else {
    const resolved = await resolveIngestProduct(token);
    if (!resolved) {
      return c.json({ error: 'Unknown ingest token' }, 401);
    }
    productId = resolved;
  }

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
      values.push(DOLLAR_FIELDS.has(key) && !CENTS_FIELDS.has(key)
        ? Math.round(numVal * 100) : numVal);
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

    // A FORECAST COMES DUE, AND THIS IS WHERE REALITY ARRIVES.
    //
    // `recordCheckpointActual` existed with no caller anywhere, so
    // `forecast_checkpoints.actual_value` was never written and `variance_pct`
    // was never computed. Foundry made predictions and never once looked at
    // whether they came true. This is the only path by which a company's real
    // MRR reaches Foundry, so it is where the comparison belongs.
    //
    // Same posture as the observation above: it must never fail the ingest.
    // RECONCILED AGAINST THE LEVEL, BECAUSE THE FORECAST PREDICTS A LEVEL.
    // `monthly_projection.mrr_cents_median` is where MRR is expected to BE in
    // month N. The first version of this compared it against
    // new + expansion - contraction - churned, which is a sum of MOVEMENTS —
    // the same confusion the field map above was making, and it would have
    // scored every forecast against the wrong quantity. A company that reports
    // only its movements has no level to compare, and no comparison is made.
    try {
      const mrrIdx = columns.indexOf('mrr_cents');
      if (mrrIdx !== -1) {
        const { recordCheckpointActual } = await import(
          '../../services/scp/forecasting/runway.js'
        );
        await recordCheckpointActual(productId, 'mrr_cents', Number(values[mrrIdx]) || 0);
      }
    } catch (err) {
      const { log } = await import('../../lib/logger.js');
      log.error(
        `forecast checkpoint reconciliation failed: ${err instanceof Error ? err.message : String(err)}`,
        { productId },
      );
    }

    // Quantities this company declared it tracks. Before migration 135 these
    // arrived here, fell into `custom_metrics` as opaque JSON, and no
    // institutional path could ever read them — so a company whose reality is
    // boats serviced or classes taught could never reach Shadowing. A reading
    // for a declared channel is now ordinary independent observation; anything
    // undeclared still goes to custom_metrics untouched, because a value nobody
    // said they track is not evidence about a responsibility.
    try {
      const { recordCompanyObservations } = await import(
        '../../services/institution/company-observation.js'
      );
      await recordCompanyObservations({
        productId, origin: 'ingest_endpoint',
        readings: Object.entries(customMetrics)
          .map(([channelKey, value]) => ({ channelKey, observedValue: Number(value) }))
          .filter((r) => Number.isFinite(r.observedValue)),
      });
    } catch (err) {
      const { log } = await import('../../lib/logger.js');
      log.error(
        `company observation failed: ${err instanceof Error ? err.message : String(err)}`,
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
// One of the company's own systems says something needs handling.
//
// Until migration 138 the ladder's first rung was fed by a person or by four
// SaaS-shaped signals, so the more a company had already automated, the less
// Foundry could see. A rota, a till, a delivery scan or a monitor can now raise
// work — choosing from the same closed vocabulary the founder chooses from.
//
// Provenance is not laundered: this is recorded as an external report, never as
// the founder's word, and the database refuses a payload that tries to carry a
// founder id. Identity is the token; the body does not get to claim one.
//
// AUTHENTICATION IS SCOPED (migration 139). This route used to accept
/**
 * The company a legacy ingest token belongs to, if that company still exists.
 *
 * The credential names the subject correctly — that half was never wrong. What
 * was missing is the other half of the same question: is the subject still one
 * Foundry holds a relationship with? An archived company has had its data
 * erased, and a token that survived the erasure was writing fresh rows into it.
 *
 * A PAUSED company still resolves. Pausing stops Foundry acting; it does not
 * close the account, and a founder's own systems may still be posting their
 * numbers. Only the archive axis shuts the door.
 */
export async function resolveIngestProduct(token: string): Promise<string | null> {
  const { productRecordLives } = await import('../../db/client.js');
  const res = await query(
    `SELECT id FROM products WHERE ingest_token = ? AND ${productRecordLives()}`, [token]);
  const row = res.rows[0] as Record<string, string> | undefined;
  return row ? row.id : null;
}

// `products.ingest_token` — the secret the settings page tells founders to give
// to Stripe, Zapier and cron jobs for POSTING NUMBERS. An analytics tool holding
// it could raise work. It now requires a credential the owner minted for
// `company_report` specifically.
ingestRoutes.post('/ingest/company-report/:token', async (c) => {
  const token = c.req.param('token');
  if (!token || !/^[\w-]{8,64}$/.test(token)) return c.json({ error: 'Invalid token' }, 400);

  const { authenticateIngest } = await import('../../services/institution/ingest-credentials.js');
  const identity = await authenticateIngest(token, 'company_report');
  // Unknown, revoked, and wrongly-scoped fail identically: the caller learns
  // nothing about which credentials exist or what they are permitted to do.
  if (!identity) return c.json({ error: 'Unknown or unscoped ingest credential' }, 401);
  const productId = identity.productId;

  // Same as the outcome intake below: a refusal after a successful
  // authentication is recorded by shape, so a system that is failing is visible
  // to the person who connected it.
  const { clearIngestRefusals, recordIngestRefusal } = await import(
    '../../services/institution/ingest-credentials.js');

  let raw: unknown;
  try { raw = await c.req.json(); } catch {
    await recordIngestRefusal(identity.credentialId, 'body_unreadable');
    return c.json({ error: 'Invalid JSON body' }, 400);
  }
  const body = (raw ?? {}) as Record<string, unknown>;

  const { reportExternalObligation, REPORTABLE_OBLIGATIONS } = await import(
    '../../services/founder/company-report.js');
  const reported = await reportExternalObligation({
    productId,
    reportedBy: String(body.reported_by ?? 'unnamed_system').slice(0, 120),
    obligationKind: String(body.obligation_kind ?? ''),
    what: String(body.what ?? ''),
  });
  if (!reported) {
    await recordIngestRefusal(identity.credentialId, 'fields_invalid');
    return c.json({
      error: 'Report refused', accepted_kinds: REPORTABLE_OBLIGATIONS,
      note: 'what is required and bounded to 200 characters; obligation_kind must be one of accepted_kinds',
    }, 422);
  }
  await clearIngestRefusals(identity.credentialId);
  // A report is evidence, never permission. Saying so in the response keeps an
  // integration author from concluding otherwise.
  return c.json({
    status: 'accepted', signal_id: reported.signalId,
    responsibility_id: reported.responsibility?.id ?? null,
    note: 'recorded as evidence; nothing is authorised by reporting it',
  });
});

// An outside system reports whether an effect achieved what it was for.
//
// The other half of migration 137's supply: the founder can answer from The
// Letter, and a tool that can actually see the result — a rota system, a
// helpdesk, a delivery scan — can answer here. Same tenant-bound token, same
// canonical evidence, and the database refuses any report attributed to the
// institution itself.
//
// AUTHENTICATION IS SCOPED (migration 139), and this is the one that mattered
// most. An outcome report is the only evidence that can move an effect off
// `unresolved`; it becomes a learned claim and removes the effect from the
// owner's "did this work?" list. Migration 137 refuses reports attributed to
// the institution, because a system that can declare its own success has no
// outcome layer — and a metrics integration is not the institution, so it
// sailed through that check while being no better placed than Foundry to know
// whether anyone actually turned up. It now requires `effect_outcome` scope.
ingestRoutes.post('/ingest/effect-outcome/:token', async (c) => {
  const token = c.req.param('token');
  if (!token || !/^[\w-]{8,64}$/.test(token)) return c.json({ error: 'Invalid token' }, 400);

  const { authenticateIngest } = await import('../../services/institution/ingest-credentials.js');
  const identity = await authenticateIngest(token, 'effect_outcome');
  if (!identity) return c.json({ error: 'Unknown or unscoped ingest credential' }, 401);
  const productId = identity.productId;

  // A SYSTEM BEING REFUSED IS SOMETHING ITS OWNER SHOULD BE ABLE TO SEE.
  // `last_used_at` records that a credential authenticated, and nothing
  // recorded that the request which followed was thrown away — so an
  // integration sending a slightly wrong field looked exactly like one that
  // worked. Only the shape is recorded; the refused body is external data and
  // none of it goes anywhere near the record.
  const { clearIngestRefusals, recordIngestRefusal } = await import(
    '../../services/institution/ingest-credentials.js');

  let raw: unknown;
  try { raw = await c.req.json(); } catch {
    await recordIngestRefusal(identity.credentialId, 'body_unreadable');
    return c.json({ error: 'Invalid JSON body' }, 400);
  }
  const body = (raw ?? {}) as Record<string, unknown>;

  const { reportEffectOutcome } = await import('../../services/institution/effect-outcome.js');
  const reported = await reportEffectOutcome({
    productId,
    effectId: String(body.effect_id ?? ''),
    verdict: String(body.verdict ?? ''),
    // The reporter is the origin the tool names for itself, never a claim about
    // who it is. Identity here is the token; this is provenance, not authority.
    reporter: `external:${String(body.reported_by ?? 'unnamed_system')}`.slice(0, 120),
    detail: typeof body.detail === 'string' ? body.detail : undefined,
  });
  if ('refused' in reported) {
    await recordIngestRefusal(identity.credentialId, 'refused_by_the_institution');
    return c.json({ status: 'refused', reason: reported.refused }, 422);
  }
  // Cleared on the request that got through, not on the one that authenticated:
  // being let in is not the same as being understood.
  await clearIngestRefusals(identity.credentialId);
  return c.json({ status: 'accepted', observation_id: reported.id });
});

ingestRoutes.post('/ingest/customer-message/:channelKey', async (c) => {
  const channelKey = c.req.param('channelKey');
  if (!channelKey || !/^[\w-]{24,128}$/.test(channelKey)) {
    return c.json({ error: 'Invalid channel key' }, 400);
  }
  // A CUSTOMER WROTE AND WAS DROPPED, and nothing recorded it. The founder saw
  // a quiet inbox and concluded nobody had written. Only the shape is kept —
  // the refused body is the customer's own words and their address.
  const { clearChannelRefusals, recordChannelRefusal } = await import(
    '../../services/institution/customer-message-intake.js');

  let raw: unknown;
  try {
    raw = await c.req.json();
  } catch {
    await recordChannelRefusal(channelKey, 'body_unreadable');
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
    await recordChannelRefusal(channelKey, 'fields_invalid');
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
    // caller learns nothing about which channels exist. It is not recorded
    // either — there is no channel to record it against, and a stranger
    // probing keys must not leave a trail on somebody's channel.
    await recordChannelRefusal(channelKey, result.refused);
    const status = result.refused === 'unknown_channel' ? 401 : 422;
    return c.json({ error: result.refused }, status);
  }
  await clearChannelRefusals(channelKey);
  return c.json({ status: result.duplicate ? 'already_received' : 'accepted', message_id: result.message.id });
});
