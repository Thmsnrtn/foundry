// =============================================================================
// FOUNDRY — The experiment, as a place the owner stands in.
//
// One address per real experiment under /foundry, built on the same shell as
// every other place, so the first real test is watched, inspected and stopped
// where everything else is. Nothing here holds state: every line is read from
// the rows that govern (services/founder/experiment-view.ts) and every action
// is a writer the institution already has (services/venture/hand.ts). The
// owner's acts reduce to three: review who may be contacted, connect his own
// sending address, allow the test. Foundry does the rest and shows its work.
// =============================================================================
import { Hono } from 'hono';
import { query, realCompany } from '../../db/client.js';
import { html, raw } from 'hono/html';
import type { HtmlEscapedString } from 'hono/utils/html';
import { count, page, placeHead, steerFold } from './foundry-shell.js';
import { mark } from '../../views/owner/shell.js';
import type { Where } from './foundry-shell.js';
import { requireInstitutionOwner } from '../../middleware/rbac.js';
import { renderDecision } from './decision-control.js';
import { consequenceOfApproving, firstContactDecision } from '../../services/founder/what-it-would-do.js';
import { experimentLedger, getExperimentView, listExperiments } from '../../services/founder/experiment-view.js';
import type { ExperimentView } from '../../services/founder/experiment-view.js';
import {
  HandRefused, allowExperiment, approveRemaining, attachPaymentLinkByUrl, declineExperiment, markdownToHtml, offerShapePlanOf, prepareExposure,
  reviewRecipient, senderCompanyOf, stopExperiment,
} from '../../services/venture/hand.js';
import { approveListing, ownerActsForListing, recordListing, recordVenueOrder, recordVenueReading, recordVenueRefund } from '../../services/venture/proof-2.js';
import { shelfCandidates } from '../../services/venture/shelves.js';
import type { ShelfCandidate } from '../../services/venture/shelves.js';

/**
 * ONE WORD FOR WHETHER IT IS QUALIFIED, in his language rather than the
 * reader's. The states come from `venture/qualification.ts`; these are the
 * sentences he asked for — "tell me what is missing and what Foundry is doing
 * about it" — rather than an enum shown raw on a page.
 */
const QUALIFICATION_WORDS: Record<string, string> = {
  preparing: 'Still being put together. Nothing about it has been put to you yet.',
  testing_capability: 'The machinery it depends on works here but has not yet done anything in the world.',
  ready_for_review: 'Everything Foundry can settle is settled. It is yours to look at.',
  ready_within_charter: 'Ready, and inside a charter that covers it.',
  operating: 'It is out there.',
  paused_dependency: 'It was ready, and something it depends on has stopped working.',
  needs_owner_authorisation: 'Ready but for your word.',
  needs_external_account: 'Ready but for an account only you can open or connect.',
};

export const experimentRoutes = new Hono();

async function founderOf(c: any): Promise<string | null> {
  const founder = c.get('founder') as { id?: string } | undefined;
  return founder?.id ? String(founder.id) : null;
}

const where = (v: ExperimentView | null, on: 'test' | 'recipients' | 'list' | 'decide' | 'explore', counts?: { now: number; found: number }): Where => ({
  crumbs: [{ href: '/foundry', label: 'Foundry' }, { href: '/foundry/experiments', label: 'Experiments' }, ...(v ? [{ href: `/foundry/experiments/${v.id}`, label: v.assetName ?? 'This test' }] : [])],
  scope: { kind: 'foundry', id: v?.id ?? null, name: v?.assetName ?? 'Experiments' },
  // TWO QUESTIONS, TWO PLACES. "What is running" and "what have you found" are
  // different questions and were one page, which meant the second had no
  // answer at all: everything the institution had found and believed lived
  // inside whichever search happened to be open, on a screen about searching.
  local: v ? [
    { href: `/foundry/experiments/${v.id}`, label: 'The test', count: null, on: on === 'test' },
    { href: `/foundry/experiments/${v.id}/recipients`, label: 'Who may be contacted', count: v.exposure.pending || null, on: on === 'recipients' },
    { href: `/foundry/experiments/${v.id}/decide`, label: 'Before you decide', count: null, on: on === 'decide' },
  ] : (on === 'list' || on === 'explore') ? [
    { href: '/foundry/experiments', label: 'Now', count: counts?.now || null, on: on === 'list' },
    { href: '/foundry/experiments/explore', label: 'Explore', count: counts?.found || null, on: on === 'explore' },
  ] : [],
  chips: [],
});

const stateWord: Record<ExperimentView['state'], string> = { needs_you: 'Needs you', ready: 'Ready', running: 'Running', completed: 'Settled', stopped: 'Stopped', declined: 'Declined', invalid: 'Invalid', retired: 'Retired', superseded: 'Superseded' };
const CONCLUDED = ['completed', 'stopped', 'declined', 'invalid', 'retired', 'superseded'] as const;
/** SQLite writes 'YYYY-MM-DD HH:MM:SS' in UTC and says nothing about the zone. */
const asMs = (s: string): number => Date.parse(/[TZ]/.test(s) ? s : `${s.replace(' ', 'T')}Z`);
const dayOf = (s: string | null): string => s ? s.slice(0, 10) : '';
const cents = (n: number, cur = 'USD') => `${cur === 'USD' ? '$' : ''}${(n / 100).toFixed(2)}${cur === 'USD' ? '' : ` ${cur}`}`;
const notice = (done: string, error: string): HtmlEscapedString | Promise<HtmlEscapedString> | '' => error ? html`<p class="noticed" role="alert"><strong>That did not go through.</strong> ${error}</p>`
  : done === 'allowed' ? html`<p class="noticed"><strong>Allowed.</strong> Foundry is placing the offer and will begin writing on its next pass. Nothing more is needed from you.</p>`
    : done === 'declined' ? html`<p class="noticed">Declined. Nothing was made.</p>`
      : done === 'stopped' ? html`<p class="noticed"><strong>Stopped.</strong> Permission is withdrawn; nothing more will be sent.</p>`
        : done === 'sending' ? html`<p class="noticed">Sending address connected.</p>`
          : done === 'reviewed' ? html`<p class="noticed">Recorded.</p>` : done === 'placed' ? html`<p class="noticed">The offer is placed.</p>`
            : done === 'approved' ? html`<p class="noticed"><strong>Approved.</strong> The design is sealed and the allowance is set. Foundry writes to nobody and publishes nothing for this test; the next acts are yours, and they are listed on this page.</p>`
              : done === 'listed' ? html`<p class="noticed"><strong>Listed.</strong> The address is recorded and the window has started.</p>`
                : done === 'reading' ? html`<p class="noticed">Reading recorded as the venue reported it.</p>`
                  : done === 'order' ? html`<p class="noticed">Order recorded: the payment, the delivery the venue made, and the ledger rows.</p>`
                    : done === 'refund' ? html`<p class="noticed">Refund recorded.</p>` : '';

// ─── The list ────────────────────────────────────────────────────────────────
experimentRoutes.get('/foundry/experiments', async (c: any) => {
  const founderId = await founderOf(c);
  if (!founderId) return c.redirect('/onboarding');
  // NOW IS NOT HISTORY. The page is the working set: what can still produce
  // evidence. What has concluded — completed, stopped, declined, invalid,
  // retired, superseded — is the record, kept whole on its own page and shown
  // here only as the few that finished lately, so the owner is never asked to
  // live inside the history of every test he ever ran.
  const now = new Date();
  const live = await listExperiments(founderId, now, 'now');
  const ledger = await experimentLedger(founderId);
  const views = live.filter((t) => !t.concluded);
  // A test he stopped is settled by no row the SQL can read; the view knows.
  const stoppedByHim = live.filter((t) => t.concluded);
  const cutoff = now.getTime() - 14 * 86_400_000;
  const lately = ledger.filter((l) => l.settled && l.settledAt !== null && asMs(l.settledAt) >= cutoff).map((l) => l.id);
  // A concluded test with no date of its own ages by the ledger's, and one
  // with neither is not "recent": it used to stay here for good.
  const settledAtOf = new Map(ledger.filter((l) => l.settledAt !== null).map((l) => [l.id, l.settledAt as string]));
  const recent = [...stoppedByHim, ...(await Promise.all(lately.map((x) => getExperimentView(founderId, x, now)))).filter((v): v is ExperimentView => v !== null)]
    .filter((v) => { const at = v.concludedAt ?? settledAtOf.get(v.id) ?? null; return v.concluded && at !== null && asMs(at) >= cutoff; })
    .sort((a, b) => (b.concludedAt ?? '').localeCompare(a.concludedAt ?? '')).slice(0, 3);
  const historyN = ledger.filter((l) => l.settled).length + stoppedByHim.length;
  // THE ONE THAT IS ALIVE LEADS. A running test, or one waiting on him, is the
  // instrument the page exists for; the rest are rows beneath it. Nothing here
  // is a project card: stage, exposure, money, stop conditions and what the
  // evidence can and cannot establish are all read from the rows that govern.
  const featured = views.find((t) => t.state === 'running' || t.state === 'needs_you' || t.state === 'ready') ?? views[0] ?? null;
  const rest = views.filter((t) => t !== featured);
  const { designOf, readStopConditions } = await import('../../services/venture/probe-design.js');
  const design = featured ? await designOf(featured.id) : null;
  const stops = featured ? await readStopConditions(featured.id) : [];
  const cls = (state: ExperimentView['state']): string => state === 'running' ? 'ok' : state === 'needs_you' || state === 'ready' ? 'watch' : state === 'completed' ? 'ok' : state === 'stopped' || state === 'invalid' ? 'bad' : 'quiet';
  const pct = (v: ExperimentView): number | null => v.exposure.approved > 0 ? Math.round((100 * v.exposure.sent) / v.exposure.approved) : null;
  const hero = featured ? html`<section class="panel exp-hero" aria-label="${featured.assetName ?? featured.title}">
      <header><h2>${mark('experiment')}${featured.assetName ?? 'Experiment'} <span class="state ${cls(featured.state)}">${stateWord[featured.state]}</span></h2>
        <a class="more-link" href="/foundry/experiments/${featured.id}">Open ${mark('arrow')}</a></header>
      <p class="exp-q">${featured.why.question || featured.title}</p>
      ${pct(featured) !== null ? html`<div class="exp-prog">
        <p class="big"><b>${String(pct(featured))}%</b> <span class="quiet">written to</span></p>
        <span class="prog"><i style="width:${String(Math.max(2, Math.min(100, pct(featured) ?? 0)))}%"></i></span>
        <p class="exp-n"><b>${String(featured.exposure.sent)} / ${String(featured.exposure.approved)}</b> <span class="quiet">recipients</span></p>
      </div>` : html`<p class="quiet">${featured.stateDetail}</p>`}
      <dl class="numbers exp-numbers">
        <div class="tile"><dt class="k">${mark('sent')}Delivered</dt><dd class="v">${String(featured.exposure.delivered)}</dd><dd class="d">${featured.exposure.killAt ? `of ${String(featured.exposure.killAt)} before it stops itself` : 'confirmed received'}</dd></div>
        <div class="tile"><dt class="k">${mark('money')}Purchases</dt><dd class="v">${String(featured.money.payments)}</dd><dd class="d">${featured.money.payments ? `${cents(featured.money.paidCents, featured.money.currency)} paid` : 'so far'}</dd></div>
        <div class="tile"><dt class="k">${mark('cash')}Spent</dt><dd class="v">${cents(featured.money.spentCents)}</dd><dd class="d">of ${cents(featured.money.allowanceCents)} allowed</dd></div>
        <div class="tile"><dt class="k">${mark('changed')}Window</dt><dd class="v">${featured.rules.daysLeft != null ? html`${String(featured.rules.daysLeft)} <span class="dim">days</span>` : html`<span class="dim">—</span>`}</dd><dd class="d">${featured.rules.windowClosesAt ? `closes ${featured.rules.windowClosesAt.slice(0, 10)}` : 'opens when the offer is placed'}</dd></div>
      </dl>
      ${stops.length ? html`<p class="exp-stops"><span class="quiet">Stops itself at</span>${stops.map((x) => html`<span class="chip${x.met ? ' hit' : ''}">${x.whatItIs} <b>${String(x.count)} / ${String(x.threshold)}</b></span>`)}</p>`
    : featured.rules.stop.length ? html`<p class="exp-stops"><span class="quiet">Stops when</span>${featured.rules.stop.map((x) => html`<span class="chip">${x}</span>`)}</p>` : ''}
      <div class="exp-thesis">
        <div><b class="k">${mark('spark')}Prediction</b><p>${featured.why.whatWeExpect}</p></div>
        <div><b class="k ok">${mark('check')}What this can prove</b><p>${design?.canProve ?? 'Not recorded.'}</p></div>
        <div><b class="k bad">${mark('stop')}What it cannot prove</b><p>${design?.cannotProve ?? 'Not recorded.'}</p></div>
      </div>
      <p class="exp-links"><a class="btn go" href="/foundry/experiments/${featured.id}">${featured.state === 'needs_you' ? 'What it needs from you' : featured.state === 'ready' ? 'Decide' : 'Open the test'}</a>
        <a class="why" href="/foundry/experiments/${featured.id}/decide">Everything it rests on</a></p>
    </section>` : '';
  const found = (await shelfCandidates(founderId)).reduce((n, sh) => n + sh.candidates.length, 0);
  const w = where(null, 'list', { now: views.length, found });
  const body = html`
    ${placeHead(w, 'Experiments')}
    <p class="lede">${views.length === 0
    ? (historyN ? 'Nothing is being tested now.' : 'No real test is set up yet. When one is, it appears here with what it needs from you.')
    : `${count(views.length, 'live test')}. Each is one question put to the world, with the prediction sealed before it runs.`}</p>
    ${hero}
    ${rest.length ? html`<h2 class="rank">Other live tests<span class="dim">${String(rest.length)}</span></h2>` : ''}
    ${rest.map((v) => html`<a class="item experiment-index-item exp-row" href="/foundry/experiments/${v.id}">
      <p><strong>${v.assetName ?? v.title}</strong> <span class="pill">${stateWord[v.state]}</span></p>
      <p class="quiet">${v.stateDetail}</p>
      ${pct(v) !== null ? html`<span class="prog"><i style="width:${String(Math.max(2, Math.min(100, pct(v) ?? 0)))}%"></i></span>` : ''}
    </a>`)}
    ${recent.length ? html`<h2 class="rank" id="recent">Recently finished<span class="dim">14 days</span></h2>
    ${recent.map((v) => html`<a class="item experiment-index-item exp-row done" href="/foundry/experiments/${v.id}">
      <p><strong>${v.assetName ?? v.title}</strong> <span class="pill">${v.outcome.label}</span> <span class="dim">${dayOf(v.concludedAt)}</span></p>
      ${v.outcome.reason ? html`<p class="quiet">${v.outcome.reason}</p>` : ''}
    </a>`)}` : ''}
    <p class="quiet"><a href="/foundry/experiments/history">History (${String(historyN)})</a> · <a href="/foundry/experiments/next">What to test next</a></p>`;
  return c.html(page('Experiments', body, 'experiments', w));
});

// ─── Explore: what has been found, and what has not ──────────────────────────
//
// THE SHELVES ARE NOT A MENU. Every shelf is a way of looking at candidates
// that already exist, and a candidate exists only by surviving two genuinely
// different ways of knowing about something somebody actually wrote. A shelf
// with nothing on it says so and offers to point the search that way — which
// goes through the mandate, in his words, exactly as any other instruction
// from him does. It does not fill itself.
//
// This is also where a search that has found nothing yet stops being invisible.
// Everything the institution had found lived inside whichever search happened
// to be open, on a screen about searching; an owner with no search open was
// shown nothing about what his institution had ever discovered.
experimentRoutes.get('/foundry/experiments/explore', async (c: any) => {
  const founderId = await founderOf(c);
  if (!founderId) return c.redirect('/onboarding');
  const now = new Date();
  const shelves = await shelfCandidates(founderId);
  const found = shelves.reduce((n, sh) => n + sh.candidates.length, 0);
  const live = (await listExperiments(founderId, now, 'now')).filter((t) => !t.concluded);
  const { mandateProgress } = await import('../../services/venture/mandate.js');
  const progress = await mandateProgress(founderId);
  const { openSeeds } = await import('../../services/venture/seeds.js');
  const seeds = await openSeeds(founderId, 200);

  // ALIVE, WITHOUT BEING NOISY. Every number here is a row count and nothing
  // is invented to look busy: what is being looked through, what was set
  // aside, and whether anything has earned a test. When the pipeline is
  // genuinely empty it says that instead of dressing a zero up.
  const alive = progress === null && seeds.length === 0 && found === 0
    ? 'Nothing is being looked into. Point me somewhere and I will start.'
    : [
      seeds.length > 0 ? `Looking through ${count(seeds.length, 'possibility', 'possibilities')}` : null,
      progress && progress.rejected > 0 ? `${String(progress.rejected)} set aside` : null,
      found > 0 ? `${count(found, 'candidate')} standing` : null,
      live.length > 0 ? `${count(live.length, 'test')} running` : 'nothing yet deserves a test',
    ].filter((x): x is string => x !== null).join(' · ');

  const cannotTest = new Set(shelves.filter((sh) => sh.cannotTestYet !== null).map((sh) => sh.key));
  const card = (k: ShelfCandidate) => html`<article class="item shelf-card">
    <p><strong>${k.headline}</strong></p>
    <p class="quiet">${k.whoHasIt} — ${k.theProblem}</p>
    <p class="shelf-ev"><span class="pill${k.stances >= 2 ? ' ok' : ''}">${k.evidence}</span>${k.because ? html` <span class="dim">filed here by &ldquo;${k.because}&rdquo; in ${k.where}</span>` : ''}</p>
    <p class="quiet">${k.blockedBy ? html`<b>In the way:</b> ${k.blockedBy}` : html`<b>Strongest reason it fails:</b> ${k.killThesis}`}</p>
    ${k.testedBefore.map((line) => html`<p class="quiet tested-before">${line}</p>`)}
    <p><a class="btn" href="/foundry/why/candidate/${k.id}">Explore ${mark('arrow')}</a></p>
    ${steerFold(k.id, { blockedBy: k.blockedBy, cannotTestYet: cannotTest.has(k.form) }, 'explore')}
  </article>`;

  const w = where(null, 'explore', { now: live.length, found });
  // AN EMPTY SHELF SAYS WHY. "An answer about the world" was printed after the
  // owner closed the search himself, which is an answer about him.
  const { currentMandate, pastSearches } = await import('../../services/venture/mandate.js');
  const open = await currentMandate(founderId);
  const last = open ? null : (await pastSearches(founderId, 1))[0] ?? null;
  const emptyBecause = open
    ? 'Nothing has survived enough evidence to stand as a candidate yet. That is an answer about the world, not a gap in the page.'
    : last
      ? `Nothing is being looked for: the last search closed on ${last.closedAt} (${last.why}). Say what to look for and this fills again.`
      : 'Nothing is being looked for yet. Say what to look for in the box below.';
  const body = html`
    ${placeHead(w, 'Explore')}
    <p class="lede">${found === 0 ? emptyBecause
    : `${count(found, 'thing')} found and believed, arranged by what it would be.`}</p>
    <p class="quiet">${alive}</p>
    ${shelves.map((sh) => html`<details class="fold shelf"${sh.candidates.length ? raw(' open') : raw('')}>
      <summary><span class="gist"><b>${sh.label}</b> <span class="dim">${sh.candidates.length ? String(sh.candidates.length) : 'nothing yet'}</span></span></summary>
      <p class="quiet">${sh.whatItIs}</p>
      ${sh.cannotTestYet ? html`<p class="quiet"><b>${sh.cannotTestYet}</b></p>` : ''}
      ${sh.candidates.length === 0
    ? html`<p class="quiet">Nothing found so far looks like this.</p>
        <form method="POST" action="/foundry/ask">
          <input type="hidden" name="said" value="Explore ${sh.label.toLowerCase()}" />
          <button class="btn" type="submit">Look for something like this</button>
        </form>`
    : sh.candidates.map(card)}
    </details>`)}
    <form class="inline" method="POST" action="/foundry/ask">
      <input type="text" name="said" maxlength="800" placeholder="Explore something new"
        aria-label="Explore something new" enterkeyhint="send" autocapitalize="sentences"
        autocorrect="on" spellcheck="true" />
      <button class="btn" type="submit">Go and look</button>
    </form>
    <p class="quiet">You name the direction. Working out what would test it is mine.</p>`;
  return c.html(page('Explore', body, 'experiments', w));
});

// ─── History: the record of every concluded test ─────────────────────────────
//
// HISTORY IS EVIDENCE, NOT NAVIGATION. Every test that concluded — however it
// concluded — keeps its page and its rows; this is where they are read, most
// recently concluded first, filtered by how they ended. Nothing is deleted to
// keep the working set small; it is filed here. Mounted before `/:id` for the
// same reason `next` is.
experimentRoutes.get('/foundry/experiments/history', async (c: any) => {
  const founderId = await founderOf(c);
  if (!founderId) return c.redirect('/onboarding');
  const now = new Date();
  const wanted = String(c.req.query('state') ?? '');
  const all = [...await listExperiments(founderId, now, 'history'), ...(await listExperiments(founderId, now, 'now')).filter((v) => v.concluded)]
    .sort((a, b) => (b.concludedAt ?? '').localeCompare(a.concludedAt ?? ''));
  const filter = (CONCLUDED as readonly string[]).includes(wanted) ? wanted as ExperimentView['state'] : null;
  const shown = filter ? all.filter((v) => v.state === filter) : all;
  const n = (k: string) => all.filter((v) => v.state === k).length;
  // A RETIRED ASSET IS FINDABLE HERE. The test's asset is archived with its
  // reason when the test fails and the grace runs out, or when he stops it;
  // it was listed nowhere. Its own page stays reachable from this row.
  const retiredAssets = new Map((await query(
    `SELECT p.from_experiment_id AS e, p.id, p.name, p.retired_because FROM products p
      WHERE p.owner_id = ? AND p.standing = 'experimental' AND p.status = 'archived' AND p.deleted_at IS NULL AND p.from_experiment_id IS NOT NULL AND ${realCompany('p')}`, [founderId]))
    .rows.map((r) => [String((r as Record<string, unknown>).e), r as Record<string, unknown>]));
  const frame: Where = {
    crumbs: [{ href: '/foundry', label: 'Foundry' }, { href: '/foundry/experiments', label: 'Experiments' }, { href: '/foundry/experiments/history', label: 'History' }],
    scope: { kind: 'foundry', id: null, name: 'Experiments' }, local: [], chips: [],
  };
  const body = html`
    <h1>History</h1>
    <p class="lede">${all.length === 0 ? 'Nothing has finished yet.' : `${count(all.length, 'concluded test')}. Each keeps its page and every row it produced.`}</p>
    ${all.length ? html`<p class="filters"><a href="/foundry/experiments/history" class="${filter ? '' : 'on'}"${filter ? '' : raw(' aria-current="page"')}>All <b>${String(all.length)}</b></a>${CONCLUDED.filter((k) => n(k) > 0).map((k) => html`<a href="/foundry/experiments/history?state=${k}" class="${filter === k ? 'on' : ''}"${filter === k ? raw(' aria-current="page"') : ''}>${stateWord[k]} <b>${String(n(k))}</b></a>`)}</p>` : ''}
    ${shown.map((v) => html`<a class="item experiment-index-item exp-row done" href="/foundry/experiments/${v.id}">
      <p><strong>${v.assetName ?? v.title}</strong> <span class="pill">${v.outcome.label}</span> <span class="dim">${dayOf(v.concludedAt)}</span></p>
      <p class="quiet">${v.outcome.meaning}${v.outcome.reason ? html` ${v.outcome.reason}` : ''}${v.supersededBy ? html` <span class="dim">Succeeded by <a href="/foundry/experiments/${v.supersededBy}">the later design</a>.</span>` : ''}</p>
      ${retiredAssets.has(v.id) ? html`<p class="quiet"><span class="dim">Its asset, ${String(retiredAssets.get(v.id)!.name)}, is retired: ${String(retiredAssets.get(v.id)!.retired_because ?? '')}</span></p>` : ''}
    </a>`)}
    ${filter && shown.length === 0 ? html`<p class="quiet">None ended that way.</p>` : ''}
    <p class="quiet"><a href="/foundry/experiments">Live tests</a></p>`;
  return c.html(page('Experiments — History', body, 'experiments', frame));
});

// ─── The forge: what is worth testing next ───────────────────────────────────
//
// MOUNTED BEFORE `/foundry/experiments/:id`, because `next` would otherwise be
// read as an experiment id and answer 404. Hono matches in registration order.
//
// WHAT THIS PAGE IS FOR. An experiment is the most expensive thing the
// institution does — it reaches strangers, spends money, and produces a claim
// the rest of the estate leans on. So the question "what should we test next"
// is not answered here by anything that can invent. It is read: the questions
// somebody wrote down as unanswered, what the last test established, and — the
// useful half — what that test said IN ADVANCE it could not establish.
//
// There is no button that composes a design. `recordDesign` takes judgement
// sentences — what this decides, what it can and cannot prove, what would stop
// it — and those are the owner's or they are nobody's. This lays out what is
// known so he is not writing them from a blank page.
experimentRoutes.get('/foundry/experiments/next', async (c: any) => {
  const founderId = await founderOf(c);
  if (!founderId) return c.redirect('/onboarding');
  const { forgeFor } = await import('../../services/venture/forge.js');
  const f = await forgeFor(founderId);
  // WHEN THIS FILLS, IN ONE SENTENCE. Empty, the page pointed him at Ask and
  // said nothing about what would put a line here: a candidate standing under
  // an open search, with a question only money settles.
  const { currentMandate } = await import('../../services/venture/mandate.js');
  const searching = await currentMandate(founderId);
  const fills = f.open.length > 0 ? '' : searching
    ? `A search is open (${searching.statement}); this fills when it finds a candidate worth a question that only a test can settle.`
    : 'No search is open, so nothing arrives here. Say what to look for in the box below and the search brings its questions here.';

  const body = html`
    <h1>What to test next</h1>
    <p class="lede">${f.sentence}</p>
    ${fills ? html`<p class="quiet">${fills}</p>` : ''}
    <p class="quiet">Read, not suggested. Every line below is a row somebody wrote —
      a question marked unanswered, or a limit a finished test recorded before it ran.</p>

    <div class="know">
      <h2>Questions nobody has answered</h2>
      ${f.open.length === 0 ? html`<p class="quiet">None are written down. They arrive from what I
        notice about a company and from what you ask me to find out.</p>`
    : html`<ul class="sales">${f.open.map((q) => html`<li>
          <b>${q.blocking ? 'Blocking' : 'Untidy'}</b> · ${q.question}
          ${q.opportunityHeadline ? html`<p class="quiet">About: ${q.opportunityHeadline}</p>` : ''}
          <p class="quiet">${q.cheapestTest
      ? `Cheapest way to answer it: ${q.cheapestTest}.`
      : 'No cheapest test is written down, which is the first thing to work out — a question nobody knows how to settle is not yet a test.'}
            ${q.alreadyTesting
      ? html` <a href="/foundry/experiments/${q.alreadyTesting.experimentId}">Already being tested (${q.alreadyTesting.state})</a>.`
      : ''}</p>
        </li>`)}</ul>`}
    </div>

    <div class="know">
      <h2>What the tests so far established — and what they did not</h2>
      ${f.lessons.length === 0 ? html`<p class="quiet">Nothing has run yet. When something has, what it
        proved and what it could not will be here, because the second half is what the next design
        has to answer to.</p>`
    : html`<ul class="sales">${f.lessons.map((l) => html`<li>
          <b>${l.decided ?? l.whatWeDid}</b>
          <p class="quiet">${l.outcome.settled
      ? `Settled ${l.outcome.word}: ${l.outcome.meaning}${l.outcome.reason ? ` ${l.outcome.reason}` : ''}`
      : l.outcome.concluded ? `${l.outcome.label}: ${l.outcome.meaning}` : 'The world has not answered yet.'}</p>
          ${l.couldNotEstablish ? html`<p><strong>It could not establish:</strong> ${l.couldNotEstablish}
            <span class="quiet">— written before it ran, which is what makes it evidence rather than
            a rationalisation afterwards.</span></p>` : ''}
          <p class="quiet"><a href="/foundry/experiments/${l.experimentId}">The test</a>
            · <a href="/foundry/why/experiment/${l.experimentId}">Show its work</a></p>
        </li>`)}</ul>`}
    </div>

    <div class="know">
      <h2>Why there is no button here</h2>
      <p class="quiet">Designing a test means saying what it decides, what it would prove, what it
        would not, what would stop it and what each answer would mean. Those sentences are yours or
        they are nobody's — a design I composed would be me marking my own homework, and the
        deliberation is the only thing standing between a test and an expensive opinion. Say what
        you want to find out in Ask, and I will lay out the design for you to approve.</p>
    </div>`;
  return c.html(page('What to test next', body, 'experiments', where(null, 'list')));
});

// ─── The test ────────────────────────────────────────────────────────────────
experimentRoutes.get('/foundry/experiments/:id', async (c: any) => {
  const founderId = await founderOf(c);
  if (!founderId) return c.redirect('/onboarding');
  const v = await getExperimentView(founderId, String(c.req.param('id')));
  if (!v) return c.notFound();
  const done = String(c.req.query('done') ?? ''); const error = String(c.req.query('error') ?? '');
  const id = v.id;
  const { theShortVersion } = await import('../../services/venture/probe-design.js');
  const short = await theShortVersion(id);
  // WHAT KIND OF TEST THIS IS, on the page of the test itself and behind a
  // fold. §19's fingerprint, read from rows: unknowns left unknown, and
  // refusing to compare at all until two experiments have settled.
  const { genomeOf, likeness, DIMENSIONS } = await import('../../services/venture/genome.js');
  const genome = await genomeOf(id);
  const alike = genome === null ? null : await likeness(founderId, genome);
  const step = (s: ExperimentView['steps'][number]) => html`<li class="${s.status}">
    <p><strong>${s.status === 'done' ? '✓ ' : s.status === 'todo' ? '○ ' : '· '}${s.label}</strong>${s.status === 'todo' && s.key === 'recipients' ? html` — <a href="${s.href}">open</a>` : ''}</p>
    <p class="quiet">${s.detail}</p></li>`;
  // ── WATCH, THEN INSPECT ──
  //
  // One decision at the top, then the state in a sentence, then everything the
  // decision rests on — behind a summary, because a wall of evidence at first
  // glance is how a page stops being read. Nothing is hidden; it is ordered.
  const decision = await firstContactDecision(id);
  // WHAT THE INSTITUTION IS STOPPED ON, if anything. An authorised experiment
  // that cannot proceed must say so on its own page rather than look idle.
  // WHAT ACTUALLY HAPPENED, COUNTED FROM THE ROWS. Behind a summary, because
  // it is evidence rather than a decision — but on the page, because a tranche
  // report once described this experiment out of four true counts from four
  // different tables that together described an experiment that did not exist.
  const { reconcileExperiment } = await import('../../services/venture/reconcile.js');
  const reconciled = await reconcileExperiment(id);
  const { runStateOf } = await import('../../services/venture/run-state.js');
  const run = await runStateOf(id);
  const blocked = run && (run.state === 'blocked' || run.state === 'failed') ? run : null;
  const launch = 'notNow' in decision ? null : decision;
  // A LISTING THE OWNER PLACES HIMSELF. Its decision is the general control's,
  // and the general control says so: no business is named, no page is written
  // for strangers, so approving builds something to test with and nothing
  // else. The consequence is computed before the button exists.
  const listing = (await offerShapePlanOf(id))?.listing ?? null;
  const approve = listing && v.state === 'ready' ? await consequenceOfApproving(id) : null;
  const liveListing = listing && v.state === 'running' && v.offer.paymentLinkUrl ? v.offer.paymentLinkUrl : null;
  // WHAT THE OWNER READS FIRST: a state, four numbers, where it stops, what
  // happens next. Everything the decision rests on is one fold down, and every
  // form is where the act belongs. Nothing is hidden; it is ordered.
  const pctDone = v.exposure.approved > 0 ? Math.round((100 * v.exposure.sent) / v.exposure.approved) : null;
  const { readStopConditions } = await import('../../services/venture/probe-design.js');
  const stopReadings = await readStopConditions(id);
  const stateCls = v.outcome.word === 'surprised' || v.state === 'stopped' || v.state === 'invalid' ? 'bad' : v.outcome.word === 'partly' ? 'watch' : v.state === 'running' || v.state === 'completed' ? 'ok' : v.state === 'needs_you' || v.state === 'ready' ? 'watch' : 'quiet';
  const watch = html`<section class="panel exp-watch" aria-label="Where it stands">
      <dl class="numbers exp-numbers">
        <div class="tile"><dt class="k">${mark('sent')}Written to</dt><dd class="v">${String(v.exposure.sent)}${v.exposure.approved ? html` <span class="dim">/ ${String(v.exposure.approved)}</span>` : ''}</dd><dd class="d">${pctDone !== null ? html`<span class="prog"><i style="width:${String(Math.max(2, Math.min(100, pctDone)))}%"></i></span>` : `${String(v.exposure.pending)} still to review`}</dd></div>
        <div class="tile"><dt class="k">${mark('check')}Delivered</dt><dd class="v">${String(v.exposure.delivered)}</dd><dd class="d">${v.exposure.bounced ? `${String(v.exposure.bounced)} bounced` : v.exposure.killAt ? `of ${String(v.exposure.killAt)} before it stops itself` : 'confirmed received'}</dd></div>
        <div class="tile"><dt class="k">${mark('money')}Paid</dt><dd class="v">${String(v.money.payments)}</dd><dd class="d">${v.money.payments ? `${cents(v.money.paidCents, v.money.currency)}${v.money.refunds ? ` · ${String(v.money.refunds)} refunded` : ''}` : 'no purchases yet'}</dd></div>
        <div class="tile"><dt class="k">${mark('cash')}Spent</dt><dd class="v">${cents(v.money.spentCents)}</dd><dd class="d">of ${cents(v.money.allowanceCents)} allowed</dd></div>
      </dl>
      ${/* AN EMPTY TILL IS AN ABSENCE, AND AN ABSENCE IS ONLY EVIDENCE WHEN
            THE THING THAT WOULD HAVE RECORDED A PRESENCE WAS WORKING. The
            tile above says "no purchases recorded" rather than "none yet"
            whenever that is in doubt, and this says why. */ ''}
      ${v.money.emptyTill ? html`<p class="quiet">${v.money.emptyTill}</p>` : ''}
      ${stopReadings.length ? html`<p class="exp-stops"><span class="quiet">Stops itself at</span>${stopReadings.map((x) => html`<span class="chip${x.met ? ' hit' : ''}">${x.whatItIs} <b>${String(x.count)} / ${String(x.threshold)}</b></span>`)}</p>`
    : v.rules.stop.length ? html`<p class="exp-stops"><span class="quiet">Stops when</span>${v.rules.stop.map((x) => html`<span class="chip">${x}</span>`)}</p>` : ''}
      ${v.rules.windowClosesAt ? html`<p class="quiet">Window closes ${v.rules.windowClosesAt}${v.rules.daysLeft != null ? ` · ${count(v.rules.daysLeft, 'day')} left` : ''}.</p>` : ''}
    </section>`;
  const stepper = html`<section class="panel exp-steps" id="steps" aria-label="What happens next">
      <header><h2>${mark('changed')}What happens next</h2><span class="dim">${String(v.steps.filter((x) => x.status === 'done').length)} of ${String(v.steps.length)} done</span></header>
      <ol class="stepper">${v.steps.map((x, i) => html`<li class="${x.status}">
        <i>${x.status === 'done' ? '✓' : String(i + 1)}</i>
        <b>${x.label}${x.status === 'todo' && x.key === 'recipients' ? html` <a href="${x.href}">open</a>` : ''}</b>
        <span>${x.detail}</span></li>`)}</ol>
    </section>`;
  const fold = (id2: string, title: string, gist: string, inner: HtmlEscapedString | Promise<HtmlEscapedString>, open = false) =>
    html`<details class="fold" id="${id2}"${open ? raw(' open') : ''}><summary><h2>${title}</h2><span class="gist">${gist}</span></summary>${inner}</details>`;
  const body = html`
    <p class="act exp-eyebrow">${mark('experiment')}Experiment${v.publicPage ? html` · <a href="${v.publicPage.url}" rel="noopener">public page</a>` : ''}</p>
    <h1>${v.assetName ?? 'The test'} <span class="state ${stateCls}">${v.stateLabel}</span></h1>
    ${notice(done, error)}
    <p class="lede">${v.stateDetail}</p>
    ${/* WHAT WAS BROKEN WHILE IT RAN, WHETHER OR NOT IT STILL IS. The
          institution used to hold only the current reading, so the morning a
          path came back the record that this test had been measured through a
          broken one was gone. These are the intervals, kept — and they are
          here rather than beside the outcome because a test still running is
          the one the owner can still act on. */ ''}
    ${v.instrumentOutages.length ? html`<div class="noticed" role="note">
      <p><strong>What was not working while it ran.</strong> A result is only evidence about the world if the world could have answered.</p>
      <ul class="plain">${v.instrumentOutages.map((o) => html`<li>${o.name} — from ${dayOf(o.brokeAt)}${o.mendedAt ? html` to ${dayOf(o.mendedAt)}` : ', and still is'}: ${o.brokeDetail}</li>`)}</ul>
    </div>` : ''}
    ${v.outcome.concluded ? html`<section class="panel exp-outcome" id="outcome" aria-label="What happened and why">
      <header><h2>${mark('experiment')}What happened and why</h2>${v.outcome.when ? html`<span class="dim">${dayOf(v.outcome.when)}</span>` : ''}</header>
      <p><span class="state ${stateCls}">${v.outcome.label}</span> ${v.outcome.meaning}</p>
      ${v.outcome.reason ? html`<p><strong>Why</strong> — ${v.outcome.reason}</p>` : ''}
      ${v.outcome.establishes ? html`<p><strong>What that establishes</strong> — ${v.outcome.establishes}</p>` : ''}
      ${v.outcome.doesNotEstablish ? html`<p><strong>What it does not establish</strong> — ${v.outcome.doesNotEstablish}</p>` : ''}
      ${/* WAS THE INSTRUMENT WORKING WHEN THE WORLD WAS ASKED? Nineteen cold
            emails invited a reply to an address whose path was not routed, and
            seven days later the rule settled the test as a fact about a
            market. The verdict stands — it is sealed, and it counted what it
            said it would — and what the institution CLAIMS the result
            establishes is its own and is corrected here. */ ''}
      ${v.instrumentDoubts.length ? html`<div class="noticed" role="note">
        <p><strong>About the instrument.</strong> ${v.instrumentDoubts.map((d) => d.sentence).join(' ')}</p>
        <p>So it also does not establish ${v.instrumentDoubts.map((d) => d.doesNotEstablish).join(' ')}</p>
      </div>` : ''}
    </section>` : ''}
    ${launch ? html`<section class="launch" id="authorise">
      <p class="act">First real market test</p>
      ${renderDecision({
    consequence: launch.consequence,
    action: `/foundry/experiments/${id}/authorise-contact`,
    hidden: { expect: launch.include.map((r) => r.id).join(','),
      exclude: launch.exclude.map((r) => r.id).join(',') },
    primary: true,
  })}
      <details class="who"><summary>${count(launch.include.length, 'business', 'businesses')} this contacts, and why</summary>
        <ul class="plain">${launch.include.map((r) => html`<li><strong>${r.name}</strong>
          <span class="quiet">${r.email}</span><br /><span class="quiet">${r.because}
          &middot; <a href="${r.source}" rel="noopener">the record that says so</a></span>
          <br /><span class="quiet">Written there because it is the ${r.addressedBecause}.</span></li>`)}</ul>
        ${launch.exclude.length ? html`<p class="quiet">Excluded by this same press, because nothing on
          record says they belong to the population this test names:
          ${launch.exclude.map((r) => r.name).join(', ')}.</p>` : ''}
      </details>
      <p class="quiet"><a class="why" href="/foundry/experiments/${id}/decide">Everything this rests on</a>
        &middot; <a class="why" href="/foundry/experiments/${id}/recipients">The whole cohort</a></p>
    </section>` : ''}
    ${approve ? html`<section class="launch" id="authorise">
      <p class="act">Second real market test — a listing you place yourself</p>
      ${renderDecision({ consequence: approve, action: `/foundry/experiments/${id}/allow`, hidden: {}, primary: true })}
      <details class="fold"><summary><h2>What approving does</h2><span class="gist">seals the design; contacts nobody</span></summary>
        <p class="quiet">Approving seals the design and sets the allowance. It contacts nobody and publishes nothing; opening the shop and listing it are your own acts, below.
          <a class="why" href="/foundry/experiments/${id}/decide">Everything this rests on</a></p></details>
    </section>` : ''}
    ${blocked ? html`<section class="one alert" id="blocked"><div class="one-in">
      <p class="act">Blocked</p>
      <h2>${blocked.attempting} could not proceed</h2>
      <p class="lead">${blocked.because}</p>
      </div><dl class="facts">
      ${blocked.dependency ? html`<dt>What is down</dt><dd>${blocked.dependency}</dd>` : ''}
      <dt>External effect</dt><dd>none occurred</dd>
      <dt>Owner action</dt><dd>${blocked.ownerAction ? html`<strong>${blocked.ownerAction}</strong>` : 'none — this is Foundry\'s to repair, and it is being repaired'}</dd>
      <dt>Last checked</dt><dd>${blocked.checkedAt}</dd></dl>
    </section>` : ''}
    ${'notNow' in decision && v.state === 'needs_you' ? html`<section class="know" id="notyet">
      <h2>Not yet</h2><ul>${decision.notNow.map((m) => html`<li>${m}</li>`)}</ul>
      <p class="quiet">Authorising is refused until then by the rows themselves, not only by this page.</p>
    </section>` : ''}
    ${/* IS IT QUALIFIED TO MEET ANYBODY, in one word, with the reasons a click
          away. His standard: "I should not need to inspect a giant technical
          checklist every time Foundry proposes an experiment… Allow me to
          expand the object to understand the evidence, limits, and remaining
          dependencies." So the state is a line and the conditions are a fold.

          The same reading refuses the act at the outbound door, which is what
          keeps this from being decoration: a page that says "not ready" while
          the routine proceeds anyway is worse than no page at all. */ ''}
    ${v.qualification.blocking.length ? html`<section class="know" id="qualification">
      <h2>Ready for the world?</h2>
      <p class="lead">${QUALIFICATION_WORDS[v.qualification.state] ?? v.qualification.state}</p>
      <p class="quiet">This is not about whether you have authorised it — that is separate, and both are needed. It is about whether the machinery this test depends on has been shown to work. The same reading refuses the act itself, not just this page.</p>
      <details class="fold"><summary><h3>What is still missing</h3><span class="gist">${String(v.qualification.blocking.length)} of ${String(v.qualification.conditions.length)}</span></summary>
        <dl class="facts">${v.qualification.conditions.filter((c) => c.verdict !== 'met').map((c) => html`
          <dt>${c.name}</dt><dd>${c.because}</dd>`)}</dl>
        <p class="quiet">Already settled: ${v.qualification.conditions.filter((c) => c.verdict === 'met').map((c) => c.name).join('; ') || 'nothing yet'}.</p>
      </details>
    </section>` : ''}
    ${v.exceptions.length ? html`<section class="know" id="exceptions"><h2>Needs your attention</h2>
      <ul>${v.exceptions.map((x) => html`<li>${x}</li>`)}</ul></section>` : ''}
    ${watch}
    ${v.outcome.concluded ? '' : stepper}

    ${listing ? fold('acts', 'Your acts', 'only what you must do yourself', html`
      <p class="quiet">Foundry cannot open the shop, attach a bank account, opt out of the venue's advertising, accept its terms, or publish the listing on your behalf.</p>
      ${html([markdownToHtml(ownerActsForListing())] as unknown as TemplateStringsArray)}`, !!listing && v.state === 'running' && !liveListing) : ''}
    ${listing && v.state === 'running' && !liveListing ? html`<section class="know" id="listing"><h2>Where it is listed</h2>
      <p>When the listing is live on ${listing.venueName}, paste its address. That records the exposure and starts the ${v.rules.windowClosesAt ? '' : `${String((v.rules.daysLeft ?? 30))}-day `}window.</p>
      <form method="POST" action="/foundry/experiments/${id}/listing" class="stack">
        <label>Listing address <input type="url" name="url" required placeholder="https://www.etsy.com/listing/..." /></label>
        <button class="btn yes" type="submit">It is listed here</button></form>
    </section>` : ''}
    ${listing && liveListing && v.state === 'running' ? html`<section class="know" id="readings"><h2>What the venue reports</h2>
      <p class="quiet">Enter the venue's own numbers at day ${listing.readingsAtDays.join(', ')}, from Stats and Search Analytics. A reading is recorded as the venue reported it; a day with no order is recorded as an absence, never as evidence either way.</p>
      <form method="POST" action="/foundry/experiments/${id}/reading" class="stack">
        <label>Date of the reading <input type="date" name="date" required /></label>
        <label>Impressions (Search Analytics) <input type="number" name="impressions" min="0" step="1" /></label>
        <label>Views <input type="number" name="views" min="0" step="1" /></label>
        <label>Visits <input type="number" name="visits" min="0" step="1" /></label>
        <label>Favourites <input type="number" name="favourites" min="0" step="1" /></label>
        <label>Orders <input type="number" name="orders" min="0" step="1" /></label>
        <label>Traffic sources, as shown <input type="text" name="sources" placeholder="Etsy search 12, Etsy app &amp; other pages 3, Etsy marketing &amp; SEO 1" /></label>
        <label>Top search queries, as shown <input type="text" name="queries" placeholder="bid tracker (position 18), contractor spreadsheet (position 41)" /></label>
        <button class="btn" type="submit">Record this reading</button></form>
      <h3>An order</h3>
      <p class="quiet">From the venue's statement: the order number, the day it was paid, the gross charged and the fees taken. Never the buyer.</p>
      <form method="POST" action="/foundry/experiments/${id}/order" class="stack">
        <label>Order number <input type="text" name="order_ref" required /></label>
        <label>Paid on <input type="date" name="paid_at" required /></label>
        <label>Gross charged, in cents <input type="number" name="gross_cents" min="1" step="1" required placeholder="1400" /></label>
        <label>Fees taken, in cents (leave blank if not yet on the statement) <input type="number" name="fee_cents" min="0" step="1" /></label>
        <button class="btn" type="submit">Record this order</button></form>
      <h3>A refund</h3>
      <form method="POST" action="/foundry/experiments/${id}/refund" class="stack">
        <label>Order number <input type="text" name="order_ref" required /></label>
        <label>Refunded on <input type="date" name="refunded_at" required /></label>
        <label>Amount, in cents <input type="number" name="amount_cents" min="1" step="1" required placeholder="1400" /></label>
        <button class="btn" type="submit">Record this refund</button></form>
    </section>` : ''}

    ${listing ? '' : v.readiness.sending.status !== 'ready' && v.state !== 'declined' ? html`<section class="know" id="sending"><h2>Email sending</h2>
      <p>${v.readiness.sending.detail}</p>
      ${v.readiness.sending.status === 'not_connected' ? html`<form method="POST" action="/foundry/experiments/${id}/sending" class="stack">
        <label>From address, on your own domain <input type="email" name="from_email" required placeholder="you@yourcompany.com" /></label>
        <label>Your name as it should appear <input type="text" name="from_name" placeholder="Your name" /></label>
        <label>Resend API key for that domain <input type="password" name="credential" required autocomplete="off" /></label>
        <p class="quiet">The key is stored encrypted and used only to send. Foundry checks with the provider that the domain is verified before accepting it.</p>
        <button class="btn yes" type="submit">Connect</button></form>` : ''}
    </section>` : ''}

    <div class="inspect" id="inspect">
    ${short ? fold('short', short.headline, short.sealed ? 'sealed' : 'not yet sealed', html`<div class="know said">
      <ul class="plain">${short.lines.map((l) => html`<li>${l}</li>`)}</ul>
      <p class="quiet">${short.sealed ? 'This was written before you decided and sealed when you did, so it cannot be edited to match the result.' : 'Written before this runs. It seals when you decide.'} <a class="why" href="/foundry/experiments/${id}/decide">Before you decide</a> · <a class="why" href="/foundry/why/experiment/${id}">Show your work</a></p>
    </div>`, v.state === 'needs_you' || v.state === 'ready') : ''}

    ${fold('what', 'What this tests', v.why.question ? 'the question, the act, the prediction' : '', html`<dl class="facts">
      <dt>Question</dt><dd>${v.why.question || v.title}</dd>
      <dt>What Foundry does</dt><dd>${v.why.whatWeDo}</dd>
      <dt>Prediction, sealed</dt><dd>${v.why.whatWeExpect}</dd>
      <dt>Would disprove it</dt><dd>${v.why.wouldDisprove}</dd>
    </dl><p class="row"><a class="why" href="/foundry/why/experiment/${id}">Show your work</a></p>`)}

    ${fold('reconciled', 'What actually happened', `${String(reconciled.acts.length)} ${reconciled.acts.length === 1 ? 'act' : 'acts'}, counted from the rows`, html`
      <p class="quiet">Counted from the rows, not remembered. Each line says what it is and
        what it deliberately leaves out.</p>
      ${reconciled.acts.length === 0 ? html`<p>No act has authorised writing to anybody for
        this test.</p>` : html`<ul class="plain">${reconciled.acts.map((a) => html`<li>
          <b>${a.summary}</b>
          <p class="quiet">${a.decidedBy ? `Decided by ${a.decidedBy} on ${a.decidedAt ?? ''}.` : 'Not decided.'}
            ${a.revokedAt ? `Withdrawn ${a.revokedAt}.` : a.consumedAt ? `Used ${a.consumedAt}.` : `Unused, expires ${a.expiresAt}.`}</p>
        </li>`)}</ul>`}
      <p><strong>${reconciled.remainingAuthority}</strong></p>
      ${[['Who', reconciled.cohort], ['What reached them', reconciled.reached],
    ['What came back', reconciled.cameBack],
    ['Not evidence about this test', reconciled.notEvidence]].map(([label, counts]) => html`
        <details><summary class="quiet">${label as string}</summary>
          <ul class="plain">${(counts as Array<{ what: string; n: number; because: string }>)
    .map((x) => html`<li><b>${String(x.n)}</b> ${x.what}<p class="quiet">${x.because}</p></li>`)}</ul>
        </details>`)}`)}

    ${fold('allow', launch ? 'What authorising means' : 'What you allowed', '', html`
      <ul>${v.allow.explanation.map((l) => html`<li>${l}</li>`)}</ul>
      ${launch ? html`<form method="POST" action="/foundry/experiments/${id}/decline">
        <button class="btn" type="submit">Do not run it</button></form>` : ''}`)}

    ${fold('offer', 'The offer', v.offer.price, html`
      <p><strong>${v.offer.price}</strong>${v.offer.limits ? html` · <span class="quiet">${v.offer.limits}</span>` : ''}</p>
      ${v.offer.paymentLinkUrl ? html`<p>${listing ? 'Listed at' : 'Payment link'}: <a href="${v.offer.paymentLinkUrl}" rel="noopener">${v.offer.paymentLinkUrl}</a></p>` : listing ? html`<p class="quiet">${v.state === 'running' ? 'Not listed yet; paste the address above when it is live.' : `Listed by you on ${listing.venueName} after you approve the test.`}</p>` : html`<p class="quiet">${v.state === 'running' ? 'Foundry has not placed the link yet; it tries on every pass.' : 'The link is created by Foundry after you allow the test.'}</p>`}
      ${v.offer.deliverable ? html`<p>What a buyer receives: <strong>${v.offer.deliverable.title}</strong>${v.offer.deliverable.pulledAt ? ` (data pulled ${v.offer.deliverable.pulledAt})` : ''}${v.offer.deliverable.quality.ok || listing ? '' : html` — <span class="quiet">would not pass the quality check: ${v.offer.deliverable.quality.failures.join('; ')}</span>`}</p>` : html`<p class="quiet">Nothing to deliver is attached yet.</p>`}
      ${v.state === 'running' && !v.offer.paymentLinkUrl && !listing ? html`<div class="pair">
        <form method="POST" action="/foundry/experiments/${id}/place"><button class="btn" type="submit">Try placing it now</button></form>
        <form method="POST" action="/foundry/experiments/${id}/payment" class="stack"><label>Or a Stripe link you made, tagged for this test <input type="url" name="url" required placeholder="https://buy.stripe.com/..." /></label><button class="btn" type="submit">Use this link</button></form></div>` : ''}`)}

    ${v.publicPage ? fold('public', 'Public page', v.publicPage.status, html`
      <p><a href="${v.publicPage.url}" rel="noopener">${v.publicPage.url}</a> <span class="pill">${v.publicPage.status}</span></p>
      <p class="quiet">${v.publicPage.detail}</p>
      <p class="quiet"><a href="/foundry/public-workshop/preview/${id}">Preview as it would be published</a> · <a href="/foundry/public-workshop">The Workshop</a></p>
      ${v.publicPage.gate.length ? html`<p><strong>Before anyone is written to:</strong></p><ul>${v.publicPage.gate.map((g) => html`<li>${g}</li>`)}</ul>` : ''}`) : ''}

    ${listing ? '' : fold('reach', 'Reach', `${String(v.exposure.approved)} approved · ${String(v.exposure.excluded)} excluded`, html`
      <dl class="facts">
        <dt>Approved to contact</dt><dd>${String(v.exposure.approved)}</dd>
        <dt>Excluded</dt><dd>${String(v.exposure.excluded)}</dd>
        <dt>Still to review</dt><dd>${String(v.exposure.pending)}${v.exposure.pendingWebForm ? ` (+${v.exposure.pendingWebForm} web-form only)` : ''}</dd>
        <dt>Offers sent</dt><dd>${String(v.exposure.sent)}</dd>
        <dt>Confirmed received</dt><dd>${String(v.exposure.delivered)}${v.exposure.killAt ? ` of ${v.exposure.killAt} before it stops itself` : ''}</dd>
        <dt>Bounced</dt><dd>${String(v.exposure.bounced)}</dd>
      </dl>
      <p class="quiet"><a href="/foundry/experiments/${id}/recipients">Who may be contacted</a></p>`)}

    ${fold('money', 'Money', `${cents(v.money.spentCents)} spent of ${cents(v.money.allowanceCents)}`, html`
      <dl class="facts">
        <dt>${v.outcome.concluded ? 'Was set aside' : 'Set aside'}</dt><dd>${cents(v.money.authorisedCents)}${v.money.carvedCents > 0 ? ` — carved from the charter` : ''}${v.outcome.concluded ? ' — ended with its answer' : ''}</dd>
        <dt>Allowance standing</dt><dd>${cents(v.money.remainingCents)} of ${cents(v.money.allowanceCents)}</dd>
        <dt>Spent by Foundry</dt><dd>${cents(v.money.spentCents)}</dd>
        <dt>Paid by customers</dt><dd>${cents(v.money.paidCents, v.money.currency)} (${count(v.money.payments, 'payment')})</dd>
        <dt>Refunded</dt><dd>${cents(v.money.refundedCents, v.money.currency)} (${count(v.money.refunds, 'refund')})</dd>
      </dl>
      ${v.controls.allowance ? html`<p class="quiet">${v.controls.allowance.statement}</p>` : ''}`)}

    ${fold('rules', 'Rules it runs under', '', html`
      <p>${v.rules.success}</p>
      <p>It stops when: ${v.rules.stop.join('; ')}.</p>
      ${v.rules.windowClosesAt ? html`<p class="quiet">Window closes ${v.rules.windowClosesAt}${v.rules.daysLeft != null ? ` (${count(v.rules.daysLeft, 'day')} left)` : ''}.</p>` : ''}`)}

    ${fold('learned', v.learned.headline, '', html`
      <p>${v.learned.detail}</p>
      <p class="quiet">${v.learned.evidence}</p>
      ${v.judgment ? html`<p><strong>Judgment</strong> — ${v.judgment}</p>` : ''}`)}

    ${fold('timeline', 'What happened', v.timeline.length ? `${String(v.timeline.length)} ${v.timeline.length === 1 ? 'event' : 'events'}` : 'nothing yet', v.timeline.length
    ? html`<ul class="steps">${v.timeline.map((t) => html`<li><span class="k">${t.kind}</span><span>${t.text}</span><time>${t.at.slice(0, 16).replace('T', ' ')}</time></li>`)}</ul>`
    : html`<p class="quiet">Nothing yet.</p>`)}

    ${fold('details', 'Details', '', html`<dl class="facts">${v.details.map(([k, val]) => html`<dt>${k}</dt><dd>${val}</dd>`)}</dl>`)}

    ${genome === null ? '' : fold('kind', 'What kind of test this is', '', html`
      <dl class="facts">${DIMENSIONS.map((d) => html`<dt>${d.replace(/_/g, ' ')}</dt>
        <dd>${genome.traits[d].value === null
    ? html`<span class="unknown">not recorded</span>`
    : genome.traits[d].value}</dd>`)}</dl>
      ${alike === null ? '' : html`<p class="quiet">${alike.because}</p>`}
      ${alike === null || alike.against === null ? '' : html`<p class="quiet">Same:
        ${alike.shared.join(', ') || 'nothing'}. Different:
        ${alike.differs.join(', ') || 'nothing'}.</p>`}`)}
    </div>

    ${v.controls.canStop ? html`<section class="panel stop-panel" id="stop"><header><h2>${mark('stop')}Stop this test</h2></header>
      <p class="quiet">Stopping withdraws permission and the offer at once. Nothing more is sent; what the world already did stays on record. It cannot be restarted.</p>
      <form method="POST" action="/foundry/experiments/${id}/stop" class="stack">
        <label>Why <input type="text" name="reason" required placeholder="one line, for the record" /></label>
        <button class="btn" type="submit">Stop this test</button></form>
    </section>` : ''}`;
  return c.html(page(`${v.assetName ?? 'Experiment'} — ${v.stateLabel}`, body, 'experiments', where(v, 'test')));
});

// ─── Before you decide ───────────────────────────────────────────────────────
//
// ONE PAGE, ONCE, FOR THE ONLY DECISION THAT REACHES A STRANGER.
//
// Everything on it is read from rows written before this moment: the
// deliberation sealed at the decision it is asking for, the businesses the
// owner reviewed himself, the stop conditions set before the probe starts, and
// every readiness leg checked against the public internet rather than against
// a provider's optimism. It states what a positive result would establish and
// — the sentence that matters more — what a negative one would not.
//
// It has one control, and pressing it is the only way anybody is written to.
experimentRoutes.get('/foundry/experiments/:id/decide', async (c: any) => {
  const founderId = await founderOf(c);
  if (!founderId) return c.redirect('/onboarding');
  const id = String(c.req.param('id'));
  const v = await getExperimentView(founderId, id);
  if (!v) return c.notFound();
  const { designOf, theShortVersion, readStopConditions } = await import('../../services/venture/probe-design.js');
  const { externalReadiness } = await import('../../services/public-workshop/readiness.js');
  const d = await designOf(id);
  const short = await theShortVersion(id);
  const stops = d ? await readStopConditions(id) : [];
  const ready = await externalReadiness(founderId, id);
  const badge: Record<string, string> = { verified: 'seen in the world', ready: 'ready', waiting: 'waiting', blocked: 'blocked' };
  // WHAT THE FORGE READ AND WHAT ARGUED AGAINST IT, when the forge designed
  // it: each discipline's finding on its grounds, and the adversary's attacks
  // with whether each became an amendment. A hand-written design has none.
  const { findingsOf, attacksOf } = await import('../../services/venture/forge-deliberation.js');
  const lenses = await findingsOf(id);
  const attacks = await attacksOf(id);
  const LENS_WORD: Record<string, string> = { market_reality: 'Market reality', experimental_design: 'Experimental design', commercial_operations: 'Commercial operations', risk_ethics_compliance: 'Risk, ethics and compliance', economics_portfolio: 'Economics and the portfolio' };

  const { publicWorkshopOf } = await import('../../services/public-workshop/settings.js');
  const voice = (await publicWorkshopOf(founderId))?.publicName ?? 'the Workshop';
  const body = html`
    <h1>Before you decide</h1>
    <p class="lede">${v.assetName ?? 'This test'} — ${v.stateLabel}. Everything here was written before this moment, and nothing on this page contacts anybody.</p>
    ${d === null ? html`<p class="noticed"><strong>Nothing is recorded yet.</strong> There is no deliberation behind this test, so it cannot be allowed.</p>` : html`
    <section class="know"><h2>${short!.headline}</h2>
      <ul class="plain">${short!.lines.map((l) => html`<li>${l}</li>`)}</ul>
      <p class="quiet"><a class="why" href="/foundry/why/experiment/${id}">Show your work</a> — the whole record, including what it replaced.</p>
    </section>

    <section class="know"><h2>What I want to learn</h2>
      <p>${d.decides}</p>
      <p class="quiet">${d.decidesBecause}</p>
    </section>

    <section class="know"><h2>Why ${d.exchange.whatItIs.toLowerCase()}</h2>
      <p>${d.exchangeBecause}</p>
      <p class="quiet">What it shows: ${d.exchange.reveals}. What it confounds: ${d.exchange.confounds}.</p>
      <details><summary>What else I weighed, and did not choose</summary>
        <ul>${d.alternatives.map((a) => html`<li><strong>${a.whatItIs}</strong> — ${a.notChosenBecause}</li>`)}</ul>
      </details>
    </section>

    ${lenses.length === 0 ? '' : html`<section class="know"><h2>What each discipline said</h2>
      <p class="quiet">Written before the design was composed, each on the rows it names.</p>
      <ul class="plain">${lenses.map((f) => html`<li><strong>${LENS_WORD[f.lens] ?? f.lens}</strong> — ${f.finding} <span class="pill">${f.recommends}</span> <span class="quiet">${f.because}</span></li>`)}</ul>
      ${attacks.length === 0 ? '' : html`<details><summary>What the adversary argued (${String(attacks.length)}), and its verdict: ${attacks[0]!.verdict}</summary>
        <ul>${attacks.map((a) => html`<li>${a.claim} <span class="quiet">${a.why}</span>${a.accepted ? html` <span class="pill ok">amended</span>` : ''}</li>`)}</ul>
        <p class="quiet">${attacks[0]!.because}</p></details>`}
    </section>`}

    <section class="know"><h2>What each answer would mean</h2>
      <p><strong>If it works</strong> — ${d.canProve}</p>
      <p><strong>What it still would not establish</strong> — ${d.cannotProve}</p>
      <p class="quiet">Readings of the same result I cannot tell apart from this test alone:</p>
      <ul>${d.interpretations.filter((i) => i.distinguishedBy === null).map((i) => html`<li>If ${i.observation.toLowerCase()}: ${i.reading}</li>`)}</ul>
    </section>

    <section class="know"><h2>Who it reaches, and what it spends</h2>
      <dl class="facts">
        <dt>Written to</dt><dd>${String(v.exposure.approved)} businesses you reviewed yourself, once each, never twice</dd>
        <dt>Still to review</dt><dd>${String(v.exposure.pending)}</dd>
        <dt>How it reaches them</dt><dd>${d.distribution}</dd>
        <dt>Money</dt><dd>up to ${cents(v.money.allowanceCents)}</dd>
      </dl>
      <p class="quiet">Beyond money:</p>
      <ul>${d.costs.filter((x) => x.level !== 'none').map((x) => html`<li>${x.whatItIs} — <strong>${x.level}</strong>: ${x.grounds}</li>`)}</ul>
    </section>

    <section class="know"><h2>Where it stops itself</h2>
      <ul>${stops.map((x) => html`<li>At ${String(x.threshold)} ${x.whatItIs} (${String(x.count)} so far) — ${x.because}</li>`)}</ul>
      <p>${d.fulfilmentCap === null ? 'No cap on what may be owed at once.' : html`If it works, new offers stop at <strong>${String(d.fulfilmentCap)}</strong> briefs owed at once. ${d.ifItSucceeds}`}</p>
    </section>

    <section class="know"><h2>What it costs ${voice}, and what people can ask of it</h2>
      <p>One public name stands behind this and every later experiment. ${d.costs.find((x) => x.dimension === 'reputation')?.grounds ?? ''}</p>
      <p><strong>Contact policy</strong> — one message per business, no follow-up, from ${v.publicPage ? 'the Workshop' : 'the connected sender'}, with a postal address and an unsubscribe in every message. A refusal said to this test is a refusal for every test.</p>
      <p><strong>What they can ask for</strong> — the page asks each reader what should happen next. "Never" removes them from the whole Workshop; "nothing further" stops the next experiment writing to them even though it is not a complaint; anything else is kept in their own words.</p>
      ${v.publicPage ? html`<p><strong>Public page</strong> — <a href="${v.publicPage.url}" rel="noopener">${v.publicPage.url}</a> (${v.publicPage.status})</p>` : ''}
    </section>

    <section class="know"><h2>Readiness, checked against the world</h2>
      <p class="quiet">A provider answering is not proof. Every line marked “seen in the world” was read back over public HTTPS just now.</p>
      <ul class="plain">${ready.legs.map((l) => html`<li><span class="pill">${badge[l.status]}</span> <strong>${l.leg}</strong> — ${l.detail}</li>`)}</ul>
      ${ready.blocked > 0 ? html`<p class="noticed"><strong>${String(ready.blocked)} blocked.</strong> Nobody can be written to while any of these stands, whatever you press.</p>` : ''}
    </section>

    <section class="know" id="allow"><h2>${v.state === 'ready' ? 'Your decision' : 'Not yet'}</h2>
      <p><strong>My recommendation: ${d.recommendation}.</strong> ${d.recommendationBecause}</p>
      ${v.state === 'ready' ? html`<div class="pair">
        <form method="POST" action="/foundry/experiments/${id}/allow"><button class="btn yes" type="submit">Allow — up to ${cents(v.money.allowanceCents)}</button></form>
        <form method="POST" action="/foundry/experiments/${id}/decline"><button class="btn" type="submit">Do not run it</button></form></div>
      <p class="quiet">Allowing seals this record, publishes the page and lets Foundry begin writing on its next pass. Nothing is sent before you press it.</p>`
    : html`<p class="noticed">${v.allow.reason} Allowing is refused until then, by the rows themselves, not only by this page.</p>`}
    </section>`}
`;
  return c.html(page('Before you decide', body, 'experiments', where(v, 'decide')));
});

// ─── Who may be contacted ────────────────────────────────────────────────────
experimentRoutes.get('/foundry/experiments/:id/recipients', async (c: any) => {
  const founderId = await founderOf(c);
  if (!founderId) return c.redirect('/onboarding');
  const v = await getExperimentView(founderId, String(c.req.param('id')));
  if (!v) return c.notFound();
  const done = String(c.req.query('done') ?? ''); const error = String(c.req.query('error') ?? '');
  const id = v.id;
  const { theShortVersion } = await import('../../services/venture/probe-design.js');
  const short = await theShortVersion(id);
  const open = v.state === 'needs_you' || v.state === 'ready';
  const pending = v.recipients.filter((r) => r.reviewStatus === 'pending');
  const decided = v.recipients.filter((r) => r.reviewStatus !== 'pending');
  // AN EXCLUSION IS ABOUT A PERSON, NOT ABOUT A ROW. The same business can sit
  // on this list twice — once as it appears in a public listing and once as a
  // cohort names it, differing by an "LLC" — and striking one row used to
  // leave the other free to be written to at the SAME ADDRESS. Two reviewers
  // reading this page found it independently. The door refuses it now; this is
  // the page saying so, because a list that shows "approved" beside an address
  // it will never write to is its own kind of untruth.
  const struckAddresses = new Set(v.recipients
    .filter((r) => r.reviewStatus === 'struck' && r.email)
    .map((r) => r.email!.trim().toLowerCase()));
  const silenced = (r: ExperimentView['recipients'][number]): boolean =>
    r.reviewStatus === 'approved' && !!r.email && struckAddresses.has(r.email.trim().toLowerCase());
  // WHAT ACTUALLY HAPPENED TO THIS ADDRESS, WHICH IS NOT THE SAME AS WHAT
  // WOULD HAPPEN NOW. A row that was written to before this rule existed must
  // not be shown as protected: the message went, a person received it, and a
  // list that says otherwise is comforting the owner about a thing that
  // already happened to somebody else.
  const day = (at: string): string => at.slice(0, 10);
  const row = (r: ExperimentView['recipients'][number]) => html`<div class="noticed qitem">
    <p><strong>${r.counterpartyRef}</strong> <span class="pill">${r.reviewStatus === 'pending' ? (r.channel === 'email' ? 'to review' : 'web form only') : silenced(r) ? (r.writtenToAt ? 'written to, then excluded by address' : 'excluded by address') : r.reviewStatus === 'approved' ? 'approved' : 'excluded'}</span></p>
    <p class="quiet">${r.email ?? 'no published email'}${r.sourceUrl ? html` · <a href="${r.sourceUrl}" rel="noopener">source</a>` : ''}${r.reviewReason ? ` · ${r.reviewReason}` : ''}</p>
    ${silenced(r) ? (r.writtenToAt
    ? html`<p class="gap"><strong>This address is excluded on another line of this list, and a message went to it on ${day(r.writtenToAt)}.</strong>
        That happened before this test refused an address struck anywhere on its own list, so the exclusion did not stop it.
        Nothing further is sent to it.</p>`
    : html`<p class="quiet"><strong>This address is excluded on another line of this list.</strong> Nothing is written to it: an exclusion for this test binds on the person who would receive the message, not on the row it was recorded on.</p>`) : ''}
    ${r.qualifiedAt
      ? html`<p class="quiet">Why they are in this test's population: ${r.qualifiedBecause} · <a href="${r.qualifiedSource}" rel="noopener">the record that says so</a></p>`
      : html`<p class="quiet"><strong>No recorded reason this business is in the population this test names.</strong> Nothing will be written to them, whether or not you approve them here.</p>`}
    ${open && r.reviewStatus === 'pending' ? html`<div class="pair">
      <form method="POST" action="/foundry/experiments/${id}/recipients/${r.id}">
        <input type="hidden" name="decision" value="approved" />
        ${r.channel === 'web_form' ? html`<input type="email" name="email" placeholder="published email, if you have one" />` : ''}
        <button class="btn yes" type="submit">Approve &mdash; may be written to once</button></form>
      <form method="POST" action="/foundry/experiments/${id}/recipients/${r.id}">
        <input type="hidden" name="decision" value="struck" /><input type="text" name="reason" placeholder="why (optional)" />
        <button class="btn" type="submit">Exclude &mdash; never written to</button></form></div>` : ''}
  </div>`;
  const body = html`
    <h1>Who may be contacted</h1>
    ${notice(done, error)}
    <p class="lede">${v.recipients.length === 0 ? 'No candidate businesses are loaded.' : `${count(v.recipients.length, 'business', 'businesses')} from public listings. Exclude your employer and anything that could be a conflict. Nobody is written to until you allow the test, and nobody excluded is ever written to.`}</p>
    ${v.recipients.length ? html`<p class="quiet">${
    String(v.recipients.filter((r) => r.qualifiedAt).length)} of ${String(v.recipients.length)} carry a recorded, sourced reason for being in the population this design names. Your decision is whom to write to; the screening under it is Foundry's, and you can read it on every line.</p>` : ''}
    ${open && pending.some((r) => r.channel === 'email') ? html`<div class="pair"><form method="POST" action="/foundry/experiments/${id}/recipients/approve-remaining">
      <button class="btn yes" type="submit">Approve the rest (${String(pending.filter((r) => r.channel === 'email').length)}) &mdash; each may be written to once</button></form></div>` : ''}
    ${pending.map(row)}
    ${decided.length ? html`<h2 class="section">Reviewed</h2>${decided.map(row)}` : ''}
    <p class="row"><a class="btn go" href="/foundry/experiments/${id}">Back to the test</a></p>`;
  return c.html(page('Who may be contacted', body, 'experiments', where(v, 'recipients')));
});

// ─── Acts ────────────────────────────────────────────────────────────────────
const back = (c: any, id: string, to: 'test' | 'recipients', ok: string | null, err?: string) =>
  c.redirect(`/foundry/experiments/${id}${to === 'recipients' ? '/recipients' : ''}?${err ? `error=${encodeURIComponent(err)}` : `done=${ok ?? ''}`}`);
const said = (e: unknown): string => e instanceof HandRefused || e instanceof Error ? e.message.replaceAll('_', ' ') : String(e);

experimentRoutes.post('/foundry/experiments/:id/recipients/approve-remaining', requireInstitutionOwner(), async (c: any) => {
  const founderId = await founderOf(c); if (!founderId) return c.redirect('/onboarding');
  const id = String(c.req.param('id'));
  try { await approveRemaining({ founderId, experimentId: id }); return back(c, id, 'recipients', 'reviewed'); }
  catch (e) { return back(c, id, 'recipients', null, said(e)); }
});

experimentRoutes.post('/foundry/experiments/:id/recipients/:recipientId', requireInstitutionOwner(), async (c: any) => {
  const founderId = await founderOf(c); if (!founderId) return c.redirect('/onboarding');
  const id = String(c.req.param('id'));
  const form = await c.req.parseBody();
  const decision = String(form.decision ?? '') === 'struck' ? 'struck' : 'approved';
  const email = String(form.email ?? '').trim();
  try {
    await reviewRecipient({ founderId, experimentId: id, recipientId: String(c.req.param('recipientId')), decision, reason: String(form.reason ?? ''), email: email || undefined });
    return back(c, id, 'recipients', 'reviewed');
  } catch (e) { return back(c, id, 'recipients', null, said(e)); }
});

experimentRoutes.post('/foundry/experiments/:id/sending', requireInstitutionOwner(), async (c: any) => {
  const founderId = await founderOf(c); if (!founderId) return c.redirect('/onboarding');
  const id = String(c.req.param('id'));
  const form = await c.req.parseBody();
  const productId = await senderCompanyOf(founderId);
  if (!productId) return back(c, id, 'test', null, 'Foundry cannot tell which company of yours to send as: you have none, or more than one');
  const fromEmail = String(form.from_email ?? '').trim().toLowerCase();
  const credential = String(form.credential ?? '').trim();
  try {
    const { verifyResendDomain } = await import('../../services/outbound/sending-check.js');
    const check = await verifyResendDomain(credential, fromEmail);
    if (!check.ok) return back(c, id, 'test', null, check.reason);
    const { setSendingIdentity } = await import('../../services/outbound/sending-identity.js');
    await setSendingIdentity({ productId, provider: 'resend', credential, fromEmail, fromName: String(form.from_name ?? '') || null });
    return back(c, id, 'test', 'sending');
  } catch (e) { return back(c, id, 'test', null, said(e)); }
});

experimentRoutes.post('/foundry/experiments/:id/allow', requireInstitutionOwner(), async (c: any) => {
  const founderId = await founderOf(c); if (!founderId) return c.redirect('/onboarding');
  const id = String(c.req.param('id'));
  // A LISTING THE OWNER PLACES HIMSELF is approved, not allowed: the design
  // seals, the allowance is set, and Foundry records that it writes to nobody
  // and publishes nothing. Nothing is placed; the next acts are his.
  const listing = (await offerShapePlanOf(id))?.listing ?? null;
  if (listing) {
    try { await approveListing({ founderId, experimentId: id }); return back(c, id, 'test', 'approved'); }
    catch (e) { return back(c, id, 'test', null, said(e)); }
  }
  try {
    await allowExperiment({ founderId, experimentId: id });
  } catch (e) { return back(c, id, 'test', null, said(e)); }
  // Placing the offer is Foundry's act, not his. A provider hiccup here is an
  // exception on the page and a retry on the next pass, never a failed Allow.
  try { await prepareExposure(id); } catch { /* shown as an exception by the view */ }
  return back(c, id, 'test', 'allowed');
});

// ─── The listing the owner placed, and what the venue reports ────────────────
//
// Four writers, all his: where it is listed, a reading of the venue's own
// statistics, an order from its statement, a refund from its statement. Each
// is recorded as the provider's fact with its reference; none stores a buyer.
const int = (v: unknown): number | null => { const s = String(v ?? '').trim(); if (s === '') return null; const n = Number(s); return Number.isInteger(n) && n >= 0 ? n : null; };

experimentRoutes.post('/foundry/experiments/:id/listing', requireInstitutionOwner(), async (c: any) => {
  const founderId = await founderOf(c); if (!founderId) return c.redirect('/onboarding');
  const id = String(c.req.param('id'));
  const form = await c.req.parseBody();
  try { await recordListing({ founderId, experimentId: id, url: String(form.url ?? '') }); return back(c, id, 'test', 'listed'); }
  catch (e) { return back(c, id, 'test', null, said(e)); }
});

experimentRoutes.post('/foundry/experiments/:id/reading', requireInstitutionOwner(), async (c: any) => {
  const founderId = await founderOf(c); if (!founderId) return c.redirect('/onboarding');
  const id = String(c.req.param('id'));
  const form = await c.req.parseBody();
  try {
    await recordVenueReading({ founderId, experimentId: id, reading: {
      date: String(form.date ?? ''), impressions: int(form.impressions), views: int(form.views), visits: int(form.visits), favourites: int(form.favourites), orders: int(form.orders),
      sources: String(form.sources ?? ''), queries: String(form.queries ?? ''),
    } });
    return back(c, id, 'test', 'reading');
  } catch (e) { return back(c, id, 'test', null, said(e)); }
});

experimentRoutes.post('/foundry/experiments/:id/order', requireInstitutionOwner(), async (c: any) => {
  const founderId = await founderOf(c); if (!founderId) return c.redirect('/onboarding');
  const id = String(c.req.param('id'));
  const form = await c.req.parseBody();
  try {
    await recordVenueOrder({ founderId, experimentId: id, order: {
      orderRef: String(form.order_ref ?? ''), paidAt: String(form.paid_at ?? ''), grossCents: int(form.gross_cents) ?? 0, feeCents: int(form.fee_cents),
    } });
    return back(c, id, 'test', 'order');
  } catch (e) { return back(c, id, 'test', null, said(e)); }
});

experimentRoutes.post('/foundry/experiments/:id/refund', requireInstitutionOwner(), async (c: any) => {
  const founderId = await founderOf(c); if (!founderId) return c.redirect('/onboarding');
  const id = String(c.req.param('id'));
  const form = await c.req.parseBody();
  try {
    await recordVenueRefund({ founderId, experimentId: id, orderRef: String(form.order_ref ?? ''), refundedAt: String(form.refunded_at ?? ''), amountCents: int(form.amount_cents) ?? 0 });
    return back(c, id, 'test', 'refund');
  } catch (e) { return back(c, id, 'test', null, said(e)); }
});

/**
 * THE ONE PRESS THAT REACHES A STRANGER.
 *
 * Two acts on two pages became one act on one page, and the set it covers is
 * carried in the form rather than assumed: `expect` names the businesses the
 * owner was shown, `exclude` names every other reachable candidate the same
 * press strikes. If either list has moved since the page was drawn — a
 * screening pass qualified somebody, a candidate was loaded — nothing happens
 * and he is shown the page again. He authorises what he read, or nothing.
 *
 * Then the ordinary path, unchanged: the recipients are reviewed under his own
 * stamp, `allowExperiment` approves one measurement-critical act and writes
 * `authorised_act_id` on exactly the businesses it covers, and the row guard
 * refuses an offer to anybody else.
 */
experimentRoutes.post('/foundry/experiments/:id/authorise-contact', requireInstitutionOwner(), async (c: any) => {
  const founderId = await founderOf(c); if (!founderId) return c.redirect('/onboarding');
  const id = String(c.req.param('id'));
  const form = await c.req.parseBody();
  const asked = String(form.expect ?? '').split(',').filter(Boolean).sort();
  const dropped = String(form.exclude ?? '').split(',').filter(Boolean).sort();

  const now = await firstContactDecision(id);
  if ('notNow' in now) return back(c, id, 'test', null, now.notNow.join('; '));
  const include = now.include.map((r) => r.id).sort();
  const exclude = now.exclude.map((r) => r.id).sort();
  if (include.join(',') !== asked.join(',') || exclude.join(',') !== dropped.join(',')) {
    return back(c, id, 'test', null,
      'the businesses changed since this page was drawn, so nothing was authorised. Read it again.');
  }

  try {
    for (const r of now.include) {
      await reviewRecipient({ founderId, experimentId: id, recipientId: r.id, decision: 'approved' });
    }
    for (const r of now.exclude) {
      await reviewRecipient({ founderId, experimentId: id, recipientId: r.id, decision: 'struck',
        reason: 'not in this authorisation: no recorded reason for being in the population this test names' });
    }
    await allowExperiment({ founderId, experimentId: id });
  } catch (e) { return back(c, id, 'test', null, said(e)); }
  try { await prepareExposure(id); } catch { /* shown as an exception by the view */ }
  return back(c, id, 'test', 'allowed');
});

experimentRoutes.post('/foundry/experiments/:id/decline', requireInstitutionOwner(), async (c: any) => {
  const founderId = await founderOf(c); if (!founderId) return c.redirect('/onboarding');
  const id = String(c.req.param('id'));
  try { await declineExperiment({ founderId, experimentId: id }); return back(c, id, 'test', 'declined'); }
  catch (e) { return back(c, id, 'test', null, said(e)); }
});

experimentRoutes.post('/foundry/experiments/:id/stop', requireInstitutionOwner(), async (c: any) => {
  const founderId = await founderOf(c); if (!founderId) return c.redirect('/onboarding');
  const id = String(c.req.param('id'));
  const form = await c.req.parseBody();
  try { await stopExperiment({ founderId, experimentId: id, reason: String(form.reason ?? '') }); return back(c, id, 'test', 'stopped'); }
  catch (e) { return back(c, id, 'test', null, said(e)); }
});

experimentRoutes.post('/foundry/experiments/:id/place', requireInstitutionOwner(), async (c: any) => {
  const founderId = await founderOf(c); if (!founderId) return c.redirect('/onboarding');
  const id = String(c.req.param('id'));
  if (!(await getExperimentView(founderId, id))) return c.notFound();
  try { const r = await prepareExposure(id); return 'refused' in r ? back(c, id, 'test', null, r.refused) : !r.published ? back(c, id, 'test', null, r.failures.join('; ')) : back(c, id, 'test', 'placed'); }
  catch (e) { return back(c, id, 'test', null, said(e)); }
});

experimentRoutes.post('/foundry/experiments/:id/payment', requireInstitutionOwner(), async (c: any) => {
  const founderId = await founderOf(c); if (!founderId) return c.redirect('/onboarding');
  const id = String(c.req.param('id'));
  if (!(await getExperimentView(founderId, id))) return c.notFound();
  const form = await c.req.parseBody();
  try { const r = await attachPaymentLinkByUrl({ experimentId: id, url: String(form.url ?? '') }); return 'refused' in r ? back(c, id, 'test', null, r.refused) : back(c, id, 'test', 'placed'); }
  catch (e) { return back(c, id, 'test', null, said(e)); }
});
