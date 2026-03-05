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

  const payload = await c.req.json() as { type: string; data: Record<string, unknown> };

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
