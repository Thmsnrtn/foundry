# The Production Gate — full-platform audit, 2026-07-26

**Charter:** stand the app against an unmovable quality bar — crawl every
surface a founder can touch, break it before they can, and leave nothing
between this build and "production" but the deploy itself.

**Method:** three independent review passes (route security/tenancy, UX/nav/
rendered-HTML, service-layer integrity) plus a new mechanical harness —
`tests/simulation/crawl.ts` — that boots every route module exactly as
`src/index.ts` mounts them, enumerates all 464 registered routes, drives every
GET with a fully-seeded founder, artifact-scans the rendered HTML, verifies
every emitted link and form target against the mount table (method-aware), and
statically cross-checks auth/CSRF middleware coverage. Final state: **0
findings** on the crawl; `npm run check` 974/974; walkthrough + golden sims
green.

## What was broken (and is now fixed)

### The three systemic P0s

1. **22 route modules were double-mounted** — mounted at a prefix in
   `index.ts` while also declaring the prefix internally, so every SCP v4–v7
   page really lived at a doubled path (`/agents/accuracy/agents/accuracy`).
   Every sidebar/palette link to Actions, Accuracy, Transparency, Debate,
   Intelligence, Memory, Scenarios, Network, Benchmarks, Multi-Modal, Ambient,
   Standing Orders, ROI, Exit, Privacy, Audit Log, Weekly Brief, Inbox, OKRs,
   Strategic Decisions 404'd. All now mount at `/` with full internal paths
   (inbox/okr/decisions normalized to their nav URLs).
2. **`agentRoutes` had the inverse bug** — relative paths mounted at `/`,
   making the roster unreachable, agent pages live at top-level `/:name`
   **unauthenticated**, and any one-segment URL an infinite redirect loop.
   Now mounted at `/agents`, registered after the specific `/agents/*` pages.
3. **CSRF validated a token no form ever carried** — all 156 POST forms and
   every cookie-auth JSON fetch would 403 in production; the entire app's
   mutations were dead outside tests (which stub the middleware). The
   middleware now does origin verification first (the header browsers always
   attach and attackers cannot forge), honors the double-submit token when
   present, passes Bearer calls, and its coverage was broadened to the
   previously-exempt state-changing prefixes (`/api/*`, `/integrations/*`,
   `/plan/*`, …).

### Tenancy / IDOR (route + service layer)

- `GET /board/update/:id` — cross-tenant **read** of investor updates (P0).
- `approveAndExecute`/`cancelExecution` — cross-tenant **execution** of real
  outbound actions, plus no status guard (double-click = double Slack post).
  Now: owner-scoped fetch, atomic `pending`→`approved` claim, cancel limited
  to not-yet-run rows.
- Unscoped writes closed in: agent-inbox approve/dismiss/read, strategic-
  decision outcomes, board-packet reviewed/sent, playbook toggle/delete,
  experiments approve/start/stop, prediction outcomes, pattern resolution,
  OKR key-result updates.
- The per-product Stripe webhook in `agents-integrations` sat under authed
  `/agents/*` (unreachable for Stripe) — moved to `/webhooks/integrations/stripe`.
- `POST /letter/attention/:id` was outside every auth registration — covered.

### The trust ladder was silently dead

`outcome_valence` is an INTEGER (1/-1/0) but the ladder compared it to
`'positive'`/`'negative'` strings in three places — so clean cycles never
banked, promotions never happened, the anomaly demotion for autonomous
decisions never fired, and consumed ledger rows could never be re-counted.
Fixed (with an atomic claim so overlapping ticks can't double-count), and the
act path now independently enforces the platform cap and live consent; anomaly
demotions, panic stop, and undo now keep the consent ledger truthful, and an
undo can never *raise* autonomy.

### Correctness class fixes

- **Gateway idempotency poisoning:** a failed handler kept its reservation, so
  every retry became a fake cached success for 7 days. Failures now release
  the reservation; an in-flight duplicate reports honestly instead of
  claiming success; deduped retries no longer burn communication budget.
- **Datetime format skew** (ISO `T` vs SQLite space format) normalized at six
  comparison sites: agent scheduler due-check, undo window, Letter 24h
  windows, signal backlog, premise grace windows, MCP grant expiry.
- **Premise dead-end:** one sparse snapshot marked a belief `unverifiable`
  forever; unverifiable premises now re-enter checking when data returns.
- **Fleet-letter verifier defects were unloggable** (FK violation on
  `product_id='fleet'`) — now anchored to a real product row.
- Guarded increments for communication budgets and MCP grants; exhausted
  exact grants no longer shadow valid wildcard grants; envelope refunds hit
  the same ISO week they consumed.
- Schema drift: OKR page (`period`/`objective_text`/`start_value`, phantom
  `progress` column), agents-inbox (`agents` table → `agent_instances`,
  wrong status filter, actions posting to the wrong subsystem), privacy
  export (`title/description` → `what/why_now`; customers columns), voice
  notes (phantom `company_memory` + invalid category — both fallbacks threw,
  notes silently vanished).
- AI-cost ceilings: 12 `callOpus/callSonnet` sites now pass `productId` so
  per-product/per-founder caps apply (was global-cap only); `safeQuery` in
  founder intelligence recursed into itself (stack overflow on every
  founder-ops API); morning briefing and voice digest degrade to clean 503s.
- Signal: MRR penalty monotone across the 1.0 boundary; "oldest decision"
  computed from the true minimum, not the last row of a category-sorted list.
- Marketing campaign cooldown now counts only the department's own proposals.
- LLM-classified decision categories validated against the CHECK constraint.

### Navigation & product surface

- Public privacy policy moved to `/privacy-policy`; `/privacy` is the
  authenticated privacy dashboard (it was shadowed before).
- `/playbooks/:type` no longer swallows `/playbooks/execution`;
  `/decisions/analytics` no longer resolves as a decision id.
- Dead targets repaired: onboarding Skip, investor add (real form) /
  readiness / packet finalize, integrations OAuth stub honesty, playbook
  Markdown export (new route), revenue curl docs, plan checkbox now reverts
  on failed save.
- Sign out exists (`/auth/logout` + sidebar link + palette). Palette
  product commands use the real product id. Briefing nav highlights
  correctly; hardcoded NEW badge removed; `formatDate` can no longer render
  "Invalid Date".
- 16 dead route files deleted (never mounted anywhere): the `as any` ratchet
  baseline tightened 32 → 30.

## Verified-safe (from the three review passes)

Parameterized SQL throughout the routes; hono/html escaping intact (no raw()
with user data); share/ingest token surfaces hardened; Stripe + Clerk webhook
signature verification correct; envelope consumption race-safe; cron jobs
under the distributed lock; AI client ceilings/retries/cost math correct;
the dominant owner-join tenancy pattern correct across ~40 route files.

## Standing guard

`tests/simulation/crawl.ts` is the permanent regression net for this class:
run `npx tsx tests/simulation/crawl.ts` before any release. It fails on any
5xx, template artifact, dead link/form, unauthenticated mount, or
CSRF-uncovered mutation route.

## Known limitations (accepted, documented)

- Suggest-mode drafts consume envelope/budget at draft time; a days-later
  approval doesn't re-check at the send boundary (the action verifier covers
  the outcome side).
- `aggregateInsights()` (cross-product) rides the global AI cap only — it has
  no single product to bill.
- OAuth-based integrations are honestly labeled unavailable until an OAuth
  flow ships; API-key integrations and MCP connections are the path.
