// =============================================================================
// FOUNDRY — Digest & Email Delivery via Resend
// =============================================================================

import { Resend } from 'resend';
import type { Digest } from '../../types/index.js';

let _resend: Resend | null = null;

function getResend(): Resend {
  if (!_resend) {
    const key = process.env.RESEND_API_KEY;
    if (!key) throw new Error('RESEND_API_KEY required');
    _resend = new Resend(key);
  }
  return _resend;
}

export async function sendDigestEmail(to: string, productName: string, digest: Digest): Promise<void> {
  const resend = getResend();
  const from = process.env.RESEND_FROM_ADDRESS ?? 'foundry@example.com';

  const subject = digest.digest_type === 'red_daily'
    ? `🔴 ${productName} — Daily Recovery Briefing`
    : digest.digest_type === 'yellow_pulse'
    ? `🟡 ${productName} — Thursday Pulse`
    : `${productName} — Weekly Digest`;

  const mrrTotal = (digest.mrr.total_cents / 100).toFixed(2);
  const stressorList = digest.stressor_report?.stressors
    .map((s) => `• ${s.name}: ${s.signal} (${s.severity})`)
    .join('\n') ?? 'No stressors identified.';

  const html = `
    <div style="font-family: system-ui, sans-serif; max-width: 600px; margin: 0 auto;">
      <div style="padding: 12px 16px; border-radius: 8px; background: ${digest.risk_state.state === 'green' ? '#dcfce7' : digest.risk_state.state === 'yellow' ? '#fef9c3' : '#fee2e2'}; margin-bottom: 16px;">
        <strong>${digest.risk_state.state.toUpperCase()}</strong> — ${digest.risk_state.reason}
      </div>
      <h2>Stressor Report</h2>
      <pre style="white-space: pre-wrap;">${stressorList}</pre>
      ${digest.competitive_context ? `<h3>Competitive Context</h3><p>${digest.competitive_context}</p>` : ''}
      <h2>This Week</h2>
      <p>${digest.narrative}</p>
      <h2>Revenue</h2>
      <p>Total MRR: $${mrrTotal} | Health Ratio: ${digest.mrr_health.value.toFixed(2)}</p>
      <h2>Key Metrics</h2>
      <p>Signups: ${digest.metrics.signups_7d} | Active: ${digest.metrics.active_users} | Activation: ${(digest.metrics.activation_rate * 100).toFixed(1)}%</p>
      ${digest.cohort_snapshot ? `<h3>Latest Cohort</h3><p>${digest.cohort_snapshot.period} (${digest.cohort_snapshot.channel}): Day 14 retention ${digest.cohort_snapshot.retention_day_14.toFixed(1)}%</p>` : ''}
    </div>`;

  await resend.emails.send({ from, to, subject, html });
}

export async function sendTriggerEmail(to: string, subject: string, body: string): Promise<void> {
  const resend = getResend();
  const from = process.env.RESEND_FROM_ADDRESS ?? 'foundry@example.com';
  await resend.emails.send({ from, to, subject, html: `<div style="font-family: system-ui, sans-serif;">${body}</div>` });
}
