# Deployment baseline — reconstructed 2026-09-07

Reconstructed from the running Fly.io app, its machine, its volume, its database, and the Git history of the commit it reports. Nothing here is inferred from repository configuration alone.

## What is reachable

| Fact | Value | Source |
|---|---|---|
| App | `foundry-intel`, org `thmsnrtn-gmail-com`, region `iad`, hostname `foundry-intel.fly.dev` | Fly Machines API `GET /v1/apps/foundry-intel` |
| Machines | **one**, `8ed91e5c723648`, process group `app`, `PROCESS_ROLE=all` (web and scheduler in one process), 1 shared CPU, 1024 MB | `GET /v1/apps/foundry-intel/machines` |
| Release | v106, 2026-09-06 23:32 UTC, by thmsnrtn@gmail.com; v100–v106 all between Sep 4 and Sep 6 | Fly GraphQL `releases` |
| Image | `registry.fly.io/foundry-intel:deployment-01M1WGYGQA5W1KSA2GHA6Q4K3E`, labels `GH_REPO=Thmsnrtn/foundry`, `GH_EVENT_NAME=push`, `GH_SHA=437505b062b02e8368c40a02315e237e699fbf07` | machine `image_ref.labels` |
| Running commit | `437505b0` ("The map may not invent the territory", 2026-09-06 22:19 UTC) | `GET /internal/health` → `commit`, and `FOUNDRY_COMMIT` in the machine environment |
| Branch of that commit | tip of `claude/private-foundry-continuation-51vz95`; also contained in `claude/foundry-next-frontier-h2fsqe` (3 commits further, undeployed, dated 2026-09-07) | `git branch -r --contains` |
| Database | `TURSO_DATABASE_URL=file:/data/foundry.db` — a local SQLite file on Fly volume `vol_r1j5m8y52p0oq2pr` (`foundry_data`, 1 GB, encrypted), 6.7 MB | machine env + mounts, `ls /data` via machine exec |
| Backups | `/data/backups/foundry-2026-09-05.db`, `-09-06.db`, `-09-07.db` (daily, made by the running app) | machine exec |
| Migration state | 316 rows in `schema_migrations`; latest `280_a_claim_of_restriction_the_world_does_not_honour.sql`, applied 2026-09-06 04:12 | machine exec, libSQL query |
| Migrations shipped in the image | `/app/src/db/migrations` ends at 280 | machine exec |
| Data | one founder (the owner), three products: `Foundry`, `Tallow Reference Co`, `Northgate Reference Co`; zero integrations | machine exec |
| Secrets present | `APP_URL`, `CLERK_PUBLISHABLE_KEY`, `CLERK_SECRET_KEY`, `ANTHROPIC_API_KEY`, `OPENROUTER_API_KEY`, `RESEND_API_KEY`, `RESEND_FROM_ADDRESS` (`foundry@foundry-intel.fly.dev`), `STRIPE_SECRET_KEY`, five `STRIPE_*_PRICE_ID`, `ENCRYPTION_KEY` | `GET /v1/apps/foundry-intel/secrets` (names only) |
| Secrets absent | `STRIPE_WEBHOOK_SECRET`, `FOUNDRY_ENABLE_MONEY_TOOLS`, `FOUNDRY_INSTITUTION_SCOPE_ID` | same |
| Health | `{"status":"ok","checks":{database,ai_configured,clerk_configured,scheduler}:"ok","storage":"volume"}` | `curl https://foundry-intel.fly.dev/internal/health` |
| Staging | `foundry-staging` does not exist | `flyctl status -a foundry-staging` |
| Deploy credential in this environment | `FLY_API_TOKEN` is set; `flyctl auth whoami` resolves to a token identity in the owner's org; the Machines API accepts it for read, exec, and secrets listing | this session |

## How production is deployed

Production is **not** built from `master` and **not** from the River branch. It is built by a GitHub Actions workflow that exists only on the campaign branch: `.github/workflows/deploy-private.yml` on `claude/private-foundry-continuation-51vz95`. It triggers on pushes to exactly two named branches (`claude/foundry-autonomous-continuation-0gents`, `claude/private-foundry-continuation-51vz95`), runs the full check chain first, and deploys only when the head commit message contains `[deploy-private]`. It runs `flyctl deploy --config fly.private.toml --app foundry-intel --local-only --ha=false --build-arg FOUNDRY_COMMIT=<sha> --now`, then polls `/internal/health` until the reported commit equals the pushed SHA.

`fly.private.toml` (one machine, `PROCESS_ROLE=all`, volume-backed SQLite, no HA) is the effective configuration. The `fly.toml` on `master` and on this branch (two web machines plus a worker, no volume) describes a topology that is **not** what runs.

Migrations run at process start (`runMigrations()` in `src/index.ts`) against the volume file. There is no separate migration step. A rolling deploy with one machine means a short outage while the new machine boots and migrates.

## The lineage fork

| | `master` | River branch (this) | Campaign branch (production) |
|---|---|---|---|
| Tip | `abfe96c0` (PR #6) | `c9baf28` | `437505b0` (frontier: `402b1f99`) |
| Commits past `abfe96c0` | 0 | 5 | 837 (frontier: 840) |
| Migrations | 158 files, highest 122 | 160 files, highest **124** (`123_economic_probes`, `124_probe_operations`) | 316 files, highest **280**; its own `123_canonical_system_identity` and `124_judgment_production_identity` |
| Institutional line | Adaptive Company Institution through development Assisting | + River constitution, economic probes, Proof 1 machinery, owner surfaces below | + 158 migrations: revocable authority, inbound customer messages, effect kinds and outcome reports, company senses, venture experiments with provider settlement (`experiment_exposures`, "the world settles the experiment"), workshop, owner screens |
| Owner governance | — | this session's three directions | `OWNER_DECISIONS_PENDING.md`: ten owner-answered decisions; a "campaign steward" reviews tranches before merge |

**The River branch's migrations are not compatible with production history as they stand.** Production has already applied its own 123 and 124 under different filenames; migration numbers would collide (the campaign's `check-migration-order.mjs` refuses new duplicates); River's 124 drops and recreates `assisted_action_plan_guard`, which the campaign already replaced (its migration 173 "no outbound action is born approved" would also refuse River's offer plans, which are inserted approved by the owner's grant); and the campaign's authority tables have moved (133 revocable authority). A Git merge of this branch into the frontier tip conflicts in only 11 files (`git merge-tree`), all docs, the schema snapshot, `jobs/index.ts`, `letter.ts`, `clerk.ts`, `welcome-sequence.ts`, `slo.ts` and one test; the semantic port is the real work: renumber River's two migrations to 281–282 and rewrite them against the campaign's guards.

**Deploying this branch to `foundry-intel` as it stands would be wrong in both directions:** the code would boot against a schema it does not know (158 migrations it never saw, whose triggers would refuse its writes), and the campaign line the owner has been governing would be abandoned without a decision.

## Rollback

- A new Fly release can be rolled back by redeploying the previous image tag (`flyctl deploy --image registry.fly.io/foundry-intel:deployment-01M1WGYGQA5W1KSA2GHA6Q4K3E`), which restores the code but not the database.
- The database has daily copies on the same volume (`/data/backups/`). Schema changes are additive migrations; a code rollback after a migration is safe only when the older code tolerates the newer schema. Before any deploy that migrates, copy the live file first (`cp /data/foundry.db /data/backups/pre-deploy-<sha>.db` via machine exec).
- Fly volume snapshots: `snapshot_retention = 14` in `fly.private.toml`.

## The cutover (Option A, owner decision 2026-09-08)

The owner chose Option A: the campaign/frontier lineage is Foundry. This branch (`claude/foundry-river-constitution-rvd0mx`) was reset to the frontier tip `402b1f99` and the River work was ported onto it as a semantic reconciliation (`docs/foundry-institution/history/RIVER_PORT_RECONCILIATION.md`): one migration, 284, nothing in 1–283 changed. The River line's own history is kept at the tag `river-line`.

Steps, in order, each recorded here as it was done:

1. Full chain green on the ported tree (`npm run check`), the mobile gate green with the experiment pages, the adversarial review recorded (`history/TRANCHE_ADVERSARIAL_REVIEW_2026-09-08.md`).
2. Pre-deploy database copy on the machine, done 2026-09-08 03:38 UTC: `/data/backups/pre-deploy-river-port-from-437505b0.db` (6,701,056 bytes, the live file at that moment, while v106 / `437505b0` was still running), verified by `ls -la /data/backups` through the Machines API exec.
3. Push the reconciled tree to the designated branch, then fast-forward `claude/private-foundry-continuation-51vz95` to the same commit with `[deploy-private]` in the head commit message. The workflow runs the chain again on the runner and deploys only if it is green.
4. `GET /internal/health` reports `commit` equal to the deployed SHA; `schema_migrations` on the machine ends at 284; `experiment:seed-proof1` run once on the machine for the owner; `experiment:status` shows the test in "Needs you".
5. Smoke test at `foundry-intel.fly.dev`, mobile width, without sending anything: recorded below.

## Rollback

- Code: `flyctl deploy --image registry.fly.io/foundry-intel:deployment-01M1WGYGQA5W1KSA2GHA6Q4K3E` restores the v106 image (commit `437505b0`).
- Database: `/data/backups/pre-deploy-river-port-from-437505b0.db` is the exact file before this deploy migrated it. Migration 284 is additive (new tables, new columns with defaults, new vocabulary rows); the older code tolerates the newer schema, so a code rollback without a database restore is safe. Restoring the file is `cp` back over `/data/foundry.db` with the app stopped.
- Fly volume snapshots: `snapshot_retention = 14` in `fly.private.toml`.

## Verification record

Filled in as each step completed; see the end of this file.
