// =============================================================================
// FOUNDRY — Establishing the institution
//
// THIS WAS "GitHub connection → repo selection → competitors → first audit",
// and nine routes long. It was the funnel a SaaS customer walked to bring a
// product in to be audited, and it is deleted along with the product it sold.
// What is left is the one act a private owner actually needs: naming the first
// company and binding it to the `foundry` identity so the institution can
// observe itself.
// =============================================================================

import { requireInstitutionOwner } from '../../middleware/rbac.js';
import { isPrivateOwnerInstance } from '../../lib/instance-posture.js';
import { Hono } from 'hono';
import type { AuthEnv } from '../../middleware/auth.js';
import { query } from '../../db/client.js';
import { page } from '../../views/owner/shell.js';
import { html } from 'hono/html';
import { getLayoutContext } from './_shared.js';

export const onboardingRoutes = new Hono<AuthEnv>();

// ─── Establishing the institution's first company ────────────────────────────
//
// WHAT THE OWNER MET INSTEAD, AND WHY IT WAS WRONG.
//
// A private owner arriving at his own institution with nothing established was
// shown a four-step customer funnel: Connect GitHub → Select Repository →
// Identify Competitors → First Audit, opening "First, Foundry gets to know your
// product so it can give you an honest health check". That is onboarding for a
// SaaS customer bringing a product to be audited. There was no way to say "this
// institution is mine and it begins with Foundry" — the company existed only as
// a side effect of completing the funnel, and the funnel's first requirement
// was a GitHub OAuth app this deployment does not have configured.
//
// So the owner could not establish anything at all, and the recursion could not
// begin, because `resolveFoundryProductId()` needs a product row that nothing
// could create.
//
// WHAT THIS DOES, AND DELIBERATELY DOES NOT DO. It writes the smallest true
// thing: a company named Foundry, owned by the owner, bound to the canonical
// `foundry` identity so self-observation can resolve it. No agents are
// provisioned, no audit is run, no competitors are invented and no knowledge is
// fabricated. The institution is allowed to say it knows almost nothing yet,
// because that is the truth and the alternative is a richer-looking lie.
const establishedFoundry = (companyName: string) => html`
  <section style="max-width:640px;">
    <h1 style="margin:0 0 0.4rem;">Begin with Foundry</h1>
    <p style="color:var(--text-muted);font-size:0.9rem;line-height:1.6;margin:0 0 1.25rem;">
      This institution is yours and nothing is established in it yet. The first company it
      should understand is the one you are standing in.
    </p>
    <div class="card" style="padding:1.25rem;">
      <div style="font-size:0.95rem;color:var(--text-primary);font-weight:600;">${companyName}</div>
      <div style="font-size:0.85rem;color:var(--text-muted);margin-top:0.5rem;line-height:1.6;">
        Establishing it records three true things and nothing more: that this company is
        Foundry, that you own it, and that Foundry may begin observing itself. It will know
        very little else until you connect a sense.
      </div>
      <form method="POST" action="/onboarding/establish" style="margin-top:1rem;">
        <button type="submit" class="btn btn-primary">Establish ${companyName}</button>
      </form>
      <div style="font-size:0.75rem;color:var(--text-dim);margin-top:0.85rem;line-height:1.55;">
        No agents are started, nothing is audited and no model is called. Connecting the
        repository afterwards lets Foundry <em>observe</em> its own software — observing is
        not permission to change anything, and changing requires a separate, expiring grant
        you issue in Controls.
      </div>
    </div>
  </section>`;

// `requireInstitutionOwner()` rather than `requireOwner()`: the latter asks
// whether you own the SELECTED company and answers 400 when none is selected,
// which is every caller of this route by definition. The posture check below
// answers "is this deployment private" and cannot stand in for "may this caller
// found a company" — one is about the deployment, the other about the principal.
// AT /onboarding/establish, NOT /establish, AND THE REASON IS A BUG THIS HAD.
//
// It first lived at /establish — a new top-level path — and top-level paths in
// this app inherit nothing. `/onboarding/*` carries authMiddleware; `/establish`
// did not, so `c.get('founder')` was undefined, and the owner pressing the only
// button on his own first screen was told he was not the owner. The guard
// failed closed correctly; the route was simply never authenticated.
//
// The concept is distinct from onboarding, but the protections are not worth
// re-deriving per path. Under this prefix it inherits auth and CSRF that are
// already right, and there is one fewer door for the next route to forget.
onboardingRoutes.post('/onboarding/establish', requireInstitutionOwner(), async (c) => {
  const founder = c.get('founder');
  if (!isPrivateOwnerInstance()) return c.redirect('/onboarding');

  const { resolveFoundryProductId, establishSystemIdentity, FOUNDRY_IDENTITY_KEY } =
    await import('../../services/system-identity.js');

  // Idempotent by the institution's own rule: an identity that is already bound
  // does not move, so pressing this twice orients rather than duplicates.
  const existing = await resolveFoundryProductId();
  if (existing) return c.redirect('/foundry');

  const { nanoid } = await import('nanoid');
  const productId = nanoid();
  await query(
    `INSERT INTO products (id, name, owner_id, status) VALUES (?, ?, ?, 'active')`,
    [productId, 'Foundry', String(founder.id)]);
  await query(
    `INSERT INTO lifecycle_state (product_id, current_prompt, risk_state)
     VALUES (?, 'prompt_1', 'green')`, [productId]).catch(() => { /* optional */ });
  await establishSystemIdentity(FOUNDRY_IDENTITY_KEY, productId,
    'owner established the institution\'s first company');

  return c.redirect('/foundry');
});

onboardingRoutes.get('/onboarding', async (c) => {
  const founder = c.get('founder');
  const ctx = await getLayoutContext(founder, '', 'Get Started');

  // The owner of a private institution is not a prospect evaluating a product.
  // THERE IS NOTHING ELSE TO ONBOARD TO.
  //
  // This branched: the owner of a private institution got an establish page,
  // and everybody else got Commercial Foundry's wizard — a GitHub OAuth round
  // trip, repo selection, competitors and a first audit. That product is
  // deleted, so the second branch led to a funnel with nothing at the end of
  // it, and it minted an oauth_states row on every visit to get there.
  //
  // What remains is the institution's own establishment act, which is
  // idempotent by its own rule: an identity that is already bound does not
  // move, so arriving here twice orients rather than duplicates.
  const { resolveFoundryProductId } = await import('../../services/system-identity.js');
  if (!(await resolveFoundryProductId())) {
    return c.html(page(ctx.title, establishedFoundry('Foundry'), 'foundry'));
  }
  return c.redirect('/foundry');
});

// THE AUDIT PROGRESS PAGE WENT WITH THE AUDIT.
//
// Two functions drew it: a full page saying "Foundry is reading your codebase
// across ten dimensions and writing your first briefing. This usually takes 2-5
// minutes", and a fragment HTMX re-polled every 1500ms against
// `/onboarding/audit-status`. That route is deleted, so the page was polling a
// 404 four times a minute for as long as anyone left it open — and the thing it
// reported progress on was a ten-dimension audit of a GitHub repository this
// instance does not have.
//
// The audit ENGINE survives and is reachable; what is gone is the funnel step
// that ran one at a stranger's repository on the way to asking for a card.
