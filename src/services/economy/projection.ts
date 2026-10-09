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
  // UNLIKE CURRENCIES DO NOT ADD UP, AND NOTHING STOPPED THEM.
  //
  // Every sum here is `SUM(amount_cents)` with no grouping, so a single order
  // in another currency would silently be added to dollars as though a euro
  // cent were a cent. Etsy sells in the buyer's currency; this is reachable
  // the first time somebody outside the United States buys.
  //
  // It is not converted, because converting needs a rate on a date and that is
  // a fact nothing here holds. It is refused: the figure becomes unavailable
  // and says what it found, which is a state the whole surface already knows
  // how to render and which `distributableSurplus` already propagates.
  const monies = await query(
    `SELECT DISTINCT currency FROM economic_events
      WHERE founder_id = ? AND evidence_mode = 'real'`, [founderId]);
  if (monies.rows.length > 1) {
    const names = (monies.rows as unknown as Array<Record<string, unknown>>)
      .map((r) => String(r.currency).toUpperCase()).sort().join(', ');
    return unavailable(
      `Money has come in in more than one currency (${names}), and I will not add `
      + 'them together as though they were the same money. What each is worth in the '
      + 'others needs a rate on a date, which nothing here holds.');
  }
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
  // A PAYMENT THE SALE LEDGER KNOWS AND THE MONEY LEDGER DOES NOT is said as
  // that, never as "nobody has paid": the sale is written from the intent
  // event, the charge row from the charge event, and they can arrive apart.
  const reported = await sum(
    `SELECT COUNT(*) AS total FROM experiment_fulfilments f JOIN business_outcome_events b ON b.id = f.payment_event_id
      WHERE f.founder_id = ? AND b.evidence_mode = 'real'`, [founderId]);
  // NOT "OURS IN STRIPE'S BALANCE", WHICH IS TWO THINGS WRONG.
  //
  // It is not a balance: nothing here has ever asked a provider what it is
  // holding. It is an accumulation of the events this institution has written
  // down, which is a different fact that can differ from the provider's own
  // figure by anything not yet read.
  //
  // And it is not Stripe's. The first real asset sells on Etsy, whose charges
  // and fees are written to this same ledger with `provider = 'etsy'`, and
  // were being summed under a sentence naming a company with no part in them.
  // The money's language has to be provider-neutral or it becomes false the
  // moment a second provider exists — which it now does.
  return measured(held, held === 0
    ? (reported > 0
      ? `${String(reported)} ${reported === 1 ? 'payment was' : 'payments were'} reported at a test's page, and the provider's own charge record for ${reported === 1 ? 'it' : 'them'} has not been read yet, so nothing is counted yet.`
      : 'Nobody has paid for anything, and the owner has neither put money in nor taken any out.')
    : 'What buyers were charged, less what the providers took and what went back, '
      + 'plus or minus what the owner has moved himself. This is what the records add '
      + 'up to, not a balance any provider has been asked for.');
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
    'No provider balance has been reconciled to a bank deposit here. The Stripe account is shared '
    + 'with the land sales and AcreOS, so a payout from it is not this institution\'s money to '
    + 'claim; a marketplace pays out on its own schedule and nothing has read one yet. What has '
    + 'reached a bank is only what the owner records moving.');
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
  /** The most that could be asked back. A ceiling, not a decision. */
  refundExposure: Figure;
  /**
   * WHAT IS ACTUALLY BEING HELD BACK AGAINST THAT, AND WHY IT IS THAT MUCH.
   *
   * These were one number and they are two facts. The maximum a buyer
   * population could ask back is arithmetic; how much of it an institution
   * keeps unspent is a choice its owner makes. Today the choice is all of it —
   * so the two are equal, and the surplus is the smaller for it.
   *
   * Equal is not the same as identical. Reporting only the exposure made a
   * deliberate policy look like an inevitability, which is exactly how a
   * decision stops being one: nobody can revisit a number they were never
   * shown was theirs to set. A $14 sale that nets $12.22 and reserves $14
   * reads as a loss-making sale, and it is not — it is a fully-backed sale.
   *
   * Nothing here proposes reducing it. A smaller reserve would leave more
   * distributable and would not shrink the promise by a cent: the refunds page
   * offers a refund with no form and no time limit, and that stands.
   */
  refundReserve: Figure;
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

  // THE QUESTION COMES BACK WHEN THERE IS SOMETHING TO MEASURE (PENDING 26):
  // hold all of it "until there is something to measure, and revisit it at the
  // first ten settled sales". Counted from the same fulfilment rows the
  // exposure is: a settled sale is one delivered or refunded.
  const settled = (await query(
    `SELECT COUNT(*) AS sales, COALESCE(SUM(CASE WHEN status = 'refunded' THEN 1 ELSE 0 END), 0) AS refunded
       FROM experiment_fulfilments WHERE founder_id = ? AND status IN ('delivered','refunded')`, [founderId]))
    .rows[0] as Record<string, unknown>;
  const sales = Number(settled.sales);
  const revisit = sales >= 10
    ? ` Ten sales have settled (${String(sales)} now), and ${String(Number(settled.refunded))} of ${String(sales)} `
      + `${Number(settled.refunded) === 1 ? 'was' : 'were'} refunded: this is when you said to revisit how much `
      + 'of the promise to hold in cash. Nothing changes until you do, and the choice is yours to decide.'
    : '';
  const refundReserve: Figure = exposure.cents === null ? exposure : {
    cents: exposure.cents,
    quality: exposure.quality,
    because: (exposure.cents === 0
      ? 'Nothing has been delivered, so nothing is being held back against a refund.'
      : 'All of what could be asked back is being held back. That is a policy choice and not '
        + 'arithmetic: holding less would leave more of this yours to take and would not change '
        + 'the promise, which is a refund with no form and no time limit.') + revisit,
  };

  const parts = [held, obligations, exposure, tax, operatingReserve, authorisedCapital];
  const missing = parts.filter((p) => p.cents === null);
  if (missing.length > 0) {
    const figure = unavailable(
      `Not known, and deliberately not guessed: ${missing.map((m) => m.because).join(' ')}`);
    return {
      figure, held, obligations, refundExposure: exposure, refundReserve, taxReserve: tax,
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
    because: 'What the records add up to, less what is owed, what could be asked back, tax held '
      + 'back, the operating floor, and capital already authorised.',
  };
  return {
    figure, held, obligations, refundExposure: exposure, refundReserve, taxReserve: tax,
    operatingReserve, authorisedCapital,
    sentence: surplusSentence(figure, held),
  };
}

/**
 * WHAT THE SUBTRACTION MAY CLAIM (Gate 1, case 11). This said "$X is yours to
 * take" of what the recorded events add up to, while `moneyBanked` — the only
 * figure here that would mean money in a bank — is permanently unavailable.
 * A charge, the provider's fee, a pending payout, a provider balance, a bank
 * deposit and a permitted distribution are different facts, and this sum is
 * only the first few of them. It says what it is: not spoken for, and not seen
 * in a bank. Nothing here is permission to move it.
 */
export function surplusSentence(figure: Figure, held: Figure): string {
  if ((held.cents ?? 0) === 0) {
    return 'Nobody has paid for anything yet, so there is nothing to take out. '
      + 'This is what would be shown when somebody has.';
  }
  if ((figure.cents ?? 0) <= 0) {
    return 'Nothing is yours to take yet — everything that has settled is already spoken for.';
  }
  return `${dollars(figure.cents ?? 0)} of recorded sales is not spoken for. That is what the ledger adds up to — `
    + 'not money seen in a bank: no payout or deposit has been reconciled here, so it is not yet something to withdraw.';
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


// ─── What Foundry costs to carry (Private S5) ────────────────────────────────

/** The bills the owner states, because Foundry cannot read them. */
export const COST_PROVIDERS = {
  fly: 'Fly (the machine and its volume)',
  cloudflare: 'Cloudflare (the Workshop, mail, and the copy away)',
  domains: 'Domains',
  clerk: 'Clerk (signing in)',
  etsy: 'Etsy (shop and listing fees beyond each sale)',
  github: 'GitHub',
  other: 'Anything else',
} as const;
export type CostProvider = keyof typeof COST_PROVIDERS;
export const isCostProvider = (v: unknown): v is CostProvider => typeof v === 'string' && v in COST_PROVIDERS;

export interface CarryingLine {
  what: string;
  /** A month's cents, or null when not known. Never zero by default. */
  cents: number | null;
  /** measured: read from Foundry's own records. stated: the owner's word, with its source. */
  kind: 'measured' | 'stated' | 'not_stated';
  because: string;
}

export interface CarryingCost {
  lines: CarryingLine[];
  /** The sum of what is known; a lower bound whenever a line is not. */
  total: Figure;
  notKnown: string[];
  ownerMinutes30d: number | null;
}

/**
 * WHAT FOUNDRY COSTS TO CARRY, A MONTH AT A TIME.
 *
 * The denominator of everything: the hold rule compares what an asset earns
 * with what it costs to keep, and nothing said what keeping Foundry costs.
 * Measured lines come from Foundry's own records over the last thirty days;
 * the rest are the owner's word with its source, and a line nobody has stated
 * is shown as not stated — the total then says "at least", because a sum that
 * treats an unknown bill as free is the specific lie this refuses to tell.
 */
export async function carryingCost(founderId: string): Promise<CarryingCost> {
  const lines: CarryingLine[] = [];
  // Read through the spend ledger, where the erasure promise about that table is kept.
  const { settledByModel } = await import('../ai/spend-ledger.js');
  const models = (await settledByModel(30)).reduce((a, m) => a + m.cents, 0);
  lines.push({ what: 'Thinking (models), last 30 days', cents: Math.round(models), kind: 'measured',
    because: 'settled model calls, from the spend ledger' });
  // STANDING DOES NOT APPLY, as in runningCost: money spent on an experimental
  // asset is money spent, and scoping to earned companies would hide most of
  // what carrying Foundry costs.
  const tools = Number(((await query(
    `SELECT COALESCE(SUM(s.amount_cents), 0) AS c FROM asset_money_spent s JOIN products p ON p.id = s.product_id
      WHERE p.owner_id = ? AND ${realCompany('p')} AND s.source = 'settled' AND s.recorded_at >= datetime('now', '-30 days')`, [founderId]))
    .rows[0] as Record<string, unknown>).c ?? 0);
  lines.push({ what: 'Tools Foundry paid for, last 30 days', cents: Math.round(tools), kind: 'measured',
    because: 'settled spend with the provider\'s receipt' });
  const stated = (await query(
    `SELECT provider, monthly_cents, source, said_at FROM foundry_cost_lines f
      WHERE founder_id = ? AND NOT EXISTS (
        SELECT 1 FROM foundry_cost_lines g WHERE g.founder_id = f.founder_id AND g.provider = f.provider
           AND (g.said_at > f.said_at OR (g.said_at = f.said_at AND g.rowid > f.rowid)))`, [founderId])).rows as Array<Record<string, unknown>>;
  const byProvider = new Map(stated.map((r) => [String(r.provider), r]));
  const notKnown: string[] = [];
  for (const [key, label] of Object.entries(COST_PROVIDERS)) {
    const r = byProvider.get(key);
    if (!r) {
      if (key === 'other' || key === 'github') continue; // said only when there is something to say
      notKnown.push(label);
      lines.push({ what: label, cents: null, kind: 'not_stated', because: 'not stated yet' });
      continue;
    }
    const cents = r.monthly_cents == null ? null : Number(r.monthly_cents);
    if (cents === null) notKnown.push(label);
    lines.push({ what: label, cents, kind: 'stated',
      because: `${cents === null ? 'you said it is not known yet' : 'your figure'}: ${String(r.source)} (${String(r.said_at).slice(0, 10)})` });
  }
  const known = lines.reduce((a, l) => a + (l.cents ?? 0), 0);
  const minutesRow = (await query(
    `SELECT COUNT(*) AS n, COALESCE(SUM(minutes), 0) AS m FROM owner_minutes
      WHERE founder_id = ? AND withdrawn_at IS NULL AND entered_at >= datetime('now', '-30 days')`, [founderId]))
    .rows[0] as Record<string, unknown>;
  return {
    lines,
    notKnown,
    ownerMinutes30d: Number(minutesRow.n ?? 0) === 0 ? null : Number(minutesRow.m ?? 0),
    total: notKnown.length === 0
      ? { cents: known, quality: stated.length ? 'estimated' : 'measured',
        because: stated.length ? 'measured spend plus the bills you stated' : 'measured spend only' }
      : { cents: known, quality: 'estimated',
        because: `at least this: ${String(notKnown.length)} ${notKnown.length === 1 ? 'bill is' : 'bills are'} not known (${notKnown.join('; ')})` },
  };
}

/** The owner states one month's bill for one provider, with where the number came from. */
export async function stateCostLine(founderId: string, provider: CostProvider, monthlyCents: number | null, source: string): Promise<void> {
  const words = source.trim().slice(0, 300);
  if (!words) throw new Error('a cost line says where the number came from');
  if (!isCostProvider(provider)) throw new Error('not a provider this reading knows');
  if (monthlyCents !== null && (!Number.isInteger(monthlyCents) || monthlyCents < 0 || monthlyCents > 10_000_000)) {
    throw new Error('not a monthly amount this reading accepts');
  }
  const { nanoid } = await import('nanoid');
  await query(
    `INSERT INTO foundry_cost_lines (id, founder_id, provider, monthly_cents, source, said_by) VALUES (?,?,?,?,?,?)`,
    [nanoid(), founderId, provider, monthlyCents, words, `founder:${founderId}`]);
}

// ─── What an hour is worth, and Foundry's own line (Roadmap 2027 R6) ─────────

export interface HourValue { lowCents: number; highCents: number; source: string; saidAt: string }

/** What the owner last said an hour of their own is worth, or null when they have not said. */
export async function hourValueOf(founderId: string): Promise<HourValue | null> {
  const r = (await query(
    `SELECT low_cents_per_hour, high_cents_per_hour, source, said_at FROM owner_hour_values
      WHERE founder_id = ? ORDER BY datetime(said_at) DESC, rowid DESC LIMIT 1`, [founderId])).rows[0] as Record<string, unknown> | undefined;
  return r ? { lowCents: Number(r.low_cents_per_hour), highCents: Number(r.high_cents_per_hour),
    source: String(r.source), saidAt: String(r.said_at) } : null;
}

/**
 * THE OWNER STATES WHAT AN HOUR IS WORTH, as a range, with where it came from.
 * STRATEGY S2 asks for λ to be derived from what the owner declines and
 * delegates. With no asset yet there is no behaviour to derive it from, so it
 * is asked once, as a range, and revised from behaviour when there is some.
 */
export async function stateHourValue(founderId: string, lowCents: number, highCents: number, source: string): Promise<void> {
  const words = source.trim().slice(0, 300);
  if (!words) throw new Error('an hour\'s worth says where the number came from');
  for (const c of [lowCents, highCents]) {
    if (!Number.isInteger(c) || c < 0 || c > 10_000_000) throw new Error('not an hourly amount this reading accepts');
  }
  if (lowCents > highCents) throw new Error('the low end of the range is above the high end');
  const { nanoid } = await import('nanoid');
  await query(
    `INSERT INTO owner_hour_values (id, founder_id, low_cents_per_hour, high_cents_per_hour, source, said_by) VALUES (?,?,?,?,?,?)`,
    [nanoid(), founderId, lowCents, highCents, words, `founder:${founderId}`]);
}

export interface FoundryLine {
  /** What Foundry costs to carry a month, from `carryingCost`. */
  carrying: Figure;
  /** Every minute the owner entered in the last 30 days: tests, assets, Foundry. */
  minutes30d: number | null;
  /** Those minutes at the owner's stated worth, low and high; null when either is not known. */
  attention: { lowCents: number; highCents: number } | null;
  /** Charges and returned fees, less fees, unit costs, refunds and disputes, over 30 days. */
  contribution30d: Figure;
  sentence: string;
  /**
   * THE FROZEN BASELINE (ROADMAP D7): the simpler way to run the same thing.
   * One listing on the venue and a spreadsheet costs only the venue's own fees,
   * which are already inside the contribution above. Foundry is worth its line
   * only when it earns or saves more than that line over the baseline.
   */
  baseline: string;
}

const IN_KINDS = ['charge', 'refund_fee_returned'];
const OUT_KINDS = ['provider_fee', 'unit_cost', 'refund', 'dispute_withdrawal', 'dispute_fee'];

/** FOUNDRY'S OWN MONTHLY LINE: what it costs, in money and in the owner's time, against what came in. */
export async function foundryLine(founderId: string): Promise<FoundryLine> {
  const carry = await carryingCost(founderId);
  const minutesRow = (await query(
    `SELECT COUNT(*) AS n, COALESCE(SUM(minutes), 0) AS m FROM owner_minutes
      WHERE founder_id = ? AND withdrawn_at IS NULL AND on_day >= date('now', '-30 days')`, [founderId]))
    .rows[0] as Record<string, unknown>;
  const minutes30d = Number(minutesRow.n ?? 0) === 0 ? null : Number(minutesRow.m ?? 0);
  const worth = await hourValueOf(founderId);
  const attention = minutes30d !== null && worth
    ? { lowCents: Math.round(minutes30d * worth.lowCents / 60), highCents: Math.round(minutes30d * worth.highCents / 60) }
    : null;

  const marks = (a: string[]): string => a.map(() => '?').join(',');
  const sums = (await query(
    `SELECT
       COALESCE(SUM(CASE WHEN kind IN (${marks(IN_KINDS)}) THEN amount_cents ELSE 0 END), 0) AS in_c,
       COALESCE(SUM(CASE WHEN kind IN (${marks(OUT_KINDS)}) THEN amount_cents ELSE 0 END), 0) AS out_c,
       COUNT(*) AS n
       FROM economic_events
      WHERE founder_id = ? AND evidence_mode = 'real' AND datetime(occurred_at) >= datetime('now', '-30 days')`,
    [...IN_KINDS, ...OUT_KINDS, founderId])).rows[0] as Record<string, unknown>;
  const contribution30d: Figure = Number(sums.n ?? 0) === 0
    ? { cents: 0, quality: 'measured', because: 'nothing was sold or returned in the last 30 days' }
    : { cents: Number(sums.in_c ?? 0) - Number(sums.out_c ?? 0), quality: 'measured',
      because: 'what buyers paid in the last 30 days, less what it cost to sell and what went back' };

  const carryText = `${carry.notKnown.length ? 'at least ' : ''}${carry.total.cents === null ? 'an unknown amount' : dollars(carry.total.cents)}`;
  const timeText = minutes30d === null ? 'your time, which is not entered'
    : attention === null ? `${String(minutes30d)} minutes of your time, which has no worth stated yet`
      : `${String(minutes30d)} minutes of your time, worth ${dollars(attention.lowCents)} to ${dollars(attention.highCents)}`;
  const sentence = `In the last 30 days Foundry cost ${carryText} to carry and ${timeText}; `
    + `what came in, after what it cost to sell, was ${dollars(contribution30d.cents ?? 0)}.`;
  const baseline = 'The simpler way to run this is one listing and a spreadsheet: it costs only the venue\'s own fees, '
    + 'which are already inside what came in. Foundry earns its line only when it brings in, or saves you, more than '
    + `${carryText} a month${attention ? ` plus ${dollars(attention.lowCents)} to ${dollars(attention.highCents)} of your time` : ''}.`;
  return { carrying: carry.total, minutes30d, attention, contribution30d, sentence, baseline };
}

// ─── What a decision cost to think about (Roadmap 2027 R8) ───────────────────

export interface CostPerDecision {
  /** Settled model spend over 30 days, in cents. */
  thinkingCents: number;
  /** Decisions the owner recorded over the same 30 days. */
  decisions: number;
  /** Thinking per decision, or null with no decision to divide by. */
  perDecisionCents: number | null;
  sentence: string;
}

/**
 * COST PER DECISION (OBJECTIVE §6: more nuanced = the same decision for less).
 * Thinking is what the spend ledger settled; a decision is something the owner
 * recorded: an act they decided, a test they decided on, a thing they told
 * the Mandate. It is a ratio across the institution, not a price on any one
 * decision, and it says so. With nothing decided it gives no number.
 */
export async function costPerDecision(founderId: string): Promise<CostPerDecision> {
  const { settledByModel } = await import('../ai/spend-ledger.js');
  const thinkingCents = Math.round((await settledByModel(30)).reduce((a, m) => a + m.cents, 0));
  const by = `founder:${founderId}`;
  const n = async (sql: string, args: unknown[]): Promise<number> =>
    Number(((await query(sql, args)).rows[0] as Record<string, unknown>).n ?? 0);
  const decisions =
    await n(`SELECT COUNT(*) AS n FROM proposed_acts WHERE decided_by = ? AND datetime(decided_at) >= datetime('now', '-30 days')`, [by])
    + await n(`SELECT COUNT(*) AS n FROM venture_experiments WHERE decided_by = ? AND datetime(decided_at) >= datetime('now', '-30 days')`, [by])
    + await n(`SELECT COUNT(*) AS n FROM mandate_statements WHERE founder_id = ? AND datetime(said_at) >= datetime('now', '-30 days')`, [founderId]);
  const perDecisionCents = decisions === 0 ? null : Math.round(thinkingCents / decisions);
  const sentence = decisions === 0
    ? `Thinking cost ${dollars(thinkingCents)} in the last 30 days, and you recorded no decision in that time, so there is no cost per decision to give.`
    : `Thinking cost ${dollars(thinkingCents)} in the last 30 days, across ${String(decisions)} ${decisions === 1 ? 'decision' : 'decisions'} you recorded: about ${dollars(perDecisionCents!)} each, as a ratio, not a price on any one.`;
  return { thinkingCents, decisions, perDecisionCents, sentence };
}

// ─── What each product costs to serve (F1, 9 October 2026) ───────────────────

export interface StreamCost {
  experimentId: string;
  name: string;
  /** Real charges less refunds and disputes, through this product's fulfilments. */
  revenue: Figure;
  /** What the provider took, less fees it returned. Not known when any charge has no fee row. */
  fees: Figure;
  /** Settled model spend whose purpose is this experiment. */
  thinking: Figure;
  /** The stated Fly bill split equally across active products: an estimate, or not stated. */
  hosting: Figure;
  /** Revenue less every known cost. Not known when the fees are not. */
  net: Figure;
}

export interface CostToServe {
  days: number;
  streams: StreamCost[];
  /** Thinking that served no one product: the search, and companies' own work. Never split across products. */
  unattributedThinking: Figure;
  sentence: string;
}

/**
 * EACH PRODUCT STREAM'S MODEL, HOSTING AND FEE COST AGAINST ITS REVENUE, over
 * the last `days` days. A stream is one experiment: one thing for sale. Every
 * figure is a sum of rows a provider or the spend ledger wrote, except hosting,
 * which is the owner's stated Fly bill split equally across the streams with
 * any activity and is labelled an estimate. An unread fee makes the stream's
 * fees and net NOT KNOWN rather than zero, as `unitContribution` does.
 */
export async function costToServe(founderId: string, days = 30): Promise<CostToServe> {
  const since = `-${String(days)} days`;
  const money = (await query(
    `SELECT f.experiment_id AS exp,
            COALESCE(SUM(CASE WHEN e.kind = 'charge' THEN e.amount_cents END), 0) AS charged,
            COALESCE(SUM(CASE WHEN e.kind IN ('refund','dispute_withdrawal') THEN e.amount_cents END), 0) AS returned,
            COALESCE(SUM(CASE WHEN e.kind IN ('provider_fee','dispute_fee') THEN e.amount_cents END), 0) AS fees,
            COALESCE(SUM(CASE WHEN e.kind = 'refund_fee_returned' THEN e.amount_cents END), 0) AS fees_back,
            -- PER CHARGE, not per fulfilment (F2 audit of F1): a fulfilment
            -- charged twice with one fee read does not have its fees known.
            COUNT(CASE WHEN e.kind = 'charge' THEN 1 END) AS charges,
            COUNT(CASE WHEN e.kind = 'provider_fee' THEN 1 END) AS fee_read
       FROM economic_events e JOIN experiment_fulfilments f ON f.id = e.fulfilment_id
      WHERE e.founder_id = ? AND e.evidence_mode = 'real' AND datetime(e.occurred_at) >= datetime('now', ?)
      GROUP BY f.experiment_id`, [founderId, since])).rows as Array<Record<string, unknown>>;
  // Read through the spend ledger, where the erasure promise about that table is kept.
  const { settledByExperiment } = await import('../ai/spend-ledger.js');
  const spent = await settledByExperiment(founderId, days);
  const elsewhere = spent.outside;
  const ids = [...new Set([...money.map((r) => String(r.exp)), ...spent.byExperiment.keys()])];
  const names = new Map<string, string>();
  if (ids.length) {
    const rows = (await query(`SELECT id, what_we_do FROM venture_experiments WHERE founder_id = ? AND id IN (${ids.map(() => '?').join(',')})`,
      [founderId, ...ids])).rows as Array<Record<string, unknown>>;
    for (const r of rows) names.set(String(r.id), String(r.what_we_do ?? r.id));
  }
  // HOSTING: the newest stated Fly line, for the window, split equally. An assumption, and said so.
  const fly = (await query(
    `SELECT monthly_cents, source FROM foundry_cost_lines WHERE founder_id = ? AND provider = 'fly'
      ORDER BY datetime(said_at) DESC, rowid DESC LIMIT 1`, [founderId])).rows[0] as Record<string, unknown> | undefined;
  const flyCents = fly?.monthly_cents == null ? null : Number(fly.monthly_cents);
  const known = ids.filter((id) => names.has(id));
  const hostingEach: Figure = flyCents === null || known.length === 0
    ? unavailable('hosting is not stated: tell Foundry what the Fly machine costs a month and it is split here')
    : { cents: Math.round((flyCents * days) / 30 / known.length), quality: 'estimated',
      because: `an estimate: the Fly bill you stated, for ${String(days)} days, split equally across ${String(known.length)} ${known.length === 1 ? 'product' : 'products'}` };
  const streams: StreamCost[] = known.map((id) => {
    const m = money.find((r) => String(r.exp) === id);
    const charges = Number(m?.charges ?? 0);
    const revenue = measured(Number(m?.charged ?? 0) - Number(m?.returned ?? 0),
      charges === 0 ? 'nothing was sold in the window' : 'what buyers paid, less refunds and disputes');
    const fees: Figure = Number(m?.fee_read ?? 0) < charges
      ? unavailable(`the provider has not said what it took from ${String(charges - Number(m?.fee_read ?? 0))} of ${String(charges)} charges`)
      : measured(Number(m?.fees ?? 0) - Number(m?.fees_back ?? 0), charges === 0 ? 'no charge, so no fee' : 'what the provider took, as it said');
    const thinking = measured(Math.round(spent.byExperiment.get(id) ?? 0), 'settled model spend for this product');
    const net: Figure = fees.cents === null
      ? unavailable('not known until every fee is read')
      : hostingEach.cents === null
        ? measured((revenue.cents ?? 0) - fees.cents - (thinking.cents ?? 0), 'revenue less fees and thinking; hosting is not stated, so it is not subtracted')
        : { cents: (revenue.cents ?? 0) - fees.cents - (thinking.cents ?? 0) - hostingEach.cents, quality: 'estimated',
          because: 'revenue less fees, thinking and an estimated share of hosting' };
    return { experimentId: id, name: names.get(id)!, revenue, fees, thinking, hosting: hostingEach, net };
  });
  const unattributedThinking = measured(Math.round(elsewhere), 'settled model spend whose purpose is no one product');
  const sentence = streams.length === 0
    ? `No product had a sale or thinking of its own in the last ${String(days)} days.`
    : `${String(streams.length)} ${streams.length === 1 ? 'product' : 'products'} in the last ${String(days)} days; thinking that served no one product cost ${dollars(unattributedThinking.cents ?? 0)} and is not split across them.`;
  return { days, streams, unattributedThinking, sentence };
}
