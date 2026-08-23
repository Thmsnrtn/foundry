// =============================================================================
// FOUNDRY — End-to-End Stripe Webhook Integration
// Signature verification → event processing → metrics update → stressor check
// → COO notification → action draft generation
// =============================================================================

import Stripe from 'stripe';
import { query } from '../../db/client.js';
import { processStripeWebhookEvent } from './framework.js';
import { identifyStressors, type StressorInputs } from '../intelligence/stressor.js';
import { assessRiskState, transitionRiskState } from '../intelligence/risk-state.js';
import { sendProactiveMessage } from '../chat/coo.js';
import { generateActionDraft } from '../decisions/actions.js';
import { nanoid } from 'nanoid';
import type { RiskStateValue, GrowthStage, StressorSeverity } from '../../types/index.js';

let _stripe: Stripe | null = null;

function getStripe(): Stripe {
  if (!_stripe) {
    const key = process.env.STRIPE_SECRET_KEY;
    if (!key) throw new Error('STRIPE_SECRET_KEY is required');
    _stripe = new Stripe(key, { apiVersion: '2023-10-16' });
  }
  return _stripe;
}

/**
 * Verify Stripe webhook signature and return the parsed event.
 */
export function verifyStripeWebhook(
  rawBody: string,
  signature: string
): Stripe.Event {
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!webhookSecret) throw new Error('STRIPE_WEBHOOK_SECRET is required');

  const stripe = getStripe();
  return stripe.webhooks.constructEvent(rawBody, signature, webhookSecret);
}

/**
 * Full end-to-end Stripe event processing chain:
 * 1. Parse event
 * 2. Update metrics
 * 3. Check for stressors
 * 4. Assess risk state
 * 5. Notify COO if needed
 * 6. Generate action drafts for urgent situations
 */
export async function processStripeEventChain(
  productId: string,
  event: Stripe.Event
): Promise<{
  metrics_updated: boolean;
  stressors_found: number;
  risk_changed: boolean;
  coo_notified: boolean;
  actions_generated: number;
}> {
  const result = {
    metrics_updated: false,
    stressors_found: 0,
    risk_changed: false,
    coo_notified: false,
    actions_generated: 0,
  };

  // 1. Persist raw event — and STOP IF IT IS NOT NEW.
  //
  // RT02-09. This ran the whole chain whether or not the event had been seen,
  // because `processStripeWebhookEvent` returned void. Everything below mutates
  // the named company: `updateMetricsFromEvent` rewrites its MRR movement
  // columns and active users from amounts in the event body, a stressor row is
  // inserted, `transitionRiskState` is called, the founder receives a COO
  // message quoting a customer email lifted from the event, and a gate-1 urgent
  // decision plus an AI action draft are created on their budget.
  //
  // The dedupe that stops it was already there and is GLOBAL on
  // `stripe_event_id`, with no product predicate — so it knows an event has
  // been seen for ANY product. A captured genuine delivery replayed N times
  // drove that chain N times; replayed at a DIFFERENT product id it drove it
  // against a company the event had nothing to do with. The row that would have
  // refused it was in the table the whole time and nobody asked.
  //
  // WHAT THIS DOES NOT CLOSE, stated rather than implied: the signature proves
  // the event came from Stripe, not which product it belongs to, and there is
  // one STRIPE_WEBHOOK_SECRET for every tenant. Someone holding that secret can
  // mint fresh event ids, and a replay that arrives BEFORE the genuine delivery
  // still wins the race. Binding an event to a product needs an identifier the
  // event carries and the product owns — a Connect account id stored when the
  // integration is connected — which is schema and a connect-flow change, and
  // is recorded on the frontier rather than guessed at here.
  const { recorded } = await processStripeWebhookEvent(
    productId, event.id, event.type, event.data.object as Record<string, unknown>);
  if (!recorded) return result;

  // 2. Update metrics based on event type
  const metricsUpdated = await updateMetricsFromEvent(productId, event);
  result.metrics_updated = metricsUpdated;

  if (!metricsUpdated) return result; // Non-metric event, no chain needed

  // 3. Check for stressors
  const product = await query('SELECT * FROM products WHERE id = ?', [productId]);
  const p = product.rows[0] as Record<string, unknown> | undefined;
  if (!p) return result;

  const ls = await query('SELECT * FROM lifecycle_state WHERE product_id = ?', [productId]);
  const l = ls.rows[0] as Record<string, unknown> | undefined;
  const riskState = (l?.risk_state as RiskStateValue) ?? 'green';
  const growthStage = (p.growth_stage as GrowthStage) ?? 'growth';

  // Only run full stressor check for significant events
  const significantEvents = [
    'customer.subscription.deleted',
    'customer.subscription.updated',
    'charge.refunded',
    'charge.failed',
    'invoice.payment_failed',
  ];

  if (significantEvents.includes(event.type)) {
    const latestMetrics = await query(
      'SELECT * FROM metric_snapshots WHERE product_id = ? ORDER BY snapshot_date DESC LIMIT 1',
      [productId]
    );
    const priorMetrics = await query(
      'SELECT * FROM metric_snapshots WHERE product_id = ? ORDER BY snapshot_date DESC LIMIT 1 OFFSET 1',
      [productId]
    );

    // Quick stressor check for the specific event
    const eventStressors = await identifyEventStressors(productId, event, riskState);
    result.stressors_found = eventStressors.length;

    // 4. Assess risk state
    if (eventStressors.length > 0) {
      const activeStressors = await query(
        "SELECT severity, stressor_name FROM stressor_history WHERE product_id = ? AND status = 'active'",
        [productId]
      );
      const stressorList = (activeStressors.rows as unknown as Array<Record<string, string>>).map((s) => ({
        severity: s.severity as StressorSeverity,
        name: s.stressor_name,
      }));

      const riskAssessment = assessRiskState({
        productId,
        activeStressors: stressorList,
        mrrHealthRatio: null,
        pendingGate3AgeDays: 0,
        currentState: riskState,
        growthStage,
      });

      if (riskAssessment.transitionWarranted) {
        await transitionRiskState(productId, riskState, riskAssessment.recommendedState, riskAssessment.reason, riskAssessment.triggeringSignals);
        result.risk_changed = true;
      }
    }

    // 5. Notify COO for critical events
    const ownerId = p.owner_id as string;
    if (event.type === 'customer.subscription.deleted') {
      const sub = event.data.object as Stripe.Subscription;
      const customerEmail = (sub as unknown as Record<string, unknown>).customer_email as string ?? 'a customer';
      const message = `A subscription was just cancelled (${customerEmail}). ${result.risk_changed ? `Risk state changed to ${riskState}.` : ''} I'm assessing the impact and drafting a rescue plan.`;
      await sendProactiveMessage(ownerId, productId, message);
      result.coo_notified = true;

      // 6. Auto-generate a churn rescue action
      const decisionId = nanoid();
      await query(
        `INSERT INTO decisions (id, product_id, category, gate, what, why_now, recommendation, status, created_at)
         VALUES (?, ?, 'urgent', 1, ?, ?, ?, 'pending', datetime('now'))`,
        [
          decisionId, productId,
          `Send churn rescue email to ${customerEmail}`,
          'Customer just cancelled their subscription. Immediate outreach has the highest win-back probability.',
          'Send a personal email asking what went wrong. Offer a call. Do not offer a discount as the first response.',
        ]
      );

      try {
        await generateActionDraft(decisionId, productId, ownerId);
        result.actions_generated = 1;
      } catch { /* Draft generation is best-effort */ }
    }

    if (event.type === 'invoice.payment_failed') {
      const message = `⚠️ A payment just failed. This may indicate a billing issue or customer churn signal.`;
      await sendProactiveMessage(ownerId, productId, message);
      result.coo_notified = true;
    }
  }

  return result;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

/**
 * Update metric snapshots from a Stripe event.
 */
async function updateMetricsFromEvent(productId: string, event: Stripe.Event): Promise<boolean> {
  const today = new Date().toISOString().split('T')[0]!;

  switch (event.type) {
    case 'customer.subscription.created': {
      const sub = event.data.object as Stripe.Subscription;
      const mrrCents = computeSubscriptionMRR(sub);
      await query(
        `UPDATE metric_snapshots SET new_mrr_cents = COALESCE(new_mrr_cents, 0) + ?, active_users = COALESCE(active_users, 0) + 1
         WHERE product_id = ? AND snapshot_date = ?`,
        [mrrCents, productId, today]
      );
      // Ensure a snapshot exists
      await ensureSnapshot(productId, today);
      return true;
    }

    case 'customer.subscription.deleted': {
      const sub = event.data.object as Stripe.Subscription;
      const mrrCents = computeSubscriptionMRR(sub);
      await query(
        `UPDATE metric_snapshots SET churned_mrr_cents = COALESCE(churned_mrr_cents, 0) + ?, active_users = MAX(0, COALESCE(active_users, 0) - 1)
         WHERE product_id = ? AND snapshot_date = ?`,
        [mrrCents, productId, today]
      );
      await ensureSnapshot(productId, today);
      // Recompute health ratio
      await recomputeHealthRatio(productId, today);
      return true;
    }

    case 'customer.subscription.updated': {
      const sub = event.data.object as Stripe.Subscription;
      const previousSub = event.data.previous_attributes as Record<string, unknown> | undefined;
      if (previousSub?.items) {
        const oldMRR = computeSubscriptionMRR({ items: previousSub.items } as unknown as Stripe.Subscription);
        const newMRR = computeSubscriptionMRR(sub);
        const delta = newMRR - oldMRR;
        if (delta > 0) {
          await query(
            `UPDATE metric_snapshots SET expansion_mrr_cents = COALESCE(expansion_mrr_cents, 0) + ? WHERE product_id = ? AND snapshot_date = ?`,
            [delta, productId, today]
          );
        } else if (delta < 0) {
          await query(
            `UPDATE metric_snapshots SET contraction_mrr_cents = COALESCE(contraction_mrr_cents, 0) + ? WHERE product_id = ? AND snapshot_date = ?`,
            [Math.abs(delta), productId, today]
          );
        }
        await ensureSnapshot(productId, today);
        return true;
      }
      return false;
    }

    case 'charge.refunded': {
      const charge = event.data.object as Stripe.Charge;
      const refundAmount = charge.amount_refunded ?? 0;
      await query(
        `UPDATE metric_snapshots SET churned_mrr_cents = COALESCE(churned_mrr_cents, 0) + ? WHERE product_id = ? AND snapshot_date = ?`,
        [refundAmount, productId, today]
      );
      await ensureSnapshot(productId, today);
      return true;
    }

    default:
      return false;
  }
}

function computeSubscriptionMRR(sub: Stripe.Subscription): number {
  let total = 0;
  for (const item of sub.items?.data ?? []) {
    const price = item.price;
    const amount = price?.unit_amount ?? 0;
    const interval = price?.recurring?.interval;
    total += interval === 'year' ? Math.round(amount / 12) : amount;
  }
  return total;
}

// NULL + 5 IS NULL. Migration 202 made the four movement columns nullable, so
// "we were not told" is expressible — and every `col = col + ?` above would have
// discarded its event against a column nobody had written yet. `COALESCE(col, 0)`
// is the right arithmetic for the first movement we have been told about, and
// it is the ONLY place a zero may be substituted for one of these columns.
async function ensureSnapshot(productId: string, date: string): Promise<void> {
  const existing = await query(
    'SELECT id FROM metric_snapshots WHERE product_id = ? AND snapshot_date = ?',
    [productId, date]
  );
  if (existing.rows.length === 0) {
    await query(
      'INSERT INTO metric_snapshots (id, product_id, snapshot_date) VALUES (?, ?, ?)',
      [nanoid(), productId, date]
    );
  }
}

async function recomputeHealthRatio(productId: string, date: string): Promise<void> {
  await query(
    // NULL means the movement was never reported, and a ratio over an
    // unreported denominator is not zero — it is unknown, which is what the
    // ELSE branch already says. `COALESCE(churned, 0)` is right in the
    // numerator only because this branch has already established that new_mrr
    // was reported and is positive.
    `UPDATE metric_snapshots
        SET mrr_health_ratio = CASE WHEN COALESCE(new_mrr_cents, 0) > 0
              THEN CAST(COALESCE(churned_mrr_cents, 0) AS REAL) / new_mrr_cents
              ELSE NULL END
      WHERE product_id = ? AND snapshot_date = ?`,
    [productId, date]
  );
}

/**
 * Quick stressor identification from a specific event.
 */
async function identifyEventStressors(
  productId: string,
  event: Stripe.Event,
  riskState: RiskStateValue
): Promise<Array<{ name: string; severity: string }>> {
  const stressors: Array<{ name: string; severity: string }> = [];

  if (event.type === 'customer.subscription.deleted') {
    // Check if this is the Nth cancellation this month
    const recentCancellations = await query(
      `SELECT COUNT(*) as c FROM stripe_events WHERE product_id = ? AND event_type = 'customer.subscription.deleted' AND created_at > datetime('now', '-30 days')`,
      [productId]
    );
    const count = (recentCancellations.rows[0] as Record<string, number>)?.c ?? 0;

    if (count >= 3) {
      const stressorId = nanoid();
      await query(
        `INSERT INTO stressor_history (id, product_id, stressor_name, signal, timeframe_days, neutralizing_action, severity, status, risk_state_at_identification)
         VALUES (?, ?, ?, ?, ?, ?, ?, 'active', ?)`,
        [stressorId, productId, 'Accelerating cancellations',
         `${count} subscription cancellations in the last 30 days`,
         30, 'Investigate common factors across cancelled customers. Check for onboarding failures, competitive pressure, or seasonal pattern.',
         count >= 5 ? 'critical' : 'elevated', riskState]
      );
      stressors.push({ name: 'Accelerating cancellations', severity: count >= 5 ? 'critical' : 'elevated' });
    }
  }

  if (event.type === 'invoice.payment_failed') {
    const recentFailures = await query(
      `SELECT COUNT(*) as c FROM stripe_events WHERE product_id = ? AND event_type = 'invoice.payment_failed' AND created_at > datetime('now', '-7 days')`,
      [productId]
    );
    const count = (recentFailures.rows[0] as Record<string, number>)?.c ?? 0;
    if (count >= 3) {
      stressors.push({ name: 'Payment failure spike', severity: 'elevated' });
    }
  }

  return stressors;
}
