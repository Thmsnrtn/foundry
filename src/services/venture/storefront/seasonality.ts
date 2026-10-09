// =============================================================================
// FOUNDRY — its own seasons, recorded from the first month (F2).
//
// Printables are seasonal, and Foundry cannot know its own seasons until it has
// a year of its own. So two things, kept apart:
//
//   * THE VINTAGE RECORDER. Once a month, the month that just ended is recorded
//     in `demand_signals`: sales, refunds and net per channel, COUNTED from the
//     rows the ledgers hold (the Workshop's and Etsy's in the economic ledger,
//     Gumroad's and Lemon Squeezy's in channel_sales), real money apart from a
//     rehearsal's, once (a second pass is no change). Net is recorded only for
//     a channel whose every fee was stated. Visits are not recorded:
//     VISITS_NOT_RECORDED says why.
//
//   * SEASONAL PRIORS, until that year exists. Every one is an ASSUMPTION with
//     its reasoning, never presented as observed; `launchTiming` reads them
//     with the time search takes to send anybody (index lag and ranking, an
//     assumption too) and says when to list ahead of a peak.
// =============================================================================
import { nanoid } from 'nanoid';
import { query } from '../../../db/client.js';

export const VISITS_NOT_RECORDED = 'Visits are not recorded: the Workshop carries no tracking by design, and a marketplace reports lifetime views, not a month\'s.';

type Mode = 'real' | 'sandbox' | 'reference';

/** The calendar month that has most recently ended, as YYYY-MM. */
export function monthToRecord(now: Date): string {
  const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1));
  return `${String(d.getUTCFullYear())}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
}

/** Record one month's own demand per channel. Returns how many signals were new. */
export async function recordDemandSignals(founderId: string, month: string): Promise<{ recorded: number }> {
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) throw new Error(`${month} is not a month`);
  const from = `${month}-01`;
  const lines = new Map<string, { sales: number; refunds: number; gross: number; refunded: number; fees: number; feesKnown: boolean; feeRows: number }>();
  const line = (ch: string, mode: string) => {
    const k = `${ch}|${mode}`;
    let l = lines.get(k);
    if (!l) { l = { sales: 0, refunds: 0, gross: 0, refunded: 0, fees: 0, feesKnown: true, feeRows: 0 }; lines.set(k, l); }
    return l;
  };
  for (const r of (await query(
    `SELECT channel, kind, gross_cents, fee_cents, evidence_mode FROM channel_sales
      WHERE founder_id = ? AND datetime(occurred_at) >= datetime(?) AND datetime(occurred_at) < datetime(?, '+1 month')`,
    [founderId, from, from])).rows as Array<Record<string, unknown>>) {
    const l = line(String(r.channel), String(r.evidence_mode));
    if (String(r.kind) === 'sale') {
      l.sales += 1; l.gross += Number(r.gross_cents);
      if (r.fee_cents == null) l.feesKnown = false; else l.fees += Number(r.fee_cents);
    } else { l.refunds += 1; l.refunded += Number(r.gross_cents); }
  }
  for (const r of (await query(
    `SELECT provider, kind, amount_cents, evidence_mode FROM economic_events
      WHERE founder_id = ? AND provider IN ('stripe','etsy') AND kind IN ('charge','refund','dispute_withdrawal','provider_fee','refund_fee_returned','dispute_fee')
        AND datetime(occurred_at) >= datetime(?) AND datetime(occurred_at) < datetime(?, '+1 month')`,
    [founderId, from, from])).rows as Array<Record<string, unknown>>) {
    const l = line(String(r.provider) === 'etsy' ? 'etsy' : 'workshop', String(r.evidence_mode));
    const c = Number(r.amount_cents);
    switch (String(r.kind)) {
      case 'charge': l.sales += 1; l.gross += c; break;
      case 'refund': case 'dispute_withdrawal': l.refunds += 1; l.refunded += c; break;
      case 'provider_fee': l.fees += c; l.feeRows += 1; break;
      case 'dispute_fee': l.fees += c; break;
      case 'refund_fee_returned': l.fees -= c; break;
      default: break;
    }
  }
  let recorded = 0;
  const put = async (signal: string, channel: string, mode: string, value: number, source: string): Promise<void> => {
    const r = await query(
      `INSERT INTO demand_signals (id, founder_id, month, signal, theme, channel, value, source, evidence_mode)
       VALUES (?,?,?,?,'',?,?,?,?) ON CONFLICT(founder_id, month, signal, theme, channel, evidence_mode) DO NOTHING`,
      [nanoid(), founderId, month, signal, channel, value, source, mode as Mode]);
    recorded += Number(r.rowsAffected ?? 0);
  };
  for (const [k, l] of lines) {
    const [channel, mode] = k.split('|') as [string, string];
    const src = channel === 'workshop' || channel === 'etsy' ? 'the economic ledger' : 'channel_sales';
    await put('sales', channel, mode, l.sales, `counted from ${src}: sales in ${month}`);
    await put('refunds', channel, mode, l.refunds, `counted from ${src}: refunds in ${month}`);
    // Ledger channels: every charge needs its fee row; channel_sales: every sale states its fee.
    const known = (channel === 'workshop' || channel === 'etsy') ? l.feeRows >= l.sales : l.feesKnown;
    if (known) await put('net_cents', channel, mode, l.gross - l.refunded - l.fees, `counted from ${src}: paid, less refunds and stated fees, in ${month}`);
  }
  return { recorded };
}

// ─── Seasonal priors: assumptions until Foundry's own year exists ─────────────

export interface Prior { byMonth: readonly number[]; source: { kind: 'assumption'; why: string } }

/** Relative demand by month, January first, each averaging one. Every number an assumption, named so. */
export const SEASONAL_PRIORS: Readonly<Record<string, Prior>> = Object.freeze({
  planner: { byMonth: [1.8, 1.2, 0.9, 0.8, 0.8, 0.8, 0.8, 0.9, 1.0, 0.9, 0.9, 1.4],
    source: { kind: 'assumption', why: 'planners and organisers are bought for a fresh start: the new year most, the run-up in December; the shape is not observed by Foundry' } },
  tax: { byMonth: [1.6, 1.8, 1.7, 1.4, 0.8, 0.6, 0.6, 0.6, 0.7, 0.7, 0.7, 0.8],
    source: { kind: 'assumption', why: 'US tax organisers are wanted from January to the April filing deadline and little after; the shape is not observed by Foundry' } },
  school: { byMonth: [0.9, 0.8, 0.7, 0.7, 0.7, 0.8, 1.4, 1.9, 1.6, 0.9, 0.8, 0.8],
    source: { kind: 'assumption', why: 'back-to-school files are bought in July to September in the US; the shape is not observed by Foundry' } },
  home: { byMonth: [0.9, 0.9, 1.2, 1.3, 1.1, 0.9, 0.8, 0.8, 1.1, 1.2, 0.9, 0.9],
    source: { kind: 'assumption', why: 'household maintenance lists follow spring and autumn chores; the shape is not observed by Foundry' } },
  holiday: { byMonth: [0.6, 0.6, 0.6, 0.6, 0.6, 0.6, 0.6, 0.7, 0.9, 1.6, 2.4, 2.2],
    source: { kind: 'assumption', why: 'holiday planners and gift lists are bought in October to December; the shape is not observed by Foundry' } },
});

/** Days from listing until search sends anybody, plus the weeks a new page takes to rank: an assumption (the twin's index lag, 5–35 days, plus a month). */
export const LEAD_DAYS = 45;

/** When to list a file of this theme so its lead time is behind it by the next peak; null for an unknown theme. */
export function launchTiming(theme: string, today: Date): { peakMonth: number; listBy: string; because: string } | null {
  const p = SEASONAL_PRIORS[theme];
  if (!p) return null;
  const peakIdx = p.byMonth.indexOf(Math.max(...p.byMonth));
  let peak = new Date(Date.UTC(today.getUTCFullYear(), peakIdx, 1));
  if (peak.getTime() - LEAD_DAYS * 86_400_000 < today.getTime()) peak = new Date(Date.UTC(today.getUTCFullYear() + 1, peakIdx, 1));
  const listBy = new Date(peak.getTime() - LEAD_DAYS * 86_400_000);
  return {
    peakMonth: peakIdx + 1,
    listBy: `${String(listBy.getUTCFullYear())}-${String(listBy.getUTCMonth() + 1).padStart(2, '0')}`,
    because: `the ${theme} prior peaks in month ${String(peakIdx + 1)} (an assumption: ${p.source.why}), and search takes about ${String(LEAD_DAYS)} days to send anybody (an assumption)`,
  };
}
