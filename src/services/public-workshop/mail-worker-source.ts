// =============================================================================
// THE PROGRAM THAT HEARS, AT THE EDGE.
//
// Cloudflare delivers mail for the Workshop's address to this program instead
// of straight to the owner's mailbox. It does two things, in this order, and
// the order is the whole design:
//
//   1. FORWARD TO THE OWNER. Always, first, whatever else happens.
//   2. Offer a copy to Foundry.
//
// If Foundry is down, unreachable, redeploying, or refuses the copy, the mail
// has already gone where it was always going. The institution loses a copy;
// the person loses nothing, and neither does the owner. Nothing here can drop,
// bounce, or delay a message on Foundry's behalf — an institution that can eat
// its own customers' mail while claiming to serve them is worse than one that
// cannot hear at all.
//
// It reads nothing, decides nothing and answers nobody. Classification,
// suppression and every reply happen inside the institution, where authority
// lives. This is a pipe with a copy on it.
// =============================================================================

/**
 * Built as a string for the same reason the public site's program is: what is
 * deployed is what was reviewed, and a digest of this source is what the
 * receipt records. It never sees a Cloudflare token; its only secret is the
 * intake key, which can do nothing but hand Foundry a message.
 */
export const MAIL_WORKER_SOURCE = `
export default {
  async email(message, env, ctx) {
    // The owner's copy first, and unconditionally.
    let forwarded = 'ok';
    try {
      await message.forward(env.FORWARD_TO);
    } catch (e) {
      forwarded = 'failed: ' + (e && e.message ? e.message : String(e));
    }

    // Then the institution's copy, on a best-effort basis. Bounded, so a slow
    // or hanging intake cannot hold a mail delivery open.
    try {
      const raw = await new Response(message.raw).arrayBuffer();
      const size = raw.byteLength;
      // A very large message is reported without its body rather than dropped:
      // the institution should know it arrived even if it will not carry it.
      const body = size > 1000000 ? null : btoa(String.fromCharCode(...new Uint8Array(raw)));
      const headers = {};
      for (const [k, v] of message.headers) headers[k.toLowerCase()] = v;
      const payload = JSON.stringify({
        to: message.to,
        from: message.from,
        headers: headers,
        size: size,
        raw_base64: body,
        forwarded: forwarded,
        at: new Date().toISOString(),
      });
      const post = fetch(env.INTAKE_URL, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-workshop-intake': env.INTAKE_KEY },
        body: payload,
        signal: AbortSignal.timeout(10000),
      }).catch(function () { return null; });
      // waitUntil so the delivery is not held open by our own bookkeeping.
      if (ctx && ctx.waitUntil) ctx.waitUntil(post); else await post;
    } catch (e) {
      // Deliberately silent. The message is already with the owner, and this
      // program has no business turning an internal problem into a bounce.
    }
  },
};
`.trim();
