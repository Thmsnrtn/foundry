// =============================================================================
// FOUNDRY — SLO / degradation checks (Phase 3.3)
// Sentry (Phase 0.3) covers exceptions; this covers degradation the operator
// should know about before it becomes an incident. Runs on a cron and emails
// the operator (through the tool gateway) on breach. Kept small and reliable:
// each check reads a signal we actually have and returns a structured result.
// =============================================================================

import { getGlobalSpendStatus } from './ai/client.js';
import { logger } from './logger.js';

export interface SloCheck {
  name: string;
  ok: boolean;
  detail: string;
}

/** AI spend breaches when global daily spend crosses `warnAtPct` of the cap. */
export function evaluateSpendCheck(
  status: { spentCents: number; capCents: number; pctOfCap: number },
  warnAtPct: number,
): SloCheck {
  const ok = status.pctOfCap < warnAtPct;
  const spent = (status.spentCents / 100).toFixed(2);
  const cap = (status.capCents / 100).toFixed(2);
  const pct = Math.round(status.pctOfCap * 100);
  return {
    name: 'ai_daily_spend',
    ok,
    detail: `Global AI spend $${spent} of $${cap} cap (${pct}%)` +
      (ok ? '' : ` — over ${Math.round(warnAtPct * 100)}% warning threshold`),
  };
}

/**
 * Run all SLO checks. Never throws — a check that errors is reported as a
 * breach so the operator investigates rather than the signal going dark.
 */
export async function runSloChecks(): Promise<SloCheck[]> {
  const warnAtPct = parseFloat(process.env.SLO_SPEND_WARN_PCT ?? '0.8');
  const checks: SloCheck[] = [];

  try {
    checks.push(evaluateSpendCheck(await getGlobalSpendStatus(), warnAtPct));
  } catch (err) {
    checks.push({ name: 'ai_daily_spend', ok: false, detail: `check errored: ${(err as Error).message}` });
  }

  return checks;
}

/**
 * Run checks and email the operator through the gateway if any breached.
 * Returns the breaches (empty when all green). Dedup'd per day per check so a
 * sustained breach doesn't spam.
 */
export async function runSloChecksAndAlert(): Promise<SloCheck[]> {
  const checks = await runSloChecks();
  const breaches = checks.filter((c) => !c.ok);
  if (breaches.length === 0) return [];

  const operator = process.env.OPERATOR_EMAIL ?? process.env.SUPPORT_EMAIL ?? process.env.RESEND_FROM_ADDRESS;
  if (!operator) {
    logger.warn('slo.no_operator_email', { breaches: breaches.map((b) => b.name) });
    return breaches;
  }

  try {
    const { invoke } = await import('./outbound/gateway.js');
    // Route through Foundry's own product so the gateway kill-switch has a
    // scope. Resolved by canonical system identity (migration 123), never by
    // display name: an operator alert must not be scoped to whichever row
    // happens to be called "Foundry".
    const { resolveFoundryProductId } = await import('./system-identity.js');
    const foundryProductId = await resolveFoundryProductId();
    if (!foundryProductId) {
      logger.warn('slo.no_foundry_product', { breaches: breaches.map((b) => b.name) });
      return breaches;
    }

    const day = new Date().toISOString().slice(0, 10);
    const list = breaches.map((b) => `• ${b.name}: ${b.detail}`).join('<br/>');
    await invoke({
      productId: foundryProductId,
      tool: 'send_email',
      action: `SLO breach alert (${breaches.length})`,
      params: {
        to: [operator],
        subject: `⚠️ Foundry SLO breach — ${breaches.map((b) => b.name).join(', ')}`,
        html: `<p>The following SLO checks breached at ${new Date().toISOString()}:</p><p>${list}</p>`,
        from: process.env.RESEND_FROM_ADDRESS ?? operator,
      },
      dedupKey: `slo:${day}:${breaches.map((b) => b.name).sort().join('_')}`,
      surface: 'email_outbound',
      dataClass: 'general',
    });
  } catch (err) {
    logger.error('slo.alert_failed', { error: (err as Error).message });
  }

  return breaches;
}
