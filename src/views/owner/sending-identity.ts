// =============================================================================
// FOUNDRY — Who your customers hear from
//
// THE SECOND SECTION ON SETTINGS THAT WAS NEVER A SETTING.
//
// This is not a preference; it is a per-company credential that decides whose
// name arrives in a stranger's inbox. It lived on Settings, which holds none
// of a company's other facts, while the company page — the one place an owner
// goes to ask "what is true of this business" — said nothing about it at all.
//
// AND IT IS DELIBERATELY NOT A CONNECTOR, which is where the application key
// went and where the symmetry would have put this. Connectors is the reading
// surface, and it says so in as many words: "Publishing a listing, changing a
// price, messaging a customer and moving money each need their own permission,
// and none of them comes from this." A sending identity IS the permission to
// message a customer. Filing it there would have made that sentence false on
// the page that says it. Two credentials that look alike in a form are not
// alike in what they authorise, and the arrangement has to follow the second.
//
// CONNECTED IS NOT WORKING, and the block says which. A provider that accepted
// a key has told us the key parses, not that a message reached anybody.
// =============================================================================

const esc = (s: string): string => s
  .replace(/&/g, '&amp;').replace(/</g, '&lt;')
  .replace(/>/g, '&gt;').replace(/"/g, '&quot;');

export interface SendingIdentityView {
  /** What is on file, or null when nothing is. */
  identity: {
    fromEmail: string;
    fromName: string | null;
    provider: string;
    /** When the provider last accepted something. Null means never proved. */
    lastAcceptedAt: string | null;
  } | null;
  /** Where the forms post. The company page and Settings differ. */
  action: string;
  /** Where the disconnect posts. */
  disconnectAction: string;
  /** Where to return afterwards. */
  back?: string | null;
  /** The provider's refusal, in words he can act on. */
  error?: string | null;
}

export function sendingIdentityPlacement(v: SendingIdentityView): string {
  const parts: string[] = [];
  const backField = v.back
    ? `<input type="hidden" name="back" value="${esc(v.back)}" />` : '';

  parts.push(
    '<p style="font-size:0.87rem;color:var(--text-muted);margin-bottom:1rem;">'
    + 'Mail Foundry sends to <em>your customers</em> goes out as you &mdash; your domain, '
    + 'your reply address, your unsubscribe footer. It never goes out as Foundry. That '
    + 'means it needs your own email provider account, so the sending domain is one you '
    + 'have verified and the delivery reputation is yours. Mail Foundry sends to '
    + '<em>you</em> &mdash; briefings, alerts, billing &mdash; still comes from Foundry.</p>');

  if (v.identity) {
    const who = v.identity.fromName
      ? `${v.identity.fromName} <${v.identity.fromEmail}>`
      : v.identity.fromEmail;
    parts.push(
      `<p style="font-size:0.87rem;margin:0 0 0.5rem;">Sending as <strong>${esc(who)}</strong> `
      + `via ${esc(v.identity.provider)}.</p>`);
    // CONNECTED IS NOT WORKING. The distinction is the whole reason this line
    // exists, and it is the first thing a tidier card would lose.
    parts.push(
      '<p style="font-size:0.78rem;color:var(--text-dim);margin:0 0 0.75rem;">'
      + (v.identity.lastAcceptedAt
        ? `Last accepted by the provider ${esc(v.identity.lastAcceptedAt)}.`
        : 'Connected, but nothing has been sent through it yet &mdash; so it has not been '
          + 'proved to work.')
      + '</p>');
    parts.push(
      `<form method="POST" action="${esc(v.disconnectAction)}">${backField}`
      + '<button type="submit" class="btn btn-secondary btn-sm">Disconnect</button></form>'
      + '<p style="font-size:0.75rem;color:var(--text-dim);margin:0.5rem 0 0;">'
      + 'Disconnecting stops customer mail. It does not send it as Foundry instead.</p>');
  } else {
    parts.push(
      '<p style="font-size:0.82rem;color:var(--text-dim);margin:0 0 0.75rem;">'
      + 'Not connected &mdash; mail to your customers is refused until it is.</p>');
  }

  if (v.error) {
    parts.push(
      `<p style="font-size:0.82rem;color:var(--bad);margin:0 0 0.75rem;">${esc(v.error)}</p>`);
  }

  parts.push(
    `<form method="POST" action="${esc(v.action)}" `
    + 'style="margin-top:0.75rem;display:grid;gap:0.5rem;max-width:26rem;">'
    + backField
    + '<input type="email" name="from_email" required placeholder="you@yourdomain.com" '
    + `value="${esc(v.identity?.fromEmail ?? '')}" />`
    + '<input type="text" name="from_name" placeholder="Display name (optional)" '
    + `value="${esc(v.identity?.fromName ?? '')}" />`
    + '<input type="password" name="credential" required placeholder="Your Resend API key" />'
    + `<button type="submit" class="btn go">${
      v.identity ? 'Replace sending address' : 'Connect sending address'}</button>`
    + '</form>');

  return parts.join('\n');
}
