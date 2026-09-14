// =============================================================================
// FOUNDRY — the one public, token-gated page: a buyer's refund
//
// This was the Investor / Advisor share route, a read-only view of a company's
// Signal score where the URL token was the secret. That page is deleted — see
// the note at the foot of this file — and what remains is the refund link an
// Apex Micro buyer receives with their delivery. Still public, still
// token-gated, still unauthenticated: the token is minted per fulfilment, and
// the point is that getting your money back should not require writing to
// anybody.
// =============================================================================

import { Hono } from 'hono';

export const shareRoutes = new Hono();

// TWO ESCAPERS FOR ONE PAGE. `escapeHtml` served the share page's tables of
// metrics and decisions and is gone with it; `esc` below is the refund page's
// own, and is the one the remaining two routes use.

// ─── A buyer's refund, by the link in the delivery ───────────────────────────
//
// The delivery mail carries one signed link. Opening it shows what was paid
// and asks once; confirming records the request and issues the refund through
// the governed door (services/venture/hand.ts). No account, no identity: the
// link is the proof, and it works for exactly one fulfilment.
const refundPage = (title: string, body: string) => `<!DOCTYPE html><html lang="en"><head><meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" /><title>${title}</title>
<style>body{font-family:system-ui,sans-serif;max-width:32rem;margin:2rem auto;padding:0 1rem;line-height:1.5;color:#1a1a1a}button{font:inherit;padding:.6rem 1rem;border-radius:.4rem;border:1px solid #1a1a1a;background:#1a1a1a;color:#fff}p.quiet{color:#555}</style>
</head><body>${body}</body></html>`;
const esc = (s: string) => s.replace(/[&<>"]/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[ch] ?? ch));

shareRoutes.get('/share/refund/:fulfilmentId/:token', async (c) => {
  const { describeRefundLink } = await import('../../services/venture/hand.js');
  const view = await describeRefundLink(c.req.param('fulfilmentId'), c.req.param('token'));
  if (!view) return c.notFound();
  const amount = `${view.currency === 'USD' ? '$' : ''}${(view.amountCents / 100).toFixed(2)}${view.currency === 'USD' ? '' : ` ${view.currency}`}`;
  if (view.alreadyRefunded) return c.html(refundPage('Refunded', `<h1>Already refunded</h1><p>The ${amount} you paid for ${esc(view.title)} has been refunded. Nothing more to do.</p>`));
  return c.html(refundPage('Refund', `<h1>Refund ${amount}?</h1>
<p>You paid ${amount} for <strong>${esc(view.title)}</strong>. If it was not what you needed, confirm below and the payment is refunded to the card you used. No questions asked.</p>
<form method="POST"><button type="submit">Refund my ${amount}</button></form>
<p class="quiet">This link works once, for this purchase only.</p>`));
});

// NO CAPABILITY IS ASKED HERE ON PURPOSE. The buyer is not a member of any
// company; the signed token in the link is the whole credential, verified by
// `describeRefundLink`, and the only thing this route can do is return the
// buyer's own money through the governed door. It lowers what Foundry holds.
shareRoutes.post('/share/refund/:fulfilmentId/:token', async (c) => {
  const { requestRefundByLink } = await import('../../services/venture/hand.js');
  const r = await requestRefundByLink(c.req.param('fulfilmentId'), c.req.param('token'));
  if (r.status === 'not_found' || !r.view) return c.notFound();
  const amount = `${r.view.currency === 'USD' ? '$' : ''}${(r.view.amountCents / 100).toFixed(2)}${r.view.currency === 'USD' ? '' : ` ${r.view.currency}`}`;
  if (r.status === 'refunded') return c.html(refundPage('Refunded', `<h1>Refunded</h1><p>${amount} is on its way back to your card. Most banks show it within 5–10 days.</p>`));
  if (r.status === 'already_refunded') return c.html(refundPage('Refunded', `<h1>Already refunded</h1><p>The ${amount} has already been refunded.</p>`));
  return c.html(refundPage('Refund requested', `<h1>Got it</h1><p>Your refund of ${amount} couldn't go through automatically just now. It's been noted and someone will sort it out — you don't need to write again.</p>`));
});

// ─── THE SHARE PAGE, DELETED — NOTHING COULD MINT ITS TOKEN ──────────────────
//
// `GET /share/:token` showed a company's Signal score, its latest metrics, its
// last five approved decisions and its lifecycle prompt to anyone holding the
// token. It was the read-only view an Investor-Ready subscriber gave to
// investors and advisors, and the control that generated and rotated the token
// lived in `/settings` under "Investor / Advisor Access".
//
// That control is deleted: Private Foundry has neither investors nor advisors,
// and zero of the thirteen products in this instance had ever had a token
// generated. With the generator gone nothing writes `products.share_token`, so
// this page could only ever have answered 404 — a public, unauthenticated
// surface that reads a company's decisions, kept alive for a credential that
// can no longer exist.
//
// WHAT STAYS IS THE REFUND. `/share/refund/:fulfilmentId/:token` above is a
// different thing entirely: its token is minted per fulfilment when an Apex
// Micro buyer is sent their delivery, and the page is how they get their money
// back without writing to anyone. That is a live surface with live tokens.

