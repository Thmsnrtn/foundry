# Red Team 05 — Power User with 25+ Companies

**Persona:** Serial founder or micro-PE operator running 25 SaaS products through Foundry on the Investor-Ready tier ($399/month). Expects fleet-level visibility, fast dashboards, and no operational bottlenecks at scale.

## Attack Surface / Review Scope

- SCP scheduler: how does hourly execution scale to 25 products x 12 agents?
- Dashboard and portfolio view performance with 25 products
- Product switcher UX at 25 entries
- Database query patterns under multi-product load
- Job execution time and AI cost at scale
- Tier enforcement and product limits

## Findings

### RT-05-01 Scheduler Executes All Products Serially -- 25 Products x 12 Agents = Hours of Sequential AI Calls

- **Severity:** P0
- **Description:** `runDueAgentsForAllProducts()` iterates all active products with a `for...of` loop, and within each product, `SCPInstance.runAllDueAgents()` iterates all due agents with another `for...of` loop. Each agent run involves at least one Claude Sonnet API call (no timeout configured). At 25 products with an average of 6 due agents each, that is 150 sequential AI calls. At a conservative 10 seconds per call, the scheduler takes **25 minutes** to complete. At 30 seconds per call (realistic for complex analysis), it takes **75 minutes** -- exceeding the hourly cadence. This means:
  - Some products' agents will never catch up
  - Products later in the iteration order are systematically disadvantaged
  - A single slow or failed AI call blocks all subsequent products
  - No parallelism, no concurrency limit, no priority queue
- **Evidence:** `src/services/scp/scheduler.ts:30-58` -- outer `for (const row of result.rows)` loop is sequential. `src/services/scp/instance.ts:143-178` -- inner `for (const row of dueResult.rows)` loop is sequential. No `Promise.all`, no `Promise.allSettled`, no worker pool, no concurrency control.
- **Remediation:** (1) Add product-level parallelism with a concurrency limiter (e.g., process 5 products concurrently). (2) Within each product, run independent agents in parallel (agents don't depend on each other within a cycle). (3) Add per-call timeouts on Anthropic requests (60s max). (4) Implement a priority queue: products in Red state run first, then Yellow, then Green. (5) Add circuit breaking: if a product's agents fail 3 times consecutively, skip it for the next cycle. (6) Log execution time per product and alert if a cycle exceeds its cadence window.

### RT-05-02 Evolution Synthesis Is Also Serial Across All Products x All 12 Agents

- **Severity:** P1
- **Description:** `runEvolutionForAllProducts()` runs a nested loop: for each product, for each of the 12 agents, calls `runEvolutionSynthesis()` which itself makes a Claude Sonnet AI call. At 25 products x 12 agents = 300 sequential AI calls. Even if most are skipped by the adaptive cadence check, worst case this function alone could take hours.
- **Evidence:** `src/services/scp/scheduler.ts:92-114` -- nested `for` loops over products and `ALL_AGENTS`.
- **Remediation:** Same as RT-05-01: add concurrency control. Evolution is lower priority than agent runs, so it should yield to the scheduler. Consider running evolution only for agents that had sessions since the last evolution run.

### RT-05-03 Portfolio View Computes Signal for All Products in Parallel -- N+1 Query Storm

- **Severity:** P1
- **Description:** The portfolio route fetches all products, then calls `Promise.all(productRows.map(p => computeSignal(p.id)))`. Each `computeSignal()` call runs multiple database queries (stressors, metrics, lifecycle state, decision backlog). At 25 products, this is 25 parallel signal computations, each involving 4-6 queries, totaling 100-150 database queries fired simultaneously. For a Turso/libSQL database, this will either:
  - Overwhelm the connection (Turso uses HTTP, so each query is a network round-trip)
  - Cause significant latency (2-5 seconds for the page to load)
  - Hit rate limits on the Turso API
  There is no caching of signal scores between requests.
- **Evidence:** `src/routes/dashboard/portfolio.ts:29-31` -- `Promise.all(productRows.map(p => computeSignal(p.id)))`. No cache layer visible.
- **Remediation:** (1) Cache computed signal scores in a `signal_cache` column on the `products` table, refreshed by the metric snapshot job. (2) Use a single aggregated query instead of N+1: `SELECT ... FROM products LEFT JOIN lifecycle_state ... LEFT JOIN (SELECT product_id, COUNT(*) ...) ...`. (3) Add a loading skeleton with HTMX streaming so the page renders immediately and scores fill in. (4) Paginate: show 10 products per page with sort/filter.

### RT-05-04 Product Switcher Is a Flat List with No Search, No Grouping, No Keyboard Nav

- **Severity:** P2
- **Description:** The product switcher is implemented as a form POST to `/switch-product` with a hidden input. At 25 products, this means the user must scroll through a flat list of product names. There is no search/filter input, no grouping by risk state or lifecycle stage, no keyboard shortcut to switch, and no recent-products shortlist. The portfolio page sorts by lowest Signal first (most urgent), which is useful but the switcher in the nav presumably just lists them in database order.
- **Evidence:** `src/routes/dashboard/index.ts:103-120` -- `/switch-product` POST handler. `src/routes/dashboard/portfolio.ts:43-52` -- portfolio grid renders all products as form buttons. No search input, no combobox, no keyboard navigation.
- **Remediation:** (1) Replace the flat list with a searchable combobox (text input + filtered dropdown). (2) Show risk state badge next to each product name. (3) Add keyboard shortcut (Cmd+K or Ctrl+K) to open the switcher. (4) Show "last 5 accessed" at the top. (5) Group by risk state: Red products first, then Yellow, then Green.

### RT-05-05 Briefing Generation Is Serial Across All Products

- **Severity:** P1
- **Description:** `generateBriefingsForAllProducts()` iterates products sequentially with `for...of`. Each briefing generation involves multiple AI calls and database queries. At 25 products, this could take 30+ minutes. The cron job runs at 7:00 UTC, meaning some founders will check their briefing before it has been generated (if their product is late in the queue).
- **Evidence:** `src/services/scp/scheduler.ts:118-140` -- sequential `for (const row of result.rows)` loop.
- **Remediation:** Add concurrency (process 5-10 briefings in parallel). Alternatively, generate briefings incrementally as agent sessions complete rather than in one batch. Send push notifications only after the briefing is ready.

### RT-05-06 All Jobs Iterate All Products with No Pagination or Batching

- **Severity:** P1
- **Description:** Every scheduled job follows the same pattern: `SELECT id FROM products WHERE ...` then `for (const row of result.rows)`. At 25 products this is manageable, but there is no pagination, no batch size limit, and no staggering. The 26 cron jobs (orientation doc says 26, README says 14 -- discrepancy) all share the same execution environment. If multiple jobs fire near the same time (e.g., 6:00 UTC has `lifecycle_check`, `cold_start_check`; 7:00 UTC has `digest_generate`, `yellow_pulse`, `red_daily`), they will all compete for AI API quota and database connections simultaneously.
- **Evidence:** `src/jobs/index.ts:42-56` (lifecycle), `src/jobs/index.ts:59-72` (competitive scan), and every other job function -- all use the same unbounded loop pattern. No concurrency control between jobs.
- **Remediation:** (1) Add a job scheduler with concurrency limits (max 2-3 jobs running simultaneously). (2) Stagger job start times to avoid thundering herd at :00 of each hour. (3) Add batch processing: process products in groups of 10 with a short delay between batches. (4) Consider a proper job queue (Bull, BullMQ, or at minimum a semaphore).

### RT-05-07 AI Cost at 25 Products Is Uncontrolled -- No Per-Product or Per-Cycle Budget

- **Severity:** P1
- **Description:** Each agent session calls Claude Sonnet, and some jobs call Claude Opus. At 25 products with 12 agents each running daily, plus evolution synthesis, briefing generation, competitive scans, weekly synthesis, and stressor identification -- the AI cost could easily exceed $500/month in API calls. The $399/month Investor-Ready tier does not leave margin for this. There is no per-product AI budget, no cost ceiling per cycle, no mechanism to throttle AI usage when costs exceed a threshold. The `costUsd` is tracked in agent sessions but never used to gate execution.
- **Evidence:** `src/services/scp/types.ts:209-210` -- `tokensUsed` and `costUsd` are recorded. `src/services/scp/scheduler.ts:45` -- `totalCostUsd` is summed but only logged, never used as a control. No budget check before agent execution.
- **Remediation:** (1) Add a per-product monthly AI budget (configurable in settings, default based on tier). (2) Before each agent run, check cumulative cost for the current billing period. (3) If budget exceeded: skip non-critical agents, keep only Oracle and Sentinel active. (4) Surface cost data in the dashboard: "AI spend this month: $X / $Y budget." (5) Alert founders when cost reaches 80% of budget.

### RT-05-08 Tier-Gated Product Limit for Investor-Ready Is Infinite -- No Hard Cap

- **Severity:** P2
- **Description:** The `createProductSchema` enforcement in onboarding checks product limits: Solo=1, Growth=3, Investor-Ready=unlimited (`Infinity`). There is no hard cap for Investor-Ready. A single user could theoretically add hundreds of products, each spawning 12 agents, overwhelming the scheduler and AI budget. The $399/month tier was designed for "up to 5 companies" per the pricing page, but the code enforces no limit.
- **Evidence:** `src/routes/dashboard/onboarding.ts:112-117` -- `const isUnlimited = founder.tier === 'investor_ready'` sets limit to `Infinity`. Pricing page says "Up to 5 companies" at `src/routes/public/landing.ts:197`.
- **Remediation:** Enforce the advertised limit: Investor-Ready = 5 products max (or 10 with a hard cap). Add a "Contact us for enterprise" path for more than 10.

### RT-05-09 No Fleet-Level Observability -- No Cross-Product Dashboard for 25 Companies

- **Severity:** P2
- **Description:** The portfolio view shows Signal scores for each product but provides no aggregated fleet metrics: total MRR across all products, total AI spend, products by risk state distribution, fleet health trend, agent performance across the fleet, or alert summary. A power user managing 25 companies needs a control-plane view, not just a list of individual product cards. The orientation doc acknowledges this: "Fleet Observatory: No (current) vs. Yes (target)."
- **Evidence:** `src/routes/dashboard/portfolio.ts` -- renders only individual product cards with signal scores. `src/services/portfolio/manager.ts:78-80` -- `getPortfolioOverview` exists for the investor layer but is not used in the founder-facing portfolio view.
- **Remediation:** (1) Add a fleet summary header to the portfolio page: total MRR, total AI cost, risk distribution, products needing attention. (2) Use the existing `getPortfolioOverview` function (or adapt it) for the founder's own fleet view. (3) Add a fleet-level "alerts" section: products with critical stressors, overdue decisions, or agents in error state.

## Status: HAS P0-P1

One P0 (serial scheduler will fail to complete within cadence at 25 products) and five P1s (evolution serial, portfolio N+1, briefing serial, job thundering herd, uncontrolled AI cost) make the product unusable at the advertised scale of the Investor-Ready tier. The architecture was designed for single-product operation and has not been adapted for fleet-scale execution. The scheduler must be parallelized and cost-gated before onboarding any user with more than 5 products.
