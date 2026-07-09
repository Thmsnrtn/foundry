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

export interface Letter {
  handled: string[];       // what ran without you (last 24h)
  needsYou: string | null; // the ONE thing (highest-stakes pending decision)
  learned: string[];       // expired beliefs, vindications, radar warnings
  trust: string[];         // graduation proposals + dissent record
  quiet: boolean;          // true when there is genuinely nothing needing you
}

export async function composeLetter(productId: string): Promise<Letter> {
  const [executions, gate0, pending, expired, digest, radar, ledger, dissent] = await Promise.all([
    query(
      `SELECT action_type, integration FROM action_executions
       WHERE product_id = ? AND status = 'completed'
         AND executed_at >= datetime('now', '-1 day') LIMIT 10`,
      [productId],
    ),
    query(
      `SELECT what FROM decisions
       WHERE product_id = ? AND gate = 0 AND decided_at >= datetime('now', '-1 day')
         AND decided_by != 'founder' LIMIT 10`,
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
      (e) => `Executed ${e.action_type} via ${e.integration}`,
    ),
    ...(gate0.rows as unknown as Array<Record<string, string>>).map(
      (d) => `Handled autonomously (gate 0): ${d.what}`,
    ),
  ];

  const top = pending.rows[0] as Record<string, unknown> | undefined;
  const needsYou = top
    ? `Gate-${top.gate}: ${top.what}${top.deadline ? ` (deadline ${top.deadline})` : ''}`
    : null;

  const learned: string[] = [
    ...expired.slice(0, 3).map(
      (e) => `A belief expired: "${e.premise.premise}" — ${e.premise.evidence ?? 'contradicted by telemetry'}`,
    ),
    ...radar.map((w) => w.message),
  ];
  if (digest.holding > 0) learned.push(`${digest.holding} of your recorded beliefs still hold.`);

  const trust: string[] = [...ledger.proposals];
  if (dissent.total > 0) {
    trust.push(`Red Team record: ${dissent.vindicated} vindicated, ${dissent.overruled_held} overruled-and-held, ${dissent.pending} pending.`);
  }

  const quiet = handled.length === 0 && !needsYou && learned.length === 0 && trust.length === 0;
  return { handled, needsYou, learned, trust, quiet };
}
