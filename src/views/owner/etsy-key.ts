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

/**
 * The address Etsy must be told about, as something to copy rather than read.
 * Derived from the request host by the caller, never from a setting.
 */
export function callbackAddress(uri: string): string {
  return '<div class="copyrow"><label for="etsy-callback">Callback URL &mdash; add it to '
    + 'your Etsy app&rsquo;s redirect URIs</label><div class="copyrow-field">'
    + `<input id="etsy-callback" type="text" readonly data-select value="${esc(uri)}" />`
    + '<button type="button" class="btn btn-sm" data-copy="etsy-callback">Copy</button>'
    + '</div></div>';
}

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

  // ONE LINE OF WHY, NOT THREE PARAGRAPHS. The owner read this block as a wall
  // of text in front of two boxes. What he needs before typing a secret is
  // where the values are and what they do not grant; the rest was the
  // institution explaining itself to itself.
  parts.push(
    '<p class="hint">From <a href="https://www.etsy.com/developers/your-apps" '
    + 'target="_blank" rel="noopener noreferrer">Your Apps</a> on Etsy. They name the app '
    + 'and do not give access to any shop &mdash; connecting the shop is its own step, '
    + 'with its own read-only consent.</p>');

  // THE STEP AT ETSY THAT NOTHING HERE CAN DO, said while he is still standing
  // at Etsy with the app open. Etsy refuses an authorization whose redirect_uri
  // is not registered, and that refusal arrives after both secrets were right —
  // the most expensive possible moment to learn it. A read-only field with a
  // Copy button, because on a phone a long address in running text is
  // something to select by hand and get wrong.
  if (s.redirectUri) parts.push(callbackAddress(s.redirectUri));

  parts.push(
    '<form method="POST" action="/settings/app-credential/etsy" class="stack key-form">'
    + `<input type="hidden" name="back" value="${esc(s.back)}" />`
    // VISIBLE ON PURPOSE, and only this half. The keystring is an identifier,
    // not a secret: it travels in the open as the client_id on the very consent
    // URL the owner is about to look at. Hiding it behind dots protects nothing
    // and costs the one thing that matters when a 24-character string is being
    // pasted on a phone — being able to see that it arrived whole. The shared
    // secret is the half that authenticates, and it stays hidden.
    + '<label>Keystring'
    + '<input type="text" name="keystring" required autocomplete="off" spellcheck="false" '
    + 'autocapitalize="off" placeholder="Paste the keystring" /></label>'
    + '<label>Shared secret'
    + '<input type="password" name="shared_secret" required autocomplete="off" '
    + 'placeholder="Paste the shared secret" /></label>'
    + '<p class="hint">Each into its own box. I check the pair with Etsy before keeping it.</p>'
    + `<button type="submit" class="btn go">${
      s.placedAs ? 'Replace the key' : 'Save and check with Etsy'}</button>`
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
