// =============================================================================
// FOUNDRY — Auth Routes (Clerk)
// =============================================================================

import { Hono } from 'hono';
import { query } from '../../db/client.js';
import { nanoid } from 'nanoid';
import { verifiedPrimaryEmail } from '../../middleware/auth.js';
import { log } from '../../lib/logger.js';
import { createCustomer } from '../../services/billing/stripe.js';

export const authRoutes = new Hono();

authRoutes.get('/auth/signup', (c) => {
  const publishableKey = process.env.CLERK_PUBLISHABLE_KEY ?? '';
  return c.html(`<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Sign Up — Foundry</title>
  <link rel="stylesheet" href="/static/styles.css" />
  <style>
    body { display: flex; justify-content: center; align-items: center; min-height: 100vh; background: #0f172a; margin: 0; }
    .auth-container { text-align: center; }
    .auth-container h1 { color: white; margin-bottom: 1.5rem; font-size: 1.5rem; }
    .auth-container a { color: #94a3b8; font-size: 0.87rem; }
    #sign-up { min-height: 400px; }
  </style>
</head>
<body>
  <div class="auth-container">
    <h1>Foundry</h1>
    <div id="sign-up"></div>
    <p style="margin-top:1rem;"><a href="/auth/login">Already have an account? Log in</a></p>
  </div>
  <script>
    const pk = "${publishableKey}";
    async function initClerk() {
      const m = await import("https://cdn.jsdelivr.net/npm/@clerk/clerk-js@5/+esm");
      const clerk = new m.Clerk(pk);
      await clerk.load();
      if (clerk.user) { window.location.href = "/foundry"; return; }
      clerk.mountSignUp(document.getElementById("sign-up"), {
        forceRedirectUrl: "/foundry",
        fallbackRedirectUrl: "/foundry",
      });
    }
    initClerk().catch(e => {
      // THE ERROR TEXT IS BUILT AS NODES, NOT AS HTML. This concatenated
      // the error message into innerHTML, and the error comes from a third-party
      // module loaded over the network: any markup in it — from a crafted CDN
      // response, a proxy error page, or a message that happens to contain
      // angle brackets — was rendered as HTML on the sign-in page.
      const box = document.getElementById("sign-up");
      box.textContent = "";
      const headline = document.createElement("p");
      headline.style.color = "#ef4444";
      headline.textContent = "Failed to load authentication. Please refresh the page.";
      const detail = document.createElement("p");
      detail.style.color = "#64748b";
      detail.style.fontSize = "0.8rem";
      detail.textContent = String(e && e.message ? e.message : e);
      box.appendChild(headline);
      box.appendChild(detail);
    });
  </script>
</body>
</html>`);
});

authRoutes.get('/auth/login', (c) => {
  const publishableKey = process.env.CLERK_PUBLISHABLE_KEY ?? '';
  return c.html(`<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Log In — Foundry</title>
  <link rel="stylesheet" href="/static/styles.css" />
  <style>
    body { display: flex; justify-content: center; align-items: center; min-height: 100vh; background: #0f172a; margin: 0; }
    .auth-container { text-align: center; }
    .auth-container h1 { color: white; margin-bottom: 1.5rem; font-size: 1.5rem; }
    .auth-container a { color: #94a3b8; font-size: 0.87rem; }
    #sign-in { min-height: 400px; }
  </style>
</head>
<body>
  <div class="auth-container">
    <h1>Foundry</h1>
    <div id="sign-in"></div>
    <p style="margin-top:1rem;"><a href="/auth/signup">Don't have an account? Sign up</a></p>
  </div>
  <script>
    const pk = "${publishableKey}";
    async function initClerk() {
      const m = await import("https://cdn.jsdelivr.net/npm/@clerk/clerk-js@5/+esm");
      const clerk = new m.Clerk(pk);
      await clerk.load();
      if (clerk.user) { window.location.href = "/foundry"; return; }
      clerk.mountSignIn(document.getElementById("sign-in"), {
        forceRedirectUrl: "/foundry",
        fallbackRedirectUrl: "/foundry",
      });
    }
    initClerk().catch(e => {
      // THE ERROR TEXT IS BUILT AS NODES, NOT AS HTML. This concatenated
      // the error message into innerHTML, and the error comes from a third-party
      // module loaded over the network: any markup in it — from a crafted CDN
      // response, a proxy error page, or a message that happens to contain
      // angle brackets — was rendered as HTML on the sign-in page.
      const box = document.getElementById("sign-in");
      box.textContent = "";
      const headline = document.createElement("p");
      headline.style.color = "#ef4444";
      headline.textContent = "Failed to load authentication. Please refresh the page.";
      const detail = document.createElement("p");
      detail.style.color = "#64748b";
      detail.style.fontSize = "0.8rem";
      detail.textContent = String(e && e.message ? e.message : e);
      box.appendChild(headline);
      box.appendChild(detail);
    });
  </script>
</body>
</html>`);
});

// Sign out: clear the app-domain session + CSRF cookies and end the Clerk
// client session in the browser before returning to the landing page.
authRoutes.get('/auth/logout', (c) => {
  const publishableKey = process.env.CLERK_PUBLISHABLE_KEY ?? '';
  c.header('Set-Cookie', '__session=; Path=/; HttpOnly; Max-Age=0; SameSite=Lax', { append: true });
  c.header('Set-Cookie', 'foundry_csrf=; Path=/; HttpOnly; Max-Age=0; SameSite=Lax', { append: true });
  return c.html(`<!DOCTYPE html>
<html lang="en">
<head><meta charset="utf-8" /><title>Signing out — Foundry</title></head>
<body style="background:#0f172a;color:#94a3b8;display:flex;align-items:center;justify-content:center;min-height:100vh;font-family:sans-serif;margin:0;">
  <p>Signing out…</p>
  <script>
    const pk = "${publishableKey}";
    (async () => {
      try {
        const m = await import("https://cdn.jsdelivr.net/npm/@clerk/clerk-js@5/+esm");
        const clerk = new m.Clerk(pk);
        await clerk.load();
        await clerk.signOut();
      } catch (e) { /* cookie already cleared server-side */ }
      window.location.href = "/";
    })();
  </script>
</body>
</html>`);
});

// Clerk webhook: user.created event → create founder record
// Verified via Svix signature (Clerk uses Svix for webhook delivery)
authRoutes.post('/auth/webhook', async (c) => {
  const webhookSecret = process.env.CLERK_WEBHOOK_SECRET;
  if (!webhookSecret) return c.json({ error: 'Webhook not configured' }, 500);

  // Verify Svix signature
  const svixId = c.req.header('svix-id');
  const svixTimestamp = c.req.header('svix-timestamp');
  const svixSignature = c.req.header('svix-signature');

  if (!svixId || !svixTimestamp || !svixSignature) {
    return c.json({ error: 'Missing webhook signature headers' }, 401);
  }

  const rawBody = await c.req.text();

  // Verify timestamp is within 5 minutes to prevent replay attacks
  const timestampSeconds = parseInt(svixTimestamp, 10);
  const now = Math.floor(Date.now() / 1000);
  if (Math.abs(now - timestampSeconds) > 300) {
    return c.json({ error: 'Webhook timestamp too old' }, 401);
  }

  // Verify HMAC signature
  const { createHmac, timingSafeEqual } = await import('node:crypto');
  const signedContent = `${svixId}.${svixTimestamp}.${rawBody}`;
  // Clerk webhook secrets are prefixed with "whsec_" and base64-encoded
  const secretBytes = Buffer.from(webhookSecret.replace('whsec_', ''), 'base64');
  const expectedSignature = createHmac('sha256', secretBytes)
    .update(signedContent)
    .digest('base64');
  const expectedBuf = Buffer.from(expectedSignature, 'base64');

  // Svix sends multiple signatures separated by spaces, each as "vN,signature"
  // Compare in constant time to prevent timing-side-channel attacks against
  // the HMAC secret.
  const signatures = svixSignature.split(' ');
  const verified = signatures.some((sig) => {
    const [, sigValue] = sig.split(',');
    if (!sigValue) return false;
    let provided: Buffer;
    try {
      provided = Buffer.from(sigValue, 'base64');
    } catch {
      return false;
    }
    if (provided.length !== expectedBuf.length) return false;
    return timingSafeEqual(provided, expectedBuf);
  });

  if (!verified) {
    return c.json({ error: 'Invalid webhook signature' }, 401);
  }

  const payload = JSON.parse(rawBody) as { type: string; data: Record<string, unknown> };

  if (payload.type === 'user.deleted') {
    const userId = payload.data.id as string;
    const founderResult = await query('SELECT id FROM founders WHERE clerk_user_id = ?', [userId]);
    if (founderResult.rows.length > 0) {
      const founderId = (founderResult.rows[0] as Record<string, string>).id;

      // THIS USED TO DELETE BY HAND: `DELETE FROM products` per company, then
      // `DELETE FROM founders`. It raises. Seven foreign keys into products'
      // descendants are ON DELETE NO ACTION and this database runs with
      // foreign_keys=ON, so deleting a company that has ever had a chat
      // message fails outright — account deletion via the identity provider
      // has never completed for a real company, and left no record of having
      // been attempted.
      //
      // It also bypassed everything erasure knows: no ordering, no retention
      // dispositions, no completion record. It would have deleted the evidence
      // that the erasure happened, the financial records that must survive it,
      // and the idempotency keys that stop a retry re-sending a real message.
      //
      // Same door as every other erasure now.
      const { eraseFounderAccount } = await import('../../services/privacy/consent.js');
      const outcome = await eraseFounderAccount(founderId);
      if (outcome.failed.length > 0) {
        // Clerk retries on a non-2xx, and a partial erasure must be retried
        // rather than reported done. The per-product failure records are
        // already written.
        return c.json({
          error: 'account erasure incomplete',
          products_erased: outcome.productsErased.length,
          products_failed: outcome.failed.length,
        }, 500);
      }
    }
  }

  if (payload.type === 'user.created') {
    const userId = payload.data.id as string;
    // THE VERIFIED PRIMARY ADDRESS, for the same reason the session path uses
    // one: `founders.email` decides who reaches the platform-operator surface,
    // so it is an authorization input and `[0]` is not an answer to "who is
    // this". The provider names the primary address and its verification
    // status; both are required.
    const email = verifiedPrimaryEmail({
      primaryEmailAddressId: payload.data.primary_email_address_id as string | null,
      emailAddresses: (payload.data.email_addresses as Array<{
        id?: string; email_address?: string; verification?: { status?: string | null } | null;
      }> | undefined)?.map((a) => ({
        id: a.id,
        emailAddress: a.email_address,
        verification: a.verification,
      })),
    });
    if (email === null) {
      // Not an error: an unverified sign-up is a real state. Clerk re-delivers
      // `user.updated` once the address is verified, and that path provisions.
      log.info('clerk.user_created_without_verified_primary_email', { userId });
      return c.json({ received: true, provisioned: false });
    }
    const name = `${payload.data.first_name ?? ''} ${payload.data.last_name ?? ''}`.trim() || null;

    // Check if founder already exists
    const existing = await query('SELECT id FROM founders WHERE clerk_user_id = ?', [userId]);
    if (existing.rows.length === 0) {
      const founderId = nanoid();
      const stripeCustomerId = await createCustomer(email, name).catch(() => null);

      // Determine cohort
      const now = new Date();
      const weekStart = new Date(now);
      weekStart.setDate(now.getDate() - now.getDay());
      const cohortPeriod = weekStart.toISOString().split('T')[0];

      await query(
        `INSERT INTO founders (id, clerk_user_id, email, name, stripe_customer_id)
         VALUES (?, ?, ?, ?, ?)`,
        [founderId, userId, email, name, stripeCustomerId]
      );

      // Welcome email on provisioning (idempotent via the gateway; the
      // welcome_sequence_tick cron is the retry safety net). Fire-and-forget.
      if (email) {
        void (async () => {
          try {
            const { sendFounderWelcome } = await import('../../services/founder/welcome-sequence.js');
            await sendFounderWelcome({ id: founderId, email, name, created_at: new Date().toISOString() });
          } catch { /* non-fatal; cron will retry */ }
        })();
      }

      // Activation funnel: signup (Phase 5.2).
      void (async () => {
        try {
          const { recordFunnelStep } = await import('../../services/telemetry/funnel.js');
          await recordFunnelStep('signup', { founderId });
        } catch { /* non-fatal */ }
      })();

      // Create or update cohort (for Foundry's own tracking). Scoped by
      // canonical system identity (migration 123) so signup cohorts can never
      // be written into a customer product that happens to be named "Foundry".
      const { resolveFoundryProductId } = await import('../../services/system-identity.js');
      const fpId = await resolveFoundryProductId();
      if (fpId) {
        await query(
          `INSERT INTO cohorts (id, product_id, acquisition_period, acquisition_channel, founder_count)
           VALUES (?, ?, ?, 'organic', 1)
           ON CONFLICT (product_id, acquisition_period, acquisition_channel) DO UPDATE SET founder_count = founder_count + 1`,
          [nanoid(), fpId, cohortPeriod]
        );
      }
    }
  }

  return c.json({ received: true });
});
