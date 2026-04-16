// =============================================================================
// FOUNDRY — Public REST API v1
// API key authenticated. Rate limited. Versioned.
// =============================================================================

import { Hono } from 'hono';
import { apiKeyAuth, createApiKey, listApiKeys, revokeApiKey, type ApiKeyEnv } from '../../middleware/api-key.js';
import { calculateHealthScore } from '../../services/intelligence/health-score.js';
import { apiRateLimit } from '../../middleware/rate-limit.js';
import { query, getProductByOwner, getProductsByOwner, getLatestAudit, getLatestMetrics, getActiveStressors, getPendingDecisions, getAuditLog } from '../../db/client.js';
import { getMRRDecomposition, computeHealthRatio } from '../../services/intelligence/revenue.js';
import { parsePagination, paginatedQuery } from '../../lib/pagination.js';
import { reportMetricsSchema, validate } from '../../lib/validation.js';
import { nanoid } from 'nanoid';
import type { AuthEnv } from '../../middleware/auth.js';

export const v1Routes = new Hono<ApiKeyEnv>();

// ─── API Key Management (requires session auth, not API key) ────────────────

export const apiKeyRoutes = new Hono<AuthEnv>();

apiKeyRoutes.get('/settings/api-keys', async (c) => {
  const founder = c.get('founder');
  const keys = await listApiKeys(founder.id);
  return c.json({ keys });
});

apiKeyRoutes.post('/settings/api-keys', async (c) => {
  const founder = c.get('founder');
  const body = await c.req.json() as { name: string };
  if (!body.name || body.name.length > 100) {
    return c.json({ error: 'Name is required (max 100 chars)' }, 400);
  }

  // Limit to 5 active keys
  const existing = await listApiKeys(founder.id);
  if (existing.length >= 5) {
    return c.json({ error: 'Maximum 5 API keys allowed' }, 400);
  }

  const result = await createApiKey(founder.id, body.name);
  return c.json({
    key: result.key,
    id: result.id,
    name: result.name,
    message: 'Store this key securely. It will not be shown again.',
  }, 201);
});

apiKeyRoutes.delete('/settings/api-keys/:id', async (c) => {
  const founder = c.get('founder');
  const keyId = c.req.param('id');
  const revoked = await revokeApiKey(keyId, founder.id);
  if (!revoked) return c.json({ error: 'Key not found' }, 404);
  return c.json({ status: 'revoked' });
});

// ─── Public API (API key auth) ──────────────────────────────────────────────

v1Routes.use('*', apiRateLimit);
v1Routes.use('*', apiKeyAuth);

// Products
v1Routes.get('/v1/products', async (c) => {
  const founder = c.get('founder');
  const result = await getProductsByOwner(founder.id);
  const safe = result.rows.map((row) => {
    const p = row as Record<string, unknown>;
    const { github_access_token, ...rest } = p;
    return rest;
  });
  return c.json({ products: safe });
});

v1Routes.get('/v1/products/:id', async (c) => {
  const founder = c.get('founder');
  const productId = c.req.param('id');
  const result = await getProductByOwner(productId, founder.id);
  if (result.rows.length === 0) return c.json({ error: 'Product not found' }, 404);
  const p = result.rows[0] as Record<string, unknown>;
  const { github_access_token, ...safe } = p;
  return c.json({ product: safe });
});

// Metrics
v1Routes.get('/v1/products/:id/metrics', async (c) => {
  const founder = c.get('founder');
  const productId = c.req.param('id');
  const check = await getProductByOwner(productId, founder.id);
  if (check.rows.length === 0) return c.json({ error: 'Not found' }, 404);
  const latest = await getLatestMetrics(productId);
  return c.json({ metrics: latest.rows[0] ?? null });
});

v1Routes.post('/v1/products/:id/metrics', async (c) => {
  const founder = c.get('founder');
  const productId = c.req.param('id');
  const check = await getProductByOwner(productId, founder.id);
  if (check.rows.length === 0) return c.json({ error: 'Not found' }, 404);

  const body = validate(reportMetricsSchema, await c.req.json());
  const today = new Date().toISOString().split('T')[0];
  const newMrr = body.new_mrr_cents ?? 0;
  const churned = body.churned_mrr_cents ?? 0;
  const healthRatio = newMrr > 0 ? churned / newMrr : null;

  await query(
    `INSERT INTO metric_snapshots (id, product_id, snapshot_date, signups_7d, active_users, new_mrr_cents, expansion_mrr_cents, contraction_mrr_cents, churned_mrr_cents, activation_rate, day_30_retention, support_volume_7d, nps_score, churn_rate, mrr_health_ratio)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT (product_id, snapshot_date) DO UPDATE SET
       signups_7d = excluded.signups_7d, active_users = excluded.active_users, new_mrr_cents = excluded.new_mrr_cents,
       expansion_mrr_cents = excluded.expansion_mrr_cents, contraction_mrr_cents = excluded.contraction_mrr_cents,
       churned_mrr_cents = excluded.churned_mrr_cents, activation_rate = excluded.activation_rate,
       day_30_retention = excluded.day_30_retention, support_volume_7d = excluded.support_volume_7d,
       nps_score = excluded.nps_score, churn_rate = excluded.churn_rate, mrr_health_ratio = excluded.mrr_health_ratio`,
    [nanoid(), productId, today, body.signups_7d ?? null, body.active_users ?? null,
     newMrr, body.expansion_mrr_cents ?? 0, body.contraction_mrr_cents ?? 0, churned,
     body.activation_rate ?? null, body.day_30_retention ?? null, body.support_volume_7d ?? null,
     body.nps_score ?? null, body.churn_rate ?? null, healthRatio]
  );
  return c.json({ status: 'recorded', date: today });
});

// Audit
v1Routes.get('/v1/products/:id/audit/latest', async (c) => {
  const founder = c.get('founder');
  const productId = c.req.param('id');
  const check = await getProductByOwner(productId, founder.id);
  if (check.rows.length === 0) return c.json({ error: 'Not found' }, 404);
  const audit = await getLatestAudit(productId);
  return c.json({ audit: audit.rows[0] ?? null });
});

// Stressors
v1Routes.get('/v1/products/:id/stressors', async (c) => {
  const founder = c.get('founder');
  const productId = c.req.param('id');
  const check = await getProductByOwner(productId, founder.id);
  if (check.rows.length === 0) return c.json({ error: 'Not found' }, 404);
  const stressors = await getActiveStressors(productId);
  return c.json({ stressors: stressors.rows });
});

// Decisions
v1Routes.get('/v1/products/:id/decisions', async (c) => {
  const founder = c.get('founder');
  const productId = c.req.param('id');
  const check = await getProductByOwner(productId, founder.id);
  if (check.rows.length === 0) return c.json({ error: 'Not found' }, 404);
  const pagination = parsePagination({ page: c.req.query('page'), limit: c.req.query('limit') });
  const result = await paginatedQuery(
    'SELECT * FROM decisions WHERE product_id = ? ORDER BY created_at DESC',
    'SELECT COUNT(*) as count FROM decisions WHERE product_id = ?',
    [productId], [productId], pagination,
  );
  return c.json(result);
});

// MRR
v1Routes.get('/v1/products/:id/mrr', async (c) => {
  const founder = c.get('founder');
  const productId = c.req.param('id');
  const check = await getProductByOwner(productId, founder.id);
  if (check.rows.length === 0) return c.json({ error: 'Not found' }, 404);
  const mrr = await getMRRDecomposition(productId);
  const health = mrr ? computeHealthRatio(mrr) : null;
  return c.json({ mrr, health });
});

// Audit log
v1Routes.get('/v1/products/:id/audit-log', async (c) => {
  const founder = c.get('founder');
  const productId = c.req.param('id');
  const check = await getProductByOwner(productId, founder.id);
  if (check.rows.length === 0) return c.json({ error: 'Not found' }, 404);
  const pagination = parsePagination({ page: c.req.query('page'), limit: c.req.query('limit') });
  const result = await paginatedQuery(
    'SELECT * FROM audit_log WHERE product_id = ? ORDER BY created_at DESC',
    'SELECT COUNT(*) as count FROM audit_log WHERE product_id = ?',
    [productId], [productId], pagination,
  );
  return c.json(result);
});

// Health Score
v1Routes.get('/v1/products/:id/health', async (c) => {
  const founder = c.get('founder');
  const productId = c.req.param('id');
  const check = await getProductByOwner(productId, founder.id);
  if (check.rows.length === 0) return c.json({ error: 'Not found' }, 404);
  const score = await calculateHealthScore(productId);
  return c.json({ health: score });
});

// Trigger audit via API
v1Routes.post('/v1/products/:id/audit/run', async (c) => {
  const founder = c.get('founder');
  const productId = c.req.param('id');
  const check = await getProductByOwner(productId, founder.id);
  if (check.rows.length === 0) return c.json({ error: 'Not found' }, 404);

  const product = check.rows[0] as Record<string, unknown>;
  if (!product.github_repo_owner || !product.github_repo_name || !product.github_access_token) {
    return c.json({ error: 'GitHub repository not connected. Audit requires a connected repo.' }, 400);
  }

  // Import audit engine dynamically to avoid circular deps
  const { runAudit } = await import('../../services/audit/engine.js');
  const priorAudit = await getLatestAudit(productId);
  const runType = priorAudit.rows.length > 0 ? 'post_remediation' as const : 'initial' as const;

  const audit = await runAudit({
    id: product.id as string, name: product.name as string, owner_id: product.owner_id as string,
    github_repo_url: product.github_repo_url as string | null,
    github_repo_owner: product.github_repo_owner as string | null,
    github_repo_name: product.github_repo_name as string | null,
    github_access_token: product.github_access_token as string | null,
    stack_description: null, market_category: null,
    created_at: product.created_at as string, updated_at: product.updated_at as string,
    status: 'active',
  }, runType);

  return c.json({ audit_id: audit.id, composite: audit.composite, verdict: audit.verdict, status: 'completed' }, 201);
});

// Create decision via API
v1Routes.post('/v1/products/:id/decisions', async (c) => {
  const founder = c.get('founder');
  const productId = c.req.param('id');
  const check = await getProductByOwner(productId, founder.id);
  if (check.rows.length === 0) return c.json({ error: 'Not found' }, 404);

  const body = validate(reportMetricsSchema, await c.req.json()); // reuse for now; TODO: decision schema
  // Actually, let's validate with a proper schema
  const { z } = await import('zod');
  const schema = z.object({
    category: z.enum(['urgent', 'strategic', 'product', 'marketing', 'informational']),
    what: z.string().min(1).max(500),
    why_now: z.string().min(1).max(2000),
    options: z.array(z.object({ label: z.string(), description: z.string().optional(), trade_offs: z.string().optional() })).min(2).max(6).optional(),
    deadline: z.string().optional(),
  });
  const decision = schema.parse(await c.req.json());

  const decisionId = nanoid();
  await query(
    `INSERT INTO decisions (id, product_id, category, gate, what, why_now, options, deadline, status)
     VALUES (?, ?, ?, 3, ?, ?, ?, ?, 'pending')`,
    [decisionId, productId, decision.category, decision.what, decision.why_now,
     decision.options ? JSON.stringify(decision.options) : null, decision.deadline ?? null]
  );
  return c.json({ decision_id: decisionId, status: 'created' }, 201);
});

// Resolve decision via API
v1Routes.post('/v1/decisions/:id/resolve', async (c) => {
  const founder = c.get('founder');
  const decisionId = c.req.param('id');

  const result = await query(
    `SELECT d.product_id, d.gate FROM decisions d JOIN products p ON d.product_id = p.id WHERE d.id = ? AND p.owner_id = ?`,
    [decisionId, founder.id]
  );
  if (result.rows.length === 0) return c.json({ error: 'Not found' }, 404);

  const { resolveDecision } = await import('../../services/decisions/queue.js');
  const body = validate(reportMetricsSchema, {}); // placeholder
  // Actually parse properly:
  const raw = await c.req.json() as { chosen_option: string; resolution_reasoning?: string };
  if (!raw.chosen_option) return c.json({ error: 'chosen_option is required' }, 400);

  const row = result.rows[0] as Record<string, unknown>;
  await resolveDecision(decisionId, row.product_id as string, raw.chosen_option, 'api');

  if (raw.resolution_reasoning) {
    await query('UPDATE decisions SET resolution_reasoning = ? WHERE id = ?', [raw.resolution_reasoning, decisionId]);
  }
  return c.json({ status: 'resolved' });
});

// Get digest data as JSON
v1Routes.get('/v1/products/:id/digest', async (c) => {
  const founder = c.get('founder');
  const productId = c.req.param('id');
  const check = await getProductByOwner(productId, founder.id);
  if (check.rows.length === 0) return c.json({ error: 'Not found' }, 404);

  const { generateDigest } = await import('../../services/digest/generator.js');
  const ls = await query('SELECT risk_state FROM lifecycle_state WHERE product_id = ?', [productId]);
  const riskState = ((ls.rows[0] as Record<string, string>)?.risk_state ?? 'green') as 'green' | 'yellow' | 'red';
  const digest = await generateDigest(productId, riskState, 'weekly');
  return c.json({ digest });
});
