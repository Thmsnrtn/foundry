# Contributing to Foundry

> This is a one-page guide for the next person to touch this codebase.
> If you're reading it because you're about to make a change, you're in
> the right place.

## What Foundry is

A single-founder autonomous AI operations tool. A founder connects a
GitHub repo and 12 specialized AI agents start running against the
codebase and the founder's business data, producing a daily briefing
and a gate-controlled decision queue. Tier-gated for 1–5 products per
account.

Not a fleet control plane. Not multi-tenant. Single-process Node app.

## The shape

```
src/
  index.ts            # Hono server boot, route mount, cron scheduler init
  env.ts              # Required env var validation (fail-fast)
  db/                 # libSQL/Turso client, ~100+ migrations, runner
  middleware/         # auth (Clerk JWT) → tenant scope → tier gate → rate limit
  routes/             # public, auth, dashboard (server-rendered HTML), api
  services/           # The brain. Reads and writes the world.
  views/              # Hono html templates + components
  jobs/index.ts       # Cron registry — 70+ jobs, scheduled by node-cron
  cli/index.ts        # CLI entrypoint for migrations, seeds, manual runs

tests/
  unit/               # Vitest. The current 534 tests gate every commit.
  evals/              # Per-agent golden cases (run in CI).

docs/
  architecture/       # Synthesis docs, build plans, V3.1 status
  audits/             # Reality checks, lens audits, persona reviews
  operations/         # Deploy, disaster recovery, runbooks
```

## The hot rails (do not break without asking)

### 1. The agent runtime — `src/services/scp/`

Twelve agents (atlas, compass, prism, beacon, scribe, forge, harbor,
sentinel, ledger, shield, oracle, crucible) plus the SCP infrastructure:
provisioner, scheduler, briefing assembler, evolution engine, gates,
agent-config, instance.

Rules:
- The 12 agent names are load-bearing in databases and prompts. Don't
  rename without a migration pass.
- `BaseAgent.analyzeAndAct()` is the contract. Don't bypass it.
- Golden lessons (`agent_evolution_versions` with
  `change_type='golden_lesson'`) are injected into every prompt. They
  accumulate. Pruning is a deliberate decision.
- Cadences live in `agent-config.ts`. Tightening them affects AI cost
  linearly. See `docs/operations/runbooks/ai-bill-spike.md`.

### 2. The decision queue — `src/services/decisions/`

Five gate levels (Gate 0 autonomous through Gate 4 human-only).
`generateActionDraft` (in `actions.ts`) is the entry point that turns a
decision into a draft artifact. **V3.1: voice-gate is wired in here.**
Block/warn verdicts force `auto_executable=false` regardless of gate.

Don't change the gate semantics without auditing every callsite of
`approveDraft` / `rejectDraft` / `executeAction`.

### 3. The outbound trust boundary — `src/services/outbound/`

Two paths today:
- `executor.ts` — original propose/approve/execute flow used by the
  Resend integration. Has its own rate limit logic.
- `gateway.ts` — V3.1 top-level entry point with idempotency,
  classification, budget, kill-switch, audit. Currently has no
  registered handlers in production.

The destination state is: every outbound call goes through `gateway.invoke()`.
Adapter migration order is documented in
[`src/services/outbound/README.md`](../src/services/outbound/README.md):
Resend → Stripe → GitHub. One commit per adapter.

### 4. Cron registry — `src/jobs/index.ts`

70+ scheduled jobs. The file is monolithic and known-fragile. When
adding a job:
- Define the function in this file (or import from a service).
- Add to `JOB_REGISTRY` at the bottom.
- Use the existing logger (`logger.info` / `logger.error`) with
  `{ jobName: 'your_job' }`.
- Wrap per-product loops in try/catch — one product's failure should
  not abort the rest.

### 5. Migrations — `src/db/migrations/`

Numbered, run in lexical order, idempotent (`IF NOT EXISTS`). The
runner swallows "duplicate column" and "already exists" errors but
nothing else. Migration 007 has a pre-existing benign issue that trips
on in-memory SQLite — **tests do not call `runMigrations()`**; they
call `executeRaw()` with the minimum schema each test needs. See
`tests/unit/destination.test.ts:setupSchema()` for the canonical
pattern.

## Conventions

### TypeScript
- Strict mode. `noImplicitAny`, `strictNullChecks` on.
- Imports use `.js` extension on TS source (NodeNext module resolution).
- Don't reach for `as any`. The codebase has 36 of them; we're not
  proud of any.

### File headers
Every service file starts with a banner:
```ts
// =============================================================================
// FOUNDRY — <Module Name>
// <one-line purpose>
// =============================================================================
```

### Tests
- Unit tests use Vitest. Run a single test: `npx vitest run <path>`.
- Don't call `runMigrations()` in tests. Apply the minimum schema each
  test needs via `executeRaw()`.
- Mock `callSonnet`/`callOpus` at module level when testing services
  that hit the AI client. See `tests/unit/voice-gate.test.ts` for the
  pattern (`vi.mock` before the import of the service under test).
- `npm run test:ci` must be 100% pass before commit. No `--no-verify`.

### Commits
Format: `type(scope): subject — optional context`. Examples:
- `feat(outbound): tool gateway with four pre-flight checks — V3.1 Layer C`
- `fix(landing): align with shipped reality`
- `docs(operations): three runbooks for incidents that will recur`

Body explains the change in past tense. List files touched by purpose,
not exhaustively. Always include test count delta when tests changed.

## The "don't touch without asking" list

| Area | Why |
|------|-----|
| Agent names (atlas/compass/...) | Load-bearing in DB and prompts. |
| Migration 007 | Has a known issue; touching it cascades. |
| `src/services/scp/briefing.ts` content rules | The output shape is read by mobile, voice, dashboard, email. |
| Stripe webhook handler in `src/index.ts` | Tier mapping, payment state. Wrong fix here charges or refunds real customers. |
| `audit_log` schema | Compliance + V3.1 gateway depends on it. |
| `agent_instances.status` semantics | The kill-switch reads this; renaming a status value silently breaks the gateway. |

## Where to put new things

- **New service**: `src/services/<domain>/<name>.ts`. File header banner
  per convention. Tests in `tests/unit/<name>.test.ts`.
- **New migration**: next sequential number under `src/db/migrations/`.
  Idempotent SQL. Add to `tests/unit/<feature>.test.ts:setupSchema()` if
  the test needs it.
- **New cron job**: `src/jobs/index.ts`. Function + registry entry.
- **New runbook**: `docs/operations/runbooks/<scenario>.md`. See the
  README in that directory for the template.

## Architecture history (where to read more)

The audit trail is dense and worth knowing:

- `docs/architecture/FOUNDRY_V3_SYNTHESIS_FROM_REPO.md` — V3 reading of
  the existing repo against the proposed mega-prompt.
- `docs/architecture/FOUNDRY_V3_1_BUILD_PLAN_SPECIFICS.md` — what V3.1
  did and why.
- `docs/architecture/FOUNDRY_V3_1_STATUS.md` — end-of-build status of
  V3.1 (migrations 060–068, voice gate, tool gateway, etc.).
- `docs/audits/reality-check.md` — load-bearing reality check; the
  difference between landing-page promise and shipped reality.
- `docs/audits/elite-persona-review-2026-05-08.md` — 18-persona
  push-forward review; current top of the queue.

The fleet/control-plane / multi-tenant docs in `docs/audits/v3/`,
`docs/audits/v4/`, and `docs/scp/fleet-agents/` are real architecture
work but describe code that **is not built**. Treat them as roadmap,
not source of truth.
