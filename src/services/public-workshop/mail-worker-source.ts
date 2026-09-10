// =============================================================================
// THE PROGRAM THAT HEARS, AT THE EDGE.
//
// It does two things, in this order, and the order is the whole design:
//
//   1. WRITE THE MESSAGE DOWN, into a store only Apex Micro can read.
//   2. Offer it to Foundry.
//
// WHY THE ORDER MATTERS. The property this program exists to guarantee is that
// a message is never silently lost because the institution happened to be
// down, redeploying, or slow. The first version bought that property by
// forwarding every message to the owner's personal mailbox first — which
// worked, and quietly made a private inbox part of Apex Micro's infrastructure.
// The property was never about the mailbox. It was about somewhere durable
// that is not Foundry. A store the Workshop already owns is that, without
// making anybody's private account load-bearing.
//
// WHAT HAPPENS WHEN THINGS FAIL, in order of preference:
//
//   store ok            → the message is safe; Foundry can be told now or later
//   store fails, POST ok → Foundry has it; degraded, but nothing is lost
//   both fail            → the sender is TOLD, with a rejection, so a person
//                          knows their message did not arrive
//
// The last case is the one that matters. An institution that can eat its own
// customers' mail while claiming to serve them is worse than one that cannot
// hear at all — so this never accepts a message it could not put anywhere.
//
// It reads nothing, decides nothing and answers nobody. Classification,
// suppression and every reply happen inside the institution, where authority
// lives. This is a recorder with a doorbell on it.
// =============================================================================

/**
 * Built as a string for the same reason the public site's program is: what is
 * deployed is what was reviewed, and a digest of this source is what the
 * receipt records. It never sees a Cloudflare token; its only secret is the
 * intake key, which can do nothing but hand Foundry a message.
 *
 * Its store binding is deliberately NOT the page store. That one is served to
 * the public internet by the site program, and mail in it would be mail on the
 * web.
 */
export const MAIL_WORKER_SOURCE = `
export default {
  async email(message, env, ctx) {
    const at = new Date().toISOString();
    const headers = {};
    try { for (const [k, v] of message.headers) headers[k.toLowerCase()] = v; } catch (e) {}
    const id = headers['message-id'] || ('no-id-' + at + '-' + Math.random().toString(36).slice(2));

    let raw = null;
    let size = message.rawSize || 0;
    try {
      const buf = await new Response(message.raw).arrayBuffer();
      size = buf.byteLength;
      // Base64 inflates by a third and a store value has a ceiling, so a very
      // large message is recorded without its body rather than not at all.
      if (buf.byteLength <= 12000000) {
        const bytes = new Uint8Array(buf);
        let s = '';
        for (let i = 0; i < bytes.length; i += 8192) {
          s += String.fromCharCode.apply(null, bytes.subarray(i, i + 8192));
        }
        raw = btoa(s);
      }
    } catch (e) {}

    const record = JSON.stringify({
      to: message.to, from: message.from, headers: headers,
      size: size, raw_base64: raw, at: at, held: raw === null ? 'headers only' : 'whole message',
    });

    // 1. DOWN IT GOES, first, into the Workshop's own store.
    //
    // The key is when it came and what it calls itself, so the institution can
    // tell what it already has without fetching every message back. A store key
    // has a length ceiling, and a Message-ID is written by the sender — so it
    // is trimmed to fit rather than allowed to make the write fail. A long name
    // must not be a way to stop the Workshop keeping what somebody sent.
    let stored = false;
    try {
      await env.MAIL.put('inbox/' + at + '/' + encodeURIComponent(id).slice(0, 440), record);
      stored = true;
    } catch (e) {}

    // 2. THEN THE DOORBELL. Bounded, so a slow intake cannot hold a delivery
    // open, and awaited only far enough to know whether it landed.
    let handed = false;
    try {
      const r = await fetch(env.INTAKE_URL, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-workshop-intake': env.INTAKE_KEY },
        body: record,
        signal: AbortSignal.timeout(10000),
      });
      handed = r.ok;
    } catch (e) {}

    // 3. IF IT WENT NOWHERE, SAY SO. A bounce is a person learning their
    // message did not arrive. Silence is a person believing it did.
    if (!stored && !handed) {
      message.setReject('Apex Micro could not accept this message; please try again shortly');
    }
  },
};
`.trim();
