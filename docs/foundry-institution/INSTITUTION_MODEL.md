# The Institution Model

*Written 30 September 2026, from the owner's long-horizon directive and its deep-architecture addendum, reconciled against the repository at `46d2417c`. It owns the human ontology, the ownership of canonical state, the precedence and scope of every kind of direction, and the contracts that let the interface stay small while the institution underneath grows.*

**The test.** Open Foundry on a phone for thirty seconds. Can the owner tell:
- whether everything is all right;
- whether they are making money;
- how much is at risk;
- what Foundry is trying;
- what happened;
- what happens next;
- whether anything needs them?

If yes, the surface works. If a new capability needs a new page to be understood, the abstraction failed.

**What this document is not.** It is not a backlog and not a wireframe set. It is the set of decisions that every later slice must be consistent with. ROADMAP carries the slices. EXPERIENCE carries the information architecture as law. ARCHITECTURE carries the canonical flow. The CONSTITUTION outranks all of it.

---

## 1. Current state, reconciled

### 1.1 What the owner surface is today (`46d2417c`)

| Area | Reality |
|---|---|
| Doors | **Today, Missions, Needs you, Control**, the same on a phone and a desk. The More sheet is gone. Every other place is a depth listed once under "Everywhere else" (`views/owner/shell.ts` `DOOR_OF`, `EVERYWHERE_ELSE`) |
| Composer | On every page, docked above the bar on a phone. ⌘K / Ctrl+K / "/" focuses it. A place or company named alone is a jump. Every sentence is compiled (`services/intent/compile.ts`) and its reading kept (`owner_intents`, 370) |
| Missions | Read from the work that already exists: the search, each test, company work, and the trading research (`services/mission/read.ts`). The owner can state one (`missions`, 371) and limit any (`mission_terms`, `mission_events`). A test proves that no gate that lets Foundry act reads these rows |
| Needs you | One list (`services/needs-you/queue.ts`): the attention queue plus mail that only the owner can answer, plus crossed Mission limits. Five answers before the buttons. "Not now" (`needs_you_snoozes`, 372) |
| Depth places | Portfolio (`/foundry/companies`), Experiments, Searching, Economics, Charter, Activity, Inbox, Workshop, Roadmap, Absence test, Advanced (`/letter`) |
| Legacy owner pages | `/settings`, `/privacy`, `/connections`, `/onboarding`. These carry most of the remaining jargon: agents, MCP, agent logs |
| iOS | Archived and not buildable (`ios/ARCHIVED.md`). The PWA is the phone product |

### 1.2 Delta against the directive

| | Items |
|---|---|
| **Already solved** | One owner and one door (S2); a composer on every page; a deterministic intent reading shown before binding; one attention queue ranked by consequence; the charter as the portfolio's resource envelope; boundaries, allowances and consents as authority; consequence rungs, with `legal` and `destructive` never absorbable; one outcome vocabulary (`outcomeOf`); receipts with effect certainty; trading that is research only, with no order table; activity as a merged stream; absence summaries (`whileYouWereAway`, the absence test); owner-entered carrying cost; the opportunity graveyard (why rejected); Needs-you answers; the Mission as a thread that grants nothing |
| **Partially solved** | The Mandate: its parts exist, but no portfolio-level object or view holds them together. Standing rules: they exist as boundaries, allowances and delegations, but no single list presents them as sentences. The asset lifecycle: three overlapping axes (`standing`, `posture`, `company_lifecycle_state`), and S89's state machine is not yet one object. Effective capability: `connectorsFor` has four separate booleans, but capability maturity is not composed with it. Interruption: a ladder exists but is not connected to attention items. Evidence: six parallel claim and observation stores. Memory: premises (per company), lessons (per owner) and wisdom (cross-company), with no scope field |
| **Structurally unresolved** | The Mandate as a scoped, expiring stack; precedence between direction layers; effective authority as one explainable reading; Explore as a funnel; Portfolio as heterogeneous assets with a one-card truth; human read models, so that Home does not query forty tables ad hoc; check-in style separate from authority; "next" as canonical state; blocked-branch isolation stated and proven; state diffs shown after every change |
| **New work required** | `mandate_statements` (the one new canonical table this model asks for); read models; an effective-authority reader; the shell change to Home, Portfolio, Explore and Control; jargon removal from the legacy pages |

**The shell shipped this morning is superseded, cheaply.** The long-horizon directive keeps four doors but names them differently:
- Needs you becomes a global indicator rather than a door.
- Missions become depth within Explore and Portfolio.
- Today becomes Home, and Portfolio and Explore become doors.

Because a place's door is one entry in `DOOR_OF`, the change is a mapping, not a rebuild (§8).

---

## 2. The human ontology

Twelve terms. The owner learns these and nothing else.

| Term | What the owner understands | Canonical owner (unchanged unless marked **new**) |
|---|---|---|
| **Home** | "Can I leave Foundry alone?" | read model `HomeSummary` (§6) |
| **Portfolio** | What I own or operate, and how it performs | `products` (standing, reality, posture, form) with economics from `economy/projection.ts` and `founder/burden.ts` |
| **Explore** | What Foundry is looking for, testing or trying to create | `venture_mandates` (the open search), `venture_opportunities`, `market_unknowns`, `venture_experiments`, `capital_research_theses` |
| **Control** | What Foundry believes I want, and what it may do | the Mandate and the authority tables |
| **Needs you** | What only I can decide | read model `services/needs-you/queue.ts` (no entity until behaviour needs one) |
| **Mandate** | What Foundry believes I want right now, editable | **new** `mandate_statements`, plus the charter, guidance, objectives and preferences, composed |
| **Opportunity** | Something possibly worth pursuing; most die | `venture_opportunities` (with `kill_thesis` and verdict), graveyard |
| **Mission** | Work Foundry is carrying toward a goal | `missions`, `mission_terms`, `mission_events` plus the rows each Mission threads through |
| **Asset** | Something that earns, or is meant to | `products` |
| **Test** | A bounded attempt to learn one thing | `venture_experiments` and `probe_designs` / `probe_stop_conditions` |
| **Rule** | Something Foundry always does, or never does | `owner_boundaries`, `owner_allowances`, `delegations`, `autonomy_consents`, `owner_exclusions`, the charter's contact rules |
| **Authority** | What Foundry may actually do, in words: Observe, Assist, Operate | charter, allowances, boundaries, consents, delegations, rungs; read by `founder/authority.ts` |

Two more terms stay out of the bar. **Composer** is the way to say anything. **Advanced** is the Inspector: every machine term is allowed there.

### 2.1 Machine → human

| Machine concept (where) | Human term | Visible where | Normally |
|---|---|---|---|
| `venture_mandates` (search) | "What Foundry is looking for" | Explore | yes |
| `venture_guidance` | part of the Mandate ("steering this search") | Control › Mandate, Explore | yes |
| `venture_opportunities` / graveyard | Opportunity; "not pursued, and why" | Explore | yes |
| `market_unknowns` / `market_claims` / observations | "What we still need to know" / evidence | Opportunity and Test detail | depth |
| `venture_experiments`, probe design, stop conditions | Test; "stops when…" | Explore, Mission, Portfolio | yes |
| forge, lenses, attacks, strata, seeds | "How Foundry designed this test"; "reasons this could fail" | Test › Why | depth |
| `undertakings` + steps | Mission (company work) | Portfolio › asset | yes |
| `proposed_acts` | a decision in Needs you | Needs you | yes |
| `situation_recommendations` | advice in Needs you | Needs you | yes |
| `responsibility_candidates` / responsibilities ladder | "Something Foundry would look after" / Observe→Assist→Operate | Needs you / Control | yes |
| `autonomy_consents`, `delegations`, `act_classifications` | "What Foundry may do on its own" | Control › Authority | yes |
| consequence rungs | "Where it lands" (internal, provider, account, public, person) | decision cards | yes |
| `autopilot_policies`, shadow/suggest/act | Observe/Assist/Operate; evidence under "Why does Foundry have this?" | Control › Why | depth |
| `portfolio_envelopes` (charter) | "The charter": the money and reach for tests this term | Control | yes |
| `owner_allowances` | a Rule ("up to $X on Y") | Control › Rules | yes |
| `owner_boundaries` | a Rule ("never" / "ask me first") | Control › Rules | yes |
| `owner_objectives`, `owner_preferences` | the Mandate: what matters, which way to lean | Control › Mandate | yes |
| `products.posture` | asset mode (Grow, Hold, Harvest, Reposition, Sell, Retire) | Portfolio | yes |
| `products.standing` | "Testing" vs "Operating" | Portfolio | via stage |
| `outbound_actions`, receipts, effect certainty | Activity receipt: done / sent, not yet confirmed / unknown | Activity, Mission | yes |
| `economic_events`, `business_outcome_events` | money and what the world did | Portfolio, Economics | yes |
| `decision_premises` (belief ledger) | "What Foundry is relying on", with its checks | Advanced; later Mission › assumptions | depth |
| lessons, `lessons_read` | "What Foundry learned" | Test, Explore | yes |
| wisdom, graph, departments, red team, Letter | Advanced | Advanced | no |
| `capabilities`, maturity, senses, connectors | "What Foundry can reach"; connected accounts | Control › Connected | yes |
| `owner_intents` | "How well Foundry understands you" | Control | fold |
| `interruption.ts` ladder | "How Foundry reaches you" (Silent, Home, Needs you, Urgent) | Control | yes |
| jobs, loops, `job_health` | Health | Control › Health, Advanced | glance only |

**Words retired from the owner's primary surfaces:**
- agent;
- hypothesis;
- gate;
- calibration;
- playbook;
- shadow;
- autopilot;
- MCP;
- orchestrator;
- template JSON;
- decision chamber;
- forge;
- stratum;
- seed.

All of them remain allowed in Advanced.

---

## 3. Canonical state and its owners

### 3.1 One owner per fact

| Fact | Owned by | Never duplicated in |
|---|---|---|
| What the owner wants (portfolio) | `mandate_statements` (new) | chat, `owner_intents` (only the *reading*), Mission rows |
| What the current search is for | `venture_mandates.statement` + live `venture_guidance` | the Mandate (which *reads* it) |
| What may be spent on tests this term | `portfolio_envelopes` + carves | Mission budgets (these are tripwires, §5.5) |
| What may be spent per company | `owner_allowances` | Mission terms |
| What may never / ask-first happen | `owner_boundaries` | the Mandate (which *reads* it) |
| Standing permission for an act class | `delegations` + `autonomy_consents` | anywhere else |
| Mission goal, limits, owner acts | `missions` / `mission_terms` / `mission_events` | the rows it threads through |
| A test's prediction, window, stop conditions | `venture_experiments`, `probe_designs`, `probe_stop_conditions` | Mission terms |
| What happened in the world | receipts, `economic_events`, `business_outcome_events` | summaries (these cite rows) |
| Asset mode | `products.posture` + `posture_changes` | Mandate statements |
| Mission status, asset stage, Needs-you items, Home | **derived, never stored** | — |

### 3.2 The one new canonical table: `mandate_statements`

The Mandate has parts with canonical homes (charter, guidance, objectives, preferences, boundaries). What has no home is the portfolio-level *steering*: what to pursue and avoid, what to optimise for, the experiment style, involvement, risk posture, how attention is allocated across areas, and temporary postures. One append-only table holds it, superseded and never edited.

```text
mandate_statements
  id, founder_id
  dimension   interest | avoid | optimize | experiment_style | involvement | risk | allocation | posture
  subject     free key within the dimension ('saas', 'digital_downloads', 'trading', 'cash_flow', 'low_maintenance', …)
  value_json  the typed value (level, band, percent, mode)
  scope_kind  portfolio | domain | asset | mission
  scope_ref   null | domain key | product_id | mission key
  statement   the owner's words, verbatim, or the direct-control label
  source      intent:<owner_intents.id> | direct
  until       null (until changed) | date (expires)
  review_at   null | date (brought back, never auto-changed)
  said_at, superseded_by
```

- **It grants nothing.** Like `missions`, it is read by no gate that lets Foundry act. The test pattern already exists in `a-mission-grants-nothing`. Steering *may* narrow what Foundry looks for (the forge and discovery can read `avoid`), and that is safe because it narrows.
- **Composer and direct controls write the same rows.** "No SaaS for now" and tapping *SaaS → Avoid* create the same statement, differing only in `source`.
- **Temporary is explicit.** "For now", "this month" and "until November" set `until` or `review_at`. Unspecified temporary language gets `review_at` = +30 days, shown. Nothing temporary becomes permanent silently.

**Not new tables:**
- **postures and check-in style** are `mandate_statements` rows (`posture`, `involvement`); the plan's `owner_modes` is folded in;
- **an AttentionRequest entity** is not built; the queue read model suffices until behaviour needs lifecycle rows;
- **an event table** is not built; the activity union reads canonical append-only rows, §6.3;
- **an Opportunity table** is not built; `venture_opportunities` owns it.

---

## 4. Policy: precedence, scope, inheritance

### 4.1 Two kinds of direction, never mixed

- **Authority** decides what Foundry *may do*. It combines by **intersection**: the most restrictive applicable limit wins. It is enforced by code at the gates (kill switch, outbound gateway, model client, hand, charter). A model never decides it.
- **Steering** decides what Foundry *aims for*. It combines by **specificity** within what authority permits. It never widens authority.

### 4.2 Precedence (higher wins)

1. **Constitution.** The CONSTITUTION; the `legal`/`destructive` rungs, never absorbable; the sealed contact rules; no order path for capital; owner identity only with explicit approval.
2. **Hard owner rules.** `owner_boundaries` (never), `owner_exclusions`.
3. **Authority grants.** Charter, allowances, consents and delegations, each a ceiling; the effective value is their minimum.
4. **External and affected-party constraints.** Qualification, provider limits, recorded constraints of the people an effect reaches.
5. **Mandate principles.** Durable `avoid` and `risk` at portfolio scope.
6. **Current strategy and posture.** Portfolio `interest`, `allocation`, `posture` (e.g. Conserve).
7. **Domain direction.** `scope_kind = domain` (e.g. "trading: simulation only").
8. **Asset mode.** `posture` on the product.
9. **Mission terms.** These narrow only: a Mission can lower a limit, never raise one.
10. **One-time instructions.**
11. **Foundry's own suggestions.** Proposals only, until the owner accepts them.

A lower layer that conflicts with a higher one loses, and the reading says so: "This Mission asks for $200; your global limit is $100; effective $100". The owner may make an exception only *as an owner act at that scope* ("approve once", "this Mission", "this domain", "change the global rule"), and every such act is shown with its scope and with what else it would affect.

### 4.3 Scope

Every compiled direction resolves to one scope: `portfolio`, `domain:<key>`, `asset:<product_id>`, `mission:<key>`, or `once`.

| Said | Default scope | Default durability |
|---|---|---|
| "Never use cold SMS." | portfolio | durable |
| "No SaaS for now." | portfolio | review in 30 days |
| "Don't use paid ads for this experiment." | mission | ends with the Mission |
| "Keep trading theoretical." | domain:trading | durable |
| "Spend less this month." | portfolio posture Conserve | until the month ends |
| "Try a cheaper price." (on an asset) | asset | once |

- **Ambiguity that matters is shown, not guessed.** "Stop trading" could mean stop live trades, stop the paper strategies, or stop the research. The **narrowest-consequence** reading is applied provisionally (pause new trading work, keep history), and the scope question is asked once.

### 4.4 Inheritance

Global → domain → asset → Mission → action. Every limit is inherited unless narrowed. The UI shows overrides with their effective result ("Global $100 · this Mission $50 · effective $50"). When overrides accumulate, the reading suggests simplifying.

---

## 5. Contracts

Each contract below becomes a test file. The tests are the contract; the prose explains it.

### 5.1 Attention contract

| Level | Channel (`ux/interruption.ts`) | Qualifies when |
|---|---|---|
| Silent | log | handled inside authority; no consequence to the owner |
| Home | letter (`quieted_events`) | meaningful, but no judgment needed |
| Needs you | notification | judgment or authority is required and nothing else can answer |
| Urgent | push | owed to a person; irreversible and time-bound; or a bound breached |

- **Before anything becomes Needs you,** Foundry answers it from policy, memory, evidence or a cheap safe action if it can.
- **Items are batched** where they share a decision ("five items, resolve together").
- **Every item carries** why now, what yes does, the most it can cost, whether it can be undone, and what happens if the owner does nothing (done, M7).
- **Items can be withdrawn:** proposed acts already expire, and a stale request must be withdrawn rather than left to rot.
- **Check-in style** (Hands-on, Occasional, Quiet, Away) is a `mandate_statements.involvement` row. It sets the ceiling for `setMaxChannel` and the batching. **It never changes authority.**

### 5.2 Reversibility and consequence contract

- **Every act has a rung** (`consequence_rungs`) and a `Consequence` (`what-it-would-do.ts`): where it lands, reversibility, and what it does not authorise.
- **Reversible, internal acts** may be done-then-undone ("Done · Undo").
- **Public acts, acts that reach a person, and account acts** need the confirmation their authority requires.
- **Irreversible acts** need deliberate confirmation every time.
- **When unsure,** Foundry picks the action with the least consequence.

### 5.3 Evidence contract

- **Claims** are limited to the highest state the rows confirm: *planned, authorised, attempted, sent/acknowledged, confirmed, verified, failed, unknown* (`outbound_actions.effect_certainty`, `outcome_status`, `action_executions.verify_status`).
- **"Published" or "paid"** appears only when confirmed.
- **Observed and inferred are kept apart.** Market observations carry `directness` and `observed_at`. Fulfilments carry `observed_how`. Summaries cite rows.
- **Staleness is visible** (e.g. "last confirmed 6 hours ago"). The per-store freshness constants (7 days, `STALE_DAYS`, 365 days) are named in one place in a later slice.
- **No false precision.** Evidence words are Early, Weak, Mixed, Promising, Strong, Inconclusive. Numbers appear only where the metric is defensible.
- **Attribution stays honest.** "Revenue observed after X" is kept apart from "Foundry caused X".

### 5.4 Autonomy contract

- **Foundry decides tactics inside the envelope:** timing, order, which test next, when to stop a test on its predeclared criteria, and plan repair.
- **Widening authority is always an owner act,** made in Control or through the composer with the full confirmation.
- **Foundry may propose authority, never take it.** Where approvals repeat with no correction, it may propose a scoped rule ("up to $50, this category").
- **Demotion is easier than promotion.** A correction can narrow authority automatically where policy allows, and the change is shown.
- **Goal changes are not plan changes.** "Plan changed" (old tactic → new tactic, with the reason) is shown in activity and needs nothing from the owner. A change of goal needs the owner.

### 5.5 Resource contract

- **Envelopes combine by minimum.** The envelopes are the charter (tests total, tests in flight, thinking per day), allowances, the thinking ceilings (`spending.ts`) and Mission terms.
- **Mission budgets and end dates are tripwires, not ceilings, today.** Crossing one makes the Mission Needs you. Making them enforcing is a *narrowing* change that must go through the gates, and it is proof debt.
- **Evidence earns resources.** Escalation beyond a test's authorised cost needs the owner, or a charter that already allows it.
- **"Do nothing" is always valid.** Unused budget is not waste.
- **Attention is a resource.** Owner minutes (`owner_minutes`) and interventions are counted, never estimated.

### 5.6 Inactivity contract

- **The owner's silence is not a no, and it is not a yes.** An unanswered proposed act expires and nothing happens. An unanswered test does not start. Everything else keeps running.
- **A blocked branch blocks only itself.** Jobs are per item. A failing path pauses that experiment (`experiment_path_outages`), and a failing connector pauses what depends on it (`checkKillSwitch`).
- **Every Needs-you item states its default path** (the "if you do nothing" answer).
- **On return,** Home opens with what happened while the owner was away (`whileYouWereAway`, widened to experimental assets).

### 5.7 Memory contract

- **The stores are named and scoped:**
  - premises (per company, with checks), `decision_premises`;
  - lessons (per owner, invalidated with their test);
  - owner intents (per owner, verbatim);
  - Mandate statements (scoped, expiring).
- **Promotion from observation to lesson to principle needs repetition,** and the scope is recorded.
- **A contradiction supersedes, it does not overwrite.** The old belief, the new evidence and the current conclusion are all kept.
- **No hidden profiling.** A durable preference exists only as a visible Mandate statement.
- **A later slice** makes premises and lessons readable in Control as "What Foundry is relying on".

### 5.8 Mission contract

- **Start.** A Mission is confirmed by the owner, or is a thread through work that already exists.
- **Limits.** Budget, end date, success, stop condition and interruption, all narrowing only.
- **Next.** Canonical wherever a reader can say it; `null` when concluded.
- **Status.** Always derived.
- **Outcomes.** Succeeded, Failed, Inconclusive, Stopped (with "Stopped early — useful: …"), Superseded, Graduated to an asset, Became a responsibility.
- **Lineage.** `parent`, `supersedes`.
- **It grants nothing.**

### 5.9 Portfolio contract

- **Assets are products.** An asset's human stage is **derived** as Idea, Testing, Proven, Operating, Growing, Harvesting or Retired: `assetStage(standing, posture, status, company_lifecycle_state, first settled payment)`. S89's states *exist under other names; the page was missing* (STRATEGY), so no new column is added.
- **The one-card truth** answers what it is, what it makes, what it costs, whether it is healthy, how much owner attention it takes, and what happens next.
- **Health is words with reasons**, never a score.
- **Heterogeneity** comes from `ECONOMIC_FORMS`, via the asset's originating experiment.
- **Graduation** is `standing: experimental → earned`, and it keeps its lineage (`from_opportunity_id`, `from_experiment_id`).

### 5.10 Explore contract

- **Funnel:** observed → screened → investigated → tested → promising → graduated, with killed and parked alongside.
- **Every stage count** is derived from the opportunity, unknown and experiment rows.
- **"Not pursued, and why"** reads the graveyard.
- **A Mandate `avoid` shows as "SaaS: paused by your Mandate".**
- **Allocation bands** (`mandate_statements.allocation`) are steering: priority, not guarantees.
- **Discovery is continuous but quiet:** summaries, not a feed.

### 5.11 Temporal contract

- **Waiting and stalled are different.** Waiting has a date or an evidence threshold (`due_at`, `settles_when`, `read_not_before`, `reconcile_after`, `until`). Stalled is blocked with no progress.
- **Every Mission and asset** exposes its next evaluation.
- **Temporary state shows when it expires** ("Conserve ends in 4 days").

---

## 6. Read models

Each read model is a function over canonical rows. Pages bind to read models, not to tables.

| Read model | Composes | Status |
|---|---|---|
| `NeedsYouSummary` | `waitingOn`, mail, Mission tripwires, snoozes | **built** (`needs-you/queue.ts`) |
| `MissionSummary` | missions, terms, events, and each Mission's source rows | **built** (`mission/read.ts`) |
| `HomeSummary` | whether all is well (`healthOf`), money this month (`projection.ts`), at risk now, what is being tried (Explore rollup), Needs-you count, since the last visit (`whatChangedSince`), handled for you, next | to build; today it lives inside `context(c)` and `foundry-shell.ts` |
| `PortfolioSummary` | products, `burdenFor`, `portfolioFor`, contribution, `assetStage`, next | to build |
| `ExploreSummary` | the funnel, allocations, avoids, active tests, rejects | to build |
| `ControlSummary` | the Mandate (statements plus guidance, objectives, preferences), rules (`rulesInForce`), authority by domain (§7), resources, involvement, connected capabilities | to build |
| `RiskSummary` | at risk right now: charter carves outstanding, allowances remaining, refund exposure, pending contacts, live capital ($0, structurally), irreversible commitments | to build |
| `AttentionSummary` | interventions per month, the composer's misread rate (`owner_intents`), Needs-you age and clear time, items put off | to build |

- **Performance.** Every read model is bounded to at most six parallel queries. Caching comes only when measurement asks for it, and every figure says "as of" where freshness matters.

### 6.1 Effective authority reader (code, not a table)

`effectiveAuthority(founderId, { domain, productId?, missionKey?, amountCents?, rung? })` returns a **verdict** and two lists:
- verdict: `allowed` | `within_limit` | `needs_approval` | `prohibited` | `unavailable`;
- `because[]`: each limit that applies, with its scope;
- `resolveBy[]`: approve once, this Mission, this domain, change the rule, or keep.

It **explains, it does not enforce**: the gates stay the enforcers. A property test holds the reader and the gates to the same answer on the same inputs, so the two can never disagree.

**Domains:**

| Domain | Observe | Assist | Operate |
|---|---|---|---|
| Research | investigate | — | — |
| Build (drafts, internal assets) | — | drafts | create |
| Deploy | — | staging | reversible deploy |
| Spending | — | propose | within limits |
| Customer contact | — | draft | send within rules |
| Founder identity | — | draft | never without approval |
| Financial assets | simulation only; **LIVE does not exist** | — | — |

### 6.2 Effective capability

Effective capability = technical capability (`capabilities` maturity) ∩ connection (`connectorsFor` `granted`, `qualified`) ∩ authority (`authorised`, `effectiveAuthority`). Control › Connected shows all three for each capability, so "connected but not allowed" and "allowed but not connected" are both visible.

### 6.3 Activity without an event table

`whatHappened` stays the union of canonical append-only rows. It gains four sources:
- `mission_events`;
- `posture_changes`;
- `capability_maturity_changes`;
- a *confirmed* `owner_intents` row, shown as "You changed…".

Importance levels are Internal, Informational, Meaningful, Attention and Critical; Home shows Meaningful and above. Compression ("four pricing iterations this week") groups by Mission and week. A cross-cutting event table is built only if the union becomes too slow to render.

---

## 7. Intent compiler contract

**Model utterance → reading → typed proposal → validation → policy check → confirmation where required → canonical mutation → state diff → activity.** No model output mutates state. Deterministic readers are authoritative. A model may later *propose* a reading, which is validated by the same code.

| Typed proposal | Class | Confirm | Binds through |
|---|---|---|---|
| Question | — | none | answer path (`matchQuestion`) |
| Jump | — | none | redirect |
| CreateMission | steer | show, then confirm | `openMission` / `openMandate` / `openUndertaking` |
| UpdateMandate (interest / avoid / optimize / style / involvement / risk / allocation / posture) | steer | one tap, then Undo | `mandate_statements` (new) |
| SteerSearch | steer | one tap | `absorbGuidance` |
| AddStandingRule (never / ask-first / up to $X) | **authority** | full, with scope | `setBoundary` / `setAllowance` |
| ChangeBudget (Mission) | steer (narrowing) | one tap | `setTerms` |
| ChangeBudget (allowance / charter) | **authority** | full | allowance / charter page |
| ChangeAuthority (widen) | **authority** | full, never from one sentence alone | company authority page |
| ChangeAuthority (narrow) | authority | one tap | `moveLighter` |
| PauseAsset / SetAssetMode | steer | show | `setPosture` |
| StopMission / StopTest / StopSearch | steer (narrowing) | show | the object's own Stop |
| RequestInvestigation | steer | show | `openUndertaking('investigate')` |
| Housekeeping | steer | show | `clear-handled` |
| Hold outreach | **authority** (narrowing) | show | `pauseNewEconomicActivity` |

**After every mutation the page shows a state diff:** "Applied: Trading exploration 20% → 10%. Live trading permissions: unchanged." The diff is computed from the before and after rows, never written by a model.

---

## 8. Information architecture and route collapse

**Doors (phone and desk, stable for years):**
- **Home:** `/foundry`
- **Portfolio:** `/foundry/companies`
- **Explore:** `/foundry/explore`, a new read-model page. It replaces the Missions door, and `/foundry/missions` stays as "All work".
- **Control:** `/foundry/controls`

**Always present, never a door:**
- **Needs you · N:** a header indicator on every page, opening `/foundry/needs-you`. On a phone it is a sheet.
- **Composer:** docked on a phone, in the header on a desk, and reached with ⌘K.
- **Advanced:** a quiet link.

| Route | Disposition |
|---|---|
| `/foundry` | **Home**, rebuilt on `HomeSummary` |
| `/foundry/companies[/:id…]` | **Portfolio** door; asset detail keeps its dimensions |
| `/foundry/missions[/:key]` | wrap: "All work" under Explore; Mission detail stays |
| `/foundry/experiments[/…]`, `/foundry/searching` | wrap: depth under Explore |
| `/foundry/needs-you` | keep; reached from the header indicator, not the bar |
| `/foundry/decisions` | redirect (done) |
| `/foundry/controls[/…]`, `/foundry/charter` | **Control** |
| `/foundry/money`, `/foundry/money/research` | wrap: Portfolio › Economics; research sits under Explore › Trading |
| `/foundry/activity` | de-emphasise: Home › "Since your last visit" → all activity |
| `/foundry/inbox` | wrap: its needs-owner items are in Needs you; the list is a depth under Portfolio › Workshop |
| `/foundry/public-workshop`, `/foundry/workshop` | depth under Portfolio (the Workshop is an asset) |
| `/foundry/absence`, `/foundry/roadmap` | Control › depth; Advanced |
| `/letter` | **Advanced / Inspector** |
| `/settings` | wrap: Control › Account; purge its jargon |
| `/privacy` | Control › Your data; purge its jargon |
| `/connections` (MCP) | Advanced › Tool servers |
| `/autopilot/*` POSTs | keep while Control uses them; retire after estate Stop moves |
| `/onboarding` | becomes the first-run Mandate questions (§9) |

**No new permanent door** unless it meets all four tests:
- it is a stable human mental model;
- it is relevant across business categories;
- it cannot live under the four doors;
- it is needed frequently.

---

## 9. Screen specifications

These are specifications for the phone first, and each stated in the same order: state, meaning, next, action if required, evidence. Desk layouts use the same order in two columns.

**Home**
1. Greeting and one-line state ("Everything is operating normally" or the exception).
2. Four to six pinned figures: net this month, spent exploring / envelope, at risk now, operating streams, tests running. Pin, Remove, Move up and Move down; never drag-and-drop.
3. Current focus, one line per Explore area: "Digital downloads: 3 tests, 1 paid".
4. Needs you: "Nothing" or the top item compressed.
5. Since your last visit, as counts that link to activity.
6. Handled for you.
7. Next: one paragraph from the Missions' `next`.
8. A link to the full briefing, which is the Letter under Advanced.

When the page is almost empty, that is correct.

**Portfolio**
- Groups: Operating, Testing, Retired.
- One card per asset (§5.9), showing its stage pill, net this month, health word, owner attention, and next.
- More than 20 assets collapses to groups plus exceptions.
- Empty state: "Nothing is operating yet. Foundry is exploring within your Mandate."

**Explore**
- Areas from the Mandate's interests, each with funnel counts and the promising one.
- Avoided areas are shown paused.
- Trading shows Simulation, the counts, and "No capital at risk".
- "Not pursued, and why", then all work (Missions).

**Control** (one-screen truth)
1. The Mandate: interested in, avoid, optimise for, style, involvement, risk, exploration resources, key boundaries. Every item is tappable to change and shows its scope and expiry.
2. What Foundry may do, as the domain table (§6.1).
3. Resources: spent / envelope, tests in flight, thinking.
4. Rules Foundry follows.
5. How Foundry reaches you.
6. Connected.
7. Stop everything.
8. How well I understand you.
9. Everywhere else.

**Needs you**
- Sorted by consequence.
- Each item gives five answers, then Approve / Change / Decline / Not now, then the evidence behind "Why Foundry thinks this".
- Empty state: "Nothing needs you. Foundry is working."

**Asset detail**
- The one-card truth.
- Dimensions: Overview, Work, Authority, Economics, Customers, Tests, Evidence.
- Missions for this asset.
- Mode (posture).

**Opportunity detail**
- Why it fits the Mandate, the evidence level, cost, effort, maintenance, risk and the next evaluation.
- Or, if not pursued, why not.

**Mission detail**
- Status, goal, next, limits (editable), then activity, outcome and lineage (built).

**Mandate edit and Authority edit**
- Direct controls over the same rows the composer writes.
- Each change shows its effect before it applies (a policy preview): "3 queued tests become executable; live trading unchanged".

**Composer states**
- idle (quick intents);
- typing;
- compiling;
- proposal (steer and authority split);
- clarify;
- answered;
- applied, with the state diff and Undo;
- refused, naming the rule that would move it;
- error, keeping the owner's words.

**Decision**
- Recommendation, reason, confidence as a word, and the maximum downside if wrong.
- Approve / choose another / ask.
- Evidence, scenarios and the adversarial case are folded below.

**Activity and evidence**
- Receipts ("11:42 Created variant B"), each opening to the Mission, rule, permission, act, verification and outcome.

---

## 10. Components

| Built | To build |
|---|---|
| `page`, `placeHead`, `frameFor`, `mark`, `ago` (shell) | `NeedsYouIndicator` (header count + sheet) |
| `statusPill`, `missionCard`, `emptyState`, `facts`, `sectionHead`, `sixAnswers`, `notNow` (`views/owner/components.ts`) | `MandateCard`, `MandateRow` (value, scope, expiry, edit) |
| `renderDecision` (the only way a decision gets a button) | `AuthorityDomainRow`, `BudgetMeter`, `RiskSummary` |
| `sparkline` | `PortfolioCard`, `OpportunityCard`, `FunnelBar` |
| Composer (shell) | `StateDiff` ("before → after, unchanged:") |
| | `ActivityReceipt`, `NextLine`, `EvidenceDrawer` (details) |
| | `BottomSheet` (`dialog` with a focus trap, in the hashed script) |

**htmx** (vendored, unused) is adopted narrowly: inline approval in Needs you, the state diff after a Mandate edit, and the evidence drawer. It is self-hosted and runs with `allowEval:false`. Every form still works without JavaScript.

---

## 11. Migration: vertical slices

Each slice goes through a red test, `npm run check`, a `[deploy-private]` commit, and a health read-back.

| Slice | What | Proves |
|---|---|---|
| **V1 Shell** | Doors become Home / Portfolio / Explore / Control; a Needs-you indicator in the header on every page; `/foundry/explore` on an initial `ExploreSummary`; the Advanced link; jargon purged from `/settings`, `/privacy`, `/connections`, `/onboarding` | the stable shell |
| **V2 Mandate** | `mandate_statements`; Control › Mandate card with direct controls; compiler `UpdateMandate`; `StateDiff`; forge and discovery read `avoid` | scenarios "No SaaS for now" and "Spend less this month" (directive 610, 611) |
| **V3 Explore** | funnel, allocations, rejects, "paused by your Mandate", trading area | the first vertical slice: "Find a low-maintenance digital product to test this month, ≤$100" (607) |
| **V4 Portfolio** | `assetStage`, `PortfolioSummary`, one-card truth | graduation keeps lineage |
| **V5 Home** | `HomeSummary`; pinned figures; since last visit; handled for you; next; return surface | the thirty-second test |
| **V6 Authority** | `effectiveAuthority` + agreement test; domain table; estate-wide Stop; check-in style; Away | "Founder disappears for seven days" (609); blocked-branch isolation |
| **V7 Trading** | Simulation / Paper / LIVE shown; LIVE structurally absent; research metrics in Explore | "Test strategies, paper only" (608) |
| later | allocation bands in use, opportunity cost, scoped memory in Control, drift warnings, rule proposals from repetition, Mission budgets that enforce (narrowing) | one-year targets |

Old routes stay reachable until the surface that replaces them passes its tests. Removal follows shadow → compare → cutover → delete.

---

## 12. Institutional invariants (tests)

| Invariant | Test |
|---|---|
| No Mission row can let Foundry act | `a-mission-grants-nothing` (exists) |
| No Mandate statement can let Foundry act | `a-mandate-grants-nothing` (V2) |
| No live capital, ever, from any sentence, mode or term | capital tests + `a-mission-grants-nothing` scenario H (exist) |
| No external act without effective permission | kill-switch / gateway tests (exist); `effective-authority-agrees-with-the-gates` (V6) |
| Nobody but the owner | `nobody-but-the-owner` (exists) |
| Authority is never a model's decision | compiler tests: a sentence produces a reading, never a mutation (M3) |
| Important direction never lives only in chat | every confirmed `owner_intents` row has a bound canonical row (V2) |
| Temporary state expires or is reviewed | `mandate_statements.until` / `review_at` sweep test (V2) |
| A blocked branch does not stop unrelated work | two experiments, one path broken: the other continues (V6) |
| Silence is neither yes nor no | an expired proposal acts on nothing (exists); an unanswered test does not start (exists) |
| Planned is never shown as done | receipt-state rendering test (V5) |
| Every Needs-you item gives all five answers | `needs-you-answers-before-it-asks` (exists) |
| The bar has four doors and no page adds one | `four-doors-and-a-composer` (exists; updated in V1) |

**Mobile.** The Chromium tests at 375, 390 and 430 px, at 100% and 200% text, cover every door, the Needs-you sheet, the composer and Mission detail. Accessibility checks cover focus, labels, the dialog focus trap, contrast in all three appearances, and meaning never carried by colour alone.

---

## 13. Instrumentation

Every measure comes from existing rows. There is no telemetry service.

| Measure | Source |
|---|---|
| Share of owner instructions held as structured state | `owner_intents` confirmed ÷ said |
| Misread rate | `owner_intents` unplaceable + clarify ÷ said |
| Time from intent to first useful action | `owner_intents.outcome_at` → the first activity row of the bound object |
| Interventions per month; items put off; Needs-you age | proposed-act decisions, `needs_you_snoozes`, the queue |
| Cost to learn; time to learn | experiment spend and dates at conclusion |
| Share of tests with predeclared stop criteria | `probe_stop_conditions` |
| Autonomous work receipts | confirmed `outbound_actions`, stopped tests, recovered failures |
| Blocked-branch isolation | path outages vs other experiments' activity in the same window |

---

## 14. Questions this model leaves open, and the current stance

- **Missions vs Responsibilities.** A responsibility (`institutional_responsibilities`, the ladder) is continuous. A Mission is bounded. "Continue looking for opportunities" is a responsibility that spawns Missions. There is no new object until a second responsibility needs one.
- **When is evidence enough?** The threshold scales with consequence: reversible and cheap needs Early, while money, identity or irreversibility needs Strong or the owner. This is proof debt in V6.
- **How temporary preferences expire.** `until`, or a 30-day `review_at`, shown in Control. At review Foundry asks once, never nags.
- **Opportunity cost.** Not before two assets are operating (OBJECTIVE §4: defend the river before extending it).
- **Portfolio at 5, 20 and 100 assets.** Cards, then groups plus exceptions, then portfolio summary plus deviations. The data needed (form, dependency, posture) is already kept per asset, and platform dependency per asset is proof debt.
- **Model independence.** Every piece of state above is relational and owned by code. A model call receives scoped context assembled from it and keeps nothing.

*Amend this document deliberately, with the date, when the governing theory changes. A slice that disagrees with it either amends it first or is wrong.*
