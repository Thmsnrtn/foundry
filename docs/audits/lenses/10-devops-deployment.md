# Lens 10 — DevOps / Deployment Platform Audit

**Auditor perspective:** Deployment process, Dockerfile quality, Fly.io configuration, CI/CD pipeline, environment management, build reproducibility, and operational reliability.

**Date:** 2026-04-16

---

## Summary

Foundry's deployment stack is minimally viable: a multi-stage Dockerfile, a reasonable fly.toml, and a working health check. However, there is **no CI/CD pipeline**, **no .dockerignore** (so every build sends the entire repo including `node_modules/` and the tracked SQLite database to the Docker daemon), **duplicate migration numbering** across 30 migration prefixes (potential data corruption), and a **332 KB SQLite database committed to git**. The Dockerfile ships devDependencies into the final image because it copies node_modules from the `deps` stage (which runs `npm ci --production=false`) instead of re-running `npm ci --omit=dev` for the runner stage. There are no secrets hardcoded in source, but the environment variable surface has naming mismatches between `.env.example`, `env.ts`, and `index.ts` that would confuse any new deployer.

---

## Findings

### P0 — Deployment Broken / Secrets in Code

| # | Finding | Location | Detail |
|---|---------|----------|--------|
| P0-1 | **SQLite database committed to git** | `foundry.db` (332 KB, tracked since initial commit) | A real Turso/SQLite database file is version-controlled. It will be copied into every Docker build (no `.dockerignore`), may contain user data or schema state that conflicts with migration expectations, and inflates the repo. Must be added to `.gitignore` and removed from tracking. |
| P0-2 | **30 duplicate migration number prefixes** | `src/db/migrations/` — prefixes 004 through 033 each have 2 files | 84 migration files but only 54 unique numbers. The migration runner sorts alphabetically, so `004_sector_profiles.sql` runs before `004_signal_wisdom.sql`, but the order is fragile and developer-dependent. If a migration assumes a table from its counterpart with the same number, the order is non-deterministic across platforms (locale-dependent sort). This is a latent data-corruption vector. |
| P0-3 | **Migration failure does not stop the server** | `src/index.ts:503-510` | If `runMigrations()` throws, the catch block logs the error and starts the server anyway: `"Don't exit — migrations may have partially succeeded."` A server running with an inconsistent schema can silently corrupt data or crash unpredictably on the first query that hits a missing table/column. |

### P1 — Poor Dockerfile / Missing CI / Non-Reproducible Build

| # | Finding | Location | Detail |
|---|---------|----------|--------|
| P1-1 | **No `.dockerignore` file** | Project root | Every `COPY . .` in the builder stage sends `node_modules/` (135 MB), `dist/`, `.git/`, `foundry.db`, test files, iOS source, and docs to the Docker daemon. This bloats build context, slows builds, and risks leaking `.env` into the image if one exists locally. |
| P1-2 | **DevDependencies shipped to production image** | `Dockerfile:14` — `COPY --from=deps /app/node_modules ./node_modules` | The `deps` stage installs with `--production=false` (all deps). The `runner` stage copies these same node_modules verbatim. DevDependencies (`tsx`, `vitest`, `typescript`, `tsc-alias`, `@types/node`) are present in the production image, adding ~30 MB+ of unnecessary weight and attack surface. The runner stage should run `npm ci --omit=dev` separately or prune. |
| P1-3 | **No CI/CD pipeline** | `.github/workflows/` does not exist | No GitHub Actions, no automated tests, no type checking, no linting on push/PR. Every deployment is a manual `fly deploy`. There is no gate between a push and production. |
| P1-4 | **Source maps and declaration maps shipped to production** | `tsconfig.json:17-18` | `sourceMap: true` and `declarationMap: true` mean `.js.map` and `.d.ts.map` files are generated in `dist/` and copied to the production image. Source maps expose internal code structure if served, and add unnecessary image size. |
| P1-5 | **Environment variable naming mismatch across files** | `.env.example` vs `env.ts` vs `index.ts` | `.env.example` lists `STRIPE_SOLO_PRICE_ID`, `STRIPE_GROWTH_PRICE_ID`, `STRIPE_INVESTOR_READY_PRICE_ID`. But `env.ts` lists `STRIPE_FOUNDING_COHORT_PRICE_ID`, `STRIPE_GROWTH_PRICE_ID`, `STRIPE_SCALE_PRICE_ID`. And `index.ts:142-153` has yet another list requiring `STRIPE_SOLO_PRICE_ID`, `STRIPE_GROWTH_PRICE_ID`, `STRIPE_INVESTOR_READY_PRICE_ID`. There are three different naming conventions for the same tier. A new deployer following `.env.example` would set variables that `env.ts` doesn't validate, while `index.ts` silently warns about different ones. |
| P1-6 | **Duplicate startup environment validation** | `env.ts` + `index.ts:142-158` | `validateEnvironment()` is called at line 11, then `index.ts:142-158` does a second, contradictory check with a different variable list. The second check only `console.warn`s (does not exit), so its "required" vars are actually optional. Confusing and duplicative. |
| P1-7 | **In-memory rate limiting does not survive restarts** | `src/middleware/rate-limit.ts` | Rate limit state is a `Map` in process memory. On Fly.io with `min_machines_running: 1` and `auto_start_machines: true`, any scale-up or restart resets all rate limit counters. Not a real rate limiter in production. |

### P2 — Moderate / Operational Concerns

| # | Finding | Location | Detail |
|---|---------|----------|--------|
| P2-1 | **No graceful shutdown handler** | `src/index.ts` | No `SIGTERM`/`SIGINT` handler. The `fly.toml` sends `SIGINT` with a 5-second `kill_timeout`, but the Node process has no handler to drain in-flight requests, stop cron jobs, or close the database connection. Hono's `serve()` doesn't automatically handle signals. |
| P2-2 | **Health check is shallow** | `src/routes/internal/health.ts` | Returns `{ status: 'ok' }` without checking database connectivity, critical env vars, or cron scheduler health. Fly.io will consider the app healthy even if the database is unreachable. |
| P2-3 | **CORS defaults to localhost in production** | `src/index.ts:167` | `origin: process.env.APP_URL ?? 'http://localhost:8080'`. If `APP_URL` is not set (it's marked optional in `env.ts`), production CORS allows `http://localhost:8080` as origin. |
| P2-4 | **Cron jobs only run in production** | `src/index.ts:493` | `if (process.env.NODE_ENV === 'production') startScheduler()`. No way to test or trigger scheduled jobs in development/staging without changing `NODE_ENV`. The CLI can run individual jobs, but the scheduler itself is untestable locally. |
| P2-5 | **No lockfile integrity check** | `Dockerfile:6` | `npm ci` validates the lockfile, which is good. But there's no `npm audit` step, no dependency scanning, and no Snyk/Trivy layer. |
| P2-6 | **Static file serving uses synchronous `readFileSync`** | `src/index.ts:179-195` | Every static file request blocks the event loop with `readFileSync`. Under load, this will degrade all concurrent request handling. |
| P2-7 | **No build versioning / no `APP_VERSION`** | `Dockerfile`, `fly.toml` | The health check returns hardcoded `version: '0.1.0'`. There's no git SHA or build timestamp injected at build time, making it impossible to verify which commit is deployed. |
| P2-8 | **VM undersized for workload** | `fly.toml:32-35` | `shared-cpu-2x` with 1 CPU and 1 GB RAM, running 26 cron jobs (many invoking Claude API), a web server, and migration runner. AI-heavy cron jobs will cause memory pressure and CPU starvation for web requests since everything runs in-process. |
| P2-9 | **`kill_timeout` too short** | `fly.toml:4` | 5-second kill timeout. If a cron job is mid-execution calling Claude API (which has no timeout configured), the process will be force-killed, potentially leaving database state inconsistent. Should be 30s minimum. |
| P2-10 | **No staging/preview environment** | Entire project | Single `fly.toml` targets `foundry-intel` in `iad`. No staging app, no PR previews, no way to test database migrations before production. |

### P3 — Minor / Improvement Opportunities

| # | Finding | Location | Detail |
|---|---------|----------|--------|
| P3-1 | **`node:20-slim` is not pinned to a specific digest** | `Dockerfile:1` | Using `node:20-slim` means builds are not reproducible; the base image can change between builds. Pin to a specific version (e.g., `node:20.12-slim`) or a digest. |
| P3-2 | **No `USER` directive in Dockerfile** | `Dockerfile` | Container runs as root. Should add `RUN adduser --system --uid 1001 foundry` and `USER foundry` before `CMD`. |
| P3-3 | **`package-lock.json*` wildcard in COPY** | `Dockerfile:6` | The `*` glob means the build succeeds even if `package-lock.json` is missing, defeating the purpose of `npm ci`. Should be `COPY package.json package-lock.json ./` without the glob. |
| P3-4 | **No multi-region deployment** | `fly.toml:2` | Only `iad` (Ashburn). For a SaaS serving global founders, consider adding secondary regions or at minimum documenting the single-region choice. |
| P3-5 | **`main` field in package.json is wrong** | `package.json:39` | `"main": "index.js"` — should be `"dist/index.js"` or removed entirely since this is an application, not a library. |
| P3-6 | **No `npm run lint` or `npm run format` scripts** | `package.json` | No ESLint, no Prettier. Code style is enforced by convention only. |

---

## Deployment Walkthrough: Can a New Developer Deploy in <30 Minutes?

**Verdict: No. Estimated time: 60-90 minutes, assuming no blockers.**

| Step | Blocker? | Detail |
|------|----------|--------|
| Clone repo | No | Standard git clone. |
| Copy `.env.example` to `.env` | **Yes** | Env var names don't match between `.env.example`, `env.ts`, and `index.ts`. Developer must cross-reference three files to figure out the real required set. `STRIPE_FOUNDING_COHORT_PRICE_ID` appears in `env.ts` but not `.env.example`. `STRIPE_SOLO_PRICE_ID` appears in `.env.example` and `index.ts` but not `env.ts`. |
| Provision Turso database | Partial | Instructions in `.env.example` are adequate, but there's no seed script documented. `npm run seed` exists but isn't mentioned in README. |
| Set up Clerk | Partial | Need to configure OAuth callback URLs. Not documented which redirect URLs to set. |
| Set up Stripe products | **Yes** | Need to create 3 Stripe products/prices, but the tier names/amounts disagree between `.env.example` (Solo/Growth/Investor-Ready) and `env.ts` (Founding Cohort/Growth/Scale). |
| Run migrations | Partial | `npm run migrate` works, but 30 duplicate migration numbers create non-deterministic ordering. |
| Build and start | No | `npm run build && npm start` works. |
| Deploy to Fly.io | Partial | `fly launch` / `fly deploy` should work, but no documentation on required `fly secrets set` commands. |

---

## Architecture Diagram (Deployment)

```
Developer Machine
  |
  | fly deploy (manual, no CI)
  v
Fly.io Builder (no .dockerignore)
  |
  | Multi-stage Docker build
  | - deps: npm ci --production=false (all deps)
  | - builder: tsc + tsc-alias + cp public
  | - runner: node:20-slim + ALL node_modules + dist + migrations + public
  v
Fly.io Machine (shared-cpu-2x, 1GB RAM, iad)
  |
  |-- runMigrations() [startup, failure = warn + continue]
  |-- ensureProvisioned() [SCP for all products, failure = warn + continue]
  |-- startScheduler() [26 cron jobs, production only]
  |-- serve(app, 8080)
  |     |-- /internal/health [shallow, no DB check]
  |     |-- all routes
  |     +-- static files [sync readFileSync]
  |
  |-- External: Turso (DB), Clerk (auth), Anthropic (AI), Stripe (billing),
  |             Resend (email), GitHub (OAuth + analysis)
  |   [No retry, no circuit breaker, no timeout on ANY external call]
  |
  +-- No graceful shutdown handler
      kill_signal=SIGINT, kill_timeout=5s
```

---

## Recommended Fixes by Priority

### Immediate (P0)

1. **Remove `foundry.db` from git tracking** — `git rm --cached foundry.db` and add `*.db` to `.gitignore`.
2. **Renumber all migrations to be unique** — Audit the 84 files, assign sequential unique prefixes, and verify the dependency graph between them.
3. **Fail server on migration error** — Remove the catch block in `index.ts:503-510` that starts the server after migration failure. Or at minimum, set a degraded health status.

### Short-term (P1)

4. **Add `.dockerignore`** — At minimum: `node_modules/`, `dist/`, `.git/`, `.env*`, `*.db`, `tests/`, `ios/`, `docs/`, `mockups/`, `coverage/`.
5. **Fix Dockerfile runner stage** — Either add a separate `npm ci --omit=dev` in the runner stage, or use `npm prune --production` after copying from deps. Remove source maps from production build.
6. **Add basic CI pipeline** — GitHub Actions workflow: typecheck, test, build, deploy-on-main. Even `npm run typecheck && npm test && npm run build` as a gate.
7. **Unify environment variable names** — Pick one naming convention (Solo/Growth/Investor-Ready or Founding-Cohort/Growth/Scale) and make `.env.example`, `env.ts`, and `index.ts` agree.
8. **Remove duplicate env validation** — Single source of truth in `env.ts`, delete the manual check in `index.ts:142-158`.

### Medium-term (P2)

9. **Add graceful shutdown** — Handle `SIGTERM`/`SIGINT`, drain HTTP connections, stop cron jobs, close DB.
10. **Deep health check** — Query the database, verify critical env vars are set, report cron scheduler status.
11. **Inject build version** — Pass git SHA as a build arg in Dockerfile, expose in health check.
12. **Increase kill_timeout** — Set to 30s in `fly.toml` to allow in-flight requests and cron jobs to complete.
13. **Add staging environment** — Second Fly app (`foundry-intel-staging`) with its own Turso database.
14. **Run container as non-root** — Add `USER` directive to Dockerfile.
15. **Pin Node.js base image** — Use `node:20.12-slim` or a digest.

---

## Files Examined

- `/Users/user/foundry/Dockerfile`
- `/Users/user/foundry/fly.toml`
- `/Users/user/foundry/package.json`
- `/Users/user/foundry/tsconfig.json`
- `/Users/user/foundry/.env.example`
- `/Users/user/foundry/.gitignore`
- `/Users/user/foundry/src/env.ts`
- `/Users/user/foundry/src/index.ts`
- `/Users/user/foundry/src/db/client.ts`
- `/Users/user/foundry/src/db/migrate.ts`
- `/Users/user/foundry/src/routes/internal/health.ts`
- `/Users/user/foundry/src/middleware/rate-limit.ts`
- `/Users/user/foundry/src/jobs/index.ts`
- `/Users/user/foundry/vitest.config.ts`
- `/Users/user/foundry/src/db/migrations/` (84 files)
