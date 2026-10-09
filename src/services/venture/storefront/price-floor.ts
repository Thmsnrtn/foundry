// =============================================================================
// FOUNDRY — the lowest price a product may carry, against each channel's fees
// (FQ, 9 October 2026; PENDING 44).
//
// What each channel leaves of a price is read from its published schedule
// (fee-floor.ts: dated, cited; a range where the schedule names a surcharge
// that may apply). The FLOOR is a pricing decision, and pricing is his: it is
// read from his own `price_floor` row, signed founder:<id> — the guard of
// migration 277 refuses any other signature — and:
//   * with no row, every channel listing is refused, saying so;
//   * a floor in dollars refuses a price below it;
//   * a floor as the share fees may take is judged at the TOP of the channel's
//     range, because a range the buyer decides cannot be assumed kind;
//   * a rule for one channel overrides his rule for all.
// =============================================================================
import { query } from '../../../db/client.js';
import { FEE_CARDS, feeRangeCents } from '../fee-floor.js';
import { CHANNELS, CHANNEL_NAMES, FEE_VENUE, type Channel } from './channels.js';

export interface FloorRule { minCents?: number; maxFeeShare?: number }
export interface PriceFloor extends FloorRule { channels?: Partial<Record<Channel, FloorRule>> }

export interface Net { lowCents: number | null; highCents: number | null; because: string }

const dollars = (c: number): string => `$${(c / 100).toFixed(2)}`;

/** What one channel leaves of a price, per its published schedule; "not known" without one. */
export function netFor(channel: Channel, priceCents: number): Net {
  const venue = FEE_VENUE[channel];
  if (!venue || !(venue in FEE_CARDS)) return { lowCents: null, highCents: null, because: 'not known: no published fee schedule is held for this channel' };
  const card = FEE_CARDS[venue];
  const fee = feeRangeCents(venue, priceCents);
  const maybe = card.maybe.map((m) => m.when).join('; ');
  return {
    lowCents: priceCents - fee.high, highCents: priceCents - fee.low,
    because: `${card.name}'s published schedule (${card.source}, read ${card.readOn})${maybe ? `; the lower figure ${maybe}` : ''}`,
  };
}

/** Every channel's net on one price. */
export function netByChannel(priceCents: number): Record<Channel, Net> {
  return Object.fromEntries(CHANNELS.map((c) => [c, netFor(c, priceCents)])) as Record<Channel, Net>;
}

/** The line a listing shows: what each channel leaves, a range where the schedule leaves one. */
export function netLine(priceCents: number): string {
  const parts = CHANNELS.map((c) => {
    const n = netFor(c, priceCents);
    const v = n.lowCents === null || n.highCents === null ? 'not known'
      : n.lowCents === n.highCents ? dollars(n.lowCents) : `${dollars(n.lowCents)}–${dollars(n.highCents)}`;
    return `${CHANNEL_NAMES[c]}: ${v}`;
  });
  return `After fees, of ${dollars(priceCents)}: ${parts.join(' · ')}`;
}

/** His floor, from his own live row only; null when he has not set one. */
export async function priceFloorOf(founderId: string): Promise<{ floor: PriceFloor; on: string } | null> {
  const row = (await query(
    `SELECT value, set_at, set_by FROM origination_policy
      WHERE founder_id = ? AND requirement = 'price_floor' AND superseded_at IS NULL
      ORDER BY set_at DESC, rowid DESC LIMIT 1`, [founderId])).rows[0] as Record<string, unknown> | undefined;
  if (!row || !String(row.set_by ?? '').startsWith('founder:')) return null;
  try {
    const floor = JSON.parse(String(row.value ?? 'null')) as PriceFloor | null;
    return floor && problemsOf(floor).length === 0 ? { floor, on: String(row.set_at).slice(0, 10) } : null;
  } catch { return null; }
}

function ruleProblems(r: FloorRule | undefined, where: string): string[] {
  if (!r) return [];
  const out: string[] = [];
  if (r.minCents !== undefined && !(Number.isInteger(r.minCents) && r.minCents >= 0)) out.push(`${where}: a floor in dollars must be a whole number of cents, zero or more`);
  if (r.maxFeeShare !== undefined && !(Number.isFinite(r.maxFeeShare) && r.maxFeeShare > 0 && r.maxFeeShare < 1)) out.push(`${where}: the share fees may take must be between 0 and 1`);
  return out;
}

function problemsOf(f: PriceFloor): string[] {
  const out = ruleProblems(f, 'every channel');
  for (const [c, r] of Object.entries(f.channels ?? {})) {
    if (!CHANNELS.includes(c as Channel)) out.push(`${c} is not a channel`);
    out.push(...ruleProblems(r, c));
  }
  const any = (r?: FloorRule): boolean => r?.minCents !== undefined || r?.maxFeeShare !== undefined;
  if (!any(f) && !Object.values(f.channels ?? {}).some(any)) out.push('a floor needs a price or a share for at least one channel');
  return out;
}

/** Set his floor. His act: the guard refuses any signature but founder:<id>. */
export async function setPriceFloor(founderId: string, floor: PriceFloor, why: string, by: string): Promise<{ id: string } | { refused: string }> {
  const problems = problemsOf(floor);
  if (problems.length) return { refused: problems.join('; ') };
  const { supersedeOriginationPolicy } = await import('../legal-surface.js');
  return supersedeOriginationPolicy({ founderId, requirement: 'price_floor', treatment: 'policy', value: JSON.stringify(floor), why, by });
}

/** May this price be listed on this channel, under his floor? Refuses outright with no floor. */
export async function priceMeetsFloor(founderId: string, channel: Channel, priceCents: number): Promise<{ ok: true; because: string } | { ok: false; because: string }> {
  const his = await priceFloorOf(founderId);
  if (!his) return { ok: false, because: 'you have not set a lowest price against fees yet, so nothing is listed on a channel until you do (PENDING 44)' };
  const rule: FloorRule = { ...his.floor, ...(his.floor.channels?.[channel] ?? {}) };
  const name = CHANNEL_NAMES[channel];
  if (rule.minCents !== undefined && priceCents < rule.minCents) {
    return { ok: false, because: `${dollars(priceCents)} is under the lowest price you set for ${name}, ${dollars(rule.minCents)} (on ${his.on})` };
  }
  if (rule.maxFeeShare !== undefined) {
    const n = netFor(channel, priceCents);
    if (n.lowCents === null) return { ok: false, because: `${name}'s fees are not known, so they cannot be held to the share you set` };
    const share = (priceCents - n.lowCents) / priceCents;
    if (share > rule.maxFeeShare) {
      return { ok: false, because: `${name}'s fees could take ${dollars(priceCents - n.lowCents)} of ${dollars(priceCents)} (${(share * 100).toFixed(1)}%), more than the ${(rule.maxFeeShare * 100).toFixed(0)}% you set (on ${his.on})` };
    }
  }
  return { ok: true, because: `within the floor you set on ${his.on}` };
}
