// =============================================================================
// FOUNDRY — the root is a door, not a page
//
// THE OWNER'S INSTRUCTION, 13 SEPTEMBER 2026:
//
//   "The 'landing page' shouldn't be selling anything as the only applicable
//    landing page here is apex Micro for anyone that wants to learn more about
//    myself or private foundry. The only landing page private foundry should
//    have should be the whole public facing apex micro site."
//
// What stood here was 646 lines selling Commercial Foundry: a hero, three
// pricing tiers, thirty founding-rate slots, case studies, a manifesto, a help
// page, and a privacy policy and terms describing a SaaS with Clerk sign-in,
// GitHub repositories and a team of AI agents. That product was unmounted and
// then deleted. The page kept selling it.
//
// It was also a DUPLICATE of a real site that already works. apexmicro.ai is
// live, served by the Cloudflare Worker from `services/public-workshop/site.ts`,
// and already carries Home, About, What I've made, Contact, and its own
// Privacy, Terms, Refunds and email opt-out pages. Two public faces for one
// person is one public face too many, and the one that was lying is the one
// that had no customers.
//
// So Private Foundry has no landing page of its own. Its root is a door to the
// owner's instance, and `authMiddleware` on `/foundry` sends a visitor who is
// not signed in to `/auth/login`. That keeps one rule in one place rather than
// duplicating a session check into a public route — and it means a stranger who
// finds this hostname sees a sign-in form and learns nothing, which is correct:
// there is nothing here for them. What there is for them is at apexmicro.ai.
//
// WHAT WENT WITH THE PAGE, deliberately:
//
//   • `/pricing`, `/case-studies`, `/case-studies/:id`, `/manifesto`, `/help` —
//     the selling surface.
//   • `/privacy-policy` and `/terms` — a privacy policy and terms for a product
//     that no longer operates, unreferenced by anything in this codebase. Apex
//     Micro's `/privacy`, `/terms` and `/refunds` are the live ones and cover
//     the business that actually has customers. The AUTHENTICATED `/privacy`
//     dashboard — consent, export, deletion — is a different thing and stays.
//   • The `?ref=` referral capture that set a 30-day attribution cookie here.
//     Referral links were a growth mechanic for a product with a signup funnel.
//     `services/distribution/referrals.ts` survives — `middleware/auth.ts` and
//     `billing/stripe.ts` still call it — but nothing captures a click any
//     more, which is the honest state while there is nothing to refer anyone to.
// =============================================================================

import { Hono } from 'hono';

export const landingRoutes = new Hono();

landingRoutes.get('/', (c) => c.redirect('/foundry'));
