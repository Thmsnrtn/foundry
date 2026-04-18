// =============================================================================
// FOUNDRY — Idea Validation Engine
// For founders at Stage 1: "I have an idea but haven't built yet."
// Uses competitive intelligence, cross-product patterns, and AI research
// to help founders validate their concept before writing a line of code.
// =============================================================================

import { Hono } from 'hono';
import { html } from 'hono/html';
import type { AuthEnv } from '../../middleware/auth.js';
import { query, getProductByOwner } from '../../db/client.js';
import { dashboardLayout } from '../../views/layout.js';
import { getLayoutContext } from './_shared.js';
import { callSonnet } from '../../services/ai/client.js';
import { trackUsage } from '../../lib/usage-tracking.js';
import { nanoid } from 'nanoid';
import { z } from 'zod';
import { validate } from '../../lib/validation.js';
import { log } from '../../lib/logger.js';

export const ideaRoutes = new Hono<AuthEnv>();

// ─── Idea Validation Page ───────────────────────────────────────────────────

ideaRoutes.get('/products/:id/validate', async (c) => {
  const founder = c.get('founder');
  const productId = c.req.param('id');
  const prodResult = await getProductByOwner(productId, founder.id);
  if (prodResult.rows.length === 0) return c.redirect('/dashboard');

  const product = prodResult.rows[0] as Record<string, string>;
  const ctx = await getLayoutContext(founder, 'validate', 'Validate Idea', productId, c);

  // Check for existing validation
  const existing = await query(
    'SELECT * FROM idea_validations WHERE product_id = ? ORDER BY created_at DESC LIMIT 1',
    [productId]
  );
  const validation = existing.rows[0] as Record<string, string> | undefined;

  const content = html`
    <h1>Validate Your Idea</h1>
    <p style="color:var(--color-text-muted);margin-bottom:1.5rem;">
      Before you build, let Foundry research your market, identify competitors, and stress-test your hypothesis.
      This saves weeks of manual research and helps you avoid building something nobody wants.
    </p>

    ${validation ? html`
    <div class="card" style="border-left:3px solid var(--color-primary);margin-bottom:1.5rem;">
      <div style="display:flex;justify-content:space-between;align-items:start;">
        <div>
          <h3 style="margin-bottom:0.25rem;">Latest Validation</h3>
          <p style="font-size:var(--text-xs);color:var(--color-text-faint);">${new Date(validation.created_at).toLocaleDateString()}</p>
        </div>
        <span class="status-badge ${validation.verdict === 'strong' ? 'status-green' : validation.verdict === 'moderate' ? 'status-yellow' : 'status-red'}">${validation.verdict}</span>
      </div>
      <div style="margin-top:1rem;font-size:var(--text-sm);white-space:pre-wrap;line-height:1.7;">${validation.analysis}</div>
    </div>` : ''}

    <div class="card">
      <h3>${validation ? 'Run Another Validation' : 'Describe Your Idea'}</h3>
      <form method="POST" action="/products/${productId}/validate">
        <div class="form-group">
          <label for="idea_description">What are you building? (2-3 sentences)</label>
          <textarea name="idea_description" id="idea_description" rows="3" required
            placeholder="Example: A tool that helps SaaS founders track their revenue health and get AI-powered business intelligence without hiring a data team.">${product.stack_description ?? ''}</textarea>
        </div>
        <div class="form-group">
          <label for="target_customer">Who is your target customer?</label>
          <input type="text" name="target_customer" id="target_customer" required
            placeholder="Example: Solo SaaS founders doing $1K-50K MRR" />
        </div>
        <div class="form-group">
          <label for="hypothesis">What's your core hypothesis? (What must be true for this to work?)</label>
          <textarea name="hypothesis" id="hypothesis" rows="2" required
            placeholder="Example: Solo founders will pay $99-399/month for automated business intelligence because they can't afford to hire an ops person."></textarea>
        </div>
        <div class="form-group">
          <label for="known_competitors">Known competitors (optional, comma-separated)</label>
          <input type="text" name="known_competitors" id="known_competitors"
            placeholder="Example: Baremetrics, ProfitWell, ChartMogul" />
        </div>
        <button type="submit" class="btn btn-primary" onclick="this.disabled=true;this.textContent='Researching (30-60 seconds)...';this.form.submit();">
          Validate Idea
        </button>
        <p style="font-size:var(--text-xs);color:var(--color-text-faint);margin-top:0.5rem;">
          Uses Claude to research your market, analyze competitors, and stress-test your hypothesis.
        </p>
      </form>
    </div>

    ${!validation ? html`
    <div class="card" style="background:var(--color-primary-subtle);">
      <h3>What Foundry Researches</h3>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:1rem;font-size:var(--text-sm);">
        <div>
          <strong>Market Analysis</strong>
          <p style="color:var(--color-text-muted);">Size of addressable market, growth trajectory, timing signals</p>
        </div>
        <div>
          <strong>Competitive Landscape</strong>
          <p style="color:var(--color-text-muted);">Direct and indirect competitors, their positioning, gaps you can exploit</p>
        </div>
        <div>
          <strong>Hypothesis Stress Test</strong>
          <p style="color:var(--color-text-muted);">What must be true for your hypothesis? What are the riskiest assumptions?</p>
        </div>
        <div>
          <strong>Go/No-Go Recommendation</strong>
          <p style="color:var(--color-text-muted);">Honest assessment: build it, pivot it, or kill it — with reasoning</p>
        </div>
      </div>
    </div>` : ''}
  `;

  return c.html(dashboardLayout(ctx, content));
});

// ─── Run Validation ─────────────────────────────────────────────────────────

const validateSchema = z.object({
  idea_description: z.string().min(10).max(2000),
  target_customer: z.string().min(5).max(500),
  hypothesis: z.string().min(10).max(2000),
  known_competitors: z.string().max(1000).optional(),
});

ideaRoutes.post('/products/:id/validate', async (c) => {
  const founder = c.get('founder');
  const productId = c.req.param('id');
  const prodResult = await getProductByOwner(productId, founder.id);
  if (prodResult.rows.length === 0) return c.redirect('/dashboard');

  const raw = await c.req.parseBody() as Record<string, string>;
  const body = validate(validateSchema, raw);

  // Use cross-product patterns for calibration
  const patternCount = await query('SELECT COUNT(*) as c FROM decision_patterns', []);
  const patterns = (patternCount.rows[0] as Record<string, number>)?.c ?? 0;

  try {
    const response = await callSonnet(
      `You are a startup advisor and market researcher. You have access to data from ${patterns} anonymized SaaS founder decision outcomes.
       Be brutally honest. Don't encourage bad ideas — the founder's time is the most expensive resource.
       Structure your response with clear sections.`,
      `Validate this SaaS idea:

IDEA: ${body.idea_description}
TARGET CUSTOMER: ${body.target_customer}
HYPOTHESIS: ${body.hypothesis}
KNOWN COMPETITORS: ${body.known_competitors || 'None specified'}

Provide:

## Market Analysis
Size, growth, timing. Is this a growing market or a shrinking one?

## Competitive Landscape
Who already does this? What's their positioning? Where are the gaps?
${body.known_competitors ? `The founder mentioned: ${body.known_competitors}. Analyze these plus any they missed.` : 'Research the competitive landscape.'}

## Hypothesis Stress Test
What are the 3 riskiest assumptions in this hypothesis? For each:
- What evidence would confirm it?
- What evidence would disprove it?
- How can they test it cheaply (under $100 and 1 week)?

## Unique Advantage Assessment
Based on the idea description, what could be this founder's unfair advantage? What would make this defensible?

## Verdict
Rate: STRONG (clear market need + defensible position), MODERATE (market exists but execution risk is high), or WEAK (fundamental assumptions are questionable).

## Recommended Next Steps
3 specific actions ranked by impact. Each should take less than 1 week and less than $100.`,
      4096,
    );

    // Extract verdict from response
    const verdictMatch = response.content.match(/Verdict[:\s]*\n?\*?\*?(STRONG|MODERATE|WEAK)/i);
    const verdict = verdictMatch ? verdictMatch[1].toLowerCase() : 'moderate';

    // Store validation
    const validationId = nanoid();
    await query(
      `INSERT INTO idea_validations (id, product_id, idea_description, target_customer, hypothesis, known_competitors, analysis, verdict, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [validationId, productId, body.idea_description, body.target_customer, body.hypothesis,
       body.known_competitors ?? null, response.content, verdict, new Date().toISOString()]
    );

    // Update product description if empty
    const product = prodResult.rows[0] as Record<string, string>;
    if (!product.stack_description) {
      await query('UPDATE products SET stack_description = ? WHERE id = ?', [body.idea_description, productId]);
    }

    // Track usage
    trackUsage(productId, response, 'idea_validation').catch(() => {});

    // Log to audit trail
    await query(
      `INSERT INTO audit_log (id, product_id, action_type, gate, trigger, reasoning, created_at)
       VALUES (?, ?, 'idea_validation', 2, 'founder_request', ?, ?)`,
      [nanoid(), productId, `Idea validated: ${verdict}`, new Date().toISOString()]
    );

    return c.redirect(`/products/${productId}/validate`);
  } catch (err) {
    log.error('Idea validation failed', err, { productId, founderId: founder.id });
    return c.redirect(`/products/${productId}/validate?error=validation_failed`);
  }
});
