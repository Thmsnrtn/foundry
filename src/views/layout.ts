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
  founderEmail?: string | null;
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
  <script src="/static/htmx.min.js" defer></script>
</head>
<body class="${bodyClass}">
  <a href="#main-content" class="skip-link">Skip to main content</a>
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

  ${!chamberMode && showNav && productId ? groupedSidebar(productId, activeNav, sidebarRiskClass, navBadges ?? null, canAccess ?? null, dnaCompletionPct, openPRCount, opts.founderEmail) : ''}

  <main id="main-content" class="${showNav && !chamberMode ? 'main-with-sidebar' : 'main-full'}">
    ${showNav && !chamberMode ? html`<div id="one-thing-banner"
      hx-get="/api/priority/one-thing"
      hx-trigger="load"
      hx-swap="innerHTML"
      style="min-height:0"></div>` : ''}
    ${content}
  </main>

  ${!chamberMode && showNav && productId ? mobilBottomNav(activeNav, navBadges?.decisions_count ?? 0) : ''}

  <!-- Command Palette -->
  <div id="cmd-overlay" style="display:none;position:fixed;inset:0;background:rgba(0,0,0,0.7);z-index:9998;backdrop-filter:blur(4px)" onclick="closeCmdPalette()" aria-hidden="true"></div>
  <div id="cmd-palette" role="dialog" aria-label="Command palette" aria-modal="true" style="display:none;position:fixed;top:15vh;left:50%;transform:translateX(-50%);width:min(640px,90vw);background:#1e293b;border:1px solid rgba(255,255,255,0.12);border-radius:12px;z-index:9999;box-shadow:0 24px 64px rgba(0,0,0,0.5)">
    <div style="padding:12px 16px;border-bottom:1px solid rgba(255,255,255,0.08)">
      <input id="cmd-input" type="text" role="combobox" aria-label="Search pages and actions" aria-expanded="true" aria-controls="cmd-results" aria-autocomplete="list" placeholder="Go anywhere... (type a page or action)"
        style="width:100%;background:transparent;border:none;outline:none;color:#f1f5f9;font-size:16px;font-family:inherit"
        oninput="filterCmdPalette(this.value)" onkeydown="handleCmdKey(event)" autocomplete="off" />
    </div>
    <div id="cmd-results" style="max-height:400px;overflow-y:auto;padding:8px 0"></div>
    <div style="padding:8px 16px;border-top:1px solid rgba(255,255,255,0.08);display:flex;gap:16px;font-size:11px;color:#64748b">
      <span>&#x2191;&#x2193; navigate</span><span>&#x21b5; go</span><span>esc close</span>
    </div>
  </div>
  <script>
    const CMD_ROUTES=[
      {label:'Signal Dashboard',href:'/dashboard',section:'Navigate'},
      {label:'CEO Briefing',href:'/agents/briefings/latest',section:'Navigate'},
      {label:'Decisions',href:'/decisions',section:'Navigate'},
      {label:'Action Queue',href:'/agents/actions',section:'Navigate'},
      {label:'Agent Debate',href:'/agents/debate',section:'Agents'},
      {label:'Agent Accuracy',href:'/agents/accuracy',section:'Agents'},
      {label:'Agent Transparency',href:'/agents/transparency',section:'Agents'},
      {label:'Agent Intelligence',href:'/agents/intelligence',section:'Agents'},
      {label:'Agent Roster',href:'/agents',section:'Agents'},
      {label:'Scenario Planner',href:'/scenarios',section:'Forecasting'},
      {label:'Investor Board',href:'/board',section:'Forecasting'},
      {label:'Exit Intelligence',href:'/exit',section:'Forecasting'},
      {label:'Weekly Brief',href:'/brief',section:'Forecasting'},
      {label:'Multi-Modal Signals',href:'/signals/multimodal',section:'Signals'},
      {label:'Network Intelligence',href:'/network',section:'Signals'},
      {label:'Company Memory',href:'/memory',section:'Signals'},
      {label:'Standing Orders',href:'/playbooks/execution',section:'Autonomy'},
      {label:'Ambient Layer',href:'/ambient',section:'Autonomy'},
      {label:'ROI Dashboard',href:'/roi',section:'Autonomy'},
      {label:'Benchmarks',href:'/benchmarks',section:'System'},
      {label:'Privacy & Data',href:'/privacy',section:'System'},
      {label:'Settings',href:'/settings',section:'System'},
      {label:'Audit Log',href:'/audit-log',section:'System'},
      {label:'Playbooks',href:'/playbooks',section:'System'},
      {label:'Revenue',href:'/products/current/revenue',section:'Product'},
      {label:'Competitive Intel',href:'/products/current/competitive',section:'Product'},
      {label:'Product DNA',href:'/products/current/dna',section:'Product'},
    ];
    let cmdIdx=0;
    function openCmdPalette(){document.getElementById('cmd-overlay').style.display='block';var p=document.getElementById('cmd-palette');p.style.display='block';document.getElementById('cmd-input').focus();renderCmdResults(CMD_ROUTES);}
    function closeCmdPalette(){document.getElementById('cmd-overlay').style.display='none';document.getElementById('cmd-palette').style.display='none';document.getElementById('cmd-input').value='';cmdIdx=0;}
    function filterCmdPalette(q){var r=q?CMD_ROUTES.filter(function(x){return x.label.toLowerCase().includes(q.toLowerCase())||x.section.toLowerCase().includes(q.toLowerCase());}):CMD_ROUTES;cmdIdx=0;renderCmdResults(r);}
    function renderCmdResults(routes){var el=document.getElementById('cmd-results');if(!routes.length){el.innerHTML='<div style="padding:16px 20px;color:#64748b;font-size:14px">No results</div>';return;}var html='',sec='';routes.slice(0,12).forEach(function(r,i){if(r.section!==sec){sec=r.section;html+='<div style="padding:4px 16px 2px;font-size:11px;color:#64748b;text-transform:uppercase;letter-spacing:.06em">'+sec+'</div>';}html+='<div class="cmd-item'+(i===cmdIdx?' cmd-selected':'')+'" data-href="'+r.href+'" onclick="location.href=\''+r.href+'\'" style="padding:8px 16px;cursor:pointer;font-size:14px;color:'+(i===cmdIdx?'#f1f5f9':'#cbd5e1')+';background:'+(i===cmdIdx?'rgba(255,255,255,0.07)':'transparent')+';transition:background 0.1s">'+r.label+'</div>';});el.innerHTML=html;}
    function handleCmdKey(e){var items=document.querySelectorAll('.cmd-item');if(e.key==='ArrowDown'){e.preventDefault();cmdIdx=Math.min(cmdIdx+1,items.length-1);}else if(e.key==='ArrowUp'){e.preventDefault();cmdIdx=Math.max(cmdIdx-1,0);}else if(e.key==='Enter'){if(items[cmdIdx])location.href=items[cmdIdx].dataset.href;closeCmdPalette();return;}else if(e.key==='Escape'){closeCmdPalette();return;}items.forEach(function(el,i){el.style.background=i===cmdIdx?'rgba(255,255,255,0.07)':'transparent';el.style.color=i===cmdIdx?'#f1f5f9':'#cbd5e1';});}
    document.addEventListener('keydown',function(e){if((e.metaKey||e.ctrlKey)&&e.key==='k'){e.preventDefault();openCmdPalette();}if(e.key==='Escape'&&document.getElementById('cmd-palette').style.display!=='none'){closeCmdPalette();}});
  </script>
  <script>
    // Register service worker
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.register('/sw.js').catch(function() {});
    }
    // DEFECT-0054: Minimal page view analytics (first-party, no third-party)
    try { navigator.sendBeacon('/api/analytics/pageview', JSON.stringify({path:location.pathname,ts:Date.now()})); } catch(e) {}
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
    <form id="product-switcher-form" method="POST" action="/switch-product" style="display:inline-flex;align-items:center;gap:0.35rem;">
      <span class="breadcrumb" style="display:inline-flex;align-items:center;gap:0.25rem;">/
        <select name="product_id" aria-label="Switch company" style="border:none;background:transparent;font-size:inherit;font-weight:600;color:inherit;cursor:pointer;padding:0.15rem 0.25rem;border-radius:4px;outline:none;">
          ${products.map((p) => html`<option value="${p.id}" ${p.id === currentId ? 'selected' : ''}>${p.name}</option>`)}
        </select>
      </span>
      <button type="submit" class="btn btn-sm btn-ghost" style="padding:0.15rem 0.5rem;font-size:0.75rem;">Go</button>
    </form>
  </div>`;
}

// ─── Notification Bell ─────────────────────────────────────────────────────────────

function notificationBell(notifications: AppNotification[], count: number): HtmlContent {
  return html`
  <details class="notif-bell" style="position:relative;">
    <summary aria-label="Notifications" style="list-style:none;cursor:pointer;padding:4px 8px;position:relative;">
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
  founderEmail?: string | null,
): HtmlContent {
  const b = badges ?? { decisions_count: 0, has_overdue_audit: false, unread_signals: false, unseen_milestones: false, open_prs_count: 0, dna_completion: 0 };

  // Primary items — larger visual weight, no section header
  const primaryItems: NavItem[] = [
    { key: 'dashboard', label: 'Signal', href: '/dashboard' },
    { key: 'agents-briefings', label: 'Briefing', href: '/agents/briefings/latest', badge: 'NEW', badgeType: 'dot' },
    { key: 'decisions', label: 'Decide', href: '/decisions', badge: b.decisions_count > 0 ? String(b.decisions_count) : undefined, badgeType: 'count' },
    { key: 'agents-actions', label: 'Actions', href: '/agents/actions' },
  ];

  const agentsItems: NavItem[] = [
    { key: 'agents', label: 'Roster', href: '/agents' },
    { key: 'agents-debate', label: 'Debate', href: '/agents/debate' },
    { key: 'agents-accuracy', label: 'Accuracy', href: '/agents/accuracy' },
    { key: 'agents-transparency', label: 'Transparency', href: '/agents/transparency' },
    { key: 'agents-intelligence', label: 'Intelligence', href: '/agents/intelligence' },
  ];

  const forwardItems: NavItem[] = [
    { key: 'scenarios', label: 'Scenarios', href: '/scenarios' },
    { key: 'board', label: 'Investor Board', href: '/board' },
    { key: 'exit', label: 'Exit', href: '/exit' },
    { key: 'brief', label: 'Weekly Brief', href: '/brief' },
  ];

  const signalsItems: NavItem[] = [
    { key: 'signals-multimodal', label: 'Multi-Modal', href: '/signals/multimodal' },
    { key: 'network', label: 'Network', href: '/network' },
    { key: 'memory', label: 'Memory', href: '/memory' },
    { key: 'competitive', label: 'Competitive', href: `/products/${productId}/competitive` },
  ];

  const autonomyItems: NavItem[] = [
    { key: 'playbooks-execution', label: 'Standing Orders', href: '/playbooks/execution' },
    { key: 'ambient', label: 'Ambient', href: '/ambient' },
    { key: 'roi', label: 'ROI', href: '/roi' },
  ];

  const systemItems: NavItem[] = [
    { key: 'benchmarks', label: 'Benchmarks', href: '/benchmarks' },
    { key: 'privacy', label: 'Privacy', href: '/privacy' },
  ];

  return html`
  <nav class="sidebar ${riskClass}" aria-label="Main navigation">
    <button onclick="openCmdPalette()" style="display:flex;align-items:center;gap:6px;width:calc(100% - 24px);margin:10px 12px 14px;padding:7px 12px;background:rgba(255,255,255,0.06);border:1px solid rgba(255,255,255,0.1);border-radius:8px;color:#94a3b8;font-size:13px;cursor:pointer;text-align:left;">
      <span style="font-size:12px;opacity:0.7;">⌘K</span>
      <span>Go anywhere</span>
    </button>

    <ul class="sidebar-nav" style="margin-bottom:0.75rem;">${renderNavItems(primaryItems, active)}</ul>

    <details open>
      <summary style="list-style:none;cursor:pointer;">${sectionHeader('AGENTS')}</summary>
      <ul class="sidebar-nav">${renderNavItems(agentsItems, active)}</ul>
    </details>

    ${sectionHeader('FORWARD')}
    <ul class="sidebar-nav">${renderNavItems(forwardItems, active)}</ul>

    ${sectionHeader('SIGNALS')}
    <ul class="sidebar-nav">${renderNavItems(signalsItems, active)}</ul>

    ${sectionHeader('AUTONOMY')}
    <ul class="sidebar-nav">${renderNavItems(autonomyItems, active)}</ul>

    ${sectionHeader('SYSTEM')}
    <ul class="sidebar-nav">${renderNavItems(systemItems, active)}</ul>

    <ul class="sidebar-nav" style="margin-top:0.5rem;border-top:1px solid rgba(255,255,255,0.08);padding-top:0.5rem;">
      ${founderEmail?.toLowerCase() === 'thmsnrtn@gmail.com' ? html`<li><a href="/founder-ops" class="${active === 'founder-ops' ? 'active' : ''}" style="color:#f59e0b;">Founder Ops</a></li>` : ''}
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
  const agentsIcon = `<svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><circle cx="10" cy="7" r="3"/><path d="M4 17c0-3.3 2.7-6 6-6s6 2.7 6 6"/><circle cx="16" cy="5" r="1.5" fill="currentColor" stroke="none"/></svg>`;
  const planIcon = `<svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"><path d="M5 7h10M5 10h6M5 13h8"/></svg>`;
  const moreIcon = `<svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"><circle cx="5" cy="10" r="1.2" fill="currentColor"/><circle cx="10" cy="10" r="1.2" fill="currentColor"/><circle cx="15" cy="10" r="1.2" fill="currentColor"/></svg>`;

  return html`
  <nav class="mobile-bottom-nav" role="navigation" aria-label="Main navigation">
    ${tab('dashboard', '/dashboard', 'Signal', signalIcon)}
    ${tab('decisions', '/decisions', 'Decisions', decisionsIcon, decisionsCount)}
    ${tab('agents', '/agents', 'Agents', agentsIcon)}
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
