// =============================================================================
// FOUNDRY — Customer-Level Intelligence
// Per-customer health scores, churn risk, expansion signals, champions.
// =============================================================================

import { query } from '../../db/client.js';
import { callSonnet, parseJSONResponse } from '../ai/client.js';
import { nanoid } from 'nanoid';

/**
 * A customer's health, WHERE NULL MEANS NOT MEASURED.
 *
 * Every field was non-nullable, so a component nobody could measure had
 * nowhere to go but a number — and the numbers chosen ran in opposite
 * directions for the same absence. See `computeCustomerHealth`.
 */
export interface CustomerHealth {
  /** Weighted over the components that were measured, renormalised. Null when
   *  none of them were. */
  health_score: number | null;
  churn_risk: number | null;
  expansion_potential: number | null;
  components: {
    usage: number | null;
    support: number | null;
    payment: number | null;
    engagement: number | null;
  };
}

export interface CustomerInsight {
  customer_id: string;
  name: string;
  insight_type: 'churn_risk' | 'expansion' | 'champion' | 'at_risk' | 'concentration';
  description: string;
  recommended_action: string;
}

/**
 * Compute health score for a single customer.
 */
export async function computeCustomerHealth(customerId: string): Promise<CustomerHealth> {
  const events = await query(
    `SELECT event_type, COUNT(*) as cnt, MAX(created_at) as latest
     FROM customer_events WHERE customer_id = ? AND created_at > datetime('now', '-30 days')
     GROUP BY event_type`,
    [customerId]
  );

  const customer = await query('SELECT * FROM customers WHERE id = ?', [customerId]);
  const c = customer.rows[0] as Record<string, unknown> | undefined;
  // A customer Foundry cannot find is not a customer certain to churn. This
  // returned health 0 and churn risk 1 — the most alarming reading available,
  // for a row that was not there.
  if (!c) {
    return {
      health_score: null, churn_risk: null, expansion_potential: null,
      components: { usage: null, support: null, payment: null, engagement: null },
    };
  }
  const productId = c.product_id as string;

  const eventMap: Record<string, { count: number; latest: string }> = {};
  for (const row of events.rows as unknown as Array<Record<string, unknown>>) {
    eventMap[row.event_type as string] = { count: row.cnt as number, latest: row.latest as string };
  }

  // ONE ABSENCE, SCORED IN OPPOSITE DIRECTIONS INSIDE ONE FUNCTION.
  //
  // Three of the four components read `customer_events`. That table has exactly
  // one writer in the whole system, behind a session route, so a company that
  // has not wired it has none — and the same nothing was read as CATASTROPHIC
  // on usage (0) and PERFECT on support and payment (100 each, 35% of the
  // weight). The composite then reduced to 35 + 0.35 x engagement: a number
  // about nothing, written back to `customers.health_score` and inserted into
  // `customer_health_snapshots` as a dated measurement, which `getFallingCustomers`
  // later reads to tell a founder a customer is "falling".
  //
  // The discriminator is whether the product records these events AT ALL. If it
  // does, zero tickets this month is a real finding and should read like one.
  // If it does not, there is nothing to score.
  const wired = (await query(
    'SELECT 1 AS present FROM customer_events WHERE product_id = ? LIMIT 1',
    [productId],
  )).rows.length > 0;

  // Usage score (0-100): based on login/activity events
  const usage = wired
    ? Math.min(100, ((eventMap['login']?.count ?? 0) * 5) + ((eventMap['feature_used']?.count ?? 0) * 2))
    : null;

  // Support score (0-100): fewer tickets = healthier (inverted)
  const support = wired ? Math.max(0, 100 - (eventMap['support_ticket']?.count ?? 0) * 20) : null;

  // Payment score (0-100): on-time payments, no failed charges
  const failedPayments = eventMap['payment_failed']?.count ?? 0;
  const payment = wired
    ? (failedPayments === 0 ? 100 : Math.max(0, 100 - failedPayments * 30))
    : null;

  // Engagement score (0-100): recency of last activity.
  //
  // A NULL `last_active_at` scored 50, which is HIGHER than any customer whose
  // inactivity was actually measured past fourteen days (50 is the 7–14 day
  // band; 14–30 scores 25 and beyond 30 scores 10). So a customer never once
  // recorded active outranked one last seen a month ago, and landed on the safe
  // side of the at-risk line that decides who gets written to.
  const lastActive = c.last_active_at as string | null;
  let engagement: number | null = null;
  if (lastActive) {
    const daysSince = (Date.now() - new Date(lastActive).getTime()) / 86400000;
    engagement = daysSince < 1 ? 100 : daysSince < 3 ? 85 : daysSince < 7 ? 70 : daysSince < 14 ? 50 : daysSince < 30 ? 25 : 10;
  }

  // Weighted over what was measured, renormalised over those weights, and null
  // when nothing was.
  const scored: Array<[number, number]> = [
    ...(usage !== null ? [[usage, 0.30] as [number, number]] : []),
    ...(support !== null ? [[support, 0.15] as [number, number]] : []),
    ...(payment !== null ? [[payment, 0.20] as [number, number]] : []),
    ...(engagement !== null ? [[engagement, 0.35] as [number, number]] : []),
  ];
  const weightUsed = scored.reduce((sum, [, w]) => sum + w, 0);
  const healthScore = weightUsed === 0
    ? null
    : Math.round(scored.reduce((sum, [v, w]) => sum + v * w, 0) / weightUsed);
  const churnRisk = healthScore === null
    ? null
    : Math.round((100 - healthScore) / 100 * 100) / 100;
  // Expansion needs BOTH halves of its own test. Unmeasured is not "no
  // potential"; it is no answer.
  const expansionPotential = usage === null || engagement === null
    ? null
    : (usage > 70 && engagement > 70 ? Math.min(100, usage * 0.5 + engagement * 0.5) : 0);

  // Update customer record
  await query(
    `UPDATE customers SET health_score = ?, churn_risk = ?, expansion_potential = ?, updated_at = datetime('now') WHERE id = ?`,
    [healthScore, churnRisk, expansionPotential, customerId]
  );

  // Snapshot
  const today = new Date().toISOString().split('T')[0]!;
  await query(
    `INSERT INTO customer_health_snapshots (id, customer_id, product_id, snapshot_date, health_score, churn_risk, usage_score, support_score, payment_score, engagement_score)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [nanoid(), customerId, productId, today, healthScore, churnRisk, usage, support, payment, engagement]
  );

  return { health_score: healthScore, churn_risk: churnRisk, expansion_potential: expansionPotential, components: { usage, support, payment, engagement } };
}

/**
 * Refresh health scores for all customers of a product.
 */
export async function refreshAllCustomerHealth(productId: string): Promise<number> {
  const customers = await query('SELECT id FROM customers WHERE product_id = ?', [productId]);
  let refreshed = 0;
  for (const row of customers.rows as unknown as Array<Record<string, string>>) {
    await computeCustomerHealth(row.id);
    refreshed++;
  }
  return refreshed;
}

/**
 * Identify at-risk customers (churn risk > 0.6).
 */
export async function getAtRiskCustomers(productId: string): Promise<Array<Record<string, unknown>>> {
  const result = await query(
    'SELECT * FROM customers WHERE product_id = ? AND churn_risk > 0.6 ORDER BY churn_risk DESC LIMIT 20',
    [productId]
  );
  return result.rows as unknown as Array<Record<string, unknown>>;
}

/**
 * Identify expansion candidates (high usage + engagement, approaching plan limits).
 */
export async function getExpansionCandidates(productId: string): Promise<Array<Record<string, unknown>>> {
  const result = await query(
    'SELECT * FROM customers WHERE product_id = ? AND expansion_potential > 50 ORDER BY expansion_potential DESC LIMIT 20',
    [productId]
  );
  return result.rows as unknown as Array<Record<string, unknown>>;
}

/**
 * Identify champions (high health + referrals + NPS promoters).
 */
export async function identifyChampions(productId: string): Promise<number> {
  const result = await query(
    `UPDATE customers SET is_champion = 1 WHERE product_id = ? AND health_score > 80 AND churn_risk < 0.15`,
    [productId]
  );
  const champions = await query(
    'SELECT COUNT(*) as c FROM customers WHERE product_id = ? AND is_champion = 1',
    [productId]
  );
  return (champions.rows[0] as Record<string, number>)?.c ?? 0;
}

/**
 * Detect revenue concentration risk.
 */
export async function detectRevenueConcentration(productId: string): Promise<{
  concentrated: boolean;
  top_customer_pct: number;
  top_3_pct: number;
  hhi: number;
  warning: string | null;
}> {
  const customers = await query(
    'SELECT mrr_cents FROM customers WHERE product_id = ? AND mrr_cents > 0 ORDER BY mrr_cents DESC',
    [productId]
  );
  const rows = customers.rows as unknown as Array<Record<string, number>>;
  if (rows.length === 0) return { concentrated: false, top_customer_pct: 0, top_3_pct: 0, hhi: 0, warning: null };

  const totalMRR = rows.reduce((sum, r) => sum + (r.mrr_cents ?? 0), 0);
  if (totalMRR === 0) return { concentrated: false, top_customer_pct: 0, top_3_pct: 0, hhi: 0, warning: null };

  const topPct = ((rows[0]?.mrr_cents ?? 0) / totalMRR) * 100;
  const top3Pct = (rows.slice(0, 3).reduce((s, r) => s + (r.mrr_cents ?? 0), 0) / totalMRR) * 100;

  // HHI: sum of squared market shares
  const hhi = rows.reduce((sum, r) => {
    const share = (r.mrr_cents ?? 0) / totalMRR;
    return sum + share * share;
  }, 0) * 10000;

  const concentrated = topPct > 30 || top3Pct > 60;
  let warning: string | null = null;
  if (topPct > 30) warning = `Top customer is ${topPct.toFixed(0)}% of MRR. Losing them would be devastating.`;
  else if (top3Pct > 60) warning = `Top 3 customers are ${top3Pct.toFixed(0)}% of MRR. Revenue is concentrated.`;

  return { concentrated, top_customer_pct: Math.round(topPct), top_3_pct: Math.round(top3Pct), hhi: Math.round(hhi), warning };
}

/**
 * Generate customer-level insights using AI.
 */
export async function generateCustomerInsights(productId: string): Promise<CustomerInsight[]> {
  const atRisk = await getAtRiskCustomers(productId);
  const expansion = await getExpansionCandidates(productId);
  const concentration = await detectRevenueConcentration(productId);

  const insights: CustomerInsight[] = [];

  for (const c of atRisk.slice(0, 5)) {
    insights.push({
      customer_id: c.id as string,
      name: (c.name as string) ?? (c.email as string) ?? 'Unknown',
      insight_type: 'churn_risk',
      description: `Health score ${c.health_score}/100, churn risk ${((c.churn_risk as number) * 100).toFixed(0)}%. ${c.last_active_at ? `Last active: ${c.last_active_at}` : 'No recent activity.'}`,
      recommended_action: `Send a personalized check-in. Reference their specific use case.`,
    });
  }

  for (const c of expansion.slice(0, 3)) {
    insights.push({
      customer_id: c.id as string,
      name: (c.name as string) ?? (c.email as string) ?? 'Unknown',
      insight_type: 'expansion',
      description: `High usage (${c.expansion_potential}/100 potential). May be hitting plan limits.`,
      recommended_action: `Reach out about upgrading. Position as unlocking value they're already getting.`,
    });
  }

  if (concentration.warning) {
    insights.push({
      customer_id: '',
      name: 'Revenue Concentration',
      insight_type: 'concentration',
      description: concentration.warning,
      recommended_action: 'Diversify acquisition channels. Reduce single-customer dependency.',
    });
  }

  return insights;
}

/**
 * Upsert a customer record.
 */
export async function upsertCustomer(
  productId: string,
  ownerId: string,
  data: {
    external_id?: string;
    name?: string;
    email?: string;
    company?: string;
    plan?: string;
    mrr_cents?: number;
    signed_up_at?: string;
    last_active_at?: string;
    metadata?: Record<string, unknown>;
  }
): Promise<string> {
  // IT NEVER UPSERTED. This was an unconditional INSERT with a fresh nanoid,
  // on a table with no uniqueness constraint to catch the duplicate — while the
  // name and the docstring promise idempotence, which is exactly what a caller
  // syncing customers from a billing system relies on. Re-reporting the same
  // customer created a second row.
  //
  // The cost is not just a duplicate. `detectRevenueConcentration` in this file
  // sums `mrr_cents` over every row and reports "Top customer is N% of MRR.
  // Losing them would be devastating." — a threshold fired on an inflated
  // denominator. `refreshAllCustomerHealth` returns the duplicated count to the
  // founder. And the customer-store cutover criterion counts the same customer
  // twice on the legacy side.
  //
  // Matched on (product_id, external_id), because external_id is what a billing
  // system knows the customer by. NO UNIQUE INDEX IS ADDED HERE ON PURPOSE:
  // rows already written may contain duplicates, and a migration that created
  // the index would either fail on live data or have to delete a founder's
  // customers to succeed. The lookup is the fix; the constraint is a separate
  // decision that needs the data in front of it.
  const externalId = data.external_id ?? null;
  if (externalId !== null) {
    const existing = await query(
      'SELECT id FROM customers WHERE product_id = ? AND external_id = ? ORDER BY created_at ASC LIMIT 1',
      [productId, externalId],
    );
    const found = existing.rows[0] as Record<string, unknown> | undefined;
    if (found) {
      const id = found.id as string;
      // COALESCE so a partial report updates what it carries and leaves the
      // rest standing, rather than blanking fields the caller did not mention.
      await query(
        `UPDATE customers SET
           name = COALESCE(?, name), email = COALESCE(?, email),
           company = COALESCE(?, company), plan = COALESCE(?, plan),
           mrr_cents = COALESCE(?, mrr_cents),
           signed_up_at = COALESCE(datetime(?), signed_up_at),
           last_active_at = COALESCE(datetime(?), last_active_at),
           metadata = COALESCE(?, metadata),
           updated_at = datetime('now')
         WHERE id = ?`,
        [
          data.name ?? null, data.email ?? null, data.company ?? null,
          data.plan ?? null, data.mrr_cents ?? null,
          data.signed_up_at ?? null, data.last_active_at ?? null,
          data.metadata ? JSON.stringify(data.metadata) : null,
          id,
        ],
      );
      return id;
    }
  }

  const id = nanoid();
  await query(
    `INSERT INTO customers (id, product_id, owner_id, external_id, name, email, company, plan, mrr_cents, signed_up_at, last_active_at, metadata)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, datetime(?), datetime(?), ?)`,
    [
      id, productId, ownerId,
      externalId, data.name ?? null, data.email ?? null,
      data.company ?? null, data.plan ?? null, data.mrr_cents ?? 0,
      data.signed_up_at ?? null, data.last_active_at ?? null,
      data.metadata ? JSON.stringify(data.metadata) : null,
    ]
  );
  return id;
}

/**
 * Record a customer event.
 */
export async function recordCustomerEvent(
  customerId: string,
  productId: string,
  eventType: string,
  eventData?: Record<string, unknown>
): Promise<void> {
  await query(
    'INSERT INTO customer_events (id, customer_id, product_id, event_type, event_data) VALUES (?, ?, ?, ?, ?)',
    [nanoid(), customerId, productId, eventType, eventData ? JSON.stringify(eventData) : null]
  );
  // Update last_active_at
  await query('UPDATE customers SET last_active_at = datetime(\'now\'), updated_at = datetime(\'now\') WHERE id = ?', [customerId]);
}
