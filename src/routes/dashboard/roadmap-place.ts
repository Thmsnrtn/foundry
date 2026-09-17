// =============================================================================
// FOUNDRY — the roadmap, which is a record rather than a plan
//
// Every product has a roadmap page and almost all of them are the same lie: a
// list of things somebody intends, written once, never closed, and true only on
// the day it was typed. This one cannot be that, because it has no table of its
// own. It reads `undertakings` — what the institution has actually taken on for
// a company, in the owner's own words where he said them — and the steps
// recorded against each, which reference the rows that hold the facts.
//
// SO THE ROADMAP IS: what I am carrying, what I last did about each, what it
// has cost, what I am waiting on, and what I dropped and why. Nothing here can
// be aspirational, because nothing here can be written except by something
// happening.
//
// WHAT IT DELIBERATELY DOES NOT DO. It does not let the owner add an item.
// Opening an undertaking is an act with meaning — it binds what his sentence
// was understood as, and the reading is done with phrase tables rather than a
// model — and it belongs where he says it, in Ask or on a company. A roadmap
// you can type into is a wish list; this is a record of load.
// =============================================================================

import { Hono } from 'hono';
import { html } from 'hono/html';
import { page } from './foundry-shell.js';
import type { Where } from './foundry-shell.js';
import {
  closedUndertakings, threadOf, underWayFor, type Step, type Undertaking,
} from '../../services/institution/undertaking.js';
import { query } from '../../db/client.js';

export const roadmapRoutes = new Hono();

const frame: Where = {
  eyebrow: 'Roadmap',
  crumbs: [{ href: '/foundry', label: 'Foundry' }, { href: '/foundry/roadmap', label: 'Roadmap' }],
  scope: { kind: 'foundry', id: null, name: 'Roadmap' }, local: [], chips: [],
};

async function founderOf(c: any): Promise<string | null> {
  const founder = c.get('founder') as { id?: string } | undefined;
  return founder?.id ? String(founder.id) : null;
}

const money = (cents: number): string => `$${(cents / 100).toFixed(2)}`;
const day = (at: string): string => String(at).slice(0, 10);

/** What the institution is waiting for, said as the step said it. */
const WAITING: Record<string, string> = {
  needs: 'waiting on something it cannot see',
  asked: 'waiting on you',
};

roadmapRoutes.get('/foundry/roadmap', async (c: any) => {
  const founderId = await founderOf(c);
  if (!founderId) return c.redirect('/onboarding');

  const open = await underWayFor(founderId);
  const threads = new Map<string, { steps: Step[]; costCents: number; latest: Step | null }>();
  for (const u of open) threads.set(u.id, await threadOf(u.id));

  // Recently closed, across his real companies, so "what happened to the thing
  // I asked for" has an answer that is not silence.
  const companies = await query(
    `SELECT id FROM products WHERE owner_id = ? AND reality = 'real'
       AND COALESCE(status,'active') <> 'archived'`, [founderId]);
  const closed: Undertaking[] = [];
  for (const raw of companies.rows) {
    closed.push(...await closedUndertakings(String((raw as Record<string, unknown>).id), 3));
  }
  closed.sort((a, b) => String(b.closedAt).localeCompare(String(a.closedAt)));

  const waitingCount = open.filter((u) => {
    const t = threads.get(u.id);
    return t?.latest ? t.latest.kind in WAITING : false;
  }).length;

  const lede = open.length === 0
    ? (closed.length === 0
      ? 'I am not carrying anything for you. When you ask me to take something on, it appears here with every step I take about it.'
      : 'I am not carrying anything just now. What I finished is below.')
    : `${String(open.length)} ${open.length === 1 ? 'thing' : 'things'} under way${
      waitingCount > 0 ? `, ${String(waitingCount)} of them waiting` : ''}.`;

  const body = html`
    <h1>Roadmap</h1>
    <p class="lede">${lede}</p>
    <p class="quiet">Not a plan — a record. Nothing appears here because somebody intended it;
      it appears because it was taken on, and every line under it rests on a row.</p>

    ${open.length === 0 ? '' : html`<div class="know roadmap-open">
      <h2>Under way</h2>
      <ul class="sales">${open.map((u) => {
    const t = threads.get(u.id);
    const latest = t?.latest ?? null;
    return html`<li>
          <b>${u.kindInWords}</b> for ${u.companyName}
          <p>${u.understoodAs}</p>
          ${u.asked ? html`<p class="quiet">You said: “${u.asked}”</p>`
    : html`<p class="quiet">I opened this myself, from ${u.openedFrom.kind === 'situation' ? 'something I noticed'
      : u.openedFrom.kind === 'recommendation' ? 'a recommendation of mine' : 'a candidate I found'}.</p>`}
          <p class="quiet">Since ${day(u.openedAt)}${
      t && t.costCents > 0 ? ` · ${money(t.costCents)} spent` : ' · nothing spent'}${
      latest ? ` · last: ${latest.said}` : ' · nothing has happened yet'}${
      latest && latest.kind in WAITING ? ` — ${WAITING[latest.kind]}` : ''}</p>
          <p class="quiet"><a href="/foundry/companies/${u.productId}/work">The work</a>
            · <form method="POST" action="/foundry/undertakings/${u.id}/stop" class="inline"><button class="btn btn-ghost btn-sm" type="submit">Stop this</button></form></p>
        </li>`;
  })}</ul>
    </div>`}

    ${closed.length === 0 ? '' : html`<div class="know roadmap-closed">
      <h2>Finished, and what came of it</h2>
      <ul class="sales">${closed.slice(0, 10).map((u) => html`<li>
        <b>${u.kindInWords}</b> for ${u.companyName} — ${u.closedAs === 'done' ? 'done'
    : u.closedAs === 'dropped' ? 'dropped' : u.closedAs === 'superseded' ? 'replaced by something else'
      : 'there was nothing to do'}
        <p class="quiet">${u.closedBecause ?? 'No reason was recorded.'} ${u.closedAt ? `Closed ${day(u.closedAt)}.` : ''}</p>
      </li>`)}</ul>
    </div>`}

    <div class="know roadmap-note">
      <h2>Why you cannot add to this</h2>
      <p class="quiet">Taking something on binds what your sentence was understood as, before
        anything acts on it — so it happens where you say it, in Ask or on a company page, and
        you see the understanding before it holds. A list you can type into is a list of wishes;
        this is a record of what I am actually carrying.</p>
    </div>`;
  return c.html(page('Roadmap', body, 'foundry', frame));
});
