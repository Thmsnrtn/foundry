// =============================================================================
// FOUNDRY — API Documentation Page
// Self-serve docs for the public REST API.
// =============================================================================

import { Hono } from 'hono';
import { html } from 'hono/html';
import type { AuthEnv } from '../../middleware/auth.js';
import { dashboardLayout } from '../../views/layout.js';
import { getLayoutContext } from './_shared.js';
import { listApiKeys } from '../../middleware/api-key.js';

export const apiDocsRoutes = new Hono<AuthEnv>();

apiDocsRoutes.get('/settings/api-docs', async (c) => {
  const founder = c.get('founder');
  const ctx = await getLayoutContext(founder, 'settings', 'API Documentation', undefined, c);
  const keys = await listApiKeys(founder.id);
  const appUrl = process.env.APP_URL ?? 'https://foundry.dev';

  const content = html`
    <h1>API Documentation</h1>

    <div class="card">
      <h3>Authentication</h3>
      <p style="font-size:0.9rem;color:#4b5563;">All API requests require an API key in the <code>Authorization</code> header.</p>
      <pre style="background:#1a1a2e;color:#e8eaf0;padding:1rem;border-radius:6px;font-size:0.8rem;overflow-x:auto;">Authorization: Bearer fnd_your_api_key_here</pre>
      <p style="font-size:0.87rem;margin-top:0.75rem;">
        ${keys.length > 0
          ? html`You have <strong>${keys.length}</strong> active API key${keys.length > 1 ? 's' : ''}.`
          : html`No API keys yet. <a href="/settings" style="color:#2563eb;">Create one in Settings.</a>`}
      </p>
    </div>

    <div class="card">
      <h3>Base URL</h3>
      <code style="font-size:0.9rem;">${appUrl}/v1</code>
    </div>

    ${apiEndpoint('GET', '/v1/products', 'List all products', null, `[
  {
    "id": "abc123",
    "name": "My SaaS",
    "status": "active",
    "market_category": "developer_tools",
    "created_at": "2025-01-15T00:00:00.000Z"
  }
]`)}

    ${apiEndpoint('POST', '/v1/products/:id/metrics', 'Record daily metrics', `{
  "new_mrr_cents": 9900,
  "churned_mrr_cents": 0,
  "expansion_mrr_cents": 500,
  "signups_7d": 12,
  "active_users": 320,
  "activation_rate": 0.78,
  "day_30_retention": 0.62,
  "churn_rate": 0.05,
  "nps_score": 42
}`, `{ "status": "recorded", "date": "2025-04-14" }`)}

    ${apiEndpoint('GET', '/v1/products/:id/audit/latest', 'Get latest audit results', null, `{
  "audit": {
    "id": "...",
    "composite": 7.2,
    "verdict": "READY_WITH_CONDITIONS",
    "d1_score": 8, "d2_score": 7, "d3_score": 6,
    "findings": [...],
    "blocking_issues": [...]
  }
}`)}

    ${apiEndpoint('GET', '/v1/products/:id/stressors', 'Get active stressors', null, `{
  "stressors": [
    {
      "stressor_name": "Churn exceeds new revenue",
      "severity": "elevated",
      "signal": "MRR health ratio at 0.85",
      "neutralizing_action": "Investigate top churn reasons"
    }
  ]
}`)}

    ${apiEndpoint('GET', '/v1/products/:id/decisions', 'List decisions (paginated)', null, `{
  "data": [...],
  "pagination": { "page": 1, "limit": 25, "total": 42, "totalPages": 2, "hasNext": true }
}`)}

    ${apiEndpoint('GET', '/v1/products/:id/mrr', 'MRR decomposition', null, `{
  "mrr": {
    "new_cents": 9900,
    "expansion_cents": 500,
    "contraction_cents": 200,
    "churned_cents": 0,
    "total_cents": 10200,
    "health_ratio": 0.0
  },
  "health": { "value": 0.0, "indicator": "green" }
}`)}

    <div class="card" style="background:#f8fafc;">
      <h3>Rate Limits</h3>
      <p style="font-size:0.87rem;color:#4b5563;">API requests are rate-limited to <strong>100 requests per minute</strong> per API key.</p>
      <p style="font-size:0.87rem;color:#4b5563;">Rate limit headers are included in every response: <code>X-RateLimit-Limit</code>, <code>X-RateLimit-Remaining</code>, <code>X-RateLimit-Reset</code>.</p>
    </div>

    <div class="card" style="background:#f8fafc;">
      <h3>Webhooks</h3>
      <p style="font-size:0.87rem;color:#4b5563;">Configure webhooks in Settings to receive real-time notifications when events occur. All webhooks are signed with HMAC-SHA256 via the <code>X-Foundry-Signature</code> header.</p>
      <p style="font-size:0.87rem;color:#4b5563;"><strong>Available events:</strong> audit.completed, decision.created, decision.resolved, stressor.identified, stressor.resolved, risk_state.changed, metric.recorded, digest.generated, remediation.pr_opened, remediation.pr_merged</p>
    </div>
  `;

  return c.html(dashboardLayout(ctx, content));
});

function apiEndpoint(method: string, path: string, description: string, requestBody: string | null, responseExample: string): ReturnType<typeof html> {
  const methodColor = method === 'GET' ? '#059669' : method === 'POST' ? '#2563eb' : method === 'DELETE' ? '#dc2626' : '#6b7280';
  return html`
  <div class="card">
    <div style="display:flex;align-items:center;gap:0.75rem;margin-bottom:0.5rem;">
      <span style="background:${methodColor};color:#fff;padding:2px 8px;border-radius:4px;font-size:0.75rem;font-weight:700;">${method}</span>
      <code style="font-size:0.9rem;">${path}</code>
    </div>
    <p style="font-size:0.87rem;color:#4b5563;margin-bottom:0.75rem;">${description}</p>
    ${requestBody ? html`
      <details>
        <summary style="font-size:0.8rem;font-weight:600;margin-bottom:0.5rem;">Request Body</summary>
        <pre style="background:#1a1a2e;color:#e8eaf0;padding:0.75rem;border-radius:6px;font-size:0.75rem;overflow-x:auto;">${requestBody}</pre>
      </details>` : ''}
    <details>
      <summary style="font-size:0.8rem;font-weight:600;margin-bottom:0.5rem;">Response Example</summary>
      <pre style="background:#1a1a2e;color:#e8eaf0;padding:0.75rem;border-radius:6px;font-size:0.75rem;overflow-x:auto;">${responseExample}</pre>
    </details>
  </div>`;
}
