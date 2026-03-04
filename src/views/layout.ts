// =============================================================================
// FOUNDRY — Shared HTML Layout
// Server-rendered pages using Hono's html tagged template literal.
// =============================================================================

import { html, raw } from 'hono/html';
import type { HtmlEscapedString } from 'hono/utils/html';
import type { NextAction, AppNotification, MilestoneEvent, NavBadges } from '../types/index.js';

/** Hono's html`` returns this union type when templates contain interpolated expressions */
export type HtmlContent = HtmlEscapedString | Promise<HtmlEscapedString>;

export interface LayoutOptions {
  title: string;
  founderName?: string | null;
  productName?: string | null;
  productId?: string | null;
  showNav?: boolean;
  /** When true: no sidebar, focused full-screen mode for Decision Chamber */
  chamberMode?: boolean;
  activeNav?: string;
  riskState?: 'green' | 'yellow' | 'red' | null;
  riskReason?: string | null;
  allProducts?: Array<{ id: string; name: string }>;
  /** UX Intelligence Layer fields */
  nextAction?: NextAction | null;
  unreadNotifications?: AppNotification[];
  unreadNotificationCount?: number;
  unseenMilestones?: MilestoneEvent[];
  navBadges?: NavBadges;
  canAccess?: (featureKey: string) => boolean;
  dnaCompletionPct?: number;
  openPRCount?: number;
}

export function layout(opts: LayoutOptions, content: HtmlContent): HtmlContent {
  const {
    title,
    founderName = null,
    productName = null,
    productId = null,
    showNav = false,
    chamberMode = false,
    activeNav = '',
    riskState = null,
    riskReason = null,
    allProducts = [],
    nextAction = null,
    unreadNotifications = [],
    unreadNotificationCount = 0,
    unseenMilestones = [],
    navBadges,
    canAccess,
    dnaCompletionPct = 0,
    openPRCount = 0,
  } = opts;

  const sidebarRiskClass = riskState === 'red' ? 'sidebar-risk-red' : riskState === 'yellow' ? 'sidebar-risk-yellow' : '';
  const bodyClass = chamberMode ? 'chamber-mode' : showNav ? 'has-sidebar' : '';

  return html`<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <meta name="theme-color" content="#0a0a12" />
  <title>${title} — Foundry</title>
  <link rel="stylesheet" href="/static/styles.css" />
  <link rel="manifest" href="/manifest.json" />
</head>
<body class="${bodyClass}">
  <header class="site-header">
    <div class="header-left">
      <a href="${founderName ? '/dashboard' : '/'}" class="logo">Foundry</a>
      ${chamberMode
        ? (productName ? html`<span class="breadcrumb">/ ${productName}</span>` : '')
        : allProducts.length > 1
          ? productSwitcher(allProducts, productId, productName)
          : productName ? html`<span class="breadcrumb">/ ${productName}</span>` : ''}
    </div>
    <div class="header-right">
      ${!chamberMode && riskState ? riskBadgeSmall(riskState, riskReason) : ''}
      ${!chamberMode && founderName ? notificationBell(unreadNotifications, unreadNotificationCount) : ''}
      ${founderName
        ? html`<span class="user-name">${founderName}</span>
               ${!chamberMode ? html`<a href="/settings" class="header-link">Settings</a>` : ''}`
        : html`<a href="/auth/login" class="header-link">Log in</a>
               <a href="/auth/signup" class="btn btn-primary btn-sm">Get Started</a>`}
    </div>
  </header>

  ${!chamberMode && showNav && nextAction ? nextActionBanner(nextAction) : ''}

  ${!chamberMode && showNav && productId ? groupedSidebar(productId, activeNav, sidebarRiskClass, navBadges ?? null, canAccess ?? null, dnaCompletionPct, openPRCount) : ''}

  <main class="${showNav && !chamberMode ? 'main-with-sidebar' : 'main-full'}">
    ${content}
  </main>

  ${!chamberMode && showNav && productId ? mobilBottomNav(activeNav, navBadges?.decisions_count ?? 0) : ''}

  <script>
    // Register service worker
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.register('/sw.js').catch(function() {});
    }
  </script>
</body>
</html>`;
}

function riskBadgeSmall(state: string, reason: string | null): HtmlContent {
  return html`<span class="risk-badge risk-${state}" title="${reason ?? ''}">${state.toUpperCase()}</span>`;
}

function productSwitcher(products: Array<{ id: string; name: string }>, currentId: string | null, _currentName: string | null): HtmlContent {
  return html`
  <div style="position:relative;display:inline-block;margin-left:0.5rem;">
    <form id="product-switcher-form" method="POST" action="/switch-product" style="display:inline;">
      <span class="breadcrumb" style="display:inline-flex;align-items:center;gap:0.25rem;">/
        <select name="product_id" onchange="this.form.submit()" style="border:none;background:transparent;font-size:inherit;font-weight:600;color:inherit;cursor:pointer;padding:0.15rem 0.25rem;border-radius:4px;outline:none;">
          ${products.map((p) => html`<option value="${p.id}" ${p.id === currentId ? 'selected' : ''}>${p.name}</option>`)}
        </select>
      </span>
    </form>
  </div>`;
}

// ─── Notification Bell ─────────────────────────────────────────────────────────────

function notificationBell(notifications: AppNotification[], count: number): HtmlContent {
  return html`
  <details class="notif-bell" style="position:relative;">
    <summary style="list-style:none;cursor:pointer;padding:4px 8px;position:relative;">
      🔔${count > 0 ? html`<span class="notif-count">${count}</span>` : ''}
    </summary>
    <div class="notif-dropdown">
      ${notifications.length === 0
        ? html`<div class="notif-item" style="text-align:center;color:#6b7280;">No new notifications</div>`
        : notifications.map((n) => html`
          <div class="notif-item ${n.read_at ? '' : 'notif-item-unread'}">
            <div class="notif-item-title">${n.title}</div>
            <div class="notif-item-body">${n.body}</div>
            ${n.action_url ? html`<a href="${n.action_url}" style="font-size:11px;">${n.action_label ?? 'View'}</a>` : ''}
          </div>`)}
      ${count > 0 ? html`
      <div style="padding:8px 14px;border-top:1px solid #e5e7eb;">
        <form method="POST" action="/api/notifications/read-all" style="display:inline;">
          <button type="submit" style="background:none;border:none;color:#2563eb;font-size:12px;cursor:pointer;">Mark all as read</button>
        </form>
      </div>` : ''}
    </div>
  </details>`;
}

// ─── Your Move Banner ─────────────────────────────────────────────────────────────

function nextActionBanner(action: NextAction): HtmlContent {
  return html`
  <div class="next-action-banner next-action-${action.urgency}">
    <span class="next-action-headline">${action.headline}</span>
    <span class="next-action-subtext">${action.subtext}</span>
    ${action.action_url ? html`<a href="${action.action_url}" class="next-action-btn btn btn-sm ${action.urgency === 'critical' ? 'btn-danger' : action.urgency === 'elevated' ? 'btn-primary' : 'btn-secondary'}">${action.action_label}</a>` : ''}
  </div>`;
}

// ─── Grouped Sidebar ──────────────────────────────────────────────────────────────

interface NavItem {
  key: string;
  label: string;
  href: string;
  badge?: string;
  badgeType?: 'count' | 'dot' | 'pct' | 'lock';
  locked?: boolean;
}

function groupedSidebar(
  productId: string,
  active: string,
  riskClass: string,
  badges: NavBadges | null,
  canAccess: ((key: string) => boolean) | null,
  dnaCompletionPct: number,
  openPRCount: number,
): HtmlContent {
  const check = canAccess ?? (() => true);
  const b = badges ?? { decisions_count: 0, has_overdue_audit: false, unread_signals: false, unseen_milestones: false, open_prs_count: 0, dna_completion: 0 };

  const operateItems: NavItem[] = [
    { key: 'dashboard', label: 'Signal', href: '/dashboard' },
    { key: 'plan', label: 'Weekly Plan', href: '/plan' },
    { key: 'lifecycle', label: 'Lifecycle', href: `/products/${productId}/lifecycle` },
  ];

  const intelItems: NavItem[] = [
    { key: 'decisions', label: 'Decisions', href: '/decisions', badge: b.decisions_count > 0 ? String(b.decisions_count) : undefined, badgeType: 'count' },
    { key: 'timeline', label: 'Signal Timeline', href: '/signal/timeline' },
    { key: 'digest', label: 'Digest', href: '/digest' },
  ];

  const productItems: NavItem[] = [
    { key: 'audit', label: 'Audit', href: `/products/${productId}/audit`, badge: b.has_overdue_audit ? '●' : undefined, badgeType: 'dot' },
    { key: 'revenue', label: 'Revenue', href: `/products/${productId}/revenue` },
    { key: 'cohorts', label: 'Cohorts', href: `/products/${productId}/cohorts`, locked: !check('cohorts'), badgeType: 'lock' },
    { key: 'competitive', label: 'Competitive', href: `/products/${productId}/competitive`, locked: !check('competitive'), badge: b.unread_signals ? '●' : undefined, badgeType: b.unread_signals ? 'dot' : 'lock' },
  ];

  const wisdomLocked = !check('wisdom');
  const wisdomItems: NavItem[] = [
    { key: 'dna', label: 'Product DNA', href: `/products/${productId}/dna`, badge: dnaCompletionPct < 60 ? `${dnaCompletionPct}%` : undefined, badgeType: 'pct', locked: wisdomLocked },
    { key: 'failures', label: 'Failure Log', href: `/products/${productId}/failures`, locked: wisdomLocked },
    { key: 'patterns', label: 'Patterns', href: `/products/${productId}/patterns`, locked: wisdomLocked },
  ];

  const fixLocked = !check('remediation');
  const fixItems: NavItem[] = [
    { key: 'remediation', label: 'Remediation', href: `/products/${productId}/remediation`, badge: openPRCount > 0 ? String(openPRCount) : undefined, badgeType: 'count', locked: fixLocked },
  ];

  const publishItems: NavItem[] = [
    { key: 'journey', label: 'Journey', href: `/products/${productId}/journey`, badge: b.unseen_milestones ? '●' : undefined, badgeType: 'dot' },
    { key: 'beta', label: 'Beta', href: '/beta' },
  ];

  return html`
  <nav class="sidebar ${riskClass}">
    ${sectionHeader('OPERATE')}
    <ul class="sidebar-nav">${renderNavItems(operateItems, active)}</ul>

    ${sectionHeader('INTELLIGENCE')}
    <ul class="sidebar-nav">${renderNavItems(intelItems, active)}</ul>

    ${sectionHeader('PRODUCT')}
    <ul class="sidebar-nav">${renderNavItems(productItems, active)}</ul>

    ${sectionHeader('WISDOM', wisdomLocked)}
    <ul class="sidebar-nav">${renderNavItems(wisdomItems, active)}</ul>

    ${sectionHeader('FIXES', fixLocked)}
    <ul class="sidebar-nav">${renderNavItems(fixItems, active)}</ul>

    ${sectionHeader('PUBLISH')}
    <ul class="sidebar-nav">${renderNavItems(publishItems, active)}</ul>

    <ul class="sidebar-nav" style="margin-top:0.5rem;border-top:1px solid rgba(255,255,255,0.08);padding-top:0.5rem;">
      <li><a href="/settings" class="${active === 'settings' ? 'active' : ''}">Settings</a></li>
    </ul>
  </nav>`;
}

// ─── Mobile Bottom Navigation ──────────────────────────────────────────────────

function mobilBottomNav(active: string, decisionsCount: number): HtmlContent {
  const tab = (key: string, href: string, label: string, icon: string, badge?: number) => html`
  <a href="${href}" class="mbn-tab ${active === key ? 'mbn-active' : ''}" aria-label="${label}">
    ${raw(icon)}
    <span class="mbn-label">${label}</span>
    ${badge && badge > 0 ? html`<span class="mbn-badge">${badge}</span>` : ''}
  </a>`;

  const signalIcon = `<svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"><circle cx="10" cy="10" r="2.5"/><path d="M5.5 14.5a6.5 6.5 0 0 1 0-9M14.5 5.5a6.5 6.5 0 0 1 0 9"/><path d="M3 17a9.5 9.5 0 0 1 0-14M17 3a9.5 9.5 0 0 1 0 14" stroke-dasharray="2 2"/></svg>`;
  const decisionsIcon = `<svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="14" height="14" rx="2"/><path d="M7 10l2 2 4-4"/></svg>`;
  const planIcon = `<svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"><path d="M5 7h10M5 10h6M5 13h8"/></svg>`;
  const moreIcon = `<svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"><circle cx="5" cy="10" r="1.2" fill="currentColor"/><circle cx="10" cy="10" r="1.2" fill="currentColor"/><circle cx="15" cy="10" r="1.2" fill="currentColor"/></svg>`;

  return html`
  <nav class="mobile-bottom-nav" role="navigation" aria-label="Main navigation">
    ${tab('dashboard', '/dashboard', 'Signal', signalIcon)}
    ${tab('decisions', '/decisions', 'Decisions', decisionsIcon, decisionsCount)}
    ${tab('plan', '/plan', 'Plan', planIcon)}
    ${tab('settings', '/settings', 'More', moreIcon)}
  </nav>`;
}

function sectionHeader(label: string, locked: boolean = false): HtmlContent {
  return html`<div class="nav-section-header">${label}${locked ? html` <span class="nav-lock">🔒</span>` : ''}</div>`;
}

function renderNavItems(items: NavItem[], active: string): HtmlContent {
  return html`${items.map((item) => {
    const isActive = active === item.key;
    const lockedClass = item.locked ? ' nav-item-locked' : '';
    const badgeHtml = item.locked && !item.badge
      ? html`<span class="nav-lock">🔒</span>`
      : item.badge && item.badgeType === 'count'
        ? html`<span class="nav-badge-count">${item.badge}</span>`
        : item.badge && item.badgeType === 'dot'
          ? html`<span class="nav-badge-dot"></span>`
          : item.badge && item.badgeType === 'pct'
            ? html`<span class="nav-badge-pct">${item.badge}</span>`
            : '';
    return html`<li><a href="${item.href}" class="${isActive ? 'active' : ''}${lockedClass}" style="display:flex;align-items:center;">${item.label}${badgeHtml}</a></li>`;
  })}`;
}

/**
 * Minimal layout for public pages (landing, pricing, case studies).
 */
export function publicLayout(title: string, content: HtmlContent): HtmlContent {
  return layout({ title, showNav: false }, content);
}

/**
 * Dashboard layout with sidebar navigation.
 */
export function dashboardLayout(
  opts: Omit<LayoutOptions, 'showNav'>,
  content: HtmlContent
): HtmlContent {
  return layout({ ...opts, showNav: true }, content);
}

/**
 * Chamber layout: no sidebar, focused mode for Decision detail.
 */
export function chamberLayout(
  opts: Omit<LayoutOptions, 'showNav' | 'chamberMode'>,
  content: HtmlContent
): HtmlContent {
  return layout({ ...opts, showNav: false, chamberMode: true }, content);
}
