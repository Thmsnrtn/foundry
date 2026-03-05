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
  return c.html(publicLayout('Autonomous Business Intelligence', html`
    <script async crossorigin="anonymous" src="https://unpkg.com/@clerk/clerk-js/dist/clerk.browser.js" data-clerk-publishable-key="${publishableKey}"></script>
    <script>window.addEventListener('load',async()=>{if(window.Clerk){await Clerk.load();if(Clerk.user){window.location.href='/dashboard';}}})</script>
    <div class="hero">
      <h1>Stop building your product<br/>and ignoring your business.</h1>
      <p>Foundry is the autonomous operating system for SaaS founders. It audits your codebase, monitors your revenue, anticipates risk, and operates your business intelligence layer — so you can focus on building.</p>
      <a href="/auth/signup" class="btn btn-primary">Get Started</a>
    </div>
    <div class="features">
      <div class="feature-card">
        <h3>10-Dimension Audit</h3>
        <p>Connect your GitHub repo. Get a scored assessment across functional completeness, trust density, operational readiness, and 7 more dimensions — in minutes.</p>
      </div>
      <div class="feature-card">
        <h3>Anticipatory Intelligence</h3>
        <p>Stressor reports identify risks before they become problems. MRR decomposition reveals whether your revenue is healthy or hollow. Cohort analysis shows which users actually retain.</p>
      </div>
      <div class="feature-card">
        <h3>Decision Queue</h3>
        <p>Every decision surfaced with context, options, trade-offs, and scenario models. Gate 3 decisions include forward projections at 30, 60, and 90 days informed by cross-product patterns.</p>
      </div>
      <div class="feature-card">
        <h3>Risk-Adaptive Behavior</h3>
        <p>The system changes how it operates based on your product's risk state. Green means standard operation. Yellow means heightened monitoring. Red means recovery protocol.</p>
      </div>
      <div class="feature-card">
        <h3>Competitive Intelligence</h3>
        <p>Weekly scans detect competitor pricing changes, feature launches, and positioning shifts. High-significance signals automatically create stressors and inform your weekly digest.</p>
      </div>
      <div class="feature-card">
        <h3>Founding Story Engine</h3>
        <p>Every audit, every decision, every risk event is captured and timestamped. Publish case studies with cryptographic proof of when evidence was generated.</p>
      </div>
    </div>
    <div class="page-footer">Foundry — Autonomous Business Intelligence for SaaS Founders</div>
  `));
});

pricingRoutes.get('/pricing', async (c) => {
  return c.html(publicLayout('Pricing', html`
    <h1 style="text-align:center;margin-top:2rem;">Pricing</h1>
    <p style="text-align:center;color:#6b7280;margin-bottom:2rem;">Autonomous business intelligence for SaaS founders.</p>
    <div class="pricing-grid">
      <div class="pricing-card">
        <div class="pricing-tier">Solo</div>
        <div class="pricing-price">$79<span>/month</span></div>
        <p style="font-size:0.85rem;color:#6b7280;margin-bottom:1rem;">For solo founders getting started.</p>
        <ul class="pricing-features">
          <li>Signal score + risk state monitoring</li>
          <li>AI Ask — conversational business advisor</li>
          <li>Decision queue with gate system</li>
          <li>Weekly digest + lifecycle tracking</li>
          <li>iOS app, widgets, and Watch complication</li>
          <li>Morning voice briefings</li>
          <li>1 product</li>
        </ul>
        <a href="/auth/signup" class="btn btn-secondary" style="width:100%;margin-top:1rem;">Get Started</a>
      </div>
      <div class="pricing-card featured">
        <div class="pricing-tier">Growth</div>
        <div class="pricing-price">$199<span>/month</span></div>
        <p style="font-size:0.85rem;color:#6b7280;margin-bottom:1rem;">For teams scaling with data and co-founders.</p>
        <ul class="pricing-features">
          <li>Everything in Solo</li>
          <li>Live integrations — Stripe, PostHog, Intercom, Linear</li>
          <li>Co-founder mode — alignment scores, decision voting</li>
          <li>Intelligence Network — anonymized peer benchmarks</li>
          <li>Wisdom Layer — product DNA accumulation</li>
          <li>Remediation Engine — automated GitHub PRs</li>
          <li>Up to 3 team members</li>
        </ul>
        <a href="/auth/signup" class="btn btn-primary" style="width:100%;margin-top:1rem;">Get Started</a>
      </div>
      <div class="pricing-card">
        <div class="pricing-tier">Investor-Ready</div>
        <div class="pricing-price">$399<span>/month</span></div>
        <p style="font-size:0.85rem;color:#6b7280;margin-bottom:1rem;">For founders approaching or managing investors.</p>
        <ul class="pricing-features">
          <li>Everything in Growth</li>
          <li>Board packets — AI-drafted quarterly narratives</li>
          <li>Funding readiness score across 7 dimensions</li>
          <li>Secure investor deal rooms with live Signal share</li>
          <li>Playbook crystallization — 8 operating playbook types</li>
          <li>Temporal Intelligence — Signal replay + prediction accuracy</li>
          <li>Cohort analysis + competitive intelligence</li>
          <li>Founding Story Engine with timestamped case studies</li>
          <li>Unlimited team members + multi-product (up to 5)</li>
        </ul>
        <a href="/auth/signup" class="btn btn-secondary" style="width:100%;margin-top:1rem;">Get Started</a>
      </div>
    </div>
    <div class="page-footer">All plans include the iOS native app. Cancel anytime.</div>
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
