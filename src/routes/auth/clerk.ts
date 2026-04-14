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
  return c.html(`<!DOCTYPE html><html><head><title>Sign Up — Foundry</title>
  <script async crossorigin="anonymous" src="https://unpkg.com/@clerk/clerk-js/dist/clerk.browser.js" data-clerk-publishable-key="${publishableKey}"></script>
  </head><body><div id="sign-up"></div>
  <script>window.addEventListener('load',async()=>{await Clerk.load();if(Clerk.user){window.location.href='/dashboard';return;}Clerk.mountSignUp(document.getElementById('sign-up'),{forceRedirectUrl:'/dashboard',fallbackRedirectUrl:'/dashboard'});})</script>
  </body></html>`);
});

authRoutes.get('/auth/login', (c) => {
  const publishableKey = process.env.CLERK_PUBLISHABLE_KEY ?? '';
  return c.html(`<!DOCTYPE html><html><head><title>Login — Foundry</title>
  <script async crossorigin="anonymous" src="https://unpkg.com/@clerk/clerk-js/dist/clerk.browser.js" data-clerk-publishable-key="${publishableKey}"></script>
  </head><body><div id="sign-in"></div>
  <script>window.addEventListener('load',async()=>{await Clerk.load();if(Clerk.user){window.location.href='/dashboard';return;}Clerk.mountSignIn(document.getElementById('sign-in'),{forceRedirectUrl:'/dashboard',fallbackRedirectUrl:'/dashboard'});})</script>
  </body></html>`);
});

// Clerk webhook: user.created event → create founder record
authRoutes.post('/auth/webhook', async (c) => {
  const webhookSecret = process.env.CLERK_WEBHOOK_SECRET;
  if (!webhookSecret) return c.json({ error: 'Webhook not configured' }, 500);

  // Verify webhook signature (Clerk uses Svix)
  const svixId = c.req.header('svix-id');
  const svixTimestamp = c.req.header('svix-timestamp');
  const svixSignature = c.req.header('svix-signature');

  if (!svixId || !svixTimestamp || !svixSignature) {
    return c.json({ error: 'Missing signature headers' }, 401);
  }

  // Verify timestamp is within tolerance (5 minutes)
  const timestampSeconds = parseInt(svixTimestamp, 10);
  const now = Math.floor(Date.now() / 1000);
  if (isNaN(timestampSeconds) || Math.abs(now - timestampSeconds) > 300) {
    return c.json({ error: 'Invalid timestamp' }, 401);
  }

  // Verify HMAC signature
  const rawBody = await c.req.text();
  const signedContent = `${svixId}.${svixTimestamp}.${rawBody}`;

  // Clerk webhook secrets are base64 encoded with "whsec_" prefix
  const secretBytes = Uint8Array.from(atob(webhookSecret.replace('whsec_', '')), (ch) => ch.charCodeAt(0));

  const key = await crypto.subtle.importKey(
    'raw',
    secretBytes,
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );
  const signatureBytes = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(signedContent));
  const expectedSignature = btoa(String.fromCharCode(...new Uint8Array(signatureBytes)));

  // svix-signature may contain multiple signatures separated by spaces, each prefixed with "v1,"
  const signatures = svixSignature.split(' ').map((s) => s.replace('v1,', ''));
  const isValid = signatures.some((sig) => sig === expectedSignature);

  if (!isValid) {
    return c.json({ error: 'Invalid signature' }, 401);
  }

  const payload = JSON.parse(rawBody) as { type: string; data: Record<string, unknown> };

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
