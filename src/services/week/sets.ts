// =============================================================================
// FOUNDRY — the week, in five sets (Roadmap 2027 R5; STRATEGY S60).
//
// The owner asked what daily use should feel like with a livelihood at stake.
// The answer the handoff of 28 September gave is five short sets, read once a
// week, with detail only on request:
//
//   1. EARNED AND SETTLED — money a buyer actually paid, or got back.
//   2. BUYER OBLIGATIONS — what is owed to somebody who paid.
//   3. MARKETPLACE VISIBILITY — whether anybody could have found what is listed.
//   4. WORK DELIBERATELY STOPPED — what Foundry is not doing, because the owner
//      said so, so silence is never mistaken for neglect.
//   5. ONE DECISION — the one thing waiting that would change the economics.
//
// Money and attention are reported together, because a portfolio that earns
// $200 with daily support decisions may be worse than one that earns $100
// quietly (S60).
//
// A READER. It composes rows the other pages already read — the ledger, the
// obligations reader, the owner's findability word and the venue's own
// vacation reading, missions, the Mandate, the Needs-you queue — and writes
// nothing. The weekly email is this reading rendered on the server; nothing a
// caller supplies reaches its text.
// =============================================================================

import { createHash } from 'node:crypto';
import { query } from '../../db/client.js';

type Row = Record<string, unknown>;

export interface TheWeek {
  /** The first day of the window, YYYY-MM-DD, UTC. */
  since: string;
  earned: string[];
  owed: string[];
  visible: string[];
  stopped: string[];
  /** The one decision waiting, in a sentence, or null when nothing is. */
  decision: string | null;
  /** Nothing in any set: the week to say in one line. */
  quiet: boolean;
  /** Stable over the content, so an unchanged week can be recognised. */
  fingerprint: string;
}

const day = (d: Date): string => d.toISOString().slice(0, 10);
const money = (cents: number, currency: string): string =>
  `${currency.toLowerCase() === 'usd' ? '$' : ''}${(cents / 100).toFixed(2)}${currency.toLowerCase() === 'usd' ? '' : ` ${currency.toUpperCase()}`}`;

/**
 * THE WEEK ENDING `now`, IN FIVE SETS. `now` is injectable so last week can be
 * read the same way, which is how an unchanged week is recognised without
 * storing anything.
 */
export async function theWeek(founderId: string, now: Date = new Date()): Promise<TheWeek> {
  const from = new Date(now.getTime() - 7 * 86_400_000);
  const since = day(from);
  const fromIso = from.toISOString();
  const nowIso = now.toISOString();

  // 1. EARNED AND SETTLED. The ledger's own rows: a charge the provider
  // stated, a refund that went back. Nothing estimated, nothing modelled.
  // STANDING DOES NOT APPLY: `economic_events` is the owner's ledger, scoped by
  // founder, and a sale on an experimental asset is still money he was paid.
  const earned: string[] = [];
  for (const e of (await query(
    `SELECT kind, provider, currency, SUM(amount_cents) AS cents, COUNT(*) AS n
       FROM economic_events
      WHERE founder_id = ? AND kind IN ('charge','refund')
        AND datetime(occurred_at) >= datetime(?) AND datetime(occurred_at) < datetime(?)
      GROUP BY kind, provider, currency
      ORDER BY kind, provider`, [founderId, fromIso, nowIso])).rows as unknown as Row[]) {
    const n = Number(e.n);
    earned.push(String(e.kind) === 'charge'
      ? `${String(n)} ${n === 1 ? 'buyer' : 'buyers'} paid ${money(Number(e.cents), String(e.currency))} on ${String(e.provider)}`
      : `${money(Number(e.cents), String(e.currency))} went back to ${String(n)} ${n === 1 ? 'buyer' : 'buyers'} on ${String(e.provider)}`);
  }

  // 2. BUYER OBLIGATIONS, as the obligations reader states them: every one
  // still open, whenever it began. An obligation is not a weekly event.
  const { obligationsFor } = await import('../venture/obligations.js');
  const owed = (await obligationsFor(founderId, now))
    .map((o) => `${o.experimentTitle}: ${o.sentence}${o.asksHim ? ` ${o.asksHim}` : ''}`);

  // 3. MARKETPLACE VISIBILITY. For each listing the owner has spoken about or
  // a venue has been read for: his word, and the venue's own vacation reading
  // beside it, never one replacing the other.
  // STANDING DOES NOT APPLY: a listing is an experimental asset by nature, and
  // this reads the owner's own statements and the venue's readings about it.
  const { realCompany } = await import('../../db/client.js');
  const { findabilityOf, venueSaysOnVacation } = await import('../venture/findability.js');
  const visible: string[] = [];
  for (const l of (await query(
    `SELECT DISTINCT p.id, p.name, x.provider
       FROM products p
       JOIN (SELECT product_id, provider FROM venue_findability
             UNION SELECT product_id, provider FROM venue_visibility_readings) x ON x.product_id = p.id
      WHERE p.owner_id = ? AND p.deleted_at IS NULL AND ${realCompany('p')}
      ORDER BY p.name, x.provider`, [founderId])).rows as unknown as Row[]) {
    const venue = String(l.provider).charAt(0).toUpperCase() + String(l.provider).slice(1);
    const said = await findabilityOf(String(l.id), String(l.provider));
    const read = await venueSaysOnVacation(String(l.id), String(l.provider));
    const his = said === null ? 'you have not said whether buyers can find it'
      : said.findable ? `you said buyers can find it (${said.saidAt.slice(0, 10)})`
        : `you said it is hidden (${said.saidAt.slice(0, 10)})`;
    const theirs = read === null ? '' : read.onVacation
      ? `; ${venue} last said the shop is on vacation (${read.observedAt.slice(0, 10)})`
      : `; ${venue} last said the shop is open (${read.observedAt.slice(0, 10)})`;
    visible.push(`${String(l.name)} on ${venue}: ${his}${theirs}`);
  }

  // 4. WORK DELIBERATELY STOPPED: what the owner stopped this week, and what
  // the Mandate is holding Foundry away from now.
  const stopped: string[] = [];
  for (const t of (await query(
    `SELECT what_we_do, retired_because FROM venture_experiments
      WHERE founder_id = ? AND retired_at IS NOT NULL
        AND datetime(retired_at) >= datetime(?) AND datetime(retired_at) < datetime(?)
      ORDER BY retired_at, rowid`, [founderId, fromIso, nowIso])).rows as unknown as Row[]) {
    stopped.push(`the test "${String(t.what_we_do)}" was stopped: ${String(t.retired_because ?? 'no reason recorded')}`);
  }
  for (const m of (await query(
    `SELECT kind, said FROM mission_events
      WHERE founder_id = ? AND kind IN ('paused','stopped')
        AND datetime(at) >= datetime(?) AND datetime(at) < datetime(?)
      ORDER BY at, rowid`, [founderId, fromIso, nowIso])).rows as unknown as Row[]) {
    stopped.push(`a mission was ${String(m.kind)}: "${String(m.said)}"`);
  }
  const { mandateOf } = await import('../mandate/statements.js');
  for (const s of await mandateOf(founderId, now)) {
    if (s.dimension === 'avoid' || s.subject === 'conserve' || s.subject.endsWith('_theoretical')) {
      stopped.push(`you asked: "${s.statement}"${s.until ? ` (until ${s.until})` : ''}`);
    }
  }

  // 5. ONE DECISION, ranked as the Needs-you queue ranks it (by consequence).
  const { needsYou } = await import('../needs-you/queue.js');
  const top = (await needsYou(founderId, now)).items[0] ?? null;
  const decision = top ? `${top.summary}${top.companyName ? ` (${top.companyName})` : ''}. ${top.answers.whyNow}` : null;

  const quiet = earned.length + owed.length + visible.length + stopped.length === 0 && decision === null;
  const fingerprint = createHash('sha256')
    .update(JSON.stringify({ earned, owed, visible, stopped, decision })).digest('hex').slice(0, 16);
  return { since, earned, owed, visible, stopped, decision, quiet, fingerprint };
}

/** The ISO week a date falls in, `YYYY-Www`, for the once-a-week key. */
export function isoWeek(d: Date): string {
  const t = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  const dow = t.getUTCDay() || 7;
  t.setUTCDate(t.getUTCDate() + 4 - dow);
  const yearStart = new Date(Date.UTC(t.getUTCFullYear(), 0, 1));
  const week = Math.ceil(((t.getTime() - yearStart.getTime()) / 86_400_000 + 1) / 7);
  return `${String(t.getUTCFullYear())}-W${String(week).padStart(2, '0')}`;
}

/**
 * SHOULD THIS WEEK BE SENT? Not when it is quiet, and not when it says exactly
 * what last week said: the waiting window before a first sale produces the
 * same five sets week after week, and the fourth identical email is the one
 * that teaches the owner to stop opening them.
 */
export async function worthSending(founderId: string, now: Date = new Date()): Promise<{ send: boolean; week: TheWeek; why: string }> {
  const week = await theWeek(founderId, now);
  if (week.quiet) return { send: false, week, why: 'quiet' };
  const last = await theWeek(founderId, new Date(now.getTime() - 7 * 86_400_000));
  if (last.fingerprint === week.fingerprint) return { send: false, week, why: 'unchanged' };
  return { send: true, week, why: 'changed' };
}
