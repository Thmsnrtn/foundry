// =============================================================================
// FOUNDRY — the reference world
//
// THE DEADLOCK, RESTATED. Private Foundry cannot be finished without a company
// to run it against, and no company should be entrusted to it until it is
// finished. A reference company breaks that: synthetic, structurally incapable
// of becoming owner truth (migrations 222 and 223), and rich enough to put the
// institution through the whole ladder — visible, understood, shadowing,
// assisting.
//
// THE ONE RULE THIS FILE EXISTS TO KEEP: A REHEARSAL THAT TRAVELS DIFFERENT
// CODE REHEARSES NOTHING. So the world does not write observations, does not
// derive ratios, does not touch the institution's tables. It posts numbers to
// `POST /ingest/:token` — the public, token-authenticated endpoint an outside
// tool uses — holding nothing but the token, which is all a provider holds. The
// validation, the derived `mrr_health_ratio`, the cache invalidation, the
// observation recording and the forecast reconciliation are then the SAME code
// that runs for a real company, byte for byte, because it is not code this file
// can reach around.
//
// WHERE HISTORY COMES FROM, AND WHY IT IS NOT SIMULATED TIME. Entering
// Shadowing requires a channel that has already produced readings; without
// history, that is a week away. So the past is seeded straight into
// `metric_snapshots` — which is what importing a company's history IS, and a
// company arriving with history is the ordinary case, not a special one.
//
// What is NOT seeded is observations. Nobody watched those movements happen, so
// no signal event claims they did, and no expectation can be resolved by them.
// The institution gets a channel with a past and no evidence about the future,
// which is exactly the position it is in with a real company on day one. Every
// observation that resolves anything arrives afterwards, through the front
// door, in real time. Nothing that has to be true is pretended.
//
// DETERMINISM. Every value is a pure function of (scenario, field, day). There
// is no stored dataset, no random seed to carry, and no fixture to fall out of
// date; the same scenario is the same world on every machine and every rerun.
// A rehearsal you cannot reproduce is an anecdote.
// =============================================================================

import { createHash } from 'node:crypto';
import { nanoid } from 'nanoid';
import { query } from '../../db/client.js';
import {
  REFERENCE_SCENARIOS, referenceScenario,
  type ReferenceScenario, type ScenarioMetric,
} from './scenarios.js';

/**
 * How much past a reference company arrives with.
 *
 * Long enough for the 30- and 60-day roll-ups the institution already computes
 * to have something to say, and for a trend to be a trend rather than a week of
 * weather.
 */
export const HISTORY_DAYS = 90;

/** Uniform in [-1, 1), from the reading's identity rather than from a seed. */
function jitter(seed: string): number {
  return (createHash('sha256').update(seed).digest().readUInt32BE(0) / 0x1_0000_0000) * 2 - 1;
}

/**
 * The level of one metric on one day of one scenario.
 *
 * Compound drift with proportional noise. Rates are clamped into [0,1] because
 * a retention of 1.04 is not a hard case for the institution, it is a bug in
 * the world, and the intake would rightly refuse it.
 */
export function referenceLevel(
  scenarioKey: string, metric: ScenarioMetric, day: number,
): number {
  const trend = metric.start * Math.pow(1 + metric.dailyDrift, day);
  const value = trend * (1 + metric.noise * jitter(`${scenarioKey}|${metric.field}|${String(day)}`));
  if (metric.precision === 'rate') {
    return Math.min(1, Math.max(0, Number(value.toFixed(4))));
  }
  return Math.max(0, Math.round(value));
}

/** Every metric's level on one day, keyed by the column it lives in. */
export function referenceReadings(
  scenario: ReferenceScenario, day: number,
): Record<string, number> {
  const out: Record<string, number> = {};
  for (const metric of scenario.metrics) {
    out[metric.field] = referenceLevel(scenario.key, metric, day);
  }
  return out;
}

// THE PUBLIC VOCABULARY, WHICH IS NOT THE COLUMN NAMES.
//
// `/ingest/:token` accepts `new_mrr` IN DOLLARS and stores `new_mrr_cents`;
// `mrr` means the LEVEL. A caller that posts column names gets its numbers
// filed under `custom_metrics` and silently observes nothing. So the world
// speaks the documented wire vocabulary in the documented units — which means
// the rehearsal exercises the unit conversion and the aliasing too, rather than
// reaching past them into the columns.
//
// `mrr_health_ratio` is deliberately absent: the intake derives it from new and
// churned, and a world that posted its own would be overriding the arithmetic
// it is supposed to be testing.
const WIRE_FIELD: Record<string, { key: string; dollars?: true }> = {
  mrr_cents: { key: 'mrr', dollars: true },
  new_mrr_cents: { key: 'new_mrr', dollars: true },
  expansion_mrr_cents: { key: 'expansion_mrr', dollars: true },
  contraction_mrr_cents: { key: 'contraction_mrr', dollars: true },
  churned_mrr_cents: { key: 'churned_mrr', dollars: true },
  activation_rate: { key: 'activation_rate' },
  day_30_retention: { key: 'day_30_retention' },
  churn_rate: { key: 'churn_rate' },
  signups_7d: { key: 'signups_7d' },
  active_users: { key: 'active_users' },
  support_volume_7d: { key: 'support_volume_7d' },
  nps_score: { key: 'nps_score' },
};

/** One day of the world, in the shape an outside tool would post it. */
export function referenceWirePayload(
  scenario: ReferenceScenario, day: number,
): Record<string, number> {
  const readings = referenceReadings(scenario, day);
  const body: Record<string, number> = {};
  for (const [column, value] of Object.entries(readings)) {
    const wire = WIRE_FIELD[column];
    if (!wire) continue;
    body[wire.key] = wire.dollars ? Number((value / 100).toFixed(2)) : value;
  }
  return body;
}

export interface EstablishedReferenceCompany {
  productId: string;
  ingestToken: string;
  scenario: ReferenceScenario;
}

/**
 * Bring a reference company into being, with its past.
 *
 * The `reference_companies` row is written FIRST-ish and cannot be deleted, so
 * a company that exists is always a company that says why. `reality` is set at
 * insert and is immutable thereafter: nothing here, and nothing later, can
 * promote this into a real company.
 */
export async function establishReferenceCompany(input: {
  scenarioKey: string; ownerId: string;
}): Promise<EstablishedReferenceCompany | null> {
  const scenario = referenceScenario(input.scenarioKey);
  if (!scenario) return null;

  // One reference company per scenario per owner. Establishing twice is the
  // shape a retry or a double-tapped button takes, and two identical synthetic
  // companies is a mess with no upside.
  const existing = await query(
    `SELECT p.id, p.ingest_token FROM products p
       JOIN reference_companies r ON r.product_id = p.id
      WHERE p.owner_id = ? AND p.reality = 'reference' AND r.scenario = ?`,
    [input.ownerId, scenario.situation]);
  if (existing.rows.length) {
    const row = existing.rows[0] as Record<string, unknown>;
    return {
      productId: String(row.id), ingestToken: String(row.ingest_token), scenario,
    };
  }

  const productId = nanoid();
  const ingestToken = nanoid(32);
  await query(
    `INSERT INTO products (id, name, owner_id, status, reality, ingest_token)
     VALUES (?, ?, ?, 'active', 'reference', ?)`,
    [productId, scenario.companyName, input.ownerId, ingestToken]);
  await query(
    'INSERT INTO reference_companies (product_id, scenario, purpose) VALUES (?, ?, ?)',
    [productId, scenario.situation, scenario.purpose]);

  await seedReferenceHistory(productId, scenario);
  return { productId, ingestToken, scenario };
}

/**
 * The company's past, written where a company's past lives.
 *
 * Snapshots only. No signal events: see the header — nobody observed these, so
 * nothing may claim they did.
 */
export async function seedReferenceHistory(
  productId: string, scenario: ReferenceScenario,
): Promise<number> {
  const fields = scenario.metrics.map((m) => m.field);
  let written = 0;
  for (let day = 0; day < HISTORY_DAYS; day += 1) {
    const readings = referenceReadings(scenario, day);
    const back = HISTORY_DAYS - day;
    await query(
      `INSERT INTO metric_snapshots (id, product_id, snapshot_date, ${fields.join(', ')})
       VALUES (?, ?, date('now', ?), ${fields.map(() => '?').join(', ')})
       ON CONFLICT(product_id, snapshot_date) DO NOTHING`,
      [nanoid(), productId, `-${String(back)} day`, ...fields.map((f) => readings[f])]);
    written += 1;
  }
  return written;
}

/**
 * Which day of its own story a reference company is on.
 *
 * History occupies days [0, HISTORY_DAYS); the day it was established is
 * HISTORY_DAYS; every calendar day since adds one. Derived from the immutable
 * `reference_companies.created_at` rather than stored, so it cannot disagree
 * with the row it describes.
 */
export async function referenceDayIndex(productId: string): Promise<number | null> {
  const row = (await query(
    `SELECT CAST(julianday(date('now')) - julianday(date(created_at)) AS INTEGER) AS elapsed
       FROM reference_companies WHERE product_id = ?`, [productId])).rows[0] as
    Record<string, unknown> | undefined;
  if (!row) return null;
  return HISTORY_DAYS + Math.max(0, Number(row.elapsed));
}

/**
 * Today's readings, delivered through the front door.
 *
 * THE POINT OF THE INDIRECTION. This could write `metric_snapshots` and call
 * the observation recorder in twenty lines. It posts instead, because the
 * twenty lines would be a second implementation of the intake that drifts from
 * the first, and because a reference company reaching the institution through
 * the public endpoint proves the public endpoint works. It holds the token and
 * nothing else, which is exactly what Stripe holds.
 */
export async function advanceReferenceWorld(productId: string): Promise<{
  day: number; posted: Record<string, number>; status: number;
} | null> {
  const meta = (await query(
    `SELECT p.ingest_token, r.scenario FROM products p
       JOIN reference_companies r ON r.product_id = p.id
      WHERE p.id = ?`, [productId])).rows[0] as Record<string, unknown> | undefined;
  if (!meta?.ingest_token) return null;

  const scenario = REFERENCE_SCENARIOS.find((s) => s.situation === String(meta.scenario));
  if (!scenario) return null;

  const day = await referenceDayIndex(productId);
  if (day === null) return null;

  // Straight at the router rather than through the mounted app: the reference
  // world is not a stranger on the internet and has no business consuming the
  // rate limit a real company's provider needs. Everything the handler itself
  // does — validation, units, the derived ratio, the observation, the forecast
  // reconciliation — is unchanged, and that is the part being rehearsed.
  const { ingestRoutes } = await import('../../routes/ingest/index.js');
  const posted = referenceWirePayload(scenario, day);
  const response = await ingestRoutes.request(`/ingest/${String(meta.ingest_token)}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(posted),
  });
  return { day, posted, status: response.status };
}
