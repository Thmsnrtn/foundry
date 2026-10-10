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

/**
 * Days after a month ends before it is recorded (F3 audit of F2): a channel
 * that could not be read on the 1st left the month short for good, because a
 * month is recorded once. Three days lets a missed read catch up. An assumption.
 */
export const SETTLE_DAYS = 3;

/** The most recent calendar month that ended at least SETTLE_DAYS ago, as YYYY-MM. */
export function monthToRecord(now: Date): string {
  const settled = new Date(now.getTime() - SETTLE_DAYS * 86_400_000);
  const d = new Date(Date.UTC(settled.getUTCFullYear(), settled.getUTCMonth() - 1, 1));
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
  // PER THEME (F3): each sale counted again under the theme its test's own
  // words name, so the forge can read Foundry's own season once a year exists.
  const themed = new Map<string, number>();
  for (const r of (await query(
    `SELECT x.mode, x.exp, e.what_we_do, o.headline FROM (
        SELECT evidence_mode AS mode, experiment_id AS exp FROM channel_sales
         WHERE founder_id = ? AND kind = 'sale' AND datetime(occurred_at) >= datetime(?) AND datetime(occurred_at) < datetime(?, '+1 month')
        UNION ALL
        SELECT ev.evidence_mode, f.experiment_id FROM economic_events ev JOIN experiment_fulfilments f ON f.id = ev.fulfilment_id
         WHERE ev.founder_id = ? AND ev.provider IN ('stripe','etsy') AND ev.kind = 'charge'
           AND datetime(ev.occurred_at) >= datetime(?) AND datetime(ev.occurred_at) < datetime(?, '+1 month')) x
       LEFT JOIN venture_experiments e ON e.id = x.exp
       LEFT JOIN venture_opportunities o ON o.id = e.opportunity_id`,
    [founderId, from, from, founderId, from, from])).rows as Array<Record<string, unknown>>) {
    const theme = themeOfWords(`${String(r.headline ?? '')} ${String(r.what_we_do ?? '')}`);
    if (!theme) continue;
    const k = `${theme}|${String(r.mode)}`;
    themed.set(k, (themed.get(k) ?? 0) + 1);
  }
  for (const [k, n] of themed) {
    const [theme, mode] = k.split('|') as [string, string];
    const r = await query(
      `INSERT INTO demand_signals (id, founder_id, month, signal, theme, channel, value, source, evidence_mode)
       VALUES (?,?,?,'sales',?,'',?,?,?) ON CONFLICT(founder_id, month, signal, theme, channel, evidence_mode) DO NOTHING`,
      [nanoid(), founderId, month, theme, n, `counted from both ledgers: sales in ${month} of tests whose own words name the ${theme} theme`, mode]);
    recorded += Number(r.rowsAffected ?? 0);
  }
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

// ─── The forge consults the seasons (F3; residue of F2) ──────────────────────
//
// A launch is timed against the season of what it sells. The theme is read
// from the candidate's own words (never asked of a model), and its shape is
// FOUNDRY'S OWN YEAR once twelve months of that theme's real sales are
// recorded; until then it is the prior, which is an assumption and says so.
// Nothing here holds a launch back: the order in which sealed designs are let
// in is the only thing it moves, so a design whose window is open now takes a
// free place in flight before one whose peak is most of a year away.

/** The words that put a candidate under a seasonal theme. First match wins, in this order. */
export const THEME_WORDS: ReadonlyArray<[keyof typeof SEASONAL_PRIORS, RegExp]> = [
  ['tax', /\b(tax|taxes|receipts?|deductions?|1099|w-?2)\b/i],
  ['holiday', /\b(holiday|christmas|thanksgiving|gift lists?|advent|hanukkah)\b/i],
  ['school', /\b(school|homework|teachers?|classroom|students?|semester)\b/i],
  ['planner', /\b(planner|planners|organi[sz]er|calendar|new year|goals?|weekly plan)\b/i],
  ['home', /\b(home maintenance|house|household|appliances?|chores?|cleaning|upkeep)\b/i],
];

/** The seasonal theme a text is about, or null. */
export function themeOfWords(text: string): keyof typeof SEASONAL_PRIORS | null {
  for (const [theme, re] of THEME_WORDS) if (re.test(text)) return theme;
  return null;
}

export interface Season {
  theme: string; peakMonth: number; listBy: string;
  /** 'own': Foundry's recorded year. 'assumption': the prior, until that year exists. */
  source: 'own' | 'assumption';
  because: string;
}

/** Twelve recorded months of a theme's real sales replace its prior. */
export const OWN_YEAR_MONTHS = 12;

/** The season of what a text sells, from Foundry's own year when it has one, else the labelled prior. */
export async function seasonFor(founderId: string, text: string, today: Date): Promise<Season | null> {
  const theme = themeOfWords(text);
  if (!theme) return null;
  const rows = (await query(
    `SELECT month, SUM(value) AS n FROM demand_signals
      WHERE founder_id = ? AND theme = ? AND signal = 'sales' AND evidence_mode = 'real'
      GROUP BY month ORDER BY month DESC LIMIT ?`, [founderId, theme, OWN_YEAR_MONTHS])).rows as Array<Record<string, unknown>>;
  if (rows.length >= OWN_YEAR_MONTHS && rows.some((r) => Number(r.n) > 0)) {
    const byMonth = Array.from({ length: 12 }, () => 0);
    for (const r of rows) byMonth[Number(String(r.month).slice(5, 7)) - 1] += Number(r.n);
    const t = timingOf(byMonth, today);
    return { theme, ...t, source: 'own', because: `Foundry's own ${theme} sales peaked in month ${String(t.peakMonth)} over the last ${String(OWN_YEAR_MONTHS)} recorded months, and search takes about ${String(LEAD_DAYS)} days to send anybody (an assumption)` };
  }
  const t = launchTiming(theme, today)!;
  return { theme, peakMonth: t.peakMonth, listBy: t.listBy, source: 'assumption', because: t.because };
}

function timingOf(byMonth: readonly number[], today: Date): { peakMonth: number; listBy: string } {
  const peakIdx = byMonth.indexOf(Math.max(...byMonth));
  let peak = new Date(Date.UTC(today.getUTCFullYear(), peakIdx, 1));
  if (peak.getTime() - LEAD_DAYS * 86_400_000 < today.getTime()) peak = new Date(Date.UTC(today.getUTCFullYear() + 1, peakIdx, 1));
  const listBy = new Date(peak.getTime() - LEAD_DAYS * 86_400_000);
  return { peakMonth: peakIdx + 1, listBy: `${String(listBy.getUTCFullYear())}-${String(listBy.getUTCMonth() + 1).padStart(2, '0')}` };
}

/** A launch whose list-by month is this close is in its window: let in first. An assumption. */
export const WINDOW_DAYS = 60;

/**
 * THE ORDER THE FORGE LETS SEALED DESIGNS IN: those whose season's window is
 * open now (list-by within WINDOW_DAYS), soonest first; then everything else
 * in the order it was sealed. Each carries the sentence of what was read.
 */
export async function launchOrder(founderId: string, designs: ReadonlyArray<{ id: string; text: string }>, today: Date): Promise<Array<{ id: string; season: Season | null; sentence: string }>> {
  const read = await Promise.all(designs.map(async (d, i) => {
    const season = await seasonFor(founderId, d.text, today);
    const listBy = season ? Date.parse(`${season.listBy}-01T00:00:00Z`) : NaN;
    const days = Number.isFinite(listBy) ? (listBy - today.getTime()) / 86_400_000 : Infinity;
    const open = days <= WINDOW_DAYS;
    return { id: d.id, season, i, key: open ? days : Infinity,
      sentence: season === null ? 'no season read from its words; let in in the order it was sealed'
        : `${season.theme}: list by ${season.listBy} for its peak in month ${String(season.peakMonth)} (${season.source === 'own' ? 'Foundry\'s own year' : 'a prior, an assumption'})${open ? '; its window is open, so it goes first' : ''}` };
  }));
  return read.sort((a, b) => a.key - b.key || a.i - b.i).map(({ id, season, sentence }) => ({ id, season, sentence }));
}
