// =============================================================================
// FOUNDRY — Shared Dashboard Helpers
// Common data loader for layout context across all dashboard routes.
// =============================================================================

import { query, getProductsByOwner,
  getVisibleProducts, getLifecycleState } from '../../db/client.js';
/**
 * WHAT A DASHBOARD PAGE NEEDS TO RENDER, now that there is one renderer.
 *
 * This was imported from `views/layout.ts`, the other visual system's entry
 * point. Every page that used that system has moved to the owner shell, so the
 * module is gone and the shape it declared lives with the only code that still
 * builds one. Only the fields this context actually carries are kept — the
 * rest described a twenty-five item navigation, a command palette and a nav
 * badge struct that no longer exist.
 */
export interface LayoutOptions {
  title: string;
  founderName?: string | null;
  productName?: string | null;
  productId?: string | null;
  activeNav?: string;
  riskState?: string | null;
  riskReason?: string | null;
  founderEmail?: string | null;
  navBadges?: { decisions_count: number } | null;
  navExplainer?: string | null;
  showNav?: boolean;
  nextAction?: unknown;
  sidebarRiskClass?: string | null;
  chamberMode?: boolean;
}
import type { RiskStateValue, Founder } from '../../types/index.js';
import { getProductDNA } from '../../services/wisdom/dna.js';
import { getFluency, navExplain } from '../../services/ux/fluency.js';
import { getCookie } from 'hono/cookie';
import type { Context } from 'hono';
import type { AuthEnv } from '../../middleware/auth.js';

/**
 * Re-exported from the kernel, where it now lives.
 *
 * The old dashboard's pages still call it from here, and rewriting sixty
 * imports to prove a point would be a large diff that changes no behaviour.
 * What matters is that the OWNER'S shell no longer reaches through this file —
 * and therefore no longer depends on the commercial billing this file imports.
 */
export { selectedProductId } from '../../services/founder/selected-company.js';

export interface LayoutContext extends Required<Pick<LayoutOptions, 'title' | 'founderName' | 'productName' | 'productId' | 'activeNav' | 'riskState' | 'riskReason'>> {
  founderId: string;
  founder: Founder;
  founderEmail: string;
  dnaCompletionPct: number;
  wisdomLayerActive: boolean;
  /** CSRF token for form auto-injection */
  csrfToken: string;
  /** All products owned by this founder, for the switcher */
  allProducts: Array<{ id: string; name: string }>;
  /** Fluency Law: the page explainer strip ('' at technical or unmapped pages). */
  navExplainer: string;
}

/**
 * Fetch common layout data for a dashboard page.
 * Returns founder name, primary product info, and risk state.
 */

export async function getLayoutContext(
  founder: Founder,
  activeNav: string,
  title: string,
  /** Override product ID (e.g. from route param). Falls back to cookie, then first product. */
  overrideProductId?: string,
  /** Hono context, used to read the product switcher cookie */
  honoCtx?: Context,
): Promise<LayoutContext> {
  const founderName = founder.name ?? founder.email;

  // Every company this person may see — owned or accepted into. This used to
  // be `getProductsByOwner`, so an invited co-founder saw nothing at all.
  const products = await getVisibleProducts(founder.id);
  const allProducts = products.rows.map((p) => {
    const r = p as Record<string, unknown>;
    return { id: r.id as string, name: r.name as string };
  });

  // Extract CSRF token from Hono context
  const csrfToken = honoCtx ? ((honoCtx as any).get?.('csrfToken') as string ?? '') : '';

  if (products.rows.length === 0) {
    return {
      title,
      founderName,
      productName: null,
      productId: null,
      activeNav,
      riskState: null,
      riskReason: null,
      csrfToken,
      founderId: founder.id,
      founder,
      founderEmail: founder.email,
      dnaCompletionPct: 0,
      wisdomLayerActive: false,
      allProducts: [],
      navExplainer: navExplain(activeNav, getFluency(founder)),
    };
  }

  // Priority: explicit override > cookie > first product
  const cookieProductId = honoCtx ? getCookie(honoCtx, 'foundry_product') : undefined;
  const selectedId = overrideProductId ?? cookieProductId;

  let product = products.rows[0] as Record<string, unknown>;
  if (selectedId) {
    const match = products.rows.find((p) => (p as Record<string, unknown>).id === selectedId);
    if (match) product = match as Record<string, unknown>;
  }

  const productId = product.id as string;
  const productName = product.name as string;

  const lsResult = await getLifecycleState(productId);
  const ls = lsResult.rows[0] as Record<string, unknown> | undefined;
  const riskState = (ls?.risk_state as RiskStateValue) ?? 'green';
  const riskReason = (ls?.risk_state_reason as string) ?? null;

  // Wisdom layer context
  const dna = await getProductDNA(productId);
  const dnaCompletionPct = dna?.completion_pct ?? 0;
  const wisdomLayerActive = (ls?.wisdom_layer_active as number | null) === 1;
  return {
    title,
    founderName,
    productName,
    productId,
    activeNav,
    riskState,
    riskReason,
    csrfToken,
    founderId: founder.id,
    founder,
    founderEmail: founder.email,
    dnaCompletionPct,
    wisdomLayerActive,
    allProducts,
    navExplainer: navExplain(activeNav, getFluency(founder)),
  };
}

/**
 * Wraps getLayoutContext for routes that need ctx.product (e.g. investor routes).
 * Reads the founder from the Hono context automatically.
 */
export async function buildSharedContext(
  c: Context<AuthEnv>,
): Promise<LayoutContext & { product: { id: string; name: string } | null }> {
  const founder = c.get('founder');
  const ctx = await getLayoutContext(founder, 'investors', 'Investors', undefined, c);
  const product = ctx.productId ? { id: ctx.productId, name: ctx.productName ?? '' } : null;
  return { ...ctx, product };
}
