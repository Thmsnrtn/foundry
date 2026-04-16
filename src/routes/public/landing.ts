// =============================================================================
// FOUNDRY — Public Routes (no auth required)
// =============================================================================

import { Hono } from 'hono';
import { html } from 'hono/html';
import { query } from '../../db/client.js';
import { publicLayout } from '../../views/layout.js';

export const landingRoutes = new Hono();
export const pricingRoutes = new Hono();
export const caseStudyRoutes = new Hono();

landingRoutes.get('/', (c) => {
  const publishableKey = process.env.CLERK_PUBLISHABLE_KEY ?? '';
  return c.html(publicLayout('Give Your Product a Team', html`
    <script async crossorigin="anonymous" src="https://unpkg.com/@clerk/clerk-js/dist/clerk.browser.js" data-clerk-publishable-key="${publishableKey}"></script>
    <script>window.addEventListener('load',async()=>{if(window.Clerk){await Clerk.load();if(Clerk.user){window.location.href='/dashboard';}}})</script>

    <div class="hero" style="text-align:center;padding:4rem 1rem 3rem;">
      <div style="font-size:0.7rem;font-weight:700;letter-spacing:0.18em;text-transform:uppercase;color:var(--accent);margin-bottom:1.25rem;">Sovereign Company Protocol</div>
      <h1 style="font-size:clamp(2rem,5vw,3.25rem);line-height:1.15;margin:0 0 1.25rem;max-width:760px;margin-left:auto;margin-right:auto;">
        Connect your product.<br/>Get a company.
      </h1>
      <p style="font-size:1.05rem;color:var(--text-dim);max-width:580px;margin:0 auto 2rem;line-height:1.6;">
        Foundry gives your SaaS product a team of 12 specialized AI agents — Atlas the CTO,
        Oracle the analyst, Harbor for customer success, Beacon the CMO, and 8 more.
        They operate, learn, and grow your business while you sleep.
      </p>
      <div style="display:flex;gap:1rem;justify-content:center;flex-wrap:wrap;">
        <a href="/auth/signup" class="btn btn-primary" style="padding:0.75rem 2rem;font-size:1rem;">Give my product a team →</a>
        <a href="/pricing" class="btn btn-ghost" style="padding:0.75rem 1.5rem;font-size:1rem;">See pricing</a>
      </div>
    </div>

    <div style="max-width:900px;margin:0 auto;padding:0 1rem 3rem;">

      <!-- The vision statement -->
      <div class="card" style="text-align:center;padding:2.5rem;margin-bottom:2.5rem;border:1px solid rgba(108,99,255,0.2);">
        <p style="font-size:1.05rem;line-height:1.7;color:var(--text-primary);margin:0;font-style:italic;">
          "A founder opens Foundry, connects their product, and gets a company.
          Not a dashboard. Not a chatbot. A company — with a team of specialized AI agents
          that market, sell, support, analyze, and improve their product while they sleep."
        </p>
      </div>

      <!-- The 12 agents -->
      <div style="margin-bottom:2.5rem;">
        <div style="font-size:0.7rem;font-weight:700;letter-spacing:0.14em;text-transform:uppercase;color:var(--text-dim);margin-bottom:1.25rem;text-align:center;">Your AI Team</div>
        <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(190px,1fr));gap:0.75rem;">
          ${[
            ['Atlas', 'CTO', 'Code quality · architecture · technical debt'],
            ['Compass', 'Product', 'Roadmap · lifecycle · feature priority'],
            ['Prism', 'UX Lead', 'Onboarding · friction · activation'],
            ['Beacon', 'CMO', 'Marketing · acquisition · positioning'],
            ['Scribe', 'Content', 'Blog posts · docs · case studies'],
            ['Forge', 'Revenue', 'Pricing · conversion · expansion'],
            ['Harbor', 'CS', 'Retention · health monitoring · outreach'],
            ['Sentinel', 'DevOps', 'Infrastructure · uptime · deployments'],
            ['Ledger', 'CFO', 'Revenue tracking · financial health · ROI'],
            ['Shield', 'Compliance', 'Legal risk · privacy · terms'],
            ['Oracle', 'Analytics', 'Data analysis · stressors · trends'],
            ['Crucible', 'QA', 'Test coverage · quality gates · regressions'],
          ].map(([name, role, domain]) => html`
            <div class="card" style="padding:1rem;">
              <div style="font-weight:700;color:var(--accent);font-size:0.95rem;">${name}</div>
              <div style="font-size:0.72rem;color:var(--text-dim);font-weight:600;text-transform:uppercase;letter-spacing:0.06em;margin-bottom:0.35rem;">${role}</div>
              <div style="font-size:0.78rem;color:var(--text-muted);line-height:1.4;">${domain}</div>
            </div>
          `)}
        </div>
      </div>

      <!-- How it works -->
      <div style="margin-bottom:2.5rem;">
        <div style="font-size:0.7rem;font-weight:700;letter-spacing:0.14em;text-transform:uppercase;color:var(--text-dim);margin-bottom:1.25rem;text-align:center;">How It Works</div>
        <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(210px,1fr));gap:1rem;">
          <div class="card" style="padding:1.25rem;">
            <div style="font-size:1.5rem;margin-bottom:0.5rem;">1</div>
            <h3 style="margin:0 0 0.5rem;font-size:0.95rem;">Connect your product</h3>
            <p style="margin:0;font-size:0.82rem;color:var(--text-dim);line-height:1.5;">Link your GitHub repo, fill in your Company DNA — ICP, positioning, voice, market insight.</p>
          </div>
          <div class="card" style="padding:1.25rem;">
            <div style="font-size:1.5rem;margin-bottom:0.5rem;">2</div>
            <h3 style="margin:0 0 0.5rem;font-size:0.95rem;">Agents activate</h3>
            <p style="margin:0;font-size:0.82rem;color:var(--text-dim);line-height:1.5;">12 agents spin up. They start cautious, run on their cadences, and earn trust by being right.</p>
          </div>
          <div class="card" style="padding:1.25rem;">
            <div style="font-size:1.5rem;margin-bottom:0.5rem;">3</div>
            <h3 style="margin:0 0 0.5rem;font-size:0.95rem;">Read your briefing</h3>
            <p style="margin:0;font-size:0.82rem;color:var(--text-dim);line-height:1.5;">Every morning, one briefing from your company. What they did. What needs your approval. What's working.</p>
          </div>
          <div class="card" style="padding:1.25rem;">
            <div style="font-size:1.5rem;margin-bottom:0.5rem;">4</div>
            <h3 style="margin:0 0 0.5rem;font-size:0.95rem;">Agents evolve</h3>
            <p style="margin:0;font-size:0.82rem;color:var(--text-dim);line-height:1.5;">Every correction you make becomes a golden lesson. Every session makes the next one better. Trust compounds.</p>
          </div>
        </div>
      </div>

      <!-- The evolution engine highlight -->
      <div class="card" style="padding:2rem;margin-bottom:2.5rem;border-left:3px solid var(--accent);">
        <h3 style="margin:0 0 0.75rem;">Agents that learn</h3>
        <p style="margin:0 0 0.75rem;color:var(--text-dim);line-height:1.6;font-size:0.9rem;">
          Every time you correct an agent, that correction becomes a <strong style="color:var(--text-primary);">golden lesson</strong>
          injected into every future session. Agents track their own version history. Day 1 agents operate at
          maximum oversight. Agents that prove themselves earn autonomy.
        </p>
        <p style="margin:0;color:var(--text-dim);line-height:1.6;font-size:0.9rem;">
          After 50 sessions with a 91% success rate, an agent transitions from Level 2 (approval required) to Level 0
          (fully autonomous). <strong style="color:var(--text-primary);">You set the pace. They earn the trust.</strong>
        </p>
      </div>

      <!-- Daily briefing example -->
      <div style="margin-bottom:2.5rem;">
        <div style="font-size:0.7rem;font-weight:700;letter-spacing:0.14em;text-transform:uppercase;color:var(--text-dim);margin-bottom:1.25rem;text-align:center;">Your Daily CEO Briefing</div>
        <div class="card" style="padding:1.75rem;font-family:monospace;font-size:0.82rem;line-height:1.7;color:var(--text-primary);">
          <div style="color:var(--accent);font-weight:700;margin-bottom:0.5rem;">ACREOS · CEO BRIEFING · March 30, 2026</div>
          <div style="color:var(--text-dim);margin-bottom:1rem;">Signal: 87/100 ↑+3 · Risk: GREEN · Health: 91/100</div>
          <div style="margin-bottom:0.75rem;"><strong>Overnight:</strong></div>
          <div style="color:var(--text-dim);margin-bottom:0.25rem;">→ Atlas: Closed a security gap in the auth flow automatically.</div>
          <div style="color:var(--text-dim);margin-bottom:0.25rem;">→ Oracle: Churn improved 0.4% this week — retention emails working.</div>
          <div style="color:#ffb347;margin-bottom:1rem;">→ Harbor: 3 trial users went silent after onboarding. Suspects step 3 friction.</div>
          <div style="margin-bottom:0.75rem;"><strong>Decisions waiting (2):</strong></div>
          <div style="color:var(--text-dim);margin-bottom:0.25rem;">  [1] Beacon: Publish case study from last 3 wins. Est. 2-4 leads. <span style="color:var(--accent);">[Approve]</span></div>
          <div style="color:var(--text-dim);margin-bottom:1rem;">  [2] Harbor: Re-engagement campaign for 12 silent users. $240/mo impact. <span style="color:var(--accent);">[Approve]</span></div>
          <div style="color:var(--text-dim);">MRR: $4,230 ↑$340 · AI Cost: $12.40 · ROI: 14.2x</div>
        </div>
      </div>

      <!-- CTA -->
      <div style="text-align:center;padding:2rem 0;">
        <h2 style="margin:0 0 1rem;">Your product deserves a team.</h2>
        <p style="color:var(--text-dim);margin:0 0 1.5rem;">Connect it to Foundry today.</p>
        <a href="/auth/signup" class="btn btn-primary" style="padding:0.875rem 2.5rem;font-size:1.05rem;">Get Started Free</a>
      </div>

    </div>

    <div class="page-footer" style="text-align:center;padding:1.5rem;color:var(--text-muted);font-size:0.8rem;">
      Foundry — Sovereign Company Platform for SaaS Founders
    </div>
  `));
});

pricingRoutes.get('/pricing', async (c) => {
  return c.html(publicLayout('Pricing — Foundry', html`
    <div style="max-width:960px;margin:0 auto;padding:2rem 1rem;">
      <h1 style="text-align:center;margin-bottom:0.5rem;">Give your product a team.</h1>
      <p style="text-align:center;color:var(--text-dim);margin-bottom:2.5rem;font-size:0.95rem;">All plans include 12 AI agents, CEO briefings, and the evolution engine.</p>
      <div class="pricing-grid">
        <div class="pricing-card">
          <div class="pricing-tier">Solo</div>
          <div class="pricing-price">$79<span>/month</span></div>
          <p style="font-size:0.82rem;color:var(--text-dim);margin-bottom:1rem;">One company. Full agent team. For solo founders.</p>
          <ul class="pricing-features">
            <li>1 company · 12 AI agents</li>
            <li>Daily CEO briefing</li>
            <li>Agent evolution — golden lessons, versioned configs</li>
            <li>Signal score + risk state monitoring</li>
            <li>AI Ask — conversational business advisor</li>
            <li>Decision queue (Gate 0–4)</li>
            <li>iOS app + voice briefings + Watch complication</li>
          </ul>
          <a href="/auth/signup" class="btn btn-secondary" style="width:100%;margin-top:1rem;text-align:center;">Get Started</a>
        </div>
        <div class="pricing-card featured">
          <div class="pricing-tier">Growth</div>
          <div class="pricing-price">$199<span>/month</span></div>
          <p style="font-size:0.82rem;color:var(--text-dim);margin-bottom:1rem;">Live integrations + Intelligence Network. For scaling teams.</p>
          <ul class="pricing-features">
            <li>Everything in Solo</li>
            <li>Live integrations — Stripe, PostHog, Intercom, Linear</li>
            <li>Agents use live integration data for richer analysis</li>
            <li>Co-founder mode — alignment scores, decision voting</li>
            <li>Intelligence Network — anonymized peer benchmarks</li>
            <li>Wisdom Layer — DNA accumulation, failure log, patterns</li>
            <li>Remediation Engine — automated GitHub PRs</li>
            <li>Up to 3 team members</li>
          </ul>
          <a href="/auth/signup" class="btn btn-primary" style="width:100%;margin-top:1rem;text-align:center;">Get Started</a>
        </div>
        <div class="pricing-card">
          <div class="pricing-tier">Investor-Ready</div>
          <div class="pricing-price">$399<span>/month</span></div>
          <p style="font-size:0.82rem;color:var(--text-dim);margin-bottom:1rem;">Full platform + investor layer. For founders approaching investors.</p>
          <ul class="pricing-features">
            <li>Everything in Growth</li>
            <li>Up to 5 companies (agent teams per company)</li>
            <li>Board packets — AI-drafted quarterly narratives</li>
            <li>Funding readiness score across 7 dimensions</li>
            <li>Secure investor deal rooms with live Signal share</li>
            <li>Playbook crystallization — 8 operating playbook types</li>
            <li>Temporal Intelligence — Signal replay + prediction accuracy</li>
            <li>Cohort analysis + competitive intelligence</li>
            <li>Founding Story Engine with timestamped case studies</li>
            <li>Unlimited team members</li>
          </ul>
          <a href="/auth/signup" class="btn btn-secondary" style="width:100%;margin-top:1rem;text-align:center;">Get Started</a>
        </div>
      </div>
      <div style="text-align:center;margin-top:2rem;color:var(--text-muted);font-size:0.82rem;">
        All plans include the iOS native app, agent evolution, and CEO briefings. Cancel anytime.
      </div>
    </div>
  `));
});

caseStudyRoutes.get('/case-studies', async (c) => {
  const result = await query(
    "SELECT * FROM founding_story_artifacts WHERE published = 1 ORDER BY created_at DESC", []
  );
  const artifacts = result.rows as unknown as Array<Record<string, unknown>>;
  return c.html(publicLayout('Case Studies', html`
    <h1>Case Studies</h1>
    <p>Documented evidence from real products, timestamped and verifiable.</p>
    ${artifacts.length === 0
      ? html`<div class="empty-state"><p>No published case studies yet. Check back soon.</p></div>`
      : html`<div style="display:flex;flex-direction:column;gap:0.75rem;margin-top:1rem;">
        ${artifacts.map((a) => html`
          <a href="/case-studies/${a.id}" class="card" style="text-decoration:none;color:inherit;">
            <h3>${a.title}</h3>
            <span class="badge badge-watch">${a.artifact_type}</span>
            <span style="color:#6b7280;font-size:0.87rem;margin-left:0.5rem;">${a.phase}</span>
          </a>
        `)}
      </div>`}
  `));
});

caseStudyRoutes.get('/case-studies/:id', async (c) => {
  const id = c.req.param('id');
  const result = await query('SELECT * FROM founding_story_artifacts WHERE id = ? AND published = 1', [id]);
  if (result.rows.length === 0) return c.notFound();
  const artifact = result.rows[0] as Record<string, unknown>;
  return c.html(publicLayout(artifact.title as string, html`
    <h1>${artifact.title}</h1>
    <div style="display:flex;gap:1rem;margin-bottom:1rem;">
      <span class="badge badge-watch">${artifact.artifact_type}</span>
      <span style="color:#6b7280;font-size:0.87rem;">${artifact.phase}</span>
      <span style="color:#9ca3af;font-size:0.8rem;">Created: ${artifact.created_at}</span>
    </div>
    <div class="card">${artifact.content}</div>
  `));
});
