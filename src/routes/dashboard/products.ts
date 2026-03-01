import { Hono } from 'hono';
import { html } from 'hono/html';
import type { AuthEnv } from '../../middleware/auth.js';
import { query, getProductsByOwner, getProductByOwner, getLifecycleState } from '../../db/client.js';
import { getProductDNA, upsertProductDNA, getDNACompletionStatus } from '../../services/wisdom/dna.js';
import { logFailure, getAllFailures } from '../../services/wisdom/failures.js';
import { getRelevantPatterns, invalidatePattern } from '../../services/wisdom/patterns.js';
import { getRemediationStats } from '../../services/audit/remediation.js';
import { dashboardLayout } from '../../views/layout.js';
import { dnaEditor, failureLogView, judgmentPatternsView, remediationPRList, remediationSummaryCard } from '../../views/components.js';
import { getLayoutContext } from './_shared.js';
import { checkAndAwardMilestones } from '../../services/ux/milestones.js';
import { requireTier } from '../../middleware/tier-gate.js';
import type { FailureCategory } from '../../types/index.js';

/** Parse body from JSON or form-encoded data. */
async function parseBody(c: { req: { header: (n: string) => string | undefined; json: () => Promise<any>; parseBody: () => Promise<any> } }): Promise<Record<string, unknown>> {
  const ct = c.req.header('Content-Type') ?? '';
  if (ct.includes('application/json')) return await c.req.json();
  return await c.req.parseBody() as Record<string, unknown>;
}

export const productRoutes = new Hono<AuthEnv>();

productRoutes.get('/products', async (c) => {
  const founder = c.get('founder');
  const result = await getProductsByOwner(founder.id);
  return c.json({ products: result.rows });
});

productRoutes.get('/products/:id', async (c) => {
  const founder = c.get('founder');
  const productId = c.req.param('id');
  const prodResult = await getProductByOwner(productId, founder.id);
  if (prodResult.rows.length === 0) return c.json({ error: 'Not found' }, 404);
  const ls = await getLifecycleState(productId);
  return c.json({ product: prodResult.rows[0], lifecycle: ls.rows[0] ?? null });
});

// ─── DNA Routes (Wisdom-gated) ───────────────────────────────────────────────

productRoutes.get('/products/:id/dna', requireTier('wisdom'), async (c) => {
  const founder = c.get('founder');
  const productId = c.req.param('id');
  const prodResult = await getProductByOwner(productId, founder.id);
  if (prodResult.rows.length === 0) return c.json({ error: 'Not found' }, 404);

  const ctx = await getLayoutContext(founder, 'dna', 'Product DNA', productId);
  const dna = await getProductDNA(productId);
  const completionPct = dna?.completion_pct ?? 0;
  const saved = c.req.query('saved') === '1';

  const content = html`
    <h1>Product DNA</h1>
    ${saved ? html`<div style="padding:0.75rem 1rem;background:#d1fae5;color:#065f46;border-radius:6px;margin-bottom:1rem;font-size:0.9rem;">✓ Product DNA saved successfully. ${completionPct >= 60 ? 'Wisdom Layer is active.' : `${completionPct}% complete — reach 60% to activate Wisdom Layer.`}</div>` : ''}
    ${dnaEditor(dna as unknown as Record<string, unknown> | null, completionPct, productId)}
  `;
  return c.html(dashboardLayout(ctx, content));
});

productRoutes.post('/products/:id/dna', requireTier('wisdom'), async (c) => {
  const founder = c.get('founder');
  const productId = c.req.param('id');
  const prodResult = await getProductByOwner(productId, founder.id);
  if (prodResult.rows.length === 0) return c.json({ error: 'Not found' }, 404);

  const body = await parseBody(c);
  await upsertProductDNA(productId, founder.id, body as Record<string, string | null>);

  // UX Intelligence: check milestones after DNA save
  checkAndAwardMilestones(productId, founder.id).catch(() => {});

  return c.redirect(`/products/${productId}/dna?saved=1`);
});

// ─── Failure Log Routes ──────────────────────────────────────────────────────

productRoutes.get('/products/:id/failures', requireTier('wisdom'), async (c) => {
  const founder = c.get('founder');
  const productId = c.req.param('id');
  const prodResult = await getProductByOwner(productId, founder.id);
  if (prodResult.rows.length === 0) return c.json({ error: 'Not found' }, 404);

  const ctx = await getLayoutContext(founder, 'failures', 'Failure Log', productId);
  const failures = await getAllFailures(productId);

  const content = html`
    <h1>Failure Log</h1>
    ${failureLogView(failures as unknown as Array<Record<string, unknown>>, productId)}
  `;
  return c.html(dashboardLayout(ctx, content));
});

productRoutes.post('/products/:id/failures', requireTier('wisdom'), async (c) => {
  const founder = c.get('founder');
  const productId = c.req.param('id');
  const prodResult = await getProductByOwner(productId, founder.id);
  if (prodResult.rows.length === 0) return c.json({ error: 'Not found' }, 404);

  const body = await parseBody(c);
  await logFailure(productId, founder.id, {
    category: body.category as FailureCategory,
    what_was_tried: body.what_was_tried as string,
    timeframe: (body.timeframe as string) || undefined,
    outcome: body.outcome as string,
    founder_hypothesis: (body.founder_hypothesis as string) || undefined,
    linked_stressor_id: (body.linked_stressor as string) || undefined,
  });
  return c.redirect(`/products/${productId}/failures`);
});

// ─── Patterns Routes ─────────────────────────────────────────────────────────

productRoutes.get('/products/:id/patterns', requireTier('wisdom'), async (c) => {
  const founder = c.get('founder');
  const productId = c.req.param('id');
  const prodResult = await getProductByOwner(productId, founder.id);
  if (prodResult.rows.length === 0) return c.json({ error: 'Not found' }, 404);

  const ctx = await getLayoutContext(founder, 'patterns', 'Judgment Patterns', productId);
  const patternsResult = await query(
    'SELECT * FROM founder_judgment_patterns WHERE product_id = ? ORDER BY confidence DESC',
    [productId]
  );

  const content = html`
    <h1>Judgment Patterns</h1>
    ${judgmentPatternsView(patternsResult.rows as Array<Record<string, unknown>>, productId)}
  `;
  return c.html(dashboardLayout(ctx, content));
});

productRoutes.post('/products/:id/patterns/:patternId/invalidate', requireTier('wisdom'), async (c) => {
  const founder = c.get('founder');
  const productId = c.req.param('id');
  const patternId = c.req.param('patternId');
  const prodResult = await getProductByOwner(productId, founder.id);
  if (prodResult.rows.length === 0) return c.json({ error: 'Not found' }, 404);

  await invalidatePattern(patternId, founder.id);
  return c.redirect(`/products/${productId}/patterns`);
});

// ─── Remediation Routes ──────────────────────────────────────────────────────

productRoutes.get('/products/:id/remediation', requireTier('remediation'), async (c) => {
  const founder = c.get('founder');
  const productId = c.req.param('id');
  const prodResult = await getProductByOwner(productId, founder.id);
  if (prodResult.rows.length === 0) return c.json({ error: 'Not found' }, 404);

  const ctx = await getLayoutContext(founder, 'remediation', 'Remediation', productId);
  const stats = await getRemediationStats(productId);
  const prsResult = await query(
    'SELECT * FROM remediation_prs WHERE product_id = ? ORDER BY created_at DESC',
    [productId]
  );

  const content = html`
    <h1>Remediation</h1>
    ${remediationSummaryCard(stats)}
    ${remediationPRList(prsResult.rows as Array<Record<string, unknown>>)}
  `;
  return c.html(dashboardLayout(ctx, content));
});
