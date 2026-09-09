// =============================================================================
// FOUNDRY — WHAT PEOPLE SAID TO APEX MICRO.
//
// Not an email client. The owner has one of those, and this deliberately does
// not compete with it: mail still arrives in his mailbox exactly as before, and
// this is what the INSTITUTION made of it — who wrote, what it took the message
// to mean, on what grounds, what it did about it, and whether he is actually
// needed. The reading and its grounds sit next to the words, so a wrong reading
// is visible as a wrong reading rather than as a silent mishandling.
// =============================================================================
import { Hono } from 'hono';
import { html } from 'hono/html';
import { page } from './foundry-shell.js';
import type { Where } from './foundry-shell.js';
import { requireInstitutionOwner } from '../../middleware/rbac.js';

export const inboxRoutes = new Hono();

async function founderOf(c: any): Promise<string | null> {
  const founder = c.get('founder') as { id?: string } | undefined;
  return founder?.id ? String(founder.id) : null;
}

const where = (on: 'inbox' | 'thread'): Where => ({
  crumbs: [{ href: '/foundry', label: 'Foundry' }, { href: '/foundry/inbox', label: 'Inbox' }],
  scope: { kind: 'foundry', id: null, name: 'Inbox' },
  local: [{ href: '/foundry/inbox', label: 'What people said', count: null, on: on === 'inbox' }],
  chips: [],
});

const when = (s: string): string => s.slice(0, 16).replace('T', ' ');
const WORD: Record<string, string> = {
  foundry_reading: 'Foundry is reading it', waiting_on_them: 'waiting on them',
  needs_owner: 'needs you', resolved: 'handled', no_action: 'nothing to do',
};

inboxRoutes.get('/foundry/inbox', async (c: any) => {
  const founderId = await founderOf(c);
  if (!founderId) return c.redirect('/onboarding');
  const { theInbox, mailHealth } = await import('../../services/public-workshop/mail.js');
  const mail = await theInbox(founderId, 100);
  const health = await mailHealth(founderId);
  const done = String(c.req.query('done') ?? '');

  const body = html`
    <h1>Inbox</h1>
    ${done ? html`<p class="noticed">Recorded.</p>` : ''}
    <p class="lede">What people wrote to Apex Micro, and what Foundry made of it. Every message is also in your own mailbox, untouched — this is the institution's reading of it, not a copy of your email.</p>
    ${mail.length === 0 ? html`<section class="know"><h2>Nobody has written yet</h2>
      <p class="quiet">Nothing has been sent, so nothing has come back. When mail arrives at the Workshop's address it will appear here, and it will still arrive in your mailbox exactly as it does now.</p></section>`
    : html`
    <section class="know"><h2>${String(health.waiting)} waiting on you</h2>
      <p class="quiet">${health.heard} heard in total · ${health.unread} Foundry could not confidently read${health.oldestWaitingHours != null ? ` · the oldest thing waiting has waited ${String(health.oldestWaitingHours)}h` : ''}.</p>
    </section>
    <section class="know"><h2>Messages</h2>
      ${mail.map((m) => html`<div class="item">
        <p><strong>${m.fromName ?? m.from}</strong> <span class="quiet">${m.fromName ? m.from : ''}</span> <span class="pill">${WORD[m.handling] ?? m.handling}</span></p>
        <p>${m.subject ?? '(no subject)'} <span class="quiet">· ${when(m.receivedAt)}</span></p>
        <p class="quiet"><strong>Read as:</strong> ${m.reading.replaceAll('_', ' ')}${m.readingBecause ? ` — ${m.readingBecause}` : ''}</p>
        ${m.handledBecause ? html`<p class="quiet"><strong>Foundry did:</strong> ${m.handledBecause}</p>` : ''}
        <p class="quiet"><a href="/foundry/inbox/${m.threadKeyHref}">Read the whole thread</a></p>
      </div>`)}
    </section>`}`;
  return c.html(page('Inbox', body, 'foundry', where('inbox')));
});

inboxRoutes.get('/foundry/inbox/:thread', async (c: any) => {
  const founderId = await founderOf(c);
  if (!founderId) return c.redirect('/onboarding');
  const { theThread } = await import('../../services/public-workshop/mail.js');
  const key = decodeURIComponent(String(c.req.param('thread')));
  const msgs = await theThread(founderId, key);
  if (msgs.length === 0) return c.notFound();

  const body = html`
    <h1>${msgs[0]!.subject ?? '(no subject)'}</h1>
    <p class="lede">${msgs[0]!.fromName ?? msgs[0]!.from} — ${msgs.length} message${msgs.length === 1 ? '' : 's'}.</p>
    ${msgs.map((m) => html`<section class="know">
      <h2>${m.fromName ?? m.from} <span class="quiet">${when(m.receivedAt)}</span></h2>
      <p class="quiet">to ${m.to}${m.sentAt ? ` · they sent it ${when(m.sentAt)}` : ''}</p>
      <pre class="said">${m.body}</pre>
      <dl class="facts">
        <dt>Read as</dt><dd>${m.reading.replaceAll('_', ' ')}${m.readingBecause ? ` — ${m.readingBecause}` : ''}</dd>
        <dt>Foundry did</dt><dd>${m.handledBecause ?? 'nothing yet'}</dd>
        <dt>Status</dt><dd>${WORD[m.handling] ?? m.handling}</dd>
        ${m.experimentId ? html`<dt>About</dt><dd><a href="/foundry/experiments/${m.experimentId}">the experiment they were written to about</a></dd>` : html`<dt>About</dt><dd class="quiet">nobody the Workshop has written to</dd>`}
        <dt>How it authenticated</dt><dd class="quiet">SPF ${m.spf ?? '—'} · DKIM ${m.dkim ?? '—'} · ${m.dmarc ?? 'no DMARC result'}</dd>
        <dt>Why it is in this thread</dt><dd class="quiet">${m.threadedBecause}${m.bytesAtTheEdge != null ? ` · ${String(m.bytesAtTheEdge)} bytes at the edge` : ''}</dd>
      </dl>
      <p class="quiet">Nothing in this message can make Foundry act. It is what somebody said, kept as evidence; anything done about it was decided here, under your authority.</p>
      ${m.handling === 'needs_owner' ? html`<form method="POST" action="/foundry/inbox/${m.id}/settle" class="stack">
        <label>How you handled it <input type="text" name="because" required placeholder="one line, for the record" /></label>
        <button class="btn" type="submit">Mark handled</button></form>` : ''}
    </section>`)}
    <style>
      .said{white-space:pre-wrap;word-wrap:break-word;background:var(--card,#f6f6f6);padding:.75rem;border-radius:8px;font:inherit;max-width:100%;overflow-x:auto}
      .facts{display:grid;grid-template-columns:minmax(8rem,auto) 1fr;gap:.25rem .75rem;margin:0}.facts dd{margin:0}
      .stack{display:grid;gap:.5rem;max-width:26rem}.stack label{display:grid;gap:.25rem}
    </style>`;
  return c.html(page('Thread', body, 'foundry', where('thread')));
});

inboxRoutes.post('/foundry/inbox/:id/settle', requireInstitutionOwner(), async (c: any) => {
  const founderId = await founderOf(c);
  if (!founderId) return c.redirect('/onboarding');
  const form = await c.req.parseBody();
  const because = String(form.because ?? '').trim();
  if (!because) return c.redirect('/foundry/inbox?error=reason%20required');
  const { settleMail } = await import('../../services/public-workshop/mail.js');
  await settleMail({ founderId, id: String(c.req.param('id')), handling: 'resolved', because });
  return c.redirect('/foundry/inbox?done=settled');
});
