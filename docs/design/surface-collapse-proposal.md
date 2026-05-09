# Surface Collapse — A Design Proposal

> Date: 2026-05-08
> Author: Claude Opus 4.7, on behalf of the Cluster C personas
> (Tobi Lütke, Brian Chesky, Don Norman, Edward Tufte) from
> `docs/audits/elite-persona-review-2026-05-08.md`.
>
> Status: **Proposal. Not implemented.** UI changes of this scope need
> founder input — what to keep, what to fold, what to delete. This
> document captures the persona reasoning, names concrete options for
> each surface, and ends with a small set of decisions only Thomas can
> make.

---

## 1. The diagnosis the personas converged on

The product has accumulated more surfaces than one founder can hold
in working memory — let alone a stranger signing up tomorrow.

Today (2026-05-08):

- **59 dashboard route files** under `src/routes/dashboard/`.
- **12 agents** with internal names (atlas / compass / prism / beacon
  / scribe / forge / harbor / sentinel / ledger / shield / oracle /
  crucible) that the user is asked to learn.
- **5 gate levels** (Gate 0 autonomous through Gate 4 human-only) that
  the user is asked to internalize before they can triage the queue.
- **12 voice-bearing artifact types** behind the action-drafts pipeline.
- **70+ scheduled jobs** producing signals into the same dashboard.

The four personas in Cluster C disagree on which knob to turn first
but agree on the verdict: the product's internal structure is leaking
into the UI, and the new user is asked to absorb it.

| Persona | Sharpest line |
|---------|---------------|
| Brian Chesky | "I do not understand, in one sentence, what I am supposed to do tomorrow morning if I sign up." |
| Tobi Lütke | "A founder doesn't want twelve agents — they want one assistant that understands their business and pulls in twelve perspectives when needed." |
| Don Norman | "Hide the agent names from the user interface entirely. Show roles in plain English." |
| Edward Tufte | "A briefing that takes more than ninety seconds to read is a briefing that gets skipped by week three." |

---

## 2. The four surfaces to collapse

This proposal addresses four UI surfaces in priority order. Each
section: the current state, the persona's recommendation, the
*specific* options for what could replace it, and the decisions only
the operator can make.

### Surface 1 — Agent names in the UI

**Current state.** Atlas, Compass, Prism, etc. appear in:

- Landing page (the 12-agent grid — already softened post-V3.1).
- Dashboard sidebar nav (`/agents/...` routes).
- Briefing markdown ("Atlas: Closed a security gap…").
- Decision queue rationale strings.
- Tour copy and onboarding wizard.

**Persona reasoning** (Don Norman): the agent names are not memorable
as roles for a new user. The user has to learn what "Atlas" does
before they can read a briefing.

**Options.**

| Option | What it looks like | Cost |
|--------|-------------------|------|
| **A1. Drop agent names entirely from user surfaces.** | Briefing reads: "Engineering: Closed a security gap in the auth flow." | 1–2 days copy work; trace.agent_name still flows internally; agent_name kept in DB for diagnostics and audit_log. |
| **A2. Keep agent names but always pair with role.** | "Atlas (Engineering): Closed a security gap…" | A few hours; less radical; preserves the "team of agents" framing the landing page leans on. |
| **A3. Status quo.** | Names alone. | Free; persona view: this is the problem. |

**Decision needed from Thomas:**

- A1 (drop names) commits to "the founder reads roles, not names."
  This is a positioning shift — the landing page would need to follow.
  The 12-agent pitch becomes "12 specialists" without surfacing the
  cast.
- A2 (pair) keeps the cast visible with no learning curve.
- A3 keeps the personality but accepts the onboarding cost.

**Recommendation:** A2 for now. A1 is the right destination but only
once the product has a clear-enough core that losing the cast doesn't
hollow out the brand.

---

### Surface 2 — Gate levels in the queue

**Current state.** The decision queue exposes Gate 0 (autonomous),
Gate 1 (notify), Gate 2 (recommend & wait), Gate 3 (high-stakes
scenario), Gate 4 (human-only). Each has different defaults for
auto-execution. Risk-state-aware thresholds shift Gate 0/1 down in
Red state.

**Persona reasoning** (Don Norman): "Five levels are an engineering
convenience, not a user concept." The founder needs to know two
things: did Foundry handle it, or do I have to.

**Options.**

| Option | What it looks like | Cost |
|--------|-------------------|------|
| **B1. Two user-facing buckets, internal five levels preserved.** | UI shows "Foundry handled" vs "Decide today." Internally gates 0 → "handled," gates 1–4 → "decide today" sorted by gate severity. | 0.5 d UI work; no DB change; gate column kept for analytics. |
| **B2. Two buckets + a "high-stakes" subdivision in 'decide today.'** | Adds a "scenario decision" sub-bucket for gate 3 to flag the few decisions where the scenario model matters. | 1 d. |
| **B3. Status quo — five gate dropdown filters in the queue.** | Free; persona view: this is the problem. |

**Decision needed:** Whether Gate 3's scenario modeling earns its own
visual treatment or folds into "decide today." Option B2 says yes;
B1 says no, the user picks decisions by impact, not by which engine
analyzed them.

**Recommendation:** B1. The scenario model is internal weight; the
founder still just decides.

---

### Surface 3 — The daily briefing's visual contract

**Current state.** `src/services/scp/briefing.ts` produces a markdown
document with sections (signal/risk/health, destination block from
V3.1 Layer A, agent observations, pending decisions). Rendered in
mobile, voice, dashboard, and email surfaces.

**Persona reasoning** (Edward Tufte): the markdown structure tends
toward bullet-list flatness. A briefing that takes more than ninety
seconds to read is a briefing that gets skipped by week three.

**The proposed contract** (this is the most concrete proposal in this
document — it can be implemented when Thomas signs off):

```
[ HEADLINE — single sentence, 120 char max ]            ← already drafted by Sonnet today

[ THE NUMBER THAT MATTERS THIS WEEK ]                   ← from North Star or signal score
   $6,430 MRR — 8% to your $50K target by Q4
   ▲ +$310 this week

[ THE ONE THING TO DO TODAY ]                            ← top-priority pending decision
   Approve: Roll pricing experiment B to 100%
                                            [Approve] [Skip]

[ WHAT HAPPENED — collapsed by default ]                 ← agent observations, expand on tap
[ WHAT'S WORKING — collapsed by default ]                ← positive signals
[ WHAT'S BROKEN — collapsed by default ]                 ← stressors
[ WEEK STATS — small footer ]                            ← decisions handled / agent actions / cost
```

The headline is already drafted by Sonnet. The number-that-matters
needs to bind to the North Star (V3.1 Layer A) when one exists, and
fall back to Signal score otherwise. The "one thing to do today" needs
the existing daily-insight or top pending decision. Everything else is
below the fold.

**Cost.** 2–3 days of UI work + a small change to `formatBriefingAsMarkdown`
to surface the visual hierarchy. The voice / email / mobile renderers
all consume the same markdown; the contract has to land in one place.

**Decision needed:** Is "the number that matters" always the North
Star delta when one exists? The V3.1 build plan says yes. This proposal
treats that as the rule.

**Recommendation:** Implement the contract. It's the highest-leverage
visible change and the disciplines to support it (North Star, daily
insight, decision queue) are all already shipped.

---

### Surface 4 — Dashboard route count

**Current state.** 67 files under `src/routes/dashboard/`. They include:

- Core: `index.ts` (signal home), `agents-*.ts` (briefings, wiki,
  strategy, OKR, intelligence, temporal, actions, wisdom — eight
  files), `decisions.ts`, `signal.ts`.
- Wisdom / DNA: `dna.ts` and adjacent.
- Investor / portfolio: `portfolio.ts`, `benchmarks.ts`, `network-intelligence.ts`.
- Operations: `founder-ops.ts`, `settings.ts`, `privacy.ts`, `api-docs.ts`.
- Misc: `revenue.ts`, `competitive.ts`, `insights.ts`, `exit.ts`,
  `integrations.ts`, plus ~40 more.

**Persona reasoning** (Brian Chesky): "59 dashboard routes and one
founder. The ratio is wrong."

This is the hardest surface to collapse because each route was added
for a reason. The proposal is not "delete them" — it's **fold them**.

**Options.**

| Option | What it looks like | Cost |
|--------|-------------------|------|
| **D1. Three-tab home: Today · Stats · History.** Today = signal + briefing + decisions; Stats = revenue / signal trends / cohorts / customer health folded into one screen; History = audit log + decision retrospective + signal replay. Everything else lives behind a search box. | 4–7 days; the routes still exist, the IA collapses. |
| **D2. Sidebar by audience.** Founder (signal, briefing, decisions, today) vs Investor-Ready (portfolio, benchmarks, board packet) vs Settings. Tier-gated visibility hides Investor-Ready for Solo/Growth. | 2 d; small reduction; doesn't address the core problem. |
| **D3. Status quo — flat list of 30+ visible nav items.** | Free; persona view: this is the problem. |

**Decision needed from Thomas:**

- Which routes are essential to a daily-active founder vs which are
  reference / one-time / monthly-review? An audit by use case, not by
  feature.
- Which routes would Thomas himself actually open in a typical week?
  A few hours of looking at his own usage data answers this.

**Recommendation:** D1, but only after Thomas dogfoods for two weeks
and can name which routes he actually used. The persona-suggested
collapse is right; the specific shape of the collapse depends on
empirical use, not analysis.

---

## 3. The five decisions only the operator can make

Compressed list. Each maps to a section above.

1. **Drop agent names from UI? (Surface 1)** — A1 / A2 / A3.
2. **Two user-facing decision buckets? (Surface 2)** — B1 / B2 / B3.
3. **Adopt the briefing visual contract? (Surface 3)** — yes / refine /
   no. If yes, what's the fallback when no North Star exists?
4. **Three-tab dashboard IA? (Surface 4)** — D1 / D2 / D3, after a
   two-week dogfood with usage tracking.
5. **Sequencing.** The four surfaces above are independent. Pick one
   to ship first; the personas would say briefing visual contract
   (Surface 3) because it's the most-touched surface and the lift
   is bounded.

---

## 4. What this proposal is NOT asking for

- Not a vocabulary rewrite across the codebase. Internal names
  (atlas, compass, gate 0–4, etc.) keep their value as eng concepts.
- Not a feature deletion. Every route under `src/routes/dashboard/`
  is reachable; the proposal is about hierarchy and discoverability,
  not removal.
- Not a multi-week project. Surface 3 (briefing contract) alone is
  2–3 operator-days. Surface 4 (dashboard IA) is the substantial one,
  and it's gated on dogfooding evidence the personas all agreed should
  come first.

---

## 5. If Thomas wants to start tomorrow

The smallest concrete action that delivers a Cluster-C persona
recommendation:

> Implement the briefing visual contract from Surface 3. Two days of
> UI work. It's the single most-touched surface in the product, the
> change is bounded to `briefing.ts` + the renderer surfaces, and the
> disciplines required to populate it (North Star, daily insight,
> decision queue) are all V3.1-shipped. The other three surfaces can
> follow once you have two weeks of dogfooding to inform them.

— end —
