# Foundry V3.1 — Status

> Written 2026-05-08 by Claude Opus 4.7 (1M context).
> Snapshot at the end of the V3.1 autonomous build.
> Companion to `FOUNDRY_V3_SYNTHESIS_FROM_REPO.md` and
> `FOUNDRY_V3_1_BUILD_PLAN_SPECIFICS.md`.

---

## 1. What shipped

V3.1 added a thin discipline layer on top of the existing 12-agent SCP
runtime — no rename, no sense/reason/act restructure, no parallel forks.
17 commits on `claude/foundry-v3-autonomous-build-LE2Bt`, branch base
`ccd3942` (last reality-align commit).

### Layer A — Destination + governance state

| Commit | Subject |
|--------|---------|
| `5144e5c` | V3 synthesis from real repo state |
| `bbb7091` | V3.1 build plan specifics |
| `011a76f` | `north_stars` + `outcome_trees` (migration 060) — Sage's `kill_criterion NOT NULL` enforced |
| `abc4900` | `freeze_periods` + `phase_beta_proposals` (migration 061) |
| `edf54e8` | `team_health_metrics` + Ambros Round 5 yield (migration 062) |
| `68f7b72` | Destination context injected into briefing + `team_health_aggregate` cron |
| `62d953a` | Architecture freeze gate wired into SCP evolution + provisioner |

### Layer B — Calibration

| Commit | Subject |
|--------|---------|
| `ea97065` | `product_voice_fingerprints` (migration 063) — versioned with partial-unique active index |
| `3376e74` | `taste_journals` (migration 064) + LLM-distilled prompt summaries |
| `bd27069` | Voice gate verdict layer (`pass`/`warn`/`block`/`exempt`/`no_fingerprint`) |
| `15e078f` | Voice gate wired into `action_drafts` pipeline — block forces `auto_executable=false` and tags description |

### Layer C — Trust boundary on outbound

| Commit | Subject |
|--------|---------|
| `3d6d70e` | `idempotency_keys` (migration 065) + daily cleanup cron |
| `25cac48` | `data_classifications` (migration 066) + per-product per-surface policy |
| `8cf82ff` | `communication_budgets` (migration 067) — Lighthouse's recursion finding |
| `7485d68` | Tool gateway (`gateway.ts`) + `kill-switch.ts` + `audit.ts` + `products.disabled_tools` (migration 068) |
| `517100b` | `src/services/outbound/README.md` — usage + adapter migration order (Resend → Stripe → GitHub) |

### Layer A revisit

| Commit | Subject |
|--------|---------|
| `83c9e7b` | Outcome tree weekly refresh — pull `metric_snapshots` into branches' `current_value`; supersede stale (>90d, no current_value) branches |

---

## 2. Tests

| Phase | Test count |
|-------|-----------:|
| V3.1 baseline (before commit 9) | 479 |
| After commit 9 (voice gate wire-in) | 484 |
| After commit 10 (idempotency) | 493 |
| After commit 11 (classification) | 504 |
| After commit 12 (budget) | 511 |
| After commit 13 (gateway) | 526 |
| After commit 15 (tree refresh) | 534 |
| **Final** | **534 across 32 files** |

Net: +55 tests across 6 new test files.
TypeScript: clean throughout. No `--no-verify`, no hook skips.

New test files:
  - `tests/unit/voice-gate-actions-integration.test.ts` (5)
  - `tests/unit/idempotency.test.ts` (9)
  - `tests/unit/data-classification.test.ts` (11)
  - `tests/unit/communication-budget.test.ts` (7)
  - `tests/unit/gateway.test.ts` (15)
  - `tests/unit/outcome-tree-refresh.test.ts` (8)

---

## 3. Migrations

| # | Title | Layer |
|---|-------|-------|
| 060 | north_stars + outcome_trees | A |
| 061 | freeze_periods + phase_beta_proposals + decisions ALTER | A |
| 062 | team_health_metrics | A |
| 063 | product_voice_fingerprints | B |
| 064 | taste_journals | B |
| 065 | idempotency_keys | C |
| 066 | data_classifications | C |
| 067 | communication_budgets | C |
| 068 | products.disabled_tools (ALTER) | C |

All idempotent (CREATE TABLE / INDEX IF NOT EXISTS; ALTER TABLE ADD COLUMN
which the migrate.ts runner already swallows for "duplicate column"). The
pre-existing migration 007 in-memory issue is untouched per the handoff.

---

## 4. V3 spec items now covered

From the recursion findings ledger (V3.1 build plan §4):

| # | Finding | Disposition | Where |
|---|---------|-------------|-------|
| 1 | Tool gateway with idempotency, classification, kill-switch, audit | Shipped | `outbound/gateway.ts` + 065/066/067/068 |
| 2 | Architecture freeze period | Shipped | `discipline/freeze-periods.ts` + 061 |
| 3 | Recursive critique yield monitoring | Shipped | `discipline/team-health.ts` + 062 |
| 4 | Voice fingerprint per product | Shipped | `calibration/voice-fingerprint.ts` + 063 |
| 5 | Taste journal per agent per product | Shipped | `calibration/taste-journal.ts` + 064 |
| 7 | Communication budget per customer | Shipped | `outbound/budget.ts` + 067 |
| 9 | Kill criterion required on every outcome branch | Shipped | 060 NOT NULL constraint |
| 11 | North Star + Outcome Tree as first-class | Shipped | `destination/` + 060 |
| 12 | Phase beta queue for blocked architecture changes | Shipped | `discipline/proposals-queue.ts` + 061 |
| 13 | Data classification per surface | Shipped | `outbound/classification.ts` + 066 |
| 14 | Idempotency on every outbound action | Shipped | `outbound/idempotency.ts` + 065 |

Findings 6 (anti-canon corpus) and 10 (per-specialist eval suites) remain
as discipline-upgrade work for future sessions; both are class (a) — no new
tables required.
Finding 8 (domain expert veto) intentionally dropped per build plan §4.

---

## 5. What is deferred

| Area | Reason |
|------|--------|
| **24-specialist V3 mega-prompt** | Not needed. Existing 12 SCP agents are the layer V3.1 disciplines apply to. Renames and adds remain open under G2. |
| **`sense/reason/act` directory restructure** | Architectural churn the freeze period exists to prevent. Existing service tree stays. |
| **LLM-driven outcome tree generation** | Needs founder-supplied seeding rules (G3). The shipped weekly refresh does deterministic value updates and stale-branch supersession only. |
| **Adapter migration to gateway** | Gateway exists; adapters still call `executor.ts` directly. Migration order documented in `outbound/README.md`: Resend → Stripe → GitHub, one commit each. |
| **Multi-tenant separation** (G6) | AcreOS, Astrum, Kalshi-Genius treated as products under one Foundry account. Real multi-tenant is its own 1-2 month project. |
| **Remaining ~20 of the 34 recursion findings** (G7) | Ledger never paste-shared; the 14 I could classify from context are the basis of this build. |
| **Anti-canon corpus / per-specialist evals** | Findings 6 and 10 — discipline upgrades for the existing SCP, no new tables. Future session. |
| **Voice fingerprint baseline content** (G4) | Tables ship empty. Fingerprints need calibration during friendly alpha. |
| **Real North Star numbers per product** (G3) | Tables ship empty. Founder fills in onboarding. |

---

## 6. Recommended next moves

In priority order, when this branch lands:

1. **Migrate Resend through the gateway.** This is the highest-leverage
   adapter — all customer-reaching email becomes guarded by idempotency,
   budget, classification, kill-switch. Single commit, narrow blast
   radius. See `outbound/README.md` for the pattern.
2. **Seed a North Star and one outcome tree for Foundry itself.** The
   refresh cron is shipped but does nothing without seed data. Use Thomas's
   actual targets so the briefing system surfaces "X% to N" framing.
3. **Calibrate Foundry's voice fingerprint via taste journal.** First
   pass: rate ~10 recent agent-produced artifacts. Activate the resulting
   fingerprint. Verify the gate triggers correctly on a deliberately
   off-voice draft.
4. **Then either** (a) start friendly alpha onboarding for founder #1, or
   (b) close the remaining ~20 recursion findings with Thomas before alpha.
   The build plan's §5 default was "alpha by Day 4 after Layer A"; that
   judgment is unchanged.

---

## 7. Honest accounting

What this build did NOT do:

- It did not validate any of the new infrastructure under load. All 534
  tests are unit tests against in-memory SQLite. The gateway has not seen
  one production call.
- It did not migrate a single adapter to the gateway. The trust boundary
  exists; nothing crosses it yet.
- It did not seed any data — North Stars empty, fingerprints empty,
  classifications empty. The disciplines exist; they have nothing to
  discipline.
- It did not solve G2 (rename), G3 (NS numbers), G4 (fingerprint content),
  G6 (tenancy), or G7 (full ledger). Those need Thomas.
- Schema migration count went 060 → 068 (9 added). The repo's overall
  migration count is now ~104; that's a lot to keep coherent. No
  duplications detected during this build, but a periodic schema audit is
  worth scheduling once V3.1 lands.

— Claude Opus 4.7
