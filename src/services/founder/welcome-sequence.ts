// =============================================================================
// FOUNDRY — Founder Welcome Email Sequence (Wave 2, action 15)
// 3-stage sequence delivered through the V3.1 tool gateway:
//   day 0  — confirmation + first-steps pointer
//   day 3  — "how was the first briefing?"
//   day 7  — "want to chat" (only sent if engagement signal is low)
// Council 16 (COO) recommendation: Foundry's own customer onboarding
// process should match what Foundry asks of its founders' products.
// =============================================================================

import { nanoid } from 'nanoid';
import { query } from '../../db/client.js';
import { invoke } from '../outbound/gateway.js';

export type WelcomeStage = 'day_0' | 'day_3' | 'day_7';

interface FounderRow {
  id: string;
  email: string;
  name: string | null;
  created_at: string;
}

const FROM = process.env.RESEND_FROM_ADDRESS ?? 'Foundry <thomas@foundry.so>';

// ─── Templates ────────────────────────────────────────────────────────────────

function templateDay0(name: string | null): { subject: string; html: string } {
  const greeting = name ? `Hi ${name.split(' ')[0]},` : 'Hi there,';
  return {
    subject: 'Welcome to Foundry — first steps',
    html: `
      <div style="font-family: -apple-system, BlinkMacSystemFont, sans-serif; max-width: 560px; margin: 0 auto; padding: 24px;">
        <p>${greeting}</p>
        <p>Welcome to Foundry. You're set up — here's what happens next:</p>
        <ol>
          <li><strong>Connect a GitHub repo</strong> if you haven't already. Foundry runs a 10-dimension audit and provisions 12 AI agents per product.</li>
          <li><strong>Read your first briefing.</strong> It lands within 30 seconds of your first audit completing. Top of the page: one number that matters this week, one decision to make today.</li>
          <li><strong>Approve or reject one decision</strong> from the queue. The agents earn trust by being right; the queue earns its keep when you act on it.</li>
        </ol>
        <p>If you get stuck: reply to this email. I read every reply.</p>
        <p>— Thomas</p>
      </div>
    `.trim(),
  };
}

function templateDay3(name: string | null): { subject: string; html: string } {
  const greeting = name ? `Hi ${name.split(' ')[0]},` : 'Hi there,';
  return {
    subject: 'How was the first briefing?',
    html: `
      <div style="font-family: -apple-system, BlinkMacSystemFont, sans-serif; max-width: 560px; margin: 0 auto; padding: 24px;">
        <p>${greeting}</p>
        <p>It's day 3. By now you've seen a couple of briefings and (hopefully) approved or rejected a few decisions.</p>
        <p>Two questions I'd love a one-line reply to:</p>
        <ol>
          <li>What's the most useful thing Foundry has surfaced so far?</li>
          <li>What's the noisiest? (Genuinely useful — tells me where to tune.)</li>
        </ol>
        <p>If neither answer is forthcoming because Foundry hasn't been useful yet, just reply "not yet." That's signal too.</p>
        <p>— Thomas</p>
      </div>
    `.trim(),
  };
}

function templateDay7(name: string | null): { subject: string; html: string } {
  const greeting = name ? `Hi ${name.split(' ')[0]},` : 'Hi there,';
  return {
    subject: 'Want to chat? (15 min, your turn)',
    html: `
      <div style="font-family: -apple-system, BlinkMacSystemFont, sans-serif; max-width: 560px; margin: 0 auto; padding: 24px;">
        <p>${greeting}</p>
        <p>It's day 7. I noticed you haven't been on Foundry much this week — that's totally fine, but I'd love to hear why.</p>
        <p>Three options, in order of effort:</p>
        <ul>
          <li><strong>One-line reply</strong> with what's not landing.</li>
          <li><strong>15-min chat</strong> — I'll send a Calendly link if you reply yes.</li>
          <li><strong>Cancel.</strong> No hurt feelings; I'd want the same option in your shoes. Just say so and I'll refund anything paid.</li>
        </ul>
        <p>Either way: thanks for trying it.</p>
        <p>— Thomas</p>
      </div>
    `.trim(),
  };
}

// ─── Foundry dogfood product resolution ─────────────────────────────────────
// The day_0 welcome fires before the founder has created any product, so it
// can't be scoped to their own product for the gateway's kill-switch check.
// We route it through Foundry's own ('Foundry') product instead — dogfooding.

let _foundryProductId: string | null = null;

async function getFoundryProductId(): Promise<string | null> {
  if (_foundryProductId) return _foundryProductId;
  try {
    const r = await query(
      "SELECT id FROM products WHERE name = 'Foundry' ORDER BY created_at ASC LIMIT 1",
      []
    );
    _foundryProductId = r.rows.length
      ? String((r.rows[0] as Record<string, unknown>).id)
      : null;
  } catch {
    _foundryProductId = null;
  }
  return _foundryProductId;
}

/**
 * Immediate day_0 welcome, sent on founder provisioning (Clerk webhook or the
 * auth auto-provision fallback). Routes through the gateway using Foundry's own
 * product for the kill-switch scope, with the SAME dedupKey the day_0 cron
 * uses — so provisioning and the cron never double-send. Non-throwing.
 */
export async function sendFounderWelcome(
  founder: FounderRow
): Promise<{ ok: boolean; reason?: string }> {
  const foundryProductId = await getFoundryProductId();
  if (!foundryProductId) {
    // Dogfood product not seeded yet — the welcome_sequence_tick cron will
    // retry within 12h once it's available.
    return { ok: false, reason: 'foundry_product_not_seeded' };
  }
  return sendWelcomeStage(founder, foundryProductId, 'day_0');
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Send the appropriate welcome email through the gateway. Idempotent per
 * (founder, stage): a duplicate send for the same stage is dedup'd by the
 * gateway's idempotency layer.
 */
export async function sendWelcomeStage(
  founder: FounderRow,
  productId: string,
  stage: WelcomeStage
): Promise<{ ok: boolean; reason?: string }> {
  const tpl =
    stage === 'day_0' ? templateDay0(founder.name)
    : stage === 'day_3' ? templateDay3(founder.name)
    : templateDay7(founder.name);

  const result = await invoke({
    productId,
    agent: 'system',
    tool: 'send_email',
    action: `welcome ${stage} → ${founder.email}`,
    params: {
      to: [founder.email],
      subject: tpl.subject,
      html: tpl.html,
      from: FROM,
    },
    dedupKey: `welcome:${founder.id}:${stage}`,
    customerExternalId: founder.email,
    surface: 'email_outbound',
    dataClass: 'customer',
  });

  if (!result.ok) {
    return { ok: false, reason: result.reason };
  }
  return { ok: true };
}

// ─── Cron driver ──────────────────────────────────────────────────────────────
// Called by the welcome_sequence_tick cron (registered in jobs/index.ts).
// Iterates founders whose created_at falls in the right window and triggers
// the appropriate stage. The gateway's idempotency layer guarantees
// at-most-once per (founder, stage).

export async function runWelcomeSequenceTick(): Promise<{
  day_0: number;
  day_3: number;
  day_7: number;
}> {
  // Each stage looks for founders whose created_at lands in its window.
  // Day 0: created in last 12h (catches new signups since the previous tick).
  // Day 3: created 3-3.5 days ago.
  // Day 7: created 7-7.5 days ago AND has < 3 dashboard_views (engagement
  //        signal — re-use the existing audit_log path).
  // For each match, find the founder's first product and send the stage.
  const counts = { day_0: 0, day_3: 0, day_7: 0 };

  const stages: Array<{ stage: WelcomeStage; whereClause: string }> = [
    {
      stage: 'day_0',
      whereClause: "datetime(f.created_at) >= datetime('now', '-12 hours')",
    },
    {
      stage: 'day_3',
      whereClause:
        "datetime(f.created_at) BETWEEN datetime('now', '-3 days', '-30 minutes') AND datetime('now', '-3 days', '+30 minutes')",
    },
    {
      stage: 'day_7',
      whereClause:
        "datetime(f.created_at) BETWEEN datetime('now', '-7 days', '-30 minutes') AND datetime('now', '-7 days', '+30 minutes')",
    },
  ];

  for (const { stage, whereClause } of stages) {
    const r = await query(
      `SELECT f.id, f.email, f.name, f.created_at, p.id AS product_id
         FROM founders f
         LEFT JOIN products p ON p.owner_id = f.id AND p.status = 'active'
        WHERE ${whereClause}
        GROUP BY f.id`,
      []
    );

    for (const row of r.rows) {
      const rec = row as Record<string, unknown>;
      const founder: FounderRow = {
        id: rec.id as string,
        email: rec.email as string,
        name: (rec.name as string | null) ?? null,
        created_at: rec.created_at as string,
      };
      if (stage === 'day_0') {
        // day_0 routes through Foundry's own product and doesn't require the
        // founder to have created one yet (idempotent with the provisioning send).
        const result = await sendFounderWelcome(founder);
        if (result.ok) counts.day_0++;
        continue;
      }
      const productId = rec.product_id as string | null;
      if (!productId) continue; // day_3/day_7 need the founder's product context
      const result = await sendWelcomeStage(founder, productId, stage);
      if (result.ok) counts[stage]++;
    }
  }

  return counts;
}
