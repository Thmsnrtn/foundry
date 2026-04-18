// =============================================================================
// FOUNDRY — Conversational Onboarding Chat Routes
// Chat-based setup that gets a founder to their first AI briefing in < 10 min.
// =============================================================================

import { Hono } from 'hono';
import { html, raw } from 'hono/html';
import type { AuthEnv } from '../../middleware/auth.js';
import { getLayoutContext } from './_shared.js';
import {
  getOrCreateSession,
  sendOnboardingMessage,
  generateFirstBriefingFromContext,
  skipOnboarding,
  countAnsweredQuestions,
} from '../../services/scp/onboarding/chat.js';
import type { OnboardingMessage, ExtractedContext } from '../../services/scp/onboarding/chat.js';

export const onboardingChat = new Hono<AuthEnv>();

// ─── Helpers ──────────────────────────────────────────────────────────────────

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function renderMessageBubble(msg: OnboardingMessage) {
  const isAssistant = msg.role === 'assistant';
  const safeContent = escapeHtml(msg.content).replace(/\n/g, '<br>');

  if (isAssistant) {
    return html`
      <div style="display:flex;gap:10px;align-items:flex-start;">
        <div style="width:32px;height:32px;border-radius:8px;background:#1e40af;display:flex;align-items:center;justify-content:center;font-size:1rem;flex-shrink:0;margin-top:2px;">🏗️</div>
        <div style="max-width:85%;background:var(--surface-2);border:1px solid var(--border);border-radius:0 12px 12px 12px;padding:12px 16px;color:#e2e8f0;font-size:0.9375rem;line-height:1.6;">${raw(safeContent)}</div>
      </div>
    `;
  }

  return html`
    <div style="display:flex;justify-content:flex-end;">
      <div style="max-width:85%;background:#3b82f6;border-radius:12px 0 12px 12px;padding:12px 16px;color:#fff;font-size:0.9375rem;line-height:1.6;">${raw(safeContent)}</div>
    </div>
  `;
}

function renderReadyToBriefCTA(sessionId: string) {
  return html`
    <div id="brief-cta" style="background:linear-gradient(135deg,#1d4ed8,#7c3aed);border-radius:12px;padding:20px 24px;margin:8px 0;text-align:center;">
      <div style="font-size:1.25rem;margin-bottom:8px;">🎯</div>
      <div style="font-weight:700;color:#fff;font-size:1rem;margin-bottom:6px;">Your AI team is ready to brief you!</div>
      <div style="color:#bfdbfe;font-size:0.875rem;margin-bottom:16px;">Based on what you've shared, your agents can generate your first CEO briefing right now.</div>
      <form method="POST" action="/setup/generate-briefing">
        <input type="hidden" name="session_id" value="${sessionId}" />
        <button type="submit" style="background:#fff;color:#1d4ed8;font-weight:700;border:none;padding:10px 24px;border-radius:8px;cursor:pointer;font-size:0.9375rem;width:100%;">
          Generate Your First Briefing →
        </button>
      </form>
    </div>
  `;
}

function renderProgressIndicator(ctx: ExtractedContext) {
  const answered = countAnsweredQuestions(ctx);
  const total = 5;
  const pct = Math.round((answered / total) * 100);
  return html`
    <div id="progress" style="font-size:0.75rem;color:#64748b;display:flex;align-items:center;gap:8px;padding:8px 0;">
      <div style="flex:1;height:3px;background:#1e293b;border-radius:99px;overflow:hidden;">
        <div style="height:100%;background:#3b82f6;border-radius:99px;width:${pct}%;transition:width 0.3s;"></div>
      </div>
      <span>${answered} of ${total} questions answered</span>
    </div>
  `;
}

// ─── GET /setup — Chat UI Page ────────────────────────────────────────────────

onboardingChat.get('/setup', async (c) => {
  const founder = c.get('founder');
  const ctx = await getLayoutContext(founder, '', 'Set up your AI team');
  const productId = ctx.productId;

  if (!productId) {
    return c.redirect('/onboarding');
  }

  const session = await getOrCreateSession(productId, founder.id);
  const answered = countAnsweredQuestions(session.extractedContext);
  const pct = Math.round((answered / 5) * 100);

  const messageBubbles = session.messages.map(renderMessageBubble);
  const showReadyCTA = session.status !== 'completed' && session.firstBriefingGenerated === false && answered >= 4;

  const page = html`<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Set up your AI team — Foundry</title>
  <script src="https://unpkg.com/htmx.org@1.9.10"></script>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; }
    input:focus, button:focus { outline: 2px solid #3b82f6; outline-offset: 2px; }
    #messages { scroll-behavior: smooth; }
    .htmx-indicator { opacity: 0; transition: opacity 0.2s; }
    .htmx-request .htmx-indicator { opacity: 1; }
    .htmx-request.htmx-indicator { opacity: 1; }
  </style>
</head>
<body style="min-height:100vh;background:#0f172a;">
  <div style="min-height:100vh;background:#0f172a;display:flex;flex-direction:column;">
    <!-- Header -->
    <div style="padding:20px 24px;border-bottom:1px solid #1e293b;display:flex;align-items:center;gap:12px;flex-shrink:0;">
      <div style="font-size:1.5rem;">🏗️</div>
      <div>
        <div style="font-weight:700;color:#f8fafc;">Set up your AI team</div>
        <div style="color:#64748b;font-size:0.875rem;">Quick 5-minute conversation to get started</div>
      </div>
      <form method="POST" action="/setup/skip" style="margin-left:auto;">
        <input type="hidden" name="session_id" value="${session.id}" />
        <button type="submit" style="background:none;border:none;color:#475569;font-size:0.875rem;cursor:pointer;padding:4px 8px;">Skip →</button>
      </form>
    </div>

    <!-- Messages area -->
    <div id="messages" style="flex:1;overflow-y:auto;padding:24px;display:flex;flex-direction:column;gap:16px;max-width:680px;margin:0 auto;width:100%;">
      ${messageBubbles}
      ${showReadyCTA ? renderReadyToBriefCTA(session.id) : ''}
    </div>

    <!-- Progress + Input area -->
    <div style="border-top:1px solid #1e293b;flex-shrink:0;">
      <div style="max-width:680px;margin:0 auto;padding:12px 24px 0;">
        <div id="progress" style="font-size:0.75rem;color:#64748b;display:flex;align-items:center;gap:8px;">
          <div style="flex:1;height:3px;background:#1e293b;border-radius:99px;overflow:hidden;">
            <div style="height:100%;background:#3b82f6;border-radius:99px;width:${pct}%;transition:width 0.3s;"></div>
          </div>
          <span>${answered} of 5 questions answered</span>
        </div>
      </div>
      <form
        hx-post="/setup/message"
        hx-target="#messages"
        hx-swap="beforeend"
        hx-on::after-request="this.reset(); document.getElementById('messages').scrollTop = document.getElementById('messages').scrollHeight;"
        style="padding:12px 24px 16px;"
      >
        <input type="hidden" name="session_id" value="${session.id}" />
        <div style="max-width:680px;margin:0 auto;display:flex;gap:8px;">
          <input
            name="message"
            placeholder="Tell me about your startup..."
            autofocus
            autocomplete="off"
            required
            style="flex:1;background:var(--surface-2);border:1px solid var(--border);color:#f8fafc;padding:10px 14px;border-radius:8px;font-size:0.9375rem;"
          />
          <button
            type="submit"
            style="background:#3b82f6;color:#fff;border:none;padding:10px 20px;border-radius:8px;cursor:pointer;font-weight:600;"
          >
            <span class="htmx-indicator" style="display:none;">...</span>
            <span>Send</span>
          </button>
        </div>
      </form>
    </div>
  </div>
  <script>
    // Auto-scroll to bottom on load
    const msgs = document.getElementById('messages');
    if (msgs) msgs.scrollTop = msgs.scrollHeight;

    // Scroll after HTMX swap
    document.body.addEventListener('htmx:afterSwap', function() {
      if (msgs) msgs.scrollTop = msgs.scrollHeight;
    });
  </script>
</body>
</html>`;

  return c.html(page as unknown as string);
});

// ─── POST /setup/message — HTMX message endpoint ──────────────────────────────

onboardingChat.post('/setup/message', async (c) => {
  const founder = c.get('founder');
  const body = await c.req.parseBody() as { session_id?: string; message?: string };

  const sessionId = body.session_id?.trim();
  const message = body.message?.trim();

  if (!sessionId || !message) {
    return c.html(html`<div style="color:#ff6b6b;padding:8px;">Missing session or message.</div>` as unknown as string);
  }

  // Verify session belongs to this founder
  const { query: dbQuery } = await import('../../db/client.js');
  const check = await dbQuery(
    'SELECT id FROM onboarding_sessions WHERE id = ? AND founder_id = ?',
    [sessionId, founder.id],
  );
  if (check.rows.length === 0) {
    return c.html(html`<div style="color:#ff6b6b;padding:8px;">Session not found.</div>` as unknown as string);
  }

  let result: Awaited<ReturnType<typeof sendOnboardingMessage>>;
  try {
    result = await sendOnboardingMessage(sessionId, message);
  } catch (err) {
    console.error('[setup/message] error:', err);
    return c.html(html`<div style="color:#ff6b6b;padding:8px;">Something went wrong. Please try again.</div>` as unknown as string);
  }

  const founderMsg: OnboardingMessage = {
    role: 'founder',
    content: message,
    timestamp: new Date().toISOString(),
  };

  const assistantMsg: OnboardingMessage = {
    role: 'assistant',
    content: result.assistantReply,
    timestamp: new Date().toISOString(),
  };

  const answered = countAnsweredQuestions(result.extractedContext);
  const pct = Math.round((answered / 5) * 100);

  // Build progress update via OOB swap
  const progressHtml = html`
    <div
      id="progress"
      hx-swap-oob="true"
      style="font-size:0.75rem;color:#64748b;display:flex;align-items:center;gap:8px;"
    >
      <div style="flex:1;height:3px;background:#1e293b;border-radius:99px;overflow:hidden;">
        <div style="height:100%;background:#3b82f6;border-radius:99px;width:${pct}%;transition:width 0.3s;"></div>
      </div>
      <span>${answered} of 5 questions answered</span>
    </div>
  `;

  const founderBubble = renderMessageBubble(founderMsg);
  const assistantBubble = renderMessageBubble(assistantMsg);
  const showCTA = result.nextAction === 'generate_briefing';
  const ctaHtml = showCTA ? renderReadyToBriefCTA(sessionId) : html``;

  return c.html(html`
    ${progressHtml}
    ${founderBubble}
    ${assistantBubble}
    ${ctaHtml}
  ` as unknown as string);
});

// ─── POST /setup/generate-briefing — Generate first briefing ─────────────────

onboardingChat.post('/setup/generate-briefing', async (c) => {
  const founder = c.get('founder');
  const body = await c.req.parseBody() as { session_id?: string };

  const sessionId = body.session_id?.trim();
  if (!sessionId) return c.redirect('/setup');

  // Verify ownership
  const { query: dbQuery } = await import('../../db/client.js');
  const check = await dbQuery(
    'SELECT id FROM onboarding_sessions WHERE id = ? AND founder_id = ?',
    [sessionId, founder.id],
  );
  if (check.rows.length === 0) return c.redirect('/setup');

  try {
    const redirectPath = await generateFirstBriefingFromContext(sessionId);
    return c.redirect(redirectPath);
  } catch (err) {
    console.error('[setup/generate-briefing] error:', err);
    return c.redirect('/agents/briefings/latest');
  }
});

// ─── POST /setup/skip — Skip onboarding ──────────────────────────────────────

onboardingChat.post('/setup/skip', async (c) => {
  const founder = c.get('founder');
  const body = await c.req.parseBody() as { session_id?: string };

  const sessionId = body.session_id?.trim();
  if (!sessionId) return c.redirect('/dashboard');

  // Verify ownership
  const { query: dbQuery } = await import('../../db/client.js');
  const check = await dbQuery(
    'SELECT id FROM onboarding_sessions WHERE id = ? AND founder_id = ?',
    [sessionId, founder.id],
  );
  if (check.rows.length === 0) return c.redirect('/dashboard');

  try {
    await skipOnboarding(sessionId);
  } catch (err) {
    console.error('[setup/skip] error:', err);
  }

  return c.redirect('/dashboard');
});
