# Lens 145 — Key Leak Recovery Drill

**Distinct value:** Walks through the step-by-step recovery procedure for each of Foundry's 4 most critical secrets being leaked: ENCRYPTION_KEY, ANTHROPIC_API_KEY, CLERK_SECRET_KEY, and STRIPE_SECRET_KEY. Evaluates blast radius, time-to-recovery, and whether the rotation procedure is actually executable today.

**Tenancy-critical:** Yes. ENCRYPTION_KEY protects per-tenant GitHub tokens. CLERK_SECRET_KEY compromises all tenant authentication. STRIPE_SECRET_KEY exposes all tenant billing data. Each leaked key affects every tenant simultaneously.

## Key 1: ENCRYPTION_KEY Leaked

### Blast Radius

The ENCRYPTION_KEY is a 32-byte AES-256-GCM key used by `src/services/encryption.ts` to encrypt sensitive tokens at rest. Currently used for:
- `products.github_access_token` — GitHub OAuth tokens for each product's repository access
- Potentially `integrations.credentials_json` — though the audit evidence shows these are currently stored in plaintext despite schema comments claiming encryption

An attacker with the ENCRYPTION_KEY and database read access can decrypt all stored GitHub access tokens. With those tokens, the attacker can:
- Read all code from every connected GitHub repository
- Write code to repositories (depending on OAuth scope)
- Access private repository metadata, issues, and pull requests
- Potentially create commits or pull requests

**Tenant impact:** Every founder with a connected GitHub repository is affected.

### Recovery Steps

1. **Revoke all existing GitHub tokens immediately.** There is no bulk revocation mechanism in Foundry. Each founder's GitHub OAuth token must be individually revoked via the GitHub API:
   ```
   DELETE https://api.github.com/applications/{client_id}/tokens/{access_token}
   ```
   This requires iterating every product with a non-null `github_access_token`, decrypting each (using the old key, which the attacker also has), and revoking via GitHub API. **There is no script for this.**

2. **Generate a new ENCRYPTION_KEY:**
   ```bash
   openssl rand -hex 32
   ```

3. **Re-encrypt all existing tokens with the new key.** The runbook says this step requires a "migration script to re-encrypt (not yet implemented)." **This script does not exist.** The recovery procedure is blocked here.

4. **Deploy the new key:**
   ```bash
   fly secrets set ENCRYPTION_KEY=new-64-char-hex-key
   ```

5. **Notify affected founders** to re-authenticate GitHub OAuth so new tokens are generated and encrypted with the new key.

6. **Rotate GITHUB_CLIENT_SECRET** as well, since the attacker may use the leaked encryption key plus database access to extract enough information to impersonate the OAuth app.

### Executable Today? NO

**Blocking issue:** The re-encryption migration script does not exist. The runbook documents this gap explicitly. Without it, rotating the ENCRYPTION_KEY makes all existing encrypted tokens unreadable. Recovery requires every founder to manually re-authenticate GitHub.

**Time-to-recovery estimate:** 2-4 hours for an engineer who understands the system. For a new on-call engineer, 4-8 hours minimum, because they must write the re-encryption script from scratch.

## Key 2: ANTHROPIC_API_KEY Leaked

### Blast Radius

The attacker can use Foundry's Anthropic API key to make Claude API calls billed to Foundry's account. There is no usage cap on the Anthropic side (beyond account-level limits). The attacker cannot access Foundry's data through this key alone -- it only grants access to the Anthropic API.

**Financial impact:** Potentially significant. Claude Opus 4.6 costs ~$15/M input tokens + $75/M output tokens. An attacker could run up thousands of dollars in charges within hours.

**Tenant impact:** Indirect. If the API key is suspended by Anthropic due to abuse, all AI features break for all tenants (see Scenario 3 in Lens 143).

### Recovery Steps

1. **Revoke the old key immediately:** Log in to console.anthropic.com, navigate to API Keys, and delete the compromised key.

2. **Generate a new key:** Create a new API key in the Anthropic console.

3. **Deploy:**
   ```bash
   fly secrets set ANTHROPIC_API_KEY=sk-ant-new-key-here
   ```
   Fly.io auto-restarts the application. Total downtime: ~30 seconds during restart.

4. **Verify:** Check health endpoint and trigger a test AI call (e.g., `npm run cli -- job:run weekly_synthesis` or test the AI Ask feature).

5. **Audit:** Review Anthropic usage dashboard for unauthorized calls between leak and rotation.

### Executable Today? YES

This is the simplest rotation. The runbook documents it correctly. Time-to-recovery: 5-10 minutes.

**One caveat:** There is no alerting for unusual Anthropic API usage. The daily cost ceiling (`AI_DAILY_COST_CEILING_CENTS`) limits per-product spend within Foundry, but does not limit direct API calls by an attacker using the raw key.

## Key 3: CLERK_SECRET_KEY Leaked

### Blast Radius

The CLERK_SECRET_KEY allows:
- Verifying and minting JWTs for any user
- Accessing the Clerk Backend API: read/write all user data, sessions, organizations
- Impersonating any founder by creating valid session tokens
- Deleting users (which triggers the `user.deleted` webhook and destroys all their Foundry data)

**Tenant impact:** Total compromise. The attacker can impersonate any founder, access any founder's dashboard, read their business intelligence, make decisions on their behalf, and delete their accounts.

### Recovery Steps

1. **Rotate immediately in Clerk Dashboard:** Go to Clerk Dashboard -> API Keys -> rotate the secret key.

2. **Deploy the new key:**
   ```bash
   fly secrets set CLERK_SECRET_KEY=sk_live_new-key CLERK_PUBLISHABLE_KEY=pk_live_new-key
   ```
   The runbook correctly documents rotating both keys together.

3. **Invalidate all existing sessions:** In Clerk Dashboard, navigate to Sessions and revoke all active sessions. This forces every founder to re-authenticate. This step is NOT in the runbook.

4. **Audit Clerk API logs:** Check for unauthorized API calls during the exposure window. Look for user creation, deletion, or session manipulation.

5. **Check for damage:**
   - Were any users deleted? Check `founders` table for missing records vs. Clerk user list.
   - Were any sessions created for unauthorized access? Check Clerk session logs.
   - Were any Foundry operations performed by an impersonator? Check `agent_audit_log` for unusual activity patterns.

6. **Rotate CLERK_WEBHOOK_SECRET** as well, since the attacker may forge webhook events.

### Executable Today? PARTIALLY

The basic rotation is documented and works. But:
- Session invalidation is not documented in the runbook
- Audit procedures for detecting unauthorized access are not documented
- There is no mechanism to detect impersonation after the fact (no IP logging, no session fingerprinting in Foundry)
- The Clerk webhook path that deletes all user data on `user.deleted` means an attacker could permanently destroy founder data before the key is rotated

**Time-to-recovery:** 10-15 minutes for key rotation. Hours for damage assessment.

## Key 4: STRIPE_SECRET_KEY Leaked

### Blast Radius

The STRIPE_SECRET_KEY allows:
- Reading all customer data (names, emails, payment methods metadata)
- Creating, modifying, and canceling subscriptions
- Issuing refunds
- Accessing payment history for all customers
- Creating charges against stored payment methods

**Tenant impact:** All paying founders are affected. The attacker can cancel subscriptions (triggering tier downgrades), issue refunds, and access billing information.

### Recovery Steps

1. **Rotate immediately in Stripe Dashboard:** Go to Developers -> API Keys -> roll the secret key. Stripe supports rolling keys (both old and new work during a transition period).

2. **Deploy the new key:**
   ```bash
   fly secrets set STRIPE_SECRET_KEY=sk_live_new-key
   ```

3. **Rotate the webhook secret:**
   ```bash
   fly secrets set STRIPE_WEBHOOK_SECRET=whsec_new-secret
   ```
   The runbook mentions this step but does not provide the Stripe Dashboard navigation path.

4. **Audit Stripe Dashboard:**
   - Check for unauthorized subscription changes (cancellations, modifications)
   - Check for unauthorized refunds
   - Check for unauthorized customer data access (Stripe logs API calls)
   - Check for new subscriptions or charges created by the attacker

5. **Remediate damage:**
   - Re-activate any cancelled subscriptions
   - Reverse unauthorized refunds
   - Update `founders.tier` in the database if webhook-driven tier changes occurred during the compromise
   - Notify affected founders

6. **Check Foundry database consistency:**
   - Compare `founders.tier` values against Stripe subscription statuses
   - Look for founders with `tier = NULL` who should have active subscriptions

### Executable Today? MOSTLY

The basic rotation is documented. Stripe's rolling key feature provides a smooth transition. But:
- Webhook secret rotation procedure is incomplete in the runbook
- No damage assessment procedure is documented
- No procedure to reconcile Foundry tier states with Stripe subscription states after unauthorized changes
- No alerting for unusual Stripe API activity

**Time-to-recovery:** 10-15 minutes for key rotation. Hours for damage assessment and reconciliation.

## Summary Table

| Key | Blast Radius | Executable Today | Time to Rotate | Time to Full Recovery |
|-----|-------------|-----------------|----------------|----------------------|
| ENCRYPTION_KEY | All GitHub tokens, all repo access | **NO** (re-encryption script missing) | Blocked | 4-8 hours (requires code) |
| ANTHROPIC_API_KEY | Financial (API abuse) | YES | 5-10 min | 5-10 min |
| CLERK_SECRET_KEY | Total auth compromise, data destruction | PARTIALLY (session invalidation undocumented) | 10-15 min | Hours (damage assessment) |
| STRIPE_SECRET_KEY | All billing data, subscription manipulation | MOSTLY (audit procedure missing) | 10-15 min | Hours (reconciliation) |

## Cross-Key Findings

| Finding | Keys Affected | Severity |
|---------|--------------|----------|
| ENCRYPTION_KEY re-encryption script does not exist | ENCRYPTION_KEY | P0 |
| No key leak detection or alerting mechanism | All | P1 |
| No session invalidation procedure documented | CLERK_SECRET_KEY | P1 |
| No damage assessment procedure for any key | All | P1 |
| No post-rotation consistency check procedure | CLERK, STRIPE | P1 |
| Clerk `user.deleted` webhook enables data destruction with leaked key | CLERK_SECRET_KEY | P0 |
| No IP logging or access audit trail in Foundry | CLERK_SECRET_KEY | P1 |
| Webhook secrets not always rotated alongside service keys | STRIPE, CLERK | P2 |

## Priority Remediation

1. **P0:** Implement the ENCRYPTION_KEY re-encryption script (`scripts/rotate-encryption-key.ts`) that reads all encrypted fields, decrypts with old key, re-encrypts with new key, and updates in a transaction
2. **P0:** Add rate limiting or confirmation step to the Clerk `user.deleted` webhook to prevent data destruction via leaked key
3. **P1:** Document complete incident response procedures for each key type, including session invalidation, damage assessment, and consistency reconciliation
4. **P1:** Add key usage monitoring: alert on unusual Anthropic spend, Stripe API patterns, and Clerk session creation
5. **P1:** Add IP logging to authentication middleware to enable post-compromise forensics
6. **P2:** Implement key rotation automation: a script that rotates keys, deploys, and verifies in one command
