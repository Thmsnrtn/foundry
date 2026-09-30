// =============================================================================
// FOUNDRY — Explore: what Foundry is looking at for the owner.
//
// One of the four doors (INSTITUTION_MODEL §8, §9). It binds to one read model,
// `exploreSummary`, and holds no state or controls of its own: the search is
// still steered on its own page, a test is still stopped from its own Stop,
// and a sentence typed in the composer is still read by the one compiler. The
// page answers four questions in order — what is being looked for, how far
// each idea got, what is in flight, and what was turned down and why.
// =============================================================================
import { Hono } from 'hono';
import { html } from 'hono/html';
import { page, type Where } from '../../views/owner/shell.js';
import { ADDRESSES, LABELS } from '../../views/owner/labels.js';
import { emptyState, funnel, missionCard, sectionHead } from '../../views/owner/components.js';
import { exploreSummary } from '../../services/explore/summary.js';

export const exploreRoutes = new Hono();

const frame: Where = {
  eyebrow: LABELS.explore,
  crumbs: [{ href: ADDRESSES.foundry, label: 'Foundry' }, { href: ADDRESSES.explore, label: LABELS.explore }],
  scope: { kind: 'foundry', id: null, name: LABELS.explore },
  local: [], chips: [],
};

exploreRoutes.get('/foundry/explore', async (c: any) => {
  const founder = c.get('founder') as { id?: string } | undefined;
  if (!founder?.id) return c.redirect('/onboarding');
  const x = await exploreSummary(String(founder.id));
  const body = html`
    <h1>${LABELS.explore}</h1>
    <p class="lede">${x.search
      ? html`Looking for: <b>${x.search.statement}</b> <span class="dim">since ${x.search.since}</span>`
      : 'Foundry is not looking for anything new right now.'}
      ${x.work.length ? ` ${String(x.work.length)} piece${x.work.length === 1 ? '' : 's'} of work in flight here.` : ''}</p>
    ${x.search && x.search.avoid.length
      ? html`<p class="quiet">Kept out of the search, because you said so: ${x.search.avoid.join('; ')}.</p>` : ''}
    ${x.mandate.focus.length || x.mandate.paused.length ? html`<ul class="plain" aria-label="What your Mandate says about where to look">
      ${x.mandate.focus.map((f) => html`<li><b>${f.label}:</b> looking harder, because you asked <span class="dim">(${f.lasting})</span></li>`)}
      ${x.mandate.paused.map((f) => html`<li><b>${f.label}:</b> paused by your Mandate <span class="dim">(${f.lasting})</span></li>`)}
    </ul><p class="quiet"><a href="/foundry/controls#mandate">Change what you want</a></p>` : ''}

    ${sectionHead('How far each idea got', 'all time')}
    ${funnel(x.stages)}

    ${sectionHead('In flight', x.work.length ? String(x.work.length) : null)}
    ${x.work.length ? html`<div class="missions">${x.work.map(missionCard)}</div>`
      : emptyState('Nothing is being explored. Tell Foundry what to look for, in the box below.',
        'Find a low-maintenance digital product I could test this month for under $100.')}

    ${sectionHead('Trading', 'no money at risk')}
    <ul class="mandate-list trading-worlds" aria-label="Trading, in its three worlds">
      <li><span class="mandate-what"><b>Simulation</b> <span class="status ${x.trading.observing ? 'go' : 'done'}">${x.trading.observing ? 'Running' : 'Not running'}</span></span>
        <span class="mandate-when dim">${String(x.trading.forecasts)} forecast${x.trading.forecasts === 1 ? '' : 's'} sealed before the window closed, ${String(x.trading.resolved)} scored against what happened${x.trading.verdict ? `; so far: ${x.trading.verdict}` : ''}.</span></li>
      <li><span class="mandate-what"><b>Paper</b> <span class="status done">${String(x.trading.paperFills)} simulated</span></span>
        <span class="mandate-when dim">Trades filled against the real order book on paper. No money moves.</span></li>
      <li><span class="mandate-what"><b>Live</b> <span class="status back">Does not exist</span></span>
        <span class="mandate-when dim">There is no way for Foundry to place an order. No sentence, Mission or setting can create one.</span></li>
    </ul>
    <p class="quiet">No capital is at risk.${x.mandate.tradingTheoretical ? ' You asked for it to stay theoretical, and it does.' : ''} <a href="/foundry/money/research">The research</a></p>

    ${sectionHead('Turned down, and why', x.turnedDown.n || x.turnedDown.parked ? `${String(x.turnedDown.n)} for good · ${String(x.turnedDown.parked)} parked` : null)}
    ${x.turnedDown.recent.length ? html`<ul class="plain">${x.turnedDown.recent.map((b) => html`<li><b>${b.headline}</b>
      <span class="dim">${b.when}${b.reference ? ' · reference material' : ''}</span><br />${b.why}${b.revisitIf ? html` <span class="quiet">Worth another look if ${b.revisitIf}.</span>` : ''}</li>`)}</ul>`
      : html`<p class="quiet">Nothing has been turned down yet.</p>`}

    <p class="quiet"><a href="${ADDRESSES.missions}">${LABELS.missions}</a> (${String(x.allWork)} in flight) ·
      <a href="/foundry/searching">The search</a> · <a href="/foundry/experiments">Experiments</a></p>`;
  return c.html(page(LABELS.explore, body, 'explore', frame));
});
