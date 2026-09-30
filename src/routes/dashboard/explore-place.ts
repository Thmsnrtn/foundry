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

    ${sectionHead('How far each idea got', 'all time')}
    ${funnel(x.stages)}

    ${sectionHead('In flight', x.work.length ? String(x.work.length) : null)}
    ${x.work.length ? html`<div class="missions">${x.work.map(missionCard)}</div>`
      : emptyState('Nothing is being explored. Tell Foundry what to look for, in the box below.',
        'Find a low-maintenance digital product I could test this month for under $100.')}

    ${sectionHead('Trading', 'simulation only')}
    <p>${x.trading.observing
      ? `${String(x.trading.observing)} research question${x.trading.observing === 1 ? '' : 's'} being watched.`
      : 'No trading research is running.'}
      No capital is at risk: there is no way for Foundry to place an order. <a href="/foundry/money/research">The research</a></p>

    ${sectionHead('Turned down, and why', x.turnedDown.n ? String(x.turnedDown.n) : null)}
    ${x.turnedDown.recent.length ? html`<ul class="plain">${x.turnedDown.recent.map((b) => html`<li><b>${b.headline}</b>
      <span class="dim">${b.when}${b.reference ? ' · reference material' : ''}</span><br />${b.why}${b.revisitIf ? html` <span class="quiet">Worth another look if ${b.revisitIf}.</span>` : ''}</li>`)}</ul>`
      : html`<p class="quiet">Nothing has been turned down yet.</p>`}

    <p class="quiet"><a href="${ADDRESSES.missions}">${LABELS.missions}</a> (${String(x.allWork)} in flight) ·
      <a href="/foundry/searching">The search</a> · <a href="/foundry/experiments">Experiments</a></p>`;
  return c.html(page(LABELS.explore, body, 'explore', frame));
});
