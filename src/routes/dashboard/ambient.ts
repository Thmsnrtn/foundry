// =============================================================================
// FOUNDRY — Ambient Layer Dashboard Routes
// Hub for the Ambient Layer: Audio Brief, Email Digest, Voice Reply.
// /ambient, /ambient/audio, /ambient/email, /ambient/voice
// =============================================================================

import { Hono } from 'hono';
import { html } from 'hono/html';
import type { AuthEnv } from '../../middleware/auth.js';
import { dashboardLayout } from '../../views/layout.js';
import { getLayoutContext } from './_shared.js';
import { getOrGenerateAudioScript, generateAudioBriefScript } from '../../services/scp/briefing/audio.js';
import { generateWeeklyEmailDigest, sendEmailDigest, getEmailDigestHistory } from '../../services/scp/briefing/email-digest.js';
import { processVoiceReply } from '../../services/scp/briefing/voice-reply.js';
import { requireCompanyCapability } from '../../middleware/rbac.js';

export const ambientRoutes = new Hono<AuthEnv>();

// ─── Helpers ──────────────────────────────────────────────────────────────────

function card(icon: string, title: string, subtitle: string, ctaHref: string, ctaLabel: string, status?: string): string {
  return `
<div style="background:var(--surface);border:1px solid var(--border);border-radius:10px;padding:24px;display:flex;flex-direction:column;gap:12px;">
  <div style="font-size:2rem;">${icon}</div>
  <div>
    <h3 style="margin:0 0 4px;font-size:1.05rem;">${title}</h3>
    <p style="margin:0;font-size:0.875rem;color:var(--text-dim);">${subtitle}</p>
  </div>
  ${status ? `<div style="font-size:0.8rem;color:var(--text-muted);padding:4px 8px;background:var(--surface-raised);border-radius:4px;display:inline-block;">${status}</div>` : ''}
  <a href="${ctaHref}" style="display:inline-block;padding:8px 16px;background:var(--accent);color:#fff;border-radius:6px;text-decoration:none;font-size:0.875rem;font-weight:600;margin-top:auto;">${ctaLabel}</a>
</div>`;
}

// ─── GET /ambient — Hub ────────────────────────────────────────────────────────

ambientRoutes.get('/ambient', async (c) => {
  const founder = c.get('founder');
  const ctx = await getLayoutContext(founder, 'ambient', 'Ambient Layer', undefined, c);

  const content = html`
    <div style="max-width:900px;">
      <div style="margin-bottom:1.5rem;">
        <h1 style="margin:0 0 0.5rem;font-size:1.75rem;">Ambient Layer</h1>
        <p style="margin:0;color:var(--text-dim);">Intelligence delivered where you already are — no dashboard required.</p>
      </div>

      ${!ctx.productId ? html`
        <div style="padding:2rem;background:var(--surface);border-radius:8px;text-align:center;color:var(--text-dim);">
          No product selected. <a href="/products">Add a product</a> to get started.
        </div>
      ` : html`
        <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(260px,1fr));gap:20px;">
          ${card(
            '🎙',
            'Morning Audio Brief',
            'A 60-second spoken briefing delivered each morning. Hear your metrics, signals, and priorities.',
            '/ambient/audio',
            'View Audio Brief',
          )}
          ${card(
            '✉',
            'Weekly Email Digest',
            'A letter from your advisor — flowing prose, no bullet points. Sent every week.',
            '/ambient/email',
            'View Email Digest',
          )}
          ${card(
            '🎤',
            'Voice Reply',
            'Leave a 30-second voice note. We transcribe it and route decisions, approvals, and notes automatically.',
            '/ambient/voice',
            'Open Voice Reply',
          )}
        </div>
      `}
    </div>
  `;

  return c.html(dashboardLayout(ctx, content));
});

// ─── GET /ambient/audio — Audio Brief Page ─────────────────────────────────────

ambientRoutes.get('/ambient/audio', async (c) => {
  const founder = c.get('founder');
  const ctx = await getLayoutContext(founder, 'ambient', 'Morning Audio Brief', undefined, c);

  if (!ctx.productId) return c.redirect('/ambient');

  const today = new Date().toISOString().slice(0, 10);
  const result = await getOrGenerateAudioScript(ctx.productId, today).catch(() => null);

  const content = html`
    <div style="max-width:720px;">
      <div style="margin-bottom:1.5rem;">
        <a href="/ambient" style="font-size:0.85rem;color:var(--text-dim);text-decoration:none;">← Ambient Layer</a>
      </div>
      <h1 style="margin:0 0 0.5rem;">Morning Audio Brief</h1>
      <p style="margin:0 0 1.5rem;color:var(--text-dim);">Today's spoken briefing — ${today}</p>

      ${result ? html`
        ${result.audio_url ? html`
          <div style="margin-bottom:1.5rem;padding:16px;background:var(--surface);border-radius:8px;border:1px solid var(--border);">
            <p style="margin:0 0 8px;font-size:0.875rem;font-weight:600;">Listen</p>
            <audio controls style="width:100%;" src="${result.audio_url}"></audio>
          </div>
        ` : html`
          <div style="margin-bottom:1.5rem;padding:12px 16px;background:var(--surface-raised);border-radius:6px;font-size:0.85rem;color:var(--text-dim);">
            Audio playback unavailable. Set <code>ELEVENLABS_API_KEY</code> or <code>OPENAI_API_KEY</code> to enable TTS.
          </div>
        `}

        <div style="display:flex;flex-direction:column;gap:16px;">
          ${segment('Opening', result.script.intro)}
          ${segment('Metrics', result.script.metrics_segment)}
          ${segment('Top Signal', result.script.top_signal_segment)}
          ${segment('Agent Highlight', result.script.agent_highlight_segment)}
          ${segment('Action Items', result.script.action_items_segment)}
          ${segment('Closing', result.script.closing)}
        </div>

        <p style="margin:1rem 0 0;font-size:0.8rem;color:var(--text-muted);">
          Estimated duration: ~${result.script.estimated_duration_seconds}s
        </p>

        <form method="POST" action="/ambient/audio/generate" style="margin-top:1.5rem;">
          <button type="submit" style="padding:8px 16px;background:var(--surface);border:1px solid var(--border);border-radius:6px;cursor:pointer;font-size:0.875rem;">
            Regenerate Brief
          </button>
        </form>
      ` : html`
        <div style="padding:2rem;background:var(--surface);border-radius:8px;text-align:center;">
          <p style="color:var(--text-dim);margin:0 0 1rem;">No brief generated yet for today.</p>
          <form method="POST" action="/ambient/audio/generate">
            <button type="submit" style="padding:10px 20px;background:var(--accent);color:#fff;border:none;border-radius:6px;cursor:pointer;font-size:0.875rem;font-weight:600;">
              Generate Morning Brief
            </button>
          </form>
        </div>
      `}
    </div>
  `;

  return c.html(dashboardLayout(ctx, content));
});

function segment(label: string, text: string): string {
  return `
<div style="padding:16px;background:var(--surface);border:1px solid var(--border);border-radius:8px;">
  <div style="font-size:0.75rem;font-weight:700;text-transform:uppercase;letter-spacing:0.05em;color:var(--text-muted);margin-bottom:8px;">${label}</div>
  <p style="margin:0;font-size:0.9375rem;line-height:1.6;color:var(--text);">${text}</p>
</div>`;
}

// ─── POST /ambient/audio/generate ─────────────────────────────────────────────

ambientRoutes.post('/ambient/audio/generate', async (c) => {
  const founder = c.get('founder');
  const ctx = await getLayoutContext(founder, 'ambient', 'Audio Brief', undefined, c);
  if (!ctx.productId) return c.redirect('/ambient');

  const today = new Date().toISOString().slice(0, 10);
  try {
    await generateAudioBriefScript(ctx.productId, today);
  } catch {
    // non-fatal
  }

  return c.redirect('/ambient/audio');
});

// ─── GET /ambient/email — Email Digest Page ────────────────────────────────────

ambientRoutes.get('/ambient/email', async (c) => {
  const founder = c.get('founder');
  const ctx = await getLayoutContext(founder, 'ambient', 'Weekly Email Digest', undefined, c);

  if (!ctx.productId) return c.redirect('/ambient');

  const history = await getEmailDigestHistory(ctx.productId, 5).catch(() => []);

  const content = html`
    <div style="max-width:720px;">
      <div style="margin-bottom:1.5rem;">
        <a href="/ambient" style="font-size:0.85rem;color:var(--text-dim);text-decoration:none;">← Ambient Layer</a>
      </div>
      <h1 style="margin:0 0 0.5rem;">Weekly Email Digest</h1>
      <p style="margin:0 0 1.5rem;color:var(--text-dim);">A letter from your advisor, delivered weekly.</p>

      <!-- Generate -->
      <div style="padding:20px;background:var(--surface);border:1px solid var(--border);border-radius:8px;margin-bottom:1.5rem;">
        <h3 style="margin:0 0 12px;font-size:0.9rem;font-weight:600;">Generate New Digest</h3>
        <form method="POST" action="/ambient/email/generate" style="display:inline;">
          <button type="submit" style="padding:8px 16px;background:var(--surface-raised);border:1px solid var(--border);border-radius:6px;cursor:pointer;font-size:0.875rem;">
            Generate Digest
          </button>
        </form>
      </div>

      <!-- Send -->
      <div style="padding:20px;background:var(--surface);border:1px solid var(--border);border-radius:8px;margin-bottom:1.5rem;">
        <h3 style="margin:0 0 12px;font-size:0.9rem;font-weight:600;">Send Digest</h3>
        <form method="POST" action="/ambient/email/send" style="display:flex;gap:8px;flex-wrap:wrap;">
          <input
            type="email"
            name="email"
            placeholder="${founder.email ?? 'you@example.com'}"
            required
            style="flex:1;min-width:200px;padding:8px 12px;border:1px solid var(--border);border-radius:6px;background:var(--surface-raised);color:var(--text);font-size:0.875rem;"
          />
          <button type="submit" style="padding:8px 16px;background:var(--accent);color:#fff;border:none;border-radius:6px;cursor:pointer;font-size:0.875rem;font-weight:600;">
            Send Now
          </button>
        </form>
        ${!process.env.RESEND_API_KEY && !process.env.SENDGRID_API_KEY ? html`
          <p style="margin:8px 0 0;font-size:0.8rem;color:var(--text-muted);">
            Set <code>RESEND_API_KEY</code> or <code>SENDGRID_API_KEY</code> to enable email delivery.
          </p>
        ` : ''}
      </div>

      <!-- History -->
      ${history.length > 0 ? html`
        <div style="padding:20px;background:var(--surface);border:1px solid var(--border);border-radius:8px;">
          <h3 style="margin:0 0 12px;font-size:0.9rem;font-weight:600;">Sent History</h3>
          <table style="width:100%;border-collapse:collapse;font-size:0.875rem;">
            <thead>
              <tr style="border-bottom:1px solid var(--border);">
                <th style="text-align:left;padding:6px 8px;color:var(--text-muted);font-weight:500;">Week</th>
                <th style="text-align:left;padding:6px 8px;color:var(--text-muted);font-weight:500;">Subject</th>
                <th style="text-align:left;padding:6px 8px;color:var(--text-muted);font-weight:500;">Sent To</th>
                <th style="text-align:left;padding:6px 8px;color:var(--text-muted);font-weight:500;">Sent At</th>
              </tr>
            </thead>
            <tbody>
              ${history.map((h) => html`
                <tr style="border-bottom:1px solid var(--border-subtle);">
                  <td style="padding:8px;">${h.week_label}</td>
                  <td style="padding:8px;color:var(--text-dim);">${h.subject}</td>
                  <td style="padding:8px;color:var(--text-muted);">${h.sent_to ?? '—'}</td>
                  <td style="padding:8px;color:var(--text-muted);">${h.sent_at ?? '—'}</td>
                </tr>
              `)}
            </tbody>
          </table>
        </div>
      ` : html`
        <p style="color:var(--text-dim);font-size:0.875rem;">No digests sent yet.</p>
      `}
    </div>
  `;

  return c.html(dashboardLayout(ctx, content));
});

// ─── POST /ambient/email/generate ─────────────────────────────────────────────

ambientRoutes.post('/ambient/email/generate', async (c) => {
  const founder = c.get('founder');
  const ctx = await getLayoutContext(founder, 'ambient', 'Email Digest', undefined, c);
  if (!ctx.productId) return c.redirect('/ambient');

  try {
    await generateWeeklyEmailDigest(ctx.productId);
  } catch {
    // non-fatal
  }

  return c.redirect('/ambient/email');
});

// ─── POST /ambient/email/send ──────────────────────────────────────────────────

// Sends the company's digest to an address in the request body. Outward
// effect and company financials in one call, previously ungated.
ambientRoutes.post('/ambient/email/send',
  requireCompanyCapability('can_trigger_actions'), async (c) => {
  const founder = c.get('founder');
  const ctx = await getLayoutContext(founder, 'ambient', 'Email Digest', undefined, c);
  if (!ctx.productId) return c.redirect('/ambient');

  const body = await c.req.parseBody();
  const email = (body.email as string)?.trim();

  if (!email) return c.redirect('/ambient/email');

  try {
    await sendEmailDigest(ctx.productId, email);
  } catch {
    // non-fatal — redirect anyway
  }

  return c.redirect('/ambient/email');
});

// ─── GET /ambient/voice — Voice Reply UI ──────────────────────────────────────

ambientRoutes.get('/ambient/voice', async (c) => {
  const founder = c.get('founder');
  const ctx = await getLayoutContext(founder, 'ambient', 'Voice Reply', undefined, c);

  const today = new Date().toISOString().slice(0, 10);

  const content = html`
    <div style="max-width:640px;">
      <div style="margin-bottom:1.5rem;">
        <a href="/ambient" style="font-size:0.85rem;color:var(--text-dim);text-decoration:none;">← Ambient Layer</a>
      </div>
      <h1 style="margin:0 0 0.5rem;">Voice Reply</h1>
      <p style="margin:0 0 1.5rem;color:var(--text-dim);">Leave a 30-second voice note. We'll transcribe it and route it automatically.</p>

      ${!process.env.OPENAI_API_KEY ? html`
        <div style="padding:12px 16px;background:var(--surface-raised);border-radius:6px;font-size:0.85rem;color:var(--text-dim);margin-bottom:1rem;">
          Set <code>OPENAI_API_KEY</code> to enable voice transcription.
        </div>
      ` : ''}

      <div style="padding:24px;background:var(--surface);border:1px solid var(--border);border-radius:10px;">
        <!-- Context input -->
        <div style="margin-bottom:16px;">
          <label style="display:block;font-size:0.8rem;font-weight:600;color:var(--text-muted);margin-bottom:6px;text-transform:uppercase;letter-spacing:0.05em;">
            Replying to (briefing item or context)
          </label>
          <input
            id="voice-context"
            type="text"
            placeholder="e.g. MRR dropped 12% — retention issue flagged by CFO agent"
            style="width:100%;box-sizing:border-box;padding:10px 12px;border:1px solid var(--border);border-radius:6px;background:var(--surface-raised);color:var(--text);font-size:0.9rem;"
          />
        </div>

        <!-- Recorder -->
        <div style="display:flex;flex-direction:column;align-items:center;gap:16px;padding:24px 0;">
          <div id="recorder-status" style="font-size:0.875rem;color:var(--text-muted);">Click to start recording</div>
          <button
            id="record-btn"
            style="width:72px;height:72px;border-radius:50%;background:var(--accent);border:none;cursor:pointer;font-size:1.5rem;color:#fff;display:flex;align-items:center;justify-content:center;transition:transform 0.1s;"
            title="Start / Stop recording"
          >
            🎤
          </button>
          <div id="timer" style="font-size:1.5rem;font-weight:700;color:var(--text);display:none;">0:00</div>
        </div>

        <!-- Result -->
        <div id="voice-result" style="display:none;">
          <div style="border-top:1px solid var(--border);padding-top:16px;">
            <p style="font-size:0.8rem;font-weight:600;color:var(--text-muted);text-transform:uppercase;letter-spacing:0.05em;margin:0 0 8px;">Transcript</p>
            <p id="transcript-text" style="margin:0 0 12px;font-size:0.9375rem;line-height:1.5;color:var(--text);"></p>
            <p id="action-type-text" style="margin:0 0 4px;font-size:0.8rem;color:var(--text-dim);"></p>
            <p id="routed-to-text" style="margin:0;font-size:0.8rem;color:var(--text-muted);"></p>
          </div>
        </div>

        <div id="voice-error" style="display:none;padding:10px 12px;background:#ff6b6b22;border:1px solid #ff6b6b44;border-radius:6px;font-size:0.875rem;color:#ff6b6b;margin-top:12px;"></div>
      </div>

      <script>
        (function() {
          const btn = document.getElementById('record-btn');
          const status = document.getElementById('recorder-status');
          const timerEl = document.getElementById('timer');
          const resultEl = document.getElementById('voice-result');
          const errorEl = document.getElementById('voice-error');
          const contextInput = document.getElementById('voice-context');
          const transcriptEl = document.getElementById('transcript-text');
          const actionTypeEl = document.getElementById('action-type-text');
          const routedToEl = document.getElementById('routed-to-text');

          let mediaRecorder = null;
          let chunks = [];
          let timerInterval = null;
          let elapsed = 0;
          let recording = false;

          function formatTime(s) {
            return Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0');
          }

          function stopRecording() {
            if (mediaRecorder && mediaRecorder.state !== 'inactive') {
              mediaRecorder.stop();
            }
            clearInterval(timerInterval);
            btn.style.background = 'var(--accent)';
            btn.textContent = '🎤';
            status.textContent = 'Processing...';
            timerEl.style.display = 'none';
            recording = false;
          }

          btn.addEventListener('click', async function() {
            if (recording) {
              stopRecording();
              return;
            }

            errorEl.style.display = 'none';
            resultEl.style.display = 'none';

            try {
              const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
              chunks = [];
              const mimeType = MediaRecorder.isTypeSupported('audio/webm') ? 'audio/webm' : 'audio/mp4';
              mediaRecorder = new MediaRecorder(stream, { mimeType });

              mediaRecorder.ondataavailable = (e) => {
                if (e.data.size > 0) chunks.push(e.data);
              };

              mediaRecorder.onstop = async () => {
                stream.getTracks().forEach(t => t.stop());
                const blob = new Blob(chunks, { type: mediaRecorder.mimeType });
                const reader = new FileReader();
                reader.onloadend = async () => {
                  const dataUrl = reader.result;
                  const base64 = dataUrl.split(',')[1];
                  const context = contextInput.value.trim() || 'General voice reply';
                  const today = '${today}';

                  try {
                    const resp = await fetch('/ambient/voice/process', {
                      method: 'POST',
                      headers: { 'Content-Type': 'application/json' },
                      body: JSON.stringify({
                        audio_base64: base64,
                        mime_type: mediaRecorder.mimeType,
                        context: context,
                        briefing_date: today,
                      }),
                    });

                    if (!resp.ok) throw new Error('Server error ' + resp.status);

                    const data = await resp.json();
                    transcriptEl.textContent = data.transcript;
                    actionTypeEl.textContent = 'Action: ' + data.action_type;
                    routedToEl.textContent = 'Saved to: ' + data.routed_to;
                    resultEl.style.display = 'block';
                    status.textContent = 'Done! Voice note processed.';
                  } catch (err) {
                    errorEl.textContent = 'Error: ' + (err.message || 'Unknown error');
                    errorEl.style.display = 'block';
                    status.textContent = 'Click to start recording';
                  }
                };
                reader.readAsDataURL(blob);
              };

              mediaRecorder.start();
              recording = true;
              elapsed = 0;
              timerEl.style.display = 'block';
              timerEl.textContent = '0:00';
              btn.style.background = '#ff6b6b';
              btn.textContent = '⏹';
              status.textContent = 'Recording... (click to stop)';

              timerInterval = setInterval(() => {
                elapsed++;
                timerEl.textContent = formatTime(elapsed);
                if (elapsed >= 30) stopRecording();
              }, 1000);
            } catch (err) {
              errorEl.textContent = 'Microphone access denied or unavailable.';
              errorEl.style.display = 'block';
            }
          });
        })();
      </script>
    </div>
  `;

  return c.html(dashboardLayout(ctx, content));
});

// ─── POST /ambient/voice/process ──────────────────────────────────────────────

ambientRoutes.post('/ambient/voice/process', async (c) => {
  const founder = c.get('founder');
  const ctx = await getLayoutContext(founder, 'ambient', 'Voice Reply', undefined, c);
  if (!ctx.productId) return c.json({ error: 'No product selected' }, 400);

  let body: {
    audio_base64: string;
    mime_type: string;
    context: string;
    briefing_date: string;
    action_execution_id?: string;
  };

  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: 'Invalid JSON body' }, 400);
  }

  if (!body.audio_base64 || !body.mime_type) {
    return c.json({ error: 'audio_base64 and mime_type are required' }, 400);
  }

  try {
    const result = await processVoiceReply(ctx.productId, {
      // The speaker, not the category. Only the approval branch consults it,
      // and it decides whether this person may execute an effect at all.
      founder_id: founder.id,
      audio_base64: body.audio_base64,
      mime_type: body.mime_type,
      context: body.context ?? '',
      // Names the action being approved. Absent, a voice approval approves
      // nothing rather than approving whichever action happens to be newest.
      action_execution_id: typeof body.action_execution_id === 'string'
        ? body.action_execution_id : undefined,
      briefing_date: body.briefing_date ?? new Date().toISOString().slice(0, 10),
    });
    return c.json(result);
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    return c.json({ error: message }, 500);
  }
});
