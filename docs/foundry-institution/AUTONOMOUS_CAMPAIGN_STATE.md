# AUTONOMOUS CAMPAIGN STATE

Durable scheduler across context windows. Operational, not a specification and
not a diary — git history is the diary. Keep it short enough to stay true.

---

## Current frontier

- **Branch:** `claude/foundry-autonomous-continuation-0gents`. Never merged to master.
- **Migrations:** through **149**. Schema snapshot current.
- **Validation:** `npm run check` green — **220 files / 1,863 tests**, all 4 ratchets hold. CI now runs that composite, rather than a hand-copied subset that omitted four audit gates.
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
