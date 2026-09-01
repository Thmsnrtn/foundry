// =============================================================================
// FOUNDRY — the owner's surface
//
// A COMPOSITION LAYER, NOT A SECOND INSTITUTION. Every number here is read
// through the same services the rest of the product uses, and every action
// posts to the same governed routes. Nothing about responsibility, authority,
// evidence or spend is decided in this file; it decides only what a person is
// shown first, what is shown underneath, and what is not shown at all.
//
// WHY IT IS NOT `dashboardLayout`. That layout carries thirty destinations
// across five groups — Signal, Ambient, Roster, Debate, Multi-Modal, Investor
// Hub — and the owner opened it and said he had no idea what was happening.
// The institution's depth is not the owner's problem, and a navigation system
// that enumerates the machinery is the machinery leaking. This surface has one
// question at the top, one composer at the bottom, and three places.
//
// PHONE FIRST, AND MEASURED. The owner operates this from an iPhone. Every
// width below 430px is a supported layout, not a degradation: single column,
// nothing horizontally scrollable, no fixed widths, no tables. Proven at 375,
// 390, 393, 414 and 430 CSS px by `tests/mobile/foundry-shell.spec.ts`, which
// fails if `documentElement.scrollWidth` exceeds `innerWidth` by a pixel.
// =============================================================================

import { Hono } from 'hono';
import { html, raw } from 'hono/html';
import type { HtmlEscapedString } from 'hono/utils/html';
import { query } from '../../db/client.js';
import { selectedProductId } from './_shared.js';

export const foundryShellRoutes = new Hono();

// ─── what the owner is told, in the owner's words ───────────────────────────

/**
 * Plain words for a check. The same translation the Letter uses, kept here
 * because this surface must not depend on that page surviving.
 *
 * A check with no entry degrades to its own name — honest, and visibly
 * unnamed, rather than a confident sentence invented for it.
 */
const CHECK_IN_PLAIN_WORDS: Record<string, { name: string; why: string }> = {
  'schema-snapshot-freshness': {
    name: 'Keep my internal map accurate',
    why: 'When I change how I store information, my own reference to it has to '
      + 'change too. If it does not, I end up wrong about my own workings.',
  },
  'ratchet-baseline-liveness': {
    name: 'Keep my list of known exceptions honest',
    why: 'I keep a list of small imperfections I have agreed to overlook. When '
      + 'the thing one of them points at stops existing, the excuse outlives it.',
  },
};

const LADDER_IN_PLAIN_WORDS: Record<string, string> = {
  unknown: 'I do not know about it yet',
  visible: 'I know it exists',
  understood: 'I understand what it is',
  shadowing: 'I am watching how it goes',
  assisting: 'I am helping with it, within what you allowed',
  operating: 'I am carrying it',
  mature: 'I have carried it for a while',
  exception_owned: 'you took it back',
};

// ─── the state this surface reads ───────────────────────────────────────────

interface OwnerState {
  productId: string;
  companyName: string;
  greetingName: string;
  routinesHealthy: number;
  routinesFailing: string[];
  checks: Array<{ check: string; result: string; detail: string; observedAt: string }>;
  responsibilities: Array<{ id: string; title: string; state: string; check: string | null }>;
  pendingCandidates: Array<{ id: string; proposal: string }>;
  openQuestions: number;
  budgetMonthly: number;
  spent30d: number;
  senses: string[];
  establishedAt: string | null;
}

async function readOwnerState(productId: string, founderName: string): Promise<OwnerState> {
  const product = (await query(
    `SELECT name, created_at, operating_budget_monthly_usd, ai_cost_trailing_30d_usd, github_repo_url
       FROM products WHERE id = ?`, [productId])).rows[0] as Record<string, unknown> | undefined;

  const { getSelfCheckStanding } = await import(
    '../../services/institution/development-observation.js');
  const checks = await getSelfCheckStanding(productId);

  const { getPendingResponsibilityCandidates } = await import(
    '../../services/institution/responsibility-candidate.js');
  const candidates = await getPendingResponsibilityCandidates(productId);

  // The responsibility's own check, read from the evidence that created it, so
  // the owner sees one name for the thing from recognition through to grant.
  const responsibilities = (await query(
    `SELECT r.id, r.title, r.state, json_extract(e.payload_json,'$.check') AS check_name
       FROM institutional_responsibilities r
       LEFT JOIN signal_events e ON ('signal_event:' || e.id) = r.discovery_evidence_ref
        AND e.product_id = r.product_id
      WHERE r.product_id = ? AND r.disposition = 'active'
      ORDER BY r.created_at`, [productId])).rows as unknown as Array<Record<string, unknown>>;

  const health = (await query(
    `SELECT COUNT(*) AS n FROM job_health WHERE last_success_at IS NOT NULL`, []))
    .rows[0] as Record<string, unknown>;
  const failing = (await query(
    `SELECT job_name FROM job_health WHERE consecutive_failures > 0 ORDER BY job_name`, []))
    .rows as unknown as Array<Record<string, unknown>>;

  const questions = (await query(
    `SELECT COUNT(*) AS n FROM founder_evidence_requests
      WHERE product_id = ? AND status = 'open'`, [productId]))
    .rows[0] as Record<string, unknown>;

  const senses: string[] = [];
  if (product?.github_repo_url) senses.push('its code');

  return {
    productId,
    companyName: String(product?.name ?? 'this company'),
    greetingName: founderName.split(' ')[0] || 'there',
    routinesHealthy: Number(health?.n ?? 0),
    routinesFailing: failing.map((r) => String(r.job_name)),
    checks,
    responsibilities: responsibilities.map((r) => ({
      id: String(r.id), title: String(r.title), state: String(r.state),
      check: r.check_name == null ? null : String(r.check_name),
    })),
    pendingCandidates: candidates.map((c) => ({ id: c.id, proposal: c.proposedResponsibility })),
    openQuestions: Number(questions?.n ?? 0),
    budgetMonthly: Number(product?.operating_budget_monthly_usd ?? 0),
    spent30d: Number(product?.ai_cost_trailing_30d_usd ?? 0),
    senses,
    establishedAt: product?.created_at == null ? null : String(product.created_at).slice(0, 10),
  };
}

/** What genuinely needs the owner right now, most important first. */
function needsOwner(state: OwnerState): Array<{ what: string; where: string }> {
  const items: Array<{ what: string; where: string }> = [];
  if (state.pendingCandidates.length) {
    items.push({ what: 'Something I would like to take on', where: '/foundry?ask=responsibility' });
  }
  if (state.routinesFailing.length) {
    items.push({ what: 'Some of my routines have stopped', where: '/foundry?ask=okay' });
  }
  const drifted = state.checks.filter((c) => c.result === 'failed');
  if (drifted.length) items.push({ what: 'Something I keep has gone out of step', where: '/foundry?ask=okay' });
  return items;
}

// ─── layout ─────────────────────────────────────────────────────────────────

const shell = (title: string, active: 'foundry' | 'portfolio' | 'controls',
  body: HtmlEscapedString | Promise<HtmlEscapedString>) => html`<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
<title>${title}</title>
<style>
  :root {
    --ground:#F1F3EF; --surface:#FFFFFF; --sunk:#E9ECE6;
    --ink:#16201C; --soft:#4C574F; --faint:#78837B; --rule:#DDE2D9;
    --accent:#2E6A5C; --accent-soft:#E3EDE8; --on-accent:#FFFFFF;
    --attention:#A8701F; --ok:#3F7A4B;
  }
  @media (prefers-color-scheme:dark){ :root:not([data-theme="light"]){
    --ground:#101714; --surface:#18211D; --sunk:#131B18;
    --ink:#E6EBE6; --soft:#A3AEA6; --faint:#7B857D; --rule:#26312B;
    --accent:#6FBBA6; --accent-soft:#1B2A26; --on-accent:#0E1614;
    --attention:#D3A257; --ok:#7CB98A;
  }}
  *,*::before,*::after{box-sizing:border-box;}
  html,body{max-width:100%;overflow-x:hidden;}
  body{
    margin:0;background:var(--ground);color:var(--ink);
    font-family:ui-sans-serif,system-ui,-apple-system,"Segoe UI",sans-serif;
    font-size:16px;line-height:1.55;-webkit-text-size-adjust:100%;
  }
  img,svg,video{max-width:100%;height:auto;}
  .page{max-width:640px;margin:0 auto;padding:18px 16px 132px;}
  h1{font-size:1.5rem;line-height:1.25;font-weight:500;margin:2px 0 14px;text-wrap:balance;}
  h2{font-size:1.05rem;font-weight:600;margin:0 0 6px;}
  p{margin:0 0 10px;overflow-wrap:anywhere;}
  .muted{color:var(--soft);}
  .faint{color:var(--faint);font-size:.82rem;}
  .rows{display:flex;flex-direction:column;gap:11px;margin-bottom:16px;}
  .row{display:flex;gap:10px;align-items:flex-start;}
  .row .pip{flex:0 0 auto;line-height:1.7;font-size:.7rem;}
  .pip.good{color:var(--ok);} .pip.warn{color:var(--attention);}
  .row p{margin:0;color:var(--soft);font-size:.95rem;min-width:0;}
  .row strong{color:var(--ink);font-weight:600;}
  .settled{
    background:var(--accent-soft);border-radius:12px;padding:12px 14px;
    margin:4px 0 18px;font-size:1rem;
  }
  .card{
    background:var(--surface);border:1px solid var(--rule);border-radius:14px;
    margin:0 0 14px;overflow:hidden;
  }
  .card-in{padding:14px;}
  .kind{
    font-size:.65rem;letter-spacing:.12em;text-transform:uppercase;
    color:var(--faint);font-weight:700;margin:0 0 4px;
  }
  .card h2{font-size:1.12rem;line-height:1.3;margin:0 0 8px;font-weight:600;}
  dl.facts{display:grid;grid-template-columns:auto minmax(0,1fr);gap:6px 14px;
    margin:0;padding:12px 14px;border-top:1px solid var(--rule);font-size:.88rem;}
  dl.facts dt{color:var(--faint);}
  dl.facts dd{margin:0;min-width:0;overflow-wrap:anywhere;}
  .acts{display:flex;flex-wrap:wrap;gap:8px;padding:12px 14px;border-top:1px solid var(--rule);}
  .btn{
    font:inherit;font-size:.92rem;font-weight:500;cursor:pointer;text-decoration:none;
    display:inline-block;border-radius:11px;padding:11px 15px;min-height:44px;
    border:1px solid var(--rule);background:var(--surface);color:var(--ink);
  }
  .btn-primary{background:var(--accent);border-color:var(--accent);color:var(--on-accent);}
  .btn:focus-visible{outline:2px solid var(--accent);outline-offset:2px;}
  details{border-top:1px solid var(--rule);}
  details summary{
    cursor:pointer;list-style:none;padding:12px 14px;font-size:.86rem;color:var(--soft);
    display:flex;justify-content:space-between;gap:10px;min-height:44px;align-items:center;
  }
  details summary::-webkit-details-marker{display:none;}
  details summary::after{content:"+";color:var(--faint);}
  details[open] summary::after{content:"\\2013";}
  details .in{padding:0 14px 14px;font-size:.88rem;color:var(--soft);}
  details .in p{margin:0 0 8px;}
  .tech{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:.76rem;
    color:var(--faint);overflow-wrap:anywhere;}
  .said{
    background:var(--sunk);border:1px solid var(--rule);border-radius:12px;
    padding:10px 12px;margin:22px 0 12px;font-size:.95rem;
  }
  .said .who{font-size:.68rem;letter-spacing:.1em;text-transform:uppercase;color:var(--faint);
    font-weight:700;margin-bottom:3px;}
  .answer{font-size:1rem;margin-bottom:16px;}
  .answer p{margin:0 0 10px;}
  .chips{display:flex;flex-wrap:wrap;gap:8px;margin:0 0 4px;}
  .chip{
    font:inherit;font-size:.86rem;text-decoration:none;display:inline-block;
    background:var(--surface);border:1px solid var(--rule);border-radius:999px;
    padding:9px 13px;color:var(--soft);min-height:40px;
  }
  .chip:focus-visible{outline:2px solid var(--accent);outline-offset:2px;}
  .composer{
    position:fixed;left:0;right:0;bottom:0;background:var(--ground);
    border-top:1px solid var(--rule);padding:10px 12px calc(10px + env(safe-area-inset-bottom));
  }
  .composer-in{max-width:640px;margin:0 auto;display:flex;gap:8px;}
  .composer input{
    flex:1;min-width:0;font:inherit;font-size:16px;padding:11px 13px;
    border:1px solid var(--rule);border-radius:12px;background:var(--surface);color:var(--ink);
  }
  .composer input:focus-visible{outline:2px solid var(--accent);outline-offset:1px;}
  .tabs{
    position:fixed;left:0;right:0;bottom:calc(63px + env(safe-area-inset-bottom));
    display:none;
  }
  nav.places{
    display:flex;gap:6px;margin:0 0 18px;border-bottom:1px solid var(--rule);
  }
  nav.places a{
    flex:1;text-align:center;text-decoration:none;color:var(--faint);font-size:.9rem;
    padding:10px 4px 11px;border-bottom:2px solid transparent;min-height:44px;
  }
  nav.places a.on{color:var(--ink);border-bottom-color:var(--accent);font-weight:600;}
  nav.places a:focus-visible{outline:2px solid var(--accent);outline-offset:-2px;}
  .advanced{margin-top:26px;padding-top:14px;border-top:1px solid var(--rule);}
  .advanced a{color:var(--faint);font-size:.82rem;}
</style>
</head>
<body>
<div class="page">
  <nav class="places">
    <a href="/foundry" class="${active === 'foundry' ? 'on' : ''}">Foundry</a>
    <a href="/foundry/portfolio" class="${active === 'portfolio' ? 'on' : ''}">Portfolio</a>
    <a href="/foundry/controls" class="${active === 'controls' ? 'on' : ''}">Controls</a>
  </nav>
  ${body}
  <div class="advanced">
    <a href="/letter">Advanced — inspect the system</a>
  </div>
</div>
<form class="composer" method="GET" action="/foundry">
  <div class="composer-in">
    <input name="q" placeholder="Ask Foundry anything…" aria-label="Ask Foundry anything" autocomplete="off" />
    <button class="btn btn-primary" type="submit">Ask</button>
  </div>
</form>
<script>
  // THE TIME OF DAY IS THE READER'S, NOT THE SERVER'S. This rendered "Good
  // morning" at eleven at night, because the machine runs in UTC and the owner
  // does not. The device knows; the server is guessing, so it does not guess.
  (function(){var h=new Date().getHours(),g=document.getElementById('greet');
    if(g)g.textContent=h<12?'Good morning':h<18?'Good afternoon':'Good evening';})();
</script>
</body>
</html>`;

// ─── the answers, built from state rather than improvised ───────────────────

/** "1 thing" / "2 things", because "2 thing(s)" is machinery showing through. */
function count(n: number, singular: string, plural = singular + 's'): string {
  return `${n} ${n === 1 ? singular : plural}`;
}

function checkLine(c: { check: string; result: string }): string {
  return CHECK_IN_PLAIN_WORDS[c.check]?.name ?? c.check.replaceAll('-', ' ');
}

const ANSWERABLE: Record<string, string> = {
  needs: 'What needs me?',
  today: 'What happened today?',
  working: 'What are you working on?',
  okay: 'Are you okay?',
  responsibility: 'What is this responsibility?',
  why: 'Why do you need me?',
};

function answer(key: string, s: OwnerState): HtmlEscapedString | Promise<HtmlEscapedString> {
  const needs = needsOwner(s);
  const held = s.checks.filter((c) => c.result === 'passed');
  const drifted = s.checks.filter((c) => c.result === 'failed');

  if (key === 'needs' || key === 'why') {
    if (!needs.length) {
      return html`<div class="answer"><p>Nothing does, right now. I am watching
        ${String(s.checks.length)} thing(s) about ${s.companyName} and none of them
        has moved. When something needs your judgment I will put it here first.</p></div>`;
    }
    return html`<div class="answer">
      <p>${needs.length === 1 ? 'One thing' : count(needs.length, 'thing')}, and I have put
        ${needs.length === 1 ? 'it' : 'them'} below.</p>
    </div>${responsibilityOffer(s)}`;
  }

  if (key === 'today') {
    return html`<div class="answer">
      <p>${s.routinesFailing.length > 0
    ? html`${count(s.routinesFailing.length, 'routine')} of mine are failing.`
    : s.routinesHealthy === 0
      ? html`I have not run anything yet.`
      : html`I ran <strong>${count(s.routinesHealthy, 'routine')}</strong> and none of them failed.`}</p>
      <p>${s.checks.length === 0
    ? 'I have not checked anything about myself yet.'
    : html`I checked ${count(s.checks.length, 'thing')} about myself.
        ${drifted.length === 0 ? 'All of them still match.'
      : `${count(drifted.length, 'thing')} went out of step.`}`}</p>
      ${s.pendingCandidates.length ? html`<p>I asked you about one piece of upkeep I would
        like to take on, and I am waiting on your answer.</p>` : ''}
      <p class="faint">I have spent $${s.spent30d.toFixed(2)} of your $${String(s.budgetMonthly)}
        monthly budget.</p>
    </div>`;
  }

  if (key === 'working') {
    return html`<div class="answer">
      ${s.checks.length === 0 ? html`<p>Nothing yet.</p>` : html`
      <p>Watching, mostly. Every six hours I check these and record what I find:</p>
      ${raw(s.checks.map((c) => `<p>• ${checkLine(c)} — ${c.result === 'passed'
    ? 'still accurate' : 'out of step'}</p>`).join(''))}`}
      ${s.responsibilities.length ? html`<p>You have recognised
        ${count(s.responsibilities.length, 'of these', 'of these')} as something I may eventually handle.
        Right now: ${LADDER_IN_PLAIN_WORDS[s.responsibilities[0].state] ?? s.responsibilities[0].state}.</p>` : ''}
      <p>I cannot change anything. I have no permission to, and I have not asked for one.</p>
    </div>`;
  }

  if (key === 'okay') {
    return html`<div class="answer">
      <p>${s.routinesFailing.length === 0 && drifted.length === 0
    ? 'Yes. Everything I run is running, and everything I watch still matches.'
    : 'Not entirely.'}</p>
      ${s.routinesFailing.length ? html`<p>These have stopped:
        ${s.routinesFailing.join(', ')}.</p>` : ''}
      ${drifted.length ? html`<p>${drifted.map((d) => checkLine(d)).join(', ')} —
        out of step. I have not changed anything; I only look.</p>` : ''}
      <p class="faint">${count(s.routinesHealthy, 'routine')} healthy ·
        ${count(held.length, 'check')} matching · $${s.spent30d.toFixed(2)} spent</p>
    </div>`;
  }

  if (key === 'responsibility') {
    return html`${responsibilityOffer(s)}`;
  }

  return html`<div class="answer">
    <p>I cannot answer that one yet. Right now I can genuinely answer these:</p>
    <p>${Object.values(ANSWERABLE).join(' · ')}</p>
    <p class="faint">I would rather say so than improvise something that sounds right.</p>
  </div>`;
}

/** The current real responsibility, as the one decision it actually is. */
function responsibilityOffer(s: OwnerState): HtmlEscapedString | Promise<HtmlEscapedString> {
  const candidate = s.pendingCandidates[0];
  const existing = s.responsibilities[0];
  const check = existing?.check ?? 'schema-snapshot-freshness';
  const plain = CHECK_IN_PLAIN_WORDS[check];

  if (candidate) {
    return html`<div class="card">
      <div class="card-in">
        <p class="kind">Something I would like to take on</p>
        <h2>${plain?.name ?? candidate.proposal}</h2>
        <p class="muted">${plain?.why ?? ''}</p>
        <p class="muted">For now I only want to treat this as a real responsibility and keep
          watching it. It does not let me change anything.</p>
      </div>
      <dl class="facts">
        <dt>Your time</dt><dd>One tap</dd>
        <dt>Cost</dt><dd>$0</dd>
        <dt>Reversible</dt><dd>Yes</dd>
      </dl>
      <details><summary>Why?</summary><div class="in">
        <p>I run this check on myself every six hours and record what I find. Recognising it
          says the upkeep is genuinely mine to worry about — it does not give me permission
          to do anything about it. That would be a separate decision, later, with a time limit.</p>
      </div></details>
      <details><summary>Technical details</summary><div class="in">
        <p class="tech">${candidate.proposal}<br />check ${check}<br />
          capability development · candidate ${candidate.id}</p>
      </div></details>
      <div class="acts">
        <form method="POST" action="/letter/responsibility-candidates/${candidate.id}/promote">
          <button class="btn btn-primary" type="submit">Yes, that is mine</button>
        </form>
        <form method="POST" action="/letter/responsibility-candidates/${candidate.id}/reject">
          <input type="hidden" name="reason" value="Not something Foundry should carry" />
          <button class="btn" type="submit">Not now</button>
        </form>
      </div>
    </div>`;
  }

  if (existing) {
    return html`<div class="card">
      <div class="card-in">
        <p class="kind">One of my responsibilities</p>
        <h2>${plain?.name ?? existing.title}</h2>
        <p class="muted">${plain?.why ?? ''}</p>
        <p class="muted">Where this stands: <strong>${LADDER_IN_PLAIN_WORDS[existing.state] ?? existing.state}</strong>.
          I am not allowed to change anything about it, and I have not asked to be.</p>
      </div>
      <details><summary>Technical details</summary><div class="in">
        <p class="tech">${existing.title}<br />state ${existing.state} ·
          capability development<br />${existing.id}</p>
      </div></details>
    </div>`;
  }

  return html`<div class="answer"><p>I have not found anything I could take on yet.</p></div>`;
}

// ─── routes ─────────────────────────────────────────────────────────────────

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function context(c: any): Promise<OwnerState | null> {
  const founder = c.get('founder') as { id?: string; name?: string; email?: string } | undefined;
  if (!founder?.id) return null;
  const productId = await selectedProductId(c, String(founder.id));
  if (!productId) return null;
  const state = await readOwnerState(productId, String(founder.name ?? founder.email ?? ''));
  return state;
}

foundryShellRoutes.get('/foundry', async (c) => {
  const s = await context(c);
  if (!s) return c.redirect('/onboarding');

  const asked = String(c.req.query('ask') ?? '').trim();
  const typed = String(c.req.query('q') ?? '').trim();
  const key = asked || (typed ? matchQuestion(typed) : '');
  const needs = needsOwner(s);
  const drifted = s.checks.filter((ch) => ch.result === 'failed');

  const body = html`
    <h1><span id="greet">Hello</span>, ${s.greetingName}.</h1>

    <div class="rows">
      <div class="row"><span class="pip ${s.routinesFailing.length ? 'warn' : 'good'}">●</span>
        <p>${s.routinesFailing.length > 0
    ? html`<strong>${count(s.routinesFailing.length, 'routine')} of mine have stopped.</strong>`
    : s.routinesHealthy === 0
      ? html`I have not run anything yet.`
      : html`Everything I run is <strong>running normally</strong> — ${count(s.routinesHealthy, 'routine')}.`}</p></div>
      ${s.checks.length ? html`<div class="row"><span class="pip ${drifted.length ? 'warn' : 'good'}">●</span>
        <p>${drifted.length === 0
    ? html`I check <strong>${count(s.checks.length, 'thing')}</strong> about myself. All still accurate.`
    : html`<strong>${count(drifted.length, 'thing')} I keep</strong> ${drifted.length === 1 ? 'has' : 'have'} gone out of step.`}</p></div>` : ''}
      <div class="row"><span class="pip good">●</span>
        <p>I have spent <strong>$${s.spent30d.toFixed(2)}</strong> of your $${String(s.budgetMonthly)} this month.</p></div>
    </div>

    ${needs.length === 0
    ? html`<div class="settled">Nothing needs you.</div>`
    : html`<div class="settled">${needs.length === 1 ? 'One thing needs you' : `${String(needs.length)} things need you`}. Everything else is fine.</div>`}

    ${key ? html`<div class="said"><div class="who">You asked</div>${typed || ANSWERABLE[key] || asked}</div>${answer(key, s)}`
    : needs.length ? responsibilityOffer(s) : ''}

    <div class="chips">
      ${raw(Object.entries(ANSWERABLE).map(([k, label]) =>
    `<a class="chip" href="/foundry?ask=${k}">${label}</a>`).join(''))}
    </div>`;

  return c.html(shell('Foundry', 'foundry', body));
});

/** Words to one of the questions this surface can genuinely answer. */
function matchQuestion(text: string): string {
  const t = text.toLowerCase();
  if (/(need|want).*(me|you)|anything for me/.test(t)) return 'needs';
  if (/today|happened|since|yesterday/.test(t)) return 'today';
  if (/working on|doing|busy|up to/.test(t)) return 'working';
  if (/okay|ok\b|alright|health|wrong|broken/.test(t)) return 'okay';
  if (/responsib|upkeep|task|job/.test(t)) return 'responsibility';
  if (/why/.test(t)) return 'why';
  return 'unknown';
}

foundryShellRoutes.get('/foundry/portfolio', async (c) => {
  const s = await context(c);
  if (!s) return c.redirect('/onboarding');

  const body = html`
    <h1>Your companies</h1>
    <div class="card">
      <div class="card-in">
        <p class="kind">You own it</p>
        <h2>${s.companyName}</h2>
        <p class="muted">${s.senses.length === 0
    ? 'I can watch my own workings. I cannot see money, customers or code history — nothing is connected yet.'
    : `I can see ${s.senses.join(', ')}.`}</p>
      </div>
      <dl class="facts">
        <dt>Established</dt><dd>${s.establishedAt ?? 'unknown'}</dd>
        <dt>Costing you</dt><dd>$${s.spent30d.toFixed(2)} this month</dd>
        <dt>Budget</dt><dd>$${String(s.budgetMonthly)} a month</dd>
        <dt>Needs you</dt><dd>${needsOwner(s).length === 0 ? 'Nothing' : 'One thing'}</dd>
      </dl>
    </div>
    <p class="faint">This is the only company you have given me. When there is another, it
      appears here as a context to switch into — not as another set of screens.</p>`;

  return c.html(shell('Portfolio', 'portfolio', body));
});

foundryShellRoutes.get('/foundry/controls', async (c) => {
  const s = await context(c);
  if (!s) return c.redirect('/onboarding');

  const permitted = (await query(
    `SELECT COUNT(*) AS n FROM autonomy_consents
      WHERE product_id = ? AND revoked_at IS NULL AND datetime(expires_at) > datetime('now')`,
    [s.productId])).rows[0] as Record<string, unknown>;
  const live = Number(permitted?.n ?? 0);

  const body = html`
    <h1>What I am allowed to do</h1>

    <div class="card">
      <div class="card-in">
        <p class="kind">Authority</p>
        <h2>${live === 0 ? 'Nothing, right now' : `${String(live)} standing permission(s)`}</h2>
        <p class="muted">${live === 0
    ? html`I can look at things and tell you what I find. I cannot change anything, spend
        anything, or contact anyone. Each of those needs a separate permission from you, with
        a time limit, and you can withdraw it here.`
    : html`Each one names what I may do, for how long, and expires on its own.`}</p>
      </div>
      ${live > 0 ? html`<div class="acts"><a class="btn" href="/autopilot">Review and withdraw</a></div>` : ''}
    </div>

    <div class="card">
      <div class="card-in">
        <p class="kind">Money</p>
        <h2>$${s.spent30d.toFixed(2)} spent of $${String(s.budgetMonthly)}</h2>
        <p class="muted">The work I do on myself costs nothing — comparing my own records
          uses no thinking, just reading.</p>
      </div>
      <dl class="facts">
        <dt>This company</dt><dd>$2 a day at most</dd>
        <dt>Everything</dt><dd>$5 a day at most</dd>
      </dl>
    </div>

    <div class="card">
      <div class="card-in">
        <p class="kind">Hard stop</p>
        <h2>Stop everything</h2>
        <p class="muted">Halts every routine, permission and outbound action at once.
          Nothing is lost — I simply stop acting.</p>
      </div>
      <div class="acts"><a class="btn" href="/autopilot">Go to the stop</a></div>
    </div>

    <div class="card">
      <div class="card-in">
        <p class="kind">Connected senses</p>
        <h2>${s.senses.length === 0 ? 'None yet' : s.senses.join(', ')}</h2>
        <p class="muted">${s.senses.length === 0
    ? 'I can only see my own workings. Letting me read a company\'s code, or its payments, is how I learn more — and reading is never permission to change anything.'
    : 'Reading is not permission to change anything.'}</p>
      </div>
    </div>`;

  return c.html(shell('Controls', 'controls', body));
});
