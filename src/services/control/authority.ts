// =============================================================================
// FOUNDRY — what Foundry may do, per area, explained in one reading.
//
// INSTITUTION_MODEL §6.1 (30 September 2026). The owner asked for one place
// that says, per area, whether Foundry may act and why, and how to change
// it. That answer lived in five places — the boundaries the doors read, the
// spending ceiling, the Workshop's pause on new activity, the fact that no
// order path exists — and no page composed them.
//
// IT EXPLAINS; IT DOES NOT ENFORCE. The doors stay the enforcers. This reads
// the same rows with the same query the doors read, and never calls the door
// itself: `boundaryStandingInTheWay` spends a one-time approval when it lets
// something through, and a reading that consumed approvals would change what
// it describes. A test holds this reader and the doors to the same answer on
// the same rows (effective-authority-agrees-with-the-doors), so the two can
// never quietly disagree about the owner's own rules. "Asks you first" for
// contacting people with no rule set is a different door's fact — a message
// reaches a person only through an approved test's act (kill-switch.ts) — and
// is said as that, not as a rule.
// =============================================================================

import { query } from '../../db/client.js';

type Row = Record<string, unknown>;

export type AuthorityDomain = 'research' | 'spending' | 'customer_contact' | 'financial_assets';
export type Verdict = 'allowed' | 'within_limit' | 'needs_approval' | 'prohibited' | 'unavailable';

export const DOMAIN_WORDS: Record<AuthorityDomain, string> = {
  research: 'Research', spending: 'Spending', customer_contact: 'Contacting people', financial_assets: 'Trading',
};
export const VERDICT_WORDS: Record<Verdict, string> = {
  allowed: 'Allowed', within_limit: 'Within limits', needs_approval: 'Asks you first', prohibited: 'Not allowed', unavailable: 'Does not exist',
};

export interface AuthorityReading {
  domain: AuthorityDomain;
  verdict: Verdict;
  /** Each limit that applies, in the owner's words, with where it came from. */
  because: string[];
  /** How the owner could change it, if they wanted to. */
  resolveBy: string[];
  /** The owner's own rule that a door refuses on, when one stands: the part a door-level test can hold to the door. */
  rule: { statement: string; mode: 'never' | 'ask_first' } | null;
}

/** The door each area is refused at, when an owner boundary names it. */
const DOOR: Partial<Record<AuthorityDomain, 'outbound' | 'spend'>> = { spending: 'spend', customer_contact: 'outbound' };

/**
 * THE BOUNDARY THAT STANDS, read with the doors' own query and nothing
 * consumed. At the outbound door only `contact_people` binds a person-reaching
 * act, exactly as the door applies it to `send_email`.
 */
async function boundaryOf(door: 'outbound' | 'spend', productId: string | null): Promise<{ statement: string; mode: string } | null> {
  const rows = (await query(
    `SELECT b.subject, b.statement, b.mode
       FROM owner_boundaries b
       JOIN owner_boundary_subjects s ON s.subject = b.subject
      WHERE b.lifted_at IS NULL AND s.door = ?
        AND (b.product_id IS NULL OR b.product_id = ?)
      ORDER BY s.sort_order, b.rowid`, [door, productId])).rows as unknown as Row[];
  const first = rows[0];
  return first ? { statement: String(first.statement), mode: String(first.mode) } : null;
}

const money = (cents: number): string => `$${(cents / 100).toFixed(2)}`;

/** WHAT FOUNDRY MAY DO IN ONE AREA, AND WHY. Reads only; changes nothing. */
export async function effectiveAuthority(founderId: string, input: { domain: AuthorityDomain; productId?: string | null }): Promise<AuthorityReading> {
  const productId = input.productId ?? null;
  if (productId) {
    const mine = (await query(`SELECT id FROM products WHERE id = ? AND owner_id = ? AND deleted_at IS NULL`, [productId, founderId])).rows[0];
    if (!mine) return { domain: input.domain, verdict: 'unavailable', because: ['That is not one of your companies.'], resolveBy: [], rule: null };
  }
  const d = input.domain;
  if (d === 'research') {
    return { domain: d, verdict: 'allowed', because: ['Reading public sources changes nothing outside Foundry.'], resolveBy: [], rule: null };
  }
  if (d === 'financial_assets') {
    return { domain: d, verdict: 'unavailable',
      because: ['There is no way for Foundry to place an order: live trading does not exist here.', 'Trading research runs as a simulation, with no money at risk.'],
      resolveBy: [], rule: null };
  }
  const door = DOOR[d]!;
  const said = await boundaryOf(door, productId);
  if (said?.mode === 'never') {
    return { domain: d, verdict: 'prohibited', because: [`You said: “${said.statement}”.`], resolveBy: ['Lift that rule on Control'],
      rule: { statement: said.statement, mode: 'never' } };
  }
  if (said?.mode === 'ask_first') {
    return { domain: d, verdict: 'needs_approval', because: [`You said: “${said.statement}”.`], resolveBy: ['Approve it once when asked', 'Lift that rule on Control'],
      rule: { statement: said.statement, mode: 'ask_first' } };
  }
  if (d === 'spending') {
    const { thinkingCapFor } = await import('../institution/spending.js');
    const cap = await thinkingCapFor(founderId);
    const because = [`Thinking stops at ${money(cap)} a day.`];
    if (productId) {
      const { allowanceFor } = await import('../institution/standing-intent.js');
      const a = await allowanceFor(productId);
      because.push(a ? `Spending on this company is held to the allowance you set.` : 'No allowance is set for this company, so any spend on it waits for you.');
    }
    return { domain: d, verdict: 'within_limit', because, resolveBy: ['Change the charter or an allowance'], rule: null };
  }
  // CONTACTING PEOPLE: the pause on anything new going out, then the rule
  // that a message reaches a person only through a test or an act the owner
  // approved.
  const w = (await query(`SELECT economic_pause_at, economic_pause_reason FROM public_workshop WHERE founder_id = ?`, [founderId])).rows[0] as Row | undefined;
  if (w && w.economic_pause_at != null) {
    return { domain: d, verdict: 'prohibited', because: [`Anything new going out is paused: ${String(w.economic_pause_reason ?? 'you paused it')}.`],
      resolveBy: ['Resume it on the Workshop'], rule: null };
  }
  return { domain: d, verdict: 'needs_approval', because: ['A message reaches a person only through a test you approved, or an act you approved.'],
    resolveBy: ['Approve a test, or sign a charter that covers it'], rule: null };
}

/** Every area, for Control's one table. */
export async function authorityTable(founderId: string, productId: string | null = null): Promise<AuthorityReading[]> {
  const out: AuthorityReading[] = [];
  for (const domain of ['research', 'spending', 'customer_contact', 'financial_assets'] as AuthorityDomain[]) {
    out.push(await effectiveAuthority(founderId, { domain, productId }));
  }
  return out;
}
