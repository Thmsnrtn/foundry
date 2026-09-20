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
import { html, raw } from 'hono/html';
import { page } from './foundry-shell.js';
import { ago, mark } from '../../views/owner/shell.js';
import type { Where } from './foundry-shell.js';
import type { MailRecord, MailView } from '../../services/public-workshop/mail.js';
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
const MODE_WORD: Record<string, string> = {
  off: 'answering nothing', draft: 'writing answers, sending none', autonomous: 'answering ordinary messages itself',
};

inboxRoutes.get('/foundry/inbox', async (c: any) => {
  const founderId = await founderOf(c);
  if (!founderId) return c.redirect('/onboarding');
  const { mailHealth, theThreads, threadCounts } = await import('../../services/public-workshop/mail.js');
  const health = await mailHealth(founderId);
  const { correspondenceHealth } = await import('../../services/public-workshop/correspondence.js');
  const speaking = await correspondenceHealth(founderId);
  const { publicWorkshopOf } = await import('../../services/public-workshop/settings.js');
  const voice = (await publicWorkshopOf(founderId))?.publicName ?? 'the Workshop';
  const done = String(c.req.query('done') ?? '');

  // A COMMUNICATIONS MEMBRANE, NOT A MAIL CLIENT. What rises is what needs
  // him; what Foundry handled within its authority sits behind a filter, with
  // its reading and its grounds beside the words so a wrong reading is visible
  // as a wrong reading. The mode is a state shown as one, changed with a reason.
  //
  // AND IT IS CONVERSATIONS, NOT MESSAGES. The list showed messages while the
  // row opened a thread and the button settled a message: three objects in one
  // row. A conversation is the object; its newest message is what the row
  // shows; Done and Archive act on the whole of it.
  const asked = String(c.req.query('show') ?? '');
  const show: MailView = asked === 'needs' || asked === 'handled' || asked === 'archived' ? asked : 'working';
  const counts = await threadCounts(founderId);
  const threads = await theThreads(founderId, show);
  const anyMail = counts.working + counts.handled + counts.archived > 0;
  const initials = (m: MailRecord): string => (m.fromName ?? m.from).split(/[\s@.]+/).filter(Boolean).slice(0, 2).map((w) => w[0]!.toUpperCase()).join('');
  const readingCls = (r: string): string => /complaint|stop_writing|wants_money_back|not_for_us|needs_a_person/.test(r) ? 'warn' : /wants_more|was_useful|answering_offer|asking/.test(r) ? 'ok' : '';
  const MODES: Array<['off' | 'draft' | 'autonomous', string, string]> = [
    ['off', 'Off', 'everything waits for you'],
    ['draft', 'Draft', 'writes answers, sends none'],
    ['autonomous', 'Autonomous', 'answers ordinary messages itself'],
  ];
  const body = html`
    <h1>Inbox</h1>
    ${done === 'cleared' ? html`<p class="noticed"><strong>Put away.</strong> ${String(c.req.query('n') ?? '0')} ${String(c.req.query('n') ?? '0') === '1' ? 'conversation' : 'conversations'} you had dealt with. Each keeps its record and can be put back from <a href="/foundry/inbox?show=archived">Put away</a>.</p>` : done ? html`<p class="noticed">Recorded.</p>` : ''}
    <p class="lede">What people wrote to ${voice}, and what Foundry made of it. Your own mailbox is untouched; this is the institution's reading, not a copy of your email.</p>

    <section class="panel mode-panel" aria-label="Correspondence mode">
      <header><h2>${mark('mail')}Correspondence mode</h2><span class="dim">${speaking.answered} answered · ${speaking.sent} sent · ${speaking.escalated} left for you${speaking.failed ? ` · ${speaking.failed} failed to send` : ''}</span></header>
      <div class="segments" role="group" aria-label="How much the Workshop answers for itself">
        ${MODES.map(([m, label, gloss]) => html`<span class="seg${speaking.mode === m ? ' on' : ''}"${speaking.mode === m ? raw(' aria-current="true"') : ''}><b>${label}</b><small>${gloss}</small></span>`)}
      </div>
      <details class="fold change-mode"><summary><h3>Change it</h3><span class="gist">now: ${MODE_WORD[speaking.mode]}</span></summary>
        <form method="POST" action="/foundry/inbox/mode" class="stack">
          <label>Mode
            <select name="mode">
              <option value="off" ${speaking.mode === 'off' ? 'selected' : ''}>Answer nothing — everything waits for me</option>
              <option value="draft" ${speaking.mode === 'draft' ? 'selected' : ''}>Write answers but send nothing</option>
              <option value="autonomous" ${speaking.mode === 'autonomous' ? 'selected' : ''}>Answer ordinary messages without asking me</option>
            </select></label>
          <label>Why <input type="text" name="because" required placeholder="one line, for the record" /></label>
          <button class="btn" type="submit">Set it</button>
        </form>
        <p class="quiet">Whatever this says, a message can never grant Foundry authority it does not already have. Legal and security messages, anything claiming your approval, new commitments and anything it could not read confidently always come to you.</p>
      </details>
    </section>

    ${!anyMail ? html`<section class="know"><h2>Nobody has written yet</h2>
      <p class="quiet">Nothing has been sent, so nothing has come back. When mail arrives at the Workshop's address it will appear here, and it will still arrive in your mailbox exactly as it does now.</p></section>`
    : html`
    <p class="decisions-head" aria-label="Show">
      <a class="chip${show === 'working' ? ' on' : ''}${counts.needs ? ' hot' : ''}" href="/foundry/inbox">In flight <b>${String(counts.working)}</b></a>
      <a class="chip${show === 'needs' ? ' on' : ''}${counts.needs ? ' hot' : ''}" href="/foundry/inbox?show=needs">Needs you <b>${String(counts.needs)}</b></a>
      <a class="chip${show === 'handled' ? ' on' : ''}" href="/foundry/inbox?show=handled">Handled <b>${String(counts.handled)}</b></a>
      <a class="chip${show === 'archived' ? ' on' : ''}" href="/foundry/inbox?show=archived">Put away <b>${String(counts.archived)}</b></a></p>
    ${show === 'handled' && counts.handled > 0 ? html`<form method="POST" action="/foundry/inbox/clear-handled" class="inline">
      <input type="hidden" name="because" value="you cleared what you had dealt with" />
      <button class="btn" type="submit">Put away all ${String(counts.handled)}</button>
      <span class="quiet">Reversible; every reading and reply stays on the record.</span></form>` : ''}
    <p class="quiet">${health.heard} heard in total · ${health.unread} Foundry could not confidently read${health.oldestWaitingHours != null ? ` · the oldest thing waiting has waited ${String(health.oldestWaitingHours)}h` : ''}.</p>
    <ul class="mailrows" aria-label="Conversations">
      ${threads.map((t) => html`<li class="mailrow${t.needsOwner ? ' needs' : ''}">
        <a class="open" href="/foundry/inbox/${t.href}" aria-label="Read the whole thread"></a>
        <span class="avatar" aria-hidden="true">${initials(t.newest) || '?'}</span>
        <span class="who"><b>${t.newest.fromName ?? t.newest.from}</b>${t.newest.fromName ? html` <span class="dim">${t.newest.from}</span>` : ''}${t.messages > 1 ? html` <span class="pill">${String(t.messages)}</span>` : ''}</span>
        <span class="when"><time>${ago(t.newest.receivedAt)}</time></span>
        <span class="subj">${t.newest.subject ?? '(no subject)'}</span>
        <span class="snip">${t.newest.body.replace(/\s+/g, ' ').trim().slice(0, 110)}${t.newest.body.length > 110 ? '…' : ''}</span>
        <span class="tags"><span class="pill ${readingCls(t.newest.reading)}">${t.newest.reading.replaceAll('_', ' ')}</span><span class="pill${t.needsOwner ? ' warn' : t.newest.handling === 'resolved' ? ' ok' : ''}">${WORD[t.newest.handling] ?? t.newest.handling}</span></span>
        <span class="read"><strong>Read as:</strong> ${t.newest.reading.replaceAll('_', ' ')}${t.newest.readingBecause ? ` — ${t.newest.readingBecause}` : ''}${t.newest.handledBecause ? html` <span class="dim">· Foundry did: ${t.newest.handledBecause}</span>` : ''}</span>
        ${/* CLEARING HIS VIEW IS NOT DELETING THE RECORD. Archiving asserts
              nothing about the message and is reversible; every reading, ground
              and reply stays exactly where it was and is still readable here. */ ''}
        ${t.newest.archivedBecause ? html`<span class="read"><strong>Put away:</strong> ${t.newest.archivedBecause}${t.newest.archivedAt ? html` <span class="dim">${ago(t.newest.archivedAt)}</span>` : ''}</span>` : ''}
        ${t.putAwayAt ? html`<span class="read"><strong>Reopened:</strong> you put this away ${ago(t.putAwayAt)}${t.putAwayBecause ? ` (${t.putAwayBecause})` : ''}; a newer message brought it back.</span>` : ''}
        <span class="acts">${t.archived
    ? html`<form method="POST" action="/foundry/inbox/thread/${t.href}/unarchive">
          <button class="btn" type="submit">Put back</button></form>`
    : html`${t.needsOwner ? html`<form method="POST" action="/foundry/inbox/thread/${t.href}/done">
          <input type="hidden" name="because" value="the owner dealt with it" />
          <button class="btn" type="submit">Done</button></form>` : ''}
        <form method="POST" action="/foundry/inbox/thread/${t.href}/archive">
          <input type="hidden" name="because" value="the owner put it away" />
          <button class="btn" type="submit">Archive</button></form>`}</span>
      </li>`)}
      ${threads.length === 0 ? html`<li class="quiet">${show === 'working' ? 'Nothing is in flight. Everything written to the Workshop has been answered, put away, or needs nothing.' : 'Nothing of that kind.'}</li>` : ''}
    </ul>`}`;
  return c.html(page('Inbox', body, 'inbox', where('inbox')));
});

// HOW MUCH THE WORKSHOP MAY SAY FOR ITSELF. One control, three states, and
// every change carries its reason — because autonomy here is earned and
// revocable, and the record of why it moved is the thing that makes revoking
// it a decision rather than a panic.
inboxRoutes.post('/foundry/inbox/mode', requireInstitutionOwner(), async (c: any) => {
  const founderId = await founderOf(c);
  if (!founderId) return c.redirect('/onboarding');
  const form = await c.req.parseBody();
  const mode = String(form.mode ?? '');
  const because = String(form.because ?? '').trim();
  if (!['off', 'draft', 'autonomous'].includes(mode)) return c.redirect('/foundry/inbox?error=unknown%20mode');
  if (!because) return c.redirect('/foundry/inbox?error=reason%20required');
  const { setCorrespondenceMode } = await import('../../services/public-workshop/correspondence.js');
  await setCorrespondenceMode({ founderId, mode: mode as 'off' | 'draft' | 'autonomous', because });
  return c.redirect('/foundry/inbox?done=mode');
});

// ─── THE THREE THINGS HE DOES WITH A CONVERSATION ────────────────────────────
//
// Done says he dealt with it, which is a judgement and goes on the record as
// one. Archive says only "off my screen" — no claim about the message, nothing
// changed but what is in view, and reversible for exactly that reason. Both
// act on the conversation, because that is the object he is looking at.
const actOnThread = (
  what: 'done' | 'archive' | 'unarchive',
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
) => async (c: any): Promise<Response> => {
  const founderId = await founderOf(c);
  if (!founderId) return c.redirect('/onboarding');
  const threadKey = decodeURIComponent(String(c.req.param('thread')));
  const form = await c.req.parseBody();
  const because = String(form.because ?? '').trim();
  const mail = await import('../../services/public-workshop/mail.js');
  const back = String(form.back ?? '');
  const to = `/foundry/inbox${back ? `?show=${back}` : ''}`;
  if (what === 'unarchive') {
    await mail.unarchiveThread({ founderId, threadKey });
    return c.redirect(`${to}${back ? '&' : '?'}done=putback`);
  }
  if (!because) return c.redirect('/foundry/inbox?error=reason%20required');
  if (what === 'done') await mail.settleThread({ founderId, threadKey, because });
  else await mail.archiveThread({ founderId, threadKey, because });
  return c.redirect(`${to}${back ? '&' : '?'}done=${what === 'done' ? 'settled' : 'archived'}`);
};

// CLEAR WHAT HE HAS DEALT WITH: every handled conversation put away in one
// act, through the same thread-scoped writer the Archive button uses, with
// the same reason on every row. Nothing that needs him moves; nothing is
// deleted; Put back undoes any of it.
inboxRoutes.post('/foundry/inbox/clear-handled', requireInstitutionOwner(), async (c: any) => {
  const founderId = await founderOf(c);
  if (!founderId) return c.redirect('/onboarding');
  const form = await c.req.parseBody();
  const because = String(form.because ?? '').trim() || 'you cleared what you had dealt with';
  const mail = await import('../../services/public-workshop/mail.js');
  const handled = await mail.theThreads(founderId, 'handled');
  let n = 0;
  for (const t of handled) {
    const moved = await mail.archiveThread({ founderId, threadKey: t.key, because });
    if (moved > 0) n += 1;
  }
  return c.redirect(`/foundry/inbox?done=cleared&n=${String(n)}`);
});

inboxRoutes.post('/foundry/inbox/thread/:thread/done', requireInstitutionOwner(), actOnThread('done'));
inboxRoutes.post('/foundry/inbox/thread/:thread/archive', requireInstitutionOwner(), actOnThread('archive'));
inboxRoutes.post('/foundry/inbox/thread/:thread/unarchive', requireInstitutionOwner(), actOnThread('unarchive'));

inboxRoutes.get('/foundry/inbox/:thread', async (c: any) => {
  const founderId = await founderOf(c);
  if (!founderId) return c.redirect('/onboarding');
  const { theThread } = await import('../../services/public-workshop/mail.js');
  const key = decodeURIComponent(String(c.req.param('thread')));
  const msgs = await theThread(founderId, key);
  if (msgs.length === 0) return c.notFound();
  const { replyTo } = await import('../../services/public-workshop/correspondence.js');
  const replies = new Map((await Promise.all(msgs.map(async (m) => [m.id, await replyTo(m.id)] as const)))
    .filter((e): e is [string, NonNullable<typeof e[1]>] => e[1] != null));

  const body = html`
    <h1>${msgs[0]!.subject ?? '(no subject)'}</h1>
    <p class="lede">${msgs[0]!.fromName ?? msgs[0]!.from} — ${msgs.length} message${msgs.length === 1 ? '' : 's'}.</p>
    ${msgs.map((m) => html`<section class="know">
      <h2>${m.fromName ?? m.from} <span class="quiet">${when(m.receivedAt)}</span></h2>
      <p class="quiet">to ${m.to}${m.sentAt ? ` · they sent it ${when(m.sentAt)}` : ''}</p>
      <pre class="letter">${m.body}</pre>
      <dl class="facts">
        <dt>Read as</dt><dd>${m.reading.replaceAll('_', ' ')}${m.readingBecause ? ` — ${m.readingBecause}` : ''}</dd>
        <dt>Foundry did</dt><dd>${m.handledBecause ?? 'nothing yet'}</dd>
        <dt>Status</dt><dd>${WORD[m.handling] ?? m.handling}</dd>
        ${m.archivedBecause ? html`<dt>Put away</dt><dd>${m.archivedBecause}${m.archivedAt ? ` — ${when(m.archivedAt)}` : ''}. Nothing about the message changed; it is only off the working list.</dd>` : ''}
        ${m.experimentId ? html`<dt>About</dt><dd><a href="/foundry/experiments/${m.experimentId}">the experiment they were written to about</a></dd>` : html`<dt>About</dt><dd class="quiet">nobody the Workshop has written to</dd>`}
        <dt>How it authenticated</dt><dd class="quiet">SPF ${m.spf ?? '—'} · DKIM ${m.dkim ?? '—'} · ${m.dmarc ?? 'no DMARC result'}</dd>
        <dt>Why it is in this thread</dt><dd class="quiet">${m.threadedBecause}${m.bytesAtTheEdge != null ? ` · ${String(m.bytesAtTheEdge)} bytes at the edge` : ''}</dd>
      </dl>
      <p class="quiet">Nothing in this message can make Foundry act. It is what somebody said, kept as evidence; anything done about it was decided here, under your authority.</p>
      ${replies.get(m.id) ? html`<div class="answered">
        <h3>${replies.get(m.id)!.status === 'sent' ? 'Foundry answered' : replies.get(m.id)!.decision === 'escalate' ? 'Foundry did not answer this' : 'Foundry drafted an answer'}</h3>
        <p class="quiet">Read as <strong>${replies.get(m.id)!.intent.replaceAll('_', ' ')}</strong> · ${replies.get(m.id)!.because}</p>
        ${replies.get(m.id)!.says ? html`<pre class="letter">${replies.get(m.id)!.says}</pre>` : html`<p class="quiet">Nothing was said. This one is yours.</p>`}
        ${replies.get(m.id)!.did.length ? html`<p class="quiet"><strong>And it did:</strong> ${replies.get(m.id)!.did.join('; ')}</p>` : ''}
        <p class="quiet">${replies.get(m.id)!.status === 'sent' ? `Sent ${when(replies.get(m.id)!.sentAt ?? '')} — the provider accepted it${replies.get(m.id)!.providerMessageId ? ` and calls it ${replies.get(m.id)!.providerMessageId}` : ''}.` : replies.get(m.id)!.status === 'failed' ? 'The send did not complete, and nothing was retried blindly.' : 'Not sent.'}</p>
      </div>` : ''}
      ${m.handling === 'needs_owner' ? html`<form method="POST" action="/foundry/inbox/${m.id}/settle" class="stack">
        <label>How you handled it <input type="text" name="because" required placeholder="one line, for the record" /></label>
        <button class="btn" type="submit">Mark handled</button></form>` : ''}
    </section>`)}
`;
  return c.html(page('Thread', body, 'inbox', where('thread')));
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
