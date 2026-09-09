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
  const { earsFor, hearMail } = await import('../services/public-workshop/mail.js');
  const founderId = await earsFor(key);
  // The same shape of refusal whether the key is absent, malformed or wrong.
  if (!founderId) return c.json({ ok: false }, 401);

  let payload: Record<string, unknown>;
  try {
    const text = await c.req.text();
    if (text.length > MAX_BODY) return c.json({ ok: false, reason: 'too large' }, 413);
    payload = JSON.parse(text) as Record<string, unknown>;
  } catch { return c.json({ ok: false, reason: 'unreadable' }, 400); }

  const headers = (payload.headers ?? {}) as Record<string, string>;
  const s = (v: unknown): string => (typeof v === 'string' ? v : '');
  const raw = s(payload.raw_base64);
  const decoded = raw ? Buffer.from(raw, 'base64').toString('utf8') : '';

  try {
    const heard = await hearMail({
      founderId,
      to: s(payload.to), from: s(payload.from),
      fromName: nameFrom(s(headers.from)),
      subject: s(headers.subject) || null,
      body: textOf(decoded),
      rfcMessageId: s(headers['message-id']) || `<generated-${Date.now()}@intake>`,
      inReplyTo: s(headers['in-reply-to']) || null,
      references: s(headers.references) || null,
      spf: s(headers['received-spf']) || null,
      dkim: s(headers['dkim-signature']) ? 'present' : null,
      dmarc: s(headers['authentication-results']) || null,
      sentAt: s(headers.date) || null,
      size: typeof payload.size === 'number' ? payload.size : null,
    });
    // Enough for the edge to know it landed, and nothing about who or what.
    return c.json({ ok: true, duplicate: heard.duplicate });
  } catch {
    // A message we could not take is a message the owner still has: the edge
    // forwarded it before calling here. Report failure without explaining it.
    return c.json({ ok: false }, 500);
  }
  });
}

/** The display name, if the header carries one. Never trusted as identity. */
function nameFrom(fromHeader: string): string | null {
  const m = /^\s*"?([^"<]+?)"?\s*</.exec(fromHeader);
  return m ? m[1]!.trim() || null : null;
}

/**
 * THE TEXT A PERSON WROTE, out of the MIME a machine sent.
 *
 * Deliberately small and deliberately not a MIME library: it takes the first
 * text/plain part it can find, falls back to stripping tags, and truncates.
 * The whole message is kept verbatim upstream, so nothing here has to be
 * perfect — it only has to be safe. No HTML is stored for rendering, no
 * attachment is decoded, nothing is executed, and no external reference in the
 * message is fetched. An attachment that is never opened cannot run.
 */
function textOf(rawMime: string): string {
  if (!rawMime.trim()) return '(no readable body)';
  const body = rawMime.split(/\r?\n\r?\n/).slice(1).join('\n\n') || rawMime;
  const plain = /content-type:\s*text\/plain[\s\S]*?\r?\n\r?\n([\s\S]*?)(?:\r?\n--|\r?\n\.\r?\n|$)/i.exec(rawMime);
  const chosen = plain ? plain[1]! : body;
  const stripped = chosen
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/\r/g, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
  return (stripped || '(no readable body)').slice(0, 20_000);
}
