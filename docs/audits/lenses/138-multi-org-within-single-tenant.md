# Lens 138 — Multi-Org Within Single Tenant

**Auditor perspective:** Edge-case hunter / domain adversary — can a founder have multiple organizations? What if they try?
**Distinct-value declaration:** Tests the assumption that one Clerk user = one founder = one billing entity. Examines what happens when a single person has multiple Clerk accounts, or when multiple people share one subscription.
**Tenancy-critical:** Yes. The founder-product ownership model is the foundation of tenant isolation.

**Date:** 2026-04-16
**Repo:** foundry (Hono + Turso + Clerk + Anthropic)

---

## Summary

| Severity | Count |
|----------|-------|
| P2 | 3 |
| P3 | 2 |

---

## Data Model

```
founders
  id (nanoid)
  clerk_user_id (unique)
  email
  stripe_customer_id
  tier

products
  id (nanoid)
  owner_id -> founders.id
  name, github_repo, etc.
```

The model assumes: 1 Clerk user -> 1 founder -> 1 Stripe customer -> 1 tier -> N products.

---

## MO-01. A person can create multiple Clerk accounts with different emails

**Severity: P2**

Clerk allows sign-up with different email addresses. A single person could create:
- `alice@company.com` -> Founder A (Solo, $79/mo) -> Product 1
- `alice@gmail.com` -> Founder B (Solo, $79/mo) -> Product 2

Each gets independent billing, independent product limits, and independent AI cost ceilings. The system has no way to detect this is the same person.

**Impact:** Product limit bypass -- a Solo founder with 1 product limit creates a second account for a second product. They pay $158/mo instead of $199/mo (Growth) for 2 products.

**Evidence:**
- `src/routes/auth/clerk.ts:159-193`: Founder creation keyed on `clerk_user_id`, not email
- No email domain deduplication or identity linking

---

## MO-02. No concept of "organization" or "team" for shared access

**Severity: P2**

The data model has `team_members` and `team_invites` tables (added by migration), but the team layer grants read-only access to specific product pages. There is no concept of a shared organization where multiple founders co-own products.

If Alice and Bob are co-founders, they must pick one person to be "the founder" who owns all products. The other has no direct access unless invited as a team member.

**Implications:**
- Co-founders cannot independently approve decisions
- Team members cannot trigger audits or run agents
- If the primary founder's account is deleted, all products are deleted (Clerk `user.deleted` webhook)

**Evidence:**
- `src/services/team/members.ts`: Team members have limited permissions
- Product ownership is `products.owner_id` -- single owner, no shared ownership
- No `organizations` table or Clerk Organization integration

---

## MO-03. A founder's email change in Clerk does not propagate to Foundry

**Severity: P2**
**Files:** `src/routes/auth/clerk.ts:100-197`

The Clerk webhook handler processes `user.created` and `user.deleted` events. There is no handler for `user.updated`. If a founder changes their email in Clerk:
1. The `founders.email` column retains the old email
2. Digest emails go to the old address
3. Portfolio ownership checks use `owner_email` -- may fail if email changed
4. Stripe customer email may differ from Foundry's stored email

**Evidence:**
- `src/routes/auth/clerk.ts:100-197`: Only handles `user.created` and `user.deleted`
- No `user.updated` handler
- `founders.email` is set at creation and never updated

---

## MO-04. Stripe customer ID is created at founder provision time -- no re-linking on account merge

**Severity: P3**

If a person has two Clerk accounts and later wants to merge them, there is no mechanism to:
- Transfer products from Founder A to Founder B
- Merge two Stripe customer IDs
- Re-link billing subscriptions

**Evidence:**
- No product transfer API or admin endpoint
- No `TRANSFER` or `MERGE` handler in any route

---

## MO-05. Portfolio `owner_email` uses email, not founder ID -- fragile linkage

**Severity: P3**
**Files:** `src/services/portfolio/manager.ts:35`

Portfolios are created with `owner_email` from the founder's session. Ownership is verified by `WHERE owner_email = ?`. If the founder's email changes (in Clerk), they lose access to their portfolios.

The rest of the system uses `founder.id` for ownership. The portfolio layer using email is an inconsistency.

---

## Recommendations

1. **Handle `user.updated` Clerk webhook** -- Update `founders.email` and `founders.name` when Clerk fires this event.
2. **Consider Clerk Organizations** -- For co-founder scenarios, integrate Clerk's Organization feature to support shared product ownership.
3. **Use `founder.id` for portfolio ownership** -- Replace `owner_email` with `owner_founder_id` for consistent ownership verification.
4. **Add product transfer capability** -- An admin or API endpoint that transfers a product from one founder to another, updating `owner_id` and re-provisioning SCP.
5. **Add email uniqueness check** -- At founder creation, check if the email already exists under a different `clerk_user_id`. Surface a warning if so.
