# User-walkthrough simulation — findings

A simulation harness (`tests/simulation/walkthrough.ts`, run with
`npm run sim:walkthrough`) boots the **real route handlers** against an
in-memory database (real migrations, stubbed auth) and drives **15 personas**
through the actual UI — 101 requests across public pages, dashboard, decisions,
fleet, settings, briefings, integrations, onboarding, founder-ops, plus an
adversarial cross-tenant probe.

It caught **5 real bugs, 3 launch-critical**, all now fixed. Final run: **0
schema mismatches, 0 5xx, tenant isolation held.** The harness exits non-zero on
any finding, so it doubles as a pre-deploy gate.

## Personas driven
new signup (no product) · no-code (no audit) · happy path · active trial ·
expired trial · paid solo/growth/investor · multi-product · abandoned
onboarding · pending decisions · founder-ops admin · logged-out · adversarial
cross-tenant.

## Bugs found & fixed

1. **🔴 Dashboard crashed for every new founder.**
   `signal.ts:183` guarded MRR data with `healthRatio !== null`, which lets
   `undefined` through — and a brand-new founder (product, no metrics) has
   `undefined`, so `.toFixed()` threw and the **core dashboard 500'd**. Every
   product-having persona hit it. Fixed with a loose `!= null` guard.

2. **🔴 First paying customer could never be tiered (money).**
   `founders.tier` still carried the stale CHECK `('founding_cohort','growth',
   'scale')` from migration 001, but the code writes `('solo','growth',
   'investor_ready')`. Migration 059 fixed *values* but not the constraint. On
   any real DB, the Stripe webhook's `UPDATE founders SET tier='solo'` fails the
   CHECK — a paid customer stays gated as unpaid. Fixed by rebuilding the table
   without the CHECK (migration 080, all 21 columns + UNIQUE keys preserved).

3. **🔴 `GET /onboarding` 500'd wherever FKs are enforced.**
   `oauth_states.product_id` was `NOT NULL REFERENCES products(id)`, but GitHub
   onboarding creates the state **before** a product exists (`product_id=
   'pending'`), violating the FK — 500ing the flagship first screen. Fixed by
   rebuilding the transient table with a nullable, unconstrained `product_id`
   (migration 079).

4. **🟡 `POST /onboarding/run-audit` 500'd on a malformed body** ("undefined
   passed to database") instead of a clean 400. Added input validation.

5. **🟢 Tenant isolation — verified, not broken.** A growth-tier attacker
   requesting another founder's decision and product DNA correctly got 404 for
   both. (An earlier false positive was the tier-gate *upgrade preview*, which
   shows no data.)

## Round 2 — POST / mutation flows

Extended the sim with mutation flows (create-product, resolve-decision, save-DNA,
connect/disconnect integration, checkout) plus **post-condition assertions** (the
write actually happened; cross-tenant writes are blocked). 109 requests total.
Two more real bugs, one launch-critical:

6. **🔴 Connecting any integration 500'd.** `connectIntegration` writes the
   direction (`'inbound'/'outbound'/'bidirectional'`) to `integrations.type`, but
   that column's CHECK only allowed provider names (`'stripe','posthog',…`) — the
   2.4 dual-subsystem conflict. So integrations (a Growth-tier feature) could
   never connect. The implicit `UNIQUE(product_id, type)` would also collide the
   moment a founder connected two same-direction integrations. Migration 081
   rebuilds `integrations` dropping the `type`/`status` CHECKs and re-keying
   uniqueness on `(product_id, name)` — what the fabric actually uses. The sim
   now asserts the row lands with `status='active'`.

7. **🟡 Checkout 500'd on a Stripe failure** instead of degrading. `POST
   /checkout` called Stripe without a try/catch, so an outage/bad-key 500'd the
   founder mid-upgrade. Now redirects to `/settings?checkout=error`.

Post-condition assertions that PASSED (verifying real behavior, not just "no
5xx"): product row created; decision moved to `approved`; a cross-tenant resolve
attempt did **not** overwrite the decision; integration landed `active`.

## Caveat

This exercises the **rendered + mutation route/DB/tenant surface** — where most
"stranger" gaps live — but not flows that require live external services
(the audit's GitHub+AI calls, real Stripe checkout redirect, Clerk JWT
verification). Those still need the staging walkthrough in
`GO-LIVE-CHECKLIST.md §1–2`. Run `npm run sim:walkthrough` before every deploy.
