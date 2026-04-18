// =============================================================================
// FOUNDRY — Embeddable Widget & Public Profile
// "Foundry Verified" badge and public product journey page.
// =============================================================================

import { Hono } from 'hono';
import { query, getLatestAudit } from '../../db/client.js';

export const widgetRoutes = new Hono();

/**
 * Embeddable SVG badge showing a product's audit score.
 * Usage: <img src="https://foundry.dev/badge/:productId" alt="Foundry Verified" />
 */
widgetRoutes.get('/badge/:id', async (c) => {
  const productId = c.req.param('id');

  // Check if product exists and has opted into public badge
  const product = await query(
    "SELECT name, status FROM products WHERE id = ? AND status = 'active'",
    [productId]
  );
  if (product.rows.length === 0) return c.notFound();

  const audit = await getLatestAudit(productId);
  const auditRow = audit.rows[0] as Record<string, unknown> | undefined;
  const score = auditRow?.composite as number ?? 0;
  const verdict = auditRow?.verdict as string ?? 'Unaudited';

  const color = score >= 7 ? '#059669' : score >= 5 ? '#d97706' : score >= 1 ? '#dc2626' : '#6b7280';
  const label = score > 0 ? `${score.toFixed(1)}/10` : 'Unaudited';

  // Generate SVG badge (similar to shields.io style)
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="180" height="28" role="img" aria-label="Foundry: ${label}">
  <title>Foundry: ${label}</title>
  <linearGradient id="s" x2="0" y2="100%"><stop offset="0" stop-color="#fff" stop-opacity=".7"/><stop offset=".1" stop-color="#aaa" stop-opacity=".1"/><stop offset=".9" stop-color="#000" stop-opacity=".3"/><stop offset="1" stop-color="#000" stop-opacity=".5"/></linearGradient>
  <clipPath id="r"><rect width="180" height="28" rx="4" fill="#fff"/></clipPath>
  <g clip-path="url(#r)">
    <rect width="80" height="28" fill="#1a1a2e"/>
    <rect x="80" width="100" height="28" fill="${color}"/>
    <rect width="180" height="28" fill="url(#s)"/>
  </g>
  <g fill="#fff" text-anchor="middle" font-family="system-ui,sans-serif" text-rendering="geometricPrecision" font-size="12">
    <text x="40" y="18" font-weight="600">Foundry</text>
    <text x="130" y="18" font-weight="700">${label}</text>
  </g>
</svg>`;

  c.header('Content-Type', 'image/svg+xml');
  c.header('Cache-Control', 'public, max-age=3600');
  return c.body(svg);
});

/**
 * Public product journey page — shows timeline and milestones.
 * Only shows published artifacts.
 */
widgetRoutes.get('/public/:id/journey', async (c) => {
  const productId = c.req.param('id');

  const product = await query("SELECT name FROM products WHERE id = ? AND status = 'active'", [productId]);
  if (product.rows.length === 0) return c.notFound();
  const productName = (product.rows[0] as Record<string, string>).name;

  // Get published artifacts
  const artifacts = await query(
    "SELECT title, artifact_type, phase, content, created_at FROM founding_story_artifacts WHERE product_id = ? AND published = 1 ORDER BY created_at ASC",
    [productId]
  );

  // Get audit score history
  const audits = await query(
    'SELECT composite, verdict, created_at FROM audit_scores WHERE product_id = ? ORDER BY created_at ASC',
    [productId]
  );

  const auditTimeline = audits.rows.map((a) => {
    const row = a as Record<string, unknown>;
    return `<div style="display:flex;gap:12px;padding:12px 0;border-bottom:1px solid #f3f4f6;">
      <div style="width:8px;height:8px;border-radius:50%;background:${(row.composite as number) >= 7 ? '#059669' : '#d97706'};margin-top:6px;flex-shrink:0;"></div>
      <div>
        <div style="font-weight:600;font-size:14px;">Audit: ${(row.composite as number)?.toFixed(1)}/10 — ${row.verdict}</div>
        <div style="font-size:12px;color:#6b7280;">${new Date(row.created_at as string).toLocaleDateString()}</div>
      </div>
    </div>`;
  }).join('');

  const artifactTimeline = artifacts.rows.map((a) => {
    const row = a as Record<string, string>;
    return `<div style="display:flex;gap:12px;padding:12px 0;border-bottom:1px solid #f3f4f6;">
      <div style="width:8px;height:8px;border-radius:50%;background:#2563eb;margin-top:6px;flex-shrink:0;"></div>
      <div>
        <div style="font-weight:600;font-size:14px;">${row.title}</div>
        <div style="font-size:12px;color:#6b7280;">${row.artifact_type} · ${new Date(row.created_at).toLocaleDateString()}</div>
        <div style="font-size:13px;color:#4b5563;margin-top:4px;line-height:1.6;">${(row.content ?? '').slice(0, 300)}${(row.content ?? '').length > 300 ? '...' : ''}</div>
      </div>
    </div>`;
  }).join('');

  return c.html(`<!DOCTYPE html><html lang="en"><head>
    <meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
    <title>${productName} — Product Journey | Foundry</title>
    <style>body{font-family:system-ui,sans-serif;color:#1a1a2e;background:#f5f6f8;margin:0;padding:0;}
    .container{max-width:700px;margin:0 auto;padding:2rem 1rem;}</style>
  </head><body>
    <div class="container">
      <div style="text-align:center;margin-bottom:2rem;">
        <h1 style="font-size:1.8rem;font-weight:800;margin-bottom:0.25rem;">${productName}</h1>
        <p style="color:#6b7280;">Product journey tracked by Foundry</p>
        <img src="/badge/${productId}" alt="Foundry Score" style="margin-top:0.5rem;" />
      </div>
      <div style="background:#fff;border:1px solid #e2e5ea;border-radius:8px;padding:1.5rem;">
        <h2 style="font-size:1.1rem;margin-bottom:1rem;">Timeline</h2>
        ${auditTimeline}
        ${artifactTimeline}
        ${audits.rows.length === 0 && artifacts.rows.length === 0 ? '<p style="text-align:center;color:#6b7280;padding:2rem;">No published journey data yet.</p>' : ''}
      </div>
      <p style="text-align:center;color:#9ca3af;font-size:12px;margin-top:2rem;">Verified by <a href="/" style="color:#2563eb;">Foundry</a> — Autonomous Business Intelligence</p>
    </div>
  </body></html>`);
});
