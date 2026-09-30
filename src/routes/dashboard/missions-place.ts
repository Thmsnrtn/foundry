// =============================================================================
// FOUNDRY — Missions: the work Foundry is carrying, as the owner watches it.
//
// A door, not a dashboard. Each card is one Mission — a search, a test, work
// taken on for a company, a piece of research — read by `services/mission`
// from the row it is. The page holds no state and no controls of its own: to
// stop a test is still the test's own Stop, reached from the Mission, so there
// is exactly one way to do each thing.
// =============================================================================
import { Hono } from 'hono';
import { html } from 'hono/html';
import { page } from './foundry-shell.js';
import type { Where } from './foundry-shell.js';
import { ADDRESSES, LABELS } from '../../views/owner/labels.js';
import { emptyState, facts, missionCard, sectionHead, statusPill } from '../../views/owner/components.js';
import { MODE_WORDS, REALM_WORDS, missionsOf, type Mission } from '../../services/mission/read.js';
import { getExperimentTimeline } from '../../services/founder/experiment-view.js';
import { threadOf } from '../../services/institution/undertaking.js';

export const missionRoutes = new Hono();

async function founderOf(c: any): Promise<string | null> {
  const founder = c.get('founder') as { id?: string } | undefined;
  return founder?.id ? String(founder.id) : null;
}

const frame = (m: Mission | null): Where => ({
  eyebrow: LABELS.missions,
  crumbs: [{ href: ADDRESSES.foundry, label: 'Foundry' }, { href: ADDRESSES.missions, label: LABELS.missions },
    ...(m ? [{ href: `/foundry/missions/${encodeURIComponent(m.key)}`, label: m.statusWord }] : [])],
  scope: { kind: 'foundry', id: null, name: LABELS.missions },
  local: [], chips: [],
});

// ─── The list ────────────────────────────────────────────────────────────────
missionRoutes.get('/foundry/missions', async (c: any) => {
  const founderId = await founderOf(c);
  if (!founderId) return c.redirect('/onboarding');
  const all = await missionsOf(founderId);
  const live = all.filter((m) => !m.concluded);
  const over = all.filter((m) => m.concluded);
  const needs = live.filter((m) => m.status === 'needs_you').length;
  const body = html`
    <h1>${LABELS.missions}</h1>
    <p class="lede">${live.length === 0 ? 'Foundry is carrying nothing for you right now.'
      : `Foundry is carrying ${String(live.length)} mission${live.length === 1 ? '' : 's'} for you${needs ? `; ${String(needs)} ${needs === 1 ? 'needs' : 'need'} you` : ''}.`}
      Each one is work with a goal and limits you set. None of them can do more than your charter, allowances and rules already allow.</p>
    ${live.length ? html`<div class="missions">${live.map(missionCard)}</div>`
      : emptyState('Tell Foundry what you want, in the box below, and it becomes a Mission you can watch.',
        'Find a small business I could run for under $50 a month, and ask me before contacting anyone.')}
    ${over.length ? html`${sectionHead('Ended in the last fortnight', String(over.length))}
      <div class="missions">${over.map(missionCard)}</div>` : ''}
    <p class="quiet"><a href="/foundry/experiments/history">Every test ever run</a> · <a href="/foundry/searching">The search</a> · <a href="/foundry/activity">Everything that happened</a></p>`;
  return c.html(page(LABELS.missions, body, 'missions', frame(null)));
});

// ─── One Mission ─────────────────────────────────────────────────────────────
missionRoutes.get('/foundry/missions/:key', async (c: any) => {
  const founderId = await founderOf(c);
  if (!founderId) return c.redirect('/onboarding');
  const key = String(c.req.param('key'));
  const all = await missionsOf(founderId);
  const m = all.find((x) => x.key === key) ?? null;
  if (!m) {
    return c.html(page('Not found', html`<h1>No such mission</h1>
      <p class="lede">Nothing Foundry is carrying, or finished in the last fortnight, goes by that name.</p>
      <p><a class="btn" href="${ADDRESSES.missions}">All missions</a></p>`, 'missions', frame(null)), 404);
  }
  const children = all.filter((x) => x.parent === m.key);
  const parent = m.parent ? all.find((x) => x.key === m.parent) ?? null : null;
  const [source, id] = [m.source, key.slice(key.indexOf(':') + 1)];
  const activity: Array<{ at: string; kind: string; text: string }> = source === 'experiment'
    ? (await getExperimentTimeline(founderId, id)).map((t) => ({ at: t.at, kind: t.kind, text: t.text }))
    : source === 'undertaking'
      ? (await threadOf(id)).steps.map((s) => ({ at: s.at, kind: s.kind.replace(/_/g, ' '), text: s.said }))
      : [];
  const body = html`
    <p class="crumbline"><a href="${ADDRESSES.missions}">← ${LABELS.missions}</a></p>
    <p>${statusPill(m.status, m.statusWord)}</p>
    <h1>${m.goal}</h1>
    <p class="lede">${m.statusDetail}</p>
    ${m.concluded
      ? html`${sectionHead('What came of it')}<p>${m.outcome ?? 'It ended without recording what it established.'}</p>`
      : html`${sectionHead('Next, Foundry will')}<p>${m.next ?? 'Nothing is scheduled.'}</p>`}
    ${sectionHead('Its limits', 'a Mission can only narrow what Foundry may do')}
    ${facts([
      ['Kind of work', MODE_WORDS[m.mode]],
      ['World', m.realm === 'real' ? 'Real' : `${REALM_WORDS[m.realm]}: nothing it does reaches a real person or account`],
      ['For', m.company ? m.company.name : 'Your whole portfolio'],
      ['Budget', m.limits.budget, 'None set here; the charter and allowances still bind'],
      ['Until', m.limits.until, 'No end date'],
      ['Counts as success', m.limits.success, 'Not written down'],
      ['Stops when', m.limits.stop, 'Not written down'],
    ])}
    ${parent ? html`<p class="quiet">Part of <a href="/foundry/missions/${encodeURIComponent(parent.key)}">${parent.goal}</a>.</p>` : ''}
    ${children.length ? html`${sectionHead('Missions inside this one', String(children.length))}<div class="missions">${children.map(missionCard)}</div>` : ''}
    ${activity.length ? html`${sectionHead('What has happened', `${String(activity.length)}, oldest first`)}
      <ol class="steps">${activity.map((a) => html`<li><span class="k">${a.kind}</span><span>${a.text}</span><time>${a.at.slice(0, 16).replace('T', ' ')}</time></li>`)}</ol>` : ''}
    <p><a class="btn" href="${m.href}">Open the whole record</a></p>`;
  return c.html(page(m.goal, body, 'missions', frame(m)));
});
