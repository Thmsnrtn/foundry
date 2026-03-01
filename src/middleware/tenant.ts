// =============================================================================
// FOUNDRY — Multi-Tenancy Middleware
// Validates product ownership for product-scoped routes.
// Returns 404 (not 403) for non-owned products — no information leak.
// =============================================================================

import { createMiddleware } from 'hono/factory';
import { getProductByOwner, getLifecycleState } from '../db/client.js';
import type { Product, LifecycleState, RiskStateValue, ProductStatus } from '../types/index.js';
import type { ProductRow, LifecycleStateRow } from '../types/database.js';

export interface TenantEnv {
  Variables: {
    founder: { id: string };
    product: Product;
    lifecycleState: LifecycleState;
  };
}

/**
 * Tenant middleware. Extracts product ID from route params, validates ownership,
 * and loads the product and lifecycle state into context.
 * Must be applied AFTER auth middleware.
 */
export const tenantMiddleware = createMiddleware<TenantEnv>(async (c, next) => {
  const founder = c.get('founder');
  if (!founder) {
    return c.json({ error: 'Authentication required' }, 401);
  }

  const productId = c.req.param('id') || c.req.param('productId');
  if (!productId) {
    return c.json({ error: 'Product ID required' }, 400);
  }

  // Validate ownership — returns 404 if not found or not owned
  const productResult = await getProductByOwner(productId, founder.id);
  if (productResult.rows.length === 0) {
    return c.json({ error: 'Not found' }, 404);
  }

  const row = productResult.rows[0] as unknown as ProductRow;
  const product: Product = {
    id: row.id,
    name: row.name,
    owner_id: row.owner_id,
    github_repo_url: row.github_repo_url,
    github_repo_owner: row.github_repo_owner,
    github_repo_name: row.github_repo_name,
    github_access_token: row.github_access_token,
    stack_description: row.stack_description,
    market_category: row.market_category,
    created_at: row.created_at,
    updated_at: row.updated_at,
    status: row.status as ProductStatus,
  };

  // Load lifecycle state
  const lifecycleResult = await getLifecycleState(productId);
  let lifecycleState: LifecycleState;

  if (lifecycleResult.rows.length === 0) {
    // Create default lifecycle state if none exists
    lifecycleState = {
      product_id: productId,
      current_prompt: 'prompt_1',
      risk_state: 'green',
      risk_state_changed_at: null,
      risk_state_reason: null,
      prompt_1_status: 'not_started',
      prompt_1_completed_at: null,
      prompt_1_verdict: null,
      prompt_1_composite: null,
      prompt_2_status: 'not_started',
      prompt_2_completed_at: null,
      prompt_2_hypotheses: null,
      prompt_2_5_status: 'not_started',
      prompt_2_5_tier: 0,
      prompt_3_status: 'not_started',
      prompt_3_completed_at: null,
      prompt_4_status: 'not_started',
      prompt_4_completed_at: null,
      prompt_5_status: 'dormant',
      prompt_5_last_run: null,
      prompt_6_status: 'dormant',
      prompt_7_status: 'dormant',
      prompt_8_status: 'dormant',
      prompt_9_status: 'dormant',
      prompt_9_started_at: null,
      updated_at: new Date().toISOString(),
    };
  } else {
    const lsRow = lifecycleResult.rows[0] as unknown as LifecycleStateRow;
    lifecycleState = {
      ...lsRow,
      risk_state: lsRow.risk_state as RiskStateValue,
      prompt_1_status: lsRow.prompt_1_status as LifecycleState['prompt_1_status'],
      prompt_2_status: lsRow.prompt_2_status as LifecycleState['prompt_2_status'],
      prompt_2_5_status: lsRow.prompt_2_5_status as LifecycleState['prompt_2_5_status'],
      prompt_3_status: lsRow.prompt_3_status as LifecycleState['prompt_3_status'],
      prompt_4_status: lsRow.prompt_4_status as LifecycleState['prompt_4_status'],
      prompt_5_status: lsRow.prompt_5_status as LifecycleState['prompt_5_status'],
      prompt_6_status: lsRow.prompt_6_status as LifecycleState['prompt_6_status'],
      prompt_7_status: lsRow.prompt_7_status as LifecycleState['prompt_7_status'],
      prompt_8_status: lsRow.prompt_8_status as LifecycleState['prompt_8_status'],
      prompt_9_status: lsRow.prompt_9_status as LifecycleState['prompt_9_status'],
      prompt_2_hypotheses: lsRow.prompt_2_hypotheses
        ? JSON.parse(lsRow.prompt_2_hypotheses)
        : null,
    };
  }

  c.set('product', product);
  c.set('lifecycleState', lifecycleState);
  await next();
});
