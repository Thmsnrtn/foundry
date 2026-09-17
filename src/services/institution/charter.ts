// =============================================================================
// FOUNDRY — the charter the owner signs once
//
// A studio that must ask the owner before each small thing makes the owner
// its job. A charter is his standing word instead: signed once on Controls,
// read by everything that would otherwise ask him, ended on a date he can see.
// Inside it a probe is let in, spends what was carved for it, writes to
// strangers under the sealed contact rules, sells and refunds — with no tap
// from him. Outside it, nothing changes: the act waits on the Decisions page
// exactly as it did before this file existed.
//
// The authority is the database's, not this file's. `portfolio_envelopes`
// refuses a signature that is not the owner's; `portfolio_envelope_carves`
// refuses the fourth probe and the carve over the month; the act-decision
// guard refuses `charter:<id>` the moment the envelope is withdrawn or expired.
// This file asks those rows and says the answers in his words.
// =============================================================================
import { nanoid } from 'nanoid';
import { query } from '../../db/client.js';

type Row = Record<string, unknown>;
const rows = async (sql: string, params: unknown[]): Promise<Row[]> =>
  (await query(sql, params)).rows as unknown as Row[];

export interface Charter {
  id: string;
  founderId: string;
  monthlyCents: number;
  probesInFlight: number;
  cognitionCentsPerDay: number;
  contactRules: string;
  publicVoice: string;
  statement: string;
  /** The principal on the signature. The row guard admits only `founder:<id>`; the card says so back to him. */
  signedBy: string;
  signedAt: string;
  expiresAt: string;
  daysLeft: number;
}

/** The principal a live charter decides acts as. Read by the row guard. */
export const charterPrincipal = (charterId: string): string => `charter:${charterId}`;

/** What every charter says about writing to people. Sealed with the signature;
 *  a probe inside the charter inherits it and cannot loosen it. */
export const SEALED_CONTACT_RULES =
  'One message per person or business, ever, unless they reply. Anyone who asks to hear nothing further is never written to again, and an owner exclusion outranks everything. '
  + 'Every message says who is writing, gives a postal address and a way to stop, points at a page that has been read back from the world, and offers one plain thing at one plain price. '
  + 'The Workshop writes in its own name; no person is named on any public surface.';

const charterOf = (r: Row, now: Date): Charter => ({
  id: String(r.id), founderId: String(r.founder_id),
  monthlyCents: Number(r.monthly_cents), probesInFlight: Number(r.probes_in_flight),
  cognitionCentsPerDay: Number(r.cognition_cents_per_day),
  contactRules: String(r.contact_rules), publicVoice: String(r.public_voice),
  statement: String(r.statement), signedBy: String(r.signed_by), signedAt: String(r.signed_at), expiresAt: String(r.expires_at),
  daysLeft: Math.max(0, Math.ceil((utc(String(r.expires_at)) - now.getTime()) / 86_400_000)),
});

/** SQLite writes 'YYYY-MM-DD HH:MM:SS' in UTC and says nothing about the zone. */
const utc = (s: string): number => Date.parse(/[TZ]/.test(s) ? s : `${s.replace(' ', 'T')}Z`);

/** The owner's live charter, or null when none is standing. */
export async function liveCharter(founderId: string, now: Date = new Date()): Promise<Charter | null> {
  const r = (await rows(
    `SELECT id, founder_id, monthly_cents, probes_in_flight, cognition_cents_per_day,
            contact_rules, public_voice, statement, signed_by, signed_at, expires_at
       FROM portfolio_envelopes
      WHERE founder_id = ? AND withdrawn_at IS NULL AND datetime(expires_at) > datetime('now')
      ORDER BY signed_at DESC LIMIT 1`, [founderId]))[0];
  return r ? charterOf(r, now) : null;
}

/** The charters that have ended, newest first, with why. */
export async function pastCharters(founderId: string): Promise<Array<{ id: string; signedAt: string; endedAt: string; because: string }>> {
  return (await rows(
    `SELECT id, signed_at, expires_at, withdrawn_at, withdraw_reason FROM portfolio_envelopes
      WHERE founder_id = ? AND (withdrawn_at IS NOT NULL OR datetime(expires_at) <= datetime('now'))
      ORDER BY signed_at DESC, rowid DESC LIMIT 6`, [founderId])).map((r) => ({
    id: String(r.id), signedAt: String(r.signed_at).slice(0, 10),
    endedAt: String(r.withdrawn_at ?? r.expires_at).slice(0, 10),
    because: r.withdrawn_at == null ? 'it ran out' : String(r.withdraw_reason),
  }));
}

/**
 * HE SIGNS. The row guard refuses any other principal; this passes his
 * identity through as `founder:<id>` and nothing else can. A live charter is
 * ended first with the reason recorded, so renewing is one act on one page.
 */
export async function signCharter(input: {
  founderId: string; monthlyCents: number; probesInFlight: number; cognitionCentsPerDay: number;
  publicVoice: string; statement: string; contactRules?: string; days?: number;
}): Promise<string> {
  const days = Math.min(92, Math.max(1, Math.round(input.days ?? 90)));
  const standing = await liveCharter(input.founderId);
  if (standing) await withdrawCharter({ founderId: input.founderId, reason: 'replaced by a new signature' });
  const id = nanoid();
  await query(
    `INSERT INTO portfolio_envelopes
       (id, founder_id, monthly_cents, probes_in_flight, cognition_cents_per_day,
        contact_rules, public_voice, statement, signed_by, expires_at)
     VALUES (?,?,?,?,?,?,?,?,?, datetime('now', ?))`,
    [id, input.founderId, Math.round(input.monthlyCents), Math.round(input.probesInFlight),
      Math.round(input.cognitionCentsPerDay), (input.contactRules ?? SEALED_CONTACT_RULES).trim(),
      input.publicVoice.trim(), input.statement.trim(), `founder:${input.founderId}`, `+${String(days)} days`]);
  return id;
}

/** He takes it back, with a reason, and nothing decides as the charter again. */
export async function withdrawCharter(input: { founderId: string; reason: string }): Promise<boolean> {
  const live = await liveCharter(input.founderId);
  if (!live) return false;
  await query(
    `UPDATE portfolio_envelopes SET withdrawn_at = datetime('now'), withdraw_reason = ?
      WHERE id = ? AND withdrawn_at IS NULL`, [input.reason.trim() || 'the owner withdrew it', live.id]);
  return true;
}

export interface EnvelopeReading {
  charter: Charter;
  /** Carved for probes this calendar month. */
  carvedCents: number;
  /** Thinking bought at his scope this calendar month. */
  thinkingCents: number;
  remainingCents: number;
  inFlight: number;
  roomForAnother: boolean;
  carves: Array<{ experimentId: string; productId: string; cents: number; carvedAt: string; settled: boolean }>;
}

/** What the envelope holds and what has been taken from it, as arithmetic. */
export async function envelopeReading(founderId: string, now: Date = new Date()): Promise<EnvelopeReading | null> {
  const charter = await liveCharter(founderId, now);
  if (!charter) return null;
  const carves = (await rows(
    `SELECT c.experiment_id, c.product_id, c.cents, c.carved_at,
            CASE WHEN x.what_happened IS NULL AND x.retired_at IS NULL AND x.validity = 'valid'
                      AND x.superseded_by IS NULL AND coalesce(x.decision,'') <> 'declined'
                 THEN 0 ELSE 1 END AS settled
       FROM portfolio_envelope_carves c
       JOIN venture_experiments x ON x.id = c.experiment_id
      WHERE c.envelope_id = ? ORDER BY c.carved_at DESC`, [charter.id])).map((r) => ({
    experimentId: String(r.experiment_id), productId: String(r.product_id), cents: Number(r.cents),
    carvedAt: String(r.carved_at), settled: Number(r.settled) === 1,
  }));
  const month = now.toISOString().slice(0, 7);
  const carvedCents = carves.filter((c) => c.carvedAt.slice(0, 7) === month).reduce((n, c) => n + c.cents, 0);
  const thinkingCents = Math.round(Number(((await rows(
    `SELECT COALESCE(SUM(spent_cents), 0) AS c FROM ai_daily_spend
      WHERE scope = 'founder' AND scope_id = ? AND date >= ?`, [founderId, `${month}-01`]))[0] as Row).c));
  const inFlight = carves.filter((c) => !c.settled).length;
  return {
    charter, carvedCents, thinkingCents,
    remainingCents: Math.max(0, charter.monthlyCents - carvedCents - thinkingCents),
    inFlight, roomForAnother: inFlight < charter.probesInFlight, carves,
  };
}

export type Chartered = { inside: true; charter: Charter } | { inside: false; because: string[]; charter: Charter | null };

/**
 * IS THIS PROBE INSIDE THE CHARTER? Answered from rows, in his words, before
 * anything is decided: a live charter, money left for it this month, a place
 * in flight, and nothing on a rung the charter can never absorb.
 */
export async function chartered(input: {
  founderId: string; experimentId: string; costCents: number;
  /** The rungs the probe's acts stand on. `legal` and `destructive` are never inside. */
  rungs: string[];
}): Promise<Chartered> {
  const reading = await envelopeReading(input.founderId);
  if (!reading) return { inside: false, because: ['no charter is standing; sign one on Controls, or allow this test yourself'], charter: null };
  const because: string[] = [];
  const never = input.rungs.filter((r) => r === 'legal' || r === 'destructive');
  if (never.length) because.push(`an act on the ${never.join(' and ')} rung is yours to decide each time; no charter covers it`);
  if (input.costCents > reading.remainingCents) {
    because.push(`it would take $${(input.costCents / 100).toFixed(2)} and $${(reading.remainingCents / 100).toFixed(2)} is left of this month's $${(reading.charter.monthlyCents / 100).toFixed(2)}`);
  }
  if (!reading.roomForAnother) {
    because.push(`${String(reading.inFlight)} of ${String(reading.charter.probesInFlight)} probes are already in flight`);
  }
  const already = await rows('SELECT id FROM portfolio_envelope_carves WHERE experiment_id = ?', [input.experimentId]);
  if (already.length) because.push('this test was already let in once');
  return because.length ? { inside: false, because, charter: reading.charter } : { inside: true, charter: reading.charter };
}

/**
 * LET A PROBE IN. Writes the carve the arithmetic reads; the row guard is the
 * one that says no when the month or the places are spent, so a caller that
 * skipped `chartered` still cannot get past.
 */
export async function carve(input: { charterId: string; experimentId: string; productId: string; cents: number }): Promise<string> {
  const id = nanoid();
  await query(
    `INSERT INTO portfolio_envelope_carves (id, envelope_id, experiment_id, product_id, cents)
     VALUES (?,?,?,?,?)`, [id, input.charterId, input.experimentId, input.productId, Math.max(0, Math.round(input.cents))]);
  return id;
}

/** The charter, in the words the Controls card and the Home tile say. */
export function charterSentence(r: EnvelopeReading): string {
  const left = (r.remainingCents / 100).toFixed(0);
  const of = (r.charter.monthlyCents / 100).toFixed(0);
  return `$${left} of $${of} left this month · ${String(r.inFlight)} of ${String(r.charter.probesInFlight)} in flight · ${String(r.charter.daysLeft)} ${r.charter.daysLeft === 1 ? 'day' : 'days'} left`;
}
