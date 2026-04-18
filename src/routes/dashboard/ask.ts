// =============================================================================
// FOUNDRY — Ask Foundry Dashboard Page
// Conversational AI interface for natural language product questions.
// =============================================================================

import { Hono } from 'hono';
import { html } from 'hono/html';
import type { AuthEnv } from '../../middleware/auth.js';
import { dashboardLayout } from '../../views/layout.js';
import { getLayoutContext } from './_shared.js';

export const askPageRoutes = new Hono<AuthEnv>();

askPageRoutes.get('/dashboard/ask', async (c) => {
  const founder = c.get('founder');
  const ctx = await getLayoutContext(founder, 'dashboard', 'Ask Foundry', undefined, c);
  const productId = ctx.productId;

  const content = html`
    <h1>Ask Foundry</h1>
    <p style="color:var(--color-text-muted);margin-bottom:1.5rem;">Ask anything about your product's health, metrics, risks, or strategy. Foundry answers using your real data.</p>

    <div class="card" style="padding:1.5rem;">
      <div class="ask-input-wrapper">
        <input type="text" class="ask-input" id="ask-input" placeholder="How's my product doing? Why is churn increasing? Should I raise prices?"
          autocomplete="off" autofocus />
        <button class="ask-submit" id="ask-btn" onclick="askFoundry()">Ask</button>
      </div>

      <div id="ask-history" style="margin-top:1rem;">
        <!-- Conversation will appear here -->
      </div>
    </div>

    <div class="card" style="background:var(--color-primary-subtle);">
      <h3 style="margin-bottom:0.5rem;">Example questions</h3>
      <div style="display:flex;flex-wrap:wrap;gap:0.5rem;">
        ${['How is my product doing?', 'What should I focus on this week?', 'Why is my churn rate increasing?', 'Should I raise my prices?', 'What are my biggest risks right now?', 'How does my retention compare to last month?'].map((q) => html`
          <button class="btn btn-secondary btn-sm" onclick="document.getElementById('ask-input').value='${q}';askFoundry()" style="font-size:0.8rem;">${q}</button>
        `)}
      </div>
    </div>

    <script>
      async function askFoundry() {
        const input = document.getElementById('ask-input');
        const history = document.getElementById('ask-history');
        const btn = document.getElementById('ask-btn');
        const question = input.value.trim();
        if (!question) return;

        // Show question
        history.insertAdjacentHTML('beforeend',
          '<div style="margin-bottom:1rem;"><div style="font-weight:600;font-size:0.9rem;margin-bottom:0.25rem;">You</div><div style="color:var(--color-text-secondary);font-size:0.9rem;">' + question.replace(/</g,'&lt;') + '</div></div>'
        );
        input.value = '';
        btn.disabled = true;
        btn.textContent = '...';

        // Show loading
        const loadingId = 'loading-' + Date.now();
        history.insertAdjacentHTML('beforeend',
          '<div id="' + loadingId + '" style="margin-bottom:1rem;"><div style="font-weight:600;font-size:0.9rem;margin-bottom:0.25rem;color:var(--color-primary);">Foundry</div><div class="spinner" style="width:16px;height:16px;"></div></div>'
        );

        try {
          const res = await fetch('/api/ask', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ question, product_id: '${productId ?? ''}' }),
          });
          const data = await res.json();
          document.getElementById(loadingId).innerHTML =
            '<div style="font-weight:600;font-size:0.9rem;margin-bottom:0.25rem;color:var(--color-primary);">Foundry</div>' +
            '<div style="font-size:0.9rem;line-height:1.7;color:var(--color-text);">' + (data.answer || 'Unable to generate a response.').replace(/\\n/g, '<br>') + '</div>';
        } catch (err) {
          document.getElementById(loadingId).innerHTML =
            '<div style="font-weight:600;font-size:0.9rem;color:var(--color-danger);">Error</div><div style="font-size:0.9rem;color:var(--color-text-muted);">Something went wrong. Please try again.</div>';
        }

        btn.disabled = false;
        btn.textContent = 'Ask';
        history.scrollTop = history.scrollHeight;
      }

      document.getElementById('ask-input').addEventListener('keydown', function(e) {
        if (e.key === 'Enter') askFoundry();
      });
    </script>
  `;

  return c.html(dashboardLayout(ctx, content));
});
