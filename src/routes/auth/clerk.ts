// =============================================================================
// FOUNDRY — Auth Routes (Clerk)
// =============================================================================

import { Hono } from 'hono';
import { query } from '../../db/client.js';
import { nanoid } from 'nanoid';
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
      if (clerk.user) { window.location.href = "/dashboard"; return; }
      clerk.mountSignUp(document.getElementById("sign-up"), {
        forceRedirectUrl: "/dashboard",
        fallbackRedirectUrl: "/dashboard",
      });
    }
    initClerk().catch(e => {
      document.getElementById("sign-up").innerHTML = '<p style="color:#ef4444;">Failed to load authentication. Please refresh the page.</p><p style="color:#64748b;font-size:0.8rem;">' + e.message + '</p>';
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
      if (clerk.user) { window.location.href = "/dashboard"; return; }
      clerk.mountSignIn(document.getElementById("sign-in"), {
        forceRedirectUrl: "/dashboard",
        fallbackRedirectUrl: "/dashboard",
      });
    }
    initClerk().catch(e => {
      document.getElementById("sign-in").innerHTML = '<p style="color:#ef4444;">Failed to load authentication. Please refresh the page.</p><p style="color:#64748b;font-size:0.8rem;">' + e.message + '</p>';
    });
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
      // Delete products (and all cascaded child rows) then the founder
      const productsResult = await query('SELECT id FROM products WHERE owner_id = ?', [founderId]);
      for (const row of productsResult.rows) {
        const productId = (row as Record<string, string>).id;
        await query('DELETE FROM products WHERE id = ?', [productId]);
      }
      await query('DELETE FROM founders WHERE id = ?', [founderId]);
    }
  }

  if (payload.type === 'user.created') {
    const userId = payload.data.id as string;
    const email = (payload.data.email_addresses as Array<{ email_address: string }>)?.[0]?.email_address ?? '';
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

      // Create or update cohort (for Foundry's own tracking)
      const foundryProduct = await query("SELECT id FROM products WHERE name = 'Foundry' LIMIT 1", []);
      if (foundryProduct.rows.length > 0) {
        const fpId = (foundryProduct.rows[0] as Record<string, string>).id;
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
