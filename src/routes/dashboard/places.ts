// =============================================================================
// FOUNDRY — The addresses under the owner's three places.
//
// Global navigation stays at three doors: Foundry, Portfolio, Controls. What
// this adds is not a fourth door but ADDRESSES — durable, linkable places
// reached from context: a company's dimensions (Work, Economics, Customers,
// Experiments, Evidence), the work behind any claim (/foundry/why/…), every
// decision in one place (/foundry/decisions), and the search (/foundry/searching).
//
// Each one is a projection of institutional rows. Nothing here computes a
// score, invents a state, or lets him press anything the company page could
// not already; the forms that bind him stay where they were.
// =============================================================================
import { Hono } from 'hono';
import { html, raw } from 'hono/html';
import type { HtmlEscapedString } from 'hono/utils/html';
import { query, realCompany } from '../../db/client.js';
import { money } from '../../services/founder/portfolio.js';
import {
  LADDER_IN_PLAIN_WORDS, count, frameFor, page, placeHead, plainly, readCompany,
} from './foundry-shell.js';
import type { Where } from './foundry-shell.js';
import { CUSTOMER_SENSES, placeOf } from '../../services/founder/place.js';
import type { DimensionKey } from '../../services/founder/place.js';
import { WHY_KINDS, whyOf } from '../../services/founder/why.js';

export const placeRoutes = new Hono();

type Row = Record<string, unknown>;
const rows = async (sql: string, params: unknown[]): Promise<Row[]> =>
  (await query(sql, params)).rows as unknown as Row[];
const day = (s: unknown): string => String(s ?? '').slice(0, 10);

/** A list of sentences, or a stated absence. Never an empty list drawn as one. */
function lines(items: string[], absence: string): HtmlEscapedString | Promise<HtmlEscapedString> {
  return items.length
    ? html`<ul>${items.map((t) => html`<li>${t}</li>`)}</ul>`
    : html`<p class="quiet">${absence}</p>`;
}

async function founderOf(c: any): Promise<string | null> {
  const founder = c.get('founder') as { id?: string } | undefined;
  return founder?.id ? String(founder.id) : null;
}

/** Load one company as a place, or say it is not his. */
async function companyPlace(founderId: string, id: string, on: DimensionKey) {
  const [place, view] = await Promise.all([placeOf(founderId, id), readCompany(id, founderId)]);
  if (!place || !view) return { notFound: true as const };
  // A dimension that does not exist for this company is not a page. He can
  // only have reached it by an old link, and the honest answer is the overview.
  if (!place.dimensions.some((d) => d.key === on)) return { redirect: `/foundry/companies/${id}` as const };
  return { founderId, id, place, view, frame: frameFor(place, on) };
}

// ─── Work: is Foundry doing anything here ─────────────────────────────────────
placeRoutes.get('/foundry/companies/:id/work', async (c: any) => {
  const founderId = await founderOf(c);
  if (!founderId) return c.redirect('/onboarding');
  const r = await companyPlace(founderId, String(c.req.param('id')), 'work');
  if ('redirect' in r) return c.redirect(r.redirect);
  if ('notFound' in r) return c.notFound();
  const { id, place, view, frame } = r;
  const { recentDecisions } = await import('../../services/institution/standing-intent.js');
  const decided = await recentDecisions(id, 10);
  const workspaces = await rows(
    `SELECT purpose, substrate, ceiling, network, budget_cents, spent_cents, created_at, slept_at
       FROM workspaces WHERE subject_kind = 'company' AND subject_id = ? AND destroyed_at IS NULL
      ORDER BY created_at DESC`, [id]);
  const tests = await rows(
    `SELECT e.id, e.what_we_do, e.decision, e.ran_at, e.verdict FROM venture_experiments e
       JOIN products p ON p.from_opportunity_id = e.opportunity_id
      WHERE p.id = ? ORDER BY e.proposed_at DESC`, [id]);
  const nothing = view.proposals.length + view.advice.length + view.asks.length
    + view.responsibilities.length + workspaces.length + tests.length === 0;
  const body = html`
    ${placeHead(frame, view.name)}
    <p class="lede">${nothing
    ? 'Nothing is happening here. I am watching and not acting: no act is proposed, I look after nothing, and no test is running.'
    : place.needsHim > 0
      ? `${String(place.needsHim)} ${place.needsHim === 1 ? 'thing needs' : 'things need'} you. Everything else here is what I am doing without you.`
      : 'Nothing needs you. This is what I am doing here.'}</p>
    ${place.needsHim > 0 ? html`<div class="know" id="needs">
      <h2>Waiting on you</h2>
      ${view.proposals.map((p) => html`<div class="noticed"><p><strong>${p.summary}</strong></p>
        <p class="quiet">An act I cannot take until you say yes. Expires ${p.expiresAt}.</p>
        <p class="row"><a class="btn go" href="/foundry/companies/${id}#decide">Decide</a>
          <a class="why" href="/foundry/why/proposal/${p.id}">Show your work</a></p></div>`)}
      ${view.advice.map((a) => html`<div class="noticed"><p><strong>${a.summary}</strong></p>
        <p class="quiet">What I would do about the situation. Agreeing starts nothing.</p>
        <p class="row"><a class="btn" href="/foundry/companies/${id}#advice">Answer</a>
          <a class="why" href="/foundry/why/advice/${a.id}">Show your work</a></p></div>`)}
      ${view.asks.map((a) => html`<div class="noticed"><p><strong>${a.proposal}</strong></p>
        <p class="quiet">Something I noticed and would look after, if you say so.</p>
        <p class="row"><a class="btn" href="/foundry/companies/${id}#noticed">Answer</a></p></div>`)}
    </div>` : ''}
    <div class="know"><h2>What I look after</h2>
      ${lines(view.responsibilities.map((x) => `${x.title} — ${LADDER_IN_PLAIN_WORDS[x.state] ?? x.state}.`),
    'Nothing yet. I watch this company; I have not been asked to carry anything for it.')}
    </div>
    ${tests.length ? html`<div class="know"><h2>Being tested</h2>
      <ul>${tests.map((t) => html`<li>${String(t.what_we_do)} — ${
    t.decision === null ? 'waiting on you' : t.ran_at ? `ran ${day(t.ran_at)}${t.verdict ? `, ${String(t.verdict).replace('_', ' ')}` : ''}` : String(t.decision)}.
        <a class="why" href="/foundry/why/experiment/${String(t.id)}">Show your work</a></li>`)}</ul>
      <p class="quiet"><a href="/foundry/companies/${id}/experiments">All experiments</a></p>
    </div>` : ''}
    ${workspaces.length ? html`<div class="know"><h2>Workspaces</h2>
      <p class="quiet">Where I do work for this company. Each has a ceiling on what it may touch.</p>
      <ul>${workspaces.map((w) => html`<li>${String(w.purpose).replaceAll('_', ' ')} on ${String(w.substrate)},
        network ${String(w.network)}, ceiling ${String(w.ceiling)}${
    Number(w.budget_cents) > 0 ? `, ${money(Number(w.spent_cents))} of ${money(Number(w.budget_cents))} spent` : ''}${
    w.slept_at ? ', asleep' : ''}. Since ${day(w.created_at)}.</li>`)}</ul>
    </div>` : ''}
    <div class="know"><h2>Acts you decided</h2>
      ${lines(decided.map((d) => `${d.summary} — ${d.outcome === 'approved'
    ? (d.used ? 'approved, and done' : 'approved, not yet used') : d.outcome === 'refused' ? 'refused' : 'taken back'} on ${d.at}.`),
    'No act has been approved or refused here.')}
      <p class="quiet"><a href="/foundry/decisions?company=${id}">Every decision, in one place</a></p>
    </div>`;
  return c.html(page(`${view.name} — Work`, body, 'companies', frame));
});

// ─── Economics: what it earns, costs and is allowed ─────────────────────────
placeRoutes.get('/foundry/companies/:id/economics', async (c: any) => {
  const founderId = await founderOf(c);
  if (!founderId) return c.redirect('/onboarding');
  const r = await companyPlace(founderId, String(c.req.param('id')), 'economics');
  if ('redirect' in r) return c.redirect(r.redirect);
  if ('notFound' in r) return c.notFound();
  const { id, view, frame } = r;
  const { sparkline } = await import('../../lib/sparkline.js');
  const { burdenFor } = await import('../../services/founder/burden.js');
  const burden = (await burdenFor(founderId)).find((b) => b.productId === id) ?? null;
  const form = await rows(
    `SELECT value FROM portfolio_exposures WHERE founder_id = ? AND subject_kind = 'company'
        AND subject_id = ? AND dimension = 'revenue_model' AND retired_at IS NULL`, [founderId, id]);
  const spent = await rows(
    `SELECT tool, capability, amount_cents, source, recorded_at FROM asset_money_spent
      WHERE product_id = ? ORDER BY recorded_at DESC LIMIT 10`, [id]);
  const tiles = view.numbers.numbers.map((n) => {
    const spark = sparkline(n.series, { meaning: n.meaning });
    const cls = n.direction === null || n.direction === 'held' || n.meaning === 'neutral' ? ''
      : (n.direction === 'rose') === (n.meaning === 'up_is_good') ? ' up' : ' down';
    return html`<div class="tile"><dt class="k">${n.label}</dt><dd class="v">${n.now}</dd>
      <p class="d${cls}">${n.movement}</p>${raw(spark.svg)}</div>`;
  });
  const body = html`
    ${placeHead(frame, view.name)}
    ${burden ? html`<p class="lede">${burden.sentence}</p>` : ''}
    <div class="know"><h2>The numbers</h2>
      ${view.numbers.absence ? html`<p class="lede">${view.numbers.absence}</p>`
    : html`<div class="numbers">${tiles}</div>
      <p class="quiet">As of ${String(view.numbers.asOf)}, against the nearest reading to a month before.
        Whether any of it is good enough is yours to say.
        <a class="why" href="/foundry/why/company/${id}">Why I read it as I do</a></p>`}
    </div>
    <div class="know"><h2>How it earns</h2>
      ${form.length ? html`<p>${form.map((f) => String(f.value)).join(', ')}, from what it declared about itself.</p>`
    : html`<p class="quiet">It has not said how it earns, so it is not in the cash-flow-by-form picture on the Portfolio.</p>`}
    </div>
    <div class="know"><h2>What it costs</h2>
      ${view.reference ? html`<p class="lede">Nothing, ever. A company I made up cannot draw on money.</p>`
    : html`<p>$${view.spent30d.toFixed(2)} spent of $${String(view.budgetMonthly)} a month.</p>`}
      ${burden && burden.aiCostCents > 0 ? html`<p class="quiet">${money(burden.aiCostCents)} of that is my own running cost over thirty days.</p>` : ''}
      ${spent.length ? html`<ul>${spent.map((s) => html`<li>${money(Number(s.amount_cents))} on ${String(s.tool)}${
    s.capability ? ` (${String(s.capability)})` : ''}, ${String(s.source)}, ${day(s.recorded_at)}.</li>`)}</ul>` : ''}
    </div>
    <div class="know"><h2>What you allowed</h2>
      ${view.allowance ? html`<p><strong>Up to $${view.allowance.amount}</strong> — $${view.allowance.left} of it left. ${view.allowance.statement}</p>`
    : html`<p class="quiet">No allowance. I cannot spend anything for this company; every spend would be proposed first.</p>`}
      ${view.formerAllowance ? html`<p class="quiet">Before ${view.formerAllowance.withdrawnAt} it was $${view.formerAllowance.amount} — ${view.formerAllowance.reason}.</p>` : ''}
      <p class="quiet"><a href="/foundry/companies/${id}#matters">Change it on the company page</a></p>
    </div>`;
  return c.html(page(`${view.name} — Economics`, body, 'companies', frame));
});

// ─── Customers: what Foundry can see about the people who pay ───────────────
placeRoutes.get('/foundry/companies/:id/customers', async (c: any) => {
  const founderId = await founderOf(c);
  if (!founderId) return c.redirect('/onboarding');
  const r = await companyPlace(founderId, String(c.req.param('id')), 'customers');
  if ('redirect' in r) return c.redirect(r.redirect);
  if ('notFound' in r) return c.notFound();
  const { id, view, frame } = r;
  const senses = view.senses.filter((s) => CUSTOMER_SENSES.has(s.senseKey));
  const blind = view.blind.filter((b) => CUSTOMER_SENSES.has(b.senseKey));
  const numbers = view.numbers.numbers.filter((n) => /customer|churn|user|sign|subscri|active|retention/i.test(n.label));
  const body = html`
    ${placeHead(frame, view.name)}
    <p class="lede">What I can see about the people who pay, and where from. None of it lets me contact anyone.</p>
    <div class="know"><h2>What I can see</h2>
      <ul>${senses.map((s) => html`<li><strong>${s.wouldLearn}</strong> — from ${s.providerName}${
    s.mode === 'reference' ? ', invented' : s.mode === 'sandbox' ? ', in test mode' : ''}.
        ${s.lastError ? html`<span class="gap">Failing: ${s.lastError}.</span>` : s.lastObservedAt ? `Last reported ${s.lastObservedAt.slice(0, 10)}.` : 'Nothing reported yet.'}</li>`)}</ul>
    </div>
    ${numbers.length ? html`<div class="know"><h2>The numbers about them</h2>
      <ul>${numbers.map((n) => html`<li>${n.label}: ${n.now} — ${n.movement}.</li>`)}</ul>
    </div>` : ''}
    ${blind.length ? html`<div class="know"><h2>What I cannot see</h2>
      ${blind.map((b) => html`<p><span class="gap">I cannot see ${b.cannotSee}.</span>
        <a href="/foundry/companies/${id}/see/${b.senseKey}">Look at that</a></p>`)}
    </div>` : ''}`;
  return c.html(page(`${view.name} — Customers`, body, 'companies', frame));
});

// ─── Experiments: what has been tested for this, and what it said ───────────
placeRoutes.get('/foundry/companies/:id/experiments', async (c: any) => {
  const founderId = await founderOf(c);
  if (!founderId) return c.redirect('/onboarding');
  const r = await companyPlace(founderId, String(c.req.param('id')), 'experiments');
  if ('redirect' in r) return c.redirect(r.redirect);
  if ('notFound' in r) return c.notFound();
  const { id, view, frame } = r;
  // Ownership and reality were already settled by readCompany above; this reads
  // one column of a company that page has already disclosed as his, or invented.
  const lineage = (await rows(`SELECT from_opportunity_id FROM products WHERE id = ?`, [id]))[0];
  const { whatWasTried } = await import('../../services/venture/validation.js');
  const tried = lineage?.from_opportunity_id ? await whatWasTried(String(lineage.from_opportunity_id)) : [];
  const legacy = await rows(
    `SELECT id, name, type, status, success_metric, created_at FROM experiments WHERE product_id = ?
      ORDER BY created_at DESC LIMIT 20`, [id]);
  const body = html`
    ${placeHead(frame, view.name)}
    <p class="lede">${tried.length + legacy.length === 0 ? 'Nothing has been tested for this yet.'
    : `${count(tried.length + legacy.length, 'test')}. Each is one question put to the world, with what I expected sealed before it ran.`}</p>
    ${tried.map((t) => html`<div class="noticed">
      <p><strong>${t.whatWeDo}</strong></p>
      <p class="quiet">Settles: ${t.question}</p>
      <p><strong>I expected</strong> — ${t.whatWeExpect}</p>
      <p><strong>Would disprove it</strong> — ${t.wouldDisprove}</p>
      <p class="quiet">${t.costCents > 0 ? `${money(t.costCents)}. ` : ''}${
    t.decision === null ? 'Waiting on you.' : t.decision === 'declined' ? 'You declined it.'
      : t.ranAt ? `Ran ${t.ranAt.slice(0, 10)}${t.verdict ? ` — ${t.verdict.replace('_', ' ')}` : ''}.` : 'Approved; it has not run.'}${
    t.validity === 'invalid' ? ` Invalid: ${t.invalidBecause ?? 'it did not measure what it was for'}.` : ''}</p>
      ${t.whatHappened ? html`<p><strong>What happened</strong> — ${t.whatHappened}</p>` : ''}
      <p class="row"><a class="why" href="/foundry/why/experiment/${t.id}">Show your work</a></p>
    </div>`)}
    ${legacy.length ? html`<div class="know"><h2>Earlier tests</h2>
      <ul>${legacy.map((e) => html`<li>${String(e.name)} — ${String(e.type).replaceAll('_', ' ')}, ${String(e.status).replaceAll('_', ' ')}; measured by ${String(e.success_metric)}. ${day(e.created_at)}.</li>`)}</ul>
    </div>` : ''}
    ${lineage?.from_opportunity_id ? html`<p class="quiet">This company came from a search.
      <a href="/foundry/why/candidate/${String(lineage.from_opportunity_id)}">Why I brought it to you</a></p>` : ''}`;
  return c.html(page(`${view.name} — Experiments`, body, 'companies', frame));
});

// ─── Evidence: what is known about it, and on what basis ─────────────────────
placeRoutes.get('/foundry/companies/:id/evidence', async (c: any) => {
  const founderId = await founderOf(c);
  if (!founderId) return c.redirect('/onboarding');
  const r = await companyPlace(founderId, String(c.req.param('id')), 'evidence');
  if ('redirect' in r) return c.redirect(r.redirect);
  if ('notFound' in r) return c.notFound();
  const { id, view, frame } = r;
  const { legalSurfaceOf, structuralFactsOf } = await import('../../services/venture/legal-surface.js');
  const [surfaces, facts] = await Promise.all([legalSurfaceOf('company', id), structuralFactsOf('company', id)]);
  const resolutions = await rows(
    `SELECT r.kind, r.verdict, r.because, r.resolved_by, r.resolved_at FROM prediction_resolutions r
      WHERE r.founder_id = ?
        AND r.prediction_id IN (SELECT e.id FROM venture_experiments e JOIN products p
              ON p.from_opportunity_id = e.opportunity_id WHERE p.id = ?)
      ORDER BY r.resolved_at DESC`, [founderId, id]);
  const body = html`
    ${placeHead(frame, view.name)}
    <p class="lede">What is known about this company, and on what basis. Recognised, not certified: I say what I see and who would have to confirm it.</p>
    ${surfaces.length ? html`<div class="know"><h2>Exposure I have recognised</h2>
      ${surfaces.map((s) => html`<div class="noticed">
        <p><strong>${s.whatItIs}</strong> — ${s.severity}${s.needsProfessional ? ', needs a professional' : ''}.</p>
        <p>${s.whatItCreates}</p>
        ${s.known ? html`<p class="quiet"><strong>Known:</strong> ${s.known}</p>` : ''}
        ${s.unknown ? html`<p class="quiet"><strong>Unknown:</strong> ${s.unknown}</p>` : ''}
        ${s.assumes ? html`<p class="quiet"><strong>Assumes:</strong> ${s.assumes}</p>` : ''}
      </div>`)}
    </div>` : ''}
    ${facts.length ? html`<div class="know"><h2>Structural facts</h2>
      <ul>${facts.map((f) => html`<li>${f.whatItIs}: ${f.present === null ? 'unknown' : f.present ? 'present' : 'absent'} (${f.basis}${f.grounds ? ` — ${f.grounds}` : ''}).</li>`)}</ul>
    </div>` : ''}
    ${resolutions.length ? html`<div class="know"><h2>Predictions the world settled</h2>
      <ul>${resolutions.map((x) => html`<li>${String(x.verdict).replace('_', ' ')}, by ${String(x.resolved_by)} on ${day(x.resolved_at)}: ${String(x.because)}</li>`)}</ul>
    </div>` : ''}
    <div class="know"><h2>Where the evidence comes from</h2>
      ${lines(view.senses.map((s) => `${s.wouldLearn}, from ${s.providerName}${
    s.mode === 'reference' ? ' (invented)' : s.mode === 'sandbox' ? ' (test mode)' : ''}; ${
    s.lastObservedAt ? `last reported ${s.lastObservedAt.slice(0, 10)}` : 'nothing reported yet'}.`),
    'Nothing reports to me about this company. Everything above was recognised from what you said or what a search found.')}
      ${view.blind.length ? html`<p class="quiet">I cannot see ${view.blind.map((b) => b.cannotSee).join('; ')}.</p>` : ''}
    </div>`;
  return c.html(page(`${view.name} — Evidence`, body, 'companies', frame));
});

// ─── Why: the work behind any claim ─────────────────────────────────────────
placeRoutes.get('/foundry/why/:kind/:id', async (c: any) => {
  const founderId = await founderOf(c);
  if (!founderId) return c.redirect('/onboarding');
  const kind = String(c.req.param('kind'));
  if (!WHY_KINDS.has(kind)) return c.notFound();
  const why = await whyOf(founderId, kind, String(c.req.param('id')));
  if (!why) return c.notFound();
  const frame: Where = {
    eyebrow: 'Why',
    crumbs: [{ href: '/foundry', label: 'Foundry' },
      ...(why.object.kind === 'company'
        ? [{ href: '/foundry/companies', label: 'Portfolio' }, { href: why.object.href, label: why.object.name }]
        : [{ href: '/foundry/searching', label: 'Searching' }]),
      { href: c.req.path, label: 'Why' }],
    scope: why.object.kind === 'company' && why.object.id
      ? { kind: 'company', id: why.object.id, name: why.object.name }
      : { kind: 'searching', id: null, name: 'the search' },
    local: [],
    chips: [],
  };
  const level = (title: string, items: string[], open = false, absence = 'Nothing behind this level.') =>
    html`<details class="know fold level"${open ? ' open' : ''}><summary><h3>${title}</h3><span class="gist">${
      items.length ? count(items.length, 'line') : 'nothing'}</span></summary>${lines(items, absence)}</details>`;
  const body = html`
    <p class="crumbline"><a href="${why.object.href}">← ${why.object.name}</a></p>
    <h1>${why.title}</h1>
    <div class="hero"><h2>${why.answer}</h2>
      <p>What I said. Everything under it is where it came from, in the order you would ask.</p></div>
    ${level('Why', why.because, true, 'I have nothing to give as a reason. That is itself a finding.')}
    ${level('Evidence', why.evidence, true, 'No evidence is recorded. It rests on the reasons above and nothing else.')}
    ${level('What this rests on', why.restsOn)}
    ${level('Other recorded paths', why.otherRecordedPaths)}
    ${level('Uncertainty', why.uncertainty, false, 'Nothing I know of makes this uncertain — which is a claim you may doubt.')}
    ${level('Activity', why.activity)}
    ${level('Outcome', why.outcome)}
    ${level('Cost', why.cost)}
    ${level('Authority', why.authority)}
    <details class="know fold level"><summary><h3>Technical</h3><span class="gist">for an engineer</span></summary>
      <dl class="tech">${why.technical.map(([k, v]) => html`<dt>${k}</dt><dd>${v}</dd>`)}</dl>
      <p class="quiet">Rows, not reasoning. Every line above is read from these; none of it is a model remembering what it thought.</p>
    </details>`;
  return c.html(page(why.title, body, why.object.kind === 'company' ? 'companies' : 'foundry', frame));
});

// ─── Decisions: everything that waits on him, and everything he decided ─────
placeRoutes.get('/foundry/decisions', async (c: any) => {
  const founderId = await founderOf(c);
  if (!founderId) return c.redirect('/onboarding');
  const companyId = String(c.req.query('company') ?? '').trim() || null;
  // A company named in the address is looked up by id and its reality read
  // and disclosed, as the company page does: exclusion here would make the
  // link from an invented company's own page a dead end.
  const company = companyId
    ? (await rows(`SELECT id, name, reality FROM products WHERE id = ? AND owner_id = ? AND deleted_at IS NULL`, [companyId, founderId]))[0] ?? null
    : null;
  // Unnamed, the page is his decisions about his companies: the reality
  // boundary applies, and invented companies keep their decisions on their own
  // pages.
  const params = company ? [founderId, String(company.id)] : [founderId];
  const openActs = await rows(
    `SELECT a.id, a.summary, a.expires_at, p.id AS product_id, p.name FROM proposed_acts a
       JOIN products p ON p.id = a.product_id
      WHERE p.owner_id = ? AND ${company ? 'p.id = ?' : realCompany('p')} AND a.decision IS NULL AND a.revoked_at IS NULL
        AND a.expires_at > CURRENT_TIMESTAMP ORDER BY a.expires_at`, params);
  const openAdvice = await rows(
    `SELECT r.id, r.summary, p.id AS product_id, p.name FROM situation_recommendations r
       JOIN products p ON p.id = r.product_id
      WHERE p.owner_id = ? AND ${company ? 'p.id = ?' : realCompany('p')} AND r.decided_at IS NULL ORDER BY r.raised_at`, params);
  const openAsks = await rows(
    `SELECT rc.id, rc.proposed_responsibility, p.id AS product_id, p.name FROM responsibility_candidates rc
       JOIN products p ON p.id = rc.product_id
      WHERE p.owner_id = ? AND ${company ? 'p.id = ?' : realCompany('p')} AND rc.status = 'pending' ORDER BY rc.rowid`, params);
  const decidedActs = await rows(
    `SELECT a.id, a.summary, a.decision, a.decided_at, a.revoked_at, a.consumed_at, p.id AS product_id, p.name
       FROM proposed_acts a JOIN products p ON p.id = a.product_id
      WHERE p.owner_id = ? AND ${company ? 'p.id = ?' : realCompany('p')} AND (a.decision IS NOT NULL OR a.revoked_at IS NOT NULL)
      ORDER BY COALESCE(a.revoked_at, a.decided_at) DESC LIMIT 40`, params);
  const decidedAdvice = await rows(
    `SELECT r.id, r.summary, r.decision, r.decided_at, p.id AS product_id, p.name FROM situation_recommendations r
       JOIN products p ON p.id = r.product_id
      WHERE p.owner_id = ? AND ${company ? 'p.id = ?' : realCompany('p')} AND r.decided_at IS NOT NULL ORDER BY r.decided_at DESC LIMIT 40`, params);
  const decidedCandidates = company ? [] : await rows(
    `SELECT id, headline, verdict, decided_at FROM venture_opportunities
      WHERE founder_id = ? AND verdict IS NOT NULL ORDER BY decided_at DESC LIMIT 40`, [founderId]);
  const decidedTests = company ? [] : await rows(
    `SELECT e.id, e.what_we_do, e.decision, e.decided_at FROM venture_experiments e
      WHERE e.founder_id = ? AND e.decision IS NOT NULL ORDER BY e.decided_at DESC LIMIT 40`, [founderId]);
  const waiting = openActs.length + openAdvice.length + openAsks.length;
  const decidedAll = [
    ...decidedActs.map((a) => ({ at: String(a.revoked_at ?? a.decided_at), what: String(a.summary),
      how: a.revoked_at ? 'taken back' : `${String(a.decision)}${a.consumed_at ? ', done' : ''}`,
      href: `/foundry/why/proposal/${String(a.id)}`, where: String(a.name), whereHref: `/foundry/companies/${String(a.product_id)}` })),
    ...decidedAdvice.map((a) => ({ at: String(a.decided_at), what: String(a.summary), how: String(a.decision),
      href: `/foundry/why/advice/${String(a.id)}`, where: String(a.name), whereHref: `/foundry/companies/${String(a.product_id)}` })),
    ...decidedCandidates.map((o) => ({ at: String(o.decided_at), what: String(o.headline), how: String(o.verdict),
      href: `/foundry/why/candidate/${String(o.id)}`, where: 'the search', whereHref: '/foundry/searching' })),
    ...decidedTests.map((e) => ({ at: String(e.decided_at), what: String(e.what_we_do), how: String(e.decision),
      href: `/foundry/why/experiment/${String(e.id)}`, where: 'a test', whereHref: '/foundry/searching' })),
  ].sort((a, b) => (a.at < b.at ? 1 : a.at > b.at ? -1 : 0)).slice(0, 60);
  const frame: Where = {
    eyebrow: 'Decisions',
    crumbs: [{ href: '/foundry', label: 'Foundry' },
      ...(company ? [{ href: '/foundry/companies', label: 'Portfolio' }, { href: `/foundry/companies/${String(company.id)}`, label: String(company.name) }] : []),
      { href: c.req.path, label: 'Decisions' }],
    scope: company ? { kind: 'company', id: String(company.id), name: String(company.name) } : { kind: 'decisions', id: null, name: 'your decisions' },
    local: company ? [{ href: '/foundry/decisions', label: 'All companies', count: null, on: false }] : [],
    chips: [],
  };
  const body = html`
    ${company ? html`<p class="crumbline"><a href="/foundry/companies/${String(company.id)}">← ${String(company.name)}</a></p>` : ''}
    <h1>${company ? `Decisions about ${String(company.name)}` : 'Decisions'}</h1>
    ${company && String(company.reality) === 'reference' ? html`<p class="quiet"><strong>${String(company.name)} does not exist.</strong> I made it up; nothing decided here is about a real company.</p>` : ''}
    <p class="lede">${waiting === 0 ? 'Nothing is waiting on you.' : `${count(waiting, 'thing')} ${waiting === 1 ? 'waits' : 'wait'} on you.`}
      Everything you decide is kept here, with why I asked.</p>
    ${waiting > 0 ? html`<div class="know"><h2>Waiting on you</h2>
      ${openActs.map((a) => html`<div class="noticed"><p><strong>${String(a.summary)}</strong></p>
        <p class="quiet">An act, for <a href="/foundry/companies/${String(a.product_id)}">${String(a.name)}</a>. Expires ${day(a.expires_at)}.</p>
        <p class="row"><a class="btn go" href="/foundry/companies/${String(a.product_id)}#decide">Decide</a>
          <a class="why" href="/foundry/why/proposal/${String(a.id)}">Show your work</a></p></div>`)}
      ${openAdvice.map((a) => html`<div class="noticed"><p><strong>${String(a.summary)}</strong></p>
        <p class="quiet">Advice, for <a href="/foundry/companies/${String(a.product_id)}">${String(a.name)}</a>.</p>
        <p class="row"><a class="btn" href="/foundry/companies/${String(a.product_id)}#advice">Answer</a>
          <a class="why" href="/foundry/why/advice/${String(a.id)}">Show your work</a></p></div>`)}
      ${openAsks.map((a) => html`<div class="noticed"><p><strong>${String(a.proposed_responsibility)}</strong></p>
        <p class="quiet">Something I noticed at <a href="/foundry/companies/${String(a.product_id)}">${String(a.name)}</a>.</p>
        <p class="row"><a class="btn" href="/foundry/companies/${String(a.product_id)}#noticed">Answer</a></p></div>`)}
    </div>` : ''}
    <div class="know"><h2>What you decided</h2>
      ${decidedAll.length ? html`<ul>${decidedAll.map((d) => html`<li><strong>${d.what}</strong> — ${d.how} on ${day(d.at)},
        at <a href="${d.whereHref}">${d.where}</a>. <a class="why" href="${d.href}">Why I asked</a></li>`)}</ul>`
    : html`<p class="quiet">Nothing yet. When you approve, refuse, agree or bury something, it is kept here.</p>`}
    </div>`;
  return c.html(page('Decisions', body, company ? 'companies' : 'foundry', frame));
});

// ─── Searching: the one search, its candidates, and what was buried ─────────
placeRoutes.get('/foundry/searching', async (c: any) => {
  const founderId = await founderOf(c);
  if (!founderId) return c.redirect('/onboarding');
  const m = await import('../../services/venture/mandate.js');
  const progress = await m.mandateProgress(founderId);
  const candidates = progress ? await m.candidatesFor(progress.mandate.id) : [];
  const decided = progress ? await m.whatWasDecided(progress.mandate.id) : [];
  const buried = await m.graveyardFor(founderId, 10);
  const past = await m.pastSearches(founderId, 5);
  const frame: Where = {
    eyebrow: 'Searching',
    crumbs: [{ href: '/foundry', label: 'Foundry' }, { href: '/foundry/searching', label: 'Searching' }],
    scope: { kind: 'searching', id: progress?.mandate.id ?? null, name: 'the search' },
    local: [], chips: progress ? [progress.mandate.evidenceMode === 'reference' ? 'invented' : 'real',
      `${String(progress.looked)} looked at`, `${String(progress.open)} open`, `${String(progress.rejected)} buried`] : [],
  };
  const body = html`
    <h1>${progress ? 'What I am looking for' : 'I am not looking for anything'}</h1>
    ${progress ? html`
      ${frame.chips?.length ? html`<p class="chips">${frame.chips.map((ch) => html`<span class="chip">${ch}</span>`)}</p>` : ''}
      <p class="lede">${progress.mandate.statement}</p>
      ${progress.mandate.guidance.length ? html`<ul>${progress.mandate.guidance.map((g) => html`<li>${g.statement}</li>`)}</ul>` : ''}
      ${progress.blocked ? html`<p class="gap"><strong>Where it has got to:</strong> ${progress.blocked}</p>
        <p class="quiet">What I would need: ${progress.wouldNeed ?? ''}</p>` : ''}
      <p class="quiet"><strong>Looking through</strong> — ${progress.seeingThrough.length ? progress.seeingThrough.join('; ') : 'nothing yet'}.</p>
      ${progress.stillDark.length ? html`<p class="gap"><strong>Still cannot see</strong> — ${progress.stillDark.join('; ')}.</p>` : ''}
      <div class="know"><h2>Candidates</h2>
        ${candidates.length ? candidates.map((k) => html`<div class="noticed">
          <p><strong>${k.headline}</strong></p>
          <p class="quiet">${k.whoHasIt} — ${k.theProblem}</p>
          ${k.blockedBy ? html`<p class="gap">${k.blockedBy}</p>` : ''}
          ${k.failsBecause ? html`<p class="gap">${k.failsBecause}</p>` : ''}
          <p class="row"><a class="btn" href="/foundry#the-one-thing">Decide on Foundry</a>
            <a class="why" href="/foundry/why/candidate/${k.id}">Show your work</a></p>
        </div>`) : html`<p class="quiet">None yet. Bringing you none is a real answer.</p>`}
      </div>
      ${decided.length ? html`<div class="know"><h2>Decided in this search</h2>
        <ul>${decided.map((d) => html`<li><strong>${d.headline}</strong> — ${d.verdict} on ${day(d.when)}: ${d.why}</li>`)}</ul>
      </div>` : ''}`
    : html`<p class="lede">Say what you want on <a href="/foundry">Foundry</a> and I will start. One search at a time.</p>`}
    ${buried.length ? html`<div class="know"><h2>Buried</h2>
      <p class="quiet">What you rejected, and why. I do not bring the same thing again unless something changes.</p>
      <ul>${buried.map((b) => html`<li><strong>${b.headline}</strong>${b.reference ? ' (invented)' : ''} — ${b.why}, ${day(b.when)}.${
    b.revisitIf ? ` Revisit if ${b.revisitIf}.` : ''}</li>`)}</ul>
    </div>` : ''}
    ${past.length ? html`<div class="know"><h2>Earlier searches</h2>
      <ul>${past.map((s) => html`<li>${s.statement} — closed ${day(s.closedAt)}, ${s.why}.</li>`)}</ul>
    </div>` : ''}`;
  return c.html(page('Searching', body, 'foundry', frame));
});
