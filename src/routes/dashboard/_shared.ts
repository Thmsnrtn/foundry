// =============================================================================
// FOUNDRY — Shared Dashboard Helpers
// Common data loader for layout context across all dashboard routes.
// =============================================================================

import { isPrivateOwnerInstance } from '../../lib/instance-posture.js';
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
 * Re-exported from the kernel, where it now lives.
 *
 * The old dashboard's pages still call it from here, and rewriting sixty
 * imports to prove a point would be a large diff that changes no behaviour.
 * What matters is that the OWNER'S shell no longer reaches through this file —
 * and therefore no longer depends on the commercial billing this file imports.
 */
export { selectedProductId } from '../../services/founder/selected-company.js';

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

/**
 * WHAT THE OWNER OF THE INSTITUTION IS TOLD ABOUT TRIALS: NOTHING.
 *
 * `trialStatus` and `showStartTrial` drive the banner above every page — "Start
 * your 14-day free trial to keep your AI agents running. Choose a plan →". In a
 * commercial deployment that is honest. In a private owner institution it is an
 * invitation to buy access to something the reader already owns, and it is the
 * loudest element on the first screen a founder sees.
 *
 * Suppressed at the source rather than hidden in the template: a template that
 * merely stops rendering a countdown leaves the countdown running underneath,
 * and something else will eventually read it.
 */
function accessTrial(founder: { trial_ends_at?: string | null; tier?: string | null }): {
  trialStatus: TrialStatus; showStartTrial: boolean;
} {
  if (isPrivateOwnerInstance()) {
    return { trialStatus: { state: 'none', daysRemaining: 0, onTrial: false }, showStartTrial: false };
  }
  const trialStatus = getTrialStatus(founder.trial_ends_at, founder.tier);
  return { trialStatus, showStartTrial: !founder.tier && trialStatus.state === 'none' };
}

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
      ...accessTrial(founder),
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
    ...accessTrial(founder),
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
