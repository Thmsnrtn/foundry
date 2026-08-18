# AUTONOMOUS CAMPAIGN STATE

Durable scheduler across context windows. Operational, not a specification and
not a diary — git history is the diary. Keep it short enough to stay true.

---

## Current frontier

- **Branch:** `claude/foundry-autonomous-continuation-0gents`. Never merged to master.
- **Migrations:** through **152**. Schema snapshot current.
- **Validation:** `npm run check` green — **233 files / 1,995 tests**, all 4 ratchets hold. CI now runs that composite, rather than a hand-copied subset that omitted four audit gates.
- **Three companies now cross a governed effect,** not one, and between them
  they use both declared effect kinds and both directions of the outcome loop.
  A groundworks contractor is raised by its own system and reports ACHIEVED; a
  heating firm is raised by its owner and reports FAILED. The kernel did not
  move for either.
- **Credentials are scoped to their purpose** (139). One product-wide secret
  authenticated three intakes with quite different consequences, including the
  outcome ledger. Found by reassessing rather than by continuing down a list.
- **The public API is reachable, and safe to be.** Owner decision. It was
  mounted, authenticated, and unusable — nothing could issue a key. Turning it
  on required fixing three write routes gated by a read scope and an MCP
  transport with no scope check at all.
- **One authenticator for one credential.** `api_keys` had two readers with the
  same exported name; the unmounted one was weaker, and a stale audit doc named
  it as the live one.
- **The whole ladder is generic now.** Four SaaS-shaped bindings were found and removed in sequence, each revealed by the previous one: the observation vocabulary (135), the effect guard (136), the authority-read, and the grantable-capability map. A dance school is carried end to end — owner report → Understood → Shadowing → resolved comparison → exact grant → Assisting → founder-authored notice → governed send → receipt → outcome.
- **The support vertical is reachable by a person.** It had three write routes
  and no way in: messages were stored and never rendered, and the channel they
  arrive on could not be created at all. Register a channel → point a helpdesk
  at it → a message arrives → the founder sees it → replies → grants → it is
  carried → someone outside says whether it worked.
- **The loop closes, and closes itself.** Someone outside can say whether an effect achieved what it was for (137), and an hourly pass now turns those reports into resolved outcomes. Before it, the only caller of reconciliation was the founder answering by hand — the external half had nowhere to land.
- **A company's own systems can raise work** (138), so the first rung is no longer fed only by a person.
- **The ladder is no longer SaaS-only.** Independent observation was admissible for twelve hard-coded metrics backed by physical columns, in the service *and* in a database trigger. A company now declares what it counts, in its own words, and the kernel treats it as an opaque named quantity. A boatyard reaches Shadowing in test.
- **Recursive Foundry, reassessed (§13):** unchanged and still ordinary — but the
  session's own billing work put `recursive_privilege_absence` at risk, because
  a rule written for customers is exactly the kind of thing nobody applies to
  the platform. Now proven: neither the entitlement sweep nor the
  governed-effect authority read knows who Foundry is, and the sweep pauses and
  resumes the platform's own company on the same terms as anyone's. If Foundry
  is not entitled, its recursive operation stops — and the fix is to make it
  entitled by ordinary means, never a branch.
- **Recursive Foundry:** the owner-named schema-snapshot responsibility is carried end to end locally — owner report → Understood → Shadowing → Assisting → governed effect → independent verification. `recursive-institution-v1` reports ordinary on all thirteen dimensions, earned by exercise.
- **Dynamic reachability:** all three agent loaders narrow through one closed vocabulary; a bidirectional gate classifies every loadable module.
- **Economics:** cost attaches to responsibility and capability (migration 134), with measured / counted / unmeasured kept rigorously apart.
- **Operating:** frozen (migration 115). **AcreOS:** deferred by owner.

## Audit yield (§3)

Kept to decide when marginal audit value falls, not as a scoreboard. A batch is
a set of surfaces chosen together; "material" means a defect that could produce
wrong behaviour, a leak, or a false claim — not a tidy-up.

| Batch | Seams | Material | Severity | New invariant | Existing violated | Kernel change | Deletion | Prod path repaired |
|---|---|---|---|---|---|---|---|---|
| 1–11 (previous) | 11 | 9 | 2 high, 5 med, 2 low | 4 | 6 | 0 | 3 | 6 |
| 12 credential canonicalization | 3 | 3 | 1 high, 2 med | 1 | 2 | 0 | 0 | 2 |
| 13 outcome provenance | 1 | 1 | low | 0 | 1 | 0 | 0 | 1 |
| 14 tenancy ↔ public API | 2 | 2 | 1 med, 1 low | 1 | 1 | 0 | 0 | 1 |
| 15 SSRF totality + SELECT drift | 3 | 5 | 2 high, 3 med | 2 | 3 | 0 | 0 | 12 |
| 16 billing ↔ capability access | 2 | 2 | 1 high, 1 med | 1 | 2 | 0 | 0 | 2 |
| 17 onboarding ↔ entitlement | 2 | 1 | med | 1 | 1 | 0 | 0 | 1 |
| 18 recursive reassessment (§13) | 1 | 0 | — | 0 | 0 | 0 | 0 | 0 |
| 19 notifications/digests ↔ entitlement | 4 | 4 | 2 high, 2 med | 2 | 3 | 1 | 0 | 34 |
| 20 URL gate falsification (§9) | 1 | 2 | 1 high, 1 med | 1 | 1 | 0 | 0 | 3 |
| 21 SaaS convention (owner direction) | 3 | 3 | 1 high, 2 med | 1 | 2 | 0 | 0 | 5 |
| 22 AI spend attribution | 1 | 1 | high | 1 | 1 | 0 | 0 | 54 |
| 23 rate limiting ↔ deployment | 2 | 3 | 2 high, 1 med | 1 | 2 | 0 | 0 | 8 |
| 24 AI context ↔ tenancy | 3 | 2 | 1 high, 1 med | 2 | 2 | 0 | 0 | 2 |
| 25 erasure ↔ schema | 2 | 3 | 2 high, 1 med | 1 | 2 | 0 | 0 | 205 |
| 26 export ↔ schema | 1 | 2 | 1 high, 1 med | 1 | 1 | 0 | 0 | 208 |
| 27 product axis separation | 3 | 2 | 2 high | 2 | 2 | 0 | 0 | 3 |
| 28 spend subject made explicit | 1 | 2 | 1 high, 1 med | 1 | 1 | 0 | 0 | 6 |
| 29 provider confused deputy | 3 | 3 | 2 high, 1 med | 2 | 2 | 0 | 0 | 3 |
| 30 network contributor independence | 1 | 1 | high | 1 | 1 | 0 | 0 | 1 |
| 31 retention disposition (§9–§11) | 2 | 3 | 1 high, 2 med | 2 | 2 | 0 | 2 | 4 |
| 32 requester + actor identity | 2 | 2 | 2 high | 1 | 2 | 0 | 0 | 12 |
| 33 consent expiry ↔ act gate | 1 | 1 | high | 0 | 1 | 0 | 0 | 1 |
| 34 credential lifetime ↔ erasure | 2 | 1 | high | 1 | 1 | 0 | 0 | 2 |
| 35 auth principal ↔ authority | 3 | 1 | high | 1 | 1 | 1 | 0 | 5 |
| 36 three product axes (fragment drift) | 4 | 2 | 2 high | 1 | 2 | 0 | 0 | 2 |
| 37 rule-trigger success semantics | 1 | 1 | med | 1 | 1 | 0 | 0 | 1 |
| 38 claim strength ↔ eligibility floor | 3 | 1 | high | 1 | 1 | 0 | 1 | 3 |
| 39 experiment outcome + tenant scope | 2 | 2 | 1 high, 1 med | 1 | 2 | 0 | 0 | 2 |
| 40 erasure batch isolation | 2 | 3 | 3 high | 1 | 3 | 0 | 0 | 1 |
| 41 erasure classification totality | 3 | 3 | 3 high | 2 | 3 | 1 | 0 | 13 |
| 42 SELECT drift paid to zero | 34 | 34 | 12 high, 22 med | 0 | 34 | 0 | 0 | 9 |
| 43 runtime SQL preparation | 18 | 18 | 6 high, 12 med | 1 | 18 | 0 | 0 | 8 |
| 44 fabricated test schemas | 105 | 2 | 2 high | 1 | 2 | 0 | 0 | 2 |
| 45 CHECK vocabulary (writes) | 3 | 1 | high | 1 | 1 | 0 | 0 | 1 |
| 46 silent catches around writes | 18 | 3 | 2 high, 1 med | 1 | 3 | 0 | 0 | 3 |
| 47 CHECK vocabulary (reads) | 4 | 5 | 2 high, 3 med | 1 | 5 | 0 | 0 | 5 |
| 48 the second outward door | 4 | 3 | 3 high | 1 | 3 | 0 | 0 | 3 |
| 49 sender of record ↔ live send | 3 | 1 | high | 2 | 1 | 0 | 0 | 1 |
| 50 refusal ≠ ambiguity | 1 | 1 | med | 1 | 1 | 0 | 0 | 1 |
| 51 member permission flags | 3 | 1 | high | 1 | 1 | 0 | 0 | 2 |
| 52 account deletion ↔ erasure | 2 | 1 | high | 1 | 1 | 0 | 0 | 1 |
| 53 canonical membership (owner decision) | 5 | 2 | 2 high | 2 | 2 | 0 | 2 | 17 |
| 54 permission enforcement edges | 6 | 4 | 3 high, 1 med | 1 | 4 | 0 | 0 | 6 |
| 55 alignment repair | 1 | 1 | med | 1 | 1 | 0 | 0 | 0 |
| 56 governed-ratchet bypass | 4 | 1 | med | 0 | 1 | 0 | 0 | 0 |
| 57 temporal pause proofs | 3 | 0 | — | 0 | 0 | 0 | 0 | 0 |
| 58 retention reader edge | 4 | 0 | — | 1 | 0 | 0 | 0 | 0 |
| 59 public API entitlement | 3 | 2 | 2 high | 1 | 2 | 0 | 0 | 2 |

**Reading it:** yield has not fallen. Batches 12, 15 and 16 each found a
high-severity defect, and batch 15 repaired twelve production paths that had
never once worked. Batch 16's second finding — the data-deletion job writing a
status its own CHECK constraint forbids, so it deleted thirty tables' rows and
then threw, leaving every completed deletion permanently pending — was found
only because a test for something else needed that column.

Four of the last six batches also found a GATE or FIXTURE weaker than its name.
That is its own signal and it argues for continuing.

Batch 18 found nothing, which is the result: the reassessment asked whether the
session's own work had broken the recursive dimension it was most likely to
break, and it had not. **One empty batch is not the phase-change trigger** —
that needs several consecutive independently-chosen batches, and 16 and 17 were
neither empty nor low-severity.

Batches 19–21 are the strongest run of the campaign, and 19 is the one worth
reading twice. The entitlement work of batch 16 was written believing that
`scp_status='paused'` was honoured everywhere a cancellation mattered — the
commit says so in as many words. It was honoured by the SCP scheduler and by
nothing else: the outbound gateway read the ARCHIVE axis, thirty-four
background jobs chose their work on it, and the deletion path wrote it without
touching the acting axis at all. **A fix built on an assumption about the rest
of the codebase is a hypothesis, and this campaign's job is to falsify those.**

Batch 20 is the §9 case in miniature: widening a load-bearing gate to see a
syntax it had never been able to see found a live defect underneath it — the
request payload choosing which provider endpoint to call. The gate had claimed
to cover "exactly the modules we think", and five modules had never been
examined by it.

Batch 22 is the same lesson as 19 from the other end. The pause was made to
reach model spend, and then the question "reach it how?" turned out to have a
bad answer: `productId` is the fourth, OPTIONAL argument of the model helpers,
and fifty-five of a hundred and four call sites omitted it. Half the spend was
bounded only by the global ceiling, so **the rule could not have reached it
however well the rule was written.**

Batch 23 found the same shape in the deployment. Every rate limit was a Map in
one process, `fly.toml` runs two web machines, and so every published number was
really double. Alongside it: the default rate-limit key was the caller's own
`X-Forwarded-For`, taken whole and preferred over the platform header, which
made every IP-keyed limit optional for anyone who varied it. **Both defects were
about what the limiter counts, not about the limit.**

**Phase-change trigger:** several consecutive independently-chosen batches
yielding only cosmetic findings and no invariant violations. Not reached — and
further away than it was five batches ago.

## Unfamiliar-company generalization evidence (§1)

**Bounded executable evidence. NOT E4.** Barrowfield Groundworks and Whitlow
Heating are synthetic companies in a controlled test, carried by ordinary
machinery with no kernel change. What that establishes is that the ladder's
shape does not depend on the business — different origins, different governed
effect kinds, a quantity whose favourable direction is downward, and outcomes in
both directions.

What it does not establish is anything about reality. A synthetic company is not
a pilot, and no external party has used any of this.

**Provenance of the two outcomes, kept exact:**

- Groundworks — `achieved`, reported by `customer:jo@fieldstone.example`. A
  customer's report about an effect. Not independently verified.
- Heating — `failed`, reported by `customer:ardley@selby.example`. Likewise.

`outcome_status` spells its success value `verified_success`; that is a stored
vocabulary, not a claim. Since batch 13 the founder-facing sentence names the
reporter and says "reported, not independently confirmed".

## Final-state gaps

Ordered by distance from the final state, not by effort.

1. **Senses are still thin, but no longer closed.** Five provider-neutral intakes exist — metrics, company-defined quantities, inbound customer messages, external obligations, and effect outcomes. All are generic in shape; none is domain-specific. What is missing is breadth of ADAPTERS, not more kernel. Each intake's credential is now scoped to its purpose (139), so a sixth needs a purpose added by migration — deliberately.
2. **Capability fabric is still narrow.** Governed email send now serves any capability through two declared effect kinds, plus bounded generated-artifact development. No scheduling, record mutation, publishing, billing operations, or reconciliation.
3. **World model is sparse.** Facts and claims exist; promise / obligation / workflow / dependency / resource / constraint composition does not.
4. **No frontier cognition anywhere**, by design — no consumed task has yet established a baseline that a model would beat.
5. **Unfamiliar-company breadth** is one held-out corpus plus seven hand-authored businesses, three of which are carried through a governed effect end to end. None has needed a kernel change, and the last two were chosen to take different branches rather than repeat one.
6. **Judgment calibration still has no supply.** Effect outcomes are now reportable; JUDGMENT outcomes are a different shape and nothing produces them, so evaluation can still only report `not_yet_observable`. Deliberately unbuilt.
7. **Nothing has met reality.** No real founder, provider, customer, or pilot.

## Ready work

- **Adapters** for the existing intakes — the shape is proven; what is missing
  is breadth, not architecture. The owner's pilot decision gates on this, so it
  is endorsed rather than speculative. Prefer a source a real responsibility
  demands over a vendor checklist.
- More effect kinds, when a real responsibility demands one. Each is a migration, deliberately.
- ~~A second and third unfamiliar company through a governed effect~~ — **DONE**.

## Blocked — needs a design decision, not effort

- **Named-agent retirement.** The twelve live agents are model-driven; the institution is deliberately model-free. They are Class C, not B: cutting them over would LOSE capability rather than preserve it. Blocked on executive-cognition design, itself blocked on a consumed task with a baseline. Do not force it.
- **`challenger` and `synthesizer` are NOT part of that.** They are not agents at all — standalone debate functions reached by static import. Classifying them from the directory nearly justified deleting live code; the gate now checks reachability instead of location.

## Active work

None in flight. Last package closed and pushed.

## Three findings worth not re-learning

- **A credential is an authority surface, and shared ones widen silently.** One
  secret authenticated posting numbers, raising work, AND declaring that an
  effect succeeded. Migration 137 refuses reports from the institution because
  self-declared success is not an outcome layer — and a metrics integration is
  not the institution, so it walked straight through that check. Whenever a
  route is added behind an existing token, ask what ELSE that token already
  opens. Found by reassessing rather than by continuing down the list.

- **47 assertions existed under `src/` where the runner never looked.** Invisible coverage reads exactly like coverage. Two had silently gone stale — one contradicted a security improvement (SEC-10 moved a GitHub token out of the request body), one required a credential the setup deliberately stopped providing. A gate now enforces both directions.
- **The orphan report is only trustworthy after the dynamic loaders are accounted for.** A naive run once named ~160KB of live, dynamically-loaded agents as dead. Seven modules were deleted this session only after checking module path, bare name, config, CI, and docs.

## Blocked — owner

**Nothing.** All five queued decisions are answered; `OWNER_DECISIONS_PENDING.md`
records them as settled. Standing consequences:

- The public API is **live**. Every new v1 route needs a scope a founder can
  actually grant; the bidirectional gate enforces both directions. Transcript
  ingestion is reachable, so real customer call content can arrive — it is
  customer data AND untrusted external content, and is treated as both.

- Support pilot: **hold for adapter breadth.** E4 stays unclaimed.
- Recursive Foundry: the owner performs the **report only, not the grant** —
  Foundry still may not mutate its own repository outside a test. Do not
  simulate the report; do not treat a local run as the deployed one.
- Effect kinds stay **constitutional**. Never add a mechanism that lets them be
  created at runtime, by a company, an integration, or a model. Now gated
  structurally, not just documented.
- `challenger`/`synthesizer` were **already live** — my classification was
  wrong, corrected on evidence.

## Blocked — external

- **Real bounded support pilot (E4).** `support-pilot-readiness-v1` is green and means only *ready to attempt*.
- **Deployed recursive operation.** Requires a genuine owner-authenticated report and grant performed outside the coding environment. Must not be fabricated.
- **Judgment calibration.** Requires real later-outcome evidence reaching the evaluation path.
- **Business outcomes.** Provider acknowledgement is not resolution; `unresolved` is preserved deliberately.

## Worth an owner's attention, not a decision

- **Any integration configured through `/agents/integrations` before this
  session stored its provider secret in a plaintext column.** Reads fall back
  to it so nothing breaks, and `plaintextCredentialKeys(productId)` names
  exactly which keys to rotate. **No real credentials are affected** — nothing
  has met reality, so there are no production integrations. Recorded here so
  the rotation step is not forgotten if that changes.

## Proof debt

- Everything wired in sessions 4–10 is **E2** — local runtime through production-facing services. A production-facing code path is not production evidence.
- E3 claims cover **only the synthetic dimensions their corpora actually exercise**.
- The institution DARK list now contains **only frozen benchmark gates**, which is what it was always supposed to mean. `development-shadowing.ts` left it when the owner gained a way to state what they expect a check to report.
- ~~Open nondeterminism evidence debt~~ — **RESOLVED**. A near-miss key fixture built as `key.slice(0,-1) + 'X'` collided with the real key whenever it ended in `X` (1 in 64). Not a database, scheduling, or concurrency problem. See IMPLEMENTATION_STATE for the full record.
- The foreign-key PRAGMA defect fixed during that investigation is **latent, not the cause**.

## Deferred

- **Real AcreOS** — owner deferral, unchanged.
- **Quality/cost comparator** — trigger: a real decision between two candidate methods for a consumed capability.
- **Founder-attention measurement** — trigger: a real founder-facing or economic decision consuming it.
- **Assisting → Operating** — frozen; must be designed prospectively from real E4/E5 evidence.

## Recently completed

Newest first. Trimmed as it ages — git history is the diary.

- The public API made live on owner decision: scoped, expiring, revocable keys issued from settings; three write routes moved off a read scope; the MCP transport gains a per-tool scope check it never had.
- Call-transcript analysis bounded — the model's answer cannot put a hundred fabricated competitors into the competitive signal.
- One authenticator for one credential; a permissive unmounted duplicate deleted and a backwards audit row corrected.
- An unpaid account becomes read-only (owner decision 6): the entitlement sweep reuses the cancellation pause rather than adding a second mechanism.
- Cancelling a subscription stops Foundry acting; the data-deletion job can reach its own end.
- The SSRF boundary made total: redirects re-screened on every hop, the rebinding defence made testable and actually tested for the first time.
- The SELECT column drift class swept — 46 findings, 10 on the public API fixed, 36 ratcheted; three phantom tables removed.
- Public API limited by CREDENTIAL rather than by source address, with a tighter budget for the model-backed transport. (This change rode into commit b8360d4, whose message describes only the SSRF and drift work.)
- Integration secrets canonicalized (140/141): plaintext quarantined for rotation, fallback removed, a third writer found storing JSON in the clear behind a route that had never once run.
- Five unguarded outbound fetches of founder-supplied URLs closed, and the SSRF rule made structural.
- Provider credentials stop being written to a plaintext column; one shared allow-list decides what may be stored in the clear, and six adapters now read the encrypted store.
- Whisper transcription brought under the spend ceilings; the effects detector taught to read templated URLs, surfacing seven previously invisible calls.
- The support vertical made reachable by a person: message surface, channel creation, the intake URL, revocation.
- Disagreement shown — `conflicting` named who said what, instead of asking for judgment while withholding the evidence.
- Notices written and not sent stop vanishing; the reachability gate gains a READ chain.
- CI runs the composite gate; four audit gates had been laptop-only.
- The last four untraced consequential effects traced; an ungoverned Linear write deleted; the audit ratcheted to zero untraced.
- The epistemic-status margin gated — the database admits by allow-list, the service denies by list, and they were equivalent only by luck.
- The outcome loop's external half lands: an hourly reconciliation pass, where reports previously sat unread.
- CSRF coverage gated rather than remembered; two of my own gates found weaker than they read.
- Scoped ingest credentials (139); public surfaces stop selecting rows that carry secrets.
- A second and third unfamiliar company through a governed effect, closing the outcome loop in both directions.
- Both kernel-ignorance gates hardened — camelCase was folding the domain word out of existence.
- The owner can open a development expectation — the last non-benchmark DARK module goes live.
- Four owner decisions answered; the effect-kind line made structural.
- `challenger`/`synthesizer` reclassified: already production-reachable via the debate orchestrator.
- Seven proven-dead modules deleted on evidence; as-any ratchet tightened 30 → 29.
- 47 unrun assertions recovered from under `src/`, and a gate against invisible tests.
- External company reports (138) — a company's own systems can raise work, without laundering provenance.
- Effect outcome reports (137) — the loop's last link has a supply; HANDLED means "it worked".
- Governed effect kinds (136) — capability out of the guard; founder-authored notices as the second kind.
- A dance school carried end to end through a governed effect.
- The long-standing intermittent RESOLVED — a 1-in-64 fixture collision, not a system defect.
- Company-defined observation channels (135) — the ladder stops being SaaS-only.
- Dynamic-loader blind spot closed; bidirectional agent classification gate.
- `recursive-institution-v1` reports ordinary, earned by real exercise.
- Owner-named schema-snapshot responsibility carried end to end; `verifyDiffScope` added.
- Institutional cost attribution (migration 134).

## NEXT SESSION START HERE

Bootstrap from disk: verify the branch and clean tree, read this file and
`IMPLEMENTATION_STATE.md`, skim recent git history, then continue without chat
history.

**The method is: read neighbouring subsystems side by side and ask what each
assumes about the other.** Twenty-one batches, seventeen of which found a real
defect. Do not go back to extending a subsystem while that is still true.

**What batch 19 should change about how the next one is chosen.** The
entitlement pause was built one batch earlier on the belief that writing
`scp_status='paused'` meant every cancellation-aware check would honour it. That
belief was written into a commit message as a design argument, and it was false
in three separate places. When a fix says "this reuses the existing mechanism,
so everything downstream already works", **that sentence is the next thing to
falsify**, not a reason to move on.

**Unread seams, in rough order of expected yield:**

1. ~~**Caches and in-memory state.**~~ Done in batch 23. `proseCache` and the
   AI spend cache are correctly keyed; `src/lib/circuit-breaker.ts` still has no
   importers. The rate-limit store was the interesting one and it had two real
   defects. What remains unexamined: `productOwnerCache` in the AI client never
   expires, so a transferred product would keep attributing spend to its former
   owner — low severity, bounded by product count.
2. ~~**AI context assembly ↔ tenancy.**~~ Done in batch 24. `buildConversationContext`
   and `getRelevantPatterns` are properly product-scoped. The cross-product
   wisdom network was not: its "min sample size = 10" gated the COHORT while the
   patterns feeding an insight needed only three ROWS, so an insight derived
   from ONE company was publishable to that company's competitors — and the
   cohort number travelled into other founders' prompts as though it were the
   contributor count. Migration 144 adds a keyed contributor hash so k-anonymity
   can be enforced without the row naming anyone.
3. ~~**AI spend ↔ entitlement.**~~ Done in batch 22. 103 of 104 call sites now
   name their company, one recorded exception (cross-product aggregation), and
   `scripts/check-ai-attribution.mjs` fails the build on a new one. The pause
   refuses model spend in `callClaude` itself, before the key is read and before
   a reservation is taken.
4. ~~**`agent_audit_log` ↔ compliance.**~~ Done in batch 25, and it was the
   worst finding of the campaign. `processScheduledDeletions` deleted from a
   hand-written list of THIRTEEN tables; the schema has 218 carrying
   `product_id`. An erasure removed about six per cent of a company — agent
   messages, chat sessions, call transcripts, customer intelligence, API keys,
   integration records — and then wrote `data_deletion_completed`. The list is
   derived from the live schema now, with an explicit retention allow-list and a
   reason each. Two smaller ones fell out: the loop swallowed delete errors so
   the completion record could be written over a failed deletion, and
   `delete_after_days || 30` turned an immediate erasure request into a
   thirty-day wait.
5. **§14 named-agent retirement.** Untouched this session: classify remaining
   modules A–E, delete A, migrate-then-delete B, treat C as capability input,
   retain D, investigate E. No mass deletion.

**Batches 27–32 were run under an explicit lens** the owner named: the defect is
not "rule missing" but *rule exists → rule is enforced → rule is bound to the
wrong subject, identity, axis, scope or population*. Six batches, ten material
defects, nothing cosmetic. The sharpest were:

- **Twelve founder-facing routes were unreachable.** `requireRole` read context
  keys that only the PUBLIC API's key middleware sets, so a founder pressing
  "pause my company" got a 401 from an owner check on a company they own. A
  guard that refuses everyone looks exactly like a guard that works.
- **Three product facts shared two fields.** The billing sweep wrote its pause
  into `scp_status`, where a founder's own pause lives; the founder's pause wrote
  into `status`, the lifecycle axis that administration reads. Each writer was
  correct about itself and wrong about the other two.
- **Omission meant two things.** A missing model-call subject meant both
  "institutional" and "somebody forgot", and the two differ by an unbounded
  amount of money. Making it required found six more calls the parser gate could
  never have seen — five indirect through a variable, one through `callClaude`.
- **A peer signal counted rows and called them founders.** One company's five
  decisions produced "5 founders at your stage chose X" in a competitor's queue.

**A pattern across 19, 22, 23, 24 and 25.** Every one was a rule that existed,
was believed, and was enforced on the wrong thing: the wrong pause axis, the
wrong (optional) argument, the wrong process, the wrong population, a list
written against a schema two hundred tables ago. None was a missing feature. **When a guarantee is stated in a header comment, the question
to ask is not "is it implemented" but "what exactly does the implementation
count, and is that the same thing the sentence claims".**

**Erasure and access are the same question asked twice.** Batch 26 found the
export had batch 25's defect in a smaller font — ten tables of 218, five of them
added by a fix whose comment reads "Export was 60% incomplete", measured against
a denominator that was itself a guess. Both are derived from the live schema
now. **When one half of a right is enforced against a hand-written list, check
the other half before believing it.**

Two more instances closed the batch. **An expired consent still licensed
autonomous action**: `autonomy_consents.expires_at` was honoured by
`activeResponsibilityAuthority` and ignored by `activeConsent`, which is the one
behind the autopilot's Consent Ledger gate. And **a write credential outlived
the company it belonged to**: erasure cleared the GitHub token but not
`ingest_token` or `share_token`, so a monitoring script kept posting metrics
into a deleted company.

**What the lens is good for next.** Every one of these was found by asking two
questions of a rule rather than one: *what does it think its subject is*, and
*what subject does the implementation actually bind*. Read and clean this batch: onboarding provisioning (binds the created product
to its creator), the job lock (binds the process, not the machine), integration
sync writers (all product-scoped). Still unread: the responsibility ladder's
demotion path (which actor a demotion applies to), the department/capability
mode resolution, and inbound webhook handlers other than Stripe.

**Debt with a number on it:** 0 SELECT column-drift baseline entries
(`docs/db/select-column-baseline.txt`), down from 36. 13 fabricated test
schemas (`docs/db/test-schema-fabrication-baseline.txt`), down from 105, and
the remainder are deliberate with the reason recorded in the file.

---

## Batches 35–41: principal, axis, absence, unit, temporal validity

**An API key satisfied a check for the human owner.** `actingSubject` read a bag
of identity fields that three different authenticators wrote into, so
"who is acting" was answered by whichever middleware had run. Four discriminated
principal kinds now exist — human session, public API key, ingestion credential,
internal service — and ambiguity between two of them fails closed rather than
picking one.

**A rule that grows an axis breaks every hand-copied piece of it.** Migration 145
gave commercial entitlement its own column. Two readers carried
`scp_status <> 'paused'` with a comment explaining why that was complete — and
it had been, when written. Both stopped seeing a cancelled subscription: the
institutional authority read, and the model-spend gate. A fragment is not a copy
of a rule; it is a snapshot, and the rule grows. There is now a gate for it.

**A three-company floor was published as statistical significance.** The owner's
decision is explicit that `MIN_CONTRIBUTORS` and `PEER_SIGNAL_MIN_SAMPLE` are
conservative eligibility floors. The dashboard card said so. The generator told
the model the opposite, twice, and the confidence number the model invented was
stored, used to rank, and rendered beside an "avg impact" that was its estimate
rather than a measured mean. **The place a claim is made is not the place it is
worded — check the prompt, the column name, the ranking key and the injected
context separately.**

**A rule that did nothing reported success every time it fired**, and
**an experiment that could not tell recorded the hypothesis as disproven.** Two
instances of one shape: a vocabulary with fewer names than there are outcomes,
so the outcome nobody named got filed under a neighbour that reads as a result.
Migration 147 added the missing name.

**Erasure could not complete on any company that had ever used the product.** The
erase list was derived from `product_id`, which made it undriftable for the 215
tables that carry it. Fifty-five do not. Twelve are children of erased tables,
seven of those foreign keys are `ON DELETE NO ACTION`, and the connection runs
with `foreign_keys=ON` — so `DELETE FROM chat_sessions` raised for any company
with a single chat message. And the per-product catch its own comment described
did not exist, so one such company blocked every other founder's erasure, daily.
**A derived list is only undriftable along the dimension it derives on.** Every
table in the schema is now classified into exactly one bucket, with a gate that
fails on `UNCLASSIFIED`.

**What the lens is good for next.** Temporal semantics were read and came back
mostly clean — `memory_nodes` orders on `occurred_at`, the judgment observer
deliberately uses record time — so the yield moved elsewhere. `updateResults`
and `validateHypothesis` were unreachable when their tenant scope was fixed:
**the unreachable half of a file is where the conventions of the reachable half
quietly do not apply.**

---

## Batches 42–44: queries that raise, and the tests that agreed with them

**The SELECT column-drift baseline is empty.** Thirty-four single-table queries
selected columns that do not exist. Seven of the twelve company agents failed
on their first data-gathering step and had never completed a run; the founder's
daily briefing has shown no signal score and no MRR growth since the columns
were renamed, inside a catch whose comment reads "signal_history may not exist
yet"; the M&A report scored every company as having no growth history and no
NRR, four of its points, because the comment said "use stored nrr if available,
else derive" and there was no `nrr`, no `else`, and no derivation.

**Then eighteen more that a parser could not see.** The static gate says what
it skips — "anything with a JOIN or an alias" — which leaves the queries most
likely to be wrong outside it. SQLite resolves what a parser cannot, so a gate
now prepares every literal statement against the migrated schema. It found the
public metrics endpoint 500ing on every correction to a submitted date, the
Slack briefing push reading a table that does not exist, and the webhook
cleanup job deleting on a column its table does not have. **A derived list is
only undriftable along the dimension it derives on; a static gate only sees
what its parser can resolve. Both need a runtime check behind them.**

**And the reason none of it was caught.** A third of the test suite built its
own schema. `team-health.test.ts` created eight tables "just enough to test the
computation path", two of them wrong in exactly the way the service was wrong,
and fourteen assertions passed green against a database that exists nowhere.
Converting 22 files to `runMigrations()` surfaced what a stand-in leaves out
every single time — NOT NULL columns, closed vocabularies, foreign keys,
delete ordering — and found two live defects introduced by earlier fixes in
this campaign: a gateway refusal and an unconfigured push each wrote a status
value its table forbids, so both fixes were inert in production and correct
only against the fake.

**The rule this batch earns.** A test that constructs its own reality tests the
code against the test's beliefs. The one thing it can never catch is the two
being wrong together — which is the commonest way this fails, because whoever
writes the fixture reads the query to decide what columns to create.

---

## Batches 48–50: one rule, and the door that was built later

**`checkKillSwitch` had exactly one caller.** Foundry has two paths that produce
outward effects — `outbound_actions` through the gateway, and
`action_executions` through the SCP executor — and only the first checked
whether Foundry may act for the company at all. An approval on the second
posted to Slack, filed Linear tickets and called customer webhooks for
companies whose subscription had lapsed, whose founder had paused them, or
whose data had just been erased. Asking the question of every other effect path
found two more: the customer-facing webhook fan-out (there are two webhook
paths and only the other one was governed) and the Slack daily-briefing push.

The effects inventory had called two of them `control_path` — an honest
description of what they owned (credential, receipts) and a poor description of
what they checked. **`governed` now has to be demonstrable**: the audit proves
the file calls the kill switch or is a gateway-registered capability, and where
the guard genuinely lives in the callers they are named, because "the callers
check" is a claim about other files and that is the kind that stops being true
quietly.

**A rule with an implementation and no edge to it.**
`sender-of-record.ts` says Foundry must never be the From on mail to a
founder's customer, and its own header says "this lights the rule up BEFORE the
live path exists, so it can never regress open". It regressed open:
`assertSenderOfRecord` had zero callers, and the live send handler defaulted to
a Foundry domain. It could not have been enforced, because the "founder's own
connected sender" it presupposes did not exist — every send went through
Foundry's platform key, so no caller COULD satisfy it. **An unsatisfiable rule
is an unenforced rule, and the gap does not show up as a failure.**

Owner decision: build the missing half. Migration 150 gives each company its own
sending identity — the founder's provider credential and the From their
customers see — so third-party mail goes out as them, through their account,
against a domain their provider verified. Foundry cannot verify domain
ownership and does not pretend to; the party who can is the one who does.

**And then the refusal had nowhere honest to land.** The gateway mapped every
handler throw to `execution`, which callers read as "we do not know what
reached the outside world" and answer with a reconciliation window. A message
refused before the provider was touched is the opposite fact. Phase `refused`
now exists, carried by a flag on the error rather than a taxonomy of failure
types nobody would keep accurate.

**What this run of batches has in common.** Every one is a rule that exists,
is believed, and has no edge between it and the thing it governs — a guard with
one caller where there are two doors, a rule with no mechanism to satisfy it, a
classification recording a property nobody checked. **Ask of every stated rule:
what is the path from here to the thing that would break it, and does anything
actually traverse it?**

**Batch 51 is the same lens, applied to a schema instead of a function.**
`team_members` has carried five permission columns since migration 010 —
`can_view_decisions`, `can_vote_decisions`, `can_view_financials`,
`can_view_audit`, `can_trigger_actions` — written by the invite flow and read
by nothing. An `investor_observer` could vote on a company decision, and those
votes feed the co-founder alignment score. The columns were not decoration:
`can_trigger_actions` defaults FALSE while the others default TRUE, which is a
considered position written into the schema and then never asked.

## Batches 53–59: where is the edge?

**Two company authorization models, and the guards read the empty one.**
`account_roles` held a viewer/analyst/admin/owner ladder; `assignRole`, its only
writer, had no callers anywhere, so no row was ever created. `requireRole('admin')`
reduced to the owner check inside it — seventeen routes that read as "an admin
may do this" were owner-only in practice — while `team_members`, what the invite
flow actually writes, carried the real permissions and nothing consulted them.
Owner decision: membership is canonical, ownership is a distinct and stronger
property, a role label grants nothing. Both dead tables dropped (152).

**A member could not arrive.** The dashboard listed companies by `owner_id`, so
a founder could invite a co-founder, have the invitation accepted, and that
person would open the dashboard to nothing. The team feature was a surface you
could be let into and then not reach. Fixing that made the permission columns
urgent rather than decorative — an observer could now open financial pages, the
audit trail and action approval — so all six now have router-level edges, with a
gate that iterates the capabilities and fails on any that is stored, typed,
written by the invite form and read by nothing.

**The alignment score counted votes their caster was never entitled to cast.**
Refusing new ones stops the intake; it does not clean what the intake accepted.
The rows stay — what happened is evidence — and the canonical score now counts
only votes whose caster is entitled *today*. `scripts/audit-unauthorized-votes.mjs`
answers "did it happen" against a real database rather than assuming.

**The governed ratchet let a type-only import through.** Mutation-testing found
it: delete the guard, add `import type … from '…/gateway.js'`, and the file
still proved it was governed. A mention is not a call. It requires
`checkKillSwitch(` or `registerToolHandler(` now, with type imports stripped.

**The public API never asked whether Foundry may act for the company** — no
entitlement check anywhere in `/v1`. Spend and outward effects were refused two
layers down, so an agent run failed in the middle rather than succeeding; but
ordinary writes are neither, and `POST /v1/customers`, `/v1/metrics/snapshots`
and `/v1/experiments` all worked for a lapsed or paused company. Read-only was
true of two layers and false at the surface. MCP needed its own answer, because
`tools/call` is one POST carrying twenty consequences.

**Two things this run proved rather than fixed**, and they belong in the record
as much as the defects: a pause reaches work that was already queued (planned
while operating, executed after — no effect, in all three states), and
reconciliation of an effect that already crossed the provider boundary is not a
new authorization and still runs for a paused company.

---

**Batch 52 found the same shape once more, in the second erasure door.** The
Clerk `user.deleted` webhook deleted by hand — `DELETE FROM products` per
company, then `DELETE FROM founders` — and raises, for the same reason the
erasure path did before batch 41: seven foreign keys into products'
descendants are `ON DELETE NO ACTION`. Account deletion via the identity
provider has never completed for a company that ever had a chat message, and
left no record of having been attempted. Had it succeeded it would have deleted
the evidence that the erasure happened, the financial records that must survive
it, and the idempotency keys that stop a retry re-sending a real message. **When
a path is fixed, look for the other door onto the same room** — this campaign
has now found three: the outward effect, the approval, and the erasure.

**And it surfaced a reachability gap that needs an owner, not a fix.** There are
two role systems with no edge between them. `account_roles` is what
`requireRole` reads, and `assignRole` — its only writer — has no callers, so no
row is ever created and `requireRole('admin')` reduces to the owner check above
it. `team_members` is what the invite flow writes. Nothing bridges them, and
the dashboard lists companies by `owner_id`, so a founder can invite a
co-founder, have the invitation accepted, and that person sees no companies at
all and can reach exactly two endpoints. Per §13 that counts as broken rather
than secure — but what each role should see and do is a product decision, and
widening authorization is the direction where guessing is dangerous. Pinned in
tests so the answer changes deliberately rather than by drift.

---

## Batches 45–47: a value the column cannot hold

**Three defects of one shape arrived together**, and all three were decidable
without running anything: `outbound_actions.status = 'refused'`,
`push_log.status = 'not_configured'`, and `board_packets.status = 'reviewed'`.
Each raised at runtime; each sat inside a catch that treated the failure as
unremarkable; what a founder saw was a button that did nothing, a receipt that
never appeared, an action stuck at `executing`. The third had a further cause
worth naming: `board_packets` was created by migration 011 with one vocabulary
and *redefined* by migration 039's `CREATE TABLE IF NOT EXISTS` with another,
which was a silent no-op — and the code was written against the version that
never ran.

**Then the same lens on reads, which is where it got expensive.** A value that
cannot be written is a value that cannot be found, and a `WHERE` clause looking
for one does not raise — it matches nothing, quietly, forever:

- the voice-approval path looked for `action_executions.status =
  'pending_approval'`, which is `outbound_actions`' spelling. It has never
  approved anything. And the first time it worked it would have approved the
  wrong effect, because it took the most recent pending action and never read
  the `context` naming what the founder was replying to.
- founder-pattern synthesis counted `decisions.status = 'resolved'`, a value
  that vocabulary has never had, so it has never run for anybody.
- Compass read `company_okrs WHERE status='active'`, so its view of the
  company's objectives has always been empty — and an agent with no OKRs in
  context reasons as though the company has none.
- the rapid-override signal counted `IN ('cancelled','rejected')` on a table
  with no `rejected`, so it counted half of what it is named for.

**`action_executions` and `outbound_actions` are the trap.** Two tables with
similar purposes and different status vocabularies — `pending` versus
`pending_approval`, `completed` versus `executed`, `rejected` on one and not
the other. Four of this stretch's defects are that confusion. The gate now
holds the line on all three positions a literal can take: written, compared,
and listed in an `IN`.

**Found by surveying the eighteen places where a write sits inside a catch that
does nothing.** Every defect in this stretch hid behind one. Two more came out
of that survey directly: an automation rule whose action type nothing
implements counted itself as having fired and incremented the number a founder
reads to decide it is working; and the institution chat told a founder it had
recorded a decision it had not, because the model writes "I've recorded that"
before the ledger write it describes.

**Where the lens stops.** A follow-on detector — values a query looks for that
nothing anywhere writes, without a `CHECK` to check against — returns 24
candidates and all of them are noise: schema defaults and parameterised writes
look identical to absent ones from the outside. Recorded as tried, not built.

---

## Batches 60–62: four doors, one consequence

The lens that produced batches 53–59 — *where is the edge between the rule and
the thing it governs?* — turned out to have a sharper form: **how many doors
reach this consequence, and do all of them ask the same question?**

**A standing order was autonomy with a different name.**
`execution_playbooks.auto_execute` is a checkbox labelled "no approval
required", and it meant that literally: the evaluator created an
`action_execution` and approved it in the same breath, under the approver id
`system:playbook`. It reached none of the machinery that governs every other
autonomous act — not the trust ladder, not the platform cap, and not the
consent ledger whose own doc comment reads *"the gate: no autonomous 'act'
without this."* So every lever that stops Foundry acting on its own — turning
the dial down, revoking consent, letting a time-boxed grant lapse, a demotion
after a bad outcome — left a standing order sending exactly as before. A rule
believed by three call sites and unknown to a fourth is not a rule.

The gate reuses the existing categories rather than inventing a permission of
its own: an action that leaves the founder's connected tools is *outreach* and
answers to the outreach dial and cap; everything else answers to a `playbooks`
dial that becomes visible in Controls the moment a playbook exists. A refused
auto-execute leaves the action **pending** rather than cancelling it — the
founder still gets the action, in the queue, where the human eye the refusal
was protecting actually is.

Worth stating because it is a real product consequence rather than a bug fix:
the platform holds outreach at *suggest*, so an auto-executing `send_email`
playbook cannot fire on its own today. That is the rail `outreach.ts` already
documents. Lifting the cap is an operator decision, not a checkbox on a form.

**The gate written to stop that recurring found two more instances the first
time it ran.** `check-autonomous-approval.mjs` fails when a caller of
`approveAndExecute` asks none of the questions that count as asking, and when
an execution status is advanced outside the executor — approval is a status
transition, and a file that writes it has stepped around every check the
executor makes.

- **Voice approvals set a status and stopped there.** Nothing in the system
  ever picks an approved execution up again: the only transition out of
  `approved` lives inside `approveAndExecute`, two lines after its own claim.
  The founder said "yes, go ahead", the row stopped being pending, the effect
  never happened, and the action left the pending queue — the only place the
  dashboard would have let them approve it properly. It did not merely fail to
  act; it *stranded* the action out of reach of the path that works.
- **Three doors reached that routing and one of them asked something.** The
  click path runs through `can_trigger_actions`. The dashboard voice route
  asked nothing. The mobile webhook — an API key, not a human session at all —
  checked only that the key was live and scoped to the product, so a key issued
  with `agents:read` could approve and send. The approver was recorded as the
  constant `'voice:founder'`: not a principal, a category.

A key acts as the person who issued it, bounded by its scopes; both halves
matter and neither substitutes for the other. An empty `created_by` names
nobody and holds nothing, so an approval through such a key becomes a note
rather than an effect.

**Then the same question across the whole dashboard.** 116 mutating routes had
no capability check. Most are ordinary company work an active member should be
able to do; these were not: the agent authority level, assisting-authority
grants, connection grants, the autopilot dial (which raised to `act` records a
consent in the acting founder's name), the digest send, the letter reply send,
a second approval surface for integration actions, scheduling erasure of the
selected company, and storing third-party credentials.

Deliberately left open, and asserted so it stays open: every route that only
**lowers** what Foundry may do — panic, disconnect, grant revocation. Making
the brake harder to reach than the accelerator would be the same defect wearing
a safety label.

**And the guard was looking at a different company than the handler.**
`getLayoutContext` resolves the acting company as: the company named in the
path, then the cookie, then the first company the person can see. The guard's
subject read stopped at the cookie, so a founder with no selection set was
refused on routes whose handlers would have worked, and on `/products/:id/…`
the guard asked about the cookie's company while the handler served `:id`. One
resolution rule now, for both. An id the caller cannot see is passed through
unchanged so the capability check fails on it, rather than being replaced by a
fallback.

**Proved, not fixed.** Two probes returned clean and are recorded rather than
repeated: multi-company work selectors with no state filter (0 — the
entitlement→work-selector edge is total), and the consent edge across the
autonomous departments. Four of five department modules mention no consent
predicate, which looked like the defect class; tracing it showed they consult
`getEffectiveMode` and only *propose* — gate-2 and gate-3 decisions, or
executions created `pending`. `success.ts` is the only one that acts, and it
checks `activeConsent`. The grep was wrong, not the code.

---

## Batches 63–72: the instruments, and the writes that never landed

**Who has a say.** Resolving a decision is the institution's central act, and
`can_vote_decisions` is the permission that exists to say who has a say in one.
The two had never met: the dashboard door scoped on `p.owner_id`, so a
co-founder holding the permission could not resolve, and the MCP door proved the
key's scope and the company's entitlement but never asked whether the key's
ISSUER may decide. Every human door also wrote the same four letters —
`decided_by` is a KIND ('founder' / 'second_self') and has to stay one, because
the shadow ledger and the demotion path read it — so a company with three
founders recorded 'founder' for all of them. Migration 153 puts the identity
beside the kind rather than inside it.

**A ratchet instead of an audit.** The dashboard scan that found 116 mutating
routes asking no capability became a baseline that may fall and never rise.
Deliberately a ratchet rather than a wall: most of those routes are ordinary
company work, and gating them all would be the other defect. Routes that only
LOWER what Foundry may do belong on the list with a comment, not behind a guard.

**Then the instruments turned on themselves**, and this is the part worth
remembering. Two gates had this campaign's own defect class inside them:

- `check-route-guards`'s route-declaration pattern was unanchored, so `const
  founder = c.get('founder')` matched as a route and truncated every handler
  above it to one line — hiding every inline check.
- `check-sql-columns` found `UPDATE products SET a_column_that_does_not_exist`
  perfectly well, printed it, and exited 0. Every time. `lint:columns` chains
  with `&&`, so the line went into a log nobody read and the build went green.

Neither was findable by reading the script. Both took giving it something it
should refuse and watching what it did. Every static gate now has a planted
defect it must catch, asserted on the EXIT CODE, plus the other half of the
mutation — all of them green on a clean tree. The check-vocabulary gate's scan
windows were widened (they stopped reading part-way through 80 statements) and
overruns now fail rather than pass silently; the effects inventory now reports
outward calls its rules cannot see rather than omitting them.

**Writes that never landed.** `check-insert-columns` proves every column an
INSERT names exists; it cannot see the opposite — a column the INSERT does NOT
name, which the table declares NOT NULL with no default. Five instances, all
from a later migration redefining a table with `CREATE TABLE IF NOT EXISTS` (a
silent no-op) while the code was written against the definition that never took
effect. Three of them make a PAID MODEL CALL FIRST, so the founder pressed
Generate, the money went, the narrative was written, and then the write raised:
board packets, investor updates and growth experiments have never produced
anything for anybody. `check-notnull-inserts.mjs` closes the class.

The board packet had a second defect on the same page: "Key Decisions This
Quarter" read `agent_decisions`, a table with no INSERT anywhere in the
codebase, inside a catch that made an empty result and a missing table produce
the same sentence. A document founders send to their INVESTORS has said "No
recent decisions." for every company in every quarter.

**Four owner decisions.**

1. *The outreach cap stays at suggest*, permanently and by decision rather than
   pending a prerequisite. The sending identity makes a send SAFE, not
   SUPERVISED — it puts the founder's domain and CAN-SPAM liability behind the
   message, which is exactly why a human should decide it goes.
2. *`agent_decisions` is deleted*, with the empty inbox tab and the public
   endpoint that could only ever return `{"data": []}`. Same disposition
   `account_roles` got, for the same reason.
3. *A company on its way out stops acting.* A scheduled erasure is a third pause
   axis in `operatingProduct()`, so it reaches all 34 call sites at once. One
   stated exemption: the public API's write gate ignores it, because the window
   exists so the founder can change their mind.
4. *Spending the company's money is not watching.* ~54 routes reaching a paid
   model call now ask `can_trigger_actions`. Baseline 87 → 34. What stays open —
   panic, pause, disconnect, revoke, undo, attention telemetry — is asserted in
   tests, because making the brake harder to reach than the accelerator is the
   same defect wearing a safety label.

---

## Batches 73–79: a rule with nothing on one side of it

By this point the campaign's characteristic finding has a name. It is not a
broken rule. It is a rule with nothing on ONE SIDE of it — a reader with no
writer, an enforcement with no control, a control with no enforcement, a
recording nothing acts on. Four probes, one per side:

**Read but never written (tables).** Eight, and none harmless: `agent_decisions`
(an inbox tab, a public endpoint returning `{"data": []}` forever, and the
investor board packet); `deletion_requests` and `data_export_requests` (a second
Article 17 erasure deleting ~25 tables of ~266 and then writing
`status='completed'`, beside a live and correct one); `cofounder_profiles`
(which made EVERY founder read as solo, so the product told founders with
co-founders they were building alone); `customer_notes`, `chat_webhooks`,
`decision_snooze_log`, `daily_actions`, `ai_usage_log`. All closed, and
`check-writerless-tables.mjs` holds the baseline at zero.

**Read but never written (columns).** `experiments.learnings` was the outcome
column both investor documents read; concluding an experiment writes `winner`,
`results_json` and `early_stop_reason`, never that. `products.cadence_mode` was
the reverse — weekend mode had an enforcement in the scheduler and no way for a
founder to turn it on. The column-level probe returns two dozen false positives
(runtime-assembled column lists, columns maintained by migration triggers) and
was deliberately NOT made a gate: a check that noisy teaches people to ignore
it, which is exactly how two gates came to be trusted while broken.

**Written but never read.** Surveyed, 23 candidates, and recorded rather than
acted on. The class is weaker: an unread recording wastes work but does not lie
to anybody. The one that is a real gap — peer reviews a founder submits that the
reviewee can never see — is an owner disposition, not a defect. `auto_execution_log`
turned out to be a redundant second log beside `action_drafts`, which is read.

**Not named at all.** `check-notnull-inserts.mjs`: a column an INSERT does not
name and the table will not accept as absent. Five instances, three of which
make a paid model call FIRST — so board packets, investor updates and growth
experiments have never produced anything for anybody, and the founder saw a
button that did nothing after the money had gone.

**Three claims to a person, from a source that could not support them**, all in
this stretch: the board packet telling investors the company decided nothing;
the investor documents showing experiments with no outcome; and the insight
telling a founder with three co-founders that they were building alone. The
first two under-report to a third party. The third tells someone something false
about their own life, at the moment it is designed to land hardest.

---

## Batches 80–84: the door beside the rule

**A comment is not a vocabulary.** `decisions.decided_by` was created with its
values in a comment — "founder, system_gate_0, system_gate_1" — and two of the
three have never been written by anything. The comment was not inert: the
Letter, the institution's daily statement to the founder about what it did for
them, asked for `decided_by IN ('system_gate_0','second_self')`, so half of
"what Foundry handled" was a term that could not match. It survived review
because the schema said it was real. Now a CHECK, which makes the database
refuse it AND brings the column under `check-check-vocabularies` — the
difference between a rule that is documented and one that is enforced. Fourth
instance of this exact class after pending_approval, reviewed and resolved.

**The weekly report told the founder nothing had lapsed.** `decisions.status`
has permitted 'expired' since migration 001 and nothing ever wrote it, so the
number of decisions that expired unacted was structurally zero — and those
decisions sat pending forever, indistinguishable from ones still worth making.
A nightly sweep now expires the ones that carry a deadline. Registered in
JOB_REGISTRY, not merely defined: the dead GDPR erasure deleted two batches
earlier was a function nobody called and nothing scheduled.

**The state machine had a door beside it.** Every rule about how a
responsibility may move is enforced BEFORE INSERT on the transitions ledger —
one rung at a time, evidence required, authority required from Assisting up,
shadow proof to enter Assisting, and migration 115's frozen boundary refusing
Operating outright. None of it was enforced on the responsibility row itself:
`UPDATE institutional_responsibilities SET state = 'operating'` skipped all six.
The constitutional invariant is *"Foundry may not silently redefine what Foundry
is allowed to do"*, and a governed column writable directly is exactly that.
Migration 159 requires a state change to be justified by the transition that
recorded it, and refuses birth into the frozen boundary. 160 does the same for
`disposition` — including the quieter attack, editing the REASON for a decision
that was properly made.

**And the fixtures had been going around it.** Seven test files set the state
directly, so each was asserting behaviour in a state the machine might never
have permitted — evidence fabrication at the fixture level, the same class as
the deleted test that inserted rows into `ai_usage_log` to prove `ai_usage_log`
worked. Building the honest helper is what showed how much they skipped:
entering Assisting needs a reconstruction claim, an expectation written while
Understood, a transition to Shadowing, and a comparison written while Shadowing.
The old fixtures wrote `state='assisting'` with no shadow record at all. One
fixture birthed a responsibility as 'operating' — the only place in the entire
codebase a responsibility was ever in the frozen state was a test that did not
need it to be.

**Mutation testing found three gaps in these batches' own tests**, which is the
point of running it: a destination-only justification (letting a demoted
responsibility climb back without earning the rung again), the missing birth
freeze, and `<>` instead of `IS NOT` — the last mattering precisely because the
FIRST write to a NULL justification column is the one that invents a judgement
nobody made.
