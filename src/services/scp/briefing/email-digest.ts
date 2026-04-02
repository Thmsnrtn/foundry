// =============================================================================
// FOUNDRY — Weekly Email Digest Generator
// Writes a "letter from trusted advisor" style HTML email digest.
// Supports Resend and SendGrid for delivery.
// =============================================================================

import { nanoid } from 'nanoid';
import { query } from '../../../db/client.js';
import { callSonnet, parseJSONResponse } from '../../ai/client.js';
import { getLatestCompressedBrief } from './compressed.js';

// ─── Init table ───────────────────────────────────────────────────────────────

let tableReady = false;

async function ensureTable(): Promise<void> {
  if (tableReady) return;
  await query(`
    CREATE TABLE IF NOT EXISTS email_digests (
      id TEXT PRIMARY KEY,
      product_id TEXT NOT NULL,
      week_label TEXT NOT NULL,
      subject TEXT NOT NULL,
      html_body TEXT NOT NULL,
      text_body TEXT NOT NULL,
      sent_to TEXT,
      sent_at TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    )
  `);
  tableReady = true;
}

// ─── Types ────────────────────────────────────────────────────────────────────

export interface EmailDigest {
  subject: string;
  preheader: string;
  html_body: string;
  text_body: string;
  week_label: string;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function getWeekLabel(date: Date = new Date()): string {
  // Start of week (Monday)
  const d = new Date(date);
  const day = d.getDay();
  const diff = d.getDate() - day + (day === 0 ? -6 : 1);
  d.setDate(diff);
  return `Week of ${d.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })}`;
}

function wrapHtml(subject: string, preheader: string, body: string): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${escHtml(subject)}</title>
</head>
<body style="margin:0;padding:0;background-color:#f4f4f5;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;">
  <div style="display:none;max-height:0;overflow:hidden;color:#f4f4f5;">${escHtml(preheader)}</div>
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:#f4f4f5;padding:32px 0;">
    <tr>
      <td align="center">
        <table role="presentation" width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;background-color:#ffffff;border-radius:8px;overflow:hidden;box-shadow:0 1px 3px rgba(0,0,0,0.1);">
          <!-- Header -->
          <tr>
            <td style="background-color:#0a0a12;padding:24px 32px;">
              <span style="color:#4ecca3;font-size:20px;font-weight:700;letter-spacing:-0.5px;">Foundry</span>
              <span style="color:#6b7280;font-size:14px;margin-left:12px;">Weekly Intelligence Brief</span>
            </td>
          </tr>
          <!-- Body -->
          <tr>
            <td style="padding:32px;">
              ${body}
            </td>
          </tr>
          <!-- Footer -->
          <tr>
            <td style="background-color:#f9fafb;padding:16px 32px;border-top:1px solid #e5e7eb;">
              <p style="margin:0;font-size:12px;color:#9ca3af;text-align:center;">
                Foundry — Ambient Intelligence Layer &nbsp;|&nbsp; Reply to this email to respond to your advisor.
              </p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
}

function escHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// ─── Generate Digest ──────────────────────────────────────────────────────────

/**
 * Loads last 7 days of briefings, metric deltas, decisions, and stressors,
 * then calls Claude to write a "letter from advisor" style email digest.
 */
export async function generateWeeklyEmailDigest(productId: string): Promise<EmailDigest> {
  const weekLabel = getWeekLabel();

  // Load recent briefings
  let recentBriefings: Array<{ date: string; headline: string; health_score: number | null }> = [];
  try {
    const res = await query(
      `SELECT briefing_date, headline, health_score FROM scp_briefings
       WHERE product_id = ? ORDER BY briefing_date DESC LIMIT 7`,
      [productId],
    );
    recentBriefings = res.rows.map((r) => {
      const row = r as Record<string, unknown>;
      return {
        date: row.briefing_date as string,
        headline: row.headline as string,
        health_score: row.health_score as number | null,
      };
    });
  } catch {
    // non-fatal
  }

  // Load metric deltas
  let metricsContext = '';
  try {
    const res = await query(
      `SELECT mrr_cents, churn_rate, activation_rate, snapshot_date
       FROM metric_snapshots WHERE product_id = ?
       ORDER BY snapshot_date DESC LIMIT 2`,
      [productId],
    );
    if (res.rows.length > 0) {
      const latest = res.rows[0] as Record<string, unknown>;
      const prev = res.rows[1] as Record<string, unknown> | undefined;
      const mrr = latest.mrr_cents ? `$${((latest.mrr_cents as number) / 100).toLocaleString()}` : 'unknown';
      const churn = latest.churn_rate != null ? `${(latest.churn_rate as number).toFixed(1)}%` : 'unknown';
      const activation = latest.activation_rate != null ? `${(latest.activation_rate as number).toFixed(1)}%` : 'unknown';

      let mrrDelta = '';
      if (prev?.mrr_cents && latest.mrr_cents) {
        const pct = (((latest.mrr_cents as number) - (prev.mrr_cents as number)) / (prev.mrr_cents as number)) * 100;
        mrrDelta = ` (${pct >= 0 ? '+' : ''}${pct.toFixed(1)}% WoW)`;
      }

      metricsContext = `MRR: ${mrr}${mrrDelta}, Churn: ${churn}, Activation: ${activation}`;
    }
  } catch {
    // non-fatal
  }

  // Load key decisions made this week
  let decisionsContext = '';
  try {
    const res = await query(
      `SELECT what, chosen_option, outcome FROM decisions
       WHERE product_id = ? AND decided_at IS NOT NULL
       AND decided_at >= datetime('now', '-7 days')
       ORDER BY decided_at DESC LIMIT 5`,
      [productId],
    );
    if (res.rows.length > 0) {
      decisionsContext = res.rows
        .map((r) => {
          const row = r as Record<string, unknown>;
          return `"${row.what}": chose ${row.chosen_option ?? 'unknown'}`;
        })
        .join('; ');
    }
  } catch {
    // non-fatal
  }

  // Load active stressors
  let stressorsContext = '';
  try {
    const res = await query(
      `SELECT type, severity FROM stressor_history
       WHERE product_id = ? AND status = 'active'
       ORDER BY CASE severity WHEN 'critical' THEN 1 WHEN 'elevated' THEN 2 ELSE 3 END
       LIMIT 5`,
      [productId],
    );
    if (res.rows.length > 0) {
      stressorsContext = res.rows
        .map((r) => `${(r as Record<string, unknown>).severity} ${(r as Record<string, unknown>).type}`)
        .join(', ');
    }
  } catch {
    // non-fatal
  }

  // Load compressed brief
  let compressedContext = '';
  try {
    const brief = await getLatestCompressedBrief(productId);
    if (brief) {
      compressedContext = `
Weekly Status: ${brief.one_sentence_status}
Top Priorities: ${brief.top_3.join('; ')}
Agent Consensus: ${brief.agent_consensus ?? 'n/a'}
One Decision To Make: ${brief.one_decision_to_make ?? 'n/a'}
`.trim();
    }
  } catch {
    // non-fatal
  }

  const headlineBlock = recentBriefings.length
    ? recentBriefings.map((b) => `${b.date}: ${b.headline}`).join('\n')
    : 'No recent briefings.';

  const contextBlock = `
${weekLabel}
Metrics: ${metricsContext || 'Not available'}
Active Stressors: ${stressorsContext || 'None'}
Decisions Made: ${decisionsContext || 'None recorded'}
${compressedContext}

Daily Headlines:
${headlineBlock}
`.trim();

  const systemPrompt = `You are a trusted advisor writing a weekly letter to a founder.
Write in flowing prose — no bullet points, no numbered lists.
Speak directly to them: "This was a week of..." or "You made real progress on...".
Be honest but constructive. Reference specific data. Be concise — aim for 250-350 words total.
The tone is warm, direct, analytical. Like a letter from a mentor who has seen the numbers.
Return ONLY valid JSON.`;

  const userPrompt = `Write a weekly digest email for this founder based on this data:

${contextBlock}

Return ONLY valid JSON in this exact format:
{
  "subject": "Your Foundry Brief: [week label and one key insight]",
  "preheader": "One sentence preview of the email content",
  "prose_body": "Full flowing prose of the letter, 250-350 words. Use \\n\\n for paragraph breaks.",
  "plain_text_version": "Same content as plain text, no HTML"
}`;

  interface AIEmailResponse {
    subject: string;
    preheader: string;
    prose_body: string;
    plain_text_version: string;
  }

  let aiResult: AIEmailResponse = {
    subject: `Your Foundry Brief: ${weekLabel}`,
    preheader: 'Your weekly intelligence brief from Foundry.',
    prose_body: `This week's data has been collected. Visit your Foundry dashboard for the full picture.\n\nYour agents have been monitoring your business metrics, stressors, and decisions. The system is tracking your progress toward key milestones.\n\nUntil next week — stay focused on what moves the needle.`,
    plain_text_version: `${weekLabel}\n\nYour weekly Foundry brief is ready. Visit your dashboard for the full picture.\n\nFoundry — Ambient Intelligence Layer`,
  };

  try {
    const aiResponse = await callSonnet(systemPrompt, userPrompt, 1024);
    const parsed = parseJSONResponse<AIEmailResponse>(aiResponse.content);
    aiResult = { ...aiResult, ...parsed };
  } catch {
    // fall back to defaults
  }

  // Convert prose to HTML paragraphs
  const htmlParagraphs = aiResult.prose_body
    .split(/\n\n+/)
    .map((p) => `<p style="margin:0 0 16px;font-size:15px;line-height:1.6;color:#374151;">${escHtml(p.trim())}</p>`)
    .join('\n');

  const salutation = `<p style="margin:0 0 24px;font-size:16px;line-height:1.6;color:#111827;font-weight:600;">${escHtml(weekLabel)}</p>`;
  const signature = `
<p style="margin:24px 0 0;font-size:14px;color:#6b7280;border-top:1px solid #e5e7eb;padding-top:16px;">
  Your Foundry Advisor
</p>`;

  const htmlBody = wrapHtml(
    aiResult.subject,
    aiResult.preheader,
    `${salutation}${htmlParagraphs}${signature}`,
  );

  return {
    subject: aiResult.subject,
    preheader: aiResult.preheader,
    html_body: htmlBody,
    text_body: aiResult.plain_text_version,
    week_label: weekLabel,
  };
}

// ─── Send Email ───────────────────────────────────────────────────────────────

async function sendViaResend(
  to: string,
  subject: string,
  html: string,
  text: string,
  apiKey: string,
): Promise<void> {
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      from: 'Foundry <briefings@foundry.app>',
      to,
      subject,
      html,
      text,
    }),
  });

  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`Resend API error ${res.status}: ${body}`);
  }
}

async function sendViaSendGrid(
  to: string,
  subject: string,
  html: string,
  text: string,
  apiKey: string,
): Promise<void> {
  const res = await fetch('https://api.sendgrid.com/v3/mail/send', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      personalizations: [{ to: [{ email: to }] }],
      from: { email: 'briefings@foundry.app', name: 'Foundry' },
      subject,
      content: [
        { type: 'text/plain', value: text },
        { type: 'text/html', value: html },
      ],
    }),
  });

  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`SendGrid API error ${res.status}: ${body}`);
  }
}

/**
 * Generates (if needed) and sends the weekly email digest to the given address.
 * Uses Resend if RESEND_API_KEY is set, SendGrid if SENDGRID_API_KEY is set.
 */
export async function sendEmailDigest(productId: string, toEmail: string): Promise<void> {
  await ensureTable();

  const resendKey = process.env.RESEND_API_KEY;
  const sendgridKey = process.env.SENDGRID_API_KEY;

  if (!resendKey && !sendgridKey) {
    throw new Error(
      'No email provider configured. Set RESEND_API_KEY or SENDGRID_API_KEY in your environment.',
    );
  }

  const digest = await generateWeeklyEmailDigest(productId);

  if (resendKey) {
    await sendViaResend(toEmail, digest.subject, digest.html_body, digest.text_body, resendKey);
  } else if (sendgridKey) {
    await sendViaSendGrid(toEmail, digest.subject, digest.html_body, digest.text_body, sendgridKey);
  }

  // Persist
  const id = nanoid();
  try {
    await query(
      `INSERT INTO email_digests
         (id, product_id, week_label, subject, html_body, text_body, sent_to, sent_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, datetime('now'))`,
      [id, productId, digest.week_label, digest.subject, digest.html_body, digest.text_body, toEmail],
    );
  } catch {
    // non-fatal — email was sent, storage failure is secondary
  }
}

// ─── History ──────────────────────────────────────────────────────────────────

export async function getEmailDigestHistory(
  productId: string,
  limit = 10,
): Promise<Array<{ week_label: string; subject: string; sent_at: string | null; sent_to: string | null }>> {
  await ensureTable();

  try {
    const res = await query(
      `SELECT week_label, subject, sent_at, sent_to
       FROM email_digests
       WHERE product_id = ?
       ORDER BY created_at DESC
       LIMIT ?`,
      [productId, limit],
    );

    return res.rows.map((r) => {
      const row = r as Record<string, unknown>;
      return {
        week_label: row.week_label as string,
        subject: row.subject as string,
        sent_at: (row.sent_at as string | null) ?? null,
        sent_to: (row.sent_to as string | null) ?? null,
      };
    });
  } catch {
    return [];
  }
}
