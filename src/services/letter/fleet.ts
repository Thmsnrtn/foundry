// =============================================================================
// FOUNDRY — The Fleet Letter (Jarvis slice 1 / One Letter)
//
// A portfolio operator gets ONE artifact, not N letters. Composition:
//   - per-product Letters reuse composeLetter verbatim (deterministic ledger
//     reads — no model call, no fabrication)
//   - the cross-fleet "needs you" is ranked from STRUCTURED ledger rows
//     (gate × risk × deadline × operator attention memory), each item
//     carrying provenance (decision id) so the independent verifier can
//     re-check it against a FRESH read before anything is delivered.
// Ranking beats recency: the one thing on top should be the thing a good
// chief of staff would put on top.
// =============================================================================

import { nanoid } from 'nanoid';
import { realCompany, query } from '../../db/client.js';
import { composeLetter, type Letter } from './composer.js';
import type { Fluency } from '../ux/fluency.js';
import { getSevenDayResponsibilitySummary, type AbsenceClassification, type AbsenceItem } from '../institution/absence-summary.js';

/**
 * ONE ITEM, TWO CANONICAL SOURCES.
 *
 * This used to be decisions only, and that was the fleet half of a defect the
 * single-product letter had already fixed: `composer.ts` projects "the one
 * thing" over BOTH the decision queue and the institution's own NEEDS_YOU, so
 * an overdue responsibility, a withdrawn permission, or an unresolved outcome
 * can be the thing on top. Across the fleet none of them could be, however
 * overdue — a founder with two companies was ranked on one source.
 *
 * The two kinds are kept distinct rather than flattened into a common shape.
 * They are verified differently, they are acted on differently, and a
 * responsibility has no gate — inventing one to make the sort uniform would be
 * manufacturing a fact to simplify a comparison.
 */
export type FleetNeedsYou =
  | {
    kind: 'decision';
    decisionId: string;
    productId: string;
    productName: string;
    what: string;
    gate: number;
    riskState: string;
    deadline: string | null;
    score: number;
  }
  | {
    kind: 'responsibility';
    responsibilityId: string;
    productId: string;
    productName: string;
    what: string;
    /** Why it needs them, from the institution's own vocabulary. */
    because: NonNullable<AbsenceItem['needsYouBecause']>;
    /** The date the COMPANY gave, when the reason is that it has passed. */
    dueAt: string | null;
    riskState: string;
  }
  | {
    /** The third canonical store: a judgment Foundry raised about the company,
     *  which rendered in its own section and could never be the one thing. */
    kind: 'judgment';
    judgmentId: string;
    productId: string;
    productName: string;
    what: string;
    /** `contradicted` is LATE — the observation pass may only report it against
     *  a date the company itself stated. Anything else is open, not late. */
    evaluationState: string | null;
    riskState: string;
  };

export interface FleetProductLetter {
  productId: string;
  productName: string;
  riskState: string;
  letter: Letter;
  responsibilities: Record<AbsenceClassification, AbsenceItem[]>;
}

export interface FleetLetter {
  founderId: string;
  composedAt: string;
  products: FleetProductLetter[];
  /** Ranked across the fleet — [0] is THE one thing. Capped at
   *  MAX_NEEDS_YOU for the page; `needsYouTotal` is how many asks there were. */
  needsYou: FleetNeedsYou[];
  /** Every ask that entered the ranking, before the page cap. Printed to the
   *  founder in the push, where `needsYou.length` was reporting the cap itself
   *  and so read "Top of 5" whatever the real number was. */
  needsYouTotal: number;
  /** Operator pack (Foundry's own operator only): the machine's health lines,
   *  riding the same letter — never a separate surface (no-fork rule). */
  system: string[];
  quiet: boolean;
}

const RISK_WEIGHT: Record<string, number> = { red: 15, yellow: 7, green: 0 };
const MAX_NEEDS_YOU = 5;

function deadlineUrgency(deadline: string | null): number {
  if (!deadline) return 0;
  const dt = new Date(deadline).getTime();
  if (Number.isNaN(dt)) return 0;
  const hours = (dt - Date.now()) / 3_600_000;
  if (hours <= 48) return 10; // overdue or imminent
  if (hours <= 24 * 7) return 5;
  return 2;
}

/** Attention memory (admission-controlled: explicit founder reactions only).
 *  A product whose surfaced items the founder consistently acts on ranks up;
 *  consistent dismissal ranks it down. Bounded ±5 so facts still dominate. */
async function attentionAdjustment(founderId: string, productId: string): Promise<number> {
  const r = await query(
    `SELECT reaction, COUNT(*) as n FROM operator_attention
     WHERE founder_id = ? AND product_id = ?
       AND created_at >= datetime('now', '-30 days')
     GROUP BY reaction`,
    [founderId, productId],
  );
  let acted = 0, dismissed = 0;
  for (const row of r.rows as unknown as Array<Record<string, unknown>>) {
    if (row.reaction === 'acted') acted = Number(row.n);
    if (row.reaction === 'dismissed') dismissed = Number(row.n);
  }
  const total = acted + dismissed;
  if (total < 3) return 0; // not enough explicit signal — no adjustment
  return Math.max(-5, Math.min(5, Math.round(((acted - dismissed) / total) * 5)));
}

export async function composeFleetLetter(founderId: string, f: Fluency = 'balanced'): Promise<FleetLetter> {
  const products = (await query(
    `SELECT p.id, p.name, COALESCE(ls.risk_state, 'green') as risk_state
       FROM products p LEFT JOIN lifecycle_state ls ON ls.product_id = p.id
      WHERE p.owner_id = ? AND p.status != 'archived' AND ${realCompany('p')}
      ORDER BY p.created_at ASC`,
    [founderId],
  )).rows as unknown as Array<Record<string, string>>;

  const letters: FleetProductLetter[] = await Promise.all(
    products.map(async (p) => ({
      productId: p.id,
      productName: p.name,
      riskState: p.risk_state,
      letter: await composeLetter(p.id, f),
      responsibilities: await getSevenDayResponsibilitySummary(p.id),
    })),
  );

  // Structured cross-fleet ranking — provenance-carrying, verifier-checkable.
  //
  // THE CAP USED TO KEEP THE WRONG 50. This read `ORDER BY d.created_at ASC
  // LIMIT 50` — the fifty OLDEST pending decisions — and the score was then
  // computed only over the rows that survived. Nothing that missed the cut could
  // win, however high it would have scored, so a portfolio founder with fifty
  // undated pending decisions had a gate-4 decision on a red-risk company
  // created yesterday silently absent from an artifact whose type says "ranked
  // across the whole fleet". The single-product letter, which orders by gate
  // with no cap, WOULD have surfaced it — so the two letters disagreed and the
  // fleet one, the one the job actually delivers, was the one that dropped it.
  //
  // The pending queue grows without bound (the expiry job only touches rows
  // with a passed deadline), so a cap is right. It now orders by the terms that
  // dominate the score — gate first, then deadline — so the cap keeps the
  // candidates that could win, and it is four times larger.
  const pending = (await query(
    `SELECT d.id, d.product_id, d.what, d.gate, d.deadline, p.name as product_name,
            COALESCE(ls.risk_state, 'green') as risk_state
       FROM decisions d
       JOIN products p ON p.id = d.product_id
       LEFT JOIN lifecycle_state ls ON ls.product_id = d.product_id
      WHERE p.owner_id = ? AND d.status = 'pending' AND p.status != 'archived'
      ORDER BY d.gate DESC, (d.deadline IS NULL) ASC, d.deadline ASC, d.created_at ASC
      LIMIT 200`,
    [founderId],
  )).rows as unknown as Array<Record<string, unknown>>;

  const adjustments = new Map<string, number>();
  for (const p of products) adjustments.set(p.id, await attentionAdjustment(founderId, p.id));

  const decisionItems: FleetNeedsYou[] = pending
    .map((d) => {
      const gate = Number(d.gate ?? 0);
      const risk = String(d.risk_state);
      const deadline = (d.deadline as string) ?? null;
      return {
        kind: 'decision' as const,
        decisionId: String(d.id),
        productId: String(d.product_id),
        productName: String(d.product_name),
        what: String(d.what),
        gate,
        riskState: risk,
        deadline,
        score: gate * 10 + (RISK_WEIGHT[risk] ?? 0) + deadlineUrgency(deadline)
          + (adjustments.get(String(d.product_id)) ?? 0),
      };
    })
    .sort((a, b) => b.score - a.score);

  // THE SAME PRECEDENCE THE SINGLE-PRODUCT LETTER USES, widened to the fleet.
  //
  // `composer.ts` orders overdue > decision > every other ask, and the reason is
  // not weighting: a date the COMPANY gave has passed, which the database will
  // not let Foundry author, so it is the one ask that is late rather than
  // merely open. Scoring it against a gate would require inventing a gate for
  // it, and a fabricated comparable is worse than an explicit order.
  const responsibilityAsks = letters.flatMap((product) =>
    product.responsibilities.NEEDS_YOU.map((item): FleetNeedsYou => ({
      kind: 'responsibility' as const,
      responsibilityId: item.responsibilityId,
      productId: product.productId,
      productName: product.productName,
      what: item.title,
      because: item.needsYouBecause ?? 'watching',
      dueAt: item.dueAt ?? null,
      riskState: product.riskState,
    })));
  const overdue = responsibilityAsks
    .filter((item) => item.kind === 'responsibility' && item.because === 'overdue')
    .sort((a, b) => String((a as { dueAt: string | null }).dueAt ?? '')
      .localeCompare(String((b as { dueAt: string | null }).dueAt ?? '')));
  const otherAsks = responsibilityAsks.filter(
    (item) => item.kind === 'responsibility' && item.because !== 'overdue');

  // The third store, ranked by the same rule the single-product letter uses:
  // a contradicted judgment is late and sits with the overdue obligations; an
  // open one is real, is not late, and ranks below the founder's own queue.
  const { getMaterialJudgments } = await import('../institution/institutional-judgment-disposition.js');
  const judgmentItems: FleetNeedsYou[] = (await Promise.all(letters.map(async (product) =>
    (await getMaterialJudgments(product.productId).catch(() => [])).map((j): FleetNeedsYou => ({
      kind: 'judgment' as const,
      judgmentId: j.id,
      productId: product.productId,
      productName: product.productName,
      what: j.title,
      evaluationState: j.evaluationState,
      riskState: product.riskState,
    }))))).flat();
  const contradicted = judgmentItems.filter(
    (j) => j.kind === 'judgment' && j.evaluationState === 'contradicted');
  const openJudgments = judgmentItems.filter(
    (j) => j.kind === 'judgment' && j.evaluationState !== 'contradicted');

  const allAsks: FleetNeedsYou[] = [
    ...overdue, ...contradicted, ...decisionItems, ...otherAsks, ...openJudgments,
  ];
  const needsYou: FleetNeedsYou[] = allAsks.slice(0, MAX_NEEDS_YOU);

  // Operator pack: system-health lines join the operator's letter only.
  let system: string[] = [];
  try {
    const email = String(((await query('SELECT email FROM founders WHERE id = ?', [founderId]))
      .rows[0] as Record<string, unknown> | undefined)?.email ?? '');
    const { isFounder } = await import('../founder/intelligence.js');
    if (isFounder(email)) {
      const { getOperatorSystemLines } = await import('./operator-pack.js');
      system = await getOperatorSystemLines();
    }
  } catch { /* the pack must never break the letter */ }

  const quiet = needsYou.length === 0 && letters.every((l) =>
    l.letter.quiet && Object.values(l.responsibilities).every((items) => items.length === 0)
  ) && system.length === 0;
  return {
    founderId,
    composedAt: new Date().toISOString(),
    products: letters,
    needsYou,
    needsYouTotal: allAsks.length,
    system,
    quiet,
  };
}

/** Admission-controlled memory write: only explicit founder reactions,
 *  only for items that were actually surfaced (item_ref = decision id). */
export async function recordAttention(
  founderId: string,
  productId: string,
  itemRef: string,
  reaction: 'opened' | 'acted' | 'dismissed',
): Promise<void> {
  // The item must be a real decision on a product this founder owns —
  // attention memory never stores unverifiable references.
  const owns = await query(
    `SELECT d.id FROM decisions d JOIN products p ON p.id = d.product_id
      WHERE d.id = ? AND d.product_id = ? AND p.owner_id = ?`,
    [itemRef, productId, founderId],
  );
  if (owns.rows.length === 0) return;
  await query(
    `INSERT INTO operator_attention (id, founder_id, product_id, item_kind, item_ref, reaction)
     VALUES (?, ?, ?, 'needs_you', ?, ?)`,
    [nanoid(), founderId, productId, itemRef, reaction],
  );
}
