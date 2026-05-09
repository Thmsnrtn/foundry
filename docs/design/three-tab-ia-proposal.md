# Three-Tab Dashboard IA — Proposal

> Wave 4, action 27. Council 2 (product designers) + Council 25
> (multi-product operators). The 300-persona review's Surface 4 —
> deferred from the prior cycle pending dogfood evidence; this is the
> proposal to land when that evidence is in.

> Status: proposal. Don't implement before two weeks of dogfooding
> data on which routes actually get opened.

---

## 1. The problem

`src/routes/dashboard/` has 67 route files. Each was added for a
reason. Together they read like a console, not a product. A new
founder can't navigate without learning Foundry's internals.

The persona-review fix: collapse 67 routes into a three-tab IA that
fits the founder's actual day:

- **Today** — what to read, what to decide, what's working now.
- **Stats** — trend dashboards (signal, cohorts, revenue, customer
  health).
- **History** — audit log, past briefings, decision retrospectives,
  signal replay.

Everything else lives behind a search/jump-to bar.

## 2. The three tabs in detail

### Tab 1: Today

Single-screen daily view. Already-shipped surfaces consolidate
here:

- Signal score + trend sparkline (top, prominent)
- The number that matters (North Star delta or Signal delta)
- Today's CEO briefing (the post-V3.1 visual contract)
- Decisions to handle today (top 1-2 expanded; rest folded)
- Weekly outcome card (decisions handled, fast-actions, agent
  actions executed)
- Catch-up summary (when away >2 days)

Excludes: anything not directly actionable today. The peer-signal
card and Financial Snapshot live in Stats, not Today.

**Routes that consolidate here**: `/dashboard` (current home),
`/decisions/*` (top decisions only), parts of `/agents/briefings`.

### Tab 2: Stats

Trend / aggregate / comparison surfaces:

- Signal history (60-day chart, currently in /dashboard footer)
- Financial Snapshot (Wave 3, action 25)
- Cohort retention table
- Revenue waterfall (MRR decomposition)
- Customer health distribution
- Peer signal card (Wave 3, action 22)
- Competitive scan output
- Cost dashboard (AI spend by agent / by product)

**Routes that consolidate here**: `/revenue`, `/cohort`,
`/competitive`, `/insights`, `/portfolio` (when product count >= 2),
`/network` (peer benchmarks).

### Tab 3: History

Past, audit, retrospective:

- Audit log (filtered by date, agent, action_type, founder action)
- Past briefings (last 30 days)
- Decision retrospectives (90-day outcome review)
- Signal replay (point-in-time recreation of a past dashboard)
- Founding story artifacts
- Wisdom layer evolution timeline

**Routes that consolidate here**: `/audit-log`, `/timeline`,
`/agents/temporal`, `/agents/wisdom`, `/agents/wiki`,
`/case-studies`.

## 3. Routes that don't fold

A handful of routes don't fit the three-tab model and stay
accessible from the user menu / settings:

- `/settings/*` — preferences, billing, integrations management
- `/onboarding/*` — only seen during first product setup
- `/legal`, `/privacy`, `/terms` — legal pages
- `/api-docs` — developer reference
- `/founder-ops` — operator-only; not a founder surface

Total: 8-10 routes outside the three tabs. Down from 67.

## 4. The search / jump-to bar

`Cmd+K` (or `/` on the search input) opens a global jump bar with:

- All routes still mounted (just not navigated by default)
- Decision IDs (jump directly to a specific decision)
- Briefing dates (jump to a past briefing)
- Founder ops actions (operator-only; gated by email)

The jump bar is the escape valve: an operator who knows what they
want goes directly there. A new founder doesn't need to know it
exists.

## 5. Implementation cost (estimate)

Implementing this is **one operator-week of focused work**, broken
roughly:

- Day 1: Consolidate tab 1 (Today) — moves existing `/dashboard`
  contents into a tab shell; adds the briefing card prominently.
- Day 2: Consolidate tab 2 (Stats) — wraps `/revenue`,
  `/cohort`, `/insights`, `/portfolio` in a unified Stats route.
- Day 3: Consolidate tab 3 (History) — `/audit-log`,
  `/timeline`, retrospectives.
- Day 4: Build the search/jump-to bar.
- Day 5: Soft-deprecate the routes that fold (still serve, but
  remove from primary nav). Update tour copy to use the new IA.

**Pre-requisite**: at least two weeks of dogfooding data on which
routes Thomas actually opens in a typical week. Without that data,
the consolidation guesses at the operator's day. With it, the
priorities are clear.

## 6. The decisions Thomas needs to make

Two questions only the operator can answer:

1. **Which routes survive the cut?** The list above (§§2-3) is
   reasonable; dogfood evidence may say "I open `/agents/strategy`
   weekly — keep it visible" or "I never look at `/network` —
   delete." The list is wrong on details until Thomas validates.

2. **What's the visual treatment of the tabs themselves?** Top-of-
   page tabs (current /dashboard top-bar pattern), sidebar tabs
   (familiar from Linear), or a mode-switcher (less common, can
   be elegant). Each has a different feel.

Two weeks of dogfooding turns these into tractable decisions.
Until then, this proposal is the prior, not the plan.

— end —
