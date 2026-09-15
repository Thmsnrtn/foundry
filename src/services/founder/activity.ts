// =============================================================================
// FOUNDRY — What actually happened, as the estate's own stream.
//
// §22 of the owner operating system asks for a meaningful institutional event
// stream, and this was the last canonical surface that did not exist. The rows
// were all there — an experiment being authorized, a message actually leaving,
// a provider receipt coming back, a bounce, a payment, an obligation opening,
// an owner exclusion striking a candidate — but each could only be read on the
// page of the one company or the one experiment it belonged to. The owner could
// find out what happened to a thing. He could not find out what happened.
//
// WHAT THIS REFUSES TO CARRY, which is most of what a machine produces:
//
//   · cron ticks. The scheduler passing is not news. Sixteen jobs run every
//     hour and their running is the floor, not an event.
//   · self-checks that passed. `development_verification` writes dozens of rows
//     a day saying a check reported passed; that is how the institution watches
//     itself, and it belongs in the absence model, not in front of the owner.
//   · model calls. What Foundry thought is not what Foundry did, and the spend
//     ledger already accounts for it by work.
//   · chain of thought, drafts, proposals nobody acted on, and anything whose
//     only content is that a routine began.
//
// The concept board for this page leads with "48 events today, +12% vs
// yesterday" and includes a row reading "system health check completed — no
// action required". Both are exactly what §22 forbids and what §1 forbids
// optimising for. There is no counter here and there never should be: an event
// stream that reports its own volume teaches the owner to value activity.
//
// Every row is a state transition that a person could be affected by, that
// money could turn on, or that changed what Foundry is permitted to do. Each
// carries the place its evidence lives, so the stream is a way in rather than
// a summary.
//
// WHY STANDING DOES NOT APPLY HERE, AND REALITY DOES.
//
// These are different boundaries and this page sits on opposite sides of them.
//
// REALITY does apply: a reference company is synthetic, its rehearsals are not
// things that happened, and this is the one surface whose entire claim is that
// they did. Every query below carries `realCompany`, including the subqueries
// that only resolve a name — a true event under a synthetic company's label is
// the quietest way for this page to lie.
//
// STANDING does not: an experimental asset is a test object rather than an
// operating company, which is the right exclusion for a count of what he owns
// or a roll-up of what they earn. It is the wrong one here. The frontier is
// where nearly everything interesting happens — an experiment authorised, an
// offer sent, a first payment, a boundary refusing somebody — and a stream that
// waited for a company to earn its standing would be empty for exactly as long
// as it mattered. This page shows the frontier AS the frontier.
// =============================================================================
import { query, realCompany } from '../../db/client.js';

/**
 * WHAT CLASS OF THING HAPPENED. Not a severity and not a topic: these say which
 * kind of consequence the row carries, because "a message left the building"
 * and "a responsibility gained authority" are read differently even when they
 * happen a second apart.
 */
export type ActivityKind =
  /** What Foundry became permitted, or stopped being permitted, to do. */
  | 'authority'
  /** An experiment crossing a lifecycle boundary. */
  | 'experiment'
  /** Something that actually left the institution and reached a person. */
  | 'outward'
  /** Money, from a source event rather than from an estimate. */
  | 'money'
  /** A promise opened or discharged. */
  | 'obligation'
  /** A boundary of the owner's refusing something. */
  | 'boundary';

export interface InstitutionalEvent {
  /** When the world did it, not when Foundry heard about it. */
  at: string;
  kind: ActivityKind;
  productId: string | null;
  companyName: string | null;
  /** One line. If it needs a paragraph it is not a state transition. */
  what: string;
  /** The ground underneath it, where there is ground. */
  detail: string | null;
  /** Where the evidence is. Null only where nothing can be drilled into. */
  href: string | null;
}

type Row = Record<string, unknown>;
const rows = async (sql: string, params: unknown[]): Promise<Row[]> =>
  (await query(sql, params)).rows as unknown as Row[];

const str = (v: unknown): string | null => (v == null ? null : String(v));
const money = (cents: unknown): string =>
  `$${(Number(cents ?? 0) / 100).toFixed(2)}`;

/**
 * The estate's stream, newest first.
 *
 * REAL COMPANIES ONLY. A reference company exists to exercise the institution
 * and its rehearsals are not things that happened; folding them in here would
 * make the one page whose whole claim is "this occurred" the page most likely
 * to be believed about something that did not.
 *
 * Six reads over indexed columns, merged in memory. It is a page the owner
 * opens, not a feed that polls: §23 says WATCH should be close to zero
 * cognition, and this reaches no model at all.
 */
export async function whatHappened(
  founderId: string, limit = 60,
): Promise<InstitutionalEvent[]> {
  const out: InstitutionalEvent[] = [];

  // ── AUTHORITY ──────────────────────────────────────────────────────────────
  // An act decided, revoked or consumed. The most consequential rows in the
  // institution: every outward effect traces to one of them, and a revocation
  // is the owner taking something back, which he should be able to see he did.
  for (const r of await rows(
    `SELECT a.id, a.summary, a.decision, a.decided_at, a.revoked_at, a.revoke_reason,
            a.consumed_at, p.id AS product_id, p.name
       FROM proposed_acts a JOIN products p ON p.id = a.product_id
      WHERE p.owner_id = ? AND ${realCompany('p')} AND p.deleted_at IS NULL
        AND (a.decided_at IS NOT NULL OR a.revoked_at IS NOT NULL)
      ORDER BY COALESCE(a.revoked_at, a.decided_at) DESC LIMIT ?`,
    [founderId, limit])) {
    const base = {
      kind: 'authority' as const, productId: str(r.product_id),
      companyName: str(r.name), href: `/foundry/decisions`,
    };
    if (r.decided_at != null) {
      out.push({
        ...base, at: String(r.decided_at),
        what: r.decision === 'approved'
          ? `You authorised: ${String(r.summary)}`
          : `You refused: ${String(r.summary)}`,
        detail: r.decision === 'approved' && r.consumed_at != null
          ? `Used ${String(r.consumed_at).slice(0, 16)}. It cannot be used again.`
          : r.decision === 'approved' ? 'Not used yet.' : null,
      });
    }
    if (r.revoked_at != null) {
      out.push({
        ...base, at: String(r.revoked_at),
        what: `You took back: ${String(r.summary)}`,
        detail: str(r.revoke_reason),
      });
    }
  }

  // ── EXPERIMENTS ────────────────────────────────────────────────────────────
  // Lifecycle boundaries only. An experiment being proposed is not an event —
  // proposals that nobody answered are what the owner queue is for.
  for (const r of await rows(
    // THE COMPANY IS RESOLVED BY LINEAGE, not by a column: an experiment has no
    // product_id, and its asset is the product born from it. An experiment that
    // has not produced one yet is still an event, so this is a subquery rather
    // than a join that would drop it.
    //
    // AND THE SUBQUERY CARRIES THE REALITY BOUNDARY TOO. The outer filter on
    // `evidence_mode = 'real'` decides whether the EVENT happened; this decides
    // whether the NAME beside it is a company the owner has. A real experiment
    // that produced a reference asset would otherwise put a synthetic company's
    // name on a true row, which is the quietest way for this page to lie — the
    // event would be real and the label would not, and nothing would say which
    // half to doubt. Unresolved, the row keeps the event and drops the name.
    `SELECT e.id, e.what_we_do, e.decision, e.decided_at, e.ran_at, e.verdict,
            e.what_happened, e.retired_at, e.retired_because, e.invalidated_at,
            e.invalid_because,
            (SELECT p.id FROM products p
              WHERE p.from_experiment_id = e.id AND p.deleted_at IS NULL
                AND ${realCompany('p')}) AS product_id,
            (SELECT p.name FROM products p
              WHERE p.from_experiment_id = e.id AND p.deleted_at IS NULL
                AND ${realCompany('p')}) AS name
       FROM venture_experiments e
      WHERE e.founder_id = ? AND e.evidence_mode = 'real'
      ORDER BY COALESCE(e.retired_at, e.ran_at, e.decided_at) DESC LIMIT ?`,
    [founderId, limit])) {
    const base = {
      kind: 'experiment' as const, productId: str(r.product_id),
      companyName: str(r.name), href: `/foundry/experiments/${String(r.id)}`,
    };
    // ONE LINE MEANS ONE LINE. `what_we_do` is the experiment's full sentence —
    // population, offer, price, channel and fulfilment in one breath — which is
    // right on its own page and is forty words in a stream. Cut at a word, and
    // the row links to the page that carries the whole thing.
    const whole = String(r.what_we_do);
    const title = whole.length <= 72 ? whole
      : `${whole.slice(0, 72).replace(/\s+\S*$/, '')}…`;
    if (r.decided_at != null) {
      out.push({
        ...base, at: String(r.decided_at),
        what: r.decision === 'approved' ? `Experiment authorised: ${title}`
          : `Experiment declined: ${title}`,
        detail: null,
      });
    }
    if (r.ran_at != null) {
      out.push({
        ...base, at: String(r.ran_at),
        what: r.verdict === 'as_predicted'
          ? `Experiment settled as predicted: ${title}`
          : `Experiment settled against its prediction: ${title}`,
        detail: str(r.what_happened),
      });
    }
    if (r.invalidated_at != null) {
      out.push({
        ...base, at: String(r.invalidated_at),
        what: `Experiment invalidated: ${title}`, detail: str(r.invalid_because),
      });
    }
    if (r.retired_at != null) {
      out.push({
        ...base, at: String(r.retired_at),
        what: `Experiment retired: ${title}`, detail: str(r.retired_because),
      });
    }
  }

  // ── OUTWARD ────────────────────────────────────────────────────────────────
  // SOMETHING LEFT THE BUILDING. An action executed is a message that reached a
  // provider; an outcome verified is a receipt reconciled afterwards against
  // what the provider says actually happened. Both are here because the gap
  // between them is where a send that silently failed would hide.
  //
  // `executed_at`, not `created_at`: intent to write is not a write.
  for (const r of await rows(
    `SELECT o.id, o.action_type, o.executed_at, o.outcome_status, o.experiment_id,
            o.experiment_act, p.id AS product_id, p.name
       FROM outbound_actions o JOIN products p ON p.id = o.product_id
      WHERE p.owner_id = ? AND ${realCompany('p')} AND p.deleted_at IS NULL
        AND o.executed_at IS NOT NULL
      ORDER BY o.executed_at DESC LIMIT ?`,
    [founderId, limit])) {
    const what = r.experiment_act === 'offer' ? 'An offer was sent'
      : r.experiment_act === 'delivery' ? 'Something paid for was delivered'
        : `${String(r.action_type)} was carried out`;
    out.push({
      at: String(r.executed_at), kind: 'outward', productId: str(r.product_id),
      companyName: str(r.name),
      what: r.outcome_status === 'verified_failure' ? `${what}, and did not arrive` : what,
      detail: r.outcome_status === 'verified_success' ? 'The provider confirmed delivery.'
        : r.outcome_status === 'verified_failure' ? 'The provider reported it bounced; the address is suppressed.'
          : 'Not yet reconciled against the provider.',
      href: r.experiment_id != null ? `/foundry/experiments/${String(r.experiment_id)}` : null,
    });
  }

  // ── MONEY ──────────────────────────────────────────────────────────────────
  // From the ledger, which is written by a source event rather than by a
  // judgement. `occurred_at` is when the world did it; `recorded_at` is when we
  // heard, and the owner is being told about the world.
  for (const r of await rows(
    `SELECT id, kind, amount_cents, currency, occurred_at, provider, because, claim_quality
       FROM economic_events
      WHERE founder_id = ? AND evidence_mode = 'real'
      ORDER BY occurred_at DESC LIMIT ?`, [founderId, limit])) {
    out.push({
      at: String(r.occurred_at), kind: 'money', productId: null, companyName: null,
      what: `${String(r.kind).replace(/_/g, ' ')} — ${money(r.amount_cents)}`,
      detail: `${String(r.because)} ${String(r.provider)}.`
        + (r.claim_quality === 'estimated' ? ' Estimated.' : ''),
      href: '/foundry/money',
    });
  }

  // ── OBLIGATIONS ────────────────────────────────────────────────────────────
  // A promise opening and a promise being discharged. §37 makes these first
  // class; an institution that cannot see what it owes cannot be trusted with
  // what it is owed.
  for (const r of await rows(
    `SELECT u.id, u.understood_as, u.opened_at, u.closed_at, u.closed_as, u.closed_because,
            p.id AS product_id, p.name
       FROM undertakings u JOIN products p ON p.id = u.product_id
      WHERE u.founder_id = ? AND u.evidence_mode = 'real'
        AND ${realCompany('p')} AND p.deleted_at IS NULL
      ORDER BY COALESCE(u.closed_at, u.opened_at) DESC LIMIT ?`, [founderId, limit])) {
    const base = {
      kind: 'obligation' as const, productId: str(r.product_id),
      companyName: str(r.name), href: '/foundry/roadmap',
    };
    out.push({
      ...base, at: String(r.opened_at),
      what: `Took something on: ${String(r.understood_as)}`, detail: null,
    });
    if (r.closed_at != null) {
      out.push({
        ...base, at: String(r.closed_at),
        what: r.closed_as === 'done' ? `Finished: ${String(r.understood_as)}`
          : `Closed without doing it: ${String(r.understood_as)}`,
        detail: str(r.closed_because),
      });
    }
  }

  // ── BOUNDARIES ─────────────────────────────────────────────────────────────
  // A CANDIDATE STRUCK IS THE MOST IMPORTANT ROW HERE and the easiest to leave
  // out, because nothing happened. That is the point: the owner's exclusions
  // outrank score and recommendation, and the only way he can tell they are
  // being honoured is to see them refuse somebody. A boundary that never
  // visibly stops anything is indistinguishable from a boundary nobody wired up.
  for (const r of await rows(
    `SELECT r.id, r.counterparty_ref, r.review_reason, r.reviewed_at, r.experiment_id,
            (SELECT p.id FROM products p
              WHERE p.from_experiment_id = e.id AND p.deleted_at IS NULL
                AND ${realCompany('p')}) AS product_id,
            (SELECT p.name FROM products p
              WHERE p.from_experiment_id = e.id AND p.deleted_at IS NULL
                AND ${realCompany('p')}) AS name
       FROM experiment_recipients r
       JOIN venture_experiments e ON e.id = r.experiment_id
      WHERE r.founder_id = ? AND r.review_status = 'struck' AND r.reviewed_at IS NOT NULL
        AND e.evidence_mode = 'real'
      ORDER BY r.reviewed_at DESC LIMIT ?`, [founderId, limit])) {
    out.push({
      at: String(r.reviewed_at), kind: 'boundary', productId: str(r.product_id),
      companyName: str(r.name),
      what: `Nobody was written to at ${String(r.counterparty_ref)}`,
      detail: str(r.review_reason),
      href: `/foundry/experiments/${String(r.experiment_id)}/recipients`,
    });
  }

  // Newest first, and only as many as were asked for. Sorted here rather than
  // by the database because six ordered reads cannot be merged by SQLite
  // without a union that would have to repeat every predicate above.
  return out
    .sort((a, b) => (a.at < b.at ? 1 : a.at > b.at ? -1 : 0))
    .slice(0, limit);
}
