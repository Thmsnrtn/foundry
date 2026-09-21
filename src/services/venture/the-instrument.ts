// =============================================================================
// WAS THE INSTRUMENT WORKING WHEN THE WORLD WAS ASKED?
//
// A returning owner found the defect this file exists for, and it is the worst
// one the campaign has turned up. Nineteen cold emails went to strangers as
// thomas@apexmicro.ai, every one of them inviting a reply. The Workshop's
// reply path was not routed. Seven days later the sealed rule settled the test
// SURPRISED — nobody bought — and the institution filed that as evidence about
// a market.
//
// Nothing was fabricated and no rule was broken: the rule counts confirmed
// deliveries and payments, and there were none. The failure is upstream of
// every safeguard the institution has. A null result is only evidence about
// the world if the world could have answered. The channel that carries the
// answer is part of the instrument, and an instrument that was broken while
// the question was asked makes the result say less than it appears to.
//
// So: what the offer invited, and whether that path can carry it, is read here
// and said wherever the outcome is said. This never changes a verdict — the
// sealed rule is the sealed rule, and rewriting a settled result to suit a
// later discovery is exactly the thing the seal prevents. It changes what the
// result is claimed to ESTABLISH, which is the institution's own claim and is
// its to correct.
//
// WHAT THIS CAN AND CANNOT KNOW. It reads two things and keeps them apart.
// `public_workshop.health_json` is a snapshot — the path NOW — and until
// migration 327 it was all there was, so the sentence could only say "I cannot
// say whether it was working while the test ran". `public_channel_days` keeps
// the worst reading of each path on each day, so for days it covers the answer
// is a fact. For days before it existed there is no row, and NO ROW IS NOT A
// HEALTHY DAY: the sentence says how many of the test's days are unrecorded
// rather than counting them as well.
// =============================================================================

import { query } from '../../db/client.js';

type Row = Record<string, unknown>;

export interface InstrumentDoubt {
  /** The channel the offer asked the world to answer through. */
  channel: 'reply' | 'payment';
  /** In the owner's words: what is wrong with it, and what that costs the reading. */
  sentence: string;
  /** What the result therefore does not establish, appended to the outcome's own limit. */
  doesNotEstablish: string;
  /** Days of the test's own window on which the path was recorded as not working. */
  daysBroken: number;
  /** Days of that window with no record at all: unknown, and never counted as well. */
  daysUnrecorded: number;
}

/** The days a test was actually asking the world: from its first offer to its answer. */
async function theWindow(experimentId: string): Promise<{ from: string; to: string; days: number } | null> {
  const r = (await query(
    `SELECT date(MIN(o.executed_at)) AS from_day,
            date(COALESCE(MAX(e.ran_at), 'now')) AS to_day,
            CAST(julianday(date(COALESCE(MAX(e.ran_at), 'now'))) - julianday(date(MIN(o.executed_at))) AS INTEGER) + 1 AS days
       FROM outbound_actions o JOIN venture_experiments e ON e.id = o.experiment_id
      WHERE o.experiment_id = ? AND o.experiment_act = 'offer' AND o.status = 'executed'`,
    [experimentId])).rows[0] as Row | undefined;
  if (!r || r.from_day == null) return null;
  return { from: String(r.from_day), to: String(r.to_day), days: Math.max(1, Number(r.days ?? 1)) };
}

/** What the day-by-day record says about one path across a test's window. */
async function acrossTheWindow(founderId: string, channel: string, w: { from: string; to: string; days: number }): Promise<{ broken: number; recorded: number; worstDetail: string | null }> {
  const rows = (await query(
    `SELECT day, worst_status, detail FROM public_channel_days
      WHERE founder_id = ? AND channel = ? AND day >= ? AND day <= ?`,
    [founderId, channel, w.from, w.to])).rows as unknown as Row[];
  const broken = rows.filter((r) => String(r.worst_status) === 'needs_attention');
  // A DAY READ AS `unknown` IS NOT A DAY THAT WAS WATCHED. This counted every
  // row, so a window each of whose days had been read and found unreadable
  // reported nothing unrecorded at all — while `whatSilenceMeans`, reading the
  // same table for the same purpose, excluded them. Two readers of one table
  // disagreeing, and the permissive one was the one attached to a verdict.
  const watched = rows.filter((r) => String(r.worst_status) !== 'unknown');
  return { broken: broken.length, recorded: watched.length, worstDetail: broken[0]?.detail == null ? null : String(broken[0].detail) };
}

/**
 * What stands between this test's question and an answer, as far as the
 * records can say. Empty when the paths it used are working, which is the
 * ordinary case and says nothing.
 */
export async function doubtsAboutTheInstrument(experimentId: string): Promise<InstrumentDoubt[]> {
  const e = (await query(
    `SELECT e.founder_id, e.ran_at,
            (SELECT COUNT(*) FROM outbound_actions o WHERE o.experiment_id = e.id AND o.experiment_act = 'offer' AND o.status = 'executed') AS offers
       FROM venture_experiments e WHERE e.id = ?`, [experimentId])).rows[0] as Row | undefined;
  if (!e) return [];
  const offers = Number(e.offers ?? 0);
  if (offers === 0) return [];

  const out: InstrumentDoubt[] = [];
  const w = (await query(
    'SELECT contact_email, health_json, health_at FROM public_workshop WHERE founder_id = ?', [String(e.founder_id)]))
    .rows[0] as Row | undefined;
  if (!w) return out;
  const health = w.health_json == null ? null
    : JSON.parse(String(w.health_json)) as Record<string, { status: string; detail: string }>;
  const reply = health?.replyInbox;
  // AN OFFER THAT INVITES A REPLY NEEDS A PATH THAT CARRIES ONE. 'unknown' is
  // not 'healthy': a path nobody can read is a path nobody can vouch for.
  const window = await theWindow(experimentId);
  const record = window ? await acrossTheWindow(String(e.founder_id), 'replyInbox', window) : null;
  const daysBroken = record?.broken ?? 0;
  const daysUnrecorded = window ? window.days - (record?.recorded ?? 0) : 0;
  const brokenNow = !!reply && reply.status !== 'healthy';
  // WHERE THERE IS NO DAY RECORD, THE RECEIPTS MAY STILL KNOW. Migration 327
  // began keeping the days; a test that ran before it existed has an
  // unrecorded window, and the honest sentence used to stop at "I cannot say".
  // But the route that carries a reply is made through the governed door like
  // everything else, and the door writes a receipt with a date. A route
  // created AFTER a test's window closed was not carrying anything during it,
  // and that is a fact from a receipt rather than an inference.
  //
  // READ BEFORE THE GATE, AND ABLE TO OPEN IT. This sat inside the condition
  // below, which asks whether the path is broken NOW or was recorded broken
  // during the window — so for the one test it was written for, the moment the
  // owner repaired the route the receipt fact became unreachable and the
  // correction to the result vanished with it. An adversarial reviewer found
  // it. A record of a past measurement that disappears when the instrument is
  // mended is worse than no record: it is a record that flatters every repair.
  const routeMade = window === null ? null : (await query(
    `SELECT MIN(recorded_at) AS at FROM cloudflare_mutations
      WHERE founder_id = ? AND tool = 'cloudflare_email_route_upsert' AND outcome = 'applied'`,
    [String(e.founder_id)])).rows[0] as Row | undefined;
  const madeAfter = routeMade?.at != null && window !== null
    && String(routeMade.at).slice(0, 10) > window.to;
  if (brokenNow || daysBroken > 0 || madeAfter) {
    const asked = `${String(offers)} ${offers === 1 ? 'message' : 'messages'} went out under this test asking people to reply to ${String(w.contact_email)}`;
    // WHAT THE RECORD ESTABLISHES, said as a fact; what it does not, said as
    // an absence. A day with no row is not a day that was well.
    const then = daysBroken > 0
      ? `That path was not working on ${String(daysBroken)} of the ${String(window?.days ?? daysBroken)} days the test was asking${record?.worstDetail ? ` (${record.worstDetail})` : ''}`
      : madeAfter
        ? `That path was not made until ${String(routeMade!.at).slice(0, 10)}, after this test had already closed, so nothing it invited could have arrived`
        : `I have no day-by-day record of that path while the test was asking`;
    const now = brokenNow
      ? `, and it is ${reply.status === 'unknown' ? 'unreadable' : 'not working'} now${reply.detail ? ` (${reply.detail})` : ''}`
      : ', though it is working now — which is a fact about today and not about the days this result was measured over';
    const unrecorded = daysUnrecorded > 0 && window
      ? ` ${String(daysUnrecorded)} of those days ${daysUnrecorded === 1 ? 'has' : 'have'} no record at all, and I do not count a day I did not watch as a day that was well.`
      : '';
    out.push({
      channel: 'reply',
      sentence: `${asked}. ${then}${now}.${unrecorded}`,
      doesNotEstablish: 'that nobody wanted to answer: a silence on a channel that may not have carried a reply is not the same evidence as a silence on one that did.',
      daysBroken, daysUnrecorded,
    });
  }

  // AND EVERY OTHER PATH THE OFFER INVITED SOMEBODY TO USE. The block above
  // reads the reply channel directly, because it predates the declared
  // instrument and still answers for the tests that have none — Experiment 001
  // among them, whose reading must not change. For a test that declared its
  // paths, the same question is asked of each of them from the same day-by-day
  // record: a page that was not there, or a way to pay that was not working,
  // costs a result exactly what a reply route does.
  if (window) {
    const invited = (await instrumentOf(experimentId))
      .filter((p) => p.essential && p.bearsOn === 'invitation' && p.kind !== 'reply');
    const channels = (await query(`SELECT kind, observed_on FROM experiment_path_kinds`, [])).rows as unknown as Row[];
    const observedOn = new Map(channels.map((r) => [String(r.kind), r.observed_on == null ? null : String(r.observed_on)]));
    for (const p of invited) {
      const channel = observedOn.get(p.kind) ?? null;
      if (channel === null) continue;
      const record = await acrossTheWindow(String(e.founder_id), channel, window);
      if (record.broken === 0) continue;
      out.push({
        channel: 'reply',
        sentence: `${PATH_NAMES[p.kind]} was not working on ${String(record.broken)} of the ${String(window.days)} days this test was asking`
          + (record.worstDetail ? ` (${record.worstDetail})` : '') + '.',
        doesNotEstablish: `that the offer was refused: people were sent to something that was not working, and what they would have done with a working one is not in this result.`,
        daysBroken: record.broken, daysUnrecorded: window.days - record.recorded,
      });
    }
  }
  return out;
}

/** One sentence for a card, or null when the instrument raises no doubt. */
export async function instrumentCaveat(experimentId: string): Promise<string | null> {
  const doubts = await doubtsAboutTheInstrument(experimentId);
  return doubts.length === 0 ? null : doubts.map((d) => d.sentence).join(' ');
}

// =============================================================================
// PART TWO: THE INSTRUMENT IS DECLARED BEFORE THE WORLD IS ASKED.
//
// Everything above reads a result after the fact. That is the wrong end of the
// problem, and reading it after the fact is how a person rather than the
// institution found the defect. What follows is the same idea taken forwards:
// an experiment states, before it does anything consequential, which paths it
// depends on and what each one bears on; the paths are checked against the
// world before the first act and while the question is open; and a path that
// is not working stops the asking rather than quietly bounding the answer.
//
// NOTHING HERE IS A NEW OBSERVABILITY SYSTEM. The world is read exactly once,
// by `workshopHealth`, which already checks the site, the provider, the
// sending identity, the reply route and the Workshop's ears against the
// outside. This maps that one reading onto what one experiment needs, and
// keeps what it finds where the experiment can be asked about it.
// =============================================================================

import type { WorkshopHealth } from '../public-workshop/infrastructure.js';

export type PathKind = 'offer_page' | 'sending' | 'reply' | 'payment' | 'payment_observation' | 'fulfilment' | 'refund';
/** What the test loses if the path is not working. */
export type BearsOn = 'measurement' | 'invitation' | 'obligation';
export type PathStatus = 'working' | 'not_working' | 'unknown';

export interface RequiredPath {
  kind: PathKind;
  bearsOn: BearsOn;
  /** In the owner's words: why this test depends on this path. */
  why: string;
  essential: boolean;
}

export interface PathReading extends RequiredPath {
  /**
   * Whether approving the test is what brings this path into being — the way
   * to pay and the authority to refund are minted by the owner's Allow, so a
   * check before approval must not ask for them.
   */
  existsAfterApproval: boolean;
  status: PathStatus;
  detail: string;
  /** Set while the path has been found not working and not found working since. */
  brokenSince: string | null;
  /** What was wrong when it first broke, kept while it is still broken. */
  brokenDetail: string | null;
  verifiedAt: string | null;
}

/**
 * WHAT THIS EXPERIMENT DEPENDS ON, derived rather than decided.
 *
 * Three sources, none of them anybody's opinion at launch:
 *   the SEALED RULE — `settlement_event_paths` says what must be working for
 *     each event the rule counts to be observable at all;
 *   the OFFER — writing to a person invites a reply by existing, whatever the
 *     text says: the From line is a reply route and a stranger will use it;
 *   the PRICE — taking money means being able to take it, to see that it was
 *     taken, to deliver against it and to give it back.
 *
 * A listing the owner places himself has none of the first two: the venue
 * carries the offer and the conversation, and the Workshop's paths are not
 * part of that instrument.
 */
export async function pathsRequiredBy(experimentId: string): Promise<RequiredPath[]> {
  const e = (await query(
    `SELECT e.id, e.founder_id, e.settles_when FROM venture_experiments e WHERE e.id = ?`, [experimentId]))
    .rows[0] as Row | undefined;
  if (!e) return [];

  const { offerShapePlanOf, materialOf, recipientsOf } = await import('./hand.js');
  const plan = await offerShapePlanOf(experimentId);
  // A LISTING IS SOMEBODY ELSE'S INSTRUMENT. The venue carries the offer, takes
  // the money and answers the buyer; the owner enters its readings by hand.
  // Declaring the Workshop's paths for it would be declaring a dependency that
  // does not exist, which is its own kind of untruth.
  if (plan?.listing) return [];

  const out = new Map<PathKind, RequiredPath>();
  const need = (kind: PathKind, bearsOn: BearsOn, why: string): void => {
    // MEASUREMENT OUTRANKS INVITATION where a path bears on both: losing the
    // measurement is the larger loss, and the sentence should say so.
    const held = out.get(kind);
    if (held && (held.bearsOn === 'measurement' || bearsOn !== 'measurement')) return;
    out.set(kind, { kind, bearsOn, why, essential: true });
  };

  // ── What the sealed rule cannot be measured without ──────────────────────
  const { parseSettlementRule } = await import('./outcome.js');
  const rule = parseSettlementRule(e.settles_when);
  for (const event of [rule?.event, rule?.outOf].filter((x): x is string => typeof x === 'string')) {
    const paths = (await query(
      `SELECT p.path_kind, k.what_it_is FROM settlement_event_paths p
         JOIN experiment_path_kinds k ON k.kind = p.path_kind
        WHERE p.event_kind = ? ORDER BY k.sort_order`, [event])).rows as unknown as Row[];
    for (const p of paths) {
      need(String(p.path_kind) as PathKind, 'measurement',
        `the rule this test sealed counts ${event.replace(/_/g, ' ')}, and ${String(p.what_it_is)}`);
    }
  }

  // ── What the offer asks a stranger to do ─────────────────────────────────
  const writesToPeople = (await recipientsOf(experimentId)).some((r) => r.channel === 'email' && r.email);
  if (writesToPeople) {
    need('sending', 'invitation', 'this test writes to people, and nothing reaches them without it');
    // THE DEFECT THIS FILE EXISTS FOR. A message with a From line is an
    // invitation to reply whether or not its words say so, and nineteen people
    // were given one that went nowhere.
    need('reply', 'invitation', 'every message this test sends can be replied to, and a reply nobody receives is worse than no reply at all');
  }
  const page = (await query(`SELECT experiment_id FROM public_experiments WHERE experiment_id = ?`, [experimentId])).rows[0];
  if (page) {
    need('offer_page', 'invitation', 'the offer sends people to a page, which has to be there and say what it was published saying');
  }
  if (plan?.venue === 'workshop') {
    need('reply', 'invitation', 'a buyer arriving on their own has one way to ask a question, and it has to reach somebody');
  }

  // ── What taking money commits us to ──────────────────────────────────────
  if ((plan?.price?.amountCents ?? 0) > 0) {
    need('payment', 'invitation', 'this offer asks people for money, so the way to pay has to work');
    need('payment_observation', 'measurement', 'a payment Foundry never hears about is a customer owed something nobody knows about');
    need('fulfilment', 'obligation', 'somebody who pays is owed the thing, and this is the way it reaches them');
    need('refund', 'obligation', 'the public promise is money back with no questions, which has to be possible before it is made');
  } else if (await materialOf(experimentId, 'deliverable')) {
    need('fulfilment', 'obligation', 'this test promises somebody a thing, and this is the way it reaches them');
  }

  const order = (await query(`SELECT kind FROM experiment_path_kinds ORDER BY sort_order`, [])).rows as unknown as Row[];
  return order.map((r) => out.get(String(r.kind) as PathKind)).filter((p): p is RequiredPath => p !== undefined);
}

/**
 * WRITE THE INSTRUMENT DOWN, once, before the first consequential act.
 * Idempotent: a path already declared keeps its declaration, because why a
 * test depends on a path is settled when it is declared and the row refuses to
 * have it rewritten.
 */
export async function declareInstrument(experimentId: string): Promise<RequiredPath[]> {
  const e = (await query(
    `SELECT founder_id, settles_when FROM venture_experiments WHERE id = ?`, [experimentId]))
    .rows[0] as Row | undefined;
  if (!e) return [];
  // NOTHING IS WRITTEN DOWN UNTIL THE RULE IT IS DERIVED FROM EXISTS.
  //
  // What a path bears on follows from the sealed settlement rule, and the row
  // refuses to have it rewritten — which is right, and was a hole: `readiness`
  // runs on an ordinary page render, so opening the test's page before the
  // rule was sealed froze every path as an `invitation` or an `obligation`
  // derived from the price alone. The rule sealed afterwards could not correct
  // it, and the gap reader skips everything that is not `measurement`. An
  // adversarial reviewer found it. Before the rule exists the paths are
  // computed and shown; they are not recorded.
  if (e.settles_when == null || String(e.settles_when).trim() === '') return pathsRequiredBy(experimentId);
  const required = await pathsRequiredBy(experimentId);
  for (const p of required) {
    await query(
      `INSERT INTO experiment_paths (experiment_id, founder_id, kind, bears_on, why, essential)
       VALUES (?,?,?,?,?,?) ON CONFLICT(experiment_id, kind) DO NOTHING`,
      [experimentId, String(e.founder_id), p.kind, p.bearsOn, p.why, p.essential ? 1 : 0]);
  }
  return required;
}

/** The recorded instrument, without touching the world. */
export async function instrumentOf(experimentId: string): Promise<PathReading[]> {
  const rows = (await query(
    `SELECT p.kind, p.bears_on, p.why, p.essential, p.verified_at, p.verified_status,
            p.verified_detail, p.broken_since, p.broken_detail, k.exists_after_approval
       FROM experiment_paths p JOIN experiment_path_kinds k ON k.kind = p.kind
      WHERE p.experiment_id = ? ORDER BY k.sort_order`, [experimentId])).rows as unknown as Row[];
  return rows.map((r) => ({
    kind: String(r.kind) as PathKind, bearsOn: String(r.bears_on) as BearsOn, why: String(r.why),
    essential: Number(r.essential) === 1, existsAfterApproval: Number(r.exists_after_approval) === 1,
    status: (r.verified_status == null ? 'unknown' : String(r.verified_status)) as PathStatus,
    detail: r.verified_detail == null ? 'not checked yet' : String(r.verified_detail),
    brokenSince: r.broken_since == null ? null : String(r.broken_since),
    brokenDetail: r.broken_detail == null ? null : String(r.broken_detail),
    verifiedAt: r.verified_at == null ? null : String(r.verified_at),
  }));
}

/**
 * CHECK THE DECLARED PATHS AGAINST THE WORLD, and keep what was found.
 *
 * One reading of the world serves every path that has a channel: the pass that
 * already takes the Workshop's health hourly hands its reading in, and nothing
 * here goes out to a provider twice. The two paths no channel covers are asked
 * directly, and both of them answer "unknown" rather than "working" when the
 * honest answer is that nobody has tried it yet.
 *
 * `not_working` and `unknown` are kept apart everywhere below. A path nobody
 * could read is not a path that failed, and a path that failed is not a path
 * that was never tried — collapsing those three is how an institution ends up
 * certain about something it never observed.
 */
export async function verifyInstrument(
  experimentId: string,
  opts: { health?: WorkshopHealth; fetchImpl?: typeof fetch; now?: Date } = {},
): Promise<PathReading[]> {
  const e = (await query(`SELECT founder_id FROM venture_experiments WHERE id = ?`, [experimentId]))
    .rows[0] as Row | undefined;
  if (!e) return [];
  const now = opts.now ?? new Date();
  let health = opts.health ?? null;
  if (health === null) {
    const { workshopHealth } = await import('../public-workshop/infrastructure.js');
    try { health = await workshopHealth(String(e.founder_id), { fetchImpl: opts.fetchImpl }); }
    catch { health = null; }
  }
  const read = await instrumentAgainst(experimentId, health, now);
  const out: PathReading[] = [];
  for (const found of read) {
    // RECOVERY AND FAILURE IN ONE STATEMENT, so the row is never working and
    // broken at the same time (the table refuses that pairing outright).
    await query(
      `UPDATE experiment_paths
          SET verified_at = ?, verified_status = ?, verified_detail = ?,
              -- ONLY A WORKING READING CLOSES A BROKEN INTERVAL. This cleared
              -- it for anything that was not a not-working reading, so one
              -- unreadable pass — a provider timeout, a health read that threw — erased
              -- the record of three broken days. The column exists to be the
              -- evidence that a window was measured through a broken
              -- instrument; an absence of reading is not a repair.
              broken_since = CASE WHEN ? = 'not_working' THEN COALESCE(broken_since, ?)
                                  WHEN ? = 'working' THEN NULL ELSE broken_since END,
              broken_detail = CASE WHEN ? = 'not_working' THEN ?
                                   WHEN ? = 'working' THEN NULL ELSE broken_detail END
        WHERE experiment_id = ? AND kind = ?`,
      [now.toISOString(), found.status, found.detail,
        found.status, now.toISOString(), found.status,
        found.status, found.status === 'not_working' ? found.detail : null, found.status,
        experimentId, found.kind]);
    const row = (await query(
      `SELECT broken_since, broken_detail FROM experiment_paths WHERE experiment_id = ? AND kind = ?`, [experimentId, found.kind]))
      .rows[0] as Row | undefined;
    out.push({ ...found,
      brokenSince: row?.broken_since == null ? null : String(row.broken_since),
      brokenDetail: row?.broken_detail == null ? null : String(row.broken_detail) });
  }
  return out;
}

/**
 * THE DECLARED PATHS READ AGAINST A HEALTH READING, WITHOUT WRITING ANYTHING.
 *
 * What a page and a door use: the Workshop's health is taken hourly and stored,
 * so asking the world again to draw a card would be three provider calls per
 * render for a reading that is already an hour fresh at worst. The pass that is
 * about to write to strangers takes a live reading instead — the cost belongs
 * where the consequence is.
 */
export async function instrumentAgainst(
  experimentId: string, health: WorkshopHealth | null, now = new Date(),
): Promise<PathReading[]> {
  const declared = await instrumentOf(experimentId);
  if (declared.length === 0) return [];
  const e = (await query(`SELECT founder_id FROM venture_experiments WHERE id = ?`, [experimentId]))
    .rows[0] as Row | undefined;
  if (!e) return declared;
  const channelOf = (await query(`SELECT kind, observed_on FROM experiment_path_kinds`, [])).rows as unknown as Row[];
  const observedOn = new Map(channelOf.map((r) => [String(r.kind), r.observed_on == null ? null : String(r.observed_on)]));
  const out: PathReading[] = [];
  for (const p of declared) {
    const found = await readOnePath(p, { experimentId, founderId: String(e.founder_id), health, observedOn, now });
    out.push({ ...p, status: found.status, detail: found.detail, verifiedAt: now.toISOString() });
  }
  return out;
}

/** The health reading this deployment last took, for a reader that must not take one. */
export async function lastHealthReading(founderId: string): Promise<WorkshopHealth | null> {
  const w = (await query('SELECT health_json FROM public_workshop WHERE founder_id = ?', [founderId]))
    .rows[0] as Row | undefined;
  if (w?.health_json == null) return null;
  try { return JSON.parse(String(w.health_json)) as WorkshopHealth; } catch { return null; }
}

/**
 * THE ESSENTIAL PATHS THAT ARE NOT WORKING, in the owner's words. Empty is the
 * ordinary answer and says nothing. `unknown` is deliberately not here: a path
 * nobody could read is not a path that failed, and refusing on it would stop
 * every test on every deployment without a provider configured.
 */
export function pathsNotWorking(readings: PathReading[]): PathReading[] {
  return readings.filter((r) => r.essential && r.status === 'not_working');
}

/** One path, read from the one health reading or from its own source. */
async function readOnePath(
  p: RequiredPath,
  ctx: { experimentId: string; founderId: string; health: WorkshopHealth | null; observedOn: Map<string, string | null>; now: Date },
): Promise<{ status: PathStatus; detail: string }> {
  // THE ONE READING FIRST. Where a channel covers the path, the Workshop's
  // health has already looked at the world and said what is wrong in a
  // sentence an owner can act on; restating it here would be a second reading
  // of one fact, which is how the last three defects began.
  const channel = ctx.observedOn.get(p.kind) ?? null;
  const signal = channel === null || ctx.health === null ? undefined
    : (ctx.health as unknown as Record<string, { status?: string; detail?: string }>)[channel];
  if (signal?.status) {
    return {
      status: signal.status === 'healthy' ? 'working' : signal.status === 'needs_attention' ? 'not_working' : 'unknown',
      detail: signal.detail ?? '',
    };
  }
  // ITS OWN SOURCE, when no reading covers it — an older health reading taken
  // before a channel existed, or a path no channel watches.
  if (p.kind === 'payment') return paymentPath(ctx.experimentId);
  if (p.kind === 'payment_observation') return paymentObservationPath(ctx.now);
  if (p.kind === 'refund') return refundPath(ctx.experimentId);
  if (channel !== null) return { status: 'unknown', detail: `nothing read ${channel}, so this path was not checked` };
  return { status: 'unknown', detail: 'no way to check this path is implemented' };
}

/** The way to pay: the link exists, is ours, is live, and charges what the offer says. */
async function paymentPath(experimentId: string): Promise<{ status: PathStatus; detail: string }> {
  const m = (await query(
    `SELECT payment_link_url FROM experiment_materials
      WHERE experiment_id = ? AND payment_link_url IS NOT NULL ORDER BY recorded_at DESC LIMIT 1`, [experimentId]))
    .rows[0] as Row | undefined;
  if (!m?.payment_link_url) {
    return { status: 'not_working', detail: 'no way to pay is attached to this offer' };
  }
  if (!process.env.STRIPE_SECRET_KEY) {
    return { status: 'unknown', detail: 'a way to pay is attached, but this deployment has no payment provider configured to check it against' };
  }
  // A LINK ON RECORD IS NOT A LINK THAT WORKS, and this said it was.
  //
  // An accountant reading the product found the readiness check reporting
  // "the link on record is not active at the provider" on the same test, on
  // the same day, that this reported the way to pay as working. Two readings
  // of one fact, which is the shape this campaign keeps finding — and the
  // worse of the two was the one that could stop an offer going out.
  //
  // It asks the provider, through the same reader the readiness check uses.
  // An answer that cannot be got is unknown, never working: a link nobody
  // could check is not a link anybody has vouched for.
  const url = String(m.payment_link_url);
  try {
    const { describePaymentLink } = await import('./payment-link.js');
    const link = await describePaymentLink(url);
    return link
      ? { status: 'working', detail: `an active one-time link at the provider (${url})` }
      : { status: 'not_working', detail: `the link on record is not active at the provider (${url})` };
  } catch (err) {
    return { status: 'unknown', detail: `the provider could not be asked about the link on record (${err instanceof Error ? err.message : String(err)})` };
  }
}

/**
 * THE WAY MONEY GOES BACK. Not "could we call the provider" — whether the
 * authority to refund exists and has not lapsed, which is the thing that
 * actually refuses at three in the morning when somebody wants their $29 back.
 */
async function refundPath(experimentId: string): Promise<{ status: PathStatus; detail: string }> {
  const act = (await query(
    `SELECT a.id, a.decision, a.revoked_at, a.expires_at FROM proposed_acts a
      WHERE a.experiment_id = ? AND a.action_type = 'stripe_create_refund'
      ORDER BY a.rowid DESC LIMIT 1`, [experimentId])).rows[0] as Row | undefined;
  if (!act) return { status: 'not_working', detail: 'nothing authorises a refund for this test' };
  if (act.decision !== 'approved') return { status: 'not_working', detail: 'the refund has not been authorised' };
  if (act.revoked_at != null) return { status: 'not_working', detail: 'the authority to refund was withdrawn' };
  // AN EXPIRED AUTHORITY IS NOT A STANDING ONE. The column was selected and
  // never read, so a test whose acts had lapsed reported a working way to give
  // money back while `obligations.ts` was calling the same purchases his to
  // refund by hand.
  if (act.expires_at != null && new Date(String(act.expires_at).replace(' ', 'T') + 'Z').getTime() < Date.now()) {
    return { status: 'not_working', detail: `the authority to refund lapsed on ${String(act.expires_at).slice(0, 10)}` };
  }
  if (!process.env.STRIPE_SECRET_KEY) {
    return { status: 'unknown', detail: 'a refund is authorised, but this deployment has no payment provider configured to make one through' };
  }
  return { status: 'working', detail: 'a refund is authorised and the provider is configured' };
}

/**
 * THE PAYMENT OBSERVATION PATH, which has no health signal of its own because
 * it is not something Foundry can look at: it is something the provider does
 * TO us. Three honest states — we cannot accept an event at all; we can, and
 * one has arrived; we can, and none ever has — and the third is `unknown`,
 * never `working`. What would settle it is named rather than assumed.
 */
export async function paymentObservationPath(now = new Date()): Promise<{ status: PathStatus; detail: string }> {
  if (!process.env.STRIPE_WEBHOOK_SECRET) {
    return { status: 'not_working', detail: 'nothing is configured to receive a payment event, so a payment would happen and Foundry would not know' };
  }
  const since = new Date(now.getTime() - 30 * 86_400_000).toISOString();
  // WHICH WORLD THE EVENT CAME FROM IS THE WHOLE QUESTION. The live endpoint
  // is configured separately at the provider and can be missing while every
  // test-mode event arrives perfectly, so a test-mode proof is reported as
  // what it is: the machinery works, the live route is unproven.
  const live = (await query(
    `SELECT event_type, processed_at FROM stripe_webhook_events
      WHERE datetime(processed_at) >= datetime(?) AND livemode = 1 ORDER BY processed_at DESC LIMIT 1`, [since]))
    .rows[0] as Row | undefined;
  if (live) {
    return { status: 'working', detail: `the provider reached this deployment on ${String(live.processed_at).slice(0, 10)} (${String(live.event_type)})` };
  }
  const any = (await query(
    `SELECT event_type, processed_at, livemode FROM stripe_webhook_events
      WHERE datetime(processed_at) >= datetime(?) ORDER BY processed_at DESC LIMIT 1`, [since]))
    .rows[0] as Row | undefined;
  if (!any) {
    return { status: 'unknown', detail: 'a payment event can be received, but none ever has been: nothing has yet proved the provider can reach this deployment' };
  }
  return {
    status: 'unknown',
    detail: any.livemode == null
      ? `the provider reached this deployment on ${String(any.processed_at).slice(0, 10)}, from a deployment that did not record which world the event came from`
      : 'the provider reaches this deployment in test mode; nothing has yet proved the live route, which is configured separately and can be missing while every test passes',
  };
}

/**
 * ONE NAME PER PATH, everywhere. The kinds table says what each path is for
 * the record; this is what the owner reads on a card, in a refusal and in the
 * letter, so a path cannot be "the reply inbox" in one place and "the way a
 * person answers" in another.
 */
export const PATH_NAMES: Record<PathKind, string> = {
  offer_page: 'the page the offer sends people to',
  sending: 'the way messages reach people',
  reply: 'the way a person answers',
  payment: 'the way a person pays',
  payment_observation: 'the way a payment becomes something Foundry knows about',
  fulfilment: 'the way what was paid for reaches the buyer',
  refund: 'the way money goes back',
};

/** What is wrong with one path, as a sentence: the name, the finding, the cost. */
export function sentenceFor(r: PathReading): string {
  const cost = r.bearsOn === 'measurement' ? 'this test cannot measure what it was for'
    : r.bearsOn === 'invitation' ? 'people would be invited to use something that is not there'
      : 'a promise could be made that cannot be kept';
  return `${PATH_NAMES[r.kind]} is not working${r.detail ? ` (${r.detail})` : ''} — ${cost}`;
}

export interface MeasurementGap {
  kind: PathKind;
  /** Days of the window on which the path could not have carried what the rule counts. */
  daysBroken: number;
  days: number;
  /** In the owner's words: why a null from this window is not an answer. */
  sentence: string;
}

/**
 * COULD THE RULE HAVE SEEN AN ANSWER, ON EVERY DAY IT WAS OPEN?
 *
 * Read from the day-by-day record rather than from anybody's assertion: the
 * declared paths that bear on the MEASUREMENT, the channel each is observed
 * on, and what that channel's worst reading was on each day of the settlement
 * window. A day nobody watched is not counted against the test — an absence of
 * record is not a record of failure, the same way it is not a record of
 * health.
 *
 * This is deliberately not a threshold. It answers one question — was there a
 * day on which the answer could not have reached us — and leaves what follows
 * from that to the caller, because the answer means something different for a
 * null than for a result with events in it.
 *
 * WHAT IT DOES NOT COVER, SAID PLAINLY. Only paths that bear on the
 * MEASUREMENT are read here, and that is the intended reading: a broken reply
 * route does not stop a rule counting payments from being measured, so a test
 * settled through one is limited rather than void. Experiment 001 is exactly
 * that case, and this door would not have refused its verdict — the doctrine
 * is that a sealed result stands and the claim about it is corrected, and
 * whether that null is void is the owner's judgment, recorded as PENDING 21.
 * An earlier version of this comment claimed otherwise; a reviewer was right
 * to call the claim false, and a safeguard that overstates its own reach is
 * the defect this campaign exists to remove.
 */
export async function measurementGapIn(
  experimentId: string, from: Date, to: Date,
): Promise<MeasurementGap[]> {
  const declared = (await instrumentOf(experimentId)).filter((p) => p.essential && p.bearsOn === 'measurement');
  if (declared.length === 0) return [];
  const e = (await query(`SELECT founder_id FROM venture_experiments WHERE id = ?`, [experimentId]))
    .rows[0] as Row | undefined;
  if (!e) return [];
  const fromDay = from.toISOString().slice(0, 10);
  const toDay = to.toISOString().slice(0, 10);
  const days = Math.max(1, Math.round((new Date(toDay + 'T00:00:00Z').getTime() - new Date(fromDay + 'T00:00:00Z').getTime()) / 86_400_000) + 1);
  const channels = (await query(`SELECT kind, observed_on FROM experiment_path_kinds`, [])).rows as unknown as Row[];
  const observedOn = new Map(channels.map((r) => [String(r.kind), r.observed_on == null ? null : String(r.observed_on)]));

  const out: MeasurementGap[] = [];
  for (const p of declared) {
    const channel = observedOn.get(p.kind) ?? null;
    if (channel === null) continue;
    const broken = (await query(
      `SELECT day, detail FROM public_channel_days
        WHERE founder_id = ? AND channel = ? AND day >= ? AND day <= ? AND worst_status = 'needs_attention'
        ORDER BY day`, [String(e.founder_id), channel, fromDay, toDay])).rows as unknown as Row[];
    if (broken.length === 0) continue;
    const detail = broken[0].detail == null ? '' : ` (${String(broken[0].detail)})`;
    out.push({
      kind: p.kind, daysBroken: broken.length, days,
      sentence: `${PATH_NAMES[p.kind]} was not working on ${String(broken.length)} of the ${String(days)} days this test was asking${detail}`,
    });
  }
  return out;
}

export type PublicChannel = 'site' | 'cloudflare' | 'sending' | 'replyInbox' | 'mail' | 'payments';
export type AbsenceMeaning = 'reliable' | 'unknown' | 'broken';

export interface WhatSilenceMeans {
  meaning: AbsenceMeaning;
  daysBroken: number;
  daysUnwatched: number;
  days: number;
  /** One sentence to print beside the empty count, or null when there is nothing to add. */
  sentence: string | null;
}

/**
 * WHAT AN EMPTY COUNT MEANS, which is not always the same thing.
 *
 * Half a dozen surfaces say a version of "nothing came back". Each one counted
 * its own rows and printed its own sentence, and not one of them could ask the
 * question that decides what the sentence means: was the path that would have
 * carried something working while we were waiting?
 *
 * Three answers, kept apart on purpose:
 *   RELIABLE — the path was well on every day of the window. Nothing came back
 *              and that is a fact about the world. Nothing is added.
 *   BROKEN   — the path was down on days of the window. The silence is partly
 *              or wholly ours, and the sentence says so.
 *   UNKNOWN  — the window has days with no reading. Not reassurance and not an
 *              alarm: an honest gap, said once.
 *
 * This deliberately produces a SENTENCE and not a card. An institution that
 * turned every uncertainty into a warning would teach its owner to ignore
 * warnings, which is a worse failure than the one it was guarding against.
 */
export async function whatSilenceMeans(
  founderId: string, channel: PublicChannel, from: Date, to: Date, about = 'an answer',
): Promise<WhatSilenceMeans> {
  const fromDay = from.toISOString().slice(0, 10);
  const toDay = to.toISOString().slice(0, 10);
  const days = Math.max(1, Math.round(
    (new Date(toDay + 'T00:00:00Z').getTime() - new Date(fromDay + 'T00:00:00Z').getTime()) / 86_400_000) + 1);
  const rows = (await query(
    `SELECT worst_status, detail FROM public_channel_days
      WHERE founder_id = ? AND channel = ? AND day >= ? AND day <= ?`,
    [founderId, channel, fromDay, toDay])).rows as unknown as Row[];
  const broken = rows.filter((r) => String(r.worst_status) === 'needs_attention');
  const watched = rows.filter((r) => String(r.worst_status) !== 'unknown').length;
  const daysUnwatched = Math.max(0, days - watched);

  if (broken.length > 0) {
    const detail = broken[0].detail == null ? '' : ` (${String(broken[0].detail)})`;
    return {
      meaning: 'broken', daysBroken: broken.length, daysUnwatched, days,
      sentence: `On ${String(broken.length)} of those ${String(days)} days ${about} could not have reached me${detail}, so the silence is not all theirs.`,
    };
  }
  if (daysUnwatched > 0) {
    return {
      meaning: 'unknown', daysBroken: 0, daysUnwatched, days,
      sentence: `I have no record of whether ${about} could have reached me on ${String(daysUnwatched)} of those ${String(days)} days, and I do not count a day I did not watch as a day that was well.`,
    };
  }
  return { meaning: 'reliable', daysBroken: 0, daysUnwatched: 0, days, sentence: null };
}
