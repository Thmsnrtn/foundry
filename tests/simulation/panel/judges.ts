// =============================================================================
// THREE JUDGES, ONE HELD-OUT PANEL — and how much the judges agree.
//
// A buyer panel of one model is one opinion wearing five names. This harness
// asks THREE independent judges — each a different prompt, a different way
// of deciding — whether each persona of the HELD-OUT bank would buy each
// product, and measures how often they agree (percent agreement, Cohen's
// kappa per pair, Fleiss' kappa for all three). Where they disagree, the item
// is surfaced, because a disagreement is where a judge is most likely wrong.
//
// IN CI THE JUDGES ARE SCRIPTED: deterministic functions of the persona and
// the product, each standing for its prompt's way of deciding. A REAL run —
// a model behind each prompt — is ready and off: it needs PANEL_REAL=1 and a
// dollar ceiling PANEL_MAX_USD, refuses to start when its own estimate of the
// cost exceeds the ceiling or the ceiling exceeds PANEL_HARD_CAP_USD, and has
// never been run by this repository's tests (they prove only the refusal).
//
// This file is the ONE reader of the held-out bank (see the guard test).
// =============================================================================
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { LIBRARY, printedPages } from '../brains/library.js';
import { THEMES, segmentsFor, type ThemeKey } from '../twin/segments.js';

export type Verdict = 'yes' | 'maybe' | 'no';
export interface Persona {
  id: string; segment: string; who: string; age: number; circumstance: string;
  format: 'paper' | 'fillable' | 'phone'; wtpDollars: number; freeAlternative: string; objection: string; needs: string[];
}
export interface Product {
  key: string; title: string; theme: ThemeKey; priceDollars: number; pages: number; listedPages: number;
  defects: string[]; listing: string; text: string; kind: 'capable' | 'degraded';
}
export interface Judge { id: string; system: string; decide(p: Persona, x: Product): { verdict: Verdict; maxPriceDollars: number } }

const BANK = resolve(import.meta.dirname, '../../fixtures/buyer-panel-bank');
export const heldOutPanel = (): Persona[] => (JSON.parse(readFileSync(resolve(BANK, 'held-out.json'), 'utf8')) as { personas: Persona[] }).personas;

/** The products judged: each theme's file as a capable model makes it, and as a degraded one does. */
export function panelProducts(): Product[] {
  const out: Product[] = [];
  for (const theme of Object.keys(LIBRARY) as ThemeKey[]) {
    const lib = LIBRARY[theme];
    const wtps = segmentsFor(theme).map((s) => s.segment.wtpDollars).sort((a, b) => a - b);
    const mid = wtps[Math.floor(wtps.length / 2)]!;
    const text = lib.pages.map((p) => `${p.heading}. ${p.lede}`).join('\n');
    const pages = printedPages(theme);
    out.push({ key: `${theme}:capable`, title: lib.titles[0]!, theme, priceDollars: Math.max(5, Math.round(mid * 0.8)), pages, listedPages: pages, defects: [],
      listing: `A ${String(pages)}-page printable ${THEMES[theme].name} to fill in by hand.`, text, kind: 'capable' });
    out.push({ key: `${theme}:degraded`, title: `The Ultimate ${THEMES[theme].name.replace(/\b\w/g, (c) => c.toUpperCase())} Bundle`, theme,
      priceDollars: Math.round(mid * 2), pages: 7, listedPages: 30, defects: ['page-count', 'over-claim'],
      listing: `A 30-page printable bundle — the only ${THEMES[theme].name} you will ever need.`, text: lib.pages.slice(0, 4).map((p) => p.heading).join('\n'), kind: 'degraded' });
  }
  return out;
}

const fits = (p: Persona, x: Product): boolean => p.needs.includes(THEMES[x.theme].name);

export const JUDGES: readonly Judge[] = [
  {
    id: 'the-buyer',
    system: 'You are the person described, deciding with your own money whether to buy this file at its price. Politeness helps nobody. Reply {"verdict":"yes"|"maybe"|"no","max_price_dollars":n,"why":"…"}.',
    decide(p, x) {
      if (!fits(p, x)) return { verdict: 'no', maxPriceDollars: Math.round(p.wtpDollars * 0.3) };
      const v: Verdict = x.priceDollars <= p.wtpDollars ? (x.defects.length >= 2 ? 'maybe' : 'yes') : x.priceDollars <= p.wtpDollars * 1.3 ? 'maybe' : 'no';
      return { verdict: v, maxPriceDollars: p.wtpDollars };
    },
  },
  {
    id: 'the-careful-reader',
    system: 'You read the listing against the file itself, as the person described would after buying it: does it deliver what the listing says, page for page, and would you keep it or ask for your money back? Reply {"verdict":…,"max_price_dollars":…,"why":…}.',
    decide(p, x) {
      if (!fits(p, x)) return { verdict: 'no', maxPriceDollars: 0 };
      if (x.listedPages !== x.pages || x.defects.includes('over-claim')) return { verdict: 'no', maxPriceDollars: Math.round(p.wtpDollars * 0.5) };
      // IT READS THE WORDS, not only the counts (F1): a file whose pages are
      // padding — fewer distinct lines of substance than a third of its pages —
      // is one this reader would ask the money back for, whatever the listing says.
      const substance = new Set(x.text.split('\n').map((l) => l.trim().toLowerCase()).filter((l) => l.split(/\s+/).length >= 3)).size;
      if (substance < Math.max(1, Math.floor(x.pages / 3))) return { verdict: 'no', maxPriceDollars: Math.round(p.wtpDollars * 0.3) };
      const v: Verdict = x.pages >= 8 && x.priceDollars <= p.wtpDollars * 1.1 ? 'yes' : 'maybe';
      return { verdict: v, maxPriceDollars: Math.round(p.wtpDollars * (x.pages >= 8 ? 1 : 0.7)) };
    },
  },
  {
    id: 'the-comparison-shopper',
    system: 'You are the person described and you know what you would use instead for free. Decide whether this file is worth paying for over that. Reply {"verdict":…,"max_price_dollars":…,"why":…}.',
    decide(p, x) {
      if (!fits(p, x)) return { verdict: 'no', maxPriceDollars: 0 };
      const pull = p.freeAlternative === 'nothing at all' ? 1.1 : p.format === 'phone' ? 0.6 : 0.85;
      const max = Math.round(p.wtpDollars * pull);
      const v: Verdict = x.priceDollars <= max * 0.9 ? 'yes' : x.priceDollars <= max * 1.2 ? 'maybe' : 'no';
      return { verdict: v, maxPriceDollars: max };
    },
  },
];

const CATS: readonly Verdict[] = ['yes', 'maybe', 'no'];

/** Cohen's kappa between two raters over the same items. */
export function cohenKappa(a: Verdict[], b: Verdict[]): number {
  const n = a.length; if (n === 0) return 0;
  const po = a.filter((v, i) => v === b[i]).length / n;
  const pe = CATS.reduce((s, k) => s + (a.filter((v) => v === k).length / n) * (b.filter((v) => v === k).length / n), 0);
  return pe === 1 ? 1 : (po - pe) / (1 - pe);
}

/** Fleiss' kappa for a fixed number of raters per item. */
export function fleissKappa(items: Verdict[][]): number {
  const N = items.length; if (N === 0) return 0;
  const n = items[0]!.length;
  const pj = CATS.map((k) => items.reduce((s, it) => s + it.filter((v) => v === k).length, 0) / (N * n));
  const Pi = items.map((it) => (CATS.reduce((s, k) => { const c = it.filter((v) => v === k).length; return s + c * (c - 1); }, 0)) / (n * (n - 1)));
  const Pbar = Pi.reduce((a, b) => a + b, 0) / N;
  const Pe = pj.reduce((s, p) => s + p * p, 0);
  return Pe === 1 ? 1 : (Pbar - Pe) / (1 - Pe);
}

export interface PanelRun {
  personas: number; products: number; judges: string[];
  percentAllAgree: number; kappaPairs: Record<string, number>; fleiss: number;
  yesShareByKind: Record<string, number>;
  disagreements: Array<{ persona: string; product: string; verdicts: Record<string, Verdict> }>;
  sentence: string;
}

/** Every held-out persona × every product × every judge, scripted. */
export function judgeTheHeldOutPanel(judges: readonly Judge[] = JUDGES): PanelRun {
  const personas = heldOutPanel();
  const products = panelProducts();
  const byJudge: Record<string, Verdict[]> = Object.fromEntries(judges.map((j) => [j.id, []]));
  const items: Verdict[][] = [];
  const disagreements: PanelRun['disagreements'] = [];
  const yes: Record<string, { y: number; n: number }> = {};
  for (const p of personas) for (const x of products) {
    if (!fits(p, x)) continue; // a persona who has no use for the theme tells nobody anything
    const vs = judges.map((j) => j.decide(p, x).verdict);
    judges.forEach((j, i) => byJudge[j.id]!.push(vs[i]!));
    items.push(vs);
    const k = (yes[x.kind] ??= { y: 0, n: 0 }); k.n += judges.length; k.y += vs.filter((v) => v === 'yes').length;
    if (new Set(vs).size > 1) disagreements.push({ persona: p.id, product: x.key, verdicts: Object.fromEntries(judges.map((j, i) => [j.id, vs[i]!])) });
  }
  const kappaPairs: Record<string, number> = {};
  for (let i = 0; i < judges.length; i++) for (let j = i + 1; j < judges.length; j++) {
    kappaPairs[`${judges[i]!.id} × ${judges[j]!.id}`] = cohenKappa(byJudge[judges[i]!.id]!, byJudge[judges[j]!.id]!);
  }
  const percentAllAgree = items.length ? items.filter((v) => new Set(v).size === 1).length / items.length : 0;
  const fleiss = fleissKappa(items);
  const yesShareByKind = Object.fromEntries(Object.entries(yes).map(([k, v]) => [k, v.y / Math.max(1, v.n)]));
  return {
    personas: personas.length, products: products.length, judges: judges.map((j) => j.id),
    percentAllAgree, kappaPairs, fleiss, yesShareByKind, disagreements,
    sentence: `${String(personas.length)} held-out buyers, judged by three different judges on ${String(products.length)} files (scripted judges, not models): all three agreed on ${(percentAllAgree * 100).toFixed(0)}% of ${String(items.length)} judgements (Fleiss' kappa ${fleiss.toFixed(2)}). They said yes ${((yesShareByKind.capable ?? 0) * 100).toFixed(0)}% of the time to a capable model's files and ${((yesShareByKind.degraded ?? 0) * 100).toFixed(0)}% to a sloppy model's. ${String(disagreements.length)} judgements split the judges and are listed for a person to read.`,
  };
}

// ─── A real run, ready and off ──────────────────────────────────────────────

/** The most a real panel run may ever be allowed to spend, whatever the ceiling asked for. */
export const PANEL_HARD_CAP_USD = 25;

export class PanelRefused extends Error { constructor(m: string) { super(m); this.name = 'PanelRefused'; } }

/**
 * WHETHER A REAL RUN MAY START, and what it would cost by its own estimate:
 * input tokens are the prompt's characters / 4, output 120 tokens a call, at
 * the per-million prices given. Refuses — before any call — without the flag,
 * without a ceiling, with a ceiling above the hard cap, or with an estimate
 * above the ceiling.
 */
export function planARealRun(input: { env: NodeJS.ProcessEnv; inputUsdPerMTok: number; outputUsdPerMTok: number; judges?: readonly Judge[] }): { calls: number; estimateUsd: number; ceilingUsd: number } {
  const judges = input.judges ?? JUDGES;
  if (input.env.PANEL_REAL !== '1') throw new PanelRefused('a real panel run needs PANEL_REAL=1');
  const ceiling = Number(input.env.PANEL_MAX_USD);
  if (!Number.isFinite(ceiling) || ceiling <= 0) throw new PanelRefused('a real panel run needs a dollar ceiling in PANEL_MAX_USD');
  if (ceiling > PANEL_HARD_CAP_USD) throw new PanelRefused(`the ceiling $${String(ceiling)} is above the hard cap of $${String(PANEL_HARD_CAP_USD)}`);
  const personas = heldOutPanel(); const products = panelProducts();
  let inTok = 0; let calls = 0;
  for (const p of personas) for (const x of products) for (const j of judges) {
    if (!fits(p, x)) continue;
    calls += 1; inTok += Math.ceil((j.system.length + JSON.stringify(p).length + x.listing.length + x.text.length) / 4);
  }
  const estimateUsd = (inTok * input.inputUsdPerMTok + calls * 120 * input.outputUsdPerMTok) / 1e6;
  if (estimateUsd > ceiling) throw new PanelRefused(`the run would cost about $${estimateUsd.toFixed(2)}, above the ceiling of $${ceiling.toFixed(2)}; nothing was called`);
  return { calls, estimateUsd, ceilingUsd: ceiling };
}

/** One judge, one persona, one product, asked of a real model through OpenRouter. Never called by this repository's tests. */
async function askARealJudge(j: Judge, p: Persona, x: Product, env: NodeJS.ProcessEnv): Promise<Verdict | null> {
  const r = await fetch(`${env.OPENROUTER_BASE_URL ?? 'https://openrouter.ai/api/v1'}/chat/completions`, {
    method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${String(env.OPENROUTER_API_KEY ?? '')}` },
    body: JSON.stringify({ model: env.PANEL_MODEL ?? 'anthropic/claude-sonnet-5', max_tokens: 120, temperature: 0,
      messages: [{ role: 'system', content: `${j.system}\nThe person: ${JSON.stringify(p)}` }, { role: 'user', content: `<listing>\n${x.listing}\n</listing>\n<file>\n${x.text}\n</file>\nPrice: $${String(x.priceDollars)}` }] }),
  });
  if (!r.ok) return null;
  const content = String(((await r.json()) as { choices?: Array<{ message?: { content?: string } }> }).choices?.[0]?.message?.content ?? '');
  const v = /"verdict"\s*:\s*"(yes|maybe|no)"/.exec(content)?.[1];
  return (v as Verdict | undefined) ?? null;
}

/**
 * THE REAL RUN: the plan first (which refuses before any call), then every
 * judgement asked of a model, then the same agreement as the scripted run.
 * Run by hand: PANEL_REAL=1 PANEL_MAX_USD=5 OPENROUTER_API_KEY=… and a caller.
 */
export async function judgeTheHeldOutPanelForReal(env: NodeJS.ProcessEnv, prices: { inputUsdPerMTok: number; outputUsdPerMTok: number }): Promise<PanelRun> {
  planARealRun({ env, ...prices });
  const real: Judge[] = [];
  const cache = new Map<string, Verdict>();
  for (const j of JUDGES) {
    real.push({ ...j, decide: (p, x) => ({ verdict: cache.get(`${j.id}|${p.id}|${x.key}`) ?? 'maybe', maxPriceDollars: 0 }) });
    for (const p of heldOutPanel()) for (const x of panelProducts()) {
      if (!fits(p, x)) continue;
      cache.set(`${j.id}|${p.id}|${x.key}`, (await askARealJudge(j, p, x, env)) ?? 'maybe');
    }
  }
  return judgeTheHeldOutPanel(real);
}
