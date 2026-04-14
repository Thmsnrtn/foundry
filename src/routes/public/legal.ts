// =============================================================================
// FOUNDRY — Legal Pages (Privacy Policy, Terms of Service)
// =============================================================================

import { Hono } from 'hono';
import { html } from 'hono/html';
import { publicLayout } from '../../views/layout.js';

export const legalRoutes = new Hono();

legalRoutes.get('/privacy', (c) => {
  return c.html(publicLayout('Privacy Policy', html`
    <div style="max-width:750px;margin:0 auto;">
      <h1>Privacy Policy</h1>
      <p style="color:var(--color-text-muted);margin-bottom:2rem;">Last updated: ${new Date().toISOString().split('T')[0]}</p>

      <h2>What Data We Collect</h2>
      <ul style="margin-bottom:1.5rem;padding-left:1.25rem;">
        <li><strong>Account data:</strong> Email, name, payment information (processed by Stripe — we never store card numbers).</li>
        <li><strong>Repository data:</strong> Read-only access to your GitHub repository structure and file contents for audit analysis. We do not modify your code.</li>
        <li><strong>Business metrics:</strong> Revenue, retention, activation, churn, and other metrics you choose to report.</li>
        <li><strong>AI interactions:</strong> Questions asked to Ask Foundry and the context used to generate answers.</li>
        <li><strong>Usage data:</strong> Pages visited, features used, API calls made.</li>
      </ul>

      <h2>How We Use Your Data</h2>
      <ul style="margin-bottom:1.5rem;padding-left:1.25rem;">
        <li>To run codebase audits and generate product health scores.</li>
        <li>To identify business risks (stressors) and generate intelligence reports.</li>
        <li>To power the decision queue, scenario modeling, and competitive intelligence.</li>
        <li>To send weekly digest emails and notification alerts.</li>
        <li>To improve the platform through anonymized, aggregated usage patterns.</li>
      </ul>

      <h2>Data Security</h2>
      <ul style="margin-bottom:1.5rem;padding-left:1.25rem;">
        <li>GitHub access tokens encrypted at rest (AES-256-GCM).</li>
        <li>All traffic encrypted in transit (HTTPS/TLS).</li>
        <li>Authentication via Clerk (industry-standard JWT).</li>
        <li>CSRF protection on all form submissions.</li>
        <li>Rate limiting on all API endpoints.</li>
        <li>Full audit trail of all system actions.</li>
      </ul>

      <h2>Cross-Product Patterns</h2>
      <p style="margin-bottom:1.5rem;">Foundry's decision pattern library uses anonymized, aggregated data across all customers to improve scenario modeling. No individual product names, founder identities, or specific business metrics are included in cross-product patterns. Only statistical patterns (e.g., "founders who raised prices during churn spikes saw X% outcomes") are shared.</p>

      <h2>AI Processing</h2>
      <p style="margin-bottom:1.5rem;">Your data is processed by Anthropic's Claude API. Anthropic does not use API inputs for model training. Your data is processed in accordance with Anthropic's API data policy.</p>

      <h2>Your Rights (GDPR / CCPA)</h2>
      <ul style="margin-bottom:1.5rem;padding-left:1.25rem;">
        <li><strong>Data export:</strong> Request a full export of your data from Settings. Processed within 24 hours.</li>
        <li><strong>Account deletion:</strong> Request account deletion from Settings. 30-day grace period, then permanent deletion.</li>
        <li><strong>Data portability:</strong> All exports are in standard JSON format.</li>
        <li><strong>Correction:</strong> Update your profile and product data at any time from the dashboard.</li>
      </ul>

      <h2>Data Retention</h2>
      <p style="margin-bottom:1.5rem;">We retain your data for as long as your account is active. After account deletion (30-day grace period), all data is permanently removed within 48 hours. Anonymized aggregate patterns are retained indefinitely.</p>

      <h2>Contact</h2>
      <p>For privacy questions: <a href="mailto:privacy@foundry.dev">privacy@foundry.dev</a></p>
    </div>
  `));
});

legalRoutes.get('/terms', (c) => {
  return c.html(publicLayout('Terms of Service', html`
    <div style="max-width:750px;margin:0 auto;">
      <h1>Terms of Service</h1>
      <p style="color:var(--color-text-muted);margin-bottom:2rem;">Last updated: ${new Date().toISOString().split('T')[0]}</p>

      <h2>Service Description</h2>
      <p style="margin-bottom:1.5rem;">Foundry provides autonomous business intelligence for SaaS founders, including codebase audits, revenue monitoring, risk assessment, decision support, and competitive intelligence.</p>

      <h2>Account Terms</h2>
      <ul style="margin-bottom:1.5rem;padding-left:1.25rem;">
        <li>You must provide accurate account information.</li>
        <li>You are responsible for maintaining the security of your account credentials and API keys.</li>
        <li>You may not share your account or API keys with unauthorized parties.</li>
        <li>One person or legal entity per account.</li>
      </ul>

      <h2>Billing</h2>
      <ul style="margin-bottom:1.5rem;padding-left:1.25rem;">
        <li>Subscriptions are billed monthly via Stripe.</li>
        <li>Founding Cohort pricing ($99/mo) is locked for the lifetime of continuous subscription.</li>
        <li>Cancellation takes effect at the end of the current billing period.</li>
        <li>No refunds for partial months.</li>
      </ul>

      <h2>Acceptable Use</h2>
      <ul style="margin-bottom:1.5rem;padding-left:1.25rem;">
        <li>Do not use Foundry to process data you don't have rights to.</li>
        <li>Do not attempt to reverse-engineer the AI scoring or pattern algorithms.</li>
        <li>Do not abuse API rate limits or attempt to circumvent usage quotas.</li>
        <li>Do not use the platform to harm competitors through false signal injection.</li>
      </ul>

      <h2>Intellectual Property</h2>
      <p style="margin-bottom:1.5rem;">You retain ownership of all your data, code, and business metrics. Foundry retains ownership of the platform, algorithms, and anonymized cross-product patterns. Case studies published with your consent remain jointly licensed.</p>

      <h2>Limitation of Liability</h2>
      <p style="margin-bottom:1.5rem;">Foundry provides business intelligence recommendations, not financial, legal, or investment advice. Decisions made based on Foundry's analysis are your responsibility. We are not liable for business outcomes resulting from following or ignoring Foundry's recommendations.</p>

      <h2>Changes to Terms</h2>
      <p style="margin-bottom:1.5rem;">We may update these terms with 30 days notice via email. Continued use after the notice period constitutes acceptance.</p>

      <h2>Contact</h2>
      <p>For legal questions: <a href="mailto:legal@foundry.dev">legal@foundry.dev</a></p>
    </div>
  `));
});
