// =============================================================================
// FOUNDRY — IF YOU STEPPED AWAY
//
// The question the owner actually wants answered about an institution he does
// not work at: can I leave it alone, and for how long?
//
// Home already answers the week. This page answers the harder version, at the
// three horizons he named — seven days, thirty days, ninety — and against the
// five properties an absence is a test of: is what I would find still TRUE, is
// what happened still BOUNDED, does the money still ADD UP, could this be PUT
// BACK if it broke, and would the things waiting for me be MINE.
//
// EVERY LINE IS A READ. Nothing here schedules, alerts, acts or spends; the
// test for a quiet institution must itself be quiet, and this page can be
// refreshed all day for nothing.
//
// AND THE SECOND HALF: WHAT THINKING COSTS. An institution that is cheap to
// leave alone is one whose running cost is understandable and falling, not one
// whose bill grows quietly while nobody reads it. The cognition section says
// what was spent, on which model, what asked itself whether it was worth
// thinking about at all, and how often the answer was no.
// =============================================================================

import { Hono } from 'hono';
import { html, raw } from 'hono/html';
import { page } from './foundry-shell.js';
import type { Where } from './foundry-shell.js';
import {
  absenceHorizons, type AbsenceReading, type Finding, type PropertyReading,
} from '../../services/institution/absence-test.js';
import { cognitionEconomics } from '../../services/ai/cognition.js';
import { whatThatWorkIs } from '../../services/ai/what-it-is-for.js';
import { FRONTIER_WARRANTS } from '../../lib/frontier-warrant.js';

export const absenceRoutes = new Hono();

const frame: Where = {
  eyebrow: 'If you stepped away',
  crumbs: [
    { href: '/foundry', label: 'Foundry' },
    { href: '/foundry/absence', label: 'If you stepped away' },
  ],
  scope: { kind: 'foundry', id: null, name: 'If you stepped away' }, local: [], chips: [],
};

/** The word, and the class that colours it. Three states, never two. */
const WORD: Record<Finding, { word: string; cls: string }> = {
  HOLDS: { word: 'holds', cls: 'ok' },
  DOES_NOT_HOLD: { word: 'does not hold', cls: 'bad' },
  CANNOT_ESTABLISH: { word: 'I cannot tell', cls: 'watch' },
};

const dollars = (cents: number): string => `$${(cents / 100).toFixed(2)}`;

function property(p: PropertyReading) {
  const w = WORD[p.finding];
  return html`<li>
    <b>${p.question}</b> <span class="state ${w.cls}">${w.word}</span>
    <p>${p.sentence}</p>
    ${p.evidence.length === 0 ? '' : html`<details>
      <summary class="quiet">What I read</summary>
      <ul>${raw(p.evidence.map((e) => `<li>${e}</li>`).join(''))}</ul>
    </details>`}
    ${p.wouldFixIt.length === 0 ? '' : html`<p class="quiet">What would fix it:
      ${p.wouldFixIt.join('; ')}.</p>`}
  </li>`;
}

function horizon(r: AbsenceReading) {
  const failing = r.properties.filter((p) => p.finding === 'DOES_NOT_HOLD').length;
  return html`<div class="know horizon horizon-${String(r.days)}">
    <h2>${String(r.days)} days — back on ${r.returnsOn}</h2>
    <p class="lede">${r.verdict}</p>
    <ul class="sales">${r.properties.map(property)}</ul>
    ${failing === 0 ? '' : html`<p class="quiet">${String(failing)} of five would not hold over
      this long. A property that holds for a week and fails at ninety days is not a property
      that holds; it is one nobody had asked the longer question.</p>`}
  </div>`;
}

absenceRoutes.get('/foundry/absence', async (c: any) => {
  const founder = c.get('founder') as { id?: string } | undefined;
  const founderId = founder?.id ? String(founder.id) : null;
  if (!founderId) return c.redirect('/onboarding');

  const readings = await absenceHorizons(founderId);
  const thinking = await cognitionEconomics(30);

  const anyFailure = readings.some((r) => r.properties.some((p) => p.finding === 'DOES_NOT_HOLD'));
  const lede = anyFailure
    ? 'A week is one question and three months is another. Where the answer changes with the '
      + 'length of the absence, that is said rather than smoothed over.'
    : 'The same five questions at three lengths. Nothing here is a promise about the future — '
      + 'it is what the records imply about an absence starting today.';

  const body = html`
    <h1>If you stepped away</h1>
    <p class="lede">${lede}</p>

    <div class="absence-horizons">${readings.map(horizon)}</div>

    <div class="know cognition-economics">
      <h2>What thinking costs</h2>
      <p class="lede">${thinking.sentence}</p>
      ${thinking.byModel.length === 0 ? html`<p class="quiet">Nothing settled in the last
        ${String(thinking.days)} days.</p>` : html`<ul>
        ${thinking.byModel.map((m) => html`<li>${m.model.replace('anthropic/claude-', '')} —
          ${String(m.calls)} ${m.calls === 1 ? 'call' : 'calls'}, ${dollars(m.cents)}</li>`)}
      </ul>`}
      ${/* THE SAME MONEY, BY WHAT IT WAS FOR. The list above answers the
           question about the provider; this answers the one about the
           institution, which is the one he is actually asking. It was
           unanswerable for seventy per cent of the spend until every call site
           had to name its work. Rows written before that say so rather than
           being folded into an "other", because a total that disagrees with
           the ledger is how a summary stops being worth reading. */ ''}
      ${thinking.byWork.length === 0 ? '' : html`<details>
        <summary class="quiet">What the thinking was for</summary>
        <ul>${thinking.byWork.map((w) => html`<li>${w.work === null
    ? html`<span class="quiet">not recorded — spent before every call had to say</span>`
    : html`${w.work}`} —
          ${String(w.calls)} ${w.calls === 1 ? 'call' : 'calls'}, ${dollars(w.cents)}${w.work === null
    ? '' : html`<br /><span class="quiet">${whatThatWorkIs(w.work) ?? ''}</span>`}</li>`)}</ul>
      </details>`}
      ${thinking.considered.length === 0 ? html`<p class="quiet">Nothing yet asks itself whether
        it is worth thinking about. The machinery for that exists; one loop uses it.</p>`
    : html`<ul class="sales">${thinking.considered.map((l) => html`<li>
        <b>${l.cognition.replace(/_/g, ' ')}</b>
        <p>${String(l.thought)} ${l.thought === 1 ? 'time' : 'times'} I thought about it,
          ${String(l.slept)} ${l.slept === 1 ? 'time' : 'times'} I did not, and it changed
          something ${String(l.changedSomething)}
          ${l.changedSomething === 1 ? 'time' : 'times'}.</p>
        ${l.sleptBecause ? html`<p class="quiet">Commonest reason for not:
          ${l.sleptBecause}.</p>` : ''}
      </li>`)}</ul>`}
      ${thinking.notSpentCents === null ? '' : html`<p class="quiet">About
        ${dollars(thinking.notSpentCents)} not spent because something decided there was nothing
        worth thinking about. An estimate, from what the same question cost when it did think.</p>`}
      ${/* READ FROM THE TABLE, NOT RESTATED FROM IT. A page that says "eleven
           files, each with an argument" is a sentence somebody typed; a page
           that lists them is the argument itself, and it cannot drift from the
           build gate that enforces it. */ ''}
      <details>
        <summary class="quiet">Where the most expensive model is reached, and why
          (${String(FRONTIER_WARRANTS.length)}
          ${FRONTIER_WARRANTS.length === 1 ? 'place' : 'places'})</summary>
        <ul class="sales">${FRONTIER_WARRANTS.map((w) => html`<li>
          <b>${w.question}</b>${w.watched ? html` <span class="state watch">watched</span>` : ''}
          <p class="quiet">${w.warrant}</p>
          <p class="quiet">${w.file}</p>
        </li>`)}</ul>
      </details>
      <p class="quiet">It costs five times the operational model and twenty-five times the cheap
        one, so each of those places has to say what would go wrong if the answer were wrong and
        how often it is asked — and the build refuses a new one without both. In the fortnight to
        14 September 2026 it was two per cent of this bill, so the saving that matters here is not
        the model: it is the calls not made.</p>
    </div>

    <div class="know">
      <h2>Why this is a page and not a score</h2>
      <p class="quiet">Five properties, three horizons, and no number that averages them. An
        institution that is truthful and unrecoverable is not seventy per cent fine, and a single
        figure is exactly how the one thing wrong with it would disappear.</p>
    </div>`;

  return c.html(page('If you stepped away', body, 'controls', frame));
});
