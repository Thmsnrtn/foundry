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
  return c.html(publicLayout('Foundry — One Control Plane for All Your Companies', html`
    <script async crossorigin="anonymous" src="https://unpkg.com/@clerk/clerk-js/dist/clerk.browser.js" data-clerk-publishable-key="${publishableKey}"></script>
    <script>window.addEventListener('load',async()=>{if(window.Clerk){await Clerk.load();if(Clerk.user){window.location.href='/dashboard';}}})</script>

    <div class="hero" style="text-align:center;padding:4rem 1rem 3rem;">
      <div style="font-size:0.7rem;font-weight:700;letter-spacing:0.18em;text-transform:uppercase;color:var(--accent);margin-bottom:1.25rem;">The Operating System for Portfolio Founders</div>
      <h1 style="font-size:clamp(2rem,5vw,3.25rem);line-height:1.15;margin:0 0 1.25rem;max-width:760px;margin-left:auto;margin-right:auto;">
        One control plane for<br/>all your companies.
      </h1>
      <p style="font-size:1.05rem;color:var(--text-dim);max-width:620px;margin:0 auto 2rem;line-height:1.6;">
        Every company you add to Foundry gets a team of 12 AI agents that run it autonomously — marketing, engineering, finance, support, and more.
        You get one dashboard, one morning briefing, and cross-portfolio intelligence that no single company could generate alone.
      </p>
      <div style="display:flex;gap:1rem;justify-content:center;flex-wrap:wrap;">
        <a href="/auth/signup" class="btn btn-primary" style="padding:0.75rem 2rem;font-size:1rem;">Start managing your portfolio →</a>
        <a href="/pricing" class="btn btn-ghost" style="padding:0.75rem 1.5rem;font-size:1rem;">See pricing</a>
      </div>
    </div>

    <div style="max-width:900px;margin:0 auto;padding:0 1rem 3rem;">

      <!-- Who is this for -->
      <div style="margin-bottom:2.5rem;">
        <div style="font-size:0.7rem;font-weight:700;letter-spacing:0.14em;text-transform:uppercase;color:var(--text-dim);margin-bottom:1.25rem;text-align:center;">Who Is Foundry For?</div>
        <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(220px,1fr));gap:1rem;">
          <div class="card" style="padding:1.25rem;border-top:3px solid var(--accent);">
            <h3 style="margin:0 0 0.5rem;font-size:0.95rem;">Going from 1 to 2</h3>
            <p style="margin:0;font-size:0.82rem;color:var(--text-dim);line-height:1.5;">Solo founders ready to launch their second product without doubling their workload. Foundry runs your first company so you can build the next one.</p>
          </div>
          <div class="card" style="padding:1.25rem;border-top:3px solid var(--accent);">
            <h3 style="margin:0 0 0.5rem;font-size:0.95rem;">Multi-product founders</h3>
            <p style="margin:0;font-size:0.82rem;color:var(--text-dim);line-height:1.5;">Managing 2-15 companies and losing context switching between them. One briefing, one dashboard, one place to see everything that matters.</p>
          </div>
          <div class="card" style="padding:1.25rem;border-top:3px solid var(--accent);">
            <h3 style="margin:0 0 0.5rem;font-size:0.95rem;">Portfolio operators &amp; studios</h3>
            <p style="margin:0;font-size:0.82rem;color:var(--text-dim);line-height:1.5;">Running 15+ companies at scale. Cross-portfolio pattern detection, shared playbooks, and fleet-wide intelligence that compounds across every company you add.</p>
          </div>
        </div>
      </div>

      <!-- The 12 agents -->
      <div style="margin-bottom:2.5rem;">
        <div style="font-size:0.7rem;font-weight:700;letter-spacing:0.14em;text-transform:uppercase;color:var(--text-dim);margin-bottom:0.75rem;text-align:center;">Your AI Team — Per Company</div>
        <p style="font-size:0.88rem;color:var(--text-dim);max-width:600px;margin:0 auto 1.25rem;text-align:center;line-height:1.5;">Each company gets its own team of 12 AI agents. They run independently, but Foundry sees patterns across your entire portfolio.</p>
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
            <h3 style="margin:0 0 0.5rem;font-size:0.95rem;">Add a company</h3>
            <p style="margin:0;font-size:0.82rem;color:var(--text-dim);line-height:1.5;">Connect a GitHub repo and fill in the Company DNA — ICP, positioning, voice, market insight. Takes about 10 minutes.</p>
          </div>
          <div class="card" style="padding:1.25rem;">
            <div style="font-size:1.5rem;margin-bottom:0.5rem;">2</div>
            <h3 style="margin:0 0 0.5rem;font-size:0.95rem;">12 agents activate</h3>
            <p style="margin:0;font-size:0.82rem;color:var(--text-dim);line-height:1.5;">Each company gets its own agent team. They start cautious, run on their cadences, and earn trust by being right.</p>
          </div>
          <div class="card" style="padding:1.25rem;">
            <div style="font-size:1.5rem;margin-bottom:0.5rem;">3</div>
            <h3 style="margin:0 0 0.5rem;font-size:0.95rem;">One briefing, all companies</h3>
            <p style="margin:0;font-size:0.82rem;color:var(--text-dim);line-height:1.5;">Every morning, one unified briefing across your portfolio. What happened overnight. What needs your call. What's working.</p>
          </div>
          <div class="card" style="padding:1.25rem;">
            <div style="font-size:1.5rem;margin-bottom:0.5rem;">4</div>
            <h3 style="margin:0 0 0.5rem;font-size:0.95rem;">Portfolio intelligence compounds</h3>
            <p style="margin:0;font-size:0.82rem;color:var(--text-dim);line-height:1.5;">Lessons learned in one company sharpen every other. Patterns emerge across your fleet that no single product could reveal.</p>
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
        <div style="font-size:0.7rem;font-weight:700;letter-spacing:0.14em;text-transform:uppercase;color:var(--text-dim);margin-bottom:1.25rem;text-align:center;">Your Daily Portfolio Briefing</div>
        <div class="card" style="padding:1.75rem;font-family:monospace;font-size:0.82rem;line-height:1.7;color:var(--text-primary);">
          <div style="color:var(--accent);font-weight:700;margin-bottom:0.5rem;">PORTFOLIO BRIEFING · 3 COMPANIES · March 30, 2026</div>
          <div style="color:var(--text-dim);margin-bottom:1rem;">Portfolio Signal: 84/100 · Combined MRR: $18,430 ↑$920 · 4 decisions waiting</div>
          <div style="margin-bottom:0.75rem;"><strong>AcreOS</strong> <span style="color:var(--text-dim);">(Signal 87 · GREEN)</span></div>
          <div style="color:var(--text-dim);margin-bottom:0.25rem;">→ Atlas: Closed a security gap in the auth flow automatically.</div>
          <div style="color:#ffb347;margin-bottom:0.75rem;">→ Harbor: 3 trial users went silent. Suspects step 3 friction.</div>
          <div style="margin-bottom:0.75rem;"><strong>InvoiceKit</strong> <span style="color:var(--text-dim);">(Signal 79 · YELLOW)</span></div>
          <div style="color:var(--text-dim);margin-bottom:0.25rem;">→ Oracle: Churn improved 0.4% — retention emails working.</div>
          <div style="color:var(--text-dim);margin-bottom:0.75rem;">→ Forge: Pricing experiment B outperforming control by 18%.</div>
          <div style="margin-bottom:0.75rem;"><strong>MailDeck</strong> <span style="color:var(--text-dim);">(Signal 91 · GREEN)</span></div>
          <div style="color:var(--text-dim);margin-bottom:1rem;">→ Beacon: Publish case study from last 3 wins. Est. 2-4 leads. <span style="color:var(--accent);">[Approve]</span></div>
          <div style="margin-bottom:0.75rem;"><strong>Cross-portfolio pattern:</strong></div>
          <div style="color:var(--accent);margin-bottom:1rem;">Onboarding friction at step 3 detected in both AcreOS and InvoiceKit — Harbor recommends shared fix.</div>
          <div style="color:var(--text-dim);">AI Cost: $34.20 across 3 companies · Portfolio ROI: 22.4x</div>
        </div>
      </div>

      <!-- CTA -->
      <div style="text-align:center;padding:2rem 0;">
        <h2 style="margin:0 0 1rem;">Your portfolio deserves a control plane.</h2>
        <p style="color:var(--text-dim);margin:0 0 1.5rem;">Try it with your first company — add the rest when you're ready.</p>
        <a href="/auth/signup" class="btn btn-primary" style="padding:0.875rem 2.5rem;font-size:1.05rem;">Start managing your portfolio →</a>
      </div>

    </div>

    <div class="page-footer" style="text-align:center;padding:1.5rem;color:var(--text-muted);font-size:0.8rem;">
      Foundry — The operating system for multi-company founders
      <div style="margin-top:0.5rem;display:flex;gap:1.5rem;justify-content:center;">
        <a href="/privacy" style="color:var(--text-dim);font-size:0.75rem;">Privacy</a>
        <a href="/terms" style="color:var(--text-dim);font-size:0.75rem;">Terms</a>
        <a href="/pricing" style="color:var(--text-dim);font-size:0.75rem;">Pricing</a>
      </div>
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

// ─── Legal Pages ────────────────────────────────────────────────────────────

export const legalRoutes = new Hono();

legalRoutes.get('/privacy', (c) => {
  return c.html(publicLayout('Privacy Policy — Foundry', html`
    <div style="max-width:720px;margin:0 auto;padding:2rem 1rem;">
      <h1>Privacy Policy</h1>
      <p style="color:var(--text-dim);margin-bottom:1.5rem;">Last updated: April 2026</p>

      <h2>What We Collect</h2>
      <p>When you use Foundry, we collect:</p>
      <ul style="margin:0.5rem 0 1rem 1.5rem;color:var(--text);line-height:1.8;">
        <li><strong>Account information:</strong> Name, email address (via Clerk authentication)</li>
        <li><strong>Product data:</strong> GitHub repository metadata, code analysis results, business metrics you provide</li>
        <li><strong>Usage data:</strong> Pages visited, features used, AI interactions</li>
        <li><strong>Payment information:</strong> Processed by Stripe; we never store card numbers</li>
      </ul>

      <h2>How We Use Your Data</h2>
      <ul style="margin:0.5rem 0 1rem 1.5rem;color:var(--text);line-height:1.8;">
        <li>To operate your AI agent team and generate business intelligence</li>
        <li>To improve Foundry through anonymized, aggregated usage patterns</li>
        <li>To send you operational digests and alerts (which you can configure in Settings)</li>
      </ul>

      <h2>Cross-Company Intelligence</h2>
      <p>Foundry's Decision Patterns system aggregates anonymized decision outcomes across all companies
         to improve scenario modeling. This data contains no product names, founder identifiers, or
         confidential metrics. You can opt out of contributing to this pool in Settings → Privacy.</p>

      <h2>Third-Party Processors</h2>
      <ul style="margin:0.5rem 0 1rem 1.5rem;color:var(--text);line-height:1.8;">
        <li><strong>Anthropic (Claude AI):</strong> Processes your business context to generate agent analyses. Subject to Anthropic's data retention policy.</li>
        <li><strong>Clerk:</strong> Authentication and user management</li>
        <li><strong>Stripe:</strong> Payment processing</li>
        <li><strong>Turso:</strong> Database hosting</li>
        <li><strong>Resend:</strong> Email delivery for digests and alerts</li>
        <li><strong>GitHub:</strong> Repository analysis (when you connect a repo)</li>
      </ul>

      <h2>Data Retention</h2>
      <p>Your data is retained while your account is active. When you delete your account,
         we remove all personal data and product data within 30 days. Anonymized decision patterns
         are retained indefinitely as they contain no identifying information.</p>

      <h2>Your Rights</h2>
      <p>You have the right to:</p>
      <ul style="margin:0.5rem 0 1rem 1.5rem;color:var(--text);line-height:1.8;">
        <li>Export all your data (Settings → Privacy → Data Export)</li>
        <li>Delete your account and all associated data (Settings → Privacy → Delete Account)</li>
        <li>Opt out of cross-company intelligence sharing</li>
        <li>Configure what data your AI agents can access</li>
      </ul>

      <h2>Contact</h2>
      <p>Questions about privacy? Email <a href="mailto:privacy@foundry.so">privacy@foundry.so</a>.</p>
    </div>
  `));
});

legalRoutes.get('/terms', (c) => {
  return c.html(publicLayout('Terms of Service — Foundry', html`
    <div style="max-width:720px;margin:0 auto;padding:2rem 1rem;">
      <h1>Terms of Service</h1>
      <p style="color:var(--text-dim);margin-bottom:1.5rem;">Last updated: April 2026</p>

      <h2>1. Service Description</h2>
      <p>Foundry provides an AI-powered business intelligence platform ("the Service") that runs
         autonomous agents to analyze, monitor, and advise on your SaaS business operations.</p>

      <h2>2. Account Terms</h2>
      <ul style="margin:0.5rem 0 1rem 1.5rem;color:var(--text);line-height:1.8;">
        <li>You must provide a valid email address to create an account</li>
        <li>You are responsible for maintaining the security of your account credentials</li>
        <li>You must not use the Service for any illegal or unauthorized purpose</li>
        <li>One person or legal entity may maintain no more than one account</li>
      </ul>

      <h2>3. Payment Terms</h2>
      <p>Subscriptions are billed monthly in advance. You may cancel at any time; access continues
         through the end of your billing period. Refunds are not provided for partial months.</p>

      <h2>4. AI Agent Limitations</h2>
      <p>Foundry's AI agents provide analysis and recommendations, not guarantees. You remain
         responsible for all business decisions. Agents operate within configured authority gates
         — review Gate 2+ actions before they take effect. AI-generated content may contain errors;
         always verify critical information independently.</p>

      <h2>5. Data and Intellectual Property</h2>
      <p>You retain all rights to your data. By using the Service, you grant Foundry a limited
         license to process your data as needed to provide the Service. We may use anonymized,
         aggregated data to improve the Service.</p>

      <h2>6. GitHub Integration</h2>
      <p>When you connect a GitHub repository, Foundry's audit engine reads repository structure
         and code to generate quality assessments. The Remediation Engine may create pull requests
         with suggested improvements — these require your explicit approval before merging.</p>

      <h2>7. Service Level</h2>
      <p>We target 99.9% uptime but do not guarantee it. Scheduled maintenance will be announced
         in advance. AI agent availability depends on third-party AI provider uptime.</p>

      <h2>8. Termination</h2>
      <p>Either party may terminate this agreement at any time. Upon termination, you may export
         your data for 30 days, after which it will be permanently deleted.</p>

      <h2>9. Limitation of Liability</h2>
      <p>Foundry is provided "as is." We are not liable for business decisions made based on AI
         agent recommendations, lost revenue, or indirect damages. Our maximum liability is limited
         to the amount you paid in the 12 months preceding the claim.</p>

      <h2>10. Changes to Terms</h2>
      <p>We may update these terms with 30 days notice via email. Continued use after the notice
         period constitutes acceptance of the updated terms.</p>

      <h2>Contact</h2>
      <p>Questions? Email <a href="mailto:legal@foundry.so">legal@foundry.so</a>.</p>
    </div>
  `));
});
