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

### Verified 2026-09-08, 04:13–04:20 UTC

| Fact | Value | Source |
|---|---|---|
| Deploy | Workflow run 109 (`deploy-private.yml`, push of `8d1c5ab0` on `claude/foundry-river-constitution-rvd0mx` carrying `[deploy-private]`): the full chain on the runner, then the build and deploy; conclusion **success**, 03:38–04:13 UTC | GitHub Actions |
| Running commit | `8d1c5ab081c3887aba6c59a3ad85f2cec04e86c8` | `GET /internal/health` → `commit`; checks database, ai_configured, clerk_configured, scheduler all `ok`; `storage: volume` |
| Migration state | 320 rows in `schema_migrations`; latest `284_the_first_real_experiment_has_a_hand.sql`, applied 04:12:58 UTC; `experiment_recipients`, `experiment_materials`, `experiment_fulfilments` exist | machine exec, libSQL |
| Data | one founder (the owner); `Foundry` (earned, real, active) and the two reference companies unchanged; the owner's one earned real company is what a test will send as | machine exec |
| Proof 1 | Seeded once for the owner with the deployed code (`experiment:seed-proof1` semantics run on the machine): experiment `SkQeFRIbU9SR6oMNC3MSX`, 23 recipients pending, the brief and offer text attached, the rule sealed on the delivery, `needs_workshop = 0`. The open rehearsal search (`JCSTN2HBOgof5Sk0iEUie`, reference mode, opened 2026-09-03) was closed with the reason "superseded by the first real experiment the owner directed (Proof 1); a rehearsal search yields to a real one" and the real search opened; the seed now does the same on its own (follow-up commit, not redeployed — the effect is already in production by the same rule) | machine exec |
| `experiment:status` | **Needs you** — "11 businesses still to review; email sending is not connected"; steps recipients/sending/allow todo, placing Foundry's; Allow not possible; allowance $100.00; sender company resolved to `Foundry`; refund handling reported off; no exceptions | machine exec |
| Unauthenticated behaviour at the deployed app | `/` 200; `/foundry`, `/foundry/experiments`, the experiment page: 401 (JSON) / 302 to sign-in (HTML); POST `/foundry/experiments/…/allow` 401; the buyer's refund page with a wrong token 404 | curl |
| Pre-deploy copy | `/data/backups/pre-deploy-river-port-from-437505b0.db`, 6,701,056 bytes, 03:38 UTC | machine exec |
| Campaign branch | `claude/private-foundry-continuation-51vz95` still at `437505b0`; the lineage continues on `claude/foundry-river-constitution-rvd0mx`, listed in the workflow. It was not fast-forwarded, because a push there would trigger a second, redundant deploy of the same commit. | GitHub |

**What was not verified on the real app, and why.** The owner's own pages — Home with the test in "Waiting on you", the experiment page, the review list, Allow refused while prerequisites are unmet, Stop — need the owner's Clerk session, which this environment does not hold and must not fabricate; the environment's egress proxy also drops the browser's tunnel to `foundry-intel.fly.dev` (curl passes). Those pages are proven on the same commit by the rehearsal through the assembled routers and by the mobile gate at five phone widths (`docs/design/mobile/experiment-390.png`, `experiment-recipients-390.png`). The first person to open `/foundry` on the phone is the owner, and the page he lands on is the one in those screenshots with his own rows.

**What the owner must do to launch Proof 1** (nothing else is his):
1. Open Foundry on the phone → "a real test" under Waiting on you → **Review who may be contacted**: exclude the employer and any conflict, then "The rest are fine".
2. On the test page, **Email sending**: an address on a domain of his, his name, and the Resend API key for that domain (the provider must already show the domain verified).
3. In the deployment, `STRIPE_WEBHOOK_SECRET` for an endpoint `https://foundry-intel.fly.dev/webhooks/stripe` on the shared Stripe account (events `payment_intent.succeeded`, `checkout.session.completed`, `charge.refunded`) — without it no purchase can be received — and `FOUNDRY_ENABLE_MONEY_TOOLS=true` if refunds are to move on their own (`flyctl secrets set … -a foundry-intel`).
4. **Allow**. Foundry creates the tagged link and begins on the next hourly pass (minute 20).

Foundry's own prerequisite: the brief was pulled 2026-09-07 and the quality gate refuses it after seven days; if Allow comes later than 2026-09-14, re-pull `river/proof-1/brief.md`, run `node scripts/embed-proof-1.mjs`, and re-seed (idempotent; it refreshes the material).
