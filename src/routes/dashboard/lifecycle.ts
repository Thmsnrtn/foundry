import { Hono } from 'hono';
import { html } from 'hono/html';
import type { AuthEnv } from '../../middleware/auth.js';
import { query, getProductByOwner, getLifecycleState, getLifecycleConditions } from '../../db/client.js';
import { dashboardLayout } from '../../views/layout.js';
import { lifecycleProgress, lifecycleConditions } from '../../views/components.js';
import { getLayoutContext } from './_shared.js';

export const lifecycleRoutes = new Hono<AuthEnv>();

lifecycleRoutes.get('/products/:id/lifecycle', async (c) => {
  const founder = c.get('founder');
  const productId = c.req.param('id');
  const prodResult = await getProductByOwner(productId, founder.id);
  if (prodResult.rows.length === 0) return c.json({ error: 'Not found' }, 404);

  const ctx = await getLayoutContext(founder, 'lifecycle', 'Lifecycle', productId);
  const state = await getLifecycleState(productId);
  const conditionsResult = await getLifecycleConditions(productId);
  const ls = state.rows[0] as Record<string, unknown> | undefined;
  const currentPrompt = (ls?.current_prompt as string) ?? 'prompt_1';

  const content = html`
    <h1>Lifecycle</h1>
    <div class="card">
      <h3>Current Position</h3>
      ${lifecycleProgress(currentPrompt)}
      <p style="margin-top:0.75rem;">
        <strong>Current Prompt:</strong> ${currentPrompt}
        ${ls?.risk_state ? html` · <strong>Risk State:</strong> ${ls.risk_state}` : ''}
      </p>
    </div>
    ${lifecycleConditions(conditionsResult.rows as Array<Record<string, unknown>>)}
  `;

  return c.html(dashboardLayout(ctx, content));
});
