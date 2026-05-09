# Runbook — Encryption Key Rotation

> Trigger: scheduled rotation (recommended every 12 months), suspected
> key compromise, or operator change.

## What's at stake

`ENCRYPTION_KEY` (a 32-byte hex string) protects two surfaces today:

- `products.github_access_token` — GitHub OAuth tokens for the audit
  engine (encrypted at write via `src/services/encryption.ts:encrypt`).
- `integrations.credentials_json` — per-product API credentials for
  Stripe / PostHog / Linear / Intercom (encrypted via
  `encryptCredentialPayload`).

A key rotation done wrong leaves either (a) the new key unable to
decrypt old data, or (b) old key still in use. Both are recoverable;
neither is OK silently.

## Two supported rotation modes

### Mode A — "Live" rotation with both keys present

Use when: scheduled rotation, no compromise. Zero-downtime.

The crypto module supports a fallback decryption key via the
`OLD_ENCRYPTION_KEY` env var (see `src/lib/crypto.ts:getOldDerivedKey`).
During rotation:

1. **Generate the new key** locally:

   ```bash
   openssl rand -hex 32
   ```

   Save it; you'll set it as `ENCRYPTION_KEY` in step 3.

2. **Set `OLD_ENCRYPTION_KEY` to the current key** so old ciphertext
   stays readable:

   ```bash
   fly secrets set OLD_ENCRYPTION_KEY=$(fly secrets list --json | jq -r '.[] | select(.Name=="ENCRYPTION_KEY") | .Value // empty')
   ```

   (If your secrets manager doesn't expose values, copy the value out
   of your local `.env` or password manager.)

3. **Set the new `ENCRYPTION_KEY`**:

   ```bash
   fly secrets set ENCRYPTION_KEY=<new-64-hex-string>
   ```

4. **Deploy.** The app starts with the new key as the encrypt path and
   the old key as the decrypt fallback. No user-visible downtime.

5. **Re-encrypt at-rest data** — until you do this, every read still
   uses the old key under the hood. To migrate proactively:

   ```bash
   npm run cli -- crypto:rotate-rest
   ```

   *(Stub command — see "Operator follow-up" below if it doesn't yet
   exist; the rotation works without it because of the fallback, but
   data should be re-encrypted before the next rotation.)*

6. **Verify a rotated row decrypts cleanly.** Pick one
   `products.github_access_token` and one
   `integrations.credentials_json`, decrypt via a CLI helper, confirm
   the plaintext is what you'd expect (a token, a JSON blob).

7. **After 30 days** (when you're confident no rotation rollback is
   needed), unset `OLD_ENCRYPTION_KEY`:

   ```bash
   fly secrets unset OLD_ENCRYPTION_KEY
   fly deploy
   ```

### Mode B — Emergency rotation (suspected compromise)

Use when: key has likely leaked, no time for graceful migration.

1. **Generate the new key** (same as above).
2. **Set `OLD_ENCRYPTION_KEY` AND new `ENCRYPTION_KEY`** in one batch:

   ```bash
   fly secrets set ENCRYPTION_KEY=<new-key> OLD_ENCRYPTION_KEY=<old-key>
   ```

3. **Deploy** — gets the new key live ASAP; reads still work via the
   fallback.
4. **Within 24 hours**, run the proactive re-encrypt sweep (Mode A
   step 5). After it completes, unset `OLD_ENCRYPTION_KEY`.
5. **Audit** what the leaked key could have decrypted. The integrations
   table is the worst case — assume any encrypted credential there
   was readable. Consider:
   - Rotating the underlying credentials (Stripe restricted key,
     PostHog API key, Resend API key, GitHub PAT).
   - Notifying affected founders if a customer-data integration was
     reachable.
6. **Postmortem.** Write to `docs/operations/postmortems/`.

## Verification — after either mode

- Sign up as a new founder. Connect a GitHub repo. Verify the audit
  runs (proves `github_access_token` encryption end-to-end).
- Connect one integration (e.g. Stripe). Verify a sync runs (proves
  `integrations.credentials_json` encryption end-to-end).
- Spot-check `audit_log` rows since rotation: encrypted fields should
  decrypt without errors.

## Operator follow-up

If `crypto:rotate-rest` doesn't yet exist in the CLI, here is the
sketch — implement before the next scheduled rotation:

```
program.command('crypto:rotate-rest').action(async () => {
  // For each row in products with a non-null github_access_token:
  //   plain = decrypt(row.github_access_token)
  //   row.github_access_token = encrypt(plain)
  // For each row in integrations with a non-null credentials_json:
  //   plain = decryptCredentialPayload(row.credentials_json)
  //   row.credentials_json = encryptCredentialPayload(plain)
  // (decrypt uses OLD key as fallback; encrypt always uses new key.)
});
```

The shape is straightforward; the safety properties (transactional
write, idempotent on partial failure, observable progress for large
tables) deserve a dedicated PR rather than being squeezed into the
runbook.

## When NOT to rotate

- After a deploy that introduced encryption code changes — verify
  the new encrypt/decrypt paths first; rotation amplifies any bug.
- Without a backup of the current `ENCRYPTION_KEY` somewhere safe.
  A lost key with no rotation fallback means lost-forever data.
