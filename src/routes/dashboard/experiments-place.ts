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
import { html } from 'hono/html';
import type { HtmlEscapedString } from 'hono/utils/html';
import { count, page } from './foundry-shell.js';
import type { Where } from './foundry-shell.js';
import { requireInstitutionOwner } from '../../middleware/rbac.js';
import { getExperimentView, listExperiments } from '../../services/founder/experiment-view.js';
import type { ExperimentView } from '../../services/founder/experiment-view.js';
import {
  HandRefused, allowExperiment, approveRemaining, attachPaymentLinkByUrl, declineExperiment, prepareExposure,
  reviewRecipient, senderCompanyOf, stopExperiment,
} from '../../services/venture/hand.js';

export const experimentRoutes = new Hono();

async function founderOf(c: any): Promise<string | null> {
  const founder = c.get('founder') as { id?: string } | undefined;
  return founder?.id ? String(founder.id) : null;
}

const where = (v: ExperimentView | null, on: 'test' | 'recipients' | 'list' | 'decide'): Where => ({
  crumbs: [{ href: '/foundry', label: 'Foundry' }, { href: '/foundry/experiments', label: 'Experiments' }, ...(v ? [{ href: `/foundry/experiments/${v.id}`, label: v.assetName ?? 'This test' }] : [])],
  scope: { kind: 'foundry', id: v?.id ?? null, name: v?.assetName ?? 'Experiments' },
  local: v ? [
    { href: `/foundry/experiments/${v.id}`, label: 'The test', count: null, on: on === 'test' },
    { href: `/foundry/experiments/${v.id}/recipients`, label: 'Who may be contacted', count: v.exposure.pending || null, on: on === 'recipients' },
    { href: `/foundry/experiments/${v.id}/decide`, label: 'Before you decide', count: null, on: on === 'decide' },
  ] : [],
  chips: [],
});

const stateWord: Record<ExperimentView['state'], string> = { needs_you: 'Needs you', ready: 'Ready', running: 'Running', completed: 'Completed', stopped: 'Stopped', declined: 'Declined', invalid: 'Invalid' };
const cents = (n: number, cur = 'USD') => `${cur === 'USD' ? '$' : ''}${(n / 100).toFixed(2)}${cur === 'USD' ? '' : ` ${cur}`}`;
const notice = (done: string, error: string): HtmlEscapedString | Promise<HtmlEscapedString> | '' => error ? html`<p class="noticed" role="alert"><strong>That did not go through.</strong> ${error}</p>`
  : done === 'allowed' ? html`<p class="noticed"><strong>Allowed.</strong> Foundry is placing the offer and will begin writing on its next pass. Nothing more is needed from you.</p>`
    : done === 'declined' ? html`<p class="noticed">Declined. Nothing was made.</p>`
      : done === 'stopped' ? html`<p class="noticed"><strong>Stopped.</strong> Permission is withdrawn; nothing more will be sent.</p>`
        : done === 'sending' ? html`<p class="noticed">Sending address connected.</p>`
          : done === 'reviewed' ? html`<p class="noticed">Recorded.</p>` : done === 'placed' ? html`<p class="noticed">The offer is placed.</p>` : '';

// ─── The list ────────────────────────────────────────────────────────────────
experimentRoutes.get('/foundry/experiments', async (c: any) => {
  const founderId = await founderOf(c);
  if (!founderId) return c.redirect('/onboarding');
  const views = await listExperiments(founderId);
  const body = html`
    <h1>Experiments</h1>
    <p class="lede">${views.length === 0 ? 'No real test is set up yet. When one is, it appears here with what it needs from you.'
    : `${count(views.length, 'real test')}. Each is one question put to the world, with the prediction sealed before it runs.`}</p>
    ${views.map((v) => html`<a class="item" href="/foundry/experiments/${v.id}">
      <p><strong>${v.assetName ?? v.title}</strong> <span class="pill">${stateWord[v.state]}</span></p>
      <p class="quiet">${v.stateDetail}</p>
    </a>`)}`;
  return c.html(page('Experiments', body, 'foundry', where(null, 'list')));
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
  const step = (s: ExperimentView['steps'][number]) => html`<li class="${s.status}">
    <p><strong>${s.status === 'done' ? '✓ ' : s.status === 'todo' ? '○ ' : '· '}${s.label}</strong>${s.status === 'todo' && s.key === 'recipients' ? html` — <a href="${s.href}">open</a>` : ''}</p>
    <p class="quiet">${s.detail}</p></li>`;
  const body = html`
    <h1>${v.assetName ?? 'The test'} <span class="pill">${v.stateLabel}</span></h1>
    ${notice(done, error)}
    <p class="lede">${v.stateDetail}</p>
    ${v.exceptions.length ? html`<section class="know" id="exceptions"><h2>Needs your attention</h2>
      <ul>${v.exceptions.map((x) => html`<li>${x}</li>`)}</ul></section>` : ''}

    ${short ? html`<section class="know said" id="short"><h2>${short.headline}</h2>
      <ul class="plain">${short.lines.map((l) => html`<li>${l}</li>`)}</ul>
      <p class="quiet">${short.sealed ? 'This was written before you decided and sealed when you did, so it cannot be edited to match the result.' : 'Written before this runs. It seals when you decide.'} <a class="why" href="/foundry/experiments/${id}/decide">Before you decide</a> · <a class="why" href="/foundry/why/experiment/${id}">Show your work</a></p>
    </section>` : ''}

    <section class="know" id="what"><h2>What this tests</h2>
      <p><strong>Question</strong> — ${v.why.question || v.title}</p>
      <p><strong>What Foundry does</strong> — ${v.why.whatWeDo}</p>
      <p><strong>Prediction, sealed</strong> — ${v.why.whatWeExpect}</p>
      <p><strong>Would disprove it</strong> — ${v.why.wouldDisprove}</p>
      <p class="row"><a class="why" href="/foundry/why/experiment/${id}">Show your work</a></p>
    </section>

    <section class="know" id="steps"><h2>Before it runs</h2>
      <ol class="steps">${v.steps.map(step)}</ol>
    </section>

    ${v.readiness.sending.status !== 'ready' && v.state !== 'declined' ? html`<section class="know" id="sending"><h2>Email sending</h2>
      <p>${v.readiness.sending.detail}</p>
      ${v.readiness.sending.status === 'not_connected' ? html`<form method="POST" action="/foundry/experiments/${id}/sending" class="stack">
        <label>From address, on your own domain <input type="email" name="from_email" required placeholder="you@yourcompany.com" /></label>
        <label>Your name as it should appear <input type="text" name="from_name" placeholder="Your name" /></label>
        <label>Resend API key for that domain <input type="password" name="credential" required autocomplete="off" /></label>
        <p class="quiet">The key is stored encrypted and used only to send. Foundry checks with the provider that the domain is verified before accepting it.</p>
        <button class="btn yes" type="submit">Connect</button></form>` : ''}
    </section>` : html`<section class="know" id="sending"><h2>Email sending</h2><p>${v.readiness.sending.detail}</p></section>`}

    <section class="know" id="allow"><h2>${v.state === 'ready' ? 'Allow this test' : v.state === 'needs_you' ? 'Allowing it' : 'What you allowed'}</h2>
      <ul>${v.allow.explanation.map((l) => html`<li>${l}</li>`)}</ul>
      ${v.state === 'ready' ? html`<div class="pair">
        <form method="POST" action="/foundry/experiments/${id}/allow"><button class="btn yes" type="submit">Allow — up to ${cents(v.money.allowanceCents)}</button></form>
        <form method="POST" action="/foundry/experiments/${id}/decline"><button class="btn" type="submit">Do not run it</button></form></div>`
    : v.state === 'needs_you' ? html`<p class="noticed"><strong>Not yet.</strong> ${v.allow.reason} Allowing is refused until then, by the rows themselves, not only by this page.</p>
        <form method="POST" action="/foundry/experiments/${id}/allow"><button class="btn" type="submit" aria-disabled="true">Allow</button></form>` : ''}
    </section>

    <section class="know" id="offer"><h2>The offer</h2>
      <p><strong>${v.offer.price}</strong>${v.offer.limits ? html` · <span class="quiet">${v.offer.limits}</span>` : ''}</p>
      ${v.offer.paymentLinkUrl ? html`<p>Payment link: <a href="${v.offer.paymentLinkUrl}" rel="noopener">${v.offer.paymentLinkUrl}</a></p>` : html`<p class="quiet">${v.state === 'running' ? 'Foundry has not placed the link yet; it tries on every pass.' : 'The link is created by Foundry after you allow the test.'}</p>`}
      ${v.offer.deliverable ? html`<p>What a buyer receives: <strong>${v.offer.deliverable.title}</strong>${v.offer.deliverable.pulledAt ? ` (data pulled ${v.offer.deliverable.pulledAt})` : ''}${v.offer.deliverable.quality.ok ? '' : html` — <span class="quiet">would not pass the quality check: ${v.offer.deliverable.quality.failures.join('; ')}</span>`}</p>` : html`<p class="quiet">Nothing to deliver is attached yet.</p>`}
      ${v.state === 'running' && !v.offer.paymentLinkUrl ? html`<div class="pair">
        <form method="POST" action="/foundry/experiments/${id}/place"><button class="btn" type="submit">Try placing it now</button></form>
        <form method="POST" action="/foundry/experiments/${id}/payment" class="stack"><label>Or a Stripe link you made, tagged for this test <input type="url" name="url" required placeholder="https://buy.stripe.com/..." /></label><button class="btn" type="submit">Use this link</button></form></div>` : ''}
    </section>

    ${v.publicPage ? html`<section class="know" id="public"><h2>Public page</h2>
      <p><a href="${v.publicPage.url}" rel="noopener">${v.publicPage.url}</a> <span class="pill">${v.publicPage.status}</span></p>
      <p class="quiet">${v.publicPage.detail}</p>
      <p class="quiet"><a href="/foundry/public-workshop/preview/${id}">Preview as it would be published</a> · <a href="/foundry/public-workshop">The Workshop</a></p>
      ${v.publicPage.gate.length ? html`<p><strong>Before anyone is written to:</strong></p><ul>${v.publicPage.gate.map((g) => html`<li>${g}</li>`)}</ul>` : ''}
    </section>` : ''}

    <section class="know" id="reach"><h2>Reach</h2>
      <dl class="facts">
        <dt>Approved to contact</dt><dd>${String(v.exposure.approved)}</dd>
        <dt>Excluded</dt><dd>${String(v.exposure.excluded)}</dd>
        <dt>Still to review</dt><dd>${String(v.exposure.pending)}${v.exposure.pendingWebForm ? ` (+${v.exposure.pendingWebForm} web-form only)` : ''}</dd>
        <dt>Offers sent</dt><dd>${String(v.exposure.sent)}</dd>
        <dt>Confirmed received</dt><dd>${String(v.exposure.delivered)}${v.exposure.killAt ? ` of ${v.exposure.killAt} before it stops itself` : ''}</dd>
        <dt>Bounced</dt><dd>${String(v.exposure.bounced)}</dd>
      </dl>
      <p class="quiet"><a href="/foundry/experiments/${id}/recipients">Who may be contacted</a></p>
    </section>

    <section class="know" id="money"><h2>Money</h2>
      <dl class="facts">
        <dt>Allowance</dt><dd>${cents(v.money.allowanceCents)}</dd>
        <dt>Spent by Foundry</dt><dd>${cents(v.money.spentCents)}</dd>
        <dt>Paid by customers</dt><dd>${cents(v.money.paidCents, v.money.currency)} (${count(v.money.payments, 'payment')})</dd>
        <dt>Refunded</dt><dd>${cents(v.money.refundedCents, v.money.currency)} (${count(v.money.refunds, 'refund')})</dd>
      </dl>
      ${v.controls.allowance ? html`<p class="quiet">${v.controls.allowance.statement}</p>` : ''}
    </section>

    <section class="know" id="rules"><h2>Rules it runs under</h2>
      <p>${v.rules.success}</p>
      <p>It stops when: ${v.rules.stop.join('; ')}.</p>
      ${v.rules.windowClosesAt ? html`<p class="quiet">Window closes ${v.rules.windowClosesAt}${v.rules.daysLeft != null ? ` (${count(v.rules.daysLeft, 'day')} left)` : ''}.</p>` : ''}
    </section>

    <section class="know" id="learned"><h2>${v.learned.headline}</h2>
      <p>${v.learned.detail}</p>
      <p class="quiet">${v.learned.evidence}</p>
      ${v.judgment ? html`<p><strong>Judgment</strong> — ${v.judgment}</p>` : ''}
    </section>

    ${v.controls.canStop ? html`<section class="know" id="stop"><h2>Stop</h2>
      <p>Stopping withdraws permission and the offer at once. Nothing more is sent; what the world already did stays on record. It cannot be restarted.</p>
      <form method="POST" action="/foundry/experiments/${id}/stop" class="stack">
        <label>Why <input type="text" name="reason" required placeholder="one line, for the record" /></label>
        <button class="btn" type="submit">Stop this test</button></form>
    </section>` : ''}

    <section class="know" id="timeline"><h2>What happened</h2>
      ${v.timeline.length ? html`<ul class="timeline">${v.timeline.map((t) => html`<li><span class="quiet">${t.at.slice(0, 16).replace('T', ' ')} · ${t.kind}</span><br />${t.text}</li>`)}</ul>` : html`<p class="quiet">Nothing yet.</p>`}
    </section>

    <details id="details"><summary>Details</summary>
      <dl class="facts">${v.details.map(([k, val]) => html`<dt>${k}</dt><dd>${val}</dd>`)}</dl>
    </details>
    <style>
      .steps{padding-left:1rem}.steps li{margin:.5rem 0}.steps li.done>p:first-child{opacity:.75}
      .facts{display:grid;grid-template-columns:minmax(8rem,auto) 1fr;gap:.25rem .75rem;margin:0}.facts dd{margin:0}
      .stack{display:grid;gap:.5rem;max-width:26rem}.stack label{display:grid;gap:.25rem}.stack input{max-width:100%;box-sizing:border-box}
      .timeline{padding-left:1rem}.timeline li{margin:.5rem 0;overflow-wrap:anywhere}
      .plain{list-style:none;padding:0;margin:0}.plain li{margin:.4rem 0}
    </style>`;
  return c.html(page(`${v.assetName ?? 'Experiment'} — ${v.stateLabel}`, body, 'foundry', where(v, 'test')));
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

    <section class="know"><h2>What it costs Apex Micro, and what people can ask of it</h2>
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
    <style>
      .facts{display:grid;grid-template-columns:minmax(8rem,auto) 1fr;gap:.25rem .75rem;margin:0}.facts dd{margin:0}
      .plain{list-style:none;padding:0;margin:0}.plain li{margin:.4rem 0}
    </style>`;
  return c.html(page('Before you decide', body, 'foundry', where(v, 'decide')));
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
  const row = (r: ExperimentView['recipients'][number]) => html`<div class="noticed qitem">
    <p><strong>${r.counterpartyRef}</strong> <span class="pill">${r.reviewStatus === 'pending' ? (r.channel === 'email' ? 'to review' : 'web form only') : r.reviewStatus === 'approved' ? 'approved' : 'excluded'}</span></p>
    <p class="quiet">${r.email ?? 'no published email'}${r.sourceUrl ? html` · <a href="${r.sourceUrl}" rel="noopener">source</a>` : ''}${r.reviewReason ? ` · ${r.reviewReason}` : ''}</p>
    ${r.qualifiedAt
      ? html`<p class="quiet">Why they are in this test's population: ${r.qualifiedBecause} · <a href="${r.qualifiedSource}" rel="noopener">the record that says so</a></p>`
      : html`<p class="quiet"><strong>No recorded reason this business is in the population this test names.</strong> Nothing will be written to them, whether or not you approve them here.</p>`}
    ${open && r.reviewStatus === 'pending' ? html`<div class="pair">
      <form method="POST" action="/foundry/experiments/${id}/recipients/${r.id}">
        <input type="hidden" name="decision" value="approved" />
        ${r.channel === 'web_form' ? html`<input type="email" name="email" placeholder="published email, if you have one" />` : ''}
        <button class="btn yes" type="submit">Fine</button></form>
      <form method="POST" action="/foundry/experiments/${id}/recipients/${r.id}">
        <input type="hidden" name="decision" value="struck" /><input type="text" name="reason" placeholder="why (optional)" />
        <button class="btn" type="submit">Exclude</button></form></div>` : ''}
  </div>`;
  const body = html`
    <h1>Who may be contacted</h1>
    ${notice(done, error)}
    <p class="lede">${v.recipients.length === 0 ? 'No candidate businesses are loaded.' : `${count(v.recipients.length, 'business', 'businesses')} from public listings. Exclude your employer and anything that could be a conflict. Nobody is written to until you allow the test, and nobody excluded is ever written to.`}</p>
    ${v.recipients.length ? html`<p class="quiet">${
    String(v.recipients.filter((r) => r.qualifiedAt).length)} of ${String(v.recipients.length)} carry a recorded, sourced reason for being in the population this design names. Your decision is whom to write to; the screening under it is Foundry's, and you can read it on every line.</p>` : ''}
    ${open && pending.some((r) => r.channel === 'email') ? html`<div class="pair"><form method="POST" action="/foundry/experiments/${id}/recipients/approve-remaining">
      <button class="btn yes" type="submit">The rest are fine (${String(pending.filter((r) => r.channel === 'email').length)})</button></form></div>` : ''}
    ${pending.map(row)}
    ${decided.length ? html`<h2 class="section">Reviewed</h2>${decided.map(row)}` : ''}
    <p class="row"><a class="btn go" href="/foundry/experiments/${id}">Back to the test</a></p>`;
  return c.html(page('Who may be contacted', body, 'foundry', where(v, 'recipients')));
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
  try {
    await allowExperiment({ founderId, experimentId: id });
  } catch (e) { return back(c, id, 'test', null, said(e)); }
  // Placing the offer is Foundry's act, not his. A provider hiccup here is an
  // exception on the page and a retry on the next pass, never a failed Allow.
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
