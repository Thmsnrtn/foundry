// =============================================================================
// FOUNDRY — Shared HTML Layout
// Server-rendered pages using Hono's html tagged template literal.
// =============================================================================

import { isFounder } from '../services/founder/intelligence.js';
import { isPrivateOwnerInstance } from '../lib/instance-posture.js';
import { html, raw } from 'hono/html';
import type { HtmlEscapedString } from 'hono/utils/html';
import type { NextAction, AppNotification, MilestoneEvent, NavBadges } from '../types/index.js';
import type { TrialStatus } from '../types/trial.js';

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
  founderEmail?: string | null;
  /** Trial state for the header badge / expiry banner (Phase 1.3). */
  trialStatus?: TrialStatus | null;
  /** True when the founder has never started a trial or paid — show the CTA. */
  showStartTrial?: boolean;
  /** Fluency Law: page explainer strip, sized by the founder's dial ('' at technical).
   *  Computed in getLayoutContext so every page gets it without per-route wiring. */
  navExplainer?: string | null;
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
      ${!chamberMode && founderName && opts.trialStatus?.state === 'trialing'
        ? html`<a href="/settings" class="header-link" style="color:#a5b4fc;font-weight:600;" title="Upgrade to keep your agents running after the trial">${opts.trialStatus.daysRemaining} day${opts.trialStatus.daysRemaining === 1 ? '' : 's'} left · Upgrade</a>`
        : ''}
      ${!chamberMode && riskState ? riskBadgeSmall(riskState, riskReason) : ''}
      ${!chamberMode && founderName ? notificationBell(unreadNotifications, unreadNotificationCount) : ''}
      ${founderName
        ? html`<span class="user-name">${founderName}</span>
               ${!chamberMode ? html`<a href="/settings" class="header-link">Settings</a>` : ''}`
        : html`<a href="/auth/login" class="header-link">Log in</a>
               <a href="/auth/signup" class="btn btn-primary btn-sm">Get Started</a>`}
    </div>
  </header>

  ${!chamberMode && founderName && opts.trialStatus?.state === 'expired'
    ? html`<div style="background:rgba(220,38,38,0.14);border-bottom:1px solid rgba(220,38,38,0.3);color:#fca5a5;padding:0.6rem 1rem;text-align:center;font-size:0.9rem;">
        Your free trial has ended. <a href="/settings" style="color:#fff;font-weight:700;text-decoration:underline;">Start your subscription</a> to keep your agents running.
      </div>`
    : !chamberMode && founderName && opts.showStartTrial
      ? html`<div style="background:rgba(99,102,241,0.14);border-bottom:1px solid rgba(99,102,241,0.3);color:#c7d2fe;padding:0.6rem 1rem;text-align:center;font-size:0.9rem;">
          Start your <strong>14-day free trial</strong> to keep your AI agents running.
          <a href="/settings" style="color:#fff;font-weight:700;text-decoration:underline;margin-left:0.4rem;">Choose a plan →</a>
        </div>`
      : ''}

  ${!chamberMode && showNav && nextAction ? nextActionBanner(nextAction) : ''}

  <!-- NOT ON THE OWNER'S INSTANCE. This is the twenty-five-item navigation of
       the product Foundry was built to replace — Signal, Decide, Playbooks,
       Ambient, Fleet Observatory, Agent Debate — and it was one tap from his
       first screen's footer, on the page he goes to in order to inspect his own
       system. The commercial deployment still has it. -->
  ${!chamberMode && showNav && productId && !isPrivateOwnerInstance()
    ? groupedSidebar(productId, activeNav, sidebarRiskClass, navBadges ?? null, canAccess ?? null, opts.founderEmail) : ''}

  <main id="main-content" class="${showNav && !chamberMode ? 'main-with-sidebar' : 'main-full'}">
    ${showNav && !chamberMode ? html`<div id="one-thing-banner"
      hx-get="/api/priority/one-thing"
      hx-trigger="load"
      hx-swap="innerHTML"
      style="min-height:0"></div>` : ''}
    ${!chamberMode && showNav && opts.navExplainer
      ? html`<p style="color:var(--text-muted);font-size:0.8rem;margin:0 0 1rem;max-width:720px;">${opts.navExplainer}</p>`
      : ''}
    ${content}
  </main>

  ${!chamberMode && showNav && productId && !isPrivateOwnerInstance()
    ? mobilBottomNav(activeNav, navBadges?.decisions_count ?? 0) : ''}

  <!-- Command Palette. Also the commercial product's navigation — it lists
       Signal, Decide, Playbooks, Fleet Observatory and the rest — so it is not
       offered on the owner's instance either. -->
  ${isPrivateOwnerInstance() ? '' : html`
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
      {label:'Today — The Letter',href:'/letter',section:'Navigate'},
      {label:'Signal Dashboard',href:'/dashboard',section:'Navigate'},
      {label:'CEO Briefing',href:'/agents/briefings/latest',section:'Navigate'},
      {label:'Decisions',href:'/decisions',section:'Navigate'},
      {label:'Talk to the Company',href:'/talk',section:'Navigate'},
      {label:'Fleet Observatory',href:'/fleet',section:'Navigate'},
      {label:'Action Queue',href:'/agents/actions',section:'Navigate'},
      {label:'Autopilot Controls',href:'/autopilot',section:'Autonomy'},
      {label:'Connections',href:'/connections',section:'Autonomy'},
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
      {label:'Sign out',href:'/auth/logout',section:'System'},
    ];
    // Product-scoped commands only exist when a product is selected.
    var CMD_PID = '${productId ?? ''}';
    if (CMD_PID) {
      CMD_ROUTES.push(
        {label:'Revenue',href:'/products/'+CMD_PID+'/revenue',section:'Product'},
        {label:'Competitive Intel',href:'/products/'+CMD_PID+'/competitive',section:'Product'},
        {label:'Product DNA',href:'/products/'+CMD_PID+'/dna',section:'Product'}
      );
    }
    let cmdIdx=0;
    function openCmdPalette(){document.getElementById('cmd-overlay').style.display='block';var p=document.getElementById('cmd-palette');p.style.display='block';document.getElementById('cmd-input').focus();renderCmdResults(CMD_ROUTES);}
    function closeCmdPalette(){document.getElementById('cmd-overlay').style.display='none';document.getElementById('cmd-palette').style.display='none';document.getElementById('cmd-input').value='';cmdIdx=0;}
    function filterCmdPalette(q){var r=q?CMD_ROUTES.filter(function(x){return x.label.toLowerCase().includes(q.toLowerCase())||x.section.toLowerCase().includes(q.toLowerCase());}):CMD_ROUTES;cmdIdx=0;renderCmdResults(r);}
    function renderCmdResults(routes){var el=document.getElementById('cmd-results');if(!routes.length){el.innerHTML='<div style="padding:16px 20px;color:#64748b;font-size:14px">No results</div>';return;}var html='',sec='';routes.slice(0,12).forEach(function(r,i){if(r.section!==sec){sec=r.section;html+='<div style="padding:4px 16px 2px;font-size:11px;color:#64748b;text-transform:uppercase;letter-spacing:.06em">'+sec+'</div>';}html+='<div class="cmd-item'+(i===cmdIdx?' cmd-selected':'')+'" data-href="'+r.href+'" onclick="location.href=\''+r.href+'\'" style="padding:8px 16px;cursor:pointer;font-size:14px;color:'+(i===cmdIdx?'#f1f5f9':'#cbd5e1')+';background:'+(i===cmdIdx?'rgba(255,255,255,0.07)':'transparent')+';transition:background 0.1s">'+r.label+'</div>';});el.innerHTML=html;}
    function handleCmdKey(e){var items=document.querySelectorAll('.cmd-item');if(e.key==='ArrowDown'){e.preventDefault();cmdIdx=Math.min(cmdIdx+1,items.length-1);}else if(e.key==='ArrowUp'){e.preventDefault();cmdIdx=Math.max(cmdIdx-1,0);}else if(e.key==='Enter'){if(items[cmdIdx])location.href=items[cmdIdx].dataset.href;closeCmdPalette();return;}else if(e.key==='Escape'){closeCmdPalette();return;}items.forEach(function(el,i){el.style.background=i===cmdIdx?'rgba(255,255,255,0.07)':'transparent';el.style.color=i===cmdIdx?'#f1f5f9':'#cbd5e1';});}
    document.addEventListener('keydown',function(e){if((e.metaKey||e.ctrlKey)&&e.key==='k'){e.preventDefault();openCmdPalette();}if(e.key==='Escape'&&document.getElementById('cmd-palette').style.display!=='none'){closeCmdPalette();}});
  </script>`}
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
  founderEmail?: string | null,
): HtmlContent {
  const b = badges ?? { decisions_count: 0 };

  // Five doors (Hands Law layer 5 / Attention Law): what a founder actually
  // DOES — read the letter, check the signal, decide, talk, act. Everything
  // else lives in collapsed groups that open where you are. Nothing removed
  // (Fluency Law: the product never forks) — nothing shouting.
  const primaryItems: NavItem[] = [
    { key: 'letter', label: 'Today', href: '/letter' },
    { key: 'dashboard', label: 'Signal', href: '/dashboard' },
    { key: 'decisions', label: 'Decide', href: '/decisions', badge: b.decisions_count > 0 ? String(b.decisions_count) : undefined, badgeType: 'count' },
    { key: 'talk', label: 'Talk', href: '/talk' },
    { key: 'agents-actions', label: 'Actions', href: '/agents/actions' },
  ];

  const navGroups: Array<{ label: string; items: NavItem[] }> = [
    {
      label: 'AUTOPILOT',
      items: [
        { key: 'autopilot', label: 'Controls', href: '/autopilot' },
        { key: 'connections', label: 'Connections', href: '/connections' },
        { key: 'playbooks-execution', label: 'Standing Orders', href: '/playbooks/execution' },
        { key: 'ambient', label: 'Ambient', href: '/ambient' },
      ],
    },
    {
      label: 'YOUR TEAM',
      items: [
        { key: 'agents-briefings', label: 'Briefing', href: '/agents/briefings/latest' },
        { key: 'agents', label: 'Roster', href: '/agents' },
        { key: 'agents-debate', label: 'Debate', href: '/agents/debate' },
        { key: 'agents-accuracy', label: 'Accuracy', href: '/agents/accuracy' },
        { key: 'agents-transparency', label: 'Transparency', href: '/agents/transparency' },
        { key: 'agents-intelligence', label: 'Intelligence', href: '/agents/intelligence' },
      ],
    },
    {
      label: 'COMPANY',
      items: [
        { key: 'memory', label: 'Memory', href: '/memory' },
        { key: 'scenarios', label: 'Scenarios', href: '/scenarios' },
        { key: 'signals-multimodal', label: 'Multi-Modal', href: '/signals/multimodal' },
        { key: 'network', label: 'Network', href: '/network' },
        { key: 'competitive', label: 'Competitive', href: `/products/${productId}/competitive` },
        { key: 'benchmarks', label: 'Benchmarks', href: '/benchmarks' },
      ],
    },
    {
      label: 'INVESTOR',
      items: [
        { key: 'board', label: 'Investor Hub', href: '/board' },
        { key: 'exit', label: 'Exit', href: '/exit' },
        { key: 'brief', label: 'Weekly Brief', href: '/brief' },
        { key: 'roi', label: 'ROI', href: '/roi' },
      ],
    },
    {
      label: 'SYSTEM',
      items: [
        { key: 'privacy', label: 'Privacy', href: '/privacy' },
      ],
    },
  ];

  return html`
  <nav class="sidebar ${riskClass}" aria-label="Main navigation">
    <button onclick="openCmdPalette()" style="display:flex;align-items:center;gap:6px;width:calc(100% - 24px);margin:10px 12px 14px;padding:7px 12px;background:rgba(255,255,255,0.06);border:1px solid rgba(255,255,255,0.1);border-radius:8px;color:#94a3b8;font-size:13px;cursor:pointer;text-align:left;">
      <span style="font-size:12px;opacity:0.7;">⌘K</span>
      <span>Go anywhere</span>
    </button>

    <ul class="sidebar-nav" style="margin-bottom:0.75rem;">${renderNavItems(primaryItems, active)}</ul>

    ${navGroups.map((group) => html`
    <details ${group.items.some((i) => i.key === active) ? 'open' : ''}>
      <summary style="list-style:none;cursor:pointer;">${sectionHeader(group.label)}</summary>
      <ul class="sidebar-nav">${renderNavItems(group.items, active)}</ul>
    </details>`)}

    <ul class="sidebar-nav" style="margin-top:0.5rem;border-top:1px solid rgba(255,255,255,0.08);padding-top:0.5rem;">
      ${founderEmail && isFounder(founderEmail) ? html`<li><a href="/founder-ops" class="${active === 'founder-ops' ? 'active' : ''}" style="color:#f59e0b;">Founder Ops</a></li>` : ''}
      <li><a href="/settings" class="${active === 'settings' ? 'active' : ''}">Settings</a></li>
      <li><a href="/auth/logout" style="color:var(--text-muted);">Sign out</a></li>
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
  const letterIcon = `<svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><rect x="2.5" y="4.5" width="15" height="11" rx="1.5"/><path d="M3 6l7 5 7-5"/></svg>`;
  const talkIcon = `<svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M17 9.5a6.5 5.5 0 0 1-6.5 5.5c-.9 0-1.8-.15-2.6-.45L4 16l1.2-3A5.4 5.4 0 0 1 3.5 9.5 6.5 5.5 0 0 1 10 4a6.5 5.5 0 0 1 7 5.5z"/></svg>`;
  const moreIcon = `<svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"><circle cx="5" cy="10" r="1.2" fill="currentColor"/><circle cx="10" cy="10" r="1.2" fill="currentColor"/><circle cx="15" cy="10" r="1.2" fill="currentColor"/></svg>`;

  return html`
  <nav class="mobile-bottom-nav" role="navigation" aria-label="Main navigation">
    ${tab('letter', '/letter', 'Today', letterIcon)}
    ${tab('dashboard', '/dashboard', 'Signal', signalIcon)}
    ${tab('decisions', '/decisions', 'Decide', decisionsIcon, decisionsCount)}
    ${tab('talk', '/talk', 'Talk', talkIcon)}
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
