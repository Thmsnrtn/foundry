// =============================================================================
// FOUNDRY — Settings Route
// =============================================================================

import { isPrivateOwnerInstance } from '../../lib/instance-posture.js';
import { Hono } from 'hono';
import { html } from 'hono/html';
import { getCookie } from 'hono/cookie';
import type { AuthEnv } from '../../middleware/auth.js';
import { query } from '../../db/client.js';
import { createBillingPortalSession, createCheckoutSession } from '../../services/billing/stripe.js';
import { page } from '../../views/owner/shell.js';
import type { Where } from '../../views/owner/shell.js';

/**
 * SETTINGS IS CONTROLS, SO IT LIGHTS THE CONTROLS DOOR.
 *
 * These pages govern what Foundry may do and who holds a key to it — the
 * question Controls exists to answer — but they rendered in the other visual
 * system, reached only from inside the Letter. They are the same place, so
 * they say so: the door lights, the trail reads Foundry › Controls › Settings,
 * and the way back is the rail rather than a Back link unique to this page.
 */
function controlsWhere(ctx: { title: string }): Where {
  return {
    eyebrow: 'Controls',
    crumbs: [
      { href: '/foundry', label: 'Foundry' },
      { href: '/foundry/controls', label: 'Controls' },
      { href: '/settings', label: ctx.title },
    ],
    scope: { kind: 'foundry', id: null, name: 'the estate' },
    local: [], chips: [],
  };
}

const controlsPage = (ctx: { title: string }, body: Parameters<typeof page>[1]): ReturnType<typeof page> =>
  page(ctx.title, body, 'controls', controlsWhere(ctx));
import { getLayoutContext, selectedProductId } from './_shared.js';
import { requireCompanyCapability, requireOwner } from '../../middleware/rbac.js';
import { nanoid } from 'nanoid';
import { randomBytes } from 'crypto';

export const settingsRoutes = new Hono<AuthEnv>();

// ─── Checkout → Stripe ──────────────────────────────────────────────────────


settingsRoutes.get('/settings', async (c) => {
  const founder = c.get('founder');
  const ctx = await getLayoutContext(founder, 'settings', 'Settings', undefined, c);

  const products = await query('SELECT id, name, github_repo_url, website_url, ingest_token, status, scp_status FROM products WHERE owner_id = ?', [founder.id]);

  // Use the cookie-selected product (consistent with ctx.productId), fall back to first
  const cookieProductId = getCookie(c, 'foundry_product');
  const selectedProduct = cookieProductId
    ? (products.rows.find((r) => (r as Record<string, string>).id === cookieProductId) as Record<string, string> | undefined)
    : undefined;
  const firstProduct = selectedProduct ?? (products.rows.length > 0 ? (products.rows[0] as Record<string, string>) : null);
  const productId = firstProduct?.id ?? null;
  const ingestToken = firstProduct?.ingest_token ?? null;
  // Read without the credential: nothing that renders a page has a reason to
  // decrypt an API key.
  const { getSendingIdentitySummary } = await import('../../services/outbound/sending-identity.js');
  const sendingIdentity = firstProduct
    ? await getSendingIdentitySummary(String(firstProduct.id))
    : null;
  const sendingError = c.req.query('sending_error') ?? null;
  const etsyError = c.req.query('etsy_error') ?? null;
  const { appCredentialFor } = await import('../../services/senses/app-credential.js');
  const etsyApp = await appCredentialFor('etsy');
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

  // Success banner for settings actions
  const successParam = c.req.query('success');
  const successMessages: Record<string, string> = {
    company_paused: 'Product paused. All agent activity and data ingestion are suspended.',
    company_resumed: 'Product resumed. Agent activity and data ingestion are active.',
    interruption_ceiling: 'Saved. Foundry will not reach you more loudly than that.',
  };
  const successBannerMsg = successParam ? successMessages[successParam] ?? null : null;

  const content = html`
    ${successBannerMsg ? html`<div class="state ok" style="display:block;padding:0.75rem 1.25rem;margin-bottom:1.5rem;font-size:0.875rem;font-weight:500;">${successBannerMsg}</div>` : ''}
    <h1>Settings</h1>
    ${/* PROFILE, CONNECTED REPOSITORIES, COMPETITORS AND BETA INFRASTRUCTURE,
         DELETED with the settingsPage component. Three of the four were Commercial
         Foundry's audit product: repositories it scanned, competitors it
         tracked, and a beta-intake surface whose table was dropped in
         migration 309. In this instance the repositories table does not exist
         at all and competitors holds zero rows.
         The fourth was Profile — name, email and TIER, read-only. The
         identity belongs to the auth provider and cannot be edited here, and
         the tier is the subscription that went with the product. A card that
         shows three facts you cannot change, one of which is about a plan
         nobody is on, is not a setting. */ ''}
    ${/* SUBSCRIPTION, DELETED. Three price buttons and a Stripe customer
         portal for Commercial Foundry's tiers. It was already hidden on this
         instance by the posture check, which is a different thing from being
         gone: the code, the /checkout routes and the tier vocabulary were all
         still here, one environment variable away from rendering. Private
         Foundry has one owner who does not bill himself. */ ''}

    <div class="card">
      <h3>Products</h3>
      <p style="font-size:0.87rem;color:var(--ink-3);margin-bottom:0.75rem;">You have ${products.rows.length} product(s) connected.</p>
      ${(products.rows as unknown as Array<Record<string, string>>).map((p) => html`
        <div style="display:flex;justify-content:space-between;align-items:center;padding:0.5rem 0;border-bottom:1px solid var(--line);">
          <div>
            <strong>${p.name}</strong>
            ${p.github_repo_url ? html`<span style="font-size:0.75rem;color:var(--ink-3);margin-left:0.5rem;">${p.github_repo_url}</span>` : ''}
            ${p.website_url ? html`<span style="font-size:0.75rem;color:var(--ink-3);margin-left:0.5rem;">${p.website_url}</span>` : ''}
          </div>
          <a href="/foundry/companies/${p.id}" class="btn btn-secondary btn-sm" style="font-size:0.75rem;">View</a>
        </div>`)}
      <a href="/onboarding" class="btn btn-primary btn-sm" style="margin-top:0.75rem;">+ Add Product</a>
    </div>

    ${/* Manage Company (F-061-A) */ ''}
    <div class="card" style="border:1px solid rgba(255,255,255,0.08);">
      <h3>Manage Company</h3>
      <p style="font-size:0.87rem;color:var(--text-muted);margin-bottom:1rem;">
        Pause, export, or delete your products. These actions apply to your currently selected product${products.rows.length > 1 ? ' — switch products above to target a different one' : ''}.
      </p>

      ${productId ? html`
      <div style="display:flex;flex-direction:column;gap:1rem;">
        ${/* Pause / Resume */ ''}
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

        ${/* Export Data */ ''}
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

        ${/* Delete */ ''}
        <div style="display:flex;align-items:center;justify-content:space-between;padding:0.75rem 1rem;background:rgba(255,107,107,0.04);border-radius:8px;border:1px solid rgba(255,107,107,0.12);">
          <div>
            <div style="font-size:0.875rem;font-weight:600;color:var(--bad);">Delete Product</div>
            <div style="font-size:0.78rem;color:var(--text-dim);">Permanently remove this product and all data after a 30-day grace period.</div>
          </div>
          <a href="/privacy" class="btn btn-sm" style="color:var(--bad);border-color:var(--bad);" aria-label="Go to privacy settings to delete product">Delete</a>
        </div>

        ${products.rows.length > 1 ? html`
        ${/* Fleet-wide actions */ ''}
        <div style="border-top:1px solid rgba(255,255,255,0.06);padding-top:1rem;margin-top:0.25rem;">
          <div style="font-size:0.72rem;font-weight:700;letter-spacing:0.1em;text-transform:uppercase;color:var(--text-muted);margin-bottom:0.5rem;">Fleet-wide</div>
          <div style="display:flex;gap:0.5rem;flex-wrap:wrap;">
            <a href="/settings/export-all" class="btn btn-ghost btn-sm" aria-label="Export all products data">Export All Products</a>
            <a href="/settings/delete-all-products" class="btn btn-ghost btn-sm" style="color:var(--bad);" aria-label="Delete all products">Delete All Products</a>
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
      <h3>How loudly Foundry may interrupt you</h3>
      <p style="font-size:0.8rem;color:var(--text-muted);margin:0.25rem 0 0.75rem;">
        The loudest channel Foundry may ever use. It can go quieter than this on
        its own — when you are strained, it does — but never louder. Push is the
        only channel that interrupts your life.
      </p>
      <form method="POST" action="/settings/interruption-ceiling" style="display:flex;gap:0.5rem;flex-wrap:wrap;">
        ${(['log', 'letter', 'notification', 'push'] as const).map((ch) => html`
          <button type="submit" name="max_channel" value="${ch}"
            class="btn ${((founder.preferences?.max_channel ?? 'push') === ch) ? 'btn-primary' : 'btn-ghost'}"
            style="font-size:0.8rem;text-transform:capitalize;">
            ${ch === 'log' ? 'Log only' : ch === 'letter' ? 'The letter' : ch === 'notification' ? 'In-app' : 'Push'}
          </button>`)}
      </form>
    </div>

    <div class="card">
      <h3>How often I run</h3>
      ${/* THIS CARD WAS CALLED "WISDOM NETWORK" AND MOSTLY WAS NOT ONE.
           Its framing offered to contribute anonymised decision patterns to a
           cross-product wisdom layer so that "your AI recommendations benefit
           from patterns across all contributing businesses" — a promise that
           needs other businesses. There is one owner here, the two benchmark
           tables are both empty, and the percentile floor requires five
           distinct contributors, so the toggle offered to join a network of
           one. (No backticks in this comment on purpose: it sits inside a
           template literal, and check-backticks-in-embedded-comments exists
           because one of them ends the string early.)
           What was real in it is the pace control, which decides how often the
           institution acts on his behalf. That is an Attention Law question,
           so it keeps the card and the card gets its actual name. */ ''}
      ${productId ? html`
      <div class="row" style="justify-content:space-between;flex-wrap:nowrap;gap:var(--s3);">
        <div>
          <div style="font-weight:500;">Weekend pace</div>
          <div style="font-size:0.85rem;color:var(--ink-2);">This is a side project — run the agents weekly, not daily</div>
        </div>
        <form method="POST" action="/settings/cadence-mode" style="display:flex;align-items:center;">
          <input type="hidden" name="mode" value="${weekendMode ? 'standard' : 'weekend'}" />
          <label class="toggle" title="${weekendMode ? 'Back to the standard pace' : 'Slow every agent to weekly'}">
            <input type="checkbox" ${weekendMode ? 'checked' : ''} data-submits />
            <span class="toggle-track"></span>
            <span class="toggle-thumb"></span>
          </label>
        </form>
      </div>` : ''}
    </div>

    ${/* INVESTOR / ADVISOR ACCESS, DELETED. A generated link giving a
         read-only view of Signal score, metrics and recent decisions to
         "investors or advisors". Private Foundry has neither, and zero of the
         thirteen products in this instance had ever had a share token
         generated, so the control offered to revoke an access nobody held.
         /share stays mounted because it also carries the refund links an
         Apex Micro buyer uses, which is a different thing entirely. */ ''}

    ${productId ? html`
    <div class="card">
      <h3>Metric Ingest</h3>
      <p style="font-size:0.87rem;color:var(--text-muted);margin-bottom:1rem;">
        A secret URL your tools can POST to — Stripe webhooks, Zapier, cron jobs, or your own pipeline.
        Foundry maps the fields to your metrics and reads them on its next pass.
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
            data-select
          />
          <button
            class="btn btn-secondary btn-sm"
            data-copy="ingest-url-input"
          >Copy</button>
        </div>
      </div>
      <details style="margin-bottom:0.75rem;">
        <summary style="font-size:0.82rem;color:var(--text-dim);cursor:pointer;">Example payload</summary>
        <pre>{
  "mrr": 52000,
  "new_mrr": 4500,
  "churned_mrr": 200,
  "activation_rate": 0.34,
  "day_30_retention": 0.68,
  "churn_rate": 0.02,
  "nps_score": 42,
  "active_users": 87,
  "signups_7d": 23
}</pre>
        <p style="font-size:0.78rem;color:var(--text-dim);margin:0.35rem 0 0;">
          MRR values in dollars. Rates as decimals (0.34 = 34%).
          <strong>"mrr" is what you bill in total this month; "new_mrr" is only
          the part of it that is new business.</strong> Send both if you have
          both — the total is what your investor materials and forecasts read,
          and the movement is what revenue health is measured from. Sending
          neither is fine; sending the total under the wrong name is not, which
          is why they are spelled out here.
        </p>
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
      <p style="font-size:0.82rem;color:var(--bad);margin:0 0 0.75rem;">${sendingError}</p>` : ''}
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

    <div class="card">
      <h3>Etsy application key</h3>
      <p style="font-size:0.87rem;color:var(--text-muted);margin-bottom:0.75rem;">
        This says which application is asking. It does <strong>not</strong> give access to any
        shop \u2014 connecting a shop is a separate act, with its own consent screen and its own
        read-only permissions. Both halves are needed: Etsy checks the pair on every request.
      </p>
      ${etsyApp ? html`
      <p style="font-size:0.82rem;color:var(--text-dim);margin:0 0 0.75rem;">
        Placed, and Etsy confirmed it as application ${etsyApp.providerAccountRef}
        on ${etsyApp.verifiedAt.slice(0, 10)}. Stored encrypted; it is never shown again.
      </p>` : html`
      <p style="font-size:0.82rem;color:var(--text-dim);margin:0 0 0.75rem;">
        Not placed \u2014 nothing here can ask Etsy anything until it is.
      </p>`}
      ${etsyError ? html`
      <p style="font-size:0.82rem;color:var(--bad);margin:0 0 0.75rem;">${etsyError}</p>` : ''}
      <form method="POST" action="/settings/app-credential/etsy" style="margin-top:0.75rem;display:grid;gap:0.5rem;max-width:26rem;">
        <!-- VISIBLE ON PURPOSE, and only this half. The keystring is an
             identifier, not a secret: it travels in the open as \`client_id\` on
             the very consent URL the owner is about to look at. Hiding it
             behind dots protects nothing and costs the one thing that matters
             when a 24-character string is being pasted on a phone — being able
             to see that it arrived whole. The shared secret is the half that
             authenticates, and it stays hidden. -->
        <input type="text" name="keystring" required autocomplete="off"
          spellcheck="false" autocapitalize="off" placeholder="Keystring" />
        <input type="password" name="shared_secret" required autocomplete="off" placeholder="Shared secret" />
        <p style="font-size:0.78rem;color:var(--text-dim);margin:0;">
          Paste each into its own box, not the joined <code>keystring:secret</code> form Etsy
          shows in its examples. I check the pair with Etsy before keeping it, so a wrong one
          is refused here rather than at the consent screen.
        </p>
        <button type="submit" class="btn btn-secondary btn-sm">
          ${etsyApp ? 'Replace the key' : 'Place the key'}
        </button>
      </form>
      ${etsyApp ? html`
      <form method="POST" action="/settings/app-credential/etsy/forget" style="margin-top:0.5rem;">
        <button type="submit" class="btn btn-secondary btn-sm">Forget it</button>
      </form>` : ''}
    </div>

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
      <div style="margin-bottom:1rem;padding:0.75rem;border:1px solid var(--line);border-radius:6px;">
        <div style="font-size:0.8rem;color:var(--text-dim);margin-bottom:0.35rem;">
          Copy this now — it is shown once here, and afterwards only on this page.
        </div>
        <input type="text" readonly value="${mintedSecret}"
          style="width:100%;font-size:0.78rem;font-family:monospace;cursor:pointer;" data-select />
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
              <div style="color:var(--alert);font-size:0.76rem;margin-top:0.2rem;">
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
  return c.html(controlsPage(ctx, content));
});

// ─── Stripe Checkout ─────────────────────────────────────────────────────────


// ─── Share Token Generation ───────────────────────────────────────────────────


// ─── Ingest Token Generation ──────────────────────────────────────────────────

settingsRoutes.post('/settings/generate-ingest', requireCompanyCapability('can_manage_company'), async (c) => {
  const founder = c.get('founder');
  // Rotating an ingest token is a change to how a named company reports its
  // own numbers. `LIMIT 1` with no ORDER BY rotated it on whichever company
  // SQLite returned first.
  const productId = await selectedProductId(c, founder.id);
  if (!productId) return c.redirect('/settings?error=no_company_selected');

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

/**
 * THE APPLICATION KEY FOR A MARKETPLACE, PLACED BY HAND AND VERIFIED FIRST.
 *
 * It identifies this deployment to Etsy. It grants access to no shop: that is a
 * separate act with its own consent screen and its own scopes. So this refuses
 * to store anything until Etsy confirms the pair works — the same rule the
 * sending identity above follows, for the same reason. "He typed something" and
 * "the provider accepts it" are different facts, and only the second is worth
 * keeping.
 *
 * `openapi-ping` is what makes that possible: it takes the key, no OAuth token,
 * costs nothing and causes nothing, and answers with the application id.
 */
/**
 * WHERE HE MAY BE SENT AFTERWARDS, AND NOWHERE ELSE.
 *
 * A redirect target that arrives in a form field is a redirect target an
 * attacker can choose, and the whole value of an open redirect is that the
 * host in the address bar is still this one when the next page asks for
 * something. So this does not sanitise a URL — it refuses anything that is not
 * a path into the Foundry shell.
 *
 * `//evil.test` is the case worth naming: a browser reads it as a
 * protocol-relative URL and leaves, while a check for a leading slash reads it
 * as a path and lets it through. Requiring the literal prefix `/foundry/` and
 * allowing only word characters, slashes and hyphens after it excludes that,
 * a scheme, a backslash, and a `?` or `#` that would smuggle one.
 */
export function safeBackPath(asked: string): string {
  return /^\/foundry\/[\w/-]*$/.test(asked) ? asked : '/settings';
}

settingsRoutes.post('/settings/app-credential/etsy', requireCompanyCapability('can_manage_company'), async (c) => {
  const founder = c.get('founder');
  const body = await c.req.parseBody() as Record<string, string>;
  const { setAppCredential } = await import('../../services/senses/app-credential.js');
  const placed = await setAppCredential({
    provider: 'etsy',
    secret: {
      keystring: String(body.keystring ?? ''),
      sharedSecret: String(body.shared_secret ?? ''),
    },
    by: `founder:${String(founder.id)}`,
  });
  // WHERE HE WAS WHEN HE NEEDED THIS. The key is a prerequisite of connecting a
  // shop, so the form is offered inside that flow as well as here, and a
  // prerequisite that dumps you somewhere else once you satisfy it has not
  // finished helping. Only a path on this host, and never a protocol-relative
  // one — `//evil.test` is a path to a browser and an open redirect to anyone
  // else. An unrecognised `back` is not an error worth showing him; it just
  // means he lands here.
  const back = safeBackPath(String(body.back ?? ''));
  const sep = back.includes('?') ? '&' : '?';
  if ('failed' in placed) {
    return c.redirect(`${back}${sep}etsy_error=${encodeURIComponent(placed.ownerWords)}`);
  }
  return c.redirect(`${back}${sep}etsy=placed&app=${encodeURIComponent(placed.providerAccountRef)}`);
});

settingsRoutes.post('/settings/app-credential/etsy/forget', requireCompanyCapability('can_manage_company'), async (c) => {
  const { forgetAppCredential } = await import('../../services/senses/app-credential.js');
  await forgetAppCredential('etsy', 'the owner removed it from settings');
  return c.redirect('/settings?etsy=forgotten');
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
    return c.html(controlsPage(ctx, html`
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

  return c.html(controlsPage(ctx, html`
    <div class="card">
      <h3>Copy this key now</h3>
      <p style="font-size:0.87rem;color:var(--text-muted);">
        It is shown once. Foundry stored only a hash of it, so nobody — including
        Foundry — can show it to you again. If you lose it, withdraw it and issue
        another.
      </p>
      <input type="text" readonly value="${issued.key}"
        style="width:100%;font-family:monospace;font-size:0.8rem;cursor:pointer;" data-select />
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
    return c.html(controlsPage(ctx, html`
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

  return c.html(controlsPage(ctx, html`
    <div class="card">
      <h3>Copy this key now</h3>
      <p style="font-size:0.87rem;color:var(--text-muted);">
        Shown once. Foundry stored only a hash, so nobody — including Foundry —
        can show it again. It reads the companies listed below and no others.
      </p>
      <input type="text" readonly value="${issued.key}"
        style="width:100%;font-family:monospace;font-size:0.8rem;cursor:pointer;" data-select />
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


// ─── Wisdom Toggle ────────────────────────────────────────────────────────────


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

// ─── Interruption ceiling ────────────────────────────────────────────────────
//
// `preferences.max_channel` is honoured by `decideChannel`, described by the
// interruption module as the thing that "always wins", and cited by two other
// modules as the reason they check before reaching a phone. Nothing ever wrote
// it: `fluency` was the only key any code path put into `founders.preferences`,
// so the ceiling branch was dead and every founder sat permanently at push.
//
// A control the product calls the person's own, which the person cannot
// exercise, is a claim about a control. This is where they exercise it.
// NO COMPANY CAPABILITY, and the same reason as `/settings/fluency` beside it:
// this writes the AUTHENTICATED FOUNDER'S OWN row and changes nothing about
// what Foundry may do to the company. It can only bound how loudly Foundry
// reaches this person, and the delivery policy may still go quieter on its own.
settingsRoutes.post('/settings/interruption-ceiling', async (c) => {
  const founder = c.get('founder');
  const body = await c.req.parseBody() as Record<string, string>;
  const { setMaxChannel } = await import('../../services/ux/interruption.js');
  await setMaxChannel(founder.id, body.max_channel as 'log' | 'letter' | 'notification' | 'push');
  return c.redirect('/settings?success=interruption_ceiling');
});

// ─── Fluency (one product, many voices) ───────────────────────────────────────
settingsRoutes.post('/settings/fluency', async (c) => {
  const founder = c.get('founder');
  const body = await c.req.parseBody() as Record<string, string>;
  const { setFluency } = await import('../../services/ux/fluency.js');
  await setFluency(founder.id, body.fluency as 'plain' | 'balanced' | 'technical');
  return c.redirect('/settings');
});
