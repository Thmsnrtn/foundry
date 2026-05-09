# Runbook — Stripe webhook backlog

> Trigger: Stripe Dashboard shows webhooks failing to deliver, or
> founders report subscription/tier changes not reflecting in Foundry.

## 1. Detection

### Signals
- **Stripe Dashboard → Developers → Webhooks** shows >0 failed deliveries
  on the Foundry endpoint.
- A founder pays / cancels but their tier on Foundry doesn't change.
- `webhook_idempotency` table is not advancing despite known Stripe
  activity.

### Quick verification
```sql
SELECT event_type, MAX(created_at) AS last_seen
  FROM webhook_idempotency
 GROUP BY event_type
 ORDER BY last_seen DESC;
```
If `last_seen` for `customer.subscription.updated` or
`invoice.payment_succeeded` is older than expected, the listener is
behind.

## 2. Mitigation

### A. The endpoint is reachable but failing

1. **Check signature verification**. The handler in `src/index.ts` (Stripe
   webhook section) verifies `STRIPE_WEBHOOK_SECRET`. If the secret was
   rotated and not redeployed, every event 400s.
   ```bash
   fly secrets list | grep STRIPE_WEBHOOK_SECRET
   # If missing or stale, rotate in Stripe dashboard → re-set in Fly:
   fly secrets set STRIPE_WEBHOOK_SECRET=whsec_...
   ```

2. **Check error logs**:
   ```bash
   fly logs --since 1h | grep -i stripe
   ```
   Common patterns: `signature mismatch`, `unknown product`, `tier
   mapping not found`.

3. **Replay failed events** from Stripe Dashboard → Webhooks → click the
   endpoint → failed events → "Resend". The `webhook_idempotency` table
   will dedup retries; safe to replay.

### B. The endpoint is unreachable

1. **Check Fly health**:
   ```bash
   curl https://foundry-intel.fly.dev/internal/health
   fly status
   ```

2. If the app is down, deploy the last-known-good revision:
   ```bash
   fly releases
   fly deploy --image registry.fly.io/foundry-intel:<good-tag>
   ```

3. Stripe automatically retries with exponential backoff (up to 3 days),
   so most events will recover once the endpoint returns 200. After
   recovery, check `webhook_idempotency` row counts to confirm catch-up.

## 3. Root cause checklist

- [ ] **Secret rotation without deploy**: standard cause. Stripe webhook
      secret changed, Fly secrets not updated.
- [ ] **Event-type mismatch**: did Foundry add a new event type to
      subscribe to without handling it? Check `customer.subscription.*`
      vs `invoice.*` handlers.
- [ ] **Schema drift**: a column referenced by the handler was renamed
      in a migration but the handler wasn't updated. `git log
      src/index.ts -- $(grep -l 'stripe' src/)`.
- [ ] **Tier mapping changed**: Stripe price IDs in `STRIPE_*_PRICE_ID`
      env vars don't match what the handler expects.
- [ ] **Database write failure**: handler is OK, the UPDATE on `founders`
      or `products` is failing silently. Look for SQLite constraint
      errors in logs.

## 4. Manual reconciliation

If a founder reports a tier mismatch and webhook replay didn't fix it:

```sql
-- Confirm the founder's actual Stripe state, then:
UPDATE founders
   SET tier = 'growth',                        -- or 'solo'/'investor_ready'
       subscription_status = 'active',
       updated_at = datetime('now')
 WHERE id = '<founder_id>';
```

Log the manual fix in `audit_log` with `trigger='manual_reconciliation'`
so future incident review can see it happened.

## 5. Post-incident

- If the cause was missing handler for a new event type, add it.
- If the cause was schema drift, add a typecheck-time guard:
  `Pick<FounderRow, 'tier' | 'subscription_status'>` import in the
  handler, so a column rename trips typecheck.
- If the cause was secret rotation, add to the deploy checklist:
  "after Stripe secret rotation, redeploy within X hours".
