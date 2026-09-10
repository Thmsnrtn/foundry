// =============================================================================
// FOUNDRY — the only way a decision gets a button
//
// Every consequential control the owner sees is rendered here, from a
// `Consequence` that had to be computed before the page could exist. That is
// deliberate and it is enforced: no other file under src/routes may write a
// decision form by hand, because the failure of 10 September was not a missing
// sentence on one card — it was that a card could be written at all without
// saying where the act lands.
//
// FAIL CLOSED. A decision the institution cannot classify renders as a refusal
// with no button. Asking him to approve something it cannot describe is worse
// than asking him nothing.
// =============================================================================

import { html, raw } from 'hono/html';
import type { HtmlEscapedString } from 'hono/utils/html';
import {
  type CannotSay, type Consequence, effectInWords, isCannotSay, labelFor,
} from '../../services/founder/what-it-would-do.js';

function cash(cents: number): string {
  return cents === 0 ? '$0' : `$${(cents / 100).toFixed(2)}`;
}

const REVERSAL: Record<Consequence['reversibility'], string> = {
  reversible: 'Reversible',
  partly_reversible: 'Partly reversible',
  irreversible: 'Not reversible',
};

/**
 * ONE DECISION, WITH ITS CONSEQUENCE ATTACHED.
 *
 * `action` is where the form posts and `hidden` is what it carries. Neither can
 * conjure a button on its own: without a describable consequence there is no
 * form at all.
 */
export function renderDecision(input: {
  consequence: Consequence | CannotSay;
  action: string;
  hidden: Record<string, string>;
  /** Set where the page wants the primary emphasis; at most one per screen. */
  primary?: boolean;
}): HtmlEscapedString | Promise<HtmlEscapedString> {
  const c = input.consequence;
  if (isCannotSay(c)) {
    return html`<div class="decision unknown">
      <p><strong>I cannot show this as a decision.</strong> ${c.cannotSay}.</p>
      <p class="quiet">Nothing is offered here rather than offering you a button
        whose consequence I could not state.</p>
    </div>`;
  }

  // WHERE IT LANDS, BEFORE THE FACTS AND BEFORE THE BUTTON. Anything that is
  // not internal wears the warning colour: the eye has to be able to tell these
  // two classes apart across a page of cards, not only by reading them.
  const where = html`<p class="act"><span class="pill ${
  c.effect === 'internal' ? 'ok' : 'warn'}">${effectInWords(c.effect)}</span></p>`;

  const facts = html`${where}<dl class="facts">
    <dt>What happens</dt><dd>${c.what}.</dd>
    <dt>Where it lands</dt><dd>${effectInWords(c.effect)} &mdash; ${c.touches}.</dd>
    <dt>Cash</dt><dd>${c.expectedCents === 0 ? 'none expected' : `${cash(c.expectedCents)} expected`}, ${
  c.maxCents === 0 ? 'and none authorised' : `at most ${cash(c.maxCents)}`}.</dd>
    ${c.expires === null ? '' : html`<dt>Until</dt><dd>${c.expires}.</dd>`}
    <dt>Afterwards</dt><dd>${REVERSAL[c.reversibility]}.</dd>
  </dl>`;

  // ── A decision with a surface of its own is not offered a second time ──
  if (c.dedicated) {
    return html`<div class="decision elsewhere">
      ${facts}
      <p><strong>This one is decided on its own page</strong> &mdash; ${c.dedicated.why}.</p>
      <p><a class="btn" href="${c.dedicated.path}">Open the decision &mdash; ${labelFor(c)}</a></p>
    </div>`;
  }

  const not = c.doesNotAuthorise.length === 0 ? '' : html`<p class="quiet">Approving
    this does not authorise ${raw(c.doesNotAuthorise.join(', '))}. Each of those is
    a decision of its own, and you would be asked.</p>`;

  return html`<div class="decision">
    ${facts}
    <form method="POST" action="${input.action}">
      ${raw(Object.entries(input.hidden)
    .map(([k, v]) => `<input type="hidden" name="${k}" value="${v}" />`).join(''))}
      <button class="${input.primary ? 'btn go' : 'btn'}" type="submit">${labelFor(c)}</button>
    </form>
    ${not}
  </div>`;
}
