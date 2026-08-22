// =============================================================================
// FOUNDRY — Governed digest & trigger email delivery
// =============================================================================

import { createHash } from 'crypto';
import type { Digest } from '../../types/index.js';
import { invoke } from '../outbound/gateway.js';
// Registers the canonical send_email capability and its trusted policy.
import '../integration/resend.js';

function dailyDedup(productId: string, kind: string, content: string): string {
  const date = new Date().toISOString().slice(0, 10);
  const digest = createHash('sha256').update(content).digest('hex').slice(0, 16);
  return `${kind}:${productId}:${date}:${digest}`;
}

async function sendGovernedEmail(input: {
  productId: string; to: string; subject: string; html: string; kind: string;
}): Promise<void> {
  const result = await invoke({
    productId: input.productId,
    tool: 'send_email',
    action: `${input.kind}: ${input.subject}`,
    params: { to: [input.to], subject: input.subject, html: input.html },
    dedupKey: dailyDedup(input.productId, input.kind, `${input.to}\n${input.subject}\n${input.html}`),
    customerExternalId: input.to,
  });
  if (!result.ok) throw new Error(`email refused at ${result.phase}: ${result.reason}`);
}

export async function sendDigestEmail(
  productId: string, to: string, productName: string, digest: Digest,
): Promise<void> {
  const subject = digest.digest_type === 'red_daily'
    ? `🔴 ${productName} — Daily Recovery Briefing`
    : digest.digest_type === 'yellow_pulse'
      ? `🟡 ${productName} — Thursday Pulse`
      : `${productName} — Weekly Digest`;
  // "Total MRR" in an email to the founder, and it was the period's net change.
  const mrrTotal = digest.mrr.level_cents === null
    ? 'not reported'
    : `$${(digest.mrr.level_cents / 100).toFixed(2)}`;
  const netNew = `$${(digest.mrr.net_new_cents / 100).toFixed(2)}`;
  const healthRatio = digest.mrr_health.value === null
    ? 'unknown — no new MRR to divide by'
    : digest.mrr_health.value.toFixed(2);
  const stressorList = digest.stressor_report?.stressors
    .map((s) => `• ${s.name}: ${s.signal} (${s.severity})`).join('\n') ?? 'No stressors identified.';
  const html = `<div style="font-family: system-ui, sans-serif; max-width: 600px; margin: 0 auto;">
    <div><strong>${digest.risk_state.state.toUpperCase()}</strong> — ${digest.risk_state.reason}</div>
    <h2>Stressor Report</h2><pre style="white-space: pre-wrap;">${stressorList}</pre>
    ${digest.competitive_context ? `<h3>Competitive Context</h3><p>${digest.competitive_context}</p>` : ''}
    <h2>This Week</h2><p>${digest.narrative}</p>
    <h2>Revenue</h2><p>MRR: ${mrrTotal} | Net new this period: ${netNew} | Health Ratio: ${healthRatio}</p>
    <h2>Key Metrics</h2><p>Signups: ${digest.metrics.signups_7d} | Active: ${digest.metrics.active_users} | Activation: ${(digest.metrics.activation_rate * 100).toFixed(1)}%</p>
  </div>`;
  await sendGovernedEmail({ productId, to, subject, html, kind: `digest:${digest.digest_type}` });
}

export async function sendTriggerEmail(
  productId: string, to: string, triggerName: string, subject: string, body: string,
): Promise<void> {
  await sendGovernedEmail({
    productId, to, subject,
    html: `<div style="font-family: system-ui, sans-serif;">${body}</div>`,
    kind: `trigger:${triggerName}`,
  });
}
