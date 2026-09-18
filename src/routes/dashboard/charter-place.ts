// =============================================================================
// FOUNDRY — The charter, as a place the owner stands in.
//
// The owner signs standing authority once, here, and he should not have to
// read an essay to understand what he is granting or hunt through Controls to
// find it. The first screen is a projection: where it stands, its limits, the
// most it can cost, what Foundry may and may never do inside it, the one rule
// about writing to people, and the action. The canonical language — the
// statement on the row, the sealed contact rules, the signing principal — stays
// the binding truth, one fold down. Nothing here decides anything; the POST
// handlers that sign and withdraw are the ones Controls always used.
// =============================================================================
import { Hono } from 'hono';
import { html, raw } from 'hono/html';
import type { HtmlEscapedString } from 'hono/utils/html';
import { count, page } from './foundry-shell.js';
import type { Where } from './foundry-shell.js';
import { mark } from '../../views/owner/shell.js';
import {
  PRE_CHARTER_THINKING_CENTS, SEALED_CONTACT_RULES, charterExposure, charterStatus, envelopeReading, pastCharters,
} from '../../services/institution/charter.js';
import { publicWorkshopOf } from '../../services/public-workshop/settings.js';

export const charterRoutes = new Hono();

async function founderOf(c: any): Promise<string | null> {
  const founder = c.get('founder') as { id?: string } | undefined;
  return founder?.id ? String(founder.id) : null;
}

const dollars = (cents: number): string => `$${(cents / 100).toFixed(cents % 100 === 0 ? 0 : 2)}`;
const STATUS_WORD = { unsigned: 'Unsigned', active: 'Active', expiring: 'Expiring', withdrawn: 'Withdrawn' } as const;
const STATUS_CLS = { unsigned: 'quiet none', active: 'watch', expiring: 'watch', withdrawn: 'quiet none' } as const;
/**
 * THE TERMS HE MAY CHOOSE. A first charter should be a proving window, not the
 * longest thing the row admits, so thirty days leads and is preselected until
 * he has signed one. The row's own bound is ninety-two days.
 */
const TERMS = [30, 60, 90] as const;
const FIRST_TERM = 30;

/** A number from the query, inside the same bounds the POST enforces, or the default. */
const num = (raw: unknown, min: number, max: number, dflt: number): number => {
  const n = Number(String(raw ?? ''));
  return Number.isFinite(n) && n >= min && n <= max ? n : dflt;
};

charterRoutes.get('/foundry/charter', async (c: any) => {
  const founderId = await founderOf(c);
  if (!founderId) return c.redirect('/onboarding');
  const now = new Date();
  const [envelope, past, workshop] = await Promise.all([envelopeReading(founderId, now), pastCharters(founderId), publicWorkshopOf(founderId)]);
  const status = charterStatus(envelope?.charter ?? null, past);
  const note = String(c.req.query('charter') ?? '');
  const why = String(c.req.query('why') ?? '');
  // THE FORM'S VALUES, ECHOED. "Recalculate the ceiling" is a GET of this page
  // with the fields, so the figure he reads before signing is the server's own
  // arithmetic — the same function that reads the active charter — and not a
  // copy in a script that could drift from it.
  const q = c.req.query() as Record<string, string | undefined>;
  // The term he last signed leads when he has signed one; a proving window
  // otherwise. Nothing here picks his money for him.
  const lastTerm = past.length && envelope === null ? FIRST_TERM : FIRST_TERM;
  const form = {
    tests: num(q.tests_dollars, 1, 3000, 100), probes: Math.round(num(q.probes, 1, 12, 3)),
    thinking: num(q.thinking_dollars, 0.5, 20, 3), days: Math.round(num(q.days, 7, 92, lastTerm)),
    statement: String(q.statement ?? '').slice(0, 600),
  };
  const ex = envelope
    ? charterExposure({ testsTotalCents: envelope.charter.testsTotalCents, cognitionCentsPerDay: envelope.charter.cognitionCentsPerDay, days: envelope.charter.days })
    : charterExposure({ testsTotalCents: Math.round(form.tests * 100), cognitionCentsPerDay: Math.round(form.thinking * 100), days: form.days });
  const probes = envelope ? envelope.charter.probesInFlight : form.probes;
  const voice = envelope ? envelope.charter.publicVoice : workshop?.publicName ?? 'the Workshop';
  const rules = envelope ? envelope.charter.contactRules : SEALED_CONTACT_RULES;
  const firstRule = rules.split(/(?<=\.)\s/)[0] ?? rules;

  const lede = status === 'active' || status === 'expiring'
    ? `Tests inside it launch, spend and write without a tap from you, until ${envelope!.charter.expiresAt.slice(0, 10)}.`
    : 'Every real test waits for you.';
  const notice = note === 'signed' ? html`<p class="noticed"><strong>Signed.</strong> A test inside it now launches without a tap from you.</p>`
    : note === 'withdrawn' ? html`<p class="noticed">Withdrawn. Every real test waits for you again; nothing already running was stopped.</p>`
      : note === 'error' ? html`<p class="noticed" role="alert"><strong>Not signed.</strong> ${why}</p>` : '';

  const limits = html`<section class="panel" aria-label="Limits"><header><h2>${mark('charter')}Limits</h2></header>
    <dl class="facts">
      <dt>Tests, whole charter</dt><dd>${dollars(ex.testsTotalCents)}</dd>
      <dt>Thinking, a day</dt><dd>${dollars(ex.cognitionCentsPerDay)}</dd>
      <dt>Tests at once</dt><dd>${String(probes)}</dd>
      <dt>${envelope ? 'Expires' : 'Lasts'}</dt><dd>${envelope ? `${envelope.charter.expiresAt.slice(0, 10)} · ${count(envelope.charter.daysLeft, 'day')} left` : `${String(ex.days)} days from signing`}</dd>
      ${envelope ? html`<dt>Left for tests</dt><dd>${dollars(envelope.remainingCents)} of ${dollars(envelope.charter.testsTotalCents)}</dd>
      <dt>Thinking so far</dt><dd>${dollars(envelope.thinkingCents)} since you signed</dd>
      <dt>In flight</dt><dd>${String(envelope.inFlight)} of ${String(envelope.charter.probesInFlight)}${envelope.roomForAnother ? '' : ' — full until one settles'}</dd>` : ''}
    </dl></section>`;

  // COMPONENT CEILINGS ARE NOT THE DOWNSIDE. Each is real money and neither is
  // the whole, so they are labelled as parts and the total stands on its own
  // line, in the serif, as the one figure he needs before he signs.
  const exposure = html`<section class="panel" aria-label="The most it can cost"><header><h2>${mark('cash')}The most it can cost</h2></header>
    <p class="act">Component ceilings</p>
    <dl class="numbers exp-numbers">
      <div class="tile"><dt class="k">Tests</dt><dd class="v">${dollars(ex.testsTotalCents)}</dd><dd class="d">the whole charter</dd></div>
      <div class="tile"><dt class="k">Thinking</dt><dd class="v">${dollars(ex.cognitionCentsPerDay)}</dd><dd class="d">each day, on top of tests</dd></div>
      <div class="tile"><dt class="k">At once</dt><dd class="v">${String(probes)}</dd><dd class="d">tests in flight</dd></div>
      <div class="tile"><dt class="k">Term</dt><dd class="v">${String(ex.days)}</dd><dd class="d">days</dd></div>
    </dl>
    <p class="act">Total exposure</p>
    <p class="lead total-exposure">${dollars(ex.testsTotalCents)} + ${dollars(ex.cognitionCentsPerDay)} × ${String(ex.days)} days = <b>${dollars(ex.periodMaxCents)}</b></p>
    <p class="quiet">The most this charter can ever cost you. No day, no month and no window can exceed it: the tests total is held whole by the row that sets money aside, whatever month a test falls in, and the day's thinking is held on each of the ${String(ex.days)} days. Money buyers pay is not in these figures; what is at risk is. Refunds come out of what was paid.</p>
  </section>`;

  // WHAT IT DOES BEFORE HE SIGNS. The charter gates acting consequentially, not
  // thinking: everything up to sealing runs anyway, and saying so is what keeps
  // an unsigned charter from reading as a dead institution.
  const before = envelope ? '' : html`<section class="know" id="before"><h2>Before you sign</h2>
    <p>Foundry is not idle without a charter. It looks through every eye it has, reads what people actually wrote, questions what it found and buries what contradicts, promotes only what two independent ways of knowing support, and puts a candidate through five disciplines and an adversary that attacks its own draft.</p>
    <p>It stops at one line: it will not seal a design, so nothing is made, placed, sold or written to anybody. Each finished design waits for you on its own page instead, one at a time.</p>
    <p class="quiet">Until you sign, its own thinking is bounded at ${dollars(PRE_CHARTER_THINKING_CENTS)} a day.</p>
  </section>`;

  const may = html`<section class="know"><h2>Inside it, Foundry may</h2><ul>
      <li>Let a test in, up to ${count(probes, 'at a time', 'at a time')}, and spend what was set aside for it.</li>
      <li>Place the offer on the Workshop's own page as ${voice}, sell it, deliver it, and refund a delivery that fails.</li>
      <li>Write to people only under the rule below, once each, and never to anyone who said no.</li>
    </ul></section>`;
  const never = html`<section class="know"><h2>Never, whatever the numbers</h2><ul>
      <li>A legal commitment of any kind.</li>
      <li>Anything that cannot be undone.</li>
      <li>Anything outside the limits above; over them, a test waits for you.</li>
    </ul></section>`;
  const contact = html`<section class="know"><h2>Writing to people</h2>
    <p>${firstRule}</p>
    <details class="fold"><summary><h3>The whole rule</h3><span class="gist">sealed with the signature</span></summary><p class="quiet">${rules}</p></details>
  </section>`;

  const action = envelope ? html`<section class="panel" id="sign" aria-label="Your decision">
      <p class="row">
        <form method="POST" action="/foundry/controls/charter">
          <input type="hidden" name="tests_dollars" value="${(envelope.charter.testsTotalCents / 100).toFixed(envelope.charter.testsTotalCents % 100 === 0 ? 0 : 2)}" />
          <input type="hidden" name="probes" value="${String(envelope.charter.probesInFlight)}" />
          <input type="hidden" name="thinking_dollars" value="${(envelope.charter.cognitionCentsPerDay / 100).toFixed(envelope.charter.cognitionCentsPerDay % 100 === 0 ? 0 : 2)}" />
          <input type="hidden" name="days" value="${String(envelope.charter.days)}" />
          <input type="hidden" name="statement" value="${envelope.charter.statement}" />
          <button class="btn btn-sm" type="submit">Renew as it stands, ${count(envelope.charter.days, 'day')}</button>
        </form>
        <form method="POST" action="/foundry/controls/charter/withdraw" data-confirm="Withdraw the charter? Every real test waits for you again, and nothing already running is stopped.">
          <input type="hidden" name="reason" value="withdrawn from the charter page" />
          <button class="btn btn-sm danger" type="submit">Withdraw it</button>
        </form>
      </p>
      <p class="quiet">To change a number, withdraw this one and sign another; the old one is ended with the reason on record.</p>
    </section>`
    : !workshop ? html`<section class="panel" id="sign" aria-label="Your decision">
      <p class="lines"><span class="state quiet none">Unsigned</span> <span class="quiet">needs the Workshop first — a charter speaks as it</span></p>
      <p class="row"><a class="btn btn-sm" href="/foundry/public-workshop">The Workshop</a></p>
    </section>`
      : html`<section class="panel" id="sign" aria-label="Your decision">
      <form class="charter" method="POST" action="/foundry/controls/charter">
        <fieldset class="terms"><legend>How long</legend>
          ${TERMS.map((t) => html`<label class="term"><input type="radio" name="days" value="${String(t)}"${form.days === t ? raw(' checked') : ''} />${String(t)} days</label>`)}
        </fieldset>
        <label for="charter-tests">Tests, over the whole charter, in dollars</label><input id="charter-tests" type="number" name="tests_dollars" min="1" max="3000" step="1" value="${String(form.tests)}" required inputmode="numeric" />
        <label for="charter-thinking">Thinking, a day, in dollars</label><input id="charter-thinking" type="number" name="thinking_dollars" min="0.5" max="20" step="0.5" value="${String(form.thinking)}" required inputmode="decimal" />
        <label for="charter-probes">Tests at once</label><input id="charter-probes" type="number" name="probes" min="1" max="12" step="1" value="${String(form.probes)}" required inputmode="numeric" />
        <label for="charter-why">Why, in your words</label><textarea id="charter-why" name="statement" rows="3" required placeholder="A river of nickels: dozens of small, sturdy things, each tested for real, none needing me.">${form.statement}</textarea>
        <p class="row">
          <button class="btn go" type="submit">Sign for ${count(form.days, 'day')}</button>
          <button class="btn btn-ghost" type="submit" formmethod="GET" formaction="/foundry/charter">Recalculate the ceiling</button>
        </p>
      </form>
    </section>`;

  const fold = (id: string, title: string, gist: string, inner: HtmlEscapedString | Promise<HtmlEscapedString>) =>
    html`<details class="fold" id="${id}"><summary><h2>${title}</h2><span class="gist">${gist}</span></summary>${inner}</details>`;
  const history = html`${past.length ? html`<ul class="plain">${past.map((x) => html`<li>Signed ${x.signedAt}, ended ${x.endedAt} <span class="quiet">— ${x.because}</span></li>`)}</ul>` : html`<p class="quiet">No earlier charter.</p>`}
    ${envelope ? (envelope.carves.length ? html`<p class="quiet">Let in under this one:</p><ul class="reach">${envelope.carves.map((k) => html`<li><a href="/foundry/experiments/${k.experimentId}">${k.experimentId}</a> <span class="quiet">${dollars(k.cents)} · ${k.carvedAt.slice(0, 10)} · ${k.settled ? 'settled' : 'in flight'}</span></li>`)}</ul>` : html`<p class="quiet">Nothing has been let in under it yet.</p>`) : ''}`;
  const folds = html`<div class="inspect">
    ${fold('how', 'How this works', `one signature, ${count(ex.days, 'day')}`, html`
      <p>A charter is standing authority. Inside its limits Foundry seals a test's design, sets aside the money for it, places the offer, sells, delivers and refunds, and decides the ordinary acts on the way as the charter — every one recorded as such. Over a limit, on a rung the charter can never cover, or once it ends, the same test waits for you exactly as before. Stop everything still stops all of it.</p>
      <p class="quiet">The tests total is held by the row that sets money aside, summed across the whole charter with no calendar in it; the day's thinking is held by the pass that thinks. That is why the total above is the total: neither ceiling can be reached twice by waiting for a month to turn.</p>`)}
    ${fold('rules', 'Writing rules', 'the whole text', html`<p class="quiet">${rules}</p>`)}
    ${fold('yours', 'What remains yours', 'every time', html`<ul>
      <li>A legal commitment, and anything that cannot be undone.</li>
      <li>A test over the charter's money for tests, or over the places in flight.</li>
      <li>Widening the limits: that is a new signature, never something the institution does.</li>
      <li>Naming who may never be written to; an exclusion outranks the charter.</li>
    </ul>`)}
    ${fold('text', 'Full charter text', envelope ? 'as signed' : 'as it would be signed', html`
      <p><b>Statement.</b> ${envelope ? envelope.charter.statement : (form.statement || 'Your words go here.')}</p>
      <p><b>Limits.</b> ${dollars(ex.testsTotalCents)} across every test for the whole charter; ${String(probes)} tests in flight at once; ${dollars(ex.cognitionCentsPerDay)} a calendar day of thinking; ${String(ex.days)} days from signing. The most it can cost is ${dollars(ex.periodMaxCents)}.</p>
      <p><b>Speaks as.</b> ${voice}, never you; no person is named on any public surface.</p>
      <p><b>Writing to people.</b> ${rules}</p>
      <p><b>Never inside it.</b> A legal commitment, or anything that cannot be undone. Those wait for you, each time.</p>
      ${envelope ? html`<p class="mono">signed ${envelope.charter.signedBy} · ${envelope.charter.signedAt} · ends ${envelope.charter.expiresAt} · ${envelope.charter.id}</p>` : html`<p class="mono">signed founder:${founderId} on signing · portfolio_envelopes</p>`}`)}
    ${fold('history', 'History', past.length ? count(past.length, 'earlier charter') : 'none yet', history)}
  </div>`;

  const frame: Where = {
    eyebrow: 'Controls',
    crumbs: [{ href: '/foundry', label: 'Foundry' }, { href: '/foundry/controls', label: 'Controls' }, { href: '/foundry/charter', label: 'The charter' }],
    scope: { kind: 'foundry', id: null, name: 'everything' }, local: [], chips: [],
  };
  const body = html`
    <p class="act">${mark('charter')}Authority</p>
    <h1>The charter <span class="state ${STATUS_CLS[status]}">${STATUS_WORD[status]}</span></h1>
    <p class="lede">${lede}</p>
    ${notice}
    ${status === 'active' || status === 'expiring' ? action : ''}
    ${limits}
    ${exposure}
    ${before}
    ${may}
    ${never}
    ${contact}
    ${status === 'active' || status === 'expiring' ? '' : action}
    ${folds}
    ${raw('')}`;
  return c.html(page('The charter', body, 'controls', frame));
});
