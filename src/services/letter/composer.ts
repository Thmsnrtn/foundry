// =============================================================================
// FOUNDRY — The Letter (Ascent B7 / Attention Law)
//
// The Overnight Operator's one daily artifact: "what I handled, the one thing
// that needs you, what I learned, how trust moved." Composed DETERMINISTICALLY
// from the ledgers — no model call, so it is free, instant, and cannot
// hallucinate (Honesty Law). The Letter is where the radar (B4) and the trust
// ledger (B6) speak. The measure of success is what the founder can safely
// ignore, not what they engage with.
// =============================================================================

import { query } from '../../db/client.js';
import { scanForWarnings } from '../network/radar.js';
import { getTrustLedger } from '../trust/ledger.js';
import { getDissentRecord } from '../redteam/council.js';
import { getExpiredBeliefs, getMemoryDigest } from '../memory/kernel.js';
import type { Fluency } from '../ux/fluency.js';

export interface Letter {
  handled: string[];       // what ran without you (last 24h)
  needsYou: string | null; // the ONE thing, across BOTH canonical sources
  /** Where the one thing actually is. It is not always the decision queue. */
  needsYouHref: string;
  learned: string[];       // expired beliefs, vindications, radar warnings
  trust: string[];         // graduation proposals + dissent record
  quiet: boolean;          // true when there is genuinely nothing needing you
  /** True for a brand-new product with no history yet: an empty Letter here
   *  means "just getting started," not "quiet day, go rest." The surfaces
   *  render an orienting welcome instead of the established-user quiet state. */
  firstRun: boolean;
}

// Fluency Law: the same Letter — identical facts, identical structure — in the
// founder's voice. MCP/machine callers pass 'technical' for the terse form.
/** Plain words for why a responsibility needs the founder. No ontology on
 *  screen: the internal reason never appears, only what it means for them. */
const ASK_WORDS: Record<string, string> = {
  permission_withdrawn: 'you took my permission away, so I have stopped',
  permission_expired: 'my permission ran out, so I have stopped',
  outcome_unresolved: 'I did something here and nobody knows yet whether it worked',
  watching: 'I have been watching this and could help if you let me',
  overdue: 'the date you gave me has passed',
};

export async function composeLetter(productId: string, f: Fluency = 'balanced'): Promise<Letter> {
  const [executions, gate0, pending, expired, digest, radar, ledger, dissent] = await Promise.all([
    query(
      `SELECT action_type, integration FROM action_executions
       WHERE product_id = ? AND status = 'completed'
         AND datetime(executed_at) >= datetime('now', '-1 day') LIMIT 10`,
      [productId],
    ),
    query(
      // 'system_gate_0' used to be in this list. Migration 001's comment on
      // the column named it as a vocabulary value — "founder, system_gate_0,
      // system_gate_1" — and nothing has ever written either system marker. So
      // half of "what Foundry handled for you" asked for a term that cannot
      // match. Nothing was lost, because the autopilot resolves gate-<=1
      // decisions as 'second_self' and that half works; but the query carried a
      // dead term for as long as it has existed, and it survived review because
      // the schema said it was real. Migration 158 makes the vocabulary a CHECK,
      // so the next one fails the build instead.
      `SELECT what, decided_by FROM decisions
       WHERE product_id = ? AND datetime(decided_at) >= datetime('now', '-1 day')
         AND decided_by = 'second_self' LIMIT 10`,
      [productId],
    ),
    query(
      `SELECT id, what, gate, deadline FROM decisions
       WHERE product_id = ? AND status = 'pending'
       ORDER BY gate DESC, COALESCE(deadline, '9999') ASC LIMIT 1`,
      [productId],
    ),
    getExpiredBeliefs(productId),
    getMemoryDigest(productId),
    scanForWarnings(productId),
    getTrustLedger(productId),
    getDissentRecord(productId),
  ]);

  const handled: string[] = [
    ...(executions.rows as unknown as Array<Record<string, string>>).map(
      (e) => f === 'plain'
        ? `Ran ${e.action_type} for you through ${e.integration}`
        : `Executed ${e.action_type} via ${e.integration}`,
    ),
    ...(gate0.rows as unknown as Array<Record<string, string>>).map(
      (d) => d.decided_by === 'second_self'
        ? (f === 'plain'
          ? `Decided for you — a category you trusted it with: ${d.what} (you can undo this for 24 hours)`
          : `Second Self decided: ${d.what} (24h undo available)`)
        : (f === 'plain'
          ? `Handled a routine call (gate 0): ${d.what}`
          : `Handled autonomously (gate 0): ${d.what}`),
    ),
  ];

  // ONE QUESTION, ONE ANSWER.
  //
  // This card says "the one thing that needs you" and read the highest-gate
  // pending row of `decisions`. Meanwhile The Letter rendered the institution's
  // own NEEDS_YOU list twenty-seven lines below, computed independently from
  // `institutional_responsibilities`. Nothing reconciled them, so the page
  // answered its own central question twice, differently — and the headline
  // could say "Gate-2: pick a pricing page" while an obligation whose date had
  // passed sat further down under a quieter heading.
  //
  // Both ledgers are canonical for what they hold: `decisions` is the decision
  // queue, `institutional_responsibilities` is the responsibility ladder.
  // Neither is copied and no third store is created — this is a projection
  // over both, which is what the constitution permits and what the page was
  // pretending to be already.
  //
  // Overdue wins, because a date the company stated has passed and that is a
  // fact about the world rather than about where Foundry has got to. Then the
  // other reasons a responsibility needs the founder, then the decision queue.
  const top = pending.rows[0] as Record<string, unknown> | undefined;
  const decisionAsk = top
    ? { text: `Gate-${top.gate}: ${top.what}${top.deadline ? ` (deadline ${top.deadline})` : ''}`,
        href: '/decisions' }
    : null;

  const { getSevenDayResponsibilitySummary } = await import(
    '../institution/absence-summary.js');
  const institutional = await getSevenDayResponsibilitySummary(productId).catch(() => null);
  const overdue = institutional?.NEEDS_YOU.find((i) => i.needsYouBecause === 'overdue');
  const otherAsk = institutional?.NEEDS_YOU.find((i) => i.needsYouBecause !== 'overdue');

  const chosen = overdue
    ? { text: `${overdue.title} — you said this was due ${overdue.dueAt?.slice(0, 10) ?? 'earlier'}, and it has not been handled`,
        href: '/letter' }
    : decisionAsk ?? (otherAsk
      ? { text: `${otherAsk.title} — ${ASK_WORDS[otherAsk.needsYouBecause ?? 'watching']}`,
          href: '/letter' }
      : null);
  const needsYou = chosen?.text ?? null;
  const needsYouHref = chosen?.href ?? '/decisions';

  const learned: string[] = [
    ...expired.slice(0, 3).map(
      (e) => f === 'plain'
        ? `Something you believed — "${e.premise.premise}" — is no longer true: ${e.premise.evidence ?? 'your own numbers now contradict it'}`
        : `A belief expired: "${e.premise.premise}" — ${e.premise.evidence ?? 'contradicted by telemetry'}`,
    ),
    ...radar.map((w) => w.message),
  ];
  if (digest.holding > 0) {
    learned.push(digest.holding === 1
      ? `1 recorded belief still holds.`
      : `${digest.holding} of your recorded beliefs still hold.`);
  }

  const trust: string[] = [...ledger.proposals];
  if (dissent.total > 0) {
    trust.push(f === 'plain'
      ? `The devil's advocate's record: ${dissent.vindicated} warnings proved right, ${dissent.overruled_held} overruled and held, ${dissent.pending} still open.`
      : `Red Team record: ${dissent.vindicated} vindicated, ${dissent.overruled_held} overruled-and-held, ${dissent.pending} pending.`);
  }

  // Hands Law: a watching department's shadow work is the founder's cue to
  // promote it — surfaced here, never as a new dashboard (Attention Law).
  const DEPT_NAMES: Record<string, string> = {
    'dept:customer_success': 'customer success',
    'dept:marketing': 'marketing',
    'dept:product_evolution': 'product',
    'dept:outreach': 'outreach',
  };
  const shadowWork = await query(
    `SELECT action_type, COUNT(*) as n FROM audit_log
     WHERE product_id = ? AND action_type LIKE 'dept:%' AND outcome = 'shadow'
       AND created_at >= datetime('now', '-1 day')
     GROUP BY action_type LIMIT 4`,
    [productId],
  );
  for (const row of shadowWork.rows as unknown as Array<Record<string, unknown>>) {
    const dept = DEPT_NAMES[String(row.action_type)] ?? String(row.action_type).replace('dept:', '');
    trust.push(f === 'plain'
      ? `Your ${dept} department is still just watching — it saw ${row.n} thing(s) it would have acted on. Let it suggest drafts in Controls when you're ready.`
      : `${dept}: ${row.n} shadowed action(s) in 24h — promotable in Controls.`);
  }

  const quiet = handled.length === 0 && !needsYou && learned.length === 0 && trust.length === 0;
  // First-run: a genuinely empty Letter on a product that has never had metrics
  // or a decision is a NEW founder, not an established one on a quiet day.
  const firstRun = quiet && digest.holding === 0 && digest.falsified === 0
    && !(await hasAnyHistory(productId));
  return { handled, needsYou, needsYouHref, learned, trust, quiet, firstRun };
}

/** Has this product ever produced a metric snapshot or a decision? Distinguishes
 *  "brand new" from "established but quiet today." */
async function hasAnyHistory(productId: string): Promise<boolean> {
  const r = await query(
    `SELECT
       (SELECT COUNT(*) FROM metric_snapshots WHERE product_id = ?) AS m,
       (SELECT COUNT(*) FROM decisions WHERE product_id = ?) AS d`,
    [productId, productId],
  );
  const row = r.rows[0] as Record<string, unknown>;
  return Number(row.m) > 0 || Number(row.d) > 0;
}
