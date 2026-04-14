// =============================================================================
// FOUNDRY — Public Routes (no auth required)
// =============================================================================

import { Hono } from 'hono';
import { html } from 'hono/html';
import { query } from '../../db/client.js';
import { getFoundingCohortSlotCount } from '../../services/billing/stripe.js';
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
      <h1>Your product needs a COO.<br/>Meet your AI one.</h1>
      <p>Foundry audits your codebase, monitors revenue health, anticipates risk, surfaces decisions with context — and learns how you think. The autonomous operating system for SaaS founders who build alone.</p>
      <div style="display:flex;gap:1rem;justify-content:center;flex-wrap:wrap;">
        <a href="/auth/signup" class="btn btn-primary" style="font-size:1rem;padding:0.75rem 2rem;">Start Free Audit</a>
        <a href="/pricing" class="btn btn-secondary" style="font-size:1rem;padding:0.75rem 2rem;">View Pricing</a>
      </div>
    </div>

    <!-- How it works -->
    <div style="max-width:800px;margin:3rem auto;text-align:center;">
      <h2 style="margin-bottom:2rem;">How Foundry Works</h2>
      <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:2rem;">
        <div>
          <div style="font-size:2rem;margin-bottom:0.5rem;">1</div>
          <h3 style="font-size:1rem;">Connect GitHub</h3>
          <p style="font-size:0.87rem;color:#6b7280;">Read-only access. Foundry analyzes your codebase structure, not your proprietary logic.</p>
        </div>
        <div>
          <div style="font-size:2rem;margin-bottom:0.5rem;">2</div>
          <h3 style="font-size:1rem;">Get Your Score</h3>
          <p style="font-size:0.87rem;color:#6b7280;">10-dimension audit in minutes. Know exactly where your product stands — and where it doesn't.</p>
        </div>
        <div>
          <div style="font-size:2rem;margin-bottom:0.5rem;">3</div>
          <h3 style="font-size:1rem;">Add Metrics</h3>
          <p style="font-size:0.87rem;color:#6b7280;">Revenue, retention, activation. Enter manually or integrate via API. Intelligence activates automatically.</p>
        </div>
        <div>
          <div style="font-size:2rem;margin-bottom:0.5rem;">4</div>
          <h3 style="font-size:1rem;">Operate</h3>
          <p style="font-size:0.87rem;color:#6b7280;">Weekly digests, stressor alerts, decision queue, competitive intel. Foundry learns your judgment over time.</p>
        </div>
      </div>
    </div>

    <div class="features">
      <div class="feature-card">
        <h3>10-Dimension Audit</h3>
        <p>Scored assessment across functional completeness, trust density, operational readiness, commercial integrity, and 6 more dimensions. Blocking issues identified with evidence and fix suggestions.</p>
      </div>
      <div class="feature-card">
        <h3>Revenue Intelligence</h3>
        <p>MRR decomposition into new, expansion, contraction, and churned revenue. Health ratio tracks whether your growth is real or hollow. Stressor alerts when metrics deviate.</p>
      </div>
      <div class="feature-card">
        <h3>Decision Queue</h3>
        <p>Decisions surfaced with context, options, trade-offs, and scenario models. Gate 3 decisions include 30/60/90-day projections calibrated by cross-product patterns.</p>
      </div>
      <div class="feature-card">
        <h3>Risk-Adaptive System</h3>
        <p>Green: standard ops. Yellow: heightened monitoring + Thursday pulse. Red: daily recovery briefings + Gate 0/1 suspended. The system adapts its behavior to your state.</p>
      </div>
      <div class="feature-card">
        <h3>Wisdom Layer</h3>
        <p>Teach Foundry your ICP, positioning, and voice. Log failures. After 3+ resolved decisions, it synthesizes your judgment patterns and calibrates every recommendation to how you think.</p>
      </div>
      <div class="feature-card">
        <h3>Auto-Remediation</h3>
        <p>For blocking issues that are programmatically fixable, Foundry generates code changes and opens GitHub PRs. Review, merge, and your audit score recalculates.</p>
      </div>
    </div>

    <!-- Social proof -->
    <div style="max-width:700px;margin:3rem auto;text-align:center;">
      <h2 style="margin-bottom:0.5rem;">Built for Solo Founders</h2>
      <p style="color:#6b7280;margin-bottom:2rem;">Foundry replaces the operational layer that well-funded startups build with a team of 5. You get the same intelligence with zero headcount.</p>
      <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(200px,1fr));gap:1.5rem;text-align:left;">
        <div class="card" style="border-left:3px solid #2563eb;">
          <p style="font-size:0.9rem;font-style:italic;color:#374151;">"I went from guessing to knowing. The stressor report caught a churn spike before it became a crisis."</p>
          <p style="font-size:0.8rem;color:#6b7280;margin-top:0.5rem;">— Founding Cohort Member</p>
        </div>
        <div class="card" style="border-left:3px solid #2563eb;">
          <p style="font-size:0.9rem;font-style:italic;color:#374151;">"The audit scored us 4.8 on trust density. Two weeks later with Foundry's remediation PRs, we were at 7.2."</p>
          <p style="font-size:0.8rem;color:#6b7280;margin-top:0.5rem;">— Founding Cohort Member</p>
        </div>
        <div class="card" style="border-left:3px solid #2563eb;">
          <p style="font-size:0.9rem;font-style:italic;color:#374151;">"Monday digest is the first thing I read. It tells me exactly what happened and what to do about it."</p>
          <p style="font-size:0.8rem;color:#6b7280;margin-top:0.5rem;">— Founding Cohort Member</p>
        </div>
      </div>
    </div>

    <!-- FAQ -->
    <div style="max-width:700px;margin:3rem auto;">
      <h2 style="text-align:center;margin-bottom:1.5rem;">Questions</h2>
      <details class="card" style="margin-bottom:0.5rem;">
        <summary style="font-weight:600;">What data does Foundry access?</summary>
        <p style="margin-top:0.5rem;font-size:0.9rem;color:#4b5563;">Read-only access to your GitHub repository structure and file contents. We analyze architecture, configuration, and operational patterns — not your proprietary business logic or customer data.</p>
      </details>
      <details class="card" style="margin-bottom:0.5rem;">
        <summary style="font-weight:600;">How long until I see value?</summary>
        <p style="margin-top:0.5rem;font-size:0.9rem;color:#4b5563;">Your audit score and blocking issues are ready in 2-4 minutes. Once you enter revenue metrics, stressor reports and risk assessment activate within the week. The Wisdom Layer calibrates over your first 3+ decisions.</p>
      </details>
      <details class="card" style="margin-bottom:0.5rem;">
        <summary style="font-weight:600;">What's the Founding Cohort?</summary>
        <p style="margin-top:0.5rem;font-size:0.9rem;color:#4b5563;">30 slots at $99/month, locked for life. In exchange, we ask for participation in a case study after 90 days. You get full platform access, direct founder access, and early features. Once 30 slots fill, new users start at $199/month.</p>
      </details>
      <details class="card" style="margin-bottom:0.5rem;">
        <summary style="font-weight:600;">Can I cancel anytime?</summary>
        <p style="margin-top:0.5rem;font-size:0.9rem;color:#4b5563;">Yes. Monthly billing, cancel anytime. Your data is exportable via GDPR-compliant data export. If you're a Founding Cohort member and cancel, your slot opens for the next founder.</p>
      </details>
      <details class="card" style="margin-bottom:0.5rem;">
        <summary style="font-weight:600;">Is my data secure?</summary>
        <p style="margin-top:0.5rem;font-size:0.9rem;color:#4b5563;">GitHub tokens encrypted at rest (AES-256-GCM). All API traffic over HTTPS. Clerk handles authentication. Stripe handles billing. We never store payment information. Full audit trail of every system action.</p>
      </details>
    </div>

    <div style="text-align:center;padding:3rem 1rem;">
      <h2>Start in 2 minutes. Value on Day 1.</h2>
      <p style="color:#6b7280;margin-bottom:1.5rem;">Connect your repo, get your score, and know exactly where your product stands.</p>
      <a href="/auth/signup" class="btn btn-primary" style="font-size:1rem;padding:0.75rem 2rem;">Start Free Audit</a>
    </div>

    <div class="page-footer">Foundry — Autonomous Business Intelligence for SaaS Founders</div>
  `));
});

pricingRoutes.get('/pricing', async (c) => {
  const slots = await getFoundingCohortSlotCount();
  const remaining = Math.max(0, 30 - slots);
  return c.html(publicLayout('Pricing', html`
    <h1 style="text-align:center;margin-top:2rem;">Pricing</h1>
    <p style="text-align:center;color:#6b7280;margin-bottom:2rem;">One platform. Three tiers. No feature gates.</p>
    <div class="pricing-grid">
      <div class="pricing-card featured">
        <div class="pricing-tier">Founding Cohort</div>
        <div class="pricing-price">$99<span>/month</span></div>
        <ul class="pricing-features">
          <li>Full methodology and dashboard access</li>
          <li>Rate locked permanently for lifetime</li>
          <li>Case study participation required</li>
          <li>Direct founder access during beta</li>
          <li>Early access to new features</li>
        </ul>
        <div class="slot-count">${remaining} of 30 slots remaining</div>
        <a href="/auth/signup" class="btn btn-primary" style="width:100%;margin-top:1rem;">Claim Your Slot</a>
      </div>
      <div class="pricing-card">
        <div class="pricing-tier">Growth</div>
        <div class="pricing-price">$199<span>/month</span></div>
        <ul class="pricing-features">
          <li>Full methodology and dashboard access</li>
          <li>Standard support</li>
          <li>Single product management</li>
        </ul>
        <a href="/auth/signup" class="btn btn-secondary" style="width:100%;margin-top:1rem;">Get Started</a>
      </div>
      <div class="pricing-card">
        <div class="pricing-tier">Scale</div>
        <div class="pricing-price">$399<span>/month</span></div>
        <ul class="pricing-features">
          <li>Multi-product management</li>
          <li>Priority support</li>
          <li>Early access to new features</li>
        </ul>
        <a href="/auth/signup" class="btn btn-secondary" style="width:100%;margin-top:1rem;">Get Started</a>
      </div>
    </div>
    <div class="page-footer">All tiers include every intelligence layer. No feature gates.</div>
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
