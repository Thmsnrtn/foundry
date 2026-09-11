// =============================================================================
// FOUNDRY — The deliberation, recorded before the answer.
//
// `services/founder/why.ts` said it first: a page whose whole purpose is
// showing its work may not manufacture a thought process after the fact, and
// "a later deliberation trace can persist the real thing prospectively, at
// judgement time, where it would actually be evidence." This is that trace.
//
// It exists because the first real experiment reached the edge of the world
// and the institution could record what it predicted but not what it had
// thought: which uncertainty the test was for and why that one, what else the
// same silence could mean, which exchange was chosen and what that exchange
// confounds, what the test could not prove however it turned out, and what it
// truly cost in the dimensions that are not cash.
//
// NOTHING HERE IS A SCORE. There is no weight, no confidence and no expected
// value. Levels are words and every one carries its grounds, because a number
// becomes reality merely by being numeric and this is precisely the place that
// would happen.
// =============================================================================

import { nanoid } from 'nanoid';
import { query } from '../../db/client.js';

export type Exchange = 'upfront_price' | 'value_first' | 'sample_then_paid' | 'deposit_then_valuation'
  | 'subscription' | 'usage' | 'license' | 'free_with_role';
export type CostLevel = 'none' | 'low' | 'material' | 'high';
export type Recommendation = 'run' | 'reframe' | 'defer' | 'kill';
export type StopKind = 'complaints' | 'bounces' | 'opt_outs' | 'declined_value' | 'unfulfillable' | 'bounce_rate';

type Row = Record<string, unknown>;
const rows = async (sql: string, params: unknown[] = []): Promise<Row[]> => (await query(sql, params)).rows as unknown as Row[];
const one = async (sql: string, params: unknown[] = []): Promise<Row | undefined> => (await rows(sql, params))[0];

export class DesignRefused extends Error {
  constructor(public readonly code: string, detail?: string) { super(detail ? `${code}: ${detail}` : code); this.name = 'DesignRefused'; }
}

export interface ExchangeFacts { exchange: Exchange; whatItIs: string; reveals: string; confounds: string; captureEvidence: string | null; available: boolean }
export interface Interpretation { observation: string; reading: string; distinguishedBy: string | null }
export interface Alternative { exchange: Exchange; whatItIs: string; notChosenBecause: string }
export interface Cost { dimension: string; whatItIs: string; level: CostLevel; grounds: string }
export interface StopCondition { kind: StopKind; whatItIs: string; counted: string; threshold: number; because: string; triggeredAt: string | null; triggeredDetail: string | null }

export interface ProbeDesign {
  experimentId: string; founderId: string;
  decides: string; decidesBecause: string;
  exchange: ExchangeFacts; exchangeBecause: string;
  canProve: string; cannotProve: string;
  ratherThanWaiting: string; distribution: string; ifItSucceeds: string;
  fulfilmentCap: number | null;
  recommendation: Recommendation; recommendationBecause: string;
  designedBy: string; designedAt: string; sealedAt: string | null;
  /** Narrowed before it was sealed, and why. Null when it stands as first written. */
  amendedAt: string | null; amendedBecause: string | null;
  interpretations: Interpretation[]; alternatives: Alternative[]; costs: Cost[]; stopConditions: StopCondition[];
  amendments: Amendment[];
}

export interface Amendment { field: string; was: string; readsNow: string; because: string; amendedBy: string; amendedAt: string }

export async function exchanges(): Promise<ExchangeFacts[]> {
  return (await rows('SELECT * FROM probe_exchanges ORDER BY sort_order')).map(projectExchange);
}
const projectExchange = (r: Row): ExchangeFacts => ({
  exchange: String(r.exchange) as Exchange, whatItIs: String(r.what_it_is), reveals: String(r.reveals),
  confounds: String(r.confounds), captureEvidence: r.capture_evidence == null ? null : String(r.capture_evidence),
  available: Number(r.available) === 1,
});

/** Record the thinking, before the owner decides. Refused afterwards by the row. */
export async function recordDesign(input: {
  founderId: string; experimentId: string;
  decides: string; decidesBecause: string;
  exchange: Exchange; exchangeBecause: string;
  canProve: string; cannotProve: string;
  ratherThanWaiting: string; distribution: string; ifItSucceeds: string;
  fulfilmentCap?: number | null;
  recommendation: Recommendation; recommendationBecause: string;
  designedBy: string;
  interpretations?: Array<{ observation: string; reading: string; distinguishedBy?: string | null }>;
  alternatives?: Array<{ exchange: Exchange; notChosenBecause: string }>;
  costs?: Array<{ dimension: string; level: CostLevel; grounds: string }>;
  stopConditions?: Array<{ kind: StopKind; threshold: number; because: string }>;
}): Promise<ProbeDesign> {
  const existing = await designOf(input.experimentId);
  if (existing) throw new DesignRefused('already_designed', 'this experiment already carries a deliberation');
  await query(
    `INSERT INTO probe_designs (experiment_id, founder_id, decides, decides_because, exchange, exchange_because,
       can_prove, cannot_prove, rather_than_waiting, distribution, if_it_succeeds, fulfilment_cap,
       recommendation, recommendation_because, designed_by)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    [input.experimentId, input.founderId, input.decides.trim(), input.decidesBecause.trim(), input.exchange,
      input.exchangeBecause.trim(), input.canProve.trim(), input.cannotProve.trim(), input.ratherThanWaiting.trim(),
      input.distribution.trim(), input.ifItSucceeds.trim(), input.fulfilmentCap ?? null,
      input.recommendation, input.recommendationBecause.trim(), input.designedBy]);
  for (const i of input.interpretations ?? []) {
    await query('INSERT INTO probe_interpretations (id, experiment_id, founder_id, observation, reading, distinguished_by) VALUES (?,?,?,?,?,?)',
      [nanoid(), input.experimentId, input.founderId, i.observation.trim(), i.reading.trim(), i.distinguishedBy?.trim() || null]);
  }
  for (const a of input.alternatives ?? []) {
    await query('INSERT INTO probe_alternatives (id, experiment_id, founder_id, exchange, not_chosen_because) VALUES (?,?,?,?,?)',
      [nanoid(), input.experimentId, input.founderId, a.exchange, a.notChosenBecause.trim()]);
  }
  for (const c of input.costs ?? []) {
    await query('INSERT INTO probe_costs (id, experiment_id, founder_id, dimension, level, grounds) VALUES (?,?,?,?,?,?)',
      [nanoid(), input.experimentId, input.founderId, c.dimension, c.level, c.grounds.trim()]);
  }
  for (const s of input.stopConditions ?? []) {
    await query('INSERT INTO probe_stop_conditions (id, experiment_id, founder_id, kind, threshold, because) VALUES (?,?,?,?,?,?)',
      [nanoid(), input.experimentId, input.founderId, s.kind, s.threshold, s.because.trim()]);
  }
  return (await designOf(input.experimentId))!;
}

export async function designOf(experimentId: string): Promise<ProbeDesign | null> {
  const d = await one(
    `SELECT d.*, x.what_it_is, x.reveals, x.confounds, x.capture_evidence, x.available
       FROM probe_designs d JOIN probe_exchanges x ON x.exchange = d.exchange WHERE d.experiment_id = ?`, [experimentId]);
  if (!d) return null;
  const interpretations = (await rows('SELECT observation, reading, distinguished_by FROM probe_interpretations WHERE experiment_id = ? ORDER BY rowid', [experimentId]))
    .map((r) => ({ observation: String(r.observation), reading: String(r.reading), distinguishedBy: r.distinguished_by == null ? null : String(r.distinguished_by) }));
  const alternatives = (await rows(
    `SELECT a.exchange, a.not_chosen_because, x.what_it_is FROM probe_alternatives a
       JOIN probe_exchanges x ON x.exchange = a.exchange WHERE a.experiment_id = ? ORDER BY x.sort_order`, [experimentId]))
    .map((r) => ({ exchange: String(r.exchange) as Exchange, whatItIs: String(r.what_it_is), notChosenBecause: String(r.not_chosen_because) }));
  const costs = (await rows(
    `SELECT c.dimension, c.level, c.grounds, k.what_it_is FROM probe_costs c
       JOIN probe_cost_dimensions k ON k.dimension = c.dimension WHERE c.experiment_id = ? ORDER BY k.sort_order`, [experimentId]))
    .map((r) => ({ dimension: String(r.dimension), whatItIs: String(r.what_it_is), level: String(r.level) as CostLevel, grounds: String(r.grounds) }));
  const stopConditions = (await rows(
    `SELECT s.kind, s.threshold, s.because, s.triggered_at, s.triggered_detail, k.what_it_is, k.counted_one, k.counted_many
       FROM probe_stop_conditions s
       JOIN probe_stop_kinds k ON k.kind = s.kind WHERE s.experiment_id = ? ORDER BY k.sort_order`, [experimentId]))
    .map((r) => ({ kind: String(r.kind) as StopKind, whatItIs: String(r.what_it_is),
      counted: String(Number(r.threshold) === 1 ? r.counted_one : r.counted_many), threshold: Number(r.threshold),
      because: String(r.because), triggeredAt: r.triggered_at == null ? null : String(r.triggered_at),
      triggeredDetail: r.triggered_detail == null ? null : String(r.triggered_detail) }));
  const amendments = (await rows(
    `SELECT field, was, reads_now, because, amended_by, amended_at FROM probe_design_amendments
      WHERE experiment_id = ? ORDER BY amended_at, rowid`, [experimentId]))
    .map((r) => ({ field: String(r.field), was: String(r.was), readsNow: String(r.reads_now),
      because: String(r.because), amendedBy: String(r.amended_by), amendedAt: String(r.amended_at) }));
  return {
    experimentId, founderId: String(d.founder_id),
    decides: String(d.decides), decidesBecause: String(d.decides_because),
    exchange: projectExchange(d), exchangeBecause: String(d.exchange_because),
    canProve: String(d.can_prove), cannotProve: String(d.cannot_prove),
    ratherThanWaiting: String(d.rather_than_waiting), distribution: String(d.distribution), ifItSucceeds: String(d.if_it_succeeds),
    fulfilmentCap: d.fulfilment_cap == null ? null : Number(d.fulfilment_cap),
    recommendation: String(d.recommendation) as Recommendation, recommendationBecause: String(d.recommendation_because),
    designedBy: String(d.designed_by), designedAt: String(d.designed_at),
    sealedAt: d.sealed_at == null ? null : String(d.sealed_at),
    amendedAt: d.amended_at == null ? null : String(d.amended_at),
    amendedBecause: d.amended_because == null ? null : String(d.amended_because),
    interpretations, alternatives, costs, stopConditions, amendments,
  };
}

const AMENDABLE = {
  decides: 'decides', decidesBecause: 'decides_because', exchangeBecause: 'exchange_because',
  canProve: 'can_prove', cannotProve: 'cannot_prove', ratherThanWaiting: 'rather_than_waiting',
  distribution: 'distribution', ifItSucceeds: 'if_it_succeeds',
  recommendationBecause: 'recommendation_because',
} as const;
export type AmendableField = keyof typeof AMENDABLE;

/**
 * NARROW A CLAIM BEFORE THE WORLD IS ASKED, AND SAY THAT YOU DID.
 *
 * The one legitimate reason to change a recorded deliberation is that the
 * claim it states is broader than the exchange it chose can establish. Doing
 * that before the owner decides is honest; doing it afterwards is narration.
 * So this refuses once sealed, refuses without a reason, keeps every sentence
 * it replaced, and stamps the design — a design that was narrowed can never
 * afterwards be read as one that was always this narrow.
 *
 * The exchange itself is deliberately not amendable. Changing the instrument
 * is designing a different probe, and a different probe deserves its own
 * record rather than this one with a new sentence in it.
 */
export async function amendDesign(input: {
  experimentId: string; because: string; amendedBy: string;
  fields?: Partial<Record<AmendableField, string>>;
  interpretations?: Array<{ observation: string; was: string; reading: string; distinguishedBy?: string | null }>;
  /**
   * A READING NOBODY HAD THOUGHT OF YET. Adding one before the seal is not
   * rewriting the deliberation — it is the deliberation getting better — but it
   * is recorded in the ledger all the same, because a probe that quietly grew a
   * new way to read its own result would be indistinguishable from one that had
   * always been that careful.
   */
  addInterpretations?: Array<{ observation: string; reading: string; distinguishedBy?: string | null }>;
}): Promise<{ amended: number; design: ProbeDesign }> {
  const d = await designOf(input.experimentId);
  if (!d) throw new DesignRefused('no_design', 'there is no deliberation to amend');
  if (d.sealedAt !== null) throw new DesignRefused('is_sealed', 'the deliberation was sealed when you decided; it is the record now');
  const because = input.because.trim();
  if (!because) throw new DesignRefused('needs_a_reason', 'an amendment without a stated reason is a silent rewrite');

  const ledger: Array<[string, string, string]> = [];
  const sets: string[] = []; const args: unknown[] = [];
  for (const [key, column] of Object.entries(AMENDABLE) as Array<[AmendableField, string]>) {
    const next = input.fields?.[key]?.trim();
    if (next === undefined || next === (d[key] as string)) continue;
    ledger.push([key, d[key] as string, next]);
    sets.push(`${column} = ?`); args.push(next);
  }
  for (const i of input.interpretations ?? []) {
    const had = d.interpretations.find((x) => x.observation === i.observation && x.reading === i.was);
    if (!had || had.reading === i.reading.trim()) continue;
    ledger.push([`interpretation: ${i.observation}`, had.reading, i.reading.trim()]);
  }
  for (const i of input.addInterpretations ?? []) {
    if (d.interpretations.some((x) => x.observation === i.observation && x.reading === i.reading.trim())) continue;
    ledger.push([`new reading of "${i.observation}"`, '(no reading of this was recorded)', i.reading.trim()]);
  }
  if (ledger.length === 0) return { amended: 0, design: d };

  // THE LEDGER FIRST. The design's own trigger refuses a stamp that no
  // amendment stands behind, and refuses a changed sentence that carries no
  // stamp — so the words being replaced are kept before they can be replaced,
  // and the whole change lands as one statement rather than a sequence of
  // edits any one of which would look unexplained.
  for (const [field, was, readsNow] of ledger) {
    await query(
      `INSERT INTO probe_design_amendments (id, experiment_id, founder_id, field, was, reads_now, because, amended_by)
       VALUES (?,?,?,?,?,?,?,?)`,
      [nanoid(), input.experimentId, d.founderId, field, was, readsNow, because, input.amendedBy]);
  }
  for (const i of input.interpretations ?? []) {
    await query(
      `UPDATE probe_interpretations SET reading = ?, distinguished_by = ?
        WHERE experiment_id = ? AND observation = ? AND reading = ?`,
      [i.reading.trim(), i.distinguishedBy?.trim() ?? null, input.experimentId, i.observation, i.was]);
  }
  for (const i of input.addInterpretations ?? []) {
    if (d.interpretations.some((x) => x.observation === i.observation && x.reading === i.reading.trim())) continue;
    await query('INSERT INTO probe_interpretations (id, experiment_id, founder_id, observation, reading, distinguished_by) VALUES (?,?,?,?,?,?)',
      [nanoid(), input.experimentId, d.founderId, i.observation.trim(), i.reading.trim(), i.distinguishedBy?.trim() || null]);
  }
  if (sets.length === 0) {
    await query(`UPDATE probe_designs SET amended_at = strftime('%Y-%m-%d %H:%M:%f','now'), amended_because = ? WHERE experiment_id = ?`, [because, input.experimentId]);
    return { amended: ledger.length, design: (await designOf(input.experimentId))! };
  }
  // SUB-SECOND, because two amendments in the same second are still two
  // amendments and the row must be able to say so — the stamp is what the
  // trigger reads to know a change was declared rather than slipped in.
  sets.push(`amended_at = strftime('%Y-%m-%d %H:%M:%f','now')`, 'amended_because = ?'); args.push(because, input.experimentId);
  await query(`UPDATE probe_designs SET ${sets.join(', ')} WHERE experiment_id = ?`, args);
  return { amended: ledger.length, design: (await designOf(input.experimentId))! };
}

/** Sealed with the prediction, at the owner's decision, for the same reason. */
export async function sealDesign(experimentId: string): Promise<void> {
  await query(`UPDATE probe_designs SET sealed_at = datetime('now') WHERE experiment_id = ? AND sealed_at IS NULL`, [experimentId]);
}

/**
 * WHAT THE DESIGN SAYS THE INSTITUTION IS NOT READY FOR.
 *
 * Read before the owner is asked to allow anything. A design that names an
 * exchange Foundry cannot execute is not a failure of the design — it is the
 * design being honest about an instrument that has not been built — and the
 * refusal says exactly that rather than quietly running a different test.
 */
export async function designStandsInTheWay(experimentId: string): Promise<string[]> {
  const d = await designOf(experimentId);
  if (!d) return ['no deliberation is recorded for this test; the thinking comes before the decision'];
  const missing: string[] = [];
  if (!d.exchange.available) {
    missing.push(`the exchange it needs — ${d.exchange.whatItIs} — is chosen but not yet something Foundry can run`);
  }
  if (d.recommendation === 'kill') missing.push('the deliberation recommends not running it');
  if (d.recommendation === 'defer') missing.push('the deliberation recommends waiting');
  if (d.interpretations.length === 0) missing.push('no competing readings of the likely result are recorded');
  if (d.costs.length === 0) missing.push('no cost beyond cash is recorded');
  return missing;
}

// ─── Stopping before the budget is spent ─────────────────────────────────────

export interface StopReading { kind: StopKind; whatItIs: string; count: number; threshold: number; because: string; met: boolean }

/**
 * WHAT THE WORLD HAS DONE AGAINST WHAT WOULD STOP IT. Counted from the same
 * rows everything else is: the provider's reports and the Workshop's own
 * lists. A budget is a ceiling, not a target, and once the decision is clear
 * further exposure buys nothing and costs other people's attention.
 */
/**
 * HOW MANY MUST HAVE BEEN TRIED before a proportion of them is a fact.
 *
 * IT IS TIED TO THE FIRST STAGE, and that is the whole point. The first pass
 * writes to five strangers precisely so that a wrong list is caught before the
 * rest of the cohort is spent; a floor above five would mean the rate cannot be
 * read at the only moment it could still prevent anything.
 *
 * This was eight, chosen when the cohort was expected to be thirty or forty and
 * the first two stages together came to seventeen. Against the cohort that
 * actually qualified — eight businesses — a floor of eight made the rate dead
 * by construction: it could not be read until the last message had already
 * gone. A stop condition that can only fire after the harm is a stop condition
 * in name.
 *
 * Five is the smallest number that still deserves the word "proportion" here:
 * one bad address in the first stage reads as twenty percent and does not
 * stop anything; two reads as forty and does.
 */
export const BOUNCE_RATE_FLOOR = 5;

export async function readStopConditions(experimentId: string): Promise<StopReading[]> {
  const conditions = await rows(
    `SELECT s.kind, s.threshold, s.because, k.what_it_is FROM probe_stop_conditions s
       JOIN probe_stop_kinds k ON k.kind = s.kind WHERE s.experiment_id = ? ORDER BY k.sort_order`, [experimentId]);
  if (conditions.length === 0) return [];
  const exposure = await one('SELECT id FROM experiment_exposures WHERE experiment_id = ? ORDER BY placed_at DESC, rowid DESC LIMIT 1', [experimentId]);
  const exposureId = exposure ? String(exposure.id) : null;
  const countOf = async (kind: StopKind): Promise<number> => {
    switch (kind) {
      case 'complaints':
        return exposureId ? Number((await one(`SELECT COUNT(*) AS n FROM business_outcome_events WHERE exposure_id = ? AND kind = 'complaint'`, [exposureId]))?.n ?? 0) : 0;
      case 'declined_value':
        return exposureId ? Number((await one(`SELECT COUNT(*) AS n FROM business_outcome_events WHERE exposure_id = ? AND kind = 'declined_value'`, [exposureId]))?.n ?? 0) : 0;
      case 'bounces':
        return Number((await one(`SELECT COUNT(*) AS n FROM outbound_actions WHERE experiment_id = ? AND experiment_act = 'offer' AND outcome_status = 'verified_failure'`, [experimentId]))?.n ?? 0);
      case 'opt_outs':
        return Number((await one('SELECT COUNT(*) AS n FROM public_suppressions WHERE experiment_id = ?', [experimentId]))?.n ?? 0);
      // A RATE, NOT A COUNT, AND ONLY ONCE IT MEANS SOMETHING. One bounce out
      // of one attempt is a hundred percent and is not evidence of anything.
      // Below the floor the reading is zero, so a rate can never stop a probe
      // on arithmetic that has not earned the word "proportion" yet.
      case 'bounce_rate': {
        const attempted = Number((await one(`SELECT COUNT(*) AS n FROM outbound_actions WHERE experiment_id = ? AND experiment_act = 'offer' AND status = 'executed'`, [experimentId]))?.n ?? 0);
        if (attempted < BOUNCE_RATE_FLOOR) return 0;
        const failed = Number((await one(`SELECT COUNT(*) AS n FROM outbound_actions WHERE experiment_id = ? AND experiment_act = 'offer' AND outcome_status = 'verified_failure'`, [experimentId]))?.n ?? 0);
        return Math.round((failed * 100) / attempted);
      }
      case 'unfulfillable':
        // FAILED, NOT MERELY OWED. A purchase waiting for the next pass to
        // deliver it is the system working; counting it here would stop the
        // probe on its first sale and call the success an unmet obligation.
        return Number((await one(`SELECT COUNT(*) AS n FROM experiment_fulfilments WHERE experiment_id = ? AND status = 'failed'`, [experimentId]))?.n ?? 0);
      default: return 0;
    }
  };
  const out: StopReading[] = [];
  for (const c of conditions) {
    const kind = String(c.kind) as StopKind;
    const count = await countOf(kind);
    const threshold = Number(c.threshold);
    out.push({ kind, whatItIs: String(c.what_it_is), count, threshold, because: String(c.because), met: count >= threshold });
  }
  return out;
}

/**
 * Record the ones the world has met, and answer whether writing to anybody
 * else should stop. Idempotent: a condition is triggered once.
 */
export async function stopConditionsMet(experimentId: string): Promise<{ stop: boolean; because: string[] }> {
  const readings = await readStopConditions(experimentId);
  const met = readings.filter((r) => r.met);
  for (const r of met) {
    await query(
      `UPDATE probe_stop_conditions SET triggered_at = datetime('now'), triggered_detail = ?
        WHERE experiment_id = ? AND kind = ? AND triggered_at IS NULL`,
      [`${r.count} of ${r.threshold}: ${r.because}`, experimentId, r.kind]);
  }
  return { stop: met.length > 0, because: met.map((r) => `${r.because} (${r.count} of ${r.threshold})`) };
}

/** The circuit breaker: more owed than the institution said it could carry. */
export async function overFulfilmentCap(experimentId: string): Promise<{ over: true; owed: number; cap: number } | { over: false }> {
  const d = await one('SELECT fulfilment_cap FROM probe_designs WHERE experiment_id = ?', [experimentId]);
  const cap = d?.fulfilment_cap == null ? null : Number(d.fulfilment_cap);
  if (cap === null) return { over: false };
  const owed = Number((await one(`SELECT COUNT(*) AS n FROM experiment_fulfilments WHERE experiment_id = ? AND status IN ('owed','failed')`, [experimentId]))?.n ?? 0);
  return owed >= cap ? { over: true, owed, cap } : { over: false };
}

// ─── The short version ───────────────────────────────────────────────────────
/**
 * COMPRESSION IS THE POINT, NOT A COMPROMISE. The whole deliberation above is
 * worth recording and mostly not worth reading: an owner deciding whether to
 * let a test run needs to know what it settles, what it truly costs him, where
 * he could be wrong, where it stops and what I would do. Everything else lives
 * one link away under "Show your work", which is where depth belongs.
 *
 * Nothing here is generated prose. Every sentence is a stored field placed in a
 * plain frame, so the summary cannot say something the record does not.
 */
export interface ShortVersion {
  recommendation: Recommendation;
  headline: string;
  lines: string[];
  sealed: boolean;
}

const RECOMMENDATION_HEADLINE: Record<Recommendation, string> = {
  run: 'I think this is worth running.',
  reframe: 'I think this should be reframed before it runs.',
  defer: 'I think this should wait.',
  kill: 'I do not think this should run.',
};

export async function theShortVersion(experimentId: string): Promise<ShortVersion | null> {
  const d = await designOf(experimentId);
  if (!d) return null;
  const heavy = d.costs.filter((c) => c.level === 'high' || c.level === 'material');
  const undistinguished = d.interpretations.filter((i) => i.distinguishedBy === null);
  // WHERE HE COULD BE MISLED IS THE PAIR, NOT THE READING. Two readings of one
  // observation that this probe cannot separate is the single most useful thing
  // to know before agreeing to run it; one of them quoted alone reads like a
  // prediction, which is the opposite of what it is.
  const pair = undistinguished.find((a) => undistinguished.some((b) => b !== a && b.observation === a.observation));
  const other = pair ? undistinguished.find((b) => b !== pair && b.observation === pair.observation)! : null;
  const lines = [
    `It settles: ${d.decides}`,
    `The exchange is ${d.exchange.whatItIs.toLowerCase()}, because ${lower(gist(d.exchangeBecause))}`,
    heavy.length
      ? `What it really costs you: ${heavy.map((c) => `${c.whatItIs.toLowerCase()} (${c.level})`).join(', ')}.`
      : 'Beyond cash it costs you little: the surface it needs is already standing.',
    pair && other
      ? `Where it could mislead you: if ${lower(pair.observation)}, I cannot tell “${lower(pair.reading)}” from “${lower(other.reading)}”.`
      : undistinguished.length
        ? `Where it could mislead you: if ${lower(undistinguished[0]!.observation)}, I cannot establish that “${lower(undistinguished[0]!.reading)}”.`
        : `What it cannot prove: ${lower(d.cannotProve)}`,
    d.stopConditions.length
      ? `It stops itself at ${series(d.stopConditions.map((s) => `${s.threshold} ${s.counted}`))}.`
      : 'Nothing stops it early but you.',
    ...(d.fulfilmentCap === null ? []
      : [`If it works, I stop taking new work at ${d.fulfilmentCap} — more than that is a promise neither of us can keep.`]),
    `Why: ${lower(gist(d.recommendationBecause))}`,
  ];
  if (d.amendedAt !== null) {
    lines.splice(lines.length - 1, 0,
      `I narrowed what this claims to settle on ${d.amendedAt.slice(0, 10)}, before you decided: ${lower(gist(d.amendedBecause ?? ''))}`);
  }
  return { recommendation: d.recommendation, headline: RECOMMENDATION_HEADLINE[d.recommendation], lines, sealed: d.sealedAt !== null };
}

/**
 * The first sentence, because the summary is a summary. Nothing is rewritten or
 * paraphrased — the rest of the same stored sentence is behind "Show your work",
 * where the owner asked a longer question.
 */
const series = (xs: string[]): string =>
  xs.length < 2 ? (xs[0] ?? '') : `${xs.slice(0, -1).join(', ')}, or ${xs[xs.length - 1]!}`;

const gist = (s: string): string => {
  const m = /^(.+?[.?!])\s+[A-Z"'“]/.exec(s.trim());
  return m ? m[1]! : s.trim();
};

const lower = (s: string): string => (s.length > 1 && s[1] === s[1]!.toLowerCase() ? s[0]!.toLowerCase() + s.slice(1) : s);
