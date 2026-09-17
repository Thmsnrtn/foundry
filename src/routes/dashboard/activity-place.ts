// =============================================================================
// FOUNDRY — Activity, the estate's own stream.
//
// §8 lists ACTIVITY among the canonical owner surfaces and §22 says what it is:
// a meaningful institutional event stream, not logs, not every cron tick, not
// every model call. It was the last one that did not exist. Everything it shows
// was already recorded; it had simply never been assembled, so the owner could
// read what happened to a company or to an experiment and never what happened.
//
// WHAT THIS PAGE REFUSES TO BE. The concept board for it leads with a counter —
// "48 events today, +12% vs yesterday" — and carries rows like "system health
// check completed, no action required". There is no counter here. An event
// stream that reports its own volume trains the owner to read activity as
// progress, which is the first thing §1 says not to optimise for, and a stream
// that carries its own heartbeat buries the four rows a fortnight that matter.
//
// The filters are query parameters and plain links. No script, because a page
// whose whole job is to be read should not need one, and the owner surfaces
// serve a policy with no inline script at all.
// =============================================================================

import { Hono } from 'hono';
import { html } from 'hono/html';
import { page } from './foundry-shell.js';
import { ago, mark } from '../../views/owner/shell.js';
import type { Where } from './foundry-shell.js';
import { whatHappened, type ActivityKind, type InstitutionalEvent } from '../../services/founder/activity.js';

export const activityRoutes = new Hono();

async function founderOf(c: any): Promise<string | null> {
  const founder = c.get('founder') as { id?: string } | undefined;
  return founder?.id ? String(founder.id) : null;
}

/**
 * The classes, in the order they matter to somebody scanning.
 *
 * Authority first because every outward effect descends from one; boundaries
 * last because they are the rarest and the ones he will come looking for.
 */
const CLASSES: Array<[ActivityKind, string]> = [
  ['authority', 'Authority'],
  ['experiment', 'Experiments'],
  ['outward', 'Reached someone'],
  ['money', 'Money'],
  ['obligation', 'Promises'],
  ['boundary', 'Refused'],
];

const LABEL = new Map<ActivityKind, string>(CLASSES);

/** The day, and the time, separately — a stream is read by scanning down days. */
const dayOf = (at: string): string => String(at).slice(0, 10);
const timeOf = (at: string): string => String(at).slice(11, 16);

/**
 * A day's worth of rows under its own heading.
 *
 * Grouped rather than timestamped one by one because the question the owner is
 * actually asking is "what happened while I was away", and that is a question
 * about days.
 */
function byDay(events: InstitutionalEvent[]): Array<[string, InstitutionalEvent[]]> {
  const days = new Map<string, InstitutionalEvent[]>();
  for (const e of events) {
    const d = dayOf(e.at);
    const list = days.get(d);
    if (list) list.push(e);
    else days.set(d, [e]);
  }
  return [...days.entries()];
}

activityRoutes.get('/foundry/activity', async (c: any) => {
  const founderId = await founderOf(c);
  if (!founderId) return c.redirect('/onboarding');

  const asked = String(c.req.query('kind') ?? '');
  const only = CLASSES.some(([k]) => k === asked) ? asked as ActivityKind : null;

  const all = await whatHappened(founderId);
  const events = only ? all.filter((e) => e.kind === only) : all;

  const frame: Where = {
    eyebrow: 'Activity',
    crumbs: [{ href: '/foundry', label: 'Foundry' }, { href: '/foundry/activity', label: 'Activity' }],
    scope: { kind: 'foundry', id: null, name: 'Activity' },
    local: [],
    chips: [],
  };

  // ONLY CLASSES THAT HAPPENED. A filter for a kind with nothing in it is a
  // control that does nothing, and six of them across the top of an empty page
  // is a page pretending to have depth it does not have. Links rather than a
  // control, because the shell's chips are labels for what a place IS and these
  // change what it shows.
  const present = CLASSES.filter(([k]) => all.some((e) => e.kind === k));

  // THE ESTATE'S STATE, ABOVE THE STREAM — and deliberately not a count of
  // events. Health is a state with rows behind it; how many things happened
  // is not a number he should be taught to watch.
  const { healthOf } = await import('../../services/founder/health.js');
  const health = await healthOf(founderId);
  const healthCls = health.state === 'ok' ? 'ok' : health.state === 'degraded' ? 'watch' : 'bad';
  const EVENT_MARK: Record<ActivityKind, string> = { authority: 'check', experiment: 'experiment', outward: 'sent', money: 'money', obligation: 'box', boundary: 'stop' };
  const body = html`
    <h1>Activity</h1>
    <p class="lede">${only
    ? `${LABEL.get(only) ?? 'Everything'}, newest first.`
    : 'What actually happened, newest first. Not what I thought, and not that I was running.'}</p>
    <dl class="glance act-glance" aria-label="The estate, now">
      <div class="tile door"><dt class="k">${mark('estate')}Health</dt>
        <dd class="v"><span class="state ${healthCls}">${health.word}</span></dd>
        <dd class="d">${health.failed[0] ?? health.ownerAction ?? 'all responsibilities within their authority'}</dd>
        <a class="door" href="/foundry/controls" aria-label="Controls"></a></div>
      <div class="tile"><dt class="k">${mark('owner')}Action</dt>
        <dd class="v">${health.ownerAction ? html`<span class="state watch">Required</span>` : html`<span class="state quiet none">None</span>`}</dd>
        <dd class="d">${health.ownerAction ?? (health.recovering === 'automatically' ? 'recovering on its own' : 'nothing is waiting on you here')}</dd></div>
      <div class="tile"><dt class="k">${mark('changed')}Last healthy</dt>
        <dd class="v">${health.lastHealthy ? html`${ago(health.lastHealthy)}` : html`<span class="dim">not recorded</span>`}</dd>
        <dd class="d">${health.nextPass ? `next pass ${health.nextPass.slice(11, 16)} UTC` : 'no pass scheduled'}</dd></div>
    </dl>
    ${present.length < 2 ? '' : html`<p class="chips filters-row">
      <a class="chip${only ? '' : ' on'}" href="/foundry/activity">Everything</a>
      ${present.map(([k, label]) => html`<a class="chip${only === k ? ' on' : ''}"
        href="/foundry/activity?kind=${k}">${label}</a>`)}</p>`}

    ${events.length === 0
    ? html`<div class="know">
        <p>${all.length === 0
    ? 'Nothing has happened yet that is worth putting in front of you.'
    : 'Nothing of that kind.'}</p>
        <p class="quiet">This carries authority you granted or took back, experiments crossing a
          boundary, anything that actually reached a person, money from a source event, promises
          opened and discharged, and candidates your boundaries refused. It does not carry the
          scheduler running, checks that passed, or what I thought about.</p>
      </div>`
    : byDay(events).map(([day, ofDay]) => html`
      <div class="know stream-day">
        <h2>${day}</h2>
        <ul class="stream">
          ${ofDay.map((e) => html`<li class="ev ${e.kind}">
            <p class="when"><time>${timeOf(e.at)}</time></p>
            <span class="dot">${mark(EVENT_MARK[e.kind] ?? 'box')}</span>
            <p class="what">${e.href ? html`<a href="${e.href}">${e.what}</a>` : e.what}</p>
            ${e.detail ? html`<p class="quiet">${e.detail}${e.companyName ? html` <span class="dim">· ${e.companyName}</span>` : ''}</p>` : e.companyName ? html`<p class="quiet"><span class="dim">${e.companyName}</span></p>` : ''}
            <span class="pill kind">${LABEL.get(e.kind) ?? e.kind}</span>
          </li>`)}
        </ul>
      </div>`)}`;

  return c.html(page('Activity', body, 'activity', frame));
});
