// =============================================================================
// FOUNDRY — Onboarding Email Sequence
// Sends targeted activation emails during the founder's first week. All sends
// route through the V3.1 tool gateway (kill-switch / classification / budget /
// idempotency + audit) via the registered 'send_email' handler — same path as
// the digest and welcome sequence. The gateway's idempotency layer guarantees
// at-most-once per (product, dedupKey), so a retried job never double-sends.
// =============================================================================

import { query } from '../db/client.js';
import { invoke } from '../services/outbound/gateway.js';
import { log } from './logger.js';
import { nanoid } from 'nanoid';
// Side-effect import: registers the 'send_email' tool handler on the gateway
// so invoke() below can dispatch even if no agent has run yet this process.
import '../services/integration/resend.js';

const FROM = process.env.RESEND_FROM_ADDRESS ?? 'Foundry <thomas@foundry.so>';

/**
 * Send an onboarding email through the gateway. Returns true when the send was
 * accepted (or dedup'd), false when a pre-flight refused it.
 */
async function sendOnboardingEmail(opts: {
  productId: string;
  email: string;
  subject: string;
  html: string;
  dedupKey: string;
  action: string;
}): Promise<boolean> {
  const result = await invoke({
    productId: opts.productId,
    tool: 'send_email',
    action: opts.action,
    params: { to: [opts.email], subject: opts.subject, html: opts.html, from: FROM },
    dedupKey: opts.dedupKey,
    customerExternalId: opts.email,
    surface: 'email_outbound',
    dataClass: 'customer',
  });
  if (!result.ok) {
    log.warn('onboarding_email.refused', {
      productId: opts.productId,
      dedupKey: opts.dedupKey,
      phase: result.phase,
      reason: result.reason,
    });
    return false;
  }
  return true;
}

// DAY 1: THE AUDIT RESULTS EMAIL, DELETED WITH THE AUDIT THAT TRIGGERED IT.
//
// `sendAuditResultsEmail` wrote to a founder the moment their first audit
// finished — a composite score, the weakest dimension, a link back into the
// product. Its one trigger site was `POST /onboarding/run-audit`, the last step
// of the commercial wizard, and that route is deleted. An email about the
// results of an audit nobody can start is a send that can never be correct.
//
// The Day-3 metrics nudge below still has a caller — the `behavioral_triggers`
// job — and is left exactly as it was.

/**
 * Day 3: Send metrics setup guide if no metrics recorded yet.
 */
export async function sendMetricsGuideEmail(
  email: string,
  productName: string,
  productId: string,
): Promise<void> {
  const appUrl = process.env.APP_URL ?? 'http://localhost:8080';

  try {
    const ok = await sendOnboardingEmail({
      productId,
      email,
      subject: `${productName} — Set up metrics to unlock intelligence`,
      dedupKey: `onboarding_metrics:${productId}`,
      action: `day-3 metrics guide → ${email}`,
      html: `
      <p>Foundry's intelligence layer — stressor reports, risk assessment, and weekly digests — needs data to work.</p>

      <h3>Two ways to add metrics:</h3>

      <!-- THE FIRST BUTTON POINTED AT A PAGE THAT NO LONGER EXISTS.
           /products/:id/revenue was Commercial Foundry's manual metric entry
           form; the whole /products/ surface is deleted. An activation email
           whose call to action is a 404 is worse than no email, and this one is
           sent to someone who has just arrived. It points at the ingest URL in
           Controls instead — the thing that actually accepts a number today. -->
      <div style="background:#f8fafc;border:1px solid #e2e5ea;border-radius:8px;padding:16px;margin:16px 0;">
        <h4 style="margin:0 0 8px;">Option 1: Post them yourself (2 minutes)</h4>
        <p style="margin:0;font-size:13px;color:#4b5563;">Controls carries a secret ingest URL. POST this week's numbers to it — MRR, signups, retention — from anything that can make a request.</p>
        <a href="${appUrl}/settings" style="display:inline-block;margin-top:8px;padding:6px 16px;background:#2563eb;color:#fff;border-radius:6px;font-size:13px;text-decoration:none;">Get the ingest URL →</a>
      </div>

      <div style="background:#f8fafc;border:1px solid #e2e5ea;border-radius:8px;padding:16px;margin:16px 0;">
        <h4 style="margin:0 0 8px;">Option 2: Integrate via API (10 minutes)</h4>
        <p style="margin:0;font-size:13px;color:#4b5563;">Create an API key and POST metrics daily from your billing system.</p>
        <a href="${appUrl}/settings" style="display:inline-block;margin-top:8px;padding:6px 16px;background:#fff;color:#374151;border:1px solid #d1d5db;border-radius:6px;font-size:13px;text-decoration:none;">Create API Key →</a>
      </div>

      <p style="color:#6b7280;font-size:13px;">Once we have 7 days of data, Foundry will identify stressors, compute your MRR health ratio, and begin generating actionable intelligence in your Monday digest.</p>
    `,
    });
    if (ok) log.info('Sent metrics guide email', { email, productName });
  } catch (err) {
    log.error('Failed to send metrics guide email', err, { email });
  }
}

/**
 * Evaluate and send onboarding sequence emails.
 * Called by the behavioral_triggers job (every 6h).
 */
export async function evaluateOnboardingSequence(): Promise<void> {
  // Find founders who signed up in the last 7 days
  const recentFounders = await query(
    `SELECT f.id, f.email, f.name, f.created_at,
            p.id as product_id, p.name as product_name
     FROM founders f
     JOIN products p ON p.owner_id = f.id AND p.status = 'active'
     WHERE f.created_at > datetime('now', '-7 days')
     LIMIT 50`,
    []
  );

  for (const row of recentFounders.rows) {
    const f = row as Record<string, string>;
    const daysSinceSignup = Math.floor((Date.now() - new Date(f.created_at).getTime()) / 86400000);

    // Day 3: Check if they've entered metrics
    if (daysSinceSignup >= 2 && daysSinceSignup < 4) {
      const metrics = await query(
        'SELECT id FROM metric_snapshots WHERE product_id = ? LIMIT 1',
        [f.product_id]
      );
      if (metrics.rows.length === 0) {
        // Check we haven't already sent this
        const sent = await query(
          "SELECT id FROM audit_log WHERE product_id = ? AND action_type = 'onboarding_metrics_guide' AND created_at > datetime('now', '-7 days')",
          [f.product_id]
        );
        if (sent.rows.length === 0) {
          await sendMetricsGuideEmail(f.email, f.product_name, f.product_id);
          await query(
            "INSERT INTO audit_log (id, product_id, action_type, gate, trigger, reasoning) VALUES (?, ?, 'onboarding_metrics_guide', 0, 'onboarding_sequence', 'Day 3: no metrics recorded yet')",
            [nanoid(), f.product_id]
          );
        }
      }
    }
  }
}
