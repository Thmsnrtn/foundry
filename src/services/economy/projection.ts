// =============================================================================
// FOUNDRY — what the money actually means, read deterministically
//
// Plain functions over canonical rows. No model, no cache, no rounding that
// hides a difference. Cheap enough to run on the Home screen, which is the
// point: the owner should not have to open anything to find out whether the
// institution has money.
//
// EVERY FIGURE CARRIES ITS CLAIM QUALITY, because the directive forbids hiding
// uncertainty behind precision and because these are three different facts:
//
//   MEASURED     a provider said so, or it is arithmetic over things they said.
//                Zero measured is a real answer: no payout has ever landed.
//   ESTIMATED    worked out from an assumption the owner recorded, which is
//                named on the figure so he can disagree with it.
//   UNAVAILABLE  the institution does not know. Not zero. A contribution whose
//                provider fee was never read is unavailable, and showing it as
//                full margin would be the single most expensive lie this
//                surface could tell.
//
// REAL MONEY ONLY. Every query here is scoped to `evidence_mode = 'real'`. A
// sandbox charge is a rehearsal; it must never become surplus the owner is
// told he may take out.
//
// THE STRIPE ACCOUNT IS SHARED, SO "CASH" IS TWO DIFFERENT QUESTIONS.
//
// `docs/stripe-shared-account.md`: one live account serves the personal land
// sales, AcreOS and Foundry, and the land sales are "the only live money in the
// account". A charge is attributable — it carries an `app` tag. A PAYOUT IS
// NOT: it is a lump of the shared balance moving to a bank, mixed by
// construction. So:
//
//   HELD  what is ours inside the provider's balance — charges we made, less
//         what Stripe took, less what went back. Measured, and real.
//   BANKED  what has reached an account the owner can draw on. NOT KNOWN, and
//         not knowable from this account's payouts without telling him that
//         somebody else's money is his. He can record what he actually moves,
//         and then it is measured.
//
// Surplus is computed from HELD, and says so. That is the conservative reading:
// it treats money as available before it has cleared, so every deduction below
// is subtracted from the larger of the two numbers.
//
// THE REFUND PROMISE HAS NO TIME LIMIT, and that is not an oversight here.
// Apex Micro's refunds page says: "No form, no time limit, and you don't have
// to explain." So refund exposure does not decay — every delivered unit that
// has not been refunded stays a liability for as long as the promise stands.
// A window would make surplus look larger and would be a promise nobody made.
// Changing that means changing a public page, which is the owner's to do.
// =============================================================================

import { query, realCompany } from '../../db/client.js';
import { policyInForce, type Policy } from './ledger.js';

export type Quality = 'measured' | 'estimated' | 'unavailable';

export interface Figure {
  /** Cents, or null when unavailable. */
  cents: number | null;
  quality: Quality;
  /** What this figure is, and why it is the quality it is. */
  because: string;
}

const measured = (cents: number, because: string): Figure => ({ cents, quality: 'measured', because });
const unavailable = (because: string): Figure => ({ cents: null, quality: 'unavailable', because });

const sum = async (sql: string, args: unknown[]): Promise<number> => {
  const r = await query(sql, args);
  const row = r.rows[0] as Record<string, unknown> | undefined;
  return Number(row?.total ?? 0);
};

/** Total of one ledger kind, in real money. */
async function totalOf(founderId: string, kind: string): Promise<number> {
  return sum(
    `SELECT COALESCE(SUM(amount_cents), 0) AS total FROM economic_events
      WHERE founder_id = ? AND kind = ? AND evidence_mode = 'real'`, [founderId, kind]);
}

// ─── Cash ────────────────────────────────────────────────────────────────────

/**
 * What is ours inside the provider's balance: every charge tagged for this
 * institution, less what the provider took, less what went back.
 *
 * Measured from objects that carry an `app` tag, which is the only isolation a
 * shared Stripe account has. Zero here is a real answer.
 */
export async function moneyHeld(founderId: string): Promise<Figure> {
  const inflow = await sum(
    `SELECT COALESCE(SUM(e.amount_cents), 0) AS total FROM economic_events e
       JOIN economic_event_kinds k ON k.kind = e.kind
      WHERE e.founder_id = ? AND e.evidence_mode = 'real'
        AND k.direction = 'in' AND k.affects_cash = 0`, [founderId]);
  const outflow = await sum(
    `SELECT COALESCE(SUM(e.amount_cents), 0) AS total FROM economic_events e
       JOIN economic_event_kinds k ON k.kind = e.kind
      WHERE e.founder_id = ? AND e.evidence_mode = 'real'
        AND k.direction = 'out' AND k.affects_cash = 0`, [founderId]);
  const owner = await sum(
    `SELECT COALESCE(SUM(CASE WHEN kind = 'owner_contribution' THEN amount_cents
                              ELSE -amount_cents END), 0) AS total
       FROM economic_events
      WHERE founder_id = ? AND evidence_mode = 'real'
        AND kind IN ('owner_contribution','owner_distribution')`, [founderId]);
  const held = inflow - outflow + owner;
  return measured(held, held === 0
    ? 'Nobody has paid for anything, and the owner has neither put money in nor taken any out.'
    : "What buyers paid, less what Stripe took and what went back, plus or minus what the owner has moved himself.");
}

/**
 * WHAT HAS REACHED A BANK. NOT KNOWN, ON PURPOSE.
 *
 * The Stripe account is shared with the personal land sales and AcreOS, and a
 * payout mixes all three. Attributing one to this institution would report
 * somebody else's money as the owner's, which is the most expensive mistake
 * this surface could make. He can record what he actually moves — those are
 * `owner_distribution` and `owner_contribution` rows and they are measured.
 */
export async function moneyBanked(): Promise<Figure> {
  return unavailable(
    'The Stripe account is shared with the land sales and AcreOS, so a payout from it is not this '
    + "institution's money to claim. What has reached a bank is only what the owner records moving.");
}

/** Gross charged, before the provider took anything. */
export async function grossCharged(founderId: string): Promise<Figure> {
  const gross = await totalOf(founderId, 'charge');
  return measured(gross, gross === 0 ? 'Nobody has paid for anything yet.' : 'What buyers were charged.');
}

// ─── One unit ────────────────────────────────────────────────────────────────

export interface UnitContribution {
  fulfilmentId: string;
  charged: Figure;
  providerFee: Figure;
  unitCosts: Figure;
  refunded: Figure;
  contribution: Figure;
}

/**
 * Revenue of one thing sold, less the variable cost of selling it.
 *
 * Unavailable rather than optimistic: if the provider fee for this charge has
 * not been read, the contribution is not known, and the fee is the largest
 * single deduction on a $29 sale. Recording no fee row and subtracting nothing
 * would report the whole price as margin.
 */
export async function unitContribution(founderId: string, fulfilmentId: string): Promise<UnitContribution> {
  const one = async (kind: string): Promise<number> => sum(
    `SELECT COALESCE(SUM(amount_cents), 0) AS total FROM economic_events
      WHERE founder_id = ? AND fulfilment_id = ? AND kind = ? AND evidence_mode = 'real'`,
    [founderId, fulfilmentId, kind]);

  const f = await query(
    `SELECT amount_cents, status FROM experiment_fulfilments WHERE id = ?`, [fulfilmentId]);
  const row = f.rows[0] as Record<string, unknown> | undefined;
  const charged = row
    ? measured(Number(row.amount_cents), 'What this buyer was charged.')
    : unavailable('No fulfilment with that id.');

  // THE ROW'S OWN CLAIM ABOUT ITSELF DECIDES THIS, not the shape of the query.
  // `claim_quality` is on the row because a fee could one day be estimated —
  // from a published rate card, say — and a contribution built on an estimated
  // fee is an estimate. Reading the column rather than assuming 'measured' is
  // what keeps that true without anybody remembering it.
  const feeRows = await query(
    `SELECT COALESCE(SUM(amount_cents), 0) AS total, COUNT(*) AS n,
            SUM(CASE WHEN claim_quality = 'estimated' THEN 1 ELSE 0 END) AS estimated
       FROM economic_events
      WHERE founder_id = ? AND fulfilment_id = ? AND kind IN ('provider_fee','refund_fee_returned')
        AND evidence_mode = 'real'`, [founderId, fulfilmentId]);
  const feeRow = feeRows.rows[0] as Record<string, unknown> | undefined;
  const feeKnown = Number(feeRow?.n ?? 0) > 0;
  const feeEstimated = Number(feeRow?.estimated ?? 0) > 0;
  const providerFee: Figure = feeKnown
    ? {
      cents: Number(feeRow?.total ?? 0),
      quality: feeEstimated ? 'estimated' : 'measured',
      because: feeEstimated
        ? 'Worked out from an assumption, not from what the provider said.'
        : 'What the provider took, as the provider stated it.',
    }
    : unavailable('The provider has not told us what it took from this charge.');

  const costs = measured(await one('unit_cost'), 'What producing and delivering this cost.');
  const refunded = measured(await one('refund'), 'Returned to this buyer.');

  const contribution: Figure = (charged.cents === null || providerFee.cents === null)
    ? unavailable(charged.cents === null
      ? 'There is no such unit.'
      : 'Not known: the provider fee for this charge has not been read, and it is the largest deduction on a small sale.')
    : {
      cents: charged.cents - providerFee.cents - (costs.cents ?? 0) - (refunded.cents ?? 0),
      quality: providerFee.quality === 'estimated' ? 'estimated' : 'measured',
      because: 'What was charged, less the provider fee, what it cost to make and deliver, and anything returned.',
    };

  return { fulfilmentId, charged, providerFee, unitCosts: costs, refunded, contribution };
}

// ─── What is owed, and what could be asked back ──────────────────────────────

/**
 * Money taken for work not yet delivered. An obligation, not surplus: the
 * buyer has paid and is owed something.
 */
export async function obligationsOutstanding(founderId: string): Promise<Figure> {
  // The one predicate (venture/obligations.ts), less what was delivered and
  // is merely asked back — that is refund exposure, counted below.
  const { OPEN_OBLIGATION } = await import('../venture/obligations.js');
  const total = await sum(
    `SELECT COALESCE(SUM(f.amount_cents), 0) AS total FROM experiment_fulfilments f
      WHERE f.founder_id = ? AND ${OPEN_OBLIGATION('f')} AND f.status <> 'delivered'`, [founderId]);
  return measured(total, total === 0
    ? 'Nothing has been paid for that has not been delivered.'
    : 'Paid for and not yet delivered, or owed back.');
}

/**
 * What could be asked back tomorrow.
 *
 * Every delivered unit that has not already been refunded, with no decay,
 * because the refunds page promises no time limit. This is deliberately the
 * most conservative reading available: it is the number that keeps the promise
 * affordable.
 */
export async function refundExposure(founderId: string): Promise<Figure> {
  const total = await sum(
    `SELECT COALESCE(SUM(amount_cents), 0) AS total FROM experiment_fulfilments
      WHERE founder_id = ? AND status = 'delivered'`, [founderId]);
  return measured(total, total === 0
    ? 'Nothing delivered, so nothing can be asked back.'
    : 'Everything delivered and not refunded. The refunds page promises no time limit, so this does not decay.');
}

// ─── The estimate ────────────────────────────────────────────────────────────

export interface TaxReserve extends Figure { policy: Policy | null }

/**
 * WHAT TO HOLD BACK FOR TAX. AN ESTIMATE, AND IT SAYS SO.
 *
 * This is not a filing, not a return, not advice, and not a liability anybody
 * has assessed. It is the owner's own stated assumption applied to a measured
 * basis, so that money he may owe is not money he thinks he can take.
 *
 * With no assumption recorded, the answer is UNAVAILABLE rather than zero. An
 * institution that has not thought about tax has not decided that tax is zero,
 * and a default rate invented here would be exactly the fabricated precision
 * the directive forbids.
 */
export async function taxReserve(founderId: string): Promise<TaxReserve> {
  const policy = await policyInForce(founderId, 'tax_reserve');

  // A FRACTION OF NOTHING IS NOTHING, WHATEVER THE RATE.
  //
  // This used to answer "not known" whenever no assumption was recorded, which
  // made the whole subtraction unknown on an institution that has earned
  // nothing — and that is not an uncertainty, it is a zero. Any rate applied to
  // a basis of zero is zero, so the basis is read first and an absent
  // assumption only matters once there is something for it to apply to.
  const basisFigure = policy?.basis === 'gross_receipts'
    ? await grossCharged(founderId)
    : await totalContribution(founderId);
  if (basisFigure.cents === 0) {
    return {
      ...measured(0, 'Nothing has been earned, so nothing is owed on it. No assumption was needed to say that.'),
      policy: policy ?? null,
    };
  }

  if (!policy || policy.rateBps === null) {
    return {
      ...unavailable('Money has come in and no tax assumption has been recorded, so nothing is being held back — and nothing is being claimed about what is owed.'),
      policy: null,
    };
  }
  const basis = basisFigure.cents;
  if (basis === null) {
    return {
      ...unavailable('The basis this assumption applies to is not known, because at least one provider fee has not been read.'),
      policy,
    };
  }
  const cents = Math.round((basis * policy.rateBps) / 10000);
  return {
    cents,
    quality: 'estimated',
    because: `${(policy.rateBps / 100).toFixed(2)}% of ${policy.basis === 'gross_receipts' ? 'gross receipts' : 'contribution'}, an assumption recorded as: ${policy.source}`,
    policy,
  };
}

/** Contribution across every unit, unavailable if any single unit is. */
export async function totalContribution(founderId: string): Promise<Figure> {
  const f = await query(
    `SELECT id FROM experiment_fulfilments WHERE founder_id = ?`, [founderId]);
  if (f.rows.length === 0) return measured(0, 'Nothing has been sold.');
  let total = 0;
  const unknown: string[] = [];
  for (const row of f.rows) {
    const id = (row as Record<string, string>).id;
    const u = await unitContribution(founderId, id);
    if (u.contribution.cents === null) unknown.push(id);
    else total += u.contribution.cents;
  }
  if (unknown.length > 0) {
    return unavailable(
      `${unknown.length} of ${f.rows.length} sales have no provider fee recorded, so the total is not known.`);
  }
  return measured(total, 'Every sale, less what each one cost to sell.');
}

// ─── What the owner may actually take ────────────────────────────────────────

export interface Surplus {
  figure: Figure;
  /** What is ours in the provider's balance. Not a bank balance. */
  held: Figure;
  obligations: Figure;
  refundExposure: Figure;
  taxReserve: TaxReserve;
  operatingReserve: Figure;
  authorisedCapital: Figure;
  /** In one sentence, for the Home screen. */
  sentence: string;
}

/**
 * OWNER-DISTRIBUTABLE SURPLUS.
 *
 * Settled cash, less everything already spoken for: work paid for and not
 * delivered, what could be refunded, tax held back, the operating floor, and
 * capital the owner has already authorised the institution to spend.
 *
 * THIS IS NOT A BANK BALANCE AND NOT REVENUE. It is deliberately the smallest
 * defensible number, and it goes negative rather than pretending. A negative
 * surplus is a true and useful thing to be told: it means the institution is
 * holding money it has already promised elsewhere.
 */
export async function distributableSurplus(founderId: string): Promise<Surplus> {
  const held = await moneyHeld(founderId);
  const obligations = await obligationsOutstanding(founderId);
  const exposure = await refundExposure(founderId);
  const tax = await taxReserve(founderId);

  // AN UNSET FLOOR IS A ZERO, NOT AN UNKNOWN. The institution is keeping
  // nothing back; that is a fact about what it is doing, not an absence of
  // information. It is worth saying out loud, which is what the sentence does.
  const reservePolicy = await policyInForce(founderId, 'operating_reserve');
  const operatingReserve = reservePolicy && reservePolicy.amountCents !== null
    ? measured(reservePolicy.amountCents, `A floor the owner set: ${reservePolicy.source}`)
    : measured(0, 'No floor has been set, so nothing is being kept back to keep this running.');

  // STANDING DOES NOT APPLY HERE, AND THAT IS THE POINT. An allowance standing
  // against an EXPERIMENTAL asset is money the institution may spend today,
  // exactly as much as one against an earned company — the experiment is what
  // most of this owner's money is authorised for. Scoping this to operating
  // companies would report a surplus that is already committed.
  //
  // `realCompany` BECAUSE A REFERENCE COMPANY IS NOT A CLAIM ON HIS MONEY.
  // The institution keeps synthetic companies to rehearse against; an
  // allowance standing against one of those would quietly reduce the surplus
  // he is told is his, on the strength of a company that does not exist.
  const authorised = await sum(
    `SELECT COALESCE(SUM(a.amount_cents), 0) AS total FROM owner_allowances a
       JOIN products p ON p.id = a.product_id
      WHERE p.owner_id = ? AND ${realCompany('p')} AND a.withdrawn_at IS NULL
        AND (a.until IS NULL OR a.until > datetime('now'))`, [founderId]);
  const authorisedCapital = measured(authorised, authorised === 0
    ? 'No allowance is standing, so nothing is already authorised to be spent.'
    : 'Allowances the owner has left standing, which the institution may spend without asking.');

  const parts = [held, obligations, exposure, tax, operatingReserve, authorisedCapital];
  const missing = parts.filter((p) => p.cents === null);
  if (missing.length > 0) {
    const figure = unavailable(
      `Not known, and deliberately not guessed: ${missing.map((m) => m.because).join(' ')}`);
    return {
      figure, held, obligations, refundExposure: exposure, taxReserve: tax,
      operatingReserve, authorisedCapital,
      sentence: 'I cannot say what is yours to take, and I will not estimate it. '
        + missing.map((m) => m.because).join(' '),
    };
  }

  const cents = (held.cents ?? 0) - (obligations.cents ?? 0) - (exposure.cents ?? 0)
    - (tax.cents ?? 0) - (operatingReserve.cents ?? 0) - (authorisedCapital.cents ?? 0);
  const figure: Figure = {
    cents,
    // One estimate in the sum makes the sum an estimate. Saying "measured"
    // here would launder the tax assumption into a fact.
    quality: tax.quality === 'estimated' ? 'estimated' : 'measured',
    because: "What is ours in Stripe's balance, less what is owed, what could be refunded, tax held back, the operating floor, and capital already authorised.",
  };
  return {
    figure, held, obligations, refundExposure: exposure, taxReserve: tax,
    operatingReserve, authorisedCapital,
    sentence: sentenceFor(figure, held),
  };
}

function sentenceFor(figure: Figure, held: Figure): string {
  if ((held.cents ?? 0) === 0) {
    return 'Nobody has paid for anything yet, so there is nothing to take out. '
      + 'This is what would be shown when somebody has.';
  }
  if ((figure.cents ?? 0) <= 0) {
    return 'Nothing is yours to take yet — everything that has settled is already spoken for.';
  }
  return `${dollars(figure.cents ?? 0)} is yours to take, after everything already spoken for.`;
}

/** Cents as a person reads them. Never rounded to hide a difference. */
export function dollars(cents: number): string {
  const sign = cents < 0 ? '−' : '';
  const v = Math.abs(cents) / 100;
  return `${sign}$${v.toFixed(2)}`;
}

/** How a figure reads when it may not be known. */
export function figureText(f: Figure): string {
  if (f.cents === null) return 'not known';
  return f.quality === 'estimated' ? `${dollars(f.cents)} (estimated)` : dollars(f.cents);
}


// ─── The ledger, as it stands ────────────────────────────────────────────────

export interface LedgerEntry {
  id: string;
  kind: string;
  whatItIs: string;
  direction: 'in' | 'out';
  amountCents: number;
  currency: string;
  /** The source's clock, which is the order things actually happened in. */
  occurredAt: string;
  provider: string;
  providerRef: string;
  quality: 'measured' | 'estimated';
  /** The assumption behind it, when it rests on one. */
  assumption: string | null;
  /** The outcome event it came from, when it came from one. */
  fromEvent: string | null;
  because: string;
}

/**
 * EVERY ROW, IN THE ORDER THE WORLD PUT THEM IN.
 *
 * Ordered by `occurred_at` rather than by when we wrote it down: a webhook
 * delivered late is still a thing that happened when it happened, and a ledger
 * ordered by our own clock would tell a story about our uptime rather than
 * about the money.
 *
 * Each row carries what it claims to be and what stands behind it — the
 * assumption for an estimate, the provider's outcome event for a charge — so
 * the subtraction above can be walked back to statements somebody else made.
 */
export async function ledgerEntries(founderId: string, limit = 50): Promise<LedgerEntry[]> {
  const r = await query(
    `SELECT e.id, e.kind, k.what_it_is, k.direction, e.amount_cents, e.currency,
            e.occurred_at, e.provider, e.provider_ref, e.claim_quality, e.because,
            p.source AS assumption, b.provider_event_ref AS from_event
       FROM economic_events e
       JOIN economic_event_kinds k ON k.kind = e.kind
       LEFT JOIN economic_policies p ON p.id = e.policy_id
       LEFT JOIN business_outcome_events b ON b.id = e.source_event_id
      WHERE e.founder_id = ? AND e.evidence_mode = 'real'
      ORDER BY e.occurred_at DESC, e.recorded_at DESC
      LIMIT ?`, [founderId, limit]);
  return r.rows.map((raw) => {
    const row = raw as Record<string, unknown>;
    return {
      id: String(row.id),
      kind: String(row.kind),
      whatItIs: String(row.what_it_is),
      direction: String(row.direction) as 'in' | 'out',
      amountCents: Number(row.amount_cents),
      currency: String(row.currency),
      occurredAt: String(row.occurred_at),
      provider: String(row.provider),
      providerRef: String(row.provider_ref),
      quality: String(row.claim_quality) as 'measured' | 'estimated',
      assumption: row.assumption === null || row.assumption === undefined ? null : String(row.assumption),
      fromEvent: row.from_event === null || row.from_event === undefined ? null : String(row.from_event),
      because: String(row.because),
    };
  });
}


// ─── What running this has cost ──────────────────────────────────────────────

export interface RunningCost {
  total: Figure;
  /** The most recent lines, each with the receipt the provider gave. */
  recent: Array<{
    tool: string; capability: string | null; amountCents: number;
    source: 'reserved' | 'settled' | 'reversed'; providerRef: string | null; at: string;
  }>;
}

/**
 * WHAT THE INSTITUTION HAS SPENT ON ITSELF, from `asset_money_spent`.
 *
 * Not part of the subtraction above, and deliberately so: this money has
 * already left, from the owner's own pocket rather than from anything a buyer
 * paid. Subtracting it from surplus would count it twice the moment he records
 * having put money in. It is here because "what is mine" and "what has this
 * cost me" are the two halves of the same question, and only one of them was
 * ever on a screen.
 *
 * RESERVED IS NOT SETTLED. A reservation is money committed before the wire;
 * only `settled` carries the provider's own receipt (`provider_ref`), and only
 * settled rows are totalled. A reversal is money that came back.
 *
 * STANDING DOES NOT APPLY: money spent on an experimental asset is money spent.
 * Scoping this to earned companies would under-report what running this has
 * cost by exactly the amount spent on finding out whether anything works, which
 * is most of it.
 */
export async function runningCost(founderId: string): Promise<RunningCost> {
  const total = await sum(
    `SELECT COALESCE(SUM(s.amount_cents), 0) AS total FROM asset_money_spent s
       JOIN products p ON p.id = s.product_id
      WHERE p.owner_id = ? AND ${realCompany('p')} AND s.source = 'settled'`, [founderId]);
  const r = await query(
    `SELECT s.tool, s.capability, s.amount_cents, s.source, s.provider_ref, s.recorded_at
       FROM asset_money_spent s
       JOIN products p ON p.id = s.product_id
      WHERE p.owner_id = ? AND ${realCompany('p')}
      ORDER BY s.recorded_at DESC LIMIT 10`, [founderId]);
  return {
    total: measured(total, total === 0
      ? 'Nothing has been spent that a provider has billed for yet.'
      : 'Settled spend on tools and models, against what the owner allowed.'),
    recent: r.rows.map((raw) => {
      const row = raw as Record<string, unknown>;
      return {
        tool: String(row.tool),
        capability: row.capability === null || row.capability === undefined ? null : String(row.capability),
        amountCents: Number(row.amount_cents),
        source: String(row.source) as 'reserved' | 'settled' | 'reversed',
        providerRef: row.provider_ref === null || row.provider_ref === undefined ? null : String(row.provider_ref),
        at: String(row.recorded_at),
      };
    }),
  };
}
