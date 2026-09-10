// =============================================================================
// THE DOOR MAIL COMES THROUGH.
//
// Public by necessity — the edge program calls it from Cloudflare's network,
// not from inside anything — and therefore treated as hostile by default. It
// authenticates a shared secret, accepts one message, and returns. It cannot
// read Foundry state, cannot act, and cannot be made to do either by anything
// in the body: everything it accepts is data on its way to becoming a row.
//
// What it deliberately does not do: reply, echo the body back, reveal whether
// a sender is known, reveal whether the address exists, or say anything a
// prober could use to map the institution. One answer for every caller who
// knows the key, one for every caller who does not.
// =============================================================================
import type { Hono } from 'hono';

const MAX_BODY = 1_500_000;

/**
 * Mounted inside the ingest door rather than as a surface of its own. That door
 * already is the authenticated, tenant-bound intake primitive — migration 131
 * said so when it declined to invent a second one — and the Attention Law is
 * right that a new top-level mount is a new thing to know about.
 */
export function mountWorkshopMail(app: Hono): void {
  // NO CAPABILITY GUARD, DELIBERATELY, AND THIS IS WHY. The caller is a program
  // at Cloudflare's edge with no owner session and no company context, so an
  // owner or capability check could not pass and would only mean the Workshop
  // never hears anybody. It authenticates with its own secret, and — the part
  // that matters — the route cannot raise what Foundry may do. It creates one
  // row of evidence. It moves no money, sends nothing, changes no
  // infrastructure and grants no permission; the only state it can reach that
  // constrains anything is the do-not-contact list, which it can only ADD to.
  // A door that can only ever narrow the institution's freedom needs no
  // capability, and giving it one would be theatre.
  app.post('/workshop/mail', async (c) => {
  const key = c.req.header('x-workshop-intake') ?? '';
  const { earsFor } = await import('../services/public-workshop/mail.js');
  const founderId = await earsFor(key);
  // The same shape of refusal whether the key is absent, malformed or wrong.
  if (!founderId) return c.json({ ok: false }, 401);

  let payload: Record<string, unknown>;
  try {
    const text = await c.req.text();
    if (text.length > MAX_BODY) return c.json({ ok: false, reason: 'too large' }, 413);
    payload = JSON.parse(text) as Record<string, unknown>;
  } catch { return c.json({ ok: false, reason: 'unreadable' }, 400); }

  try {
    // ONE READING, SHARED WITH REPLAY. A message recovered from the Workshop's
    // own store after an outage must become the same message as one that
    // arrived live, or an outage would quietly change what somebody said.
    const { ingestEdgeRecord } = await import('../services/public-workshop/mail.js');
    const heard = await ingestEdgeRecord(founderId, payload);
    // Enough for the edge to know it landed, and nothing about who or what.
    return c.json({ ok: true, duplicate: heard.duplicate });
  } catch {
    // A message we could not take is a message the Workshop still holds: the
    // edge wrote it into its own store before calling here, and replay will
    // find it. Report failure without explaining it.
    return c.json({ ok: false }, 500);
  }
  });
}
