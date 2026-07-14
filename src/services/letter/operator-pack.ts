// =============================================================================
// FOUNDRY — Operator Pack (Jarvis evolution axis 2 — the operator letter)
//
// The operator of Foundry-the-business reads the SAME fleet letter as every
// founder — this pack only ADDS system-health lines to it (like fluency adds
// voice): the business AND the machine that runs it, one artifact. The
// no-fork rule is constitutional: the moment the operator has a bespoke
// Jarvis, dogfooding of the sold product stops.
//
// Every line derives from a fresh ledger read; a metric whose table is
// unavailable is silently skipped (this pack must never break the letter).
// =============================================================================

import { query } from '../../db/client.js';

async function safeCount(sql: string, args: unknown[] = []): Promise<number | null> {
  try {
    const r = await query(sql, args);
    return Number((r.rows[0] as Record<string, unknown> | undefined)?.c ?? 0);
  } catch { return null; }
}

/** System-health lines for the operator's letter. Only speaks when a number
 *  is worth speaking about — a healthy machine contributes silence. */
export async function getOperatorSystemLines(): Promise<string[]> {
  const lines: string[] = [];

  // AI spend today vs trailing 7-day average — the runaway-bill early warning.
  try {
    const spend = await query(
      `SELECT date, SUM(spent_cents) as cents FROM ai_daily_spend
        WHERE date >= date('now', '-7 days') GROUP BY date ORDER BY date DESC`,
      [],
    );
    const rows = spend.rows as unknown as Array<Record<string, unknown>>;
    const today = rows.find((r) => String(r.date) === new Date().toISOString().slice(0, 10));
    const prior = rows.filter((r) => r !== today);
    if (today && prior.length >= 3) {
      const todayC = Number(today.cents);
      const avg = prior.reduce((s, r) => s + Number(r.cents), 0) / prior.length;
      if (avg > 0 && todayC > avg * 3) {
        lines.push(`AI spend today is ${(todayC / 100).toFixed(2)} USD — ${(todayC / avg).toFixed(1)}× the 7-day average. Check /founder-ops before it compounds.`);
      }
    }
  } catch { /* spend table unavailable — skip */ }

  // The letter verifier's own drop log — the system telling on itself.
  const verifierDrops = await safeCount(
    `SELECT COUNT(*) c FROM audit_log
      WHERE action_type = 'letter:verifier' AND outcome = 'refused'
        AND created_at >= datetime('now', '-1 day')`,
  );
  if (verifierDrops != null && verifierDrops > 0) {
    lines.push(`The letter verifier dropped ${verifierDrops} unverifiable line(s) in the last 24h — composition and ledger disagreed somewhere. The audit log has each reason.`);
  }

  // Failed act-tier verifications — autonomy that didn't deliver.
  const actionFails = await safeCount(
    `SELECT COUNT(*) c FROM action_executions
      WHERE verify_status = 'failed' AND verified_at >= datetime('now', '-1 day')`,
  );
  if (actionFails != null && actionFails > 0) {
    lines.push(`${actionFails} autonomous action(s) failed their pre-declared success criteria in the last 24h — the acting categories were demoted automatically.`);
  }

  // Failed executions generally (integration rot shows up here first).
  const execFails = await safeCount(
    `SELECT COUNT(*) c FROM action_executions
      WHERE status = 'failed' AND executed_at >= datetime('now', '-1 day')`,
  );
  if (execFails != null && execFails > 0) {
    lines.push(`${execFails} execution(s) failed outright in the last 24h — usually a disconnected integration or an expired grant.`);
  }

  return lines;
}
