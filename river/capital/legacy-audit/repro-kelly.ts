// Reproduces two kalshi-genius defects against its own source, at master
// a9625d5b6a526b5a0c2a9df55d665cd7595156a9. Run with Bun from a checkout:
//
//   KG=/path/to/kalshi-genius; DB_PATH=:memory: bun run repro-kelly.ts
//
// Observed 29 September 2026 (Bun 1.3.14):
//   {"pWin":0.5,"edge_passed":1,"raw_kelly":1.94,"bet_size_usd":30,"gross_ev_per_contract":0}
//   {"pWin":0.53,"edge_passed":1,"raw_kelly":1.94,"bet_size_usd":30,"gross_ev_per_contract":0.03}
//   {"pWin":0.7,"edge_passed":1,"raw_kelly":1.94,"bet_size_usd":30,"gross_ev_per_contract":0.2}
//   {"rose_compares_up":false,"fell_compares_up":false}
const KG = process.env.KG ?? '../kalshi-genius';
const { aggressiveKelly } = await import(`${KG}/src/core/aggressive_kelly.ts`);
const price = 0.50;
const potential_return_pct = (1 - price) / price; // kalshi_strategies.ts:246
for (const pWin of [0.50, 0.53, 0.70]) {
  // index.ts:713 passes potential_return_pct as `edge`; the forecast pWin never enters.
  const r = aggressiveKelly({ edge: potential_return_pct, price, bankroll: 100, strategy: 'hourly_sniper', confidence: 0.6, calibration_factor: 1 });
  console.log(JSON.stringify({ pWin, edge_passed: potential_return_pct, raw_kelly: +r.raw_kelly.toFixed(4), bet_size_usd: +r.bet_size_usd.toFixed(2), gross_ev_per_contract: +(pWin - price).toFixed(2) }));
}
// index.ts:1552-1553 compares two PriceSnapshot objects.
const entry = { symbol: 'BTCUSDT', price: 100 }; const up = { symbol: 'BTCUSDT', price: 101 }; const down = { symbol: 'BTCUSDT', price: 99 };
console.log(JSON.stringify({ rose_compares_up: (up as any) > (entry as any), fell_compares_up: (down as any) > (entry as any) }));
