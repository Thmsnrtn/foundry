// =============================================================================
// THE TWIN'S DICE — seeded, and keyed so that order cannot leak into them.
//
// The institution names its rows with random ids, and the order it lists them
// in is not something a simulation may depend on: two runs of the same seed
// would otherwise roll the same dice for different listings. So every random
// draw in the twin comes from a stream keyed by WHAT it is about (the seed,
// the day, the listing's title, the buyer's number), never from one shared
// stream consumed in whatever order the database answers.
// =============================================================================

/** FNV-1a over the parts, as a 32-bit unsigned integer. */
export function hashOf(...parts: Array<string | number>): number {
  let h = 0x811c9dc5;
  for (const p of parts) {
    const s = `${String(p)}\u0000`;
    for (let i = 0; i < s.length; i++) {
      h ^= s.charCodeAt(i);
      h = Math.imul(h, 0x01000193) >>> 0;
    }
  }
  return h >>> 0;
}

/** Mulberry32: small, fast, and good enough for a market that is itself a guess. */
export class Rng {
  private s: number;
  constructor(seed: number | string, ...more: Array<string | number>) {
    this.s = typeof seed === 'number' && more.length === 0 ? seed >>> 0 : hashOf(seed, ...more);
  }

  next(): number {
    this.s = (this.s + 0x6d2b79f5) >>> 0;
    let t = this.s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  uniform(min: number, max: number): number { return min + (max - min) * this.next(); }
  int(min: number, max: number): number { return Math.floor(this.uniform(min, max + 1)); }
  chance(p: number): boolean { return this.next() < p; }
  pick<T>(xs: readonly T[]): T { return xs[Math.floor(this.next() * xs.length)]!; }

  /** Knuth for small means, a normal approximation above thirty. */
  poisson(lambda: number): number {
    if (!(lambda > 0)) return 0;
    if (lambda > 30) return Math.max(0, Math.round(lambda + Math.sqrt(lambda) * this.normal()));
    const L = Math.exp(-lambda);
    let k = 0; let p = 1;
    do { k++; p *= this.next(); } while (p > L && k < 1000);
    return k - 1;
  }

  binomial(n: number, p: number): number {
    if (n <= 0 || p <= 0) return 0;
    if (n > 60) return Math.min(n, this.poisson(n * p));
    let k = 0;
    for (let i = 0; i < n; i++) if (this.next() < p) k++;
    return k;
  }

  normal(): number {
    const u = Math.max(this.next(), 1e-12);
    const v = this.next();
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
  }
}
