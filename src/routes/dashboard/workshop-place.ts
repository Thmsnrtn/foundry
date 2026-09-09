// =============================================================================
// FOUNDRY — The Workshop, as a place the owner stands in.
//
// One address under /foundry for the public membrane: is the site up, is the
// provider connected, does mail go out as the Workshop and come back to him,
// which experiments are public and in what state, who has said no, and what
// is owed to customers right now. Every line is read from rows or from the
// world through the services (services/public-workshop/*); every button is a
// step Foundry would take on its own pass, offered here so he never needs a
// terminal. Nothing here holds state of its own.
// =============================================================================
import { Hono } from 'hono';
import { html } from 'hono/html';
import type { HtmlEscapedString } from 'hono/utils/html';
import { page } from './foundry-shell.js';
import type { Where } from './foundry-shell.js';
import { requireInstitutionOwner } from '../../middleware/rbac.js';
import { establishPublicWorkshop, pauseNewEconomicActivity, publicWorkshopOf, resumeEconomicActivity, setAbout, setPostalAddress, WorkshopRefused } from '../../services/public-workshop/settings.js';
import { livePublications, previewExperimentPage, publishSite, verifySite } from '../../services/public-workshop/publication.js';
import { projectRegistry } from '../../services/public-workshop/projection.js';
import { cloudflareReceipts, connectReplyInbox, connectWorkshopSending, outstandingObligations, standUpWorkshop, workshopHealth } from '../../services/public-workshop/infrastructure.js';
import type { Signal, WorkshopHealth } from '../../services/public-workshop/infrastructure.js';
import { suppress, suppressionsOf } from '../../services/public-workshop/suppression.js';
import { cloudflareConfigured } from '../../services/integration/cloudflare-gateway.js';

export const workshopRoutes = new Hono();

async function founderOf(c: any): Promise<string | null> {
  const founder = c.get('founder') as { id?: string } | undefined;
  return founder?.id ? String(founder.id) : null;
}
const frame: Where = {
  eyebrow: 'Workshop',
  crumbs: [{ href: '/foundry', label: 'Foundry' }, { href: '/foundry/public-workshop', label: 'Workshop' }],
  scope: { kind: 'foundry', id: null, name: 'Workshop' }, local: [], chips: [],
};
const said = (e: unknown): string => e instanceof WorkshopRefused || e instanceof Error ? e.message.replaceAll('_', ' ') : String(e);
const back = (c: any, ok: string | null, err?: string) => c.redirect(`/foundry/public-workshop?${err ? `error=${encodeURIComponent(err)}` : `done=${ok ?? ''}`}`);
const light = (s: Signal): HtmlEscapedString | Promise<HtmlEscapedString> => html`<span class="pill">${s.status === 'healthy' ? 'Healthy' : s.status === 'needs_attention' ? 'Needs attention' : 'Unknown'}</span>`;

workshopRoutes.get('/foundry/public-workshop', async (c: any) => {
  const founderId = await founderOf(c);
  if (!founderId) return c.redirect('/onboarding');
  const done = String(c.req.query('done') ?? ''); const error = String(c.req.query('error') ?? '');
  const w = await publicWorkshopOf(founderId);
  const notice = error ? html`<p class="noticed" role="alert"><strong>That did not go through.</strong> ${error}</p>`
    : done === 'established' ? html`<p class="noticed">The Workshop exists. Stand it up next.</p>`
      : done === 'stood-up' ? html`<p class="noticed"><strong>Up.</strong> The store, the program, the hostnames and the pages are in place and were read back.</p>`
        : done === 'published' ? html`<p class="noticed">Published what changed and read it back.</p>`
          : done === 'checked' ? html`<p class="noticed">Read from the world just now.</p>`
            : done === 'paused' ? html`<p class="noticed"><strong>Paused.</strong> No new offers, placements or tests. What is owed still goes out.</p>`
              : done === 'resumed' ? html`<p class="noticed">Resumed.</p>` : done === 'saved' ? html`<p class="noticed">Saved.</p>`
                : done === 'sending' ? html`<p class="noticed">Sending: see the reading below.</p>` : done === 'inbox' ? html`<p class="noticed">Reply inbox: see the reading below.</p>`
                  : done === 'suppressed' ? html`<p class="noticed">Recorded. No test of the Workshop will write to that address.</p>` : '';

  if (!w) {
    const body = html`
      <h1>Workshop</h1>
      ${notice}
      <p class="lede">The public face every test enters the world through: one address, one sender, one set of pages a stranger can trust. It does not exist yet.</p>
      <div class="pair"><form method="POST" action="/foundry/public-workshop/establish"><button class="btn yes" type="submit">Establish Apex Micro</button></form></div>
      <p class="quiet">This writes the Workshop's rows from the founding statement you approved. It reaches the world only when you stand it up.</p>`;
    return c.html(page('Workshop', body, 'foundry', frame));
  }

  const health: WorkshopHealth | null = (w.health as unknown as WorkshopHealth | null);
  const registry = await projectRegistry(founderId);
  const pubs = await livePublications(founderId);
  const lists = await suppressionsOf(founderId, 50);
  const owed = await outstandingObligations(founderId);
  const receipts = await cloudflareReceipts(founderId, 25);
  const byStatus = (s: string) => registry.filter((x) => x.status === s);
  const experimentIds = new Map<string, string>();
  for (const r of ((await (await import('../../db/client.js')).query('SELECT experiment_id, slug FROM public_experiments WHERE founder_id = ?', [founderId])).rows as unknown as Array<Record<string, unknown>>)) experimentIds.set(String(r.slug), String(r.experiment_id));

  const body = html`
    <h1>${w.publicName} <span class="pill">${w.economicPause ? 'Paused' : 'Operating'}</span></h1>
    ${notice}
    <p class="lede"><a href="${w.origin}" rel="noopener">${w.zoneName}</a> — ${w.publicName} is an independent digital workshop operated by ${w.operatorName}. Every test that reaches a stranger does so as ${w.operatorName} — ${w.publicName}, from ${w.contactEmail}, with a page at ${w.zoneName}.</p>

    <section class="know" id="health"><h2>Health</h2>
      ${health ? html`<dl class="facts">
        <dt>Public site</dt><dd>${light(health.site)} ${health.site.detail}</dd>
        <dt>Cloudflare</dt><dd>${light(health.cloudflare)} ${health.cloudflare.detail}</dd>
        <dt>Email sending</dt><dd>${light(health.sending)} ${health.sending.detail}</dd>
        <dt>Reply inbox</dt><dd>${light(health.replyInbox)} ${health.replyInbox.detail}</dd>
      </dl>
      <p class="quiet">Read from the world ${String(w.healthAt ?? health.checkedAt).slice(0, 16).replace('T', ' ')}. ${health.pagesFailing.length ? html`Pages not served as published: ${health.pagesFailing.join('; ')}` : ''}</p>`
    : html`<p class="quiet">Not read from the world yet.</p>`}
      <div class="pair">
        <form method="POST" action="/foundry/public-workshop/check"><button class="btn" type="submit">Read it now</button></form>
        ${!cloudflareConfigured() ? html`<p class="quiet">Cloudflare is not configured on this deployment; nothing can be stood up or published until it is.</p>`
    : html`<form method="POST" action="/foundry/public-workshop/stand-up"><button class="btn yes" type="submit">${pubs.length ? 'Stand it up again' : 'Stand it up'}</button></form>
          <form method="POST" action="/foundry/public-workshop/publish"><button class="btn" type="submit">Publish what changed</button></form>`}
      </div>
      ${health && health.sending.status !== 'healthy' ? html`<form method="POST" action="/foundry/public-workshop/sending" class="stack"><p>Sending as the Workshop needs the mail provider to verify ${w.zoneName}; Foundry writes the records it asks for and checks back.</p><button class="btn" type="submit">Connect sending as ${w.publicName}</button></form>` : ''}
      ${health && health.replyInbox.status !== 'healthy' ? html`<form method="POST" action="/foundry/public-workshop/inbox" class="stack"><p>Replies to ${w.contactEmail} are forwarded to your own inbox. The first time, Cloudflare emails you one confirmation link to click.</p><button class="btn" type="submit">Connect the reply inbox</button></form>` : ''}
    </section>

    <section class="know" id="pause"><h2>${w.economicPause ? 'New economic activity is paused' : 'Pausing'}</h2>
      ${w.economicPause ? html`<p>Since ${w.economicPause.at.slice(0, 16).replace('T', ' ')}, ${w.economicPause.by === `founder:${founderId}` ? 'by you' : `by ${w.economicPause.by}`}: ${w.economicPause.reason}. No offers, no placements, no new tests. Deliveries, refunds, the pages and the contact path carry on.</p>
        <form method="POST" action="/foundry/public-workshop/resume"><button class="btn yes" type="submit">Resume</button></form>`
    : html`<p>Stops new offers, placements and tests without touching what is owed to anyone who already bought. The public site stays up; refunds still go out.</p>
        <form method="POST" action="/foundry/public-workshop/pause" class="stack"><label>Why <input type="text" name="reason" required placeholder="one line, for the record" /></label><button class="btn" type="submit">Pause new economic activity</button></form>`}
    </section>

    <section class="know" id="experiments"><h2>Public experiments</h2>
      ${registry.length === 0 ? html`<p class="quiet">None yet. A test gets its page when it is given a public identity; it is published when you allow it.</p>` : html`
      <p class="quiet">${registry.length} with a public identity · ${byStatus('testing').length} testing · ${byStatus('operating').length} operating · ${byStatus('graduated').length} graduated · ${byStatus('closed').length} closed · ${byStatus('preparing').length} preparing</p>
      ${registry.map((x) => { const pub = pubs.find((p) => p.path === x.path); const eid = experimentIds.get(x.slug); return html`<div class="noticed qitem">
        <p><strong>Experiment ${String(x.number).padStart(3, '0')} — ${x.title}</strong> <span class="pill">${x.statusLabel}</span>${x.listed ? '' : html` <span class="pill">unlisted</span>`}</p>
        <p class="quiet">${pub ? html`<a href="${w.origin}${x.path}" rel="noopener">${w.zoneName}${x.path}</a> · v${String(pub.version)} · ${pub.verifiedStatus === 'verified' ? `seen ${String(pub.verifiedAt).slice(0, 16).replace('T', ' ')}` : `not seen: ${pub.verifiedDetail ?? pub.verifiedStatus ?? 'unverified'}`}` : html`${w.zoneName}${x.path} · not published yet`}
          · <a href="/foundry/public-workshop/preview/${eid ?? ''}">preview</a>${eid ? html` · <a href="/foundry/experiments/${eid}">the test</a>` : ''}</p>
      </div>`; })}`}
    </section>

    <section class="know" id="obligations"><h2>Owed to customers</h2>
      ${owed.length === 0 ? html`<p class="quiet">Nothing outstanding.</p>` : html`<ul>${owed.map((o) => html`<li>Payment ${o.paymentRef} · ${o.status} since ${o.since.slice(0, 10)} · <a href="/foundry/experiments/${o.experimentId}">the test</a></li>`)}</ul>`}
      <p class="quiet">These survive a pause, a stop and a closed test.</p>
    </section>

    <section class="know" id="suppression"><h2>Do not contact</h2>
      <p class="quiet">Across every test of the Workshop. A no said during one test holds for all of them.</p>
      ${lists.length === 0 ? html`<p class="quiet">Nobody yet.</p>` : html`<ul>${lists.map((s) => html`<li>${s.email} · ${s.reason.replaceAll('_', ' ')} (${s.source.replaceAll('_', ' ')}) · ${s.recordedAt.slice(0, 10)}</li>`)}</ul>`}
      <form method="POST" action="/foundry/public-workshop/suppress" class="stack"><label>Add an address <input type="email" name="email" required placeholder="someone@example.com" /></label><button class="btn" type="submit">Never contact them</button></form>
    </section>

    <section class="know" id="receipts"><h2>What I changed at the provider</h2>
      <p class="quiet">Every change to ${w.zoneName}'s infrastructure, with what was there before, what came back, what the world then showed, and what would put it back. Nothing here is a summary: it is the record.</p>
      ${receipts.length === 0 ? html`<p class="quiet">Nothing yet.</p>` : html`<details class="fold"><summary>${String(receipts.length)} most recent</summary>
        ${receipts.map((x) => html`<div class="noticed qitem">
          <p><strong>${x.resource}</strong> <span class="pill">${x.outcome}</span> <span class="quiet">${x.at.slice(0, 16).replace('T', ' ')} · ${x.tool}</span></p>
          <p class="quiet">Why: ${x.purpose}</p>
          <p class="quiet">Asked: ${x.requested}</p>
          ${x.previous ? html`<p class="quiet">Was: ${x.previous}</p>` : ''}
          ${x.response ? html`<p class="quiet">Provider said: ${x.response}</p>` : ''}
          ${x.verified ? html`<p class="quiet">Then seen: ${x.verified}</p>` : ''}
          ${x.rollback ? html`<p class="quiet">To reverse: ${x.rollback}</p>` : ''}
          <p class="quiet">Under: ${x.authority}</p>
        </div>`)}
      </details>`}
    </section>

    <section class="know" id="identity"><h2>Identity</h2>
      <dl class="facts">
        <dt>Public name</dt><dd>${w.publicName}</dd>
        <dt>Operator</dt><dd>${w.operatorName}</dd>
        <dt>Sends as</dt><dd>${w.operatorName} — ${w.publicName} &lt;${w.contactEmail}&gt;</dd>
        <dt>Postal address</dt><dd>${w.postalAddress ?? html`<span class="quiet">none recorded — commercial email must carry one, so no offer goes out until it does</span>`}</dd>
        <dt>Contact spacing</dt><dd>${String(w.contactGapDays)} days between tests to one address; at most ${String(w.contactCeilingPerYear)} a year</dd>
      </dl>
      <form method="POST" action="/foundry/public-workshop/postal" class="stack"><label>Postal address for commercial mail (a business or PO box address, not your home) <input type="text" name="address" value="${w.postalAddress ?? ''}" placeholder="PO Box …, Town, MA 0xxxx" /></label><button class="btn" type="submit">Save</button></form>
      <form method="POST" action="/foundry/public-workshop/about" class="stack"><label>About you, for the public About page (only what you want published) <textarea name="about" rows="4">${w.about}</textarea></label><button class="btn" type="submit">Save</button></form>
    </section>
    <style>
      .facts{display:grid;grid-template-columns:minmax(8rem,auto) 1fr;gap:.25rem .75rem;margin:0}.facts dd{margin:0}
      .stack{display:grid;gap:.5rem;max-width:30rem;margin-top:.5rem}.stack label{display:grid;gap:.25rem}.stack input,.stack textarea{max-width:100%;box-sizing:border-box;font:inherit}
      .qitem p{overflow-wrap:anywhere}
    </style>`;
  return c.html(page('Workshop', body, 'foundry', frame));
});

/** The page as it would be published, rendered now from the rows. */
workshopRoutes.get('/foundry/public-workshop/preview/:experimentId', async (c: any) => {
  const founderId = await founderOf(c);
  if (!founderId) return c.redirect('/onboarding');
  const experimentId = String(c.req.param('experimentId'));
  const own = (await (await import('../../db/client.js')).query('SELECT id FROM venture_experiments WHERE id = ? AND founder_id = ?', [experimentId, founderId])).rows[0];
  if (!own) return c.notFound();
  const preview = await previewExperimentPage(experimentId);
  if (!preview) return c.notFound();
  return c.html(preview.html);
});

const act = (path: string, fn: (founderId: string, form: Record<string, unknown>) => Promise<string>) => {
  workshopRoutes.post(path, requireInstitutionOwner(), async (c: any) => {
    const founderId = await founderOf(c); if (!founderId) return c.redirect('/onboarding');
    const form = (await c.req.parseBody().catch(() => ({}))) as Record<string, unknown>;
    try { return back(c, await fn(founderId, form)); } catch (e) { return back(c, null, said(e)); }
  });
};
act('/foundry/public-workshop/establish', async (founderId) => { await establishPublicWorkshop({ founderId }); return 'established'; });
act('/foundry/public-workshop/stand-up', async (founderId) => { const r = await standUpWorkshop(founderId); if (r.site.failed.length || r.site.unverified.length) throw new WorkshopRefused('not_all_seen', [...r.site.failed, ...r.site.unverified].join('; ')); return 'stood-up'; });
act('/foundry/public-workshop/publish', async (founderId) => { const r = await publishSite(founderId, `founder:${founderId}`); if (r.failed.length) throw new WorkshopRefused('publication_failed', r.failed.map((f) => `${f.path}: ${f.reason}`).join('; ')); return 'published'; });
act('/foundry/public-workshop/check', async (founderId) => { await verifySite(founderId); await workshopHealth(founderId); return 'checked'; });
act('/foundry/public-workshop/sending', async (founderId) => { const r = await connectWorkshopSending(founderId); await workshopHealth(founderId); if (!r.verified) throw new WorkshopRefused('domain_pending', `the provider reports ${r.domain} as ${r.status}; records written: ${r.records.join(', ')}. Try again in a few minutes.`); return 'sending'; });
act('/foundry/public-workshop/inbox', async (founderId) => { const r = await connectReplyInbox(founderId); await workshopHealth(founderId); if (!r.destinationVerified) throw new WorkshopRefused('confirm_at_cloudflare', `forwarding to ${r.forwardTo} is set; Cloudflare has emailed you a confirmation link to click`); return 'inbox'; });
act('/foundry/public-workshop/pause', async (founderId, form) => { await pauseNewEconomicActivity({ founderId, reason: String(form.reason ?? '') }); return 'paused'; });
act('/foundry/public-workshop/resume', async (founderId) => { await resumeEconomicActivity(founderId); return 'resumed'; });
act('/foundry/public-workshop/postal', async (founderId, form) => { await setPostalAddress(founderId, String(form.address ?? '')); return 'saved'; });
act('/foundry/public-workshop/about', async (founderId, form) => { await setAbout(founderId, String(form.about ?? '')); return 'saved'; });
act('/foundry/public-workshop/suppress', async (founderId, form) => { const r = await suppress({ founderId, email: String(form.email ?? ''), reason: 'founder', source: 'owner' }); if (!r.recorded) throw new WorkshopRefused('not_recorded', 'that is not an email address, or it is already on the list'); return 'suppressed'; });
