import { Hono } from 'hono';
import { html } from 'hono/html';
import type { AuthEnv } from '../../middleware/auth.js';
import { query, getProductsByOwner, getVisibleProducts, getProductByOwner, getLifecycleState } from '../../db/client.js';
import { getProductDNA, upsertProductDNA, getDNACompletionStatus } from '../../services/wisdom/dna.js';
import { logFailure, getAllFailures } from '../../services/wisdom/failures.js';
import { getRelevantPatterns, invalidatePattern } from '../../services/wisdom/patterns.js';
import { getRemediationStats } from '../../services/audit/remediation.js';
import { dashboardLayout } from '../../views/layout.js';
import { dnaEditor, failureLogView, judgmentPatternsView, remediationPRList, remediationSummaryCard } from '../../views/components.js';
import { getLayoutContext } from './_shared.js';
import { checkAndAwardMilestones } from '../../services/ux/milestones.js';
import { requireTier } from '../../middleware/tier-gate.js';
import { requireCompanyCapability } from '../../middleware/rbac.js';
import { productDNAUpdateSchema, failureLogSchema, validate } from '../../lib/validation.js';
import { log } from '../../lib/logger.js';
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
  // Owned or accepted into.
  const result = await getVisibleProducts(founder.id);
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

  const ctx = await getLayoutContext(founder, 'dna', 'Product DNA', productId, c);
  const dna = await getProductDNA(productId);
  const completionPct = dna?.completion_pct ?? 0;
  const saved = c.req.query('saved') === '1';
  const draftedParam = c.req.query('drafted');
  const drafted = draftedParam !== undefined ? parseInt(draftedParam, 10) : null;

  const { getFluency: dnaFl, explain: dnaEx } = await import('../../services/ux/fluency.js');
  const dnaIntro = dnaEx('dna', dnaFl(founder));

  const content = html`
    <h1>Product DNA</h1>
    ${dnaIntro ? html`<p style="color:var(--text-muted);font-size:0.8rem;margin:-0.25rem 0 1rem;">${dnaIntro}</p>` : ''}
    ${saved ? html`<div style="padding:0.75rem 1rem;background:#d1fae5;color:#065f46;border-radius:6px;margin-bottom:1rem;font-size:0.9rem;">✓ Product DNA saved successfully. ${completionPct >= 60 ? 'Wisdom Layer is active.' : `${completionPct}% complete — reach 60% to activate Wisdom Layer.`}</div>` : ''}
    ${drafted !== null ? html`<div style="padding:0.75rem 1rem;background:${drafted > 0 ? '#dbeafe' : '#fef3c7'};color:${drafted > 0 ? '#1e40af' : '#92400e'};border-radius:6px;margin-bottom:1rem;font-size:0.9rem;">${drafted > 0 ? `✓ Drafted ${drafted} field${drafted === 1 ? '' : 's'} from your repo. Review and edit below, then save.` : 'Not enough signal to draft — connect a repo with a README, or fill the fields in yourself.'}</div>` : ''}
    <div style="display:flex;align-items:center;justify-content:space-between;gap:1rem;margin-bottom:1rem;flex-wrap:wrap;">
      <p style="color:var(--text-muted);font-size:0.9rem;margin:0;">Let Foundry draft these from your README and product metadata — then edit instead of typing from blank.</p>
      <form method="POST" action="/products/${productId}/dna/autodraft" style="margin:0;">
        <button type="submit" class="btn btn-secondary btn-sm">✨ Draft with AI</button>
      </form>
    </div>
    ${dnaEditor(dna as unknown as Record<string, unknown> | null, completionPct, productId)}
  `;
  return c.html(dashboardLayout(ctx, content));
});

// THE DNA IS WHAT EVERY AGENT GROUNDS ITSELF IN — the audience, the pain, the
// positioning, what the company is not. Editing it changes what the whole
// institution believes about itself, which is company management, not
// ordinary work.
productRoutes.post('/products/:id/dna', requireTier('wisdom'),
  requireCompanyCapability('can_manage_company'), async (c) => {
  const founder = c.get('founder');
  const productId = c.req.param('id');
  const prodResult = await getProductByOwner(productId, founder.id);
  if (prodResult.rows.length === 0) return c.json({ error: 'Not found' }, 404);

  const rawBody = await parseBody(c);
  const body = validate(productDNAUpdateSchema, rawBody);
  await upsertProductDNA(productId, founder.id, body as Record<string, string | null>);

  // UX Intelligence: check milestones after DNA save
  checkAndAwardMilestones(productId, founder.id).catch((err) => {
    log.error('Failed to check milestones after DNA save', err, { productId, founderId: founder.id });
  });

  return c.redirect(`/products/${productId}/dna?saved=1`);
});

// Draft the DNA fields from the founder's existing assets (README, metadata)
// with one AI call. Only fills empty fields — never overwrites the founder's
// own words (Phase 1.6).
productRoutes.post('/products/:id/dna/autodraft', requireTier('wisdom'), async (c) => {
  const founder = c.get('founder');
  const productId = c.req.param('id');
  const prodResult = await getProductByOwner(productId, founder.id);
  if (prodResult.rows.length === 0) return c.json({ error: 'Not found' }, 404);

  let drafted = 0;
  try {
    const { autofillProductDNA } = await import('../../services/wisdom/dna-autofill.js');
    drafted = await autofillProductDNA(productId, founder.id);
  } catch (err) {
    log.error('DNA autodraft failed', err, { productId });
  }
  return c.redirect(`/products/${productId}/dna?drafted=${drafted}`);
});

// ─── Failure Log Routes ──────────────────────────────────────────────────────

productRoutes.get('/products/:id/failures', requireTier('wisdom'), async (c) => {
  const founder = c.get('founder');
  const productId = c.req.param('id');
  const prodResult = await getProductByOwner(productId, founder.id);
  if (prodResult.rows.length === 0) return c.json({ error: 'Not found' }, 404);

  const ctx = await getLayoutContext(founder, 'failures', 'Failure Log', productId, c);
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

  const rawBody = await parseBody(c);
  const body = validate(failureLogSchema, rawBody);
  await logFailure(productId, founder.id, {
    category: body.category,
    what_was_tried: body.what_was_tried,
    timeframe: body.timeframe || undefined,
    outcome: body.outcome,
    founder_hypothesis: body.founder_hypothesis || undefined,
    linked_stressor_id: body.linked_stressor_id || undefined,
  });
  return c.redirect(`/products/${productId}/failures`);
});

// ─── Patterns Routes ─────────────────────────────────────────────────────────

productRoutes.get('/products/:id/patterns', requireTier('wisdom'), async (c) => {
  const founder = c.get('founder');
  const productId = c.req.param('id');
  const prodResult = await getProductByOwner(productId, founder.id);
  if (prodResult.rows.length === 0) return c.json({ error: 'Not found' }, 404);

  const ctx = await getLayoutContext(founder, 'patterns', 'Judgment Patterns', productId, c);
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

  const ctx = await getLayoutContext(founder, 'remediation', 'Remediation', productId, c);
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
