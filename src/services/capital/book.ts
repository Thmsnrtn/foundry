// =============================================================================
// FOUNDRY — an event contract's order book, read as the venue publishes it.
//
// Kalshi's book lists BIDS only, for YES and for NO, each sorted from the
// lowest price up (observed 29 September 2026, tests/fixtures/kalshi). A YES
// ask is therefore one dollar less a NO bid, and buying YES means taking the
// NO bids from the highest down. The legacy Apex adapter read NO levels as YES
// asks directly; the legacy market-data readers priced from `last_price` or a
// mid of 0.5. Nothing here invents a price the book did not show.
//
// A simulated fill walks the displayed levels at one instant: no queue, no
// latency, no market impact, and never more contracts than were displayed.
// That is the optimistic bound, and every surface that shows it says so.
// =============================================================================

/** One price level: price in dollars (0–1), size in contracts. */
export interface Level { price: number; size: number }

export interface Book {
  /** Bids to buy YES, best (highest) first. */
  yesBids: Level[];
  /** Bids to buy NO, best (highest) first. */
  noBids: Level[];
}

const num = (v: unknown): number | null => {
  const n = typeof v === 'number' ? v : typeof v === 'string' && v.trim() !== '' ? Number(v) : NaN;
  return Number.isFinite(n) ? n : null;
};

/**
 * The venue's `orderbook_fp` as levels, best first. A level whose price or
 * size cannot be read is dropped, never guessed; a missing side is empty.
 */
export function parseBook(raw: unknown): Book {
  const ob = (raw && typeof raw === 'object' && 'orderbook_fp' in raw
    ? (raw as { orderbook_fp: unknown }).orderbook_fp : raw) as Record<string, unknown> | null;
  const side = (key: string): Level[] => {
    const rows = ob && Array.isArray(ob[key]) ? ob[key] as unknown[] : [];
    return rows.flatMap((r) => {
      if (!Array.isArray(r)) return [];
      const price = num(r[0]); const size = num(r[1]);
      return price !== null && size !== null && price > 0 && price < 1 && size > 0 ? [{ price, size }] : [];
    }).sort((a, b) => b.price - a.price);
  };
  return { yesBids: side('yes_dollars'), noBids: side('no_dollars') };
}

const round4 = (x: number): number => Math.round(x * 10_000) / 10_000;

/** The best YES bid and the YES ask derived from the best NO bid; null when that side is empty. */
export function topOfBook(b: Book): { yesBid: number | null; yesAsk: number | null; noBid: number | null; noAsk: number | null } {
  const yesBid = b.yesBids[0]?.price ?? null;
  const noBid = b.noBids[0]?.price ?? null;
  return {
    yesBid, noBid,
    yesAsk: noBid === null ? null : round4(1 - noBid),
    noAsk: yesBid === null ? null : round4(1 - yesBid),
  };
}

/**
 * The market's own probability of YES: the midpoint of the executable YES
 * bid and ask. Null when either side is empty — an empty side is not 0 or 1.
 */
export function marketImpliedYes(b: Book): number | null {
  const t = topOfBook(b);
  return t.yesBid === null || t.yesAsk === null ? null : round4((t.yesBid + t.yesAsk) / 2);
}

/** Ask levels for buying one side, best (cheapest) first. */
export function askLevels(b: Book, side: 'yes' | 'no'): Level[] {
  const opposite = side === 'yes' ? b.noBids : b.yesBids;
  return opposite.map((l) => ({ price: round4(1 - l.price), size: l.size }));
}

export interface SimulatedTake {
  side: 'yes' | 'no';
  requested: number;
  /** Whole contracts only: the displayed size is a ceiling, never rounded up. */
  filled: number;
  /** Sum of price × contracts over the levels taken, in dollars. */
  cost: number;
  /** Per level, what was taken, so the fee can be computed as the venue would. */
  taken: Level[];
}

/** Take up to `requested` whole contracts from the displayed asks, cheapest first. */
export function simulateTake(b: Book, side: 'yes' | 'no', requested: number): SimulatedTake {
  if (!Number.isInteger(requested) || requested <= 0) throw new Error('capital/book: requested contracts must be a whole number above zero');
  let left = requested; let cost = 0; const taken: Level[] = [];
  for (const l of askLevels(b, side)) {
    if (left === 0) break;
    const n = Math.min(left, Math.floor(l.size));
    if (n <= 0) continue;
    taken.push({ price: l.price, size: n });
    cost += n * l.price; left -= n;
  }
  return { side, requested, filled: requested - left, cost: round4(cost), taken };
}
