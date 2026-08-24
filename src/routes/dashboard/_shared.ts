// =============================================================================
// FOUNDRY — Shared Dashboard Helpers
// Common data loader for layout context across all dashboard routes.
// =============================================================================

import { query, getProductsByOwner,
  getVisibleProducts, getLifecycleState } from '../../db/client.js';
import type { LayoutOptions } from '../../views/layout.js';
import type { RiskStateValue, NextAction, AppNotification, MilestoneEvent, OnboardingTour, NavBadges, Founder } from '../../types/index.js';
import { getProductDNA } from '../../services/wisdom/dna.js';
import { getNextAction } from '../../services/ux/next-action.js';
import { getUnreadNotifications, getUnreadCount } from '../../services/ux/notifications.js';
import { getUnseenMilestones } from '../../services/ux/milestones.js';
import { getTourState } from '../../services/ux/tour.js';
import { canAccess as canAccessFn } from '../../middleware/tier-gate.js';
import { getTrialStatus, type TrialStatus } from '../../services/billing/trial.js';
import { getFluency, navExplain } from '../../services/ux/fluency.js';
import { getCookie } from 'hono/cookie';
import type { Context } from 'hono';
import type { AuthEnv } from '../../middleware/auth.js';

/**
 * The company this founder is acting on, or null.
 *
 * WHICHEVER COMPANY SORTED FIRST WAS DECIDING REAL ACTIONS. Three POST routes
 * resolved the company with `SELECT id FROM products WHERE owner_id = ? LIMIT 1`
 * — no ORDER BY, so the row SQLite happened to return first. A founder with two
 * companies rotated an ingest token on whichever one that was, generated a
 * public share link for it, and had the week's plan written for it. The
 * pause/resume routes already did this correctly, from the cookie the company
 * switcher sets; this is that rule with one home.
 *
 * Returns null when there is no selection or the selection is not this
 * founder's, and the caller does nothing rather than acting on a guess.
 */
export async function selectedProductId(
  honoCtx: Parameters<typeof getCookie>[0],
  founderId: string,
): Promise<string | null> {
  const cookieProductId = getCookie(honoCtx, 'foundry_product');
  if (cookieProductId) {
    const owned = await query(
      'SELECT id FROM products WHERE id = ? AND owner_id = ?',
      [cookieProductId, founderId]);
    if (owned.rows.length > 0) return (owned.rows[0] as Record<string, string>).id;
  }

  // No cookie, or a stale one. A founder with exactly ONE company has made an
  // unambiguous choice by having only one; more than one is a choice nobody has
  // made, and picking is what this function exists to stop.
  const all = await query(
    "SELECT id FROM products WHERE owner_id = ? AND status != 'archived' ORDER BY id",
    [founderId]);
  return all.rows.length === 1 ? (all.rows[0] as Record<string, string>).id : null;
}

export interface UXContext {
  nextAction: NextAction | null;
  unreadNotifications: AppNotification[];
  unreadNotificationCount: number;
  unseenMilestones: MilestoneEvent[];
  tourState: OnboardingTour | null;
  navBadges: NavBadges;
  canAccess: (featureKey: string) => boolean;
}

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
  /** UX intelligence layer context */
  ux: UXContext;
  /** Trial state for the header badge / expiry banner (Phase 1.3). */
  trialStatus: TrialStatus;
  /** True when the founder has never started a trial or paid. */
  showStartTrial: boolean;
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

  const emptyUx: UXContext = {
    nextAction: null,
    unreadNotifications: [],
    unreadNotificationCount: 0,
    unseenMilestones: [],
    tourState: null,
    navBadges: { decisions_count: 0 },
    canAccess: (featureKey: string) => canAccessFn(founder, featureKey),
  };

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
      ux: emptyUx,
      trialStatus: getTrialStatus(founder.trial_ends_at, founder.tier),
      showStartTrial: !founder.tier && getTrialStatus(founder.trial_ends_at, founder.tier).state === 'none',
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
  // UX Intelligence Layer — parallel fetches
  const [nextAction, unreadNotifs, unreadCount, unseenMilestones, tourState] = await Promise.all([
    getNextAction(founder, productId),
    getUnreadNotifications(founder.id),
    getUnreadCount(founder.id),
    getUnseenMilestones(founder.id, productId),
    getTourState(founder.id),
  ]);

  // The one badge the sidebar draws. The other five were computed here, cached
  // in `lifecycle_state` by a job, and read into a struct the layout ignored.
  const navBadges: NavBadges = {
    decisions_count: (ls?.pending_decisions_count as number) ?? 0,
  };

  const ux: UXContext = {
    nextAction,
    unreadNotifications: unreadNotifs,
    unreadNotificationCount: unreadCount,
    unseenMilestones,
    tourState,
    navBadges,
    canAccess: (featureKey: string) => canAccessFn(founder, featureKey),
  };

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
    ux,
    trialStatus: getTrialStatus(founder.trial_ends_at, founder.tier),
    showStartTrial: !founder.tier && getTrialStatus(founder.trial_ends_at, founder.tier).state === 'none',
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
