// =============================================================================
// FOUNDRY — the owner surface's components.
//
// Until Mission Control every screen wrote its own markup for the same five or
// six things — a card, a status word, an empty state, a field that keeps what
// was typed — so the same idea looked slightly different on every page. These
// are those things, once. They render classes `owner.css` already styles or
// styles here for the first time; none of them carries inline style or script.
// =============================================================================

import { html, raw } from 'hono/html';
import type { HtmlEscapedString } from 'hono/utils/html';
import type { Mission, MissionStatus } from '../../services/mission/read.js';
import { MODE_WORDS, REALM_WORDS } from '../../services/mission/read.js';

type H = HtmlEscapedString | Promise<HtmlEscapedString>;

/** How a status reads at a glance. The word is always printed; colour only repeats it. */
const TONE: Record<MissionStatus, string> = {
  draft: 'quiet', ready: 'quiet', running: 'go', waiting: 'wait', needs_you: 'hot', paused: 'wait',
  succeeded: 'done', stopped: 'quiet', failed: 'back', archived: 'quiet',
};

/** A status word in a pill. */
export function statusPill(status: MissionStatus, word: string): H {
  return html`<span class="status ${TONE[status]}">${word}</span>`;
}

/**
 * ONE MISSION, AT A GLANCE: its status, its goal, what Foundry does next, and
 * its limits in a line. The whole card is one link to the Mission; nothing on
 * it acts, so a tap can never change anything.
 */
export function missionCard(m: Mission): H {
  const facts = [
    MODE_WORDS[m.mode],
    m.realm === 'real' ? null : REALM_WORDS[m.realm],
    m.company?.name ?? null,
    m.limits.until ? `until ${m.limits.until}` : null,
  ].filter((x): x is string => Boolean(x));
  return html`<a class="mission" href="/foundry/missions/${encodeURIComponent(m.key)}">
    <span class="mission-head">${statusPill(m.status, m.statusWord)}<span class="mission-facts">${facts.join(' · ')}</span></span>
    <span class="mission-goal">${m.goal}</span>
    ${m.concluded
      ? (m.outcome ? html`<span class="mission-next">${m.outcome}</span>` : '')
      : m.next ? html`<span class="mission-next"><b>Next:</b> ${m.next}</span>` : ''}
  </a>`;
}

/**
 * AN EMPTY STATE THAT TEACHES. Not "nothing here" but what would put something
 * here, and one example the owner could say.
 */
export function emptyState(what: string, example: string | null = null, action: { href: string; label: string } | null = null): H {
  return html`<div class="empty-teach"><p>${what}</p>
    ${example ? html`<p class="quiet">For example: <q>${example}</q></p>` : ''}
    ${action ? html`<p><a class="btn" href="${action.href}">${action.label}</a></p>` : ''}</div>`;
}

/** A labelled fact list. Values that are null say so in words rather than disappearing. */
export function facts(rows: Array<[string, string | null, string?]>): H {
  return html`<dl class="facts">${rows.map(([k, v, none]) => html`<dt>${k}</dt><dd>${v ?? html`<span class="quiet">${none ?? 'Not set'}</span>`}</dd>`)}</dl>`;
}

/** A section heading in the house style. */
export function sectionHead(title: string, aside: string | null = null): H {
  return html`<h2 class="section">${title}${aside ? html` <span class="dim">${aside}</span>` : ''}</h2>`;
}

/**
 * THE SIX ANSWERS every judgment gives before it asks for a yes (Mission
 * Control): what, why now, what yes does, the most it can cost, whether it
 * can be undone, and what happens if he does nothing. The first is the title
 * the card already carries, so five are drawn here.
 */
export function sixAnswers(a: { whyNow: string; ifYes: string; mostItCanCost: string; undo: string; ifNothing: string }): H {
  return html`<dl class="six">
    <dt>Why now</dt><dd>${a.whyNow}</dd>
    <dt>If you say yes</dt><dd>${a.ifYes}</dd>
    <dt>The most it can cost</dt><dd>${a.mostItCanCost}</dd>
    <dt>Can it be undone</dt><dd>${a.undo}</dd>
    <dt>If you do nothing</dt><dd>${a.ifNothing}</dd>
  </dl>`;
}

/** "Not now": puts one item off until tomorrow, where the item allows it. */
export function notNow(key: string): H {
  return html`<form method="POST" action="/foundry/needs-you/later" class="inline later">
    <input type="hidden" name="key" value="${key}" /><button class="btn btn-sm" type="submit">Not now</button></form>`;
}

/** Raw re-exported for the few callers that pass trusted SVG. */
export { raw };

/**
 * THE FUNNEL, AS COUNTS HE CAN TAP. One row per stage the records can prove,
 * the number first, what the stage means under it. Reference material a
 * rehearsal used is said apart and never added into the real count.
 */
export function funnel(stages: Array<{ label: string; n: number; reference: number; means: string; href: string }>): H {
  return html`<ol class="funnel">${stages.map((s) => html`<li><a href="${s.href}"><b>${String(s.n)}</b><span>${s.label}</span>
    <small>${s.means}${s.reference ? ` (${String(s.reference)} more from reference material, not the real market.)` : ''}</small></a></li>`)}</ol>`;
}
