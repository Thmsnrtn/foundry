# Lens 21 — Information Architect

**Auditor perspective:** Evaluate navigation structure, content hierarchy, labeling, and findability. Is the sidebar well-organized? Can users find what they need? Are pages organized with clear hierarchy?

**Date:** 2026-04-16
**Repo:** /Users/user/foundry/

---

## Executive Summary

Foundry's navigation is ambitious — 59 dashboard routes organized into a grouped sidebar with 6 sections plus a command palette (Cmd+K). The primary navigation items (Signal, Briefing, Decide, Actions) are well-chosen for daily workflow. However, the architecture suffers from over-expansion: 21 agent sub-routes that fragment a single concept, ambiguous section labels ("Forward", "Signals", "Autonomy"), a sidebar that only shows 5 of 21 agent pages, and no breadcrumbs to orient users within the hierarchy. The command palette partially compensates by providing flat access to 27 routes, but its route list is hardcoded and incomplete (missing ~32 routes). The result is a product where the top-level flow is clear but anything beyond the first 4 items requires memorization or Cmd+K.

---

## Findings

### F21.1 — 21 agent sub-routes with only 5 in sidebar

**Severity:** P1
**Evidence:** Agent-related route files: `agents.ts`, `agents-accuracy.ts`, `agents-actions.ts`, `agents-briefings.ts`, `agents-constitution.ts`, `agents-customers.ts`, `agents-debate.ts`, `agents-decisions.ts`, `agents-evolve.ts`, `agents-experiments.ts`, `agents-inbox.ts`, `agents-integrations.ts`, `agents-messages.ts`, `agents-okr.ts`, `agents-remediations.ts`, `agents-strategy.ts`, `agents-temporal.ts`, `agents-transparency.ts`, `agents-wiki.ts`, `agents-wisdom.ts`, `agent-intelligence.ts`. That is 21 files. The sidebar AGENTS section shows only: Roster, Debate, Accuracy, Transparency, Intelligence. The remaining 16 routes (Constitution, Customers, Decisions, Evolve, Experiments, Inbox, Integrations, Messages, OKR, Remediations, Strategy, Temporal, Wiki, Wisdom, Actions, Briefings) are unreachable from the sidebar.
**Remediation:** The agent routes need restructuring:
1. The Agent Roster page should serve as a hub with tabs/sections for the major agent capabilities
2. Group agent sub-routes into 3-4 categories: Operations (Actions, Decisions, Inbox, Messages), Intelligence (Accuracy, Transparency, Wisdom, Intelligence), Evolution (Evolve, Constitution, OKR, Strategy), and Integrations
3. Add a secondary nav within the agents section for the sub-routes

### F21.2 — Section labels are ambiguous

**Severity:** P1
**Evidence:** Sidebar section names: "AGENTS", "FORWARD", "SIGNALS", "AUTONOMY", "SYSTEM". "Forward" contains Scenarios, Investor Board, Exit, Weekly Brief — these are forward-looking analysis tools, but the label "Forward" doesn't communicate this. A founder looking for scenarios would not intuit "Forward" as the parent section. "Signals" contains Multi-Modal, Network, Memory, Competitive — but the Signal dashboard (the product's central concept) is in the primary nav, not in this section. "Autonomy" contains Standing Orders, Ambient, ROI — three unrelated concepts grouped under an abstract label.
**Remediation:** Rename sections:
- "FORWARD" -> "FORECAST" or "PLANNING" (communicates future-oriented analysis)
- "SIGNALS" -> "INTELLIGENCE" (covers competitive, network, memory)
- "AUTONOMY" -> "AUTOMATION" (communicates agent automation controls)
- Consider merging "SYSTEM" items (Benchmarks, Privacy) into Settings

### F21.3 — No breadcrumbs in dashboard pages

**Severity:** P1
**Evidence:** The header shows `Foundry / [Product Name]` as a breadcrumb (`layout.ts` line 78) but this only identifies the product, not the current page. When a founder navigates to `/agents/briefings/2026-04-15`, there is no visible path like `Agents > Briefings > April 15, 2026`. When they're on `/products/{id}/competitive`, there's no breadcrumb showing `Product > Competitive`. The only orientation mechanism is the sidebar active state, which only works for items that are in the sidebar (and 16+ agent routes are not).
**Remediation:** Add a breadcrumb component to `layout.ts` that shows the full navigation path. Include it below the header or above the page content. For agent sub-routes: `Agents > Transparency > [Agent Name]`. For product routes: `[Product Name] > Revenue`.

### F21.4 — Command palette route list is hardcoded and incomplete

**Severity:** P1
**Evidence:** `layout.ts` line 123-151 defines `CMD_ROUTES` as a hardcoded array of 27 entries. The codebase has 59 dashboard routes. Missing from Cmd+K: all 16 hidden agent sub-routes (Constitution, Evolve, Experiments, Inbox, OKR, Remediations, Strategy, Temporal, Wiki, Wisdom, Customers, Messages, Actions-specific, Decisions-analytics), plus Onboarding, Team, Plan, Lifecycle, Cohorts, Portfolio, Journey, Digest, Integration Health, Playbooks detail, Founder Ops.
**Remediation:** Generate the route list dynamically from the route registration, or maintain a single source of truth for all routes with their labels and sections. Every navigable page should appear in Cmd+K.

### F21.5 — Primary navigation items are well-chosen

**Severity:** P0 (strength)
**Evidence:** The four primary sidebar items — Signal, Briefing, Decide, Actions — map precisely to the founder's daily workflow: (1) check the pulse, (2) read the AI briefing, (3) make pending decisions, (4) review/approve actions. These are ungrouped and given visual priority. The Decisions item shows a badge count for pending items. This top-level hierarchy is clear and action-oriented.
**Remediation:** None needed. This is the right top-level information architecture.

### F21.6 — Page content hierarchy is inconsistent

**Severity:** P2
**Evidence:** The Signal Dashboard (`index.ts`) has a clear hierarchy: giant number > prose > daily insight > query bar > action cards > stressors. This is opinionated and effective. But other pages are less structured: Revenue (`revenue.ts`) shows `<h2>Revenue</h2>` then immediately the MRR card, then Revenue Summary, then Key Metrics — no visual section breaks, no page intro text. Decisions (`decisions.ts`) has a header with title + link, then the decision list. Agent Roster (`agents.ts`) has title + subtitle, then a grid of cards with 110 inline styles each — no summary, no aggregate stats above the list.
**Remediation:** Establish a page template hierarchy: (1) Page header with title + description + primary action, (2) Summary/aggregate stats if applicable, (3) Primary content, (4) Secondary content. Apply this pattern to Revenue, Decisions, Agent Roster, Benchmarks.

### F21.7 — Mobile bottom nav only shows 4 of 59 routes

**Severity:** P2
**Evidence:** The mobile bottom nav (`mobilBottomNav` in `layout.ts` line 324-346) shows: Signal, Decisions, Agents, Plan, More. But "More" links to `/settings`, not to a discovery page for the remaining 55 routes. There is no mobile equivalent of the sidebar sections. A mobile user who wants to check their Competitive Intelligence, Benchmarks, or Weekly Brief has no path except typing the URL or using Cmd+K (which is a desktop shortcut).
**Remediation:** The "More" tab should open a full-screen menu showing all sidebar sections. Alternatively, implement a mobile-friendly command palette triggered by tapping a search icon.

### F21.8 — Settings is both a sidebar item and a header link

**Severity:** P3
**Evidence:** `layout.ts` line 88: the header shows `<a href="/settings" class="header-link">Settings</a>`. `layout.ts` line 316: the sidebar bottom section shows `<li><a href="/settings">Settings</a></li>`. Settings appears in two navigation locations, consuming space in both. Meanwhile, Team, Privacy, Audit Log, and Integration Health are orphaned — reachable only via direct URL or Cmd+K in some cases.
**Remediation:** Remove Settings from the header (the sidebar link is sufficient, and the header right side should be reserved for global actions: notifications, product switcher, user menu). Group Settings, Team, Privacy, Audit Log, and Integration Health under a "SETTINGS" sidebar section or make them tabs within the Settings page.

---

## Embarrassment Test

A founder hears about the "Agent Constitution" feature in a briefing and wants to review it. They open the sidebar: AGENTS section shows Roster, Debate, Accuracy, Transparency, Intelligence. No Constitution. They click Roster and look for a link to Constitution — there is none (the roster page shows agent cards with status, health, and sessions, but no link to Constitution). They try Cmd+K and type "Constitution" — it does not appear in the 27 hardcoded routes. They are stuck unless they guess the URL `/agents/constitution`. Sixteen agent features are in this same state: built, deployed, and unreachable.

## Pride Test

The four primary navigation items — Signal, Briefing, Decide, Actions — are an outstanding top-level IA. They form a complete daily workflow loop: observe (Signal) -> understand (Briefing) -> decide (Decide) -> act (Actions). The decision badge count creates urgency without being pushy. The command palette with keyboard-first navigation (Cmd+K, arrow keys, Enter) respects the power-user founder persona. The product switcher as a `<select>` in the breadcrumb is minimal and effective. The top 10% of the navigation experience is excellent; it's the remaining 90% of routes that need the same level of care.
