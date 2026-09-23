// =============================================================================
// FOUNDRY — Placing the Etsy application key
//
// ONE PLACEMENT, RENDERED WHEREVER THE OWNER ARRIVES NEEDING IT.
//
// This block existed twice in slightly different words: a card on Settings and
// an inline form on the company's revenue gap, written a month apart. Two
// copies of a credential form is two chances to describe a secret's handling
// differently, and they already did — one said the pair is "stored encrypted
// and never shown again", the other did not say it at all.
//
// It is here rather than in either route because a third surface now needs it:
// Connectors -> Etsy, which is the destination the owner reaches when he sets
// out to connect Etsy, and which until now could only tell him to go and do it
// elsewhere. A step named on the page that cannot be taken on the page is not
// a journey; it is a signpost.
//
// The block is CONTENT, not a card. Each surface wraps it in its own container
// idiom — `.card` on Settings, `.know` on the owner shell — so one vocabulary
// is not smuggled into another.
// =============================================================================

/**
 * Local, because owner views do not import from the public site. The values
 * escaped here are a provider-supplied application id, a provider's own words
 * on a refusal, and a redirect URI derived from the request host — none of
 * them written by this codebase, so none of them trusted as markup.
 */
const esc = (s: string): string => s
  .replace(/&/g, '&amp;').replace(/</g, '&lt;')
  .replace(/>/g, '&gt;').replace(/"/g, '&quot;');

export interface EtsyKeyPlacement {
  /** Etsy's `application_id` for the stored pair, or null when none is stored. */
  placedAs: string | null;
  /** Where the POST returns the owner to. A path on this host; never absolute. */
  back: string;
  /** Just saved, as the flash on the surface he returned to. */
  savedAs?: string | null;
  /** Just forgotten. */
  forgotten?: boolean;
  /** Etsy's refusal, in words he can act on. */
  error?: string | null;
  /**
   * The callback address to register at Etsy, shown only while it is still
   * useful. Foundry derives it from the request host rather than from a
   * setting, so the owner cannot guess it and nothing else would tell him.
   */
  redirectUri?: string | null;
}

const note = (kind: string, lead: string, rest: string): string =>
  `<div class="state ${kind}" style="display:block;padding:0.7rem 0.9rem;margin-bottom:0.9rem;`
  + `border-radius:8px;font-size:0.9rem;"><strong>${lead}</strong> ${rest}</div>`;

export function etsyKeyPlacement(s: EtsyKeyPlacement): string {
  const parts: string[] = [];

  // THE STATE FIRST, AND AT A SIZE HE CAN SEE. What a person needs on arriving
  // is where they are; what a thing means is what they need once they are
  // deciding, and that is what the prose below is for.
  if (s.savedAs) {
    parts.push(note('ok', 'Saved.',
      `Etsy checked the pair and confirmed it as application ${esc(s.savedAs)}. `
      + 'It is stored encrypted and will not be shown again.'));
  }
  if (s.forgotten) {
    parts.push(note('', 'Forgotten.', 'Nothing here can ask Etsy anything now.'));
  }
  if (s.error) {
    parts.push(note('bad', 'Not saved.', esc(s.error)));
  }
  if (!s.savedAs && s.placedAs) {
    parts.push(note('ok', 'The key is placed.',
      `Etsy confirmed it as application ${esc(s.placedAs)}. It is stored encrypted `
      + 'and will not be shown again.'));
  }

  parts.push(
    '<p style="font-size:0.87rem;color:var(--text-muted);margin-bottom:0.75rem;">'
    + 'Etsy gives every application a <strong>keystring</strong> and a <strong>shared '
    + 'secret</strong>, on your Etsy page under <em>Your Apps</em>. They say which '
    + 'application is asking. They do <strong>not</strong> give access to any shop &mdash; '
    + 'connecting a shop is a separate act, with its own consent screen and its own '
    + 'read-only permissions. Both halves are needed: Etsy checks the pair on every '
    + 'request.</p>');

  // THE STEP AT ETSY THAT NOTHING HERE CAN DO, said while he is still standing
  // at Etsy with the app open. Etsy refuses an authorization whose redirect_uri
  // is not registered, and that refusal arrives after both secrets were right —
  // the most expensive possible moment to learn it.
  if (s.redirectUri) {
    parts.push(
      '<p style="font-size:0.87rem;color:var(--text-muted);margin-bottom:0.4rem;">'
      + 'While you are there, add this exact address to the app&rsquo;s redirect URIs:</p>'
      + `<p><code style="display:block;overflow-wrap:anywhere;padding:0.5rem 0;">${
        esc(s.redirectUri)}</code></p>`
      + '<p style="font-size:0.78rem;color:var(--text-dim);margin:0 0 0.75rem;">Etsy will not '
      + 'send you back to an address it has not been told about. I work this one out from the '
      + 'address you are reading it on rather than from a setting, so it is right by '
      + 'construction &mdash; and it is the step that otherwise fails after both secrets '
      + 'were correct.</p>');
  }

  parts.push(
    '<form method="POST" action="/settings/app-credential/etsy" '
    + 'style="margin-top:0.75rem;display:grid;gap:0.5rem;max-width:26rem;">'
    + `<input type="hidden" name="back" value="${esc(s.back)}" />`
    // VISIBLE ON PURPOSE, and only this half. The keystring is an identifier,
    // not a secret: it travels in the open as the client_id on the very consent
    // URL the owner is about to look at. Hiding it behind dots protects nothing
    // and costs the one thing that matters when a 24-character string is being
    // pasted on a phone — being able to see that it arrived whole. The shared
    // secret is the half that authenticates, and it stays hidden.
    + '<input type="text" name="keystring" required autocomplete="off" spellcheck="false" '
    + 'autocapitalize="off" placeholder="Keystring" />'
    + '<input type="password" name="shared_secret" required autocomplete="off" '
    + 'placeholder="Shared secret" />'
    + '<p style="font-size:0.78rem;color:var(--text-dim);margin:0;">Paste each into its own '
    + 'box, not the joined <code>keystring:secret</code> form Etsy shows in its examples. '
    + 'I check the pair with Etsy before keeping it, so a wrong one is refused here rather '
    + 'than at the consent screen.</p>'
    + `<button type="submit" class="btn go">${
      s.placedAs ? 'Replace the key' : 'Place the key'}</button>`
    + '</form>');

  if (s.placedAs) {
    parts.push(
      '<form method="POST" action="/settings/app-credential/etsy/forget" '
      + 'style="margin-top:0.5rem;">'
      + `<input type="hidden" name="back" value="${esc(s.back)}" />`
      + '<button type="submit" class="btn btn-secondary btn-sm">Forget it</button></form>');
  }

  return parts.join('\n');
}
