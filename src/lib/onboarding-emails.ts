// =============================================================================
// FOUNDRY — Onboarding Email Sequence
// Sends targeted emails during the founder's first week to drive activation.
// =============================================================================

import { query } from '../db/client.js';
import { sendTriggerEmail } from '../services/digest/delivery.js';
import { log } from './logger.js';
import { nanoid } from 'nanoid';

/**
 * Day 1: Send audit results email after first audit completes.
 */
export async function sendAuditResultsEmail(
  email: string,
  productName: string,
  composite: number,
  verdict: string,
  blockingCount: number,
  productId: string,
): Promise<void> {
  const appUrl = process.env.APP_URL ?? 'http://localhost:8080';
  const scoreColor = composite >= 7 ? '#059669' : composite >= 5 ? '#d97706' : '#dc2626';
  const verdictText = verdict === 'READY' ? 'Launch Ready' : verdict === 'READY_WITH_CONDITIONS' ? 'Ready with Conditions' : 'Not Yet Ready';

  try {
    await sendTriggerEmail(email, `${productName} scored ${composite.toFixed(1)}/10 — Your Audit Results`, `
      <div style="text-align:center;margin:24px 0;">
        <div style="font-size:56px;font-weight:800;color:${scoreColor};">${composite.toFixed(1)}</div>
        <div style="font-size:14px;color:#6b7280;text-transform:uppercase;letter-spacing:1px;">Composite Score</div>
        <div style="display:inline-block;padding:4px 12px;border-radius:4px;background:${scoreColor}20;color:${scoreColor};font-weight:600;font-size:13px;margin-top:8px;">${verdictText}</div>
      </div>

      <p>Foundry analyzed ${productName} across <strong>10 dimensions</strong> — functional completeness, trust density, operational readiness, competitive defensibility, and more.</p>

      ${blockingCount > 0 ? `<p><strong>${blockingCount} blocking issue${blockingCount > 1 ? 's' : ''} found.</strong> These must be resolved before your product is launch-ready. <a href="${appUrl}/products/${productId}/audit" style="color:#2563eb;">View blocking issues →</a></p>` : ''}

      <h3>What to do next:</h3>
      <ol style="line-height:1.8;">
        <li><strong>Review your audit</strong> — see per-dimension scores and findings. <a href="${appUrl}/products/${productId}/audit">View audit →</a></li>
        <li><strong>Enter your metrics</strong> — so Foundry can monitor revenue health and identify risks. <a href="${appUrl}/products/${productId}/revenue">Enter metrics →</a></li>
        <li><strong>Start Product DNA</strong> — teach Foundry about your ICP and positioning. <a href="${appUrl}/products/${productId}/dna">Edit DNA →</a></li>
      </ol>

      <p style="color:#6b7280;font-size:13px;margin-top:24px;">Your first weekly digest arrives Monday. It'll include stressor reports, revenue analysis, and competitive intelligence — but only if you've entered metrics.</p>
    `);
    log.info('Sent audit results email', { email, productName, composite });
  } catch (err) {
    log.error('Failed to send audit results email', err, { email });
  }
}

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
    await sendTriggerEmail(email, `${productName} — Set up metrics to unlock intelligence`, `
      <p>Foundry's intelligence layer — stressor reports, risk assessment, and weekly digests — needs data to work.</p>

      <h3>Two ways to add metrics:</h3>

      <div style="background:#f8fafc;border:1px solid #e2e5ea;border-radius:8px;padding:16px;margin:16px 0;">
        <h4 style="margin:0 0 8px;">Option 1: Enter manually (2 minutes)</h4>
        <p style="margin:0;font-size:13px;color:#4b5563;">Visit the Revenue page and fill in this week's numbers — MRR, signups, retention.</p>
        <a href="${appUrl}/products/${productId}/revenue" style="display:inline-block;margin-top:8px;padding:6px 16px;background:#2563eb;color:#fff;border-radius:6px;font-size:13px;text-decoration:none;">Enter Metrics →</a>
      </div>

      <div style="background:#f8fafc;border:1px solid #e2e5ea;border-radius:8px;padding:16px;margin:16px 0;">
        <h4 style="margin:0 0 8px;">Option 2: Integrate via API (10 minutes)</h4>
        <p style="margin:0;font-size:13px;color:#4b5563;">Create an API key and POST metrics daily from your billing system.</p>
        <a href="${appUrl}/settings" style="display:inline-block;margin-top:8px;padding:6px 16px;background:#fff;color:#374151;border:1px solid #d1d5db;border-radius:6px;font-size:13px;text-decoration:none;">Create API Key →</a>
      </div>

      <p style="color:#6b7280;font-size:13px;">Once we have 7 days of data, Foundry will identify stressors, compute your MRR health ratio, and begin generating actionable intelligence in your Monday digest.</p>
    `);
    log.info('Sent metrics guide email', { email, productName });
  } catch (err) {
    log.error('Failed to send metrics guide email', err, { email });
  }
}

/**
 * Evaluate and send onboarding sequence emails.
 * Called by the behavioral_triggers job.
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
