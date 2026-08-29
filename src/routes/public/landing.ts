// =============================================================================
// FOUNDRY — Public Routes (no auth required)
// =============================================================================

import { Hono } from 'hono';
import { html } from 'hono/html';
import { setCookie } from 'hono/cookie';
import { query } from '../../db/client.js';
import { publicLayout } from '../../views/layout.js';
import {
  resolveReferralCode,
  recordReferralEvent,
} from '../../services/distribution/referrals.js';

export const landingRoutes = new Hono();
export const pricingRoutes = new Hono();
export const caseStudyRoutes = new Hono();
export const manifestoRoutes = new Hono();
export const helpRoutes = new Hono();

const SUPPORT_EMAIL = process.env.SUPPORT_EMAIL ?? 'thomas@foundry.so';

landingRoutes.get('/', async (c) => {
  // Wave 3 — referral capture. If the visitor arrived via ?ref=<code> and
  // the code resolves to a real referral link, set a 30-day cookie so the
  // attribution survives across the auth flow, and record the click event.
  const refParam = c.req.query('ref');
  if (refParam) {
    const link = await resolveReferralCode(refParam).catch(() => null);
    if (link) {
      setCookie(c, '__foundry_ref', refParam, {
        path: '/',
        maxAge: 30 * 24 * 60 * 60,
        httpOnly: true,
        sameSite: 'Lax',
      });
      // Fire-and-forget: a click that fails to log is acceptable.
      recordReferralEvent(refParam, 'click', {
        metadata: {
          ua: c.req.header('user-agent') ?? null,
          ref_header: c.req.header('referer') ?? null,
        },
      }).catch(() => {});
    }
  }

  const publishableKey = process.env.CLERK_PUBLISHABLE_KEY ?? '';
  return c.html(publicLayout('Foundry — Autonomous AI Operations for Solo SaaS Founders', html`
    <script async crossorigin="anonymous" src="https://unpkg.com/@clerk/clerk-js/dist/clerk.browser.js" data-clerk-publishable-key="${publishableKey}"></script>
    <script>window.addEventListener('load',async()=>{if(window.Clerk){await Clerk.load();if(Clerk.user){window.location.href='/dashboard';}}})</script>

    <div class="hero" style="text-align:center;padding:4rem 1rem 3rem;">
      <div style="font-size:0.7rem;font-weight:700;letter-spacing:0.18em;text-transform:uppercase;color:var(--accent);margin-bottom:1.25rem;">Autonomous AI Operations Layer</div>
      <h1 style="font-size:clamp(2rem,5vw,3.25rem);line-height:1.15;margin:0 0 1.25rem;max-width:760px;margin-left:auto;margin-right:auto;">
        Run your SaaS<br/>like there's a team behind it.
      </h1>
      <p style="font-size:1.05rem;color:var(--text-dim);max-width:620px;margin:0 auto 2rem;line-height:1.6;">
        Foundry connects to your GitHub repo and runs 12 specialized AI agents against your business — engineering, product, marketing, support, finance, and more.
        You get a daily briefing, a decision queue, and a Signal score that tells you what's working and what to do today.
      </p>
      <p style="font-size:0.85rem;color:var(--text-muted);max-width:540px;margin:0 auto 2rem;line-height:1.5;">
        Built for solo SaaS founders running one to five products. Single founder, full team.
      </p>
      <div style="display:flex;gap:1rem;justify-content:center;flex-wrap:wrap;">
        <a href="/auth/signup" class="btn btn-primary" style="padding:0.75rem 2rem;font-size:1rem;">Start with one product →</a>
        <a href="/pricing" class="btn btn-ghost" style="padding:0.75rem 1.5rem;font-size:1rem;">See pricing</a>
      </div>
    </div>

    <div style="max-width:900px;margin:0 auto;padding:0 1rem 3rem;">

      <!-- Who is this for -->
      <div style="margin-bottom:2.5rem;">
        <div style="font-size:0.7rem;font-weight:700;letter-spacing:0.14em;text-transform:uppercase;color:var(--text-dim);margin-bottom:1.25rem;text-align:center;">Who Foundry Is For</div>
        <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(240px,1fr));gap:1rem;">
          <div class="card" style="padding:1.25rem;border-top:3px solid var(--accent);">
            <h3 style="margin:0 0 0.5rem;font-size:0.95rem;">Solo SaaS founders</h3>
            <p style="margin:0;font-size:0.82rem;color:var(--text-dim);line-height:1.5;">You build product well. Operating it — pricing decisions, churn outreach, content cadence, prioritization — eats time you don't have. Foundry runs the operator layer.</p>
          </div>
          <div class="card" style="padding:1.25rem;border-top:3px solid var(--accent);">
            <h3 style="margin:0 0 0.5rem;font-size:0.95rem;">Going from 1 to 2</h3>
            <p style="margin:0;font-size:0.82rem;color:var(--text-dim);line-height:1.5;">Launching a second product without doubling your workload. Foundry watches the first one so you can focus on the next.</p>
          </div>
          <div class="card" style="padding:1.25rem;border-top:3px solid var(--accent);">
            <h3 style="margin:0 0 0.5rem;font-size:0.95rem;">Up to 5 products</h3>
            <p style="margin:0;font-size:0.82rem;color:var(--text-dim);line-height:1.5;">Each product gets its own agent team. Switch between them in the dashboard. The Investor-Ready tier supports five.</p>
          </div>
        </div>
        <p style="font-size:0.78rem;color:var(--text-muted);max-width:600px;margin:1.5rem auto 0;text-align:center;line-height:1.5;">
          Foundry is not a fleet control plane for portfolio operators or studios running 10+ companies. That's a different product.
        </p>
      </div>

      <!-- The 12 agents -->
      <div style="margin-bottom:2.5rem;">
        <div style="font-size:0.7rem;font-weight:700;letter-spacing:0.14em;text-transform:uppercase;color:var(--text-dim);margin-bottom:0.75rem;text-align:center;">Your AI Team</div>
        <p style="font-size:0.88rem;color:var(--text-dim);max-width:600px;margin:0 auto 1.25rem;text-align:center;line-height:1.5;">Each product gets its own team of 12 AI agents. They observe, recommend, and — once they've earned trust — act inside guardrails you set.</p>
        <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(190px,1fr));gap:0.75rem;">
          ${[
            ['Atlas', 'Engineering', 'Code quality · architecture · technical debt'],
            ['Compass', 'Product', 'Roadmap · lifecycle · feature priority'],
            ['Prism', 'UX', 'Onboarding · friction · activation'],
            ['Beacon', 'Marketing', 'Acquisition · positioning · campaigns'],
            ['Scribe', 'Content', 'Blog posts · docs · case studies'],
            ['Forge', 'Revenue', 'Pricing · conversion · expansion'],
            ['Harbor', 'Customer Success', 'Retention · health · outreach'],
            ['Sentinel', 'DevOps', 'Infrastructure · uptime · deployments'],
            ['Ledger', 'Finance', 'MRR · cost · ROI'],
            ['Shield', 'Compliance', 'Legal risk · privacy · terms'],
            ['Oracle', 'Analytics', 'Stressors · trends · scenario modeling'],
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
            <h3 style="margin:0 0 0.5rem;font-size:0.95rem;">Connect your repo</h3>
            <p style="margin:0;font-size:0.82rem;color:var(--text-dim);line-height:1.5;">GitHub OAuth, or paste a URL. Foundry runs a 10-dimension audit on the codebase and gives you a Signal score.</p>
          </div>
          <div class="card" style="padding:1.25rem;">
            <div style="font-size:1.5rem;margin-bottom:0.5rem;">2</div>
            <h3 style="margin:0 0 0.5rem;font-size:0.95rem;">12 agents activate</h3>
            <p style="margin:0;font-size:0.82rem;color:var(--text-dim);line-height:1.5;">Each agent runs on its own cadence — hourly to weekly. They start cautious. They earn autonomy by being right.</p>
          </div>
          <div class="card" style="padding:1.25rem;">
            <div style="font-size:1.5rem;margin-bottom:0.5rem;">3</div>
            <h3 style="margin:0 0 0.5rem;font-size:0.95rem;">One daily briefing</h3>
            <p style="margin:0;font-size:0.82rem;color:var(--text-dim);line-height:1.5;">Every morning: what happened overnight, what needs your call today, what's working. Read in 90 seconds.</p>
          </div>
          <div class="card" style="padding:1.25rem;">
            <div style="font-size:1.5rem;margin-bottom:0.5rem;">4</div>
            <h3 style="margin:0 0 0.5rem;font-size:0.95rem;">Decisions, not noise</h3>
            <p style="margin:0;font-size:0.82rem;color:var(--text-dim);line-height:1.5;">Agents propose actions through a gate-controlled queue. Approve, reject, or let Gate 0 actions execute themselves.</p>
          </div>
        </div>
      </div>

      <!-- The evolution engine highlight -->
      <div class="card" style="padding:2rem;margin-bottom:2.5rem;border-left:3px solid var(--accent);">
        <h3 style="margin:0 0 0.75rem;">Agents that learn</h3>
        <p style="margin:0 0 0.75rem;color:var(--text-dim);line-height:1.6;font-size:0.9rem;">
          Every time you correct an agent, that correction is written into its
          <strong style="color:var(--text-primary);">versioned config</strong> and carried into every future
          session. Agents track their own version history. Day 1 agents operate at maximum oversight.
        </p>
        <p style="margin:0;color:var(--text-dim);line-height:1.6;font-size:0.9rem;">
          Raising an agent from Gate 2 (approval required) to Gate 0 is your decision, made from its record —
          nothing promotes itself. <strong style="color:var(--text-primary);">You set the pace. They earn the trust.</strong>
        </p>
      </div>

      <!-- Daily briefing example -->
      <div style="margin-bottom:2.5rem;">
        <!-- This block used to be labelled as though it were a genuine
             briefing from a genuine customer. It never was: the company, its
             revenue, its experiment result and its cost are all numbers
             somebody typed. Presentation is legitimate; presenting invented
             traction as something that happened is not. The label now says what
             the block is, and the numbers stay, because an example is allowed
             to be an example. -->
        <div style="font-size:0.7rem;font-weight:700;letter-spacing:0.14em;text-transform:uppercase;color:var(--text-dim);margin-bottom:1.25rem;text-align:center;">What a briefing looks like — an illustration, not a customer</div>
        <div class="card" style="padding:1.75rem;font-family:monospace;font-size:0.82rem;line-height:1.7;color:var(--text-primary);">
          <div style="color:var(--accent);font-weight:700;margin-bottom:0.5rem;">DAILY BRIEFING · Example Co · illustration</div>
          <div style="color:var(--text-dim);margin-bottom:1rem;">Signal: 84/100 (GREEN) · MRR: $6,430 ↑$310 · 2 decisions waiting</div>
          <div style="margin-bottom:0.75rem;"><strong>What happened</strong></div>
          <div style="color:var(--text-dim);margin-bottom:0.25rem;">→ Atlas: Closed a security gap in the auth flow (Gate 0, autonomous).</div>
          <div style="color:#ffb347;margin-bottom:0.25rem;">→ Harbor: 3 trial users went silent on day 4. Suspects step 3 friction.</div>
          <div style="color:var(--text-dim);margin-bottom:1rem;">→ Forge: Pricing experiment B outperforming control by 18%.</div>
          <div style="margin-bottom:0.75rem;"><strong>Decide today</strong></div>
          <div style="color:var(--text-dim);margin-bottom:0.25rem;">→ Beacon: Publish case study from last 3 wins. Est. 2-4 leads. <span style="color:var(--accent);">[Approve]</span></div>
          <div style="color:var(--text-dim);margin-bottom:1rem;">→ Forge: Roll experiment B to 100%? Confidence 92%. <span style="color:var(--accent);">[Approve]</span></div>
          <div style="color:var(--text-dim);">AI cost this week: $14.20 · Decisions you acted on: 7 of 9</div>
        </div>
      </div>

      <!-- Trust + privacy callout -->
      <div style="margin-bottom:2.5rem;padding:1rem 1.25rem;border-radius:8px;background:rgba(78,204,163,0.04);border:1px solid rgba(78,204,163,0.15);">
        <div style="font-size:0.7rem;font-weight:700;letter-spacing:0.14em;text-transform:uppercase;color:var(--accent);margin-bottom:0.5rem;">Your data, your data</div>
        <p style="margin:0;font-size:0.85rem;color:var(--text-dim);line-height:1.6;">
          GitHub access tokens and integration credentials are encrypted at rest.
          <strong style="color:var(--text-primary);">Foundry runs no training pipelines on your data.</strong>
          Prompts are sent to models through OpenRouter, and voice replies through OpenAI. A DPA is available on request.
        </p>
      </div>

      <!-- CTA -->
      <div style="text-align:center;padding:2rem 0;">
        <h2 style="margin:0 0 1rem;">Your product deserves a team.</h2>
        <p style="color:var(--text-dim);margin:0 0 1.5rem;">Connect your first repo. Foundry runs the rest.</p>
        <a href="/auth/signup" class="btn btn-primary" style="padding:0.875rem 2.5rem;font-size:1.05rem;">Start with one product →</a>
      </div>

    </div>

    <div class="page-footer" style="text-align:center;padding:1.5rem;color:var(--text-muted);font-size:0.8rem;">
      Foundry — Autonomous AI operations for solo SaaS founders
      <div style="margin-top:0.5rem;display:flex;gap:1.5rem;justify-content:center;flex-wrap:wrap;">
        <a href="/privacy-policy" style="color:var(--text-dim);font-size:0.75rem;">Privacy</a>
        <a href="/terms" style="color:var(--text-dim);font-size:0.75rem;">Terms</a>
        <a href="/pricing" style="color:var(--text-dim);font-size:0.75rem;">Pricing</a>
        <a href="/manifesto" style="color:var(--text-dim);font-size:0.75rem;">Manifesto</a>
        <a href="/help" style="color:var(--text-dim);font-size:0.75rem;">Help</a>
        <a href="mailto:thomas@foundry.so" style="color:var(--text-dim);font-size:0.75rem;">Support</a>
      </div>
    </div>
  `));
});

pricingRoutes.get('/pricing', async (c) => {
  // Founding-rate remaining slots — the first 30 Solo signups lock the $79/mo
  // founding rate for life. Read live from DB so the scarcity message stays
  // honest. Falls back gracefully if the table doesn't yet exist (e.g., fresh
  // dev DB without all migrations).
  let foundingSlotsRemaining: number | null = null;
  try {
    const r = await query(
      "SELECT COUNT(*) AS taken FROM founders WHERE tier = 'solo'",
      []
    );
    const taken = Number((r.rows[0] as Record<string, unknown>)?.taken ?? 0);
    foundingSlotsRemaining = Math.max(0, 30 - taken);
  } catch { /* slot table not present yet; leave null */ }

  // Annual mode is a query param toggle on the pricing page so the
  // operator can A/B test by sharing the URL. Defaults to monthly.
  const isAnnual = c.req.query('billing') === 'annual';
  const annualMul = 12;
  const annualDiscount = 0.83; // ~17% off — two months free
  const fmt = (monthly: number) =>
    isAnnual ? `$${Math.round(monthly * annualMul * annualDiscount)}` : `$${monthly}`;
  const period = (monthly: number) =>
    isAnnual
      ? `/year ($${Math.round(monthly * annualDiscount)}/mo)`
      : '/month';

  return c.html(publicLayout('Pricing — Foundry', html`
    <div style="max-width:960px;margin:0 auto;padding:2rem 1rem;">
      <h1 style="text-align:center;margin-bottom:0.5rem;">Give your product a team.</h1>
      <p style="text-align:center;color:var(--text-dim);margin-bottom:1.5rem;font-size:0.95rem;">All plans include 12 AI agents, CEO briefings, and the evolution engine.</p>

      ${foundingSlotsRemaining !== null && foundingSlotsRemaining > 0 ? html`
      <div style="text-align:center;margin-bottom:1.5rem;padding:0.75rem 1.25rem;border-radius:8px;background:rgba(78,204,163,0.06);border:1px solid rgba(78,204,163,0.2);max-width:560px;margin-left:auto;margin-right:auto;">
        <div style="font-size:0.7rem;font-weight:700;letter-spacing:0.14em;text-transform:uppercase;color:var(--accent);margin-bottom:0.25rem;">Founding Cohort</div>
        <div style="font-size:0.85rem;color:var(--text-primary);">
          <strong>${foundingSlotsRemaining} of 30</strong> founding-rate slots remaining — locked at $79/mo for life.
        </div>
      </div>` : ''}

      <!-- Monthly / Annual toggle -->
      <div style="text-align:center;margin-bottom:2rem;">
        <div style="display:inline-flex;border:1px solid var(--border);border-radius:999px;padding:0.25rem;">
          <a href="/pricing" class="pricing-toggle ${!isAnnual ? 'active' : ''}" style="padding:0.4rem 1.25rem;font-size:0.85rem;border-radius:999px;text-decoration:none;color:${!isAnnual ? 'var(--bg)' : 'var(--text-dim)'};background:${!isAnnual ? 'var(--accent)' : 'transparent'};">Monthly</a>
          <a href="/pricing?billing=annual" class="pricing-toggle ${isAnnual ? 'active' : ''}" style="padding:0.4rem 1.25rem;font-size:0.85rem;border-radius:999px;text-decoration:none;color:${isAnnual ? 'var(--bg)' : 'var(--text-dim)'};background:${isAnnual ? 'var(--accent)' : 'transparent'};">Annual <span style="opacity:0.85;font-weight:600;">(2 months free)</span></a>
        </div>
      </div>

      <div class="pricing-grid">
        <div class="pricing-card">
          <div class="pricing-tier">Solo</div>
          <div class="pricing-price">${fmt(79)}<span>${period(79)}</span></div>
          <p style="font-size:0.82rem;color:var(--text-dim);margin-bottom:1rem;">One company. Full agent team. For solo founders.</p>
          <ul class="pricing-features">
            <li>1 company · 12 AI agents</li>
            <li>Daily CEO briefing</li>
            <li>Agent evolution — versioned configs and change history</li>
            <li>Signal score + risk state monitoring</li>
            <li>AI Ask — conversational business advisor</li>
            <li>Decision queue (Gate 0–4)</li>
            <li>Installable mobile app (PWA) — briefings on the go</li>
          </ul>
          <a href="/auth/signup" class="btn btn-secondary" style="width:100%;margin-top:1rem;text-align:center;">Get Started</a>
        </div>
        <div class="pricing-card featured">
          <div class="pricing-tier">Growth</div>
          <div class="pricing-price">${fmt(199)}<span>${period(199)}</span></div>
          <p style="font-size:0.82rem;color:var(--text-dim);margin-bottom:1rem;">Live integrations + Intelligence Network. For scaling teams.</p>
          <ul class="pricing-features">
            <li>Everything in Solo</li>
            <li>Live integrations — Stripe, PostHog, Intercom, Linear</li>
            <li>Agents use live integration data for richer analysis</li>
            <li>Co-founder mode — alignment scores, decision voting</li>
            <li>Intelligence Network — anonymized peer benchmarks</li>
            <li>Wisdom Layer — DNA accumulation, failure log, patterns</li>
            <li>Remediation Engine — AI-drafted fixes for blocking audit issues</li>
            <li>Up to 3 team members</li>
          </ul>
          <a href="/auth/signup" class="btn btn-primary" style="width:100%;margin-top:1rem;text-align:center;">Get Started</a>
        </div>
        <div class="pricing-card">
          <div class="pricing-tier">Investor-Ready</div>
          <div class="pricing-price">${fmt(399)}<span>${period(399)}</span></div>
          <p style="font-size:0.82rem;color:var(--text-dim);margin-bottom:1rem;">Full platform + investor layer. For founders approaching investors.</p>
          <ul class="pricing-features">
            <li>Everything in Growth</li>
            <li>Up to 5 companies (agent teams per company)</li>
            <li>Board packets — AI-drafted quarterly narratives</li>
            <li>Funding readiness score across 7 dimensions</li>
            <li>Secure investor deal rooms with live Signal share</li>
            <li>Playbook crystallization — 8 operating playbook types</li>
            <li>Temporal Intelligence — Signal replay + prediction accuracy</li>
            <li>Competitive intelligence — weekly competitor scans</li>
            <li>Founding Story Engine with timestamped case studies</li>
            <li>Unlimited team members</li>
          </ul>
          <a href="/auth/signup" class="btn btn-secondary" style="width:100%;margin-top:1rem;text-align:center;">Get Started</a>
        </div>
      </div>
      <div style="text-align:center;margin-top:2rem;color:var(--text-muted);font-size:0.82rem;">
        All plans include the installable mobile app, agent evolution, and CEO briefings. Cancel anytime.
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
    <!-- This line used to assert that the artifacts below were verified
         evidence from real products. They are composed by Foundry from a
         company's own recorded events and published when its founder chooses
         to; nothing verifies them, and the date on them is the row's creation
         time. What is true is who published, and when. -->
    <p>Written by Foundry from each company's own record, and published by its founder.</p>
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

// Public by design: a case study is published marketing, and the id in the
// path is a case-study id rather than a company's. On the tenant-scope
// baseline for that reason, not by oversight.
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

// ─── Manifesto ──────────────────────────────────────────────────────────────

manifestoRoutes.get('/manifesto', (c) => {
  return c.html(publicLayout('Autonomous Operations: A Founder\'s New Category — Foundry', html`
    <article style="max-width:720px;margin:0 auto;padding:3rem 1.25rem;color:var(--text-primary);line-height:1.7;">
      <header style="margin-bottom:2.5rem;">
        <div style="font-size:0.7rem;font-weight:700;letter-spacing:0.18em;text-transform:uppercase;color:var(--accent);margin-bottom:0.75rem;">A Manifesto</div>
        <h1 style="font-size:clamp(2rem,5vw,3rem);line-height:1.15;margin:0;">Autonomous Operations:<br/>A Founder's New Category</h1>
        <p style="margin-top:1rem;color:var(--text-dim);font-size:0.9rem;">
          A solo SaaS founder in 2026 spends roughly 60% of their working week on operating tasks. The other 40% is what they actually signed up for — building product. This is the gap.
        </p>
      </header>

      <section style="margin-bottom:2rem;">
        <h2 style="font-size:1.25rem;margin:2rem 0 0.75rem;">What broke</h2>
        <p>Operating-task complexity doubled in the last decade. Hiring help to absorb it got harder — a fractional COO costs more than the operator's gross margin permits at the under-$50K-MRR stage where most indie SaaS lives. The result is a working class of founder-operators running profitable but stressed businesses where the constraint isn't product imagination — it's the operator's hours.</p>
      </section>

      <section style="margin-bottom:2rem;">
        <h2 style="font-size:1.25rem;margin:2rem 0 0.75rem;">What's been tried</h2>
        <p>Three categories of tool exist today, none of which closes the gap:</p>
        <ul style="margin:0.5rem 0 1rem 1.25rem;">
          <li><strong>Dashboards.</strong> Show what's happening; don't show what to do.</li>
          <li><strong>Automation tools.</strong> Execute defined workflows; don't decide what workflows to run.</li>
          <li><strong>AI chat assistants.</strong> Answer when asked; don't surface when not asked.</li>
        </ul>
        <p>What none provide is the layer between observation and action: an operating system that watches continuously, decides what's worth surfacing, drafts the action, and presents it for one-click approval.</p>
      </section>

      <section style="margin-bottom:2rem;">
        <h2 style="font-size:1.25rem;margin:2rem 0 0.75rem;">What autonomous operations is</h2>
        <ol style="margin:0.5rem 0 1rem 1.25rem;">
          <li><strong>Continuous observation</strong> — every signal, on the founder's behalf.</li>
          <li><strong>Specialized agent perspectives</strong> — different domains require different lenses.</li>
          <li><strong>Decision-grade synthesis</strong> — specific decisions, not piles of metrics.</li>
          <li><strong>Calibrated voice</strong> — customer-reaching artifacts pass through the founder's voice fingerprint.</li>
          <li><strong>Trust earned over time</strong> — agents start cautious, earn autonomy by being right.</li>
          <li><strong>Audit trail by default</strong> — no silent decisions; no untraceable side effects.</li>
        </ol>
      </section>

      <section style="margin-bottom:2rem;">
        <h2 style="font-size:1.25rem;margin:2rem 0 0.75rem;">What it is <em>not</em></h2>
        <p>Not a dashboard. Not a workflow automator. Not a general AI assistant. Not a fleet control plane. Not an agent framework. Not a replacement for the founder.</p>
      </section>

      <section style="margin-bottom:2rem;">
        <h2 style="font-size:1.25rem;margin:2rem 0 0.75rem;">Why now</h2>
        <p>Three forces converge in 2026:</p>
        <ul style="margin:0.5rem 0 1rem 1.25rem;">
          <li>LLMs got reliable enough for operating decisions.</li>
          <li>Operating tasks got expensive enough to outsource at SaaS scale.</li>
          <li>Compounding data — voice fingerprints, taste journals, decision history — became the moat.</li>
        </ul>
      </section>

      <section style="margin-bottom:2rem;">
        <h2 style="font-size:1.25rem;margin:2rem 0 0.75rem;">The simple version</h2>
        <p>Solo founders' time is the constraint. Software that does the operating tasks on their behalf is the answer. <strong>Autonomous Operations</strong> is the name. The first systems are shipping in 2026, calibrated per founder via voice fingerprints, taste journals, and decision history. The defensibility is per-founder data compounding monthly. The wedge is solo SaaS founders running 1-5 products.</p>
        <p style="margin-top:1.5rem;">If you're running a SaaS and want to see what AO looks like in practice, that's what we built.</p>
      </section>

      <div style="display:flex;gap:1rem;margin-top:2.5rem;flex-wrap:wrap;">
        <a href="/auth/signup" class="btn btn-primary" style="padding:0.75rem 1.75rem;font-size:0.95rem;">Try Foundry →</a>
        <a href="/" class="btn btn-ghost" style="padding:0.75rem 1.5rem;font-size:0.95rem;color:var(--text-dim);">Back to home</a>
      </div>

      <footer style="margin-top:3rem;padding-top:1.5rem;border-top:1px solid var(--border);font-size:0.78rem;color:var(--text-muted);">
        Full manifesto with annotations and operator notes lives in the
        repo at <code>docs/strategy/category-manifesto.md</code>.
      </footer>
    </article>
  `));
});

// ─── Help / Support ──────────────────────────────────────────────────────────

const FAQ: Array<{ q: string; a: string }> = [
  {
    q: 'What does Foundry actually do?',
    a: 'Connect a GitHub repo (or your product URL) and Foundry runs a 10-dimension audit, provisions a team of AI agents that watch your product on a cadence, proposes gate-controlled decisions, and writes you a daily CEO briefing — one number that matters and one decision to make today.',
  },
  {
    q: 'How do I get started?',
    a: 'Sign up, connect a repo, and watch the audit run. Your first briefing is written before you land on the dashboard. From there, review the audit, enter (or auto-draft) your Product DNA, and start acting on the decision queue.',
  },
  {
    q: 'Is there a free trial?',
    a: 'Yes — a 14-day trial. You add a card up front and are not charged until the trial ends; cancel any time before then and you pay nothing.',
  },
  {
    q: 'My integrations aren\'t showing data — why?',
    a: 'After connecting an integration it can take up to an hour for the first sync to populate events. If it stays empty, check the integration status on the Integrations page and re-connect if it shows an error.',
  },
  {
    q: 'How do I cancel or change my plan?',
    a: 'Manage your subscription from Settings → Billing. Cancelling stops future charges and pauses your agents; your data is retained.',
  },
  {
    q: 'Something is broken or I have a question not covered here.',
    a: `Email ${SUPPORT_EMAIL} — a real person reads every message.`,
  },
];

helpRoutes.get('/help', (c) => {
  return c.html(publicLayout('Help & Support — Foundry', html`
    <article style="max-width:720px;margin:0 auto;padding:3rem 1.25rem;color:var(--text-primary);line-height:1.7;">
      <h1 style="font-size:clamp(1.8rem,4vw,2.5rem);margin:0 0 0.5rem;">Help & Support</h1>
      <p style="color:var(--text-dim);margin-bottom:2rem;">
        Answers to common questions. Still stuck? Email
        <a href="mailto:${SUPPORT_EMAIL}" style="color:var(--accent);">${SUPPORT_EMAIL}</a>.
      </p>
      ${FAQ.map((item) => html`
        <section style="margin-bottom:1.5rem;padding-bottom:1.5rem;border-bottom:1px solid var(--border);">
          <h2 style="font-size:1.05rem;margin:0 0 0.5rem;">${item.q}</h2>
          <p style="margin:0;color:var(--text-muted);">${item.a}</p>
        </section>
      `)}
      <div style="display:flex;gap:1rem;margin-top:2rem;flex-wrap:wrap;">
        <a href="mailto:${SUPPORT_EMAIL}" class="btn btn-primary" style="padding:0.7rem 1.5rem;">Email support</a>
        <a href="/dashboard" class="btn btn-ghost" style="padding:0.7rem 1.5rem;color:var(--text-dim);">Back to dashboard</a>
      </div>
    </article>
  `));
});

// ─── Legal Pages ────────────────────────────────────────────────────────────

export const legalRoutes = new Hono();

// The public policy lives at /privacy-policy; /privacy is the authenticated
// privacy-and-data dashboard (consent toggles, export, deletion).
legalRoutes.get('/privacy-policy', (c) => {
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

      <h2>AI Models — Who Processes Your Prompts</h2>
      <p>Foundry sends prompts to language models through <strong>OpenRouter</strong>
        (https://openrouter.ai), and voice replies through <strong>OpenAI</strong>. Those are the
        services that receive prompt content; their own terms govern what they do with it, and we
        state no term here on their behalf. We do not run our own training pipelines on your
        data, and do not sell or license it. If the services that process prompts change, or
        their terms change in a way that affects you, we will notify you 30 days before any
        change takes effect.</p>

      <h2>Encryption at Rest</h2>
      <p>Sensitive credentials — GitHub access tokens, Stripe API keys, integration
        credentials — are encrypted at rest using AES-256-GCM with a key managed by Foundry.
        Encryption key rotation procedure is documented and tested.</p>

      <h2>Data Processing Addendum (DPA)</h2>
      <p>For founders in GDPR-region countries or any founder who needs a DPA for their
        own compliance program, we provide one on request. Email
        <a href="mailto:thomas@foundry.so">thomas@foundry.so</a> with subject "DPA request"
        and we'll send the latest version within one business day. Standard contractual
        clauses (SCCs) are included.</p>

      <h2>Cross-Company Intelligence</h2>
      <p>Foundry's Decision Patterns system aggregates anonymized decision outcomes across all companies
         to improve scenario modeling. This data contains no product names, founder identifiers, or
         confidential metrics. You can opt out of contributing to this pool in Settings → Privacy.</p>

      <h2>Third-Party Processors</h2>
      <ul style="margin:0.5rem 0 1rem 1.5rem;color:var(--text);line-height:1.8;">
        <li><strong>OpenRouter:</strong> Receives every prompt Foundry sends to a language model, and routes it to the model that answers it. Your business context is in those prompts.</li>
        <li><strong>OpenAI:</strong> Receives the prompts behind voice replies.</li>
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
