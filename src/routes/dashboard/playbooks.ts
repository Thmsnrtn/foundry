// =============================================================================
// FOUNDRY — Playbook Dashboard
// View and generate crystallized founder playbooks from wisdom + decision history.
// =============================================================================

import { Hono } from 'hono';
import { html } from 'hono/html';
import type { AuthEnv } from '../../middleware/auth.js';
import { buildSharedContext } from './_shared.js';
import { dashboardLayout } from '../../views/layout.js';
import { generatePlaybook, getPlaybooks } from '../../services/playbook/generator.js';
import type { PlaybookType } from '../../types/index.js';

export const playbookRoutes = new Hono<AuthEnv>();

const PLAYBOOK_LABELS: Record<PlaybookType, { label: string; icon: string; description: string }> = {
  operating_principles: { label: 'Operating Principles', icon: '🧭', description: 'The heuristics that define how this company decides' },
  onboarding_kit: { label: 'Onboarding Kit', icon: '📋', description: 'Everything a new team member needs to know' },
  pricing_framework: { label: 'Pricing Framework', icon: '💰', description: 'How we think about and change pricing' },
  churn_response: { label: 'Churn Response', icon: '🚨', description: 'What to do when churn spikes' },
  activation_playbook: { label: 'Activation Playbook', icon: '⚡', description: 'Proven tactics for improving activation' },
  fundraising_narrative: { label: 'Fundraising Narrative', icon: '📣', description: 'The company story for investors' },
  competitive_response: { label: 'Competitive Response', icon: '🛡️', description: 'How to respond to competitive threats' },
  recovery_protocol: { label: 'Recovery Protocol', icon: '🔄', description: 'What to do in RED state' },
};

// ─── GET /playbooks ───────────────────────────────────────────────────────────

playbookRoutes.get('/playbooks', async (c) => {
  const founder = c.get('founder');
  const ctx = await buildSharedContext(c);
  if (!ctx.product) return c.redirect('/products');

  const existing = await getPlaybooks(ctx.product.id);
  const existingByType = new Map(existing.map((p) => [p.type, p]));

  const content = html`
    <div class="page-header">
      <h1>Playbooks</h1>
      <p class="page-subtitle">Operational intelligence crystallized from your decision history and founder wisdom.</p>
    </div>

    <div class="playbook-grid">
      ${Object.entries(PLAYBOOK_LABELS).map(([type, meta]) => {
        const existing = existingByType.get(type as PlaybookType);
        return html`
          <div class="playbook-card card ${existing ? 'has-playbook' : ''}">
            <div class="playbook-card-header">
              <span class="playbook-icon">${meta.icon}</span>
              <h3>${meta.label}</h3>
            </div>
            <p class="playbook-description">${meta.description}</p>
            ${existing ? html`
              <div class="playbook-meta">
                <span>v${existing.version}</span>
                <span>Generated ${new Date(existing.generated_at).toLocaleDateString()}</span>
                <span>${existing.source_decisions} decisions · ${existing.source_patterns} patterns</span>
              </div>
              <div class="playbook-actions">
                <a href="/playbooks/${type}" class="btn btn-primary btn-sm">View</a>
                <form method="POST" action="/playbooks/${type}/regenerate">
                  <button type="submit" class="btn btn-outline btn-sm">Regenerate</button>
                </form>
              </div>
            ` : html`
              <div class="playbook-actions">
                <form method="POST" action="/playbooks/${type}/generate">
                  <button type="submit" class="btn btn-primary btn-sm">Generate</button>
                </form>
              </div>
            `}
          </div>
        `;
      })}
    </div>
  `;

  return c.html(dashboardLayout(ctx, String(content), 'Playbooks'));
});

// ─── GET /playbooks/:type ─────────────────────────────────────────────────────

playbookRoutes.get('/playbooks/:type', async (c) => {
  const founder = c.get('founder');
  const type = c.req.param('type') as PlaybookType;
  const ctx = await buildSharedContext(c);
  if (!ctx.product) return c.redirect('/products');

  const meta = PLAYBOOK_LABELS[type];
  if (!meta) return c.notFound();

  const playbooks = await getPlaybooks(ctx.product.id);
  const playbook = playbooks.find((p) => p.type === type);

  if (!playbook) {
    return c.redirect(`/playbooks?generate=${type}`);
  }

  const content = html`
    <div class="page-header">
      <a href="/playbooks" class="back-link">← Playbooks</a>
      <div class="playbook-title-row">
        <span class="playbook-icon">${meta.icon}</span>
        <div>
          <h1>${playbook.title}</h1>
          <span class="playbook-version">v${playbook.version} · ${new Date(playbook.generated_at).toLocaleDateString()} · ${playbook.source_decisions} decisions, ${playbook.source_patterns} patterns, ${playbook.source_failures} failure records</span>
        </div>
      </div>
    </div>

    <div class="playbook-body">
      ${playbook.executive_summary ? html`
        <div class="playbook-section">
          <h2>Overview</h2>
          <p>${playbook.executive_summary}</p>
        </div>
      ` : ''}

      ${playbook.core_principles ? html`
        <div class="playbook-section">
          <h2>Core Principles</h2>
          <div class="playbook-prose">${playbook.core_principles}</div>
        </div>
      ` : ''}

      ${playbook.playbook_body ? html`
        <div class="playbook-section">
          <h2>Playbook</h2>
          <div class="playbook-prose">${playbook.playbook_body}</div>
        </div>
      ` : ''}

      ${playbook.anti_patterns ? html`
        <div class="playbook-section playbook-anti-patterns">
          <h2>Anti-Patterns</h2>
          <div class="playbook-prose">${playbook.anti_patterns}</div>
        </div>
      ` : ''}
    </div>

    <div class="playbook-actions-bar">
      <form method="POST" action="/playbooks/${type}/regenerate">
        <button type="submit" class="btn btn-outline">Regenerate</button>
      </form>
      <form method="POST" action="/playbooks/${type}/export">
        <select name="destination">
          <option value="markdown">Download Markdown</option>
          <option value="notion">Export to Notion</option>
          <option value="linear">Export to Linear</option>
        </select>
        <button type="submit" class="btn btn-primary">Export</button>
      </form>
    </div>
  `;

  return c.html(dashboardLayout(ctx, String(content), playbook.title));
});

// ─── POST /playbooks/:type/generate ──────────────────────────────────────────

playbookRoutes.post('/playbooks/:type/generate', async (c) => {
  const founder = c.get('founder');
  const type = c.req.param('type') as PlaybookType;
  const ctx = await buildSharedContext(c);
  if (!ctx.product) return c.redirect('/products');

  if (!PLAYBOOK_LABELS[type]) return c.notFound();

  try {
    await generatePlaybook(ctx.product.id, type);
    return c.redirect(`/playbooks/${type}`);
  } catch (err) {
    console.error('[playbooks] generation failed:', err);
    return c.redirect('/playbooks?error=generation_failed');
  }
});

// ─── POST /playbooks/:type/regenerate ────────────────────────────────────────

playbookRoutes.post('/playbooks/:type/regenerate', async (c) => {
  const founder = c.get('founder');
  const type = c.req.param('type') as PlaybookType;
  const ctx = await buildSharedContext(c);
  if (!ctx.product) return c.redirect('/products');

  if (!PLAYBOOK_LABELS[type]) return c.notFound();

  try {
    await generatePlaybook(ctx.product.id, type);
    return c.redirect(`/playbooks/${type}?regenerated=1`);
  } catch (err) {
    console.error('[playbooks] regeneration failed:', err);
    return c.redirect(`/playbooks/${type}?error=regeneration_failed`);
  }
});
