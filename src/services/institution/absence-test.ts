// =============================================================================
// FOUNDRY — WHAT IS STILL TRUE AFTER SEVEN, THIRTY AND NINETY DAYS AWAY
//
// The institution's own acceptance test, run against itself. Not "did anything
// happen" — a-week-away.ts answers that — but the harder question underneath
// it: if the owner walked away today and came back in three months, would what
// he found still be TRUE, still be BOUNDED, still ADD UP, still be
// RECOVERABLE, and would the things waiting for him actually be HIS?
//
// THREE HORIZONS, BECAUSE THE ANSWER CHANGES WITH TIME AND THAT IS THE POINT.
// A property that holds for a week and fails at ninety days is not a property
// that holds; it is one that has never been asked the question. Every reading
// here is computed per horizon from the same records, and where the horizon
// outruns what the records can support the finding is CANNOT ESTABLISH — never
// a pass by default. An institution that answers "fine" about a period it has
// no evidence for is exactly the failure this file exists to catch.
//
// NOTHING HERE ACTS, SCHEDULES, ALERTS OR SPENDS. It is a read, and it may be
// run as often as anyone likes without costing anything. That is deliberate:
// the test for a quiet institution must itself be quiet.
// =============================================================================

import { query, realCompany } from '../../db/client.js';

/** The five properties the owner's absence is a test of. */
export type AbsenceProperty =
  /** Would anything he reads on return assert more than the records support? */
  | 'truthful'
  /** Does any authority outlast the absence, and how much could leave? */
  | 'bounded'
  /** Can the money be followed from a payment to what is his? */
  | 'understandable'
  /** If something went wrong on day one, is there still a way back on day N? */
  | 'recoverable'
  /** Is what waits for him genuinely his to decide — and will it still be there? */
  | 'only_real_decisions';

/**
 * HOLDS, DOES NOT HOLD, or CANNOT ESTABLISH.
 *
 * The third is not a softer failure. It means the institution does not have
 * the evidence to answer over this horizon, which is a different and more
 * useful thing to be told than a guess in either direction.
 */
export type Finding = 'HOLDS' | 'DOES_NOT_HOLD' | 'CANNOT_ESTABLISH';

export interface PropertyReading {
  property: AbsenceProperty;
  /** The question, in the owner's words. */
  question: string;
  finding: Finding;
  /** One sentence: the answer. */
  sentence: string;
  /** What was actually read to get there. Rows, not adjectives. */
  evidence: string[];
  /** What would have to change for this to hold. Empty when it holds. */
  wouldFixIt: string[];
}

export interface AbsenceReading {
  days: number;
  /** The date he would come back, from the clock passed in. */
  returnsOn: string;
  properties: PropertyReading[];
  /** The one sentence at the top of this horizon. */
  verdict: string;
}

/** The three horizons the owner named. */
export const HORIZONS = [7, 30, 90] as const;

const DAY_MS = 86_400_000;

function money(cents: number): string {
  return `$${(cents / 100).toFixed(cents % 100 === 0 ? 0 : 2)}`;
}

function plural(n: number, one: string, many: string): string {
  return `${String(n)} ${n === 1 ? one : many}`;
}

/**
 * HOW OLD THIS INSTITUTION IS, IN DAYS.
 *
 * The bound on every LIVED reading. A ninety-day claim from an institution
 * that has kept records for three weeks is a claim about a period nobody
 * observed, and it does not matter how confidently the query returns.
 */
async function daysOfRecord(founderId: string): Promise<number | null> {
  const row = (await query(
    `SELECT MIN(at) AS earliest FROM (
       SELECT created_at AS at FROM products WHERE owner_id = ?
       UNION ALL SELECT created_at FROM founders WHERE id = ?
     ) WHERE at IS NOT NULL`, [founderId, founderId])).rows[0] as Record<string, unknown> | undefined;
  if (!row || row.earliest == null) return null;
  const earliest = Date.parse(String(row.earliest).replace(' ', 'T') + 'Z');
  if (Number.isNaN(earliest)) return null;
  return Math.max(0, Math.floor((Date.now() - earliest) / DAY_MS));
}

// ─── 1. TRUTHFUL ─────────────────────────────────────────────────────────────

/**
 * WOULD SILENCE BE MISTAKEN FOR CALM?
 *
 * The failure mode of an absent owner is not a loud wrong answer; it is a
 * quiet page. A company Foundry has no senses on, and a routine that has
 * stopped running, both produce a screen saying nothing is wrong — from an
 * institution that would say exactly the same thing if everything were.
 *
 * So the test is not "are the numbers right". It is: is there anything here
 * whose silence he would read as good news, when it means nothing at all?
 */
async function truthful(founderId: string, days: number): Promise<PropertyReading> {
  const evidence: string[] = [];
  const wouldFixIt: string[] = [];

  // WHAT WOULD TELL ME IF THIS COMPANY WENT WRONG — ALL OF IT, NOT ONE KIND.
  //
  // This counted rows in `company_senses` and nothing else, and read against
  // production it said Foundry observes nothing about itself. In the same
  // thirty days Foundry had recorded 116 verifications of its own repository
  // and 53 comparisons of a responsibility's expectations against what actually
  // happened — the most closely watched company in the estate — while the two
  // it called sighted were synthetic rehearsals with four connected senses
  // each. The reading was not wrong about `company_senses`. It was wrong about
  // the world, because it asked "is a provider connected" when the question is
  // "is there anything here that would speak up".
  //
  // THREE WAYS, AND NONE OF THEM NAMES A COMPANY. A provider reporting on the
  // business; a check of how the thing is BUILT, verified rather than asserted;
  // an expectation registered in advance and compared against a real event. Any
  // company can be observed by any of them — a customer's company with a
  // connected repository produces exactly the same verification rows. This does
  // not resolve which product row is Foundry, and it must never: a kernel that
  // can ask will eventually answer by exempting the one company it likes.
  //
  // SEVEN DAYS IS WHAT MAKES A STREAM LIVE. Not the horizon — the reading is
  // taken at the moment he leaves, and what matters is whether anything is
  // watching then. A week of total silence from every mechanism means the
  // stream is dead and silence really would mean nothing; a stream that dies
  // while he is away shows up as stale routines in the deployment reading.
  const companies = (await query(
    `SELECT p.id, p.name,
            (SELECT COUNT(*) FROM company_senses s
              WHERE s.product_id = p.id AND s.disconnected_at IS NULL) AS senses,
            (SELECT COUNT(*) FROM company_senses s
              WHERE s.product_id = p.id AND s.disconnected_at IS NULL
                AND s.last_error IS NOT NULL) AS failing,
            (SELECT COUNT(*) FROM signal_events e
              WHERE e.product_id = p.id AND e.source = 'development_verification'
                AND e.created_at >= datetime('now','-7 days')) AS verified,
            (SELECT COUNT(*) FROM responsibility_shadow_comparisons c
               JOIN responsibility_shadow_expectations x ON x.id = c.expectation_id
              WHERE x.product_id = p.id
                AND c.created_at >= datetime('now','-7 days')) AS compared
       FROM products p
      WHERE p.owner_id = ? AND p.status = 'active' AND p.standing = 'earned'
        AND p.deleted_at IS NULL AND ${realCompany('p')}`, [founderId]))
    .rows as unknown as Array<Record<string, unknown>>;

  // FOUNDRY IS AN ORDINARY COMPANY AND STAYS ONE.
  //
  // This first exempted it: it resolved which product row is Foundry and left
  // that one out of the blind list, on the argument that it earns nothing and
  // has no provider to connect. `recursive-institution` refused the module that
  // made that possible, and the refusal was right. The institutional kernel
  // must not be ABLE to ask whether it is operating Foundry — a kernel that can
  // ask will eventually answer by shortening a ladder or widening a grant — and
  // "this company is exempt from the honesty rule because of which company it
  // is" is precisely the shape of the answer nobody wants.
  //
  // So a company with nothing connected is blind, whichever company it is. What
  // does NOT depend on any company is whether the deployment itself is running,
  // and that is read below from `deployment/self-check`, where no product id
  // appears at all.
  const watching = (c: Record<string, unknown>): string[] => {
    const how: string[] = [];
    if (Number(c.senses) > 0) how.push(`${plural(Number(c.senses), 'sense', 'senses')} connected`);
    if (Number(c.verified) > 0) {
      how.push(`${plural(Number(c.verified), 'check', 'checks')} of how it is built, verified this week`);
    }
    if (Number(c.compared) > 0) {
      how.push(`${plural(Number(c.compared), 'comparison', 'comparisons')} against what I expected`);
    }
    return how;
  };
  const blind = companies.filter((c) => watching(c).length === 0).map((c) => String(c.name));

  const { observeSelf } = await import('../deployment/self-check.js');
  const self = await observeSelf();
  for (const sig of self.signals.filter((x) => x.state !== 'current')) {
    evidence.push(`the deployment — ${sig.about}: ${sig.says}`);
    wouldFixIt.push(`look at ${sig.about}`);
  }
  if (self.allCurrent) evidence.push(`the deployment: ${self.sentence}`);

  const erroring = companies.filter((c) => Number(c.failing) > 0).map((c) => String(c.name));

  const { getFailingInstitutionLoops, INSTITUTION_LOOPS } = await import('./loop-health.js');
  const loops = await getFailingInstitutionLoops();

  // EVERY ROUTINE, NOT ONLY THE TWO THAT WERE NAMED.
  //
  // `INSTITUTION_LOOPS` holds the two loops that decide whether the
  // institution's own page is current, and a reading built only on those was
  // silent about production on the day it was written: `behavioral_triggers`
  // had failed FORTY-NINE times in a row since 1 September and nothing the
  // owner can open said so. It fails closed — nothing is sent — which is the
  // right failure and is exactly why nobody noticed.
  //
  // Three in a row, because a scheduled job that fails three consecutive times
  // is not a blip and the interval is the job's own business. The named loops
  // are excluded here: they are reported above with their labels and what they
  // are for, which is more than a job name.
  //
  // AND ONLY ROUTINES SOMETHING STILL SCHEDULES. This read every row, and the
  // day `behavioral_triggers` was retired it went on reporting its fifty
  // failures — telling the owner to fix a job nobody runs, in the one list that
  // has to be worth reading line by line. The composition root stamps
  // `retired_at` from the registry at boot, so the filter is a fact about what
  // this process schedules rather than a list kept somewhere else.
  const otherFailing = (await query(
    `SELECT job_name, consecutive_failures, last_success_at FROM job_health
      WHERE consecutive_failures >= 3 AND retired_at IS NULL
      ORDER BY consecutive_failures DESC`))
    .rows as unknown as Array<Record<string, unknown>>;

  for (const name of blind) {
    evidence.push(`${name}: nothing watches it at all, so I observe nothing about it`);
    wouldFixIt.push(`connect something that reports on ${name}, or say on its page that quiet from it means nothing`);
  }
  // WHAT IS WATCHING, NAMED, SO "NOT BLIND" IS NEVER A BARE CLAIM.
  //
  // A company watched only by checks of how it is built is watched about how it
  // is built. That is a real answer to "would silence be mistaken for calm" —
  // something would speak up — and it is not the same as seeing whether anybody
  // is buying. Saying which it is lets a reader disagree with the finding
  // instead of taking it.
  for (const c of companies.filter((x) => watching(x).length > 0)) {
    evidence.push(`${String(c.name)}: ${watching(c).join(', ')}`);
  }
  for (const name of erroring) {
    evidence.push(`${name}: something I watch is returning an error`);
    wouldFixIt.push(`fix or disconnect the failing sense on ${name}`);
  }
  // AND A CHECK THAT REPORTS A FAILURE IS TROUBLE, NOT SIGHT.
  //
  // The asymmetry this closes: once a verification of how a company is built
  // counts as something watching it, a verification REPORTING A FAILURE has to
  // count as something wrong — or the reading would take credit for watching
  // and then ignore what the watching said, which is the cosmetic version of
  // passing this test.
  const { getFailingSelfChecks } = await import('./development-observation.js');
  let checksFailing = 0;
  for (const c of companies) {
    for (const failed of await getFailingSelfChecks(String(c.id))) {
      checksFailing += 1;
      evidence.push(`${String(c.name)}: ${failed.check} is failing — ${failed.detail}`);
      wouldFixIt.push(`put ${failed.check} right on ${String(c.name)}, or stop checking it`);
    }
  }
  for (const loop of loops) {
    evidence.push(loop.stoppedRunning
      ? `${loop.label}: has not run since ${loop.lastSuccessAt ?? 'ever'}`
      : `${loop.label}: ${plural(loop.consecutiveFailures, 'failure', 'failures')} in a row`);
    wouldFixIt.push(`get ${loop.jobName} running again, or it will report nothing for ${String(days)} days`);
  }
  let alsoFailing = 0;
  for (const job of otherFailing) {
    const name = String(job.job_name);
    if (name in INSTITUTION_LOOPS) continue;
    alsoFailing += 1;
    evidence.push(`${name.replace(/_/g, ' ')}: `
      + `${plural(Number(job.consecutive_failures), 'failure', 'failures')} in a row, last worked `
      + `${job.last_success_at == null ? 'never' : String(job.last_success_at).slice(0, 10)}`);
    wouldFixIt.push(`find out why ${name} is failing, or stop scheduling it`);
  }

  // THE LEDGER CANNOT LIE ABOUT ITS OWN QUALITY, and that is structural rather
  // than a matter of anyone remembering. Migration 313 refuses an estimate with
  // no written policy behind it and refuses a measurement that carries one, so
  // an estimate can never arrive dressed as a measurement no matter how long
  // nobody is looking. Worth saying out loud: it is the one truthfulness
  // guarantee that does not decay with time away.
  evidence.push('the ledger refuses an estimate with no written policy behind it, '
    + 'and refuses a measurement that carries one');

  // A PAID ORDER AT A VENUE NOTHING IS WATCHING is exactly the failure this
  // property exists to catch: the experiment settled, the listing stayed
  // live, and a stranger's payment produced nothing anywhere an owner would
  // look — a silence that is not calm — until it is raised here (migration
  // 350). Independent of `p.standing`, deliberately: the asset behind a
  // settled listing is very often still `experimental`, and the buyer who
  // paid does not care which word the institution uses for what it sold him.
  const unwatchedVenueOrders = (await query(
    `SELECT v.order_ref, v.gross_cents, v.currency, e.what_we_do
       FROM venue_orders_after_settlement v JOIN venture_experiments e ON e.id = v.experiment_id
      WHERE v.founder_id = ? AND v.resolved_at IS NULL`, [founderId]))
    .rows as unknown as Array<Record<string, unknown>>;
  for (const u of unwatchedVenueOrders) {
    evidence.push(`${String(u.what_we_do)}: a ${(Number(u.gross_cents) / 100).toFixed(2)} `
      + `${String(u.currency).toUpperCase()} order (${String(u.order_ref)}) at the venue, after the test that `
      + 'listed it had already settled — nothing here has recorded a charge, a fee or a delivery for it');
  }
  if (unwatchedVenueOrders.length > 0) {
    wouldFixIt.push('record or reconcile the order at the venue, and either retire the listing or bring it '
      + 'under the continuing asset');
  }

  // A VENUE THAT CANNOT BE READ, on an asset this reading otherwise skips.
  // `companies` above is earned companies only, and the asset behind a
  // listing is usually still `experimental` — so a shop whose reader had
  // started failing was invisible here, and its silence read as calm. Any
  // asset that has been listed counts, withdrawn or not: Foundry withdrawing
  // an exposure is its own bookkeeping, not the listing coming down.
  const blindVenues = (await query(
    `SELECT DISTINCT p.name, s.provider, s.last_error
       FROM company_senses s
       JOIN products p ON p.id = s.product_id
      WHERE p.owner_id = ? AND p.deleted_at IS NULL AND p.standing <> 'earned' AND ${realCompany('p')}
        AND s.disconnected_at IS NULL AND s.last_error IS NOT NULL
        AND EXISTS (SELECT 1 FROM experiment_exposures x WHERE x.product_id = p.id)`, [founderId]))
    .rows as unknown as Array<Record<string, unknown>>;
  for (const v of blindVenues) {
    const venue = String(v.provider).charAt(0).toUpperCase() + String(v.provider).slice(1);
    evidence.push(`${String(v.name)}: ${String(v.last_error).startsWith(`${venue} could not be read`)
      ? String(v.last_error) : `${venue} could not be read: ${String(v.last_error)}`} — its orders and `
      + `messages are not being seen here`);
    wouldFixIt.push(`get ${venue} reading again for ${String(v.name)}, or check its orders and messages there yourself`);
  }

  const selfStale = self.signals.filter((x) => x.state !== 'current').length;
  const broken = blind.length + erroring.length + loops.length + alsoFailing + selfStale
    + checksFailing + unwatchedVenueOrders.length + blindVenues.length;
  return {
    property: 'truthful',
    question: `After ${String(days)} days, would anything I show you assert more than I actually know?`,
    finding: broken === 0 ? 'HOLDS' : 'DOES_NOT_HOLD',
    sentence: broken === 0
      ? 'Everything I would show you is something I am actually watching, and every figure carries how it was arrived at.'
      : `${plural(broken, 'thing is', 'things are')} quiet for a reason that is not calm, `
        + `and after ${String(days)} days away you would have no way to tell the difference.`,
    evidence, wouldFixIt,
  };
}

// ─── 2. BOUNDED ──────────────────────────────────────────────────────────────

/**
 * WHAT IS THE MOST THAT COULD LEAVE WHILE HE IS GONE?
 *
 * A ceiling per day is not a ceiling over ninety days; it is a rate. The
 * honest reading multiplies every standing limit out to the horizon and says
 * the total, because the total is the number he is actually exposed to and
 * the daily figure is the one that makes it look small.
 *
 * An authority with no end date fails this outright, whatever its size. The
 * question is not how much — it is whether it stops on its own.
 */
async function bounded(founderId: string, days: number, now: Date): Promise<PropertyReading> {
  const evidence: string[] = [];
  const wouldFixIt: string[] = [];
  const horizonEnd = new Date(now.getTime() + days * DAY_MS).toISOString();

  // THE CEILING THAT ACTUALLY BINDS. With a charter standing, thinking is
  // bounded by the rate he signed, not the provider's founder-wide ceiling —
  // which read "$700 over 7 days" beside a charter that allows $3 a day.
  // Without one, the pre-charter rate; the provider ceiling is the backstop.
  const { thinkingToday } = await import('./spending.js');
  const t = await thinkingToday(founderId, now);
  const founderCeilingCents = t.bindingCents;
  const thinkingWorstCase = founderCeilingCents * days;
  evidence.push(`thinking: at most ${money(founderCeilingCents)} a day${t.bindingIs === 'charter' ? ' under the charter' : t.bindingIs === 'pre-charter' ? ' until a charter is signed' : ' by this deployment\u2019s own cap'}, `
    + `so ${money(thinkingWorstCase)} over ${String(days)} days if every day hit the ceiling`);

  // REAL COMPANIES ONLY, AND DELIBERATELY NOT EARNED ONES ONLY. A reference
  // company's allowance is synthetic money and would inflate the worst case
  // with spending that cannot happen. An EXPERIMENTAL asset's allowance is
  // real money the owner authorised — most of what he has authorised, in fact
  // — and leaving it out would understate exactly the number this reading
  // exists to give him. The two boundaries answer different questions and only
  // one of them applies here.
  const allowances = (await query(
    `SELECT a.id, a.statement, a.amount_cents, a.until, a.unbounded_because, p.name
       FROM owner_allowances a JOIN products p ON p.id = a.product_id
      WHERE p.owner_id = ? AND a.withdrawn_at IS NULL
        AND ${realCompany('p')}
        AND (a.until IS NULL OR datetime(a.until) > datetime('now'))`, [founderId]))
    .rows as unknown as Array<Record<string, unknown>>;
  let unbounded = 0;
  let allowedCents = 0;
  for (const a of allowances) {
    const ends = a.until == null ? null : String(a.until);
    allowedCents += Number(a.amount_cents);
    if (ends === null) {
      unbounded += 1;
      evidence.push(`${String(a.name)}: ${money(Number(a.amount_cents))} with no end date — `
        + `${String(a.unbounded_because ?? 'no reason recorded')}`);
      wouldFixIt.push(`give the allowance on ${String(a.name)} an end date`);
    } else {
      evidence.push(`${String(a.name)}: ${money(Number(a.amount_cents))} until ${ends.slice(0, 10)}`
        + `${ends > horizonEnd ? ' — still live when you return' : ' — expires before you return'}`);
    }
  }

  const workshop = (await query(
    `SELECT cents_per_month FROM workshop_spend_ceiling WHERE founder_id = ?`, [founderId]))
    .rows[0] as Record<string, unknown> | undefined;
  if (workshop) {
    const months = days / 30;
    evidence.push(`the Workshop: ${money(Number(workshop.cents_per_month))} a month, so at most `
      + `${money(Math.round(Number(workshop.cents_per_month) * months))} over ${String(days)} days`);
  }

  // STANDING PERMISSION THAT OUTLASTS THE ABSENCE. A grant with no expiry is
  // not a larger grant than one with an expiry — it is a different kind of
  // thing, because only one of them ends without him.
  const grants = (await query(
    `SELECT c.capability, c.expires_at, p.name FROM autonomy_consents c
       JOIN products p ON p.id = c.product_id
      WHERE p.owner_id = ? AND c.to_mode = 'act' AND c.revoked_at IS NULL
        AND ${realCompany('p')}
        AND (c.expires_at IS NULL OR datetime(c.expires_at) > datetime('now'))`, [founderId]))
    .rows as unknown as Array<Record<string, unknown>>;
  for (const g of grants) {
    const what = String(g.capability).replace(/_/g, ' ');
    if (g.expires_at == null) {
      unbounded += 1;
      evidence.push(`${String(g.name)}: I may ${what} on my own, with no end date`);
      wouldFixIt.push(`put an end date on permission to ${what} at ${String(g.name)}`);
    } else {
      evidence.push(`${String(g.name)}: I may ${what} until ${String(g.expires_at).slice(0, 10)}`);
    }
  }

  const worst = thinkingWorstCase + allowedCents;
  // WHAT IS OWED TO BUYERS IS NOT IN THE CEILING, and the accountant asks
  // exactly that: it is theirs, and a refund returns it; the provider's fee
  // on the sale is not returned and is the one real cost the refund leaves.
  const { obligationsFor: owedTo } = await import('../venture/obligations.js');
  const owedNow = await owedTo(founderId, now);
  const owedCents = owedNow.reduce((n, o) => n + o.amountCents, 0);
  // WHOSE FEE, THOUGH. `obligationsFor` returns every open obligation across
  // every channel, and this named Stripe's fee for all of them \u2014 the same leak
  // the obligations module had, one file over. The sentence says "the
  // processor's" where the buyers are on more than one channel, and names the
  // one processor where they are not.
  const channels = [...new Set(owedNow.map((o) => o.provider))];
  const whoseFee = channels.length === 1
    ? `${channels[0].charAt(0).toUpperCase()}${channels[0].slice(1)}\u2019s`
    : 'the platform\u2019s';
  const owedLine = owedNow.length === 0 ? ''
    : ` ${money(owedCents)} is owed to ${plural(owedNow.length, 'buyer', 'buyers')} besides: theirs, not yours, and a refund returns it (${whoseFee} fee on the sale is not returned).`;
  if (owedNow.length) evidence.push(`owed to buyers: ${money(owedCents)}, outside the ceiling because it is their money`);
  return {
    property: 'bounded',
    question: `Over ${String(days)} days, what is the most that could happen without me, and does it stop on its own?`,
    finding: unbounded === 0 ? 'HOLDS' : 'DOES_NOT_HOLD',
    sentence: unbounded === 0
      ? `At most ${money(worst)} could be spent over ${String(days)} days, and every permission I hold `
        + 'ends by itself whether or not you come back.' + owedLine
      : `${plural(unbounded, 'permission does', 'permissions do')} not end on their own, so `
        + `${String(days)} days away and a year away are the same thing to ${unbounded === 1 ? 'it' : 'them'}.`,
    evidence, wouldFixIt,
  };
}

// ─── 3. ECONOMICALLY UNDERSTANDABLE ──────────────────────────────────────────

/**
 * COULD HE FOLLOW THE MONEY ON THE WAY BACK IN?
 *
 * Not "is there a number" — there is always a number. The test is whether
 * every step from what a buyer paid to what is his carries how it was arrived
 * at, and whether the end of the chain survives the worst link in it. A
 * surplus computed out of one unavailable component is not a smaller surplus;
 * it is not a surplus.
 */
async function understandable(founderId: string, days: number): Promise<PropertyReading> {
  const { distributableSurplus, figureText } = await import('../economy/projection.js');
  const surplus = await distributableSurplus(founderId);
  const evidence = [
    `held: ${figureText(surplus.held)}`,
    `owed: ${figureText(surplus.obligations)}`,
    `refundable: ${figureText(surplus.refundExposure)}`,
    `tax held back: ${figureText(surplus.taxReserve)}`,
    `operating floor: ${figureText(surplus.operatingReserve)}`,
    `already authorised: ${figureText(surplus.authorisedCapital)}`,
    `yours: ${figureText(surplus.figure)}`,
  ];
  const unavailable = [surplus.held, surplus.obligations, surplus.refundExposure,
    surplus.taxReserve, surplus.operatingReserve, surplus.authorisedCapital]
    .filter((f) => f.quality === 'unavailable');
  const wouldFixIt = unavailable.map((f) => f.because);

  return {
    property: 'understandable',
    question: `Coming back after ${String(days)} days, could I follow a payment through to what is mine?`,
    finding: surplus.figure.quality === 'unavailable' ? 'CANNOT_ESTABLISH'
      : unavailable.length === 0 ? 'HOLDS' : 'DOES_NOT_HOLD',
    sentence: surplus.figure.quality === 'unavailable'
      ? 'I cannot tell you what is yours, and the reason is written down rather than rounded to zero.'
      : unavailable.length === 0
        ? `${surplus.sentence} Every step from a payment to that figure says how it was arrived at.`
        : `${surplus.sentence} ${plural(unavailable.length, 'step', 'steps')} in that subtraction `
          + 'is something I do not know, and the not-knowing is carried through rather than hidden.',
    evidence, wouldFixIt,
  };
}

// ─── 4. RECOVERABLE ──────────────────────────────────────────────────────────

/**
 * IF SOMETHING WENT WRONG ON DAY ONE, IS THERE A WAY BACK ON DAY N?
 *
 * This is where the horizon bites hardest and where an institution is most
 * tempted to lie to itself. Copies are kept for fourteen days. That is ample
 * for a week away and it is NOT ample for ninety: a bad migration on the
 * second day of a three-month absence would have had its last clean copy
 * deleted seventy-six days before he opened his laptop.
 *
 * Retention is read from what is actually on the volume, not from the policy
 * constant, because a policy nobody has checked is a belief.
 */
async function recoverable(days: number): Promise<PropertyReading> {
  const { whatIsKept, howFarBackCopiesReach } = await import('./keeping.js');
  const kept = await whatIsKept();
  const evidence: string[] = [];
  const wouldFixIt: string[] = [];

  if (kept.length === 0) {
    return {
      property: 'recoverable',
      question: `If something corrupted this on day one, could it be put back on day ${String(days)}?`,
      finding: 'DOES_NOT_HOLD',
      sentence: 'There is no copy of this institution on the volume, so there is nothing to put back.',
      evidence: ['nothing found where copies are kept'],
      wouldFixIt: ['run the copy routine, and check that it wrote something'],
    };
  }

  // FROM THE DATES IN THE NAMES, NOT THE FILE TIMES. This measured the span
  // between the oldest and newest mtime, and a restore, a volume move or a
  // container rebuild touches every file at once — after which it would have
  // reported a year of history as a single afternoon, or an afternoon as a
  // year. The name is what a copy is a copy OF.
  const spanDays = (await howFarBackCopiesReach()) ?? 0;
  const newest = kept[0];
  const newestAgeHours = Math.floor((Date.now() - Date.parse(newest.at)) / 3_600_000);
  evidence.push(`${plural(kept.length, 'copy', 'copies')} on the volume, the newest `
    + `${plural(newestAgeHours, 'hour', 'hours')} old`);
  evidence.push(`the oldest is dated ${plural(spanDays, 'day', 'days')} ago`);
  evidence.push('they thin rather than expiring: every day for a fortnight, then Mondays for '
    + 'three months, then the first of each month for a year');
  evidence.push('each is a compressed copy that has been restored and read back in test, not '
    + 'merely written; what this does NOT cover is losing the volume or the account, which is '
    + 'the volume\'s own snapshots and not something I can read from in here');

  // THE HONEST COMPARISON. Not "do backups exist" but "does the window reach
  // back as far as the absence", which is the question an owner returning
  // after ninety days is actually asking.
  const covers = spanDays >= days;
  if (!covers) {
    wouldFixIt.push(`keep copies for at least ${String(days)} days, or accept that a fault in the `
      + `first ${String(days - spanDays)} days of an absence this long would have no clean copy left`);
  }

  return {
    property: 'recoverable',
    question: `If something corrupted this on day one, could it be put back on day ${String(days)}?`,
    finding: covers ? 'HOLDS' : 'DOES_NOT_HOLD',
    sentence: covers
      ? `Copies reach back ${plural(spanDays, 'day', 'days')}, which covers the whole of a `
        + `${String(days)}-day absence.`
      : `Copies reach back ${plural(spanDays, 'day', 'days')}. A fault in the first `
        + `${plural(days - spanDays, 'day', 'days')} of a ${String(days)}-day absence would have `
        + 'no clean copy left by the time you noticed.',
    evidence, wouldFixIt,
  };
}

// ─── 5. ONLY GENUINE OWNER DECISIONS ─────────────────────────────────────────

/**
 * WILL WHAT IS WAITING STILL BE WAITING — AND IS IT HIS?
 *
 * Two failures hide under one heading. The first is noise: a queue of things
 * that are not really his to decide, which teaches him to stop reading it. The
 * second is quieter and worse: a decision with an expiry. A proposal that
 * lapses unanswered on day nine of a ninety-day absence was not deferred to
 * him — it was decided by the clock, and he will come back to a screen that
 * shows nothing waiting because everything waiting already timed out.
 */
async function onlyRealDecisions(
  founderId: string, days: number, now: Date,
): Promise<PropertyReading> {
  const evidence: string[] = [];
  const wouldFixIt: string[] = [];
  const returnAt = new Date(now.getTime() + days * DAY_MS).toISOString();

  // REAL COMPANIES, ANY STANDING — for the reason written above the allowance
  // query in `bounded`. A proposal about an experimental asset is a real
  // decision waiting for him; a proposal about a reference company is not.
  const proposals = (await query(
    `SELECT a.id, a.summary, a.expires_at, p.name FROM proposed_acts a
       JOIN products p ON p.id = a.product_id
      WHERE p.owner_id = ? AND ${realCompany('p')} AND a.decision IS NULL
        AND datetime(a.expires_at) > datetime('now')`, [founderId]))
    .rows as unknown as Array<Record<string, unknown>>;
  const lapsing = proposals.filter((p) => String(p.expires_at) <= returnAt);
  for (const p of proposals) {
    evidence.push(`${String(p.name)}: ${String(p.summary)} — `
      + `${String(p.expires_at) <= returnAt
        ? `lapses on ${String(p.expires_at).slice(0, 10)}, before you are back`
        : `still there when you return`}`);
  }
  if (lapsing.length > 0) {
    wouldFixIt.push(`decide ${plural(lapsing.length, 'proposal', 'proposals')} before you go, or `
      + 'let them lapse knowing that the lapse is the decision');
  }

  // ONE QUESTION ASKED TWENTY-TWO TIMES IS ONE DECISION, NOT TWENTY-TWO.
  //
  // Run against production this listed the same sentence twenty-two times —
  // twenty-two `venture_experiments` rows, one per person the offer would be
  // shown to, all of them the identical question. A property whose whole job
  // is to say whether what is waiting is genuinely his to decide cannot itself
  // be the noise that teaches him to stop reading it.
  //
  // Grouped by what the test actually DOES, which is the only thing he would
  // be deciding. The count stays visible because twenty-two people is a fact
  // about the size of the decision, not a repetition of it.
  // AN UNDESIGNED TEST IS NOT A DECISION, AND COUNTING IT AS ONE IS THE
  // CHEAPEST WAY TO TEACH HIM TO STOP READING THIS.
  //
  // Production held TWENTY-TWO rows here, across twenty unrelated
  // opportunities, every one carrying the identical boilerplate — "showing a
  // price to somebody who has the problem and seeing what they do", cost zero
  // — stamped once per opportunity by a scheduled job. None of them says who
  // would be contacted, at what price, through which channel, or what would
  // stop it. There is nothing in them to approve: saying yes would authorise
  // nothing in particular.
  //
  // `probe_designs` is the line. Its columns are the design — what this
  // decides, why this instrument, what it can and cannot prove, why now rather
  // than waiting, how it reaches people, what happens if it works — and every
  // one of them is NOT NULL. A test with that row is a decision. A test
  // without it is an opportunity nobody has designed a test for yet, and it
  // belongs in the forge, where it already is.
  const tests = (await query(
    `SELECT e.what_we_do, COUNT(*) AS n FROM venture_experiments e
      JOIN probe_designs d ON d.experiment_id = e.id
      WHERE e.founder_id = ? AND e.decision IS NULL AND e.evidence_mode = 'real'
      GROUP BY e.what_we_do ORDER BY n DESC`, [founderId]))
    .rows as unknown as Array<Record<string, unknown>>;
  let waitingTests = 0;
  for (const t of tests) {
    const n = Number(t.n);
    waitingTests += n;
    evidence.push(n === 1
      ? `a test waiting for your go-ahead: ${String(t.what_we_do)} — no expiry, so it waits`
      : `${String(n)} tests waiting for your go-ahead, all the same question: `
        + `${String(t.what_we_do)} — no expiry, so they wait`);
  }

  // THINGS THAT NEED HIM AND HAVE A DATE ON THEM. A responsibility due inside
  // the absence is not waiting for him; it is going to be late.
  const overdue = (await query(
    `SELECT r.title, r.due_at, p.name FROM institutional_responsibilities r
       JOIN products p ON p.id = r.product_id
      WHERE p.owner_id = ? AND ${realCompany('p')}
        AND r.due_at IS NOT NULL AND r.disposition = 'active'
        AND datetime(r.due_at) <= datetime(?)`, [founderId, returnAt]))
    .rows as unknown as Array<Record<string, unknown>>;
  for (const r of overdue) {
    evidence.push(`${String(r.name)}: ${String(r.title)} is due ${String(r.due_at).slice(0, 10)}, `
      + 'which falls while you are away');
  }
  if (overdue.length > 0) {
    wouldFixIt.push(`move or discharge ${plural(overdue.length, 'dated commitment', 'dated commitments')} `
      + 'that fall inside the absence');
  }

  // A BUYER OWED SOMETHING ONLY HE CAN GIVE IS NOT A DECISION THAT WAITS.
  //
  // This counted it as "waiting" — beside a proposal that sits harmlessly
  // until he is back — so the horizon read HOLDS and "all of them would still
  // be there when you got back", while this same property's wouldFixIt said
  // settle it before you go. A proposal waits; a buyer waits too, on a
  // provider's clock this institution does not hold: an Etsy case, a bank's
  // dispute window, a buyer's patience. So it compromises the absence.
  //
  // WITHOUT A DATE WE DO NOT HAVE. No obligation carries the provider's
  // deadline, and inventing one would be a second false comfort. It says when
  // the duty opened and that no deadline is on record.
  const { obligationsFor: owedTo } = await import('../venture/obligations.js');
  const owedHim = (await owedTo(founderId, now)).filter((o) => o.asksHim !== null);
  for (const o of owedHim) {
    evidence.push(`a buyer is owed something only you can give, since ${o.since.slice(0, 10)}: `
      + `${o.sentence} No deadline is on record for it, and the provider's own process may not wait.`);
  }
  if (owedHim.length > 0) wouldFixIt.push(`settle ${plural(owedHim.length, 'buyer\'s refund or dispute', 'buyers\' refunds or disputes')} before you go`);
  // AND A BUYER WHO WROTE. A refund request in the Workshop's mail is a buyer
  // waiting on him exactly as an obligation is, and it was invisible here — most
  // of all on a day the model is down, when such a message is escalated to him
  // unread. Read through the same reader the hand uses to hold new offers.
  const { buyersWaitingOnHim } = await import('../venture/obligations.js');
  const wroteToHim = (await buyersWaitingOnHim(founderId, now)).slice(owedHim.length);
  for (const w of wroteToHim) evidence.push(`a buyer is waiting on you: ${w.sentence}. No deadline is on record for it.`);
  if (wroteToHim.length > 0) wouldFixIt.push(`answer ${plural(wroteToHim.length, 'buyer who wrote', 'buyers who wrote')} before you go`);
  // AND WHAT THE QUEUE COUNTS. This asked its own question of its own rows and
  // answered "nothing is waiting for you" while Home said one thing was: two
  // readings of one fact, which is the defect this institution keeps finding.
  const { waitingOn } = await import('../founder/attention.js');
  const queue = await waitingOn(founderId);
  for (const q of queue) evidence.push(`waiting on you: ${q.summary}`);
  const waiting = Math.max(proposals.length + waitingTests, queue.length);
  const compromised = lapsing.length + overdue.length + owedHim.length + wroteToHim.length;
  return {
    property: 'only_real_decisions',
    question: `After ${String(days)} days, would the things waiting for me be mine — and still be there?`,
    finding: compromised === 0 ? 'HOLDS' : 'DOES_NOT_HOLD',
    sentence: compromised > 0
      ? [owedHim.length + wroteToHim.length > 0
        ? `${plural(owedHim.length + wroteToHim.length, 'buyer is', 'buyers are')} owed something only you can give, and would wait for you with no deadline on record.`
        : null,
      lapsing.length + overdue.length > 0
        ? `${plural(lapsing.length + overdue.length, 'thing', 'things')} would be settled by the calendar rather than by you: `
          + `${plural(lapsing.length, 'proposal that lapses', 'proposals that lapse')} and `
          + `${plural(overdue.length, 'date that passes', 'dates that pass')} while you are gone.`
        : null].filter(Boolean).join(' ')
      : waiting === 0
        ? 'Nothing is waiting for you, and nothing would expire unanswered while you were away.'
        : `${plural(waiting, 'thing is', 'things are')} waiting for you, every one of them yours to `
          + 'decide, and all of them would still be there when you got back.',
    evidence, wouldFixIt,
  };
}

// ─── THE READING ─────────────────────────────────────────────────────────────

/**
 * ONE HORIZON, FIVE PROPERTIES.
 *
 * The verdict leads with what fails, because a summary that leads with what
 * works is how an institution talks itself out of the one thing wrong with it.
 */
export async function absenceReading(
  founderId: string, days: number, now: Date = new Date(),
): Promise<AbsenceReading> {
  const properties = [
    await truthful(founderId, days),
    await bounded(founderId, days, now),
    await understandable(founderId, days),
    await recoverable(days),
    await onlyRealDecisions(founderId, days, now),
  ];

  // A LIVED READING CANNOT OUTRUN THE RECORD. Truthfulness and the decision
  // queue are read from what is here NOW and projected forward, which is fair;
  // but an institution younger than the horizon has never been through one,
  // and saying so is more useful than a confident pass.
  const age = await daysOfRecord(founderId);
  const younger = age !== null && age < days;

  const failing = properties.filter((p) => p.finding === 'DOES_NOT_HOLD');
  const unknown = properties.filter((p) => p.finding === 'CANNOT_ESTABLISH');
  const verdict = failing.length === 0 && unknown.length === 0
    ? `${String(days)} days away would leave everything here still true, still bounded, still `
      + 'adding up, still recoverable, and nothing of yours decided without you.'
      + (younger ? ` I have only existed for ${plural(age ?? 0, 'day', 'days')}, so this is what `
        + 'the records imply rather than something I have lived through.' : '')
    : failing.length === 0
      ? `Over ${String(days)} days, ${plural(unknown.length, 'thing', 'things')} I cannot establish `
        + 'either way, and nothing I can establish fails.'
      : `Over ${String(days)} days, ${failing.map((p) => p.sentence).join(' ')}`;

  return {
    days,
    returnsOn: new Date(now.getTime() + days * DAY_MS).toISOString().slice(0, 10),
    properties, verdict,
  };
}

/** All three horizons, in order. Same records, three questions. */
export async function absenceHorizons(
  founderId: string, now: Date = new Date(),
): Promise<AbsenceReading[]> {
  const out: AbsenceReading[] = [];
  for (const days of HORIZONS) out.push(await absenceReading(founderId, days, now));
  return out;
}
