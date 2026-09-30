// =============================================================================
// FOUNDRY — Missions: the work Foundry is carrying, as the owner watches it.
//
// "All work", under Explore (INSTITUTION_MODEL §8): every piece of work in
// flight, in one list, a tap below the Explore door. Each card is one Mission — a search, a test, work
// taken on for a company, a piece of research — read by `services/mission`
// from the row it is. The page holds no state and no controls of its own: to
// stop a test is still the test's own Stop, reached from the Mission, so there
// is exactly one way to do each thing.
// =============================================================================
import { Hono } from 'hono';
import { html } from 'hono/html';
import type { HtmlEscapedString } from 'hono/utils/html';
import { query } from '../../db/client.js';
import { requireInstitutionOwner } from '../../middleware/rbac.js';
import { MissionRefused, actOnMission, openMission, readTerms, setTerms } from '../../services/mission/write.js';
import type { MissionMode, MissionRealm } from '../../services/mission/read.js';
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
  crumbs: [{ href: ADDRESSES.foundry, label: 'Foundry' }, { href: ADDRESSES.explore, label: LABELS.explore },
    { href: ADDRESSES.missions, label: LABELS.missions },
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
    <p><a class="btn" href="/foundry/missions/new">State a Mission yourself</a></p>
    <p class="quiet"><a href="/foundry/experiments/history">Every test ever run</a> · <a href="/foundry/searching">The search</a> · <a href="/foundry/activity">Everything that happened</a></p>`;
  return c.html(page(LABELS.missions, body, 'missions', frame(null)));
});

missionRoutes.get('/foundry/missions/new', async (c: any) => {
  const founderId = await founderOf(c);
  if (!founderId) return c.redirect('/onboarding');
  const said = String(c.req.query('said') ?? '').trim().slice(0, 300);
  return c.html(page('State a Mission', newMissionPage(said, {}, await companiesOf(founderId), null), 'missions', frame(null)));
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
  // WHAT HE DID TO IT, in the same stream: limits set, paused, resumed.
  const acts = ((await query(`SELECT kind, said, at FROM mission_events WHERE founder_id = ? AND mission_key = ?`, [founderId, m.key]))
    .rows as unknown as Array<Record<string, unknown>>).map((a) => ({ at: String(a.at), kind: `you ${String(a.kind)}`, text: String(a.said) }));
  activity.push(...acts);
  activity.sort((a, b) => (a.at < b.at ? -1 : a.at > b.at ? 1 : 0));
  const done = String(c.req.query('done') ?? '');
  const body = html`${done === 'limits' ? html`<p class="noticed">Its limits are saved. Foundry watches them and will bring them to you; they do not let it do more.</p>` : ''}
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
    ${sectionHead('Set its limits', 'Foundry watches these and brings them to you; they never let it do more')}
    ${limitsForm(m.key, m.terms, null)}
    ${m.source === 'mission' && !m.concluded ? html`<div class="row">
      ${m.status === 'paused' ? actButton(m.key, 'resumed', 'Resume') : actButton(m.key, 'paused', 'Pause')}
      ${actButton(m.key, 'concluded', 'Mark it done')}
      ${actButton(m.key, 'stopped', 'Stop it', 'Stop this Mission? Nothing it has already done is undone.')}</div>` : ''}
    ${m.source !== 'mission' ? html`<p class="quiet">To stop it, use the Stop on <a href="${m.href}">its own page</a>: that is the Stop that actually stops the work.</p>` : ''}
    ${m.concluded ? actButton(m.key, 'archived', 'Put it away') : ''}
    ${m.source !== 'mission' ? html`<p><a class="btn" href="${m.href}">Open the whole record</a></p>` : ''}`;
  return c.html(page(m.goal, body, 'missions', frame(m)));
});

// ─── What the owner does to a Mission ────────────────────────────────────────
const MODE_CHOICES: Array<[MissionMode, string]> = [
  ['explore', 'Explore: look for something'], ['validate', 'Validate: test whether it is true'],
  ['build', 'Build: make something (Foundry proposes each step)'], ['operate', 'Operate: keep something running'],
  ['optimize', 'Optimize: make something better'], ['monitor', 'Monitor: watch something'],
];
const INTERRUPT_CHOICES: Array<[string, string]> = [
  ['silent', 'Silently: only in the record'], ['today', 'In Today, when I next look'],
  ['needs_you', 'In Needs you'], ['urgent', 'Urgently'],
];

type H = HtmlEscapedString | Promise<HtmlEscapedString>;

/**
 * THE LIMITS, AS A FORM THAT KEEPS WHAT HE TYPED. A mistake re-renders this
 * with his values and the reason, answered 422 — never a redirect that
 * throws his typing away.
 */
function limitsForm(key: string, terms: { budgetCents: number | null; until: string | null; success: string | null; stopWhen: string | null; interruptAt: string } | null,
  kept: Record<string, string> | null, error: string | null = null): H {
  const v = (k: string, fromTerms: string): string => kept ? (kept[k] ?? '') : fromTerms;
  const interrupt = kept ? (kept.interruptAt ?? 'needs_you') : (terms?.interruptAt ?? 'needs_you');
  return html`<form method="POST" action="/foundry/missions/${encodeURIComponent(key)}/terms" class="limits">
    ${error ? html`<p class="noticed" role="alert"><strong>That was not saved.</strong> ${error}</p>` : ''}
    <label>Budget, in dollars <input type="text" inputmode="decimal" name="budget" value="${v('budget', terms?.budgetCents != null ? (terms.budgetCents / 100).toFixed(2) : '')}" placeholder="None" /></label>
    <label>End date <input type="date" name="until" value="${v('until', terms?.until ?? '')}" /></label>
    <label>Counts as success when <input type="text" name="success" maxlength="300" value="${v('success', terms?.success ?? '')}" placeholder="e.g. one paying customer" /></label>
    <label>Stop it when <input type="text" name="stopWhen" maxlength="300" value="${v('stopWhen', terms?.stopWhen ?? '')}" placeholder="e.g. no reply in two weeks" /></label>
    <label>Tell me about it <select name="interruptAt">${INTERRUPT_CHOICES.map(([k, w]) => html`<option value="${k}"${k === interrupt ? ' selected' : ''}>${w}</option>`)}</select></label>
    <button class="btn" type="submit">Save its limits</button>
  </form>`;
}

function actButton(key: string, kind: string, label: string, confirm = ''): H {
  return html`<form method="POST" action="/foundry/missions/${encodeURIComponent(key)}/act" class="inline"${confirm ? html` data-confirm="${confirm}"` : ''}>
    <input type="hidden" name="kind" value="${kind}" /><button class="btn" type="submit">${label}</button></form>`;
}

async function companiesOf(founderId: string): Promise<Array<{ id: string; name: string }>> {
  // Every company of his, invented ones included: a Mission may be about a
  // rehearsal, and its page discloses that. Standing does not apply: naming a
  // company as a Mission's subject acts on nothing.
  return ((await query(`SELECT id, name FROM products WHERE owner_id = ? AND deleted_at IS NULL ORDER BY name`, [founderId]))
    .rows as unknown as Array<Record<string, unknown>>).map((r) => ({ id: String(r.id), name: String(r.name) }));
}

function newMissionPage(said: string, kept: Record<string, string>, companies: Array<{ id: string; name: string }>, error: string | null): H {
  const mode = kept.mode ?? 'build';
  const realm = kept.realm ?? 'real';
  return html`<p class="crumbline"><a href="${ADDRESSES.missions}">← ${LABELS.missions}</a></p>
    <h1>State a Mission</h1>
    <p class="lede">A goal, and the limits you put on it. Starting one grants nothing: whatever it needs to do still comes to you, or goes through your charter.</p>
    ${error ? html`<p class="noticed" role="alert"><strong>That was not started.</strong> ${error}</p>` : ''}
    <form method="POST" action="/foundry/missions" class="limits">
      <input type="hidden" name="asked" value="${said}" />
      <label>The goal, in your words <input type="text" name="goal" required maxlength="300" value="${kept.goal ?? said}" /></label>
      <label>Kind of work <select name="mode">${MODE_CHOICES.map(([k, w]) => html`<option value="${k}"${k === mode ? ' selected' : ''}>${w}</option>`)}</select></label>
      <label>World <select name="realm">
        <option value="real"${realm === 'real' ? ' selected' : ''}>Real</option>
        <option value="paper"${realm === 'paper' ? ' selected' : ''}>Paper: nothing reaches a real person or account</option>
        <option value="simulation"${realm === 'simulation' ? ' selected' : ''}>Simulation</option></select></label>
      <label>For <select name="productId"><option value="">My whole portfolio</option>${companies.map((co) =>
        html`<option value="${co.id}"${kept.productId === co.id ? ' selected' : ''}>${co.name}</option>`)}</select></label>
      <label>Budget, in dollars <input type="text" inputmode="decimal" name="budget" value="${kept.budget ?? ''}" placeholder="None" /></label>
      <label>End date <input type="date" name="until" value="${kept.until ?? ''}" /></label>
      <label>Counts as success when <input type="text" name="success" maxlength="300" value="${kept.success ?? ''}" /></label>
      <label>Stop it when <input type="text" name="stopWhen" maxlength="300" value="${kept.stopWhen ?? ''}" /></label>
      <label>Tell me about it <select name="interruptAt">${INTERRUPT_CHOICES.map(([k, w]) => html`<option value="${k}"${k === (kept.interruptAt ?? 'needs_you') ? ' selected' : ''}>${w}</option>`)}</select></label>
      <p class="quiet">Trading can only ever be a simulation here: no order path exists, and that is deliberate.</p>
      <button class="btn go" type="submit">Start this Mission</button>
    </form>`;
}

const fields = (form: Record<string, unknown>): Record<string, string> => Object.fromEntries(
  ['goal', 'mode', 'realm', 'productId', 'budget', 'until', 'success', 'stopWhen', 'interruptAt']
    .map((k) => [k, String(form[k] ?? '').slice(0, 300)]));

missionRoutes.post('/foundry/missions', requireInstitutionOwner(), async (c: any) => {
  const founderId = await founderOf(c);
  if (!founderId) return c.redirect('/onboarding');
  const form = await c.req.parseBody();
  const kept = fields(form);
  const asked = String(form.asked ?? '').trim() || kept.goal!;
  // TRADING IS THE STRESS TEST. A Mission about trading can be stated only as
  // a simulation or on paper: there is no order path, and a form field cannot
  // make one (the long-horizon directive's 608, "test strategies, paper only").
  // LIVE does not exist to choose.
  const trades = /\b(trade|trading|bet|wager|kalshi|polymarket|order|position)\b/i.test(`${kept.goal ?? ''} ${asked}`);
  try {
    if (trades && kept.realm !== 'simulation' && kept.realm !== 'paper') throw new MissionRefused('Trading can only be a simulation or on paper here. Choose Simulation or Paper, and I will observe, forecast and score; nothing will be bought or sold.');
    const id = await openMission({
      founderId, productId: kept.productId || null, asked, goal: kept.goal ?? '',
      mode: (kept.mode ?? 'build') as MissionMode, realm: (kept.realm ?? 'real') as MissionRealm,
      terms: readTerms(kept),
    });
    const { recordConfirmed } = await import('../../services/intent/record.js');
    await recordConfirmed(founderId, asked).catch(() => undefined);
    return c.redirect(`/foundry/missions/${encodeURIComponent(`mission:${id}`)}`);
  } catch (err) {
    if (!(err instanceof MissionRefused)) throw err;
    return c.html(page('State a Mission', newMissionPage(asked, kept, await companiesOf(founderId), err.message), 'missions', frame(null)), 422);
  }
});

missionRoutes.post('/foundry/missions/:key/terms', requireInstitutionOwner(), async (c: any) => {
  const founderId = await founderOf(c);
  if (!founderId) return c.redirect('/onboarding');
  const key = String(c.req.param('key'));
  const form = await c.req.parseBody();
  const kept = fields(form);
  try {
    await setTerms(founderId, key, readTerms(kept));
    return c.redirect(`/foundry/missions/${encodeURIComponent(key)}?done=limits`);
  } catch (err) {
    if (!(err instanceof MissionRefused)) throw err;
    if (/not one of your/.test(err.message)) return c.notFound();
    return c.html(page('Its limits', html`<p class="crumbline"><a href="/foundry/missions/${encodeURIComponent(key)}">← The Mission</a></p>
      <h1>Its limits</h1>${limitsForm(key, null, kept, err.message)}`, 'missions', frame(null)), 422);
  }
});

missionRoutes.post('/foundry/missions/:key/act', requireInstitutionOwner(), async (c: any) => {
  const founderId = await founderOf(c);
  if (!founderId) return c.redirect('/onboarding');
  const key = String(c.req.param('key'));
  const form = await c.req.parseBody();
  const kind = String(form.kind ?? '');
  if (!['paused', 'resumed', 'stopped', 'concluded', 'archived'].includes(kind)) return c.text('Not an act', 400);
  try {
    await actOnMission(founderId, key, kind as 'paused', String(form.said ?? ''));
  } catch (err) {
    if (!(err instanceof MissionRefused)) throw err;
    if (/not one of your/.test(err.message)) return c.notFound();
    return c.html(page('Not done', html`<h1>Not done</h1><p class="lede">${err.message}</p>
      <p><a class="btn" href="/foundry/missions/${encodeURIComponent(key)}">Back to the Mission</a></p>`, 'missions', frame(null)), 422);
  }
  return c.redirect(kind === 'archived' ? ADDRESSES.missions : `/foundry/missions/${encodeURIComponent(key)}`);
});
