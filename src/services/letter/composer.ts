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
  needsYou: string | null; // the ONE thing (highest-stakes pending decision)
  learned: string[];       // expired beliefs, vindications, radar warnings
  trust: string[];         // graduation proposals + dissent record
  quiet: boolean;          // true when there is genuinely nothing needing you
}

// Fluency Law: the same Letter — identical facts, identical structure — in the
// founder's voice. MCP/machine callers pass 'technical' for the terse form.
export async function composeLetter(productId: string, f: Fluency = 'balanced'): Promise<Letter> {
  const [executions, gate0, pending, expired, digest, radar, ledger, dissent] = await Promise.all([
    query(
      `SELECT action_type, integration FROM action_executions
       WHERE product_id = ? AND status = 'completed'
         AND executed_at >= datetime('now', '-1 day') LIMIT 10`,
      [productId],
    ),
    query(
      `SELECT what, decided_by FROM decisions
       WHERE product_id = ? AND decided_at >= datetime('now', '-1 day')
         AND decided_by IN ('system_gate_0', 'second_self') LIMIT 10`,
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

  const top = pending.rows[0] as Record<string, unknown> | undefined;
  const needsYou = top
    ? `Gate-${top.gate}: ${top.what}${top.deadline ? ` (deadline ${top.deadline})` : ''}`
    : null;

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
  return { handled, needsYou, learned, trust, quiet };
}
