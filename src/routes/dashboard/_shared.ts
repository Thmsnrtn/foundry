// =============================================================================
// FOUNDRY — Shared Dashboard Helpers
// Common data loader for layout context across all dashboard routes.
// =============================================================================

import { query, getProductsByOwner, getLifecycleState } from '../../db/client.js';
import type { LayoutOptions } from '../../views/layout.js';
import type { RiskStateValue, NextAction, AppNotification, MilestoneEvent, OnboardingTour, NavBadges, Founder } from '../../types/index.js';
import { getProductDNA } from '../../services/wisdom/dna.js';
import { getNextAction } from '../../services/ux/next-action.js';
import { getUnreadNotifications, getUnreadCount } from '../../services/ux/notifications.js';
import { getUnseenMilestones } from '../../services/ux/milestones.js';
import { getTourState } from '../../services/ux/tour.js';
import { canAccess as canAccessFn } from '../../middleware/tier-gate.js';
import { getCookie } from 'hono/cookie';
import type { Context } from 'hono';

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
  dnaCompletionPct: number;
  wisdomLayerActive: boolean;
  openPRCount: number;
  /** All products owned by this founder, for the switcher */
  allProducts: Array<{ id: string; name: string }>;
  /** UX intelligence layer context */
  ux: UXContext;
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

  const products = await getProductsByOwner(founder.id);
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
    navBadges: { decisions_count: 0, has_overdue_audit: false, unread_signals: false, unseen_milestones: false, open_prs_count: 0, dna_completion: 0 },
    canAccess: (featureKey: string) => canAccessFn(founder, featureKey),
  };

  if (products.rows.length === 0) {
    return {
      title,
      founderName,
      productName: null,
      productId: null,
      activeNav,
      riskState: null,
      riskReason: null,
      founderId: founder.id,
      founder,
      dnaCompletionPct: 0,
      wisdomLayerActive: false,
      openPRCount: 0,
      allProducts: [],
      ux: emptyUx,
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
  const prCountResult = await query(
    "SELECT COUNT(*) as cnt FROM remediation_prs WHERE product_id = ? AND status = 'pr_open'",
    [productId]
  );
  const openPRCount = (prCountResult.rows[0] as Record<string, number>)?.cnt ?? 0;

  // UX Intelligence Layer — parallel fetches
  const [nextAction, unreadNotifs, unreadCount, unseenMilestones, tourState] = await Promise.all([
    getNextAction(founder, productId),
    getUnreadNotifications(founder.id),
    getUnreadCount(founder.id),
    getUnseenMilestones(founder.id),
    getTourState(founder.id),
  ]);

  // Nav badges from lifecycle_state cached columns
  const navBadges: NavBadges = {
    decisions_count: (ls?.pending_decisions_count as number) ?? 0,
    has_overdue_audit: ((ls?.audit_age_days as number) ?? 0) > 30,
    unread_signals: ((ls?.unread_competitive_signals as number) ?? 0) > 0,
    unseen_milestones: ((ls?.unread_milestones as number) ?? 0) > 0,
    open_prs_count: (ls?.open_remediation_prs as number) ?? 0,
    dna_completion: dnaCompletionPct,
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
    founderId: founder.id,
    founder,
    dnaCompletionPct,
    wisdomLayerActive,
    openPRCount,
    allProducts,
    ux,
  };
}
