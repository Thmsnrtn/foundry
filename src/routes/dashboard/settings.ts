// =============================================================================
// FOUNDRY — Settings Route
// =============================================================================

import { Hono } from 'hono';
import { html } from 'hono/html';
import { getCookie } from 'hono/cookie';
import type { AuthEnv } from '../../middleware/auth.js';
import { query } from '../../db/client.js';
import { createBillingPortalSession, createCheckoutSession } from '../../services/billing/stripe.js';
import { dashboardLayout } from '../../views/layout.js';
import { settingsPage } from '../../views/components.js';
import { getLayoutContext } from './_shared.js';
import { getTierBadge, getTierCapabilities } from '../../middleware/tier-gate.js';
import { requireCompanyCapability, requireOwner } from '../../middleware/rbac.js';
import { nanoid } from 'nanoid';
import { randomBytes } from 'crypto';

export const settingsRoutes = new Hono<AuthEnv>();

// ─── Checkout → Stripe ──────────────────────────────────────────────────────

settingsRoutes.post('/checkout', requireOwner(), async (c) => {
  const founder = c.get('founder');
  const body = await c.req.parseBody() as Record<string, string>;
  const tier = body.tier as 'solo' | 'growth' | 'investor_ready';
  const validTiers = ['solo', 'growth', 'investor_ready'];
  if (!tier || !validTiers.includes(tier)) return c.redirect('/settings');

  // Stripe calls can fail (outage, bad key, network). Degrade gracefully to an
  // error redirect rather than 500ing the founder mid-upgrade.
  try {
    let customerId = founder.stripe_customer_id;
    if (!customerId) {
      const { createCustomer } = await import('../../services/billing/stripe.js');
      customerId = await createCustomer(founder.email, founder.name);
      await query('UPDATE founders SET stripe_customer_id = ? WHERE id = ?', [customerId, founder.id]);
    }

    const appUrl = process.env.APP_URL ?? 'http://localhost:8080';
    const checkoutUrl = await createCheckoutSession(
      customerId, tier,
      `${appUrl}/settings?checkout=success`,
      `${appUrl}/settings?checkout=cancelled`
    );
    if (!checkoutUrl) return c.redirect('/settings?checkout=error');
    return c.redirect(checkoutUrl);
  } catch (err) {
    const { logger } = await import('../../services/logger.js');
    logger.error('checkout failed', { founderId: founder.id, tier, error: String(err) });
    return c.redirect('/settings?checkout=error');
  }
});

settingsRoutes.get('/settings', async (c) => {
  const founder = c.get('founder');
  const ctx = await getLayoutContext(founder, 'settings', 'Settings', undefined, c);

  const products = await query('SELECT id, name, github_repo_url, share_token, ingest_token, status, scp_status FROM products WHERE owner_id = ?', [founder.id]);

  // Use the cookie-selected product (consistent with ctx.productId), fall back to first
  const cookieProductId = getCookie(c, 'foundry_product');
  const selectedProduct = cookieProductId
    ? (products.rows.find((r) => (r as Record<string, string>).id === cookieProductId) as Record<string, string> | undefined)
    : undefined;
  const firstProduct = selectedProduct ?? (products.rows.length > 0 ? (products.rows[0] as Record<string, string>) : null);
  const productId = firstProduct?.id ?? null;
  const shareToken = firstProduct?.share_token ?? null;
  const ingestToken = firstProduct?.ingest_token ?? null;
  // Read without the credential: nothing that renders a page has a reason to
  // decrypt an API key.
  const { getSendingIdentitySummary } = await import('../../services/outbound/sending-identity.js');
  const sendingIdentity = firstProduct
    ? await getSendingIdentitySummary(String(firstProduct.id))
    : null;
  const sendingError = c.req.query('sending_error') ?? null;
  const comps = productId
    ? await query('SELECT * FROM competitors WHERE product_id = ?', [productId])
    : { rows: [] };

  // Get current wisdom opt-in state
  const wisdomResult = await query(
    'SELECT wisdom_network_opted_in FROM founders WHERE id = ?',
    [founder.id]
  );
  const wisdomOptIn = ((wisdomResult.rows[0] as Record<string, unknown>)?.wisdom_network_opted_in ?? 1) === 1;

  // WEEKEND MODE HAD AN ENFORCEMENT AND NO DOOR. `products.cadence_mode` has
  // existed since migration 070, whose comment describes the feature — "drops
  // agent cadences for the side-project founder segment" — and the scheduler
  // reads it and clamps every cadence to weekly when it is 'weekend'. Nothing
  // anywhere set it: no toggle, no onboarding question, no API. The rule was
  // written, enforced, and unreachable, which from the founder's side is
  // indistinguishable from not existing.
  const cadenceResult = productId
    ? await query('SELECT cadence_mode FROM products WHERE id = ?', [productId])
    : { rows: [] };
  const weekendMode = String(
    (cadenceResult.rows[0] as Record<string, unknown> | undefined)?.cadence_mode ?? '') === 'weekend';
  const appUrl = process.env.APP_URL ?? 'http://localhost:8080';

  // Systems the owner has let report to them, and exactly what each may say.
  // The metric token above is a credential for POSTING NUMBERS; before
  // migration 139 it also opened two intakes with quite different consequences.
  const { getIngestCredentials, INGEST_PURPOSES, INGEST_PURPOSE_LABELS, INGEST_REFUSAL_LABELS } = await import(
    '../../services/institution/ingest-credentials.js');
  const credentials = productId ? await getIngestCredentials(productId) : [];
  // A freshly minted secret is shown once. The redirect carries the credential
  // ID, never the secret itself — a secret in a URL lands in request logs, in
  // history, and in whatever the browser sends as a referrer.
  const mintedId = c.req.query('minted');
  const { revealIngestSecret } = await import('../../services/institution/ingest-credentials.js');
  const mintedSecret = mintedId && productId
    ? await revealIngestSecret({ productId, founderId: founder.id as string, credentialId: mintedId })
    : null;

  // API keys. Until now nothing anywhere could issue one, so `/api/v1` and the
  // transcript webhooks were mounted, authenticated, and unreachable.
  const { getApiKeys, API_SCOPES, API_SCOPE_LABELS } = await import(
    '../../services/api/api-key-issuance.js');
  const apiKeys = productId ? await getApiKeys(productId) : [];

  const tierLabel = getTierBadge(founder.tier);
  const capabilities = getTierCapabilities(founder.tier);

  // Success banner for settings actions
  const successParam = c.req.query('success');
  const successMessages: Record<string, string> = {
    company_paused: 'Product paused. All agent activity and data ingestion are suspended.',
    company_resumed: 'Product resumed. Agent activity and data ingestion are active.',
  };
  const successBannerMsg = successParam ? successMessages[successParam] ?? null : null;

  const content = html`
    ${successBannerMsg ? html`<div style="background:#4ecca322;border:1px solid #4ecca344;border-radius:8px;padding:0.75rem 1.25rem;margin-bottom:1.5rem;color:#4ecca3;font-size:0.875rem;font-weight:500;">${successBannerMsg}</div>` : ''}
    <h1>Settings</h1>
    ${settingsPage(
      { id: founder.id, email: founder.email, name: founder.name, tier: founder.tier },
      products.rows as Array<Record<string, unknown>>,
      comps.rows as Array<Record<string, unknown>>,
    )}
    <div class="card">
      <h3>Subscription</h3>
      <p><strong>Current Plan:</strong> <span class="badge badge-watch">${tierLabel}</span></p>
      <p style="font-size:0.87rem;color:#6b7280;">You have access to ${capabilities.length} features.</p>
      <div style="display:flex;gap:0.5rem;flex-wrap:wrap;margin-top:0.75rem;">
        ${!founder.tier ? html`
          <form method="POST" action="/checkout"><input type="hidden" name="tier" value="solo" /><button type="submit" class="btn btn-secondary btn-sm">Solo — $79/mo</button></form>
          <form method="POST" action="/checkout"><input type="hidden" name="tier" value="growth" /><button type="submit" class="btn btn-secondary btn-sm">Growth — $199/mo</button></form>
          <form method="POST" action="/checkout"><input type="hidden" name="tier" value="investor_ready" /><button type="submit" class="btn btn-primary btn-sm">Investor Ready — $399/mo</button></form>
        ` : ''}
        ${founder.tier && founder.tier !== 'investor_ready' ? html`
          <form method="POST" action="/checkout"><input type="hidden" name="tier" value="investor_ready" /><button type="submit" class="btn btn-primary btn-sm">Upgrade to Investor Ready</button></form>
        ` : ''}
        ${founder.stripe_customer_id ? html`
          <form method="POST" action="/settings/manage-subscription"><button type="submit" class="btn btn-secondary btn-sm">Manage Subscription</button></form>
        ` : ''}
      </div>
    </div>

    <div class="card">
      <h3>Products</h3>
      <p style="font-size:0.87rem;color:#6b7280;margin-bottom:0.75rem;">You have ${products.rows.length} product(s) connected.</p>
      ${(products.rows as unknown as Array<Record<string, string>>).map((p) => html`
        <div style="display:flex;justify-content:space-between;align-items:center;padding:0.5rem 0;border-bottom:1px solid #f3f4f6;">
          <div>
            <strong>${p.name}</strong>
            ${p.github_repo_url ? html`<span style="font-size:0.75rem;color:#6b7280;margin-left:0.5rem;">${p.github_repo_url}</span>` : ''}
          </div>
          <a href="/products/${p.id}/audit" class="btn btn-secondary btn-sm" style="font-size:0.75rem;">View</a>
        </div>`)}
      <a href="/onboarding" class="btn btn-primary btn-sm" style="margin-top:0.75rem;">+ Add Product</a>
    </div>

    <!-- Manage Company (F-061-A) -->
    <div class="card" style="border:1px solid rgba(255,255,255,0.08);">
      <h3>Manage Company</h3>
      <p style="font-size:0.87rem;color:var(--text-muted);margin-bottom:1rem;">
        Pause, export, or delete your products. These actions apply to your currently selected product${products.rows.length > 1 ? ' — switch products above to target a different one' : ''}.
      </p>

      ${productId ? html`
      <div style="display:flex;flex-direction:column;gap:1rem;">
        <!-- Pause / Resume -->
        <div style="display:flex;align-items:center;justify-content:space-between;padding:0.75rem 1rem;background:rgba(255,255,255,0.03);border-radius:8px;border:1px solid rgba(255,255,255,0.06);">
          <div>
            <div style="font-size:0.875rem;font-weight:600;color:var(--text-primary);">Pause Product</div>
            <div style="font-size:0.78rem;color:var(--text-dim);">Suspend all agent activity and data ingestion. Your data is preserved.</div>
          </div>
          <form method="POST" action="/settings/toggle-product-status">
            <input type="hidden" name="product_id" value="${productId}" />
            <button type="submit" class="btn btn-secondary btn-sm" aria-label="Pause or resume product">
              ${(firstProduct as Record<string, string> | null)?.scp_status === 'paused' ? 'Resume' : 'Pause'}
            </button>
          </form>
        </div>

        <!-- Export Data -->
        <div style="display:flex;align-items:center;justify-content:space-between;padding:0.75rem 1rem;background:rgba(255,255,255,0.03);border-radius:8px;border:1px solid rgba(255,255,255,0.06);">
          <div>
            <div style="font-size:0.875rem;font-weight:600;color:var(--text-primary);">Export Data</div>
            <div style="font-size:0.78rem;color:var(--text-dim);">Download all metrics, decisions, briefings, and configuration.</div>
          </div>
          <div style="display:flex;gap:0.5rem;">
            <a href="/privacy/export" class="btn btn-secondary btn-sm" aria-label="Export product data as JSON">JSON</a>
            <a href="/privacy/export?format=csv" class="btn btn-secondary btn-sm" aria-label="Export product data as CSV">CSV</a>
          </div>
        </div>

        <!-- Delete -->
        <div style="display:flex;align-items:center;justify-content:space-between;padding:0.75rem 1rem;background:rgba(255,107,107,0.04);border-radius:8px;border:1px solid rgba(255,107,107,0.12);">
          <div>
            <div style="font-size:0.875rem;font-weight:600;color:#ff6b6b;">Delete Product</div>
            <div style="font-size:0.78rem;color:var(--text-dim);">Permanently remove this product and all data after a 30-day grace period.</div>
          </div>
          <a href="/privacy" class="btn btn-sm" style="color:#ff6b6b;border-color:#ff6b6b44;" aria-label="Go to privacy settings to delete product">Delete</a>
        </div>

        ${products.rows.length > 1 ? html`
        <!-- Fleet-wide actions -->
        <div style="border-top:1px solid rgba(255,255,255,0.06);padding-top:1rem;margin-top:0.25rem;">
          <div style="font-size:0.72rem;font-weight:700;letter-spacing:0.1em;text-transform:uppercase;color:var(--text-muted);margin-bottom:0.5rem;">Fleet-wide</div>
          <div style="display:flex;gap:0.5rem;flex-wrap:wrap;">
            <a href="/settings/export-all" class="btn btn-ghost btn-sm" aria-label="Export all products data">Export All Products</a>
            <a href="/settings/delete-all-products" class="btn btn-ghost btn-sm" style="color:#ff6b6b;" aria-label="Delete all products">Delete All Products</a>
          </div>
        </div>
        ` : ''}
      </div>
      ` : html`<p style="font-size:0.87rem;color:var(--text-dim);">No product selected.</p>`}
    </div>

    <div class="card">
      <h3>How Foundry speaks to you</h3>
      <p style="font-size:0.8rem;color:var(--text-muted);margin:0.25rem 0 0.75rem;">
        Presentation only — every setting gives you the exact same product, data, and controls.
      </p>
      <form method="POST" action="/settings/fluency" style="display:flex;gap:0.5rem;flex-wrap:wrap;">
        ${(['plain', 'balanced', 'technical'] as const).map((f) => html`
          <button type="submit" name="fluency" value="${f}"
            class="btn ${((founder.preferences?.fluency ?? 'balanced') === f) ? 'btn-primary' : 'btn-ghost'}"
            style="font-size:0.8rem;text-transform:capitalize;">
            ${f === 'plain' ? 'Plain English' : f === 'balanced' ? 'Balanced' : 'Technical'}
          </button>`)}
      </form>
    </div>

    <div class="card">
      <h3>Wisdom Network</h3>
      <p style="font-size:0.87rem;color:var(--text-muted);margin-bottom:1rem;">
        When enabled, Foundry contributes anonymized decision patterns from your business to
        the cross-product wisdom layer. No identifying information, revenue figures, or product
        names are ever shared — only aggregated shapes and outcomes. In return, your AI
        recommendations benefit from patterns across all contributing businesses.
      </p>
      ${productId ? html`
      <div class="wisdom-toggle-row">
        <div>
          <div class="wisdom-toggle-label">Weekend pace</div>
          <div class="wisdom-toggle-desc">This is a side project — run the agents weekly, not daily</div>
        </div>
        <form method="POST" action="/settings/cadence-mode" style="display:flex;align-items:center;">
          <input type="hidden" name="mode" value="${weekendMode ? 'standard' : 'weekend'}" />
          <label class="toggle" title="${weekendMode ? 'Back to the standard pace' : 'Slow every agent to weekly'}">
            <input type="checkbox" ${weekendMode ? 'checked' : ''}
              onchange="this.closest('form').submit()" />
            <span class="toggle-track"></span>
            <span class="toggle-thumb"></span>
          </label>
        </form>
      </div>` : ''}

      <div class="wisdom-toggle-row">
        <div>
          <div class="wisdom-toggle-label">Contribute anonymously</div>
          <div class="wisdom-toggle-desc">Share decision outcomes to improve AI for everyone</div>
        </div>
        <form method="POST" action="/settings/wisdom-toggle" style="display:flex;align-items:center;">
          <label class="toggle" title="${wisdomOptIn ? 'Click to opt out' : 'Click to opt in'}">
            <input
              type="checkbox"
              name="opted_in"
              value="1"
              ${wisdomOptIn ? 'checked' : ''}
              onchange="this.closest('form').submit()"
            />
            <span class="toggle-track"></span>
            <span class="toggle-thumb"></span>
          </label>
        </form>
      </div>
    </div>

    ${productId ? html`
    <div class="card">
      <h3>Investor / Advisor Access</h3>
      <p style="font-size:0.87rem;color:var(--text-muted);margin-bottom:1rem;">
        Generate a private link to share a live read-only view of your Signal score,
        metrics, and recent decisions with investors or advisors. No login required.
        Revoke it at any time by regenerating.
      </p>
      ${shareToken ? html`
      <div style="margin-bottom:0.75rem;">
        <div style="font-size:0.8rem;color:var(--text-dim);margin-bottom:0.35rem;">Your share link</div>
        <div style="display:flex;align-items:center;gap:0.5rem;">
          <input
            type="text"
            id="share-link-input"
            value="${appUrl}/share/${shareToken}"
            readonly
            style="flex:1;font-size:0.82rem;font-family:monospace;cursor:pointer;"
            onclick="this.select()"
          />
          <button
            class="btn btn-secondary btn-sm"
            onclick="navigator.clipboard.writeText(document.getElementById('share-link-input').value).then(()=>{this.textContent='Copied!';setTimeout(()=>{this.textContent='Copy'},1500)})"
          >Copy</button>
        </div>
      </div>
      <form method="POST" action="/settings/generate-share" style="display:inline;">
        <button type="submit" class="btn btn-ghost btn-sm">Regenerate link</button>
      </form>
      ` : html`
      <form method="POST" action="/settings/generate-share">
        <button type="submit" class="btn btn-secondary btn-sm">Generate share link</button>
      </form>`}
    </div>` : ''}

    ${productId ? html`
    <div class="card">
      <h3>Metric Ingest</h3>
      <p style="font-size:0.87rem;color:var(--text-muted);margin-bottom:1rem;">
        A secret URL your tools can POST to — Stripe webhooks, Zapier, cron jobs, or your own pipeline.
        Foundry maps the fields to your metrics and recomputes Signal automatically.
        No login required; the URL is the secret.
      </p>
      ${ingestToken ? html`
      <div style="margin-bottom:0.75rem;">
        <div style="font-size:0.8rem;color:var(--text-dim);margin-bottom:0.35rem;">Ingest endpoint</div>
        <div style="display:flex;align-items:center;gap:0.5rem;">
          <input
            type="text"
            id="ingest-url-input"
            value="${appUrl}/ingest/${ingestToken}"
            readonly
            style="flex:1;font-size:0.78rem;font-family:monospace;cursor:pointer;"
            onclick="this.select()"
          />
          <button
            class="btn btn-secondary btn-sm"
            onclick="navigator.clipboard.writeText(document.getElementById('ingest-url-input').value).then(()=>{this.textContent='Copied!';setTimeout(()=>{this.textContent='Copy'},1500)})"
          >Copy</button>
        </div>
      </div>
      <details style="margin-bottom:0.75rem;">
        <summary style="font-size:0.82rem;color:var(--text-dim);cursor:pointer;">Example payload</summary>
        <pre class="ingest-example">{
  "new_mrr": 4500,
  "churned_mrr": 200,
  "activation_rate": 0.34,
  "day_30_retention": 0.68,
  "churn_rate": 0.02,
  "nps_score": 42,
  "active_users": 87,
  "signups_7d": 23
}</pre>
        <p style="font-size:0.78rem;color:var(--text-dim);margin:0.35rem 0 0;">MRR values in dollars. Rates as decimals (0.34 = 34%).</p>
      </details>
      <form method="POST" action="/settings/generate-ingest" style="display:inline;">
        <button type="submit" class="btn btn-ghost btn-sm">Regenerate token</button>
      </form>
      ` : html`
      <form method="POST" action="/settings/generate-ingest">
        <button type="submit" class="btn btn-secondary btn-sm">Generate ingest URL</button>
      </form>`}
    </div>` : ''}

    ${productId ? html`
    <div class="card">
      <h3>Who your customers hear from</h3>
      <p style="font-size:0.87rem;color:var(--text-muted);margin-bottom:1rem;">
        Mail Foundry sends to <em>your customers</em> goes out as you — your
        domain, your reply address, your unsubscribe footer. It never goes out
        as Foundry. That means it needs your own email provider account, so the
        sending domain is one you have verified and the delivery reputation is
        yours. Mail Foundry sends to <em>you</em> — briefings, alerts, billing
        — still comes from Foundry.
      </p>
      ${sendingIdentity ? html`
      <p style="font-size:0.87rem;margin:0 0 0.5rem;">
        Sending as <strong>${sendingIdentity.fromName
          ? `${sendingIdentity.fromName} <${sendingIdentity.fromEmail}>`
          : sendingIdentity.fromEmail}</strong> via ${sendingIdentity.provider}.
      </p>
      <p style="font-size:0.78rem;color:var(--text-dim);margin:0 0 0.75rem;">
        ${sendingIdentity.lastAcceptedAt
          ? `Last accepted by the provider ${sendingIdentity.lastAcceptedAt}.`
          : 'Connected, but nothing has been sent through it yet — so it has not been proved to work.'}
      </p>
      <form method="POST" action="/settings/sending-identity/disconnect">
        <button type="submit" class="btn btn-ghost btn-sm">Disconnect</button>
      </form>
      <p style="font-size:0.75rem;color:var(--text-dim);margin:0.5rem 0 0;">
        Disconnecting stops customer mail. It does not send it as Foundry instead.
      </p>
      ` : html`
      <p style="font-size:0.82rem;color:var(--text-dim);margin:0 0 0.75rem;">
        Not connected — mail to your customers is refused until it is.
      </p>`}
      ${sendingError ? html`
      <p style="font-size:0.82rem;color:#ff6b6b;margin:0 0 0.75rem;">${sendingError}</p>` : ''}
      <form method="POST" action="/settings/sending-identity" style="margin-top:0.75rem;display:grid;gap:0.5rem;max-width:26rem;">
        <input type="email" name="from_email" required placeholder="you@yourdomain.com"
               value="${sendingIdentity?.fromEmail ?? ''}" />
        <input type="text" name="from_name" placeholder="Display name (optional)"
               value="${sendingIdentity?.fromName ?? ''}" />
        <input type="password" name="credential" required placeholder="Your Resend API key" />
        <button type="submit" class="btn btn-secondary btn-sm">
          ${sendingIdentity ? 'Replace sending address' : 'Connect sending address'}
        </button>
      </form>
    </div>` : ''}

    ${productId ? html`
    <div class="card">
      <h3>Systems that report to you</h3>
      <p style="font-size:0.87rem;color:var(--text-muted);margin-bottom:1rem;">
        The metric URL above is for posting numbers. Two other things a system can
        tell Foundry — that something needs handling, and whether something Foundry
        sent actually worked — need their own credential, so a tool you gave a
        metrics URL to cannot do either. Each credential says what that system may
        say. None of them authorises anything.
      </p>

      ${mintedSecret ? html`
      <div style="margin-bottom:1rem;padding:0.75rem;border:1px solid var(--border);border-radius:6px;">
        <div style="font-size:0.8rem;color:var(--text-dim);margin-bottom:0.35rem;">
          Copy this now — it is shown once here, and afterwards only on this page.
        </div>
        <input type="text" readonly value="${mintedSecret}"
          style="width:100%;font-size:0.78rem;font-family:monospace;cursor:pointer;"
          onclick="this.select()" />
      </div>` : ''}

      ${credentials.length ? html`
      <table style="width:100%;font-size:0.82rem;margin-bottom:1rem;">
        <tbody>
        ${credentials.map((cred) => html`
          <tr>
            <td style="padding:0.35rem 0;">
              <strong>${cred.label}</strong>
              <div style="color:var(--text-dim);font-size:0.76rem;">
                may ${cred.purposes.map((p) => INGEST_PURPOSE_LABELS[p].may).join('; ')}
              </div>
              ${cred.refusalCount > 0 && !cred.revoked ? html`
              <div style="color:#ffb347;font-size:0.76rem;margin-top:0.2rem;">
                I have turned this away ${String(cred.refusalCount)} ${cred.refusalCount === 1 ? 'time' : 'times'} since it last got through — ${INGEST_REFUSAL_LABELS[cred.lastRefusalReason as keyof typeof INGEST_REFUSAL_LABELS] ?? 'I could not use what it sent'}.
              </div>` : ''}
            </td>
            <td style="text-align:right;padding:0.35rem 0;">
              ${cred.revoked ? html`<span style="color:var(--text-dim);">withdrawn</span>` : html`
              <form method="POST" action="/settings/ingest-credentials/${cred.id}/revoke" style="display:inline;">
                <button type="submit" class="btn btn-ghost btn-sm">Withdraw</button>
              </form>`}
            </td>
          </tr>`)}
        </tbody>
      </table>` : ''}

      <form method="POST" action="/settings/ingest-credentials">
        <input type="text" name="label" maxlength="80" required
          placeholder="Which system is this for?"
          style="width:100%;margin-bottom:0.5rem;font-size:0.85rem;" />
        ${INGEST_PURPOSES.map((purpose) => html`
        <label style="display:block;font-size:0.82rem;margin-bottom:0.3rem;">
          <input type="checkbox" name="purpose" value="${purpose}" />
          It may ${INGEST_PURPOSE_LABELS[purpose].may}
          <span style="color:var(--text-dim);"> — it may not ${INGEST_PURPOSE_LABELS[purpose].mayNot}</span>
        </label>`)}
        <button type="submit" class="btn btn-secondary btn-sm" style="margin-top:0.5rem;">
          Issue credential
        </button>
      </form>
    </div>` : ''}

    ${productId ? html`
    <div class="card">
      <h3>API keys</h3>
      <p style="font-size:0.87rem;color:var(--text-muted);margin-bottom:1rem;">
        For programs that read and write your data directly — the REST API, the
        MCP tools, and call-transcript webhooks. A key does exactly what you tick
        and nothing else, and every key expires. It is shown once when you issue
        it, because only a hash of it is stored.
      </p>

      ${apiKeys.length ? html`
      <table style="width:100%;font-size:0.82rem;margin-bottom:1rem;">
        <tbody>
        ${apiKeys.map((key) => html`
          <tr>
            <td style="padding:0.35rem 0;">
              <strong>${key.label}</strong>
              <code style="font-size:0.72rem;color:var(--text-dim);"> ${key.prefix}…</code>
              <div style="color:var(--text-dim);font-size:0.76rem;">
                ${key.scopes.join(', ') || 'no scopes'}
                ${key.expiresAt ? html` · expires ${key.expiresAt.slice(0, 10)}` : ''}
                ${key.lastUsedAt ? html` · last used ${key.lastUsedAt.slice(0, 10)}` : html` · never used`}
              </div>
            </td>
            <td style="text-align:right;padding:0.35rem 0;">
              ${key.revoked ? html`<span style="color:var(--text-dim);">withdrawn</span>` : html`
              <form method="POST" action="/settings/api-keys/${key.id}/revoke" style="display:inline;">
                <button type="submit" class="btn btn-ghost btn-sm">Withdraw</button>
              </form>`}
            </td>
          </tr>`)}
        </tbody>
      </table>` : ''}

      <form method="POST" action="/settings/api-keys">
        <input type="text" name="label" maxlength="80" required
          placeholder="What is this key for?"
          style="width:100%;margin-bottom:0.5rem;font-size:0.85rem;" />
        ${API_SCOPES.map((scope) => html`
        <label style="display:block;font-size:0.82rem;margin-bottom:0.3rem;">
          <input type="checkbox" name="scope" value="${scope}" />
          <code style="font-size:0.76rem;">${scope}</code> —
          may ${API_SCOPE_LABELS[scope].may}
          <span style="color:var(--text-dim);">; may not ${API_SCOPE_LABELS[scope].mayNot}</span>
        </label>`)}
        <label style="display:block;font-size:0.82rem;margin:0.6rem 0 0.5rem;">
          Expires in
          <input type="number" name="days" min="1" max="365" value="90"
            style="width:5rem;font-size:0.82rem;" /> days
        </label>
        <button type="submit" class="btn btn-secondary btn-sm">Issue API key</button>
      </form>
    </div>` : ''}
  `;
  return c.html(dashboardLayout(ctx, content));
});

// ─── Stripe Checkout ─────────────────────────────────────────────────────────

settingsRoutes.get('/checkout', async (c) => {
  const founder = c.get('founder');
  const tier = c.req.query('tier') as 'solo' | 'growth' | 'investor_ready' | undefined;

  if (!tier || !['solo', 'growth', 'investor_ready'].includes(tier)) {
    return c.redirect('/pricing');
  }

  // Ensure founder has a Stripe customer record
  let customerId = founder.stripe_customer_id;
  if (!customerId) {
    const { createCustomer } = await import('../../services/billing/stripe.js');
    customerId = await createCustomer(founder.email, founder.name ?? null);
    await query('UPDATE founders SET stripe_customer_id = ? WHERE id = ?', [customerId, founder.id]);
  }

  const appUrl = process.env.APP_URL ?? 'http://localhost:8080';
  try {
    const checkoutUrl = await createCheckoutSession(
      customerId,
      tier,
      `${appUrl}/dashboard?subscribed=1`,
      `${appUrl}/pricing`,
    );
    return c.redirect(checkoutUrl);
  } catch (err) {
    console.error('[CHECKOUT] Stripe session creation failed:', err);
    return c.redirect('/pricing?error=checkout_failed');
  }
});

// ─── Share Token Generation ───────────────────────────────────────────────────

settingsRoutes.post('/settings/generate-share', requireCompanyCapability('can_manage_company'), async (c) => {
  const founder = c.get('founder');
  // Use current product from cookie, not LIMIT 1 (FRICTION: settings targeting wrong product)
  const { getCookie } = await import('hono/cookie');
  const cookieProductId = getCookie(c, 'foundry_product');
  const products = await query(
    'SELECT id FROM products WHERE owner_id = ? AND id = ?',
    [founder.id, cookieProductId ?? '']
  );
  if (products.rows.length === 0) {
    // Fallback to first product if cookie not set
    const fallback = await query('SELECT id FROM products WHERE owner_id = ? LIMIT 1', [founder.id]);
    if (fallback.rows.length === 0) return c.redirect('/settings');
  }
  const productId = (products.rows[0] as Record<string, string>)?.id ?? cookieProductId;
  const token = randomBytes(24).toString('hex');

  await query('UPDATE products SET share_token = ? WHERE id = ? AND owner_id = ?', [token, productId, founder.id]);
  return c.redirect('/settings');
});

// ─── Ingest Token Generation ──────────────────────────────────────────────────

settingsRoutes.post('/settings/generate-ingest', requireCompanyCapability('can_manage_company'), async (c) => {
  const founder = c.get('founder');
  const products = await query('SELECT id FROM products WHERE owner_id = ? LIMIT 1', [founder.id]);
  if (products.rows.length === 0) return c.redirect('/settings');

  const productId = (products.rows[0] as Record<string, string>).id;
  const token = randomBytes(24).toString('hex');

  await query('UPDATE products SET ingest_token = ? WHERE id = ? AND owner_id = ?', [token, productId, founder.id]);
  return c.redirect('/settings');
});

// ─── Scoped ingest credentials (migration 139) ───────────────────────────────
//
// The owner issues one of their systems a credential and chooses, explicitly,
// which intakes it may use. There is no "all purposes" option and no way to
// widen one afterwards: a credential is withdrawn and a new one issued, so the
// answer to "what was this secret ever allowed to do?" stays true.

settingsRoutes.post('/settings/ingest-credentials', requireCompanyCapability('can_manage_company'), async (c) => {
  const founder = c.get('founder');
  const ctx = await getLayoutContext(founder, 'settings', 'Settings', undefined, c);
  if (!ctx.productId) return c.redirect('/settings');

  const body = await c.req.parseBody({ all: true });
  const raw = body.purpose;
  const purposes = (Array.isArray(raw) ? raw : raw == null ? [] : [raw]).map(String);

  const { mintIngestCredential } = await import('../../services/institution/ingest-credentials.js');
  const minted = await mintIngestCredential({
    productId: ctx.productId, founderId: founder.id as string,
    label: String(body.label ?? ''), purposes,
  });
  if ('refused' in minted) return c.redirect('/settings');
  // The ID, not the secret. The page reads the secret back and shows it once.
  return c.redirect(`/settings?minted=${minted.id}`);
});

// ─── The company's own sending address (migration 150) ───────────────────────
//
// `services/outbound/sender-of-record.ts` has always said Foundry must never be
// the From on a message to a founder's CUSTOMER. Enforcing that needs somewhere
// for the founder to say who their mail comes from — a rule the person it
// binds cannot satisfy is not a rule, it is an outage. This is that control.
//
// The credential is the founder's own provider key, so the send goes through
// their account: their verified domain, their reputation, their bounce
// handling. Foundry cannot verify domain ownership and does not pretend to;
// the provider can, and refuses anything it has not verified.

settingsRoutes.post('/settings/sending-identity', requireCompanyCapability('can_manage_company'), async (c) => {
  const founder = c.get('founder');
  const ctx = await getLayoutContext(founder, 'settings', 'Settings', undefined, c);
  if (!ctx.productId) return c.redirect('/settings');

  const body = await c.req.parseBody() as Record<string, string>;
  const { setSendingIdentity, SendingIdentityError } = await import(
    '../../services/outbound/sending-identity.js');
  try {
    await setSendingIdentity({
      productId: ctx.productId,
      provider: 'resend',
      credential: String(body.credential ?? ''),
      fromEmail: String(body.from_email ?? ''),
      fromName: body.from_name ? String(body.from_name) : null,
    });
  } catch (err) {
    // The founder gets the reason. A form that silently does nothing is how
    // the Mark Reviewed button spent its whole life.
    if (!(err instanceof SendingIdentityError)) throw err;
    return c.redirect(`/settings?sending_error=${encodeURIComponent(err.message)}`);
  }
  return c.redirect('/settings?sending=connected');
});

settingsRoutes.post('/settings/sending-identity/disconnect', requireCompanyCapability('can_manage_company'), async (c) => {
  const founder = c.get('founder');
  const ctx = await getLayoutContext(founder, 'settings', 'Settings', undefined, c);
  if (!ctx.productId) return c.redirect('/settings');

  const { clearSendingIdentity } = await import('../../services/outbound/sending-identity.js');
  const removed = await clearSendingIdentity(ctx.productId);
  // Said plainly: after this, mail to your customers stops rather than going
  // out under somebody else's name.
  return c.redirect(removed ? '/settings?sending=disconnected' : '/settings');
});

settingsRoutes.post('/settings/ingest-credentials/:id/revoke', requireCompanyCapability('can_manage_company'), async (c) => {
  const founder = c.get('founder');
  const ctx = await getLayoutContext(founder, 'settings', 'Settings', undefined, c);
  if (!ctx.productId) return c.redirect('/settings');
  const { revokeIngestCredential } = await import('../../services/institution/ingest-credentials.js');
  await revokeIngestCredential({
    productId: ctx.productId, founderId: founder.id as string, credentialId: c.req.param('id'),
  });
  return c.redirect('/settings');
});

// ─── API key issuance ────────────────────────────────────────────────────────
//
// Deliberately NOT at `POST /api/v1/settings/api-keys`, which the revenue
// dashboard used to advertise and which never existed. It could not have:
// that namespace is behind API-key authentication, so minting the first key
// there would require already having one. Issuance belongs on the
// authenticated founder surface.
//
// The key is rendered in this response and never redirected, because only its
// hash is stored and there is nothing to read back — and because a secret in a
// URL lands in request logs, in history, and in a referrer.

settingsRoutes.post('/settings/api-keys', requireCompanyCapability('can_manage_company'), async (c) => {
  const founder = c.get('founder');
  const ctx = await getLayoutContext(founder, 'settings', 'Settings', undefined, c);
  if (!ctx.productId) return c.redirect('/settings');

  const body = await c.req.parseBody({ all: true });
  const rawScopes = body.scope;
  const scopes = (Array.isArray(rawScopes) ? rawScopes : rawScopes == null ? [] : [rawScopes]).map(String);
  const days = Number(body.days ?? 90);

  const { issueApiKey } = await import('../../services/api/api-key-issuance.js');
  const issued = await issueApiKey({
    productId: ctx.productId, founderId: founder.id as string,
    label: String(body.label ?? ''), scopes,
    days: Number.isFinite(days) ? days : undefined,
  });
  if ('refused' in issued) {
    return c.html(dashboardLayout(ctx, html`
      <div class="card">
        <h3>Key not issued</h3>
        <p>${issued.refused === 'scopes_required'
          ? 'Choose at least one thing the key may do.'
          : issued.refused === 'label_required'
            ? 'Give the key a name so you can recognise it later.'
            : 'That request was refused.'}</p>
        <a href="/settings" class="btn btn-secondary btn-sm">Back to settings</a>
      </div>`));
  }

  return c.html(dashboardLayout(ctx, html`
    <div class="card">
      <h3>Copy this key now</h3>
      <p style="font-size:0.87rem;color:var(--text-muted);">
        It is shown once. Foundry stored only a hash of it, so nobody — including
        Foundry — can show it to you again. If you lose it, withdraw it and issue
        another.
      </p>
      <input type="text" readonly value="${issued.key}"
        style="width:100%;font-family:monospace;font-size:0.8rem;cursor:pointer;"
        onclick="this.select()" />
      <p style="font-size:0.8rem;color:var(--text-dim);margin-top:0.75rem;">
        <strong>${issued.label}</strong> — ${issued.scopes.join(', ')} ·
        expires ${issued.expiresAt.slice(0, 10)}
      </p>
      <a href="/settings" class="btn btn-secondary btn-sm">Back to settings</a>
    </div>`));
});

// ─── Portfolio principals (owner decision §12) ───────────────────────────────
//
// A CREDENTIAL WITH NO WAY IN IS A SENTENCE IN A MIGRATION, and this campaign
// has found that shape four times. The ecosystem routes now require a principal
// scoped to named companies rather than possession of one global secret, which
// means those routes serve nobody until one can be issued. This is the way in.
//
// THE EXCEPTIONAL BOUNDARY, not an ordinary company capability. A credential
// that reads SEVERAL companies at once is the same kind of act as ending a
// subscription or archiving a product: nothing grants it, and being able to
// manage a company is not the same as being able to mint a portfolio key over
// it. `requireOwner()` asks that of the selected company; the service then
// requires ownership of EVERY company named in the body, and a database trigger
// requires it again — because the service check is a property of one function
// while the trigger is a property of the table, and ownership can change after
// issuance.

settingsRoutes.post('/settings/portfolio-principals', requireOwner(), async (c) => {
  const founder = c.get('founder');
  const ctx = await getLayoutContext(founder, 'settings', 'Settings', undefined, c);

  const body = await c.req.parseBody({ all: true });
  const raw = body.company;
  const companyIds = (Array.isArray(raw) ? raw : raw == null ? [] : [raw]).map(String);
  const days = Number(body.days ?? 90);

  const { issueEcosystemPrincipal } = await import(
    '../../services/institution/ecosystem-principal.js');
  const issued = await issueEcosystemPrincipal({
    founderId: founder.id as string,
    label: String(body.label ?? ''),
    companyIds,
    days: Number.isFinite(days) ? days : undefined,
  });

  if ('refused' in issued) {
    return c.html(dashboardLayout(ctx, html`
      <div class="card">
        <h3>Principal not issued</h3>
        <p>${issued.refused === 'companies_required'
          ? 'Choose at least one company it may read. There is no "all companies" option, deliberately.'
          : issued.refused === 'label_required'
            ? 'Give it a name so you can recognise who holds it.'
            : 'One of those companies is not yours to grant.'}</p>
        <a href="/settings" class="btn btn-secondary btn-sm">Back to settings</a>
      </div>`));
  }

  return c.html(dashboardLayout(ctx, html`
    <div class="card">
      <h3>Copy this key now</h3>
      <p style="font-size:0.87rem;color:var(--text-muted);">
        Shown once. Foundry stored only a hash, so nobody — including Foundry —
        can show it again. It reads the companies listed below and no others.
      </p>
      <input type="text" readonly value="${issued.key}"
        style="width:100%;font-family:monospace;font-size:0.8rem;cursor:pointer;"
        onclick="this.select()" />
      <p style="font-size:0.8rem;color:var(--text-dim);margin-top:0.75rem;">
        <strong>${issued.label}</strong> — ${issued.companyIds.length} ${issued.companyIds.length === 1 ? 'company' : 'companies'} ·
        expires ${issued.expiresAt.slice(0, 10)}
      </p>
      <a href="/settings" class="btn btn-secondary btn-sm">Back to settings</a>
    </div>`));
});

settingsRoutes.post('/settings/portfolio-principals/:id/revoke', requireOwner(), async (c) => {
  const founder = c.get('founder');
  const { revokeEcosystemPrincipal } = await import(
    '../../services/institution/ecosystem-principal.js');
  await revokeEcosystemPrincipal(c.req.param('id'), founder.id as string);
  return c.redirect('/settings');
});

settingsRoutes.post('/settings/api-keys/:id/revoke', requireCompanyCapability('can_manage_company'), async (c) => {
  const founder = c.get('founder');
  const ctx = await getLayoutContext(founder, 'settings', 'Settings', undefined, c);
  if (!ctx.productId) return c.redirect('/settings');
  const { revokeIssuedApiKey } = await import('../../services/api/api-key-issuance.js');
  await revokeIssuedApiKey({
    productId: ctx.productId, founderId: founder.id as string, keyId: c.req.param('id'),
  });
  return c.redirect('/settings');
});

// ─── Add Additional Product ──────────────────────────────────────────────────

settingsRoutes.get('/settings/add-product', async (c) => {
  return c.redirect('/onboarding');
});

// ─── Subscription Management (Stripe Customer Portal) ───────────────────────

settingsRoutes.post('/settings/manage-subscription', requireOwner(), async (c) => {
  const founder = c.get('founder');
  if (!founder.stripe_customer_id) return c.redirect('/settings?error=no_subscription');

  const stripeKey = process.env.STRIPE_SECRET_KEY;
  if (!stripeKey) return c.redirect('/settings?error=billing_unavailable');

  try {
    const appUrl = process.env.APP_URL ?? 'http://localhost:8080';
    const portalUrl = await createBillingPortalSession(founder.stripe_customer_id, `${appUrl}/settings`);
    return c.redirect(portalUrl);
  } catch (err) {
    console.error('[BILLING] Portal session failed:', err);
    return c.redirect('/settings?error=billing_error');
  }
});

// ─── Wisdom Toggle ────────────────────────────────────────────────────────────

settingsRoutes.post('/settings/wisdom-toggle', requireCompanyCapability('can_manage_company'), async (c) => {
  const founder = c.get('founder');
  const body = await c.req.parseBody() as Record<string, string>;
  const optedIn = body.opted_in === '1' ? 1 : 0;

  await query(
    'UPDATE founders SET wisdom_network_opted_in = ? WHERE id = ?',
    [optedIn, founder.id]
  );

  return c.redirect('/settings');
});

// ─── Cadence mode ───────────────────────────────────────────────────────────
//
// The other half of migration 070's weekend mode. `can_manage_company` rather
// than ownership: how fast the company's agents run is company configuration,
// and a co-founder invited to manage it should be able to change it.
settingsRoutes.post('/settings/cadence-mode',
  requireCompanyCapability('can_manage_company'), async (c) => {
    const founder = c.get('founder');
    const ctx = await getLayoutContext(founder, 'settings', 'Settings', undefined, c);
    if (!ctx.productId) return c.redirect('/settings');
    const body = await c.req.parseBody() as Record<string, string>;
    // A closed vocabulary with one meaningful value; anything else is the
    // standard pace. Writing NULL rather than 'standard' would make "never set"
    // and "explicitly standard" the same fact, and the scheduler already treats
    // both the same — but the settings page has to be able to tell them apart
    // to render the toggle honestly.
    const mode = body.mode === 'weekend' ? 'weekend' : 'standard';
    await query('UPDATE products SET cadence_mode = ? WHERE id = ?', [mode, ctx.productId]);
    return c.redirect('/settings');
  });

// ─── Company Pause / Resume ─────────────────────────────────────────────────

settingsRoutes.post('/settings/pause-company', requireOwner(), async (c) => {
  const founder = c.get('founder');
  const { getCookie } = await import('hono/cookie');
  const cookieProductId = getCookie(c, 'foundry_product');

  if (!cookieProductId) return c.redirect('/settings');

  // Verify ownership before pausing
  const ownership = await query(
    'SELECT id FROM products WHERE id = ? AND owner_id = ?',
    [cookieProductId, founder.id]
  );
  if (ownership.rows.length === 0) return c.redirect('/settings');

  // The OPERATING axis only. This used to write `status='paused'` as well, and
  // `status` is the lifecycle axis — so pausing a company also removed it from
  // the population that administration reads: the entitlement sweep, account
  // mail, billing notices. A founder who paused their company and then had a
  // card declined would have been told nothing.
  await query(
    "UPDATE products SET scp_status = 'paused', updated_at = datetime('now') WHERE id = ? AND owner_id = ?",
    [cookieProductId, founder.id]
  );

  return c.redirect('/settings?success=company_paused');
});

settingsRoutes.post('/settings/resume-company', requireOwner(), async (c) => {
  const founder = c.get('founder');
  const { getCookie } = await import('hono/cookie');
  const cookieProductId = getCookie(c, 'foundry_product');

  if (!cookieProductId) return c.redirect('/settings');

  // Verify ownership before resuming
  const ownership = await query(
    'SELECT id FROM products WHERE id = ? AND owner_id = ?',
    [cookieProductId, founder.id]
  );
  if (ownership.rows.length === 0) return c.redirect('/settings');

  // Resuming lifts the founder's own pause. It does NOT lift a billing pause:
  // `entitlement_paused_at` belongs to the sweep and is untouched here, so a
  // founder cannot resume their way out of an unpaid account.
  await query(
    "UPDATE products SET scp_status = 'active', updated_at = datetime('now') WHERE id = ? AND owner_id = ?",
    [cookieProductId, founder.id]
  );

  return c.redirect('/settings?success=company_resumed');
});

// ─── Toggle Product Status (Pause/Resume from Manage Company UI) ─────────────

settingsRoutes.post('/settings/toggle-product-status', requireOwner(), async (c) => {
  const founder = c.get('founder');
  const body = await c.req.parseBody() as Record<string, string>;
  const productId = body.product_id;

  if (!productId) return c.redirect('/settings');

  // Verify ownership
  const prodResult = await query(
    'SELECT id, scp_status FROM products WHERE id = ? AND owner_id = ?',
    [productId, founder.id]
  );
  if (prodResult.rows.length === 0) return c.redirect('/settings');

  // Read and write the SAME axis. This read `status` and wrote both, which is
  // how the lifecycle axis came to carry an operating decision.
  const paused = (prodResult.rows[0] as Record<string, string>).scp_status === 'paused';
  const newScpStatus = paused ? 'active' : 'paused';

  await query(
    "UPDATE products SET scp_status = ?, updated_at = datetime('now') WHERE id = ? AND owner_id = ?",
    [newScpStatus, productId, founder.id]
  );

  return c.redirect(`/settings?success=company_${paused ? 'resumed' : 'paused'}`);
});

// ─── Fluency (one product, many voices) ───────────────────────────────────────
settingsRoutes.post('/settings/fluency', async (c) => {
  const founder = c.get('founder');
  const body = await c.req.parseBody() as Record<string, string>;
  const { setFluency } = await import('../../services/ux/fluency.js');
  await setFluency(founder.id, body.fluency as 'plain' | 'balanced' | 'technical');
  return c.redirect('/settings');
});
