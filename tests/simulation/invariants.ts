// =============================================================================
// THE CONTINUOUS INVARIANT MONITOR — checked after EVERY simulated day.
//
// A world that ends well can have been wrong on day 40 and repaired by day
// 60; a check at the end sees only the repair. So every world in
// `tests/simulation/twin/` calls `checkInvariants` after each day, and a
// violation is recorded with the day it was first seen.
//
// ONE REGISTRY, each entry derived from a rule the institution already holds
// (the pointer says where), each with a canary in
// `invariant-canaries.test.ts` that plants its violation in a real world and
// proves this monitor catches it — and that the same world without the plant
// is clean, so no check is red by construction. A new invariant without a
// canary fails that file (the population is the registry).
//
// SIX OF THE RULES ARE ALSO WATCHED IN PRODUCTION: the parts that need only
// the database live in src/services/institution/watched-rules.ts, read here
// and by the hourly pulse, so the monitor and production read one function.
//
// WHAT THE MONITOR READS: the institution's own rows, through SQL; what the
// providers hold (pages the edge serves, mail the provider accepted, refunds
// and charges at the payment provider); and the institution's own
// deterministic scans, imported rather than copied, so a monitor cannot
// disagree with the gate it is checking about what a forbidden claim is.
// =============================================================================

type Row = Record<string, unknown>;

/** What the monitor needs from the world, and nothing else. */
export interface InvariantWorld {
  founderId: string;
  /** The owner's own name, which no public surface may carry (the Workshop is the voice). */
  ownerName: string;
  query(sql: string, params?: unknown[]): Promise<Row[]>;
  /** Every page the Workshop's edge serves now: its key and HTML. */
  pages(): Array<{ key: string; html: string }>;
  /** Every message the mail provider accepted, to anybody. */
  sends(): Array<{ to: string[]; subject: string; text: string; html: string }>;
  /** Refunds the payment provider made, as request bodies. */
  providerRefunds(): string[];
  /** Products and prices the payment provider holds. */
  providerCatalog(): Array<{ name: string; metadata: Record<string, string> }>;
  /**
   * What "can it sell on its own" says. The institution's own reading unless
   * replaced; the canary replaces it with a liar, since the property under
   * watch is a disagreement between two readers.
   */
  canSell?: () => Promise<{ yes: boolean }>;
}

export interface Invariant {
  id: string;
  /** The rule, in one sentence. */
  rule: string;
  /** Where the institution states or enforces it. */
  derivedFrom: string;
  /**
   * The rule production's hourly pulse reads for this invariant
   * (src/services/institution/watched-rules.ts), or null when it needs what
   * only a simulated world holds (the providers' pages, mail and refunds) or
   * a scan too heavy for every hour.
   */
  watchedInProduction: string | null;
  /** Violations today, each a sentence that names the row. Empty is clean. */
  check(w: InvariantWorld): Promise<string[]>;
}

const q = async (w: InvariantWorld, sql: string, params: unknown[] = []): Promise<Row[]> => w.query(sql, params);

/**
 * A RULE THE INSTITUTION ITSELF WATCHES (src/services/institution/watched-rules.ts):
 * read from its rows by the same function the hourly pulse reads in
 * production, so the monitor and production cannot disagree about it.
 */
async function watched(id: string, w: InvariantWorld): Promise<string[]> {
  const { WATCHED_RULES } = await import('../../src/services/institution/watched-rules.js');
  const rule = WATCHED_RULES.find((r) => r.id === id);
  if (!rule) throw new Error(`no watched rule named ${id}`);
  return rule.check(w.founderId);
}
const strip = (html: string): string => html.replace(/<style[\s\S]*?<\/style>/gi, ' ').replace(/<script[\s\S]*?<\/script>/gi, ' ')
  .replace(/<[^>]*>/g, ' ').replace(/&amp;/g, '&').replace(/&#39;|&apos;/g, '\'').replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
  .replace(/\s+/g, ' ');
const isOwnersAddress = (to: string[]): boolean => to.some((t) => /owner@example\.com/i.test(t));

/** The deploy marker, assembled so this file never carries it whole. */
const MARKER = ['[deploy', '-private]'].join('');

export const INVARIANTS: readonly Invariant[] = [
  {
    id: 'inside-the-charter',
    rule: 'Nothing is placed outside the charter: every placed test was decided by the owner or by a live charter that carved it, the carves never exceed what the charter allows, and no public surface names the owner.',
    derivedFrom: 'CONSTITUTION.md "The charter"; institution/charter.ts chartered() and carve(); hand.ts allowExperiment; the charter\'s sealed public voice and scripts/check-the-owner-is-not-a-public-figure.mjs',
    watchedInProduction: 'decided-inside-the-charter',
    async check(w) {
      const out = await watched('decided-inside-the-charter', w);
      if (w.ownerName.trim()) {
        // The terms page is the one public surface where the law wants his name
        // (scripts/check-the-owner-is-not-a-public-figure.mjs); nowhere else.
        // Experiment 001's sealed public copy names him, and that gate exempts
        // it as a record (proof-1.ts): it is history, not something a run did.
        const { PROOF1_SLUG } = await import('../../src/services/venture/proof-1.js');
        for (const p of w.pages()) {
          const text = strip(p.html);
          const at = text.indexOf(w.ownerName);
          if (!/(^|[/:])terms(\.html)?$/.test(p.key) && !p.key.includes(PROOF1_SLUG) && at >= 0) out.push(`the public page ${p.key} names the owner: "…${text.slice(Math.max(0, at - 60), at + w.ownerName.length + 40)}…"`);
        }
        for (const s of w.sends()) {
          const text = `${s.text} ${strip(s.html)}`;
          const at = text.indexOf(w.ownerName);
          if (!isOwnersAddress(s.to) && at >= 0) out.push(`mail to ${s.to.join(', ')} ("${s.subject}") names the owner: "…${text.slice(Math.max(0, at - 60), at + w.ownerName.length + 40)}…"`);
        }
      }
      return out;
    },
  },
  {
    id: 'owner-only-stays-owners',
    rule: 'No owner-only decision is taken by the institution: policy rows, charters, released holds and decided acts bear the owner (or, for acts on an absorbable rung, a live charter he signed).',
    derivedFrom: 'CONSTITUTION.md "Only the owner decides" and the charter amendment (migration 319); legal-surface.ts supersedeOriginationPolicy; printable.ts releaseHeldPrintable',
    watchedInProduction: 'owner-only-stays-owners',
    async check(w) { return watched('owner-only-stays-owners', w); },
  },
  {
    id: 'no-claim-the-audit-rejects',
    rule: 'No buyer-facing claim the public-claims audit would reject: no banned claim, no invented statistic, testimonial, rating or sales count, and no price on a page but the price charged.',
    derivedFrom: 'scripts/audit-public-claims.mjs ("The price on its page is the price you pay"); hand.ts BANNED_CLAIMS; products/printable.ts fabricationScan',
    watchedInProduction: null,
    async check(w) {
      const { BANNED_CLAIMS } = await import('../../src/services/venture/hand.js');
      const { fabricationScan } = await import('../../src/services/venture/products/printable.js');
      const { SALES_COUNT } = await import('../../src/services/venture/products/offer-composition.js');
      const out: string[] = [];
      const said = (where: string, text: string): void => {
        const lower = text.toLowerCase();
        for (const b of BANNED_CLAIMS) if (lower.includes(b)) out.push(`${where} claims "${b}"`);
        for (const f of fabricationScan(text).filter((x) => !x.startsWith('a claim the Workshop'))) out.push(`${where}: ${f}`);
        const sales = SALES_COUNT.exec(text);
        if (sales) out.push(`${where} states a sales count: "${sales[0]}"`);
      };
      const prices = new Map<string, Set<number>>();
      for (const r of await q(w, `
        SELECT p.slug, p.experiment_id, m.body FROM public_experiments p
          JOIN experiment_materials m ON m.experiment_id = p.experiment_id AND m.kind = 'offer_shape' AND m.superseded_at IS NULL
         WHERE p.founder_id = ?`, [w.founderId])) {
        try {
          const plan = JSON.parse(String(r.body)) as { price?: { amountCents?: number } };
          if (plan.price?.amountCents) prices.set(String(r.slug), new Set([plan.price.amountCents / 100]));
        } catch { /* a shape that is not JSON says no price */ }
      }
      for (const p of w.pages()) {
        const text = strip(p.html);
        said(`the page ${p.key}`, text);
        const slug = [...prices.keys()].find((s) => p.key.includes(s));
        if (slug) {
          for (const m of text.matchAll(/\$\s?(\d+(?:\.\d{2})?)/g)) {
            const v = Number(m[1]);
            if (!prices.get(slug)!.has(v)) out.push(`the page ${p.key} shows $${m[1]!} but charges $${[...prices.get(slug)!].join('/')}`);
          }
        }
      }
      for (const s of w.sends()) if (!isOwnersAddress(s.to)) said(`mail to a buyer ("${s.subject}")`, s.text || strip(s.html));
      return [...new Set(out)];
    },
  },
  {
    id: 'the-file-paid-for',
    rule: 'Every delivered file is the version the buyer paid for: the hash recorded on the fulfilment is the hash the offer was selling when the payment arrived.',
    derivedFrom: 'products/printable.ts checkPrintable and downloadFor ("never a later one silently"); hand.ts delivery',
    watchedInProduction: 'the-file-paid-for',
    async check(w) { return watched('the-file-paid-for', w); },
  },
  {
    id: 'refunds-honoured',
    rule: 'Every refund promise is honoured: a refund asked for through the signed link is made within a day of asking, at the provider, and a refunded purchase is not served again.',
    derivedFrom: 'the About page promise "If you buy something and it is no use to you, you can have your money back" (audit-public-claims.mjs); hand.ts requestRefundByLink / refundFulfilment',
    watchedInProduction: 'refunds-asked-are-made',
    async check(w) {
      const out = await watched('refunds-asked-are-made', w);
      // AND AT THE PROVIDER: a fulfilment that says refunded with no refund there is a promise kept on paper only.
      const refunds = w.providerRefunds();
      for (const f of await q(w, `SELECT id, charge_ref, payment_ref FROM experiment_fulfilments WHERE founder_id = ? AND (status = 'refunded' OR refund_ref IS NOT NULL)`, [w.founderId])) {
        if (!refunds.some((b) => b.includes(String(f.charge_ref ?? '#none')) || b.includes(String(f.payment_ref ?? '#none')))) out.push(`fulfilment ${String(f.id)} says refunded, and the provider holds no refund for it`);
      }
      return out;
    },
  },
  {
    id: 'found-nothing-is-not-support',
    rule: 'No evidence row is counted as support when it found nothing: no candidate stands on fewer independent ways of knowing than its promotion needed once searches that found nothing are left out.',
    derivedFrom: 'market-evidence.ts bearingAsRead (F1.7: "never counted as support"); seeds.ts promote / whatItWouldTakeToBelieve (two independent stances)',
    watchedInProduction: 'found-nothing-is-not-support',
    async check(w) { return watched('found-nothing-is-not-support', w); },
  },
  {
    id: 'can-sell-agrees-with-readiness',
    rule: '"Can it sell on its own" never says yes while readiness would refuse every made test for a reason that is not the test\'s own (the Workshop, sending, or placement).',
    derivedFrom: 'control/production-facts.ts canSellOnItsOwn ("a yes here while readiness refuses would be a lie"); hand.ts readiness',
    watchedInProduction: null,
    async check(w) {
      const { productionFacts, canSellOnItsOwn } = await import('../../src/services/control/production-facts.js');
      const says = w.canSell ? await w.canSell() : canSellOnItsOwn(await productionFacts(w.founderId));
      if (!says.yes) return [];
      const { readiness, SENDING_NOT_CONNECTED } = await import('../../src/services/venture/hand.js');
      const out: string[] = [];
      for (const r of await q(w, `
        SELECT DISTINCT m.experiment_id FROM experiment_materials m JOIN venture_experiments e ON e.id = m.experiment_id
         WHERE m.founder_id = ? AND m.kind = 'deliverable' AND e.decision IS NULL AND e.retired_at IS NULL AND e.superseded_by IS NULL`, [w.founderId])) {
        const ready = await readiness(String(r.experiment_id)).catch(() => null);
        if (!ready) continue;
        const structural = ready.missing.filter((m) => m === SENDING_NOT_CONNECTED || m.startsWith('placing it would be refused') || /Workshop|postal address|paused/i.test(m));
        if (structural.length) out.push(`"can it sell" says yes while readiness refuses ${String(r.experiment_id)}: ${structural.join('; ')}`);
      }
      return out;
    },
  },
  {
    id: 'no-deploy-marker',
    rule: 'The deploy marker appears nowhere the institution writes: no row, no page, no message, no product at the provider.',
    derivedFrom: '.github/workflows/deploy-private.yml (a commit message carrying the marker deploys production); AGENTS.md',
    watchedInProduction: null,
    async check(w) {
      const out: string[] = [];
      for (const t of await q(w, `SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '%_fts%'`)) {
        const cols = (await q(w, `PRAGMA table_info("${String(t.name)}")`)).filter((c) => /TEXT|CHAR|CLOB|^$/i.test(String(c.type ?? '')));
        if (cols.length === 0) continue;
        const where = cols.map((c) => `instr("${String(c.name)}", ?) > 0`).join(' OR ');
        const hit = await q(w, `SELECT COUNT(*) AS n FROM "${String(t.name)}" WHERE ${where}`, cols.map(() => MARKER));
        if (Number(hit[0]?.n ?? 0) > 0) out.push(`table ${String(t.name)} holds ${String(hit[0]!.n)} row(s) carrying the deploy marker`);
      }
      for (const p of w.pages()) if (p.html.includes(MARKER)) out.push(`the public page ${p.key} carries the deploy marker`);
      for (const s of w.sends()) if (`${s.subject} ${s.text} ${s.html}`.includes(MARKER)) out.push(`mail "${s.subject}" carries the deploy marker`);
      for (const p of w.providerCatalog()) if (JSON.stringify(p).includes(MARKER)) out.push(`the provider product "${p.name}" carries the deploy marker`);
      return out;
    },
  },
  {
    id: 'spend-within-allowance',
    rule: 'Spend stays within the allowances: a day\'s thinking within the charter\'s daily rate (or the pre-charter bound), and money returned to buyers never more than they paid.',
    derivedFrom: 'institution/spending.ts thinkingToday (the binding ceiling); charter cognition_cents_per_day; hand.ts refundFulfilment',
    watchedInProduction: 'thinking-within-the-allowance',
    async check(w) { return watched('thinking-within-the-allowance', w); },
  },
];

export interface DayVerdict { day: number; id: string; violations: string[] }

/** Every invariant, today. A check that throws is itself a violation: a monitor that cannot read is not a clean one. */
export async function checkInvariants(w: InvariantWorld, day: number, only?: readonly string[]): Promise<DayVerdict[]> {
  const out: DayVerdict[] = [];
  for (const inv of INVARIANTS) {
    if (only && !only.includes(inv.id)) continue;
    let violations: string[];
    try { violations = await inv.check(w); } catch (err) { violations = [`the check itself failed: ${err instanceof Error ? err.message : String(err)}`]; }
    out.push({ day, id: inv.id, violations });
  }
  return out;
}
