// =============================================================================
// WHAT FOUNDRY MAY SPEND TODAY, AND WHY — ONE READING
//
// Five ceilings touched thinking and tests, and exactly one of them refused a
// model call: the deployment's per-scope caps (ai/client.ts, migration 099's
// reservation guard). The charter's thinking rate and the pre-charter bound
// were enforced by one job skipping a pass; a company's "monthly budget"
// bounded nothing anywhere; the founder cap the ledger actually lives in
// appeared on no surface; and Controls displayed a spend figure read from a
// different table than the one enforced. So the owner read five numbers and
// could not tell which one would stop Foundry, or when.
//
// This is the one reading. `thinkingCapFor` is what the reservation guard is
// handed for the founder scope, so the number the owner reads is the number
// that refuses the call — the charter's rate when one stands, the pre-charter
// bound until then, the deployment's founder cap if it is lower. Nothing here
// widens a ceiling: every figure is the minimum of what already stood.
// =============================================================================

import { query } from '../../db/client.js';
import { PRE_CHARTER_THINKING_CENTS, envelopeReading, liveCharter } from './charter.js';

type Row = Record<string, unknown>;
const one = async (sql: string, params: unknown[]): Promise<Row | undefined> => (await query(sql, params)).rows[0] as Row | undefined;

export type CeilingScope = 'call' | 'test' | 'none';

export interface Ceiling {
  /** The name the owner reads. */
  name: string;
  cents: number;
  /** Where the number comes from, in his words. */
  source: string;
  /** What it stops: a model call at the door, a test at the carve, or nothing. */
  stops: CeilingScope;
  /** 'a day', 'the whole charter', 'a month'. */
  per: string;
}

export interface ThinkingToday {
  /** The ceiling that refuses the next call once reached. */
  bindingCents: number;
  bindingIs: 'charter' | 'pre-charter' | 'founder-cap';
  spentTodayCents: number;
  remainingTodayCents: number;
  /** Every ceiling that stands, the binding one first. */
  ceilings: Ceiling[];
  because: string;
  /** One sentence for a card. */
  sentence: string;
}

/** The deployment's caps, read from the one module that reads the env. */
async function providerCaps(): Promise<{ product: number; founder: number; global: number }> {
  const { AI_CEILINGS } = await import('../ai/client.js');
  return AI_CEILINGS();
}

/**
 * THE FOUNDER-SCOPE CAP THE RESERVATION GUARD IS HANDED. The charter's rate
 * when one stands, the pre-charter bound until then, and never above the
 * deployment's own founder cap.
 */
export async function thinkingCapFor(founderId: string, now = new Date()): Promise<number> {
  const caps = await providerCaps();
  const charter = await liveCharter(founderId, now);
  return Math.min(caps.founder, charter ? charter.cognitionCentsPerDay : PRE_CHARTER_THINKING_CENTS);
}

/** Thinking spent at one scope over the last `days` days, from the enforced ledger. */
export async function thinkingSpent(scope: 'founder' | 'product', scopeId: string, days: number, now = new Date()): Promise<number> {
  const since = new Date(now.getTime() - (days - 1) * 86_400_000).toISOString().slice(0, 10);
  const r = await one(`SELECT COALESCE(SUM(spent_cents), 0) AS c FROM ai_daily_spend WHERE scope = ? AND scope_id = ? AND date >= ? AND date <= ?`,
    [scope, scopeId, since, now.toISOString().slice(0, 10)]);
  return Math.round(Number(r?.c ?? 0));
}

const dollars = (cents: number): string => `$${(cents / 100).toFixed(2)}`;

export async function thinkingToday(founderId: string, now = new Date()): Promise<ThinkingToday> {
  const caps = await providerCaps();
  const charter = await liveCharter(founderId, now);
  const rate = charter ? charter.cognitionCentsPerDay : PRE_CHARTER_THINKING_CENTS;
  const bindingCents = Math.min(caps.founder, rate);
  const bindingIs: ThinkingToday['bindingIs'] = caps.founder < rate ? 'founder-cap' : charter ? 'charter' : 'pre-charter';
  const spentTodayCents = await thinkingSpent('founder', founderId, 1, now);
  const ceilings: Ceiling[] = [
    charter
      ? { name: 'The charter', cents: charter.cognitionCentsPerDay, source: `the thinking rate you signed on ${charter.signedAt.slice(0, 10)}`, stops: 'call', per: 'a day' }
      : { name: 'Until a charter is signed', cents: PRE_CHARTER_THINKING_CENTS, source: 'the bound Foundry thinks under before you sign anything', stops: 'call', per: 'a day' },
    // ONE OWNER: "for you" is all the thinking there is, so the per-company
    // and everything caps stand behind it, never beside it.
    { name: 'This deployment, for you (all of my thinking)', cents: caps.founder, source: 'AI_DAILY_COST_CEILING_FOUNDER_CENTS in the deployment', stops: 'call', per: 'a day' },
    { name: 'This deployment, any one company', cents: caps.product, source: 'AI_DAILY_COST_CEILING_CENTS in the deployment', stops: 'call', per: 'a day' },
    { name: 'This deployment, everything it runs (only you)', cents: caps.global, source: 'AI_DAILY_COST_CEILING_GLOBAL_CENTS in the deployment', stops: 'call', per: 'a day' },
  ];
  // The binding one first; the rest in the order they would bite.
  ceilings.sort((a, b) => a.cents - b.cents);
  const because = bindingIs === 'charter'
    ? `the charter you signed allows ${dollars(rate)} a day of thinking, and the deployment allows at least that`
    : bindingIs === 'pre-charter'
      ? `no charter is signed, so thinking is bounded at ${dollars(PRE_CHARTER_THINKING_CENTS)} a day until you sign one`
      : `the deployment stops thinking for you at ${dollars(caps.founder)} a day, below the ${charter ? 'charter’s' : 'pre-charter'} ${dollars(rate)}`;
  const remainingTodayCents = Math.max(0, bindingCents - spentTodayCents);
  const sentence = `${dollars(spentTodayCents)} of ${dollars(bindingCents)} thought today; ${because}.`;
  return { bindingCents, bindingIs, spentTodayCents, remainingTodayCents, ceilings, because, sentence };
}

export interface TestsToday {
  chartered: boolean;
  /** The charter's total for tests, and what the carve guard would still admit. */
  totalCents: number | null;
  remainingCents: number | null;
  inFlight: number;
  atOnce: number | null;
  /** Standing allowances on real assets, in cents: money already set aside for tests. */
  allowancesCents: number;
  sentence: string;
}

/** What may be spent on tests: the charter's total and what is left of it, or nothing without one. */
export async function testsToday(founderId: string, now = new Date()): Promise<TestsToday> {
  const envelope = await envelopeReading(founderId, now);
  const { realCompany } = await import('../../db/client.js');
  // STANDING DOES NOT APPLY: an allowance on an experimental asset is real
  // money the owner set aside for a test, exactly as one on an earned company
  // would be; the frontier's allowances are the allowances there are, and a
  // worst case that omitted them would be false. Reality applies: a reference
  // company's allowance is synthetic and never reaches this sum.
  const allowances = Math.round(Number((await one(
    `SELECT COALESCE(SUM(a.amount_cents), 0) AS c FROM owner_allowances a JOIN products p ON p.id = a.product_id
      WHERE p.owner_id = ? AND ${realCompany('p')} AND p.deleted_at IS NULL AND a.withdrawn_at IS NULL
        AND (a.until IS NULL OR datetime(a.until) > datetime('now'))`, [founderId]))?.c ?? 0));
  if (!envelope) {
    return { chartered: false, totalCents: null, remainingCents: null, inFlight: 0, atOnce: null, allowancesCents: allowances,
      sentence: allowances > 0
        ? `No charter is signed: every real test waits for you. ${dollars(allowances)} already set aside by you stands for the tests it was set for.`
        : 'No charter is signed: every real test waits for you, and nothing is set aside for one.' };
  }
  return { chartered: true, totalCents: envelope.charter.testsTotalCents, remainingCents: envelope.remainingCents, inFlight: envelope.inFlight,
    atOnce: envelope.charter.probesInFlight, allowancesCents: allowances,
    sentence: `${dollars(envelope.remainingCents)} of ${dollars(envelope.charter.testsTotalCents)} left for tests under the charter; ${String(envelope.inFlight)} of ${String(envelope.charter.probesInFlight)} in flight.` };
}
