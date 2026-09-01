// =============================================================================
// FOUNDRY — the owner's surface
//
// A COMPOSITION LAYER, NOT A SECOND INSTITUTION. Every figure here is read
// through the services the rest of the product uses, and every action posts to
// routes that already existed. Nothing about responsibility, authority,
// evidence or spend is decided in this file. It decides one thing: what a
// person meets first.
//
// WHAT THIS IS NOT, AND WAS. The first version had three tabs, four status
// lines, a card and six suggestion chips. That is a dashboard with a chat box —
// every element true, none of them what the owner came for. The subtraction
// test settled it: remove the routine count and nothing breaks; remove a spend
// line reading zero and nothing breaks; remove Portfolio while one company
// exists and nothing breaks; remove six chips advertising a prompt library and
// nothing breaks. What cannot be removed is the thing that needs him, and the
// ability to say anything at all.
//
// So: ONE surface. One sentence of orientation, one obvious thing when there is
// one, and a composer. Portfolio and Controls were not moved anywhere — they
// stopped being places and became answers, because with one company and no
// standing permission each was a room containing a sentence. They earn space
// again when there is a second company, or a permission to withdraw: a live
// grant is read on every request and shown where it can be taken back.
//
// PHONE FIRST, AND MEASURED. `scripts/measure-mobile.mts` renders this in a real
// browser at 375/390/393/414/430 CSS px and at 200% text, and fails if the
// document is a pixel wider than the window. The owner found the first
// prototype overflowing on his iPhone; measurement replaced opinion.
// =============================================================================

import { Hono } from 'hono';
import { html, raw } from 'hono/html';
import type { HtmlEscapedString } from 'hono/utils/html';
import { query } from '../../db/client.js';
import { selectedProductId } from './_shared.js';

export const foundryShellRoutes = new Hono();

// ─── the owner's words ──────────────────────────────────────────────────────

/**
 * What a check is, said to the person who did not name it.
 *
 * A check with no entry degrades to its own identifier: visibly unnamed, which
 * is honest, rather than a confident sentence invented for it.
 */
const CHECK_IN_PLAIN_WORDS: Record<string, { name: string; why: string }> = {
  'schema-snapshot-freshness': {
    name: 'Keep my internal map accurate',
    why: 'When I change how I store information, my own reference to it has to change '
      + 'too. If it does not, I end up wrong about my own workings.',
  },
  'ratchet-baseline-liveness': {
    name: 'Keep my list of known exceptions honest',
    why: 'I keep a list of small imperfections I have agreed to overlook. When the '
      + 'thing one of them points at stops existing, the excuse outlives it.',
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

/** "1 thing" / "2 things". "2 thing(s)" is machinery showing through. */
function count(n: number, singular: string, plural = singular + 's'): string {
  return `${n} ${n === 1 ? singular : plural}`;
}

// ─── state ──────────────────────────────────────────────────────────────────

interface OwnerState {
  productId: string;
  companyName: string;
  firstName: string;
  routinesHealthy: number;
  routinesFailing: string[];
  checks: Array<{ check: string; result: string; detail: string; observedAt: string }>;
  responsibilities: Array<{ id: string; title: string; state: string; check: string | null }>;
  pendingCandidates: Array<{ id: string; proposal: string; check: string | null }>;
  permissions: Array<{ what: string; until: string }>;
  budgetMonthly: number;
  spent30d: number;
  connectedSenses: string[];
  establishedAt: string | null;
}

async function readOwnerState(productId: string, founderName: string): Promise<OwnerState> {
  const product = (await query(
    `SELECT name, created_at, operating_budget_monthly_usd, ai_cost_trailing_30d_usd, github_repo_url
       FROM products WHERE id = ?`, [productId])).rows[0] as Record<string, unknown> | undefined;

  const { getSelfCheckStanding } = await import(
    '../../services/institution/development-observation.js');
  const { getPendingResponsibilityCandidates } = await import(
    '../../services/institution/responsibility-candidate.js');

  const checks = await getSelfCheckStanding(productId);
  const candidates = await getPendingResponsibilityCandidates(productId);

  // A responsibility's own check, read from the evidence that created it, so one
  // name follows the thing from noticing through to permission.
  const responsibilities = (await query(
    `SELECT r.id, r.title, r.state, json_extract(e.payload_json,'$.check') AS check_name
       FROM institutional_responsibilities r
       LEFT JOIN signal_events e ON ('signal_event:' || e.id) = r.discovery_evidence_ref
        AND e.product_id = r.product_id
      WHERE r.product_id = ? AND r.disposition = 'active'
      ORDER BY r.created_at`, [productId])).rows as unknown as Array<Record<string, unknown>>;

  const health = (await query(
    'SELECT COUNT(*) AS n FROM job_health WHERE last_success_at IS NOT NULL', []))
    .rows[0] as Record<string, unknown>;
  const failing = (await query(
    'SELECT job_name FROM job_health WHERE consecutive_failures > 0 ORDER BY job_name', []))
    .rows as unknown as Array<Record<string, unknown>>;

  // A live permission is the one control that must never be hard to find, so it
  // is read on every request rather than kept behind a door.
  const consents = (await query(
    `SELECT capability, expires_at FROM autonomy_consents
      WHERE product_id = ? AND revoked_at IS NULL AND datetime(expires_at) > datetime('now')
      ORDER BY expires_at`, [productId])).rows as unknown as Array<Record<string, unknown>>;

  const candidateChecks = new Map<string, string>();
  for (const candidate of candidates) {
    const evidence = candidate.evidenceRefs.find((r) => r.kind === 'signal_event');
    if (!evidence) continue;
    const row = (await query(
      "SELECT json_extract(payload_json,'$.check') AS c FROM signal_events WHERE id = ?",
      [evidence.id])).rows[0] as Record<string, unknown> | undefined;
    if (row?.c) candidateChecks.set(candidate.id, String(row.c));
  }

  return {
    productId,
    companyName: String(product?.name ?? 'this company'),
    firstName: founderName.split(' ')[0] || '',
    routinesHealthy: Number(health?.n ?? 0),
    routinesFailing: failing.map((r) => String(r.job_name)),
    checks,
    responsibilities: responsibilities.map((r) => ({
      id: String(r.id), title: String(r.title), state: String(r.state),
      check: r.check_name == null ? null : String(r.check_name),
    })),
    pendingCandidates: candidates.map((candidate) => ({
      id: candidate.id, proposal: candidate.proposedResponsibility,
      check: candidateChecks.get(candidate.id) ?? null,
    })),
    permissions: consents.map((consent) => ({
      what: String(consent.capability), until: String(consent.expires_at).slice(0, 10),
    })),
    budgetMonthly: Number(product?.operating_budget_monthly_usd ?? 0),
    spent30d: Number(product?.ai_cost_trailing_30d_usd ?? 0),
    connectedSenses: product?.github_repo_url ? ['its code'] : [],
    establishedAt: product?.created_at == null ? null : String(product.created_at).slice(0, 10),
  };
}

/**
 * The one thing, if there is one.
 *
 * Deliberately returns at most ONE. A page listing three equally weighted
 * concerns has made the owner decide which matters, which is precisely the work
 * the institution exists to absorb.
 */
type Attention =
  | { kind: 'recognise'; candidateId: string; check: string | null; proposal: string }
  | { kind: 'expect'; responsibilityId: string; check: string; title: string }
  | { kind: 'stopped'; routines: string[] }
  | { kind: 'drifted'; checks: string[] }
  | null;

function whatNeedsHim(s: OwnerState): Attention {
  // Broken outranks offered: a stopped routine means the rest of this page may
  // be out of date, and he should learn that before anything else.
  if (s.routinesFailing.length) return { kind: 'stopped', routines: s.routinesFailing };
  const drifted = s.checks.filter((c) => c.result === 'failed');
  if (drifted.length) return { kind: 'drifted', checks: drifted.map((d) => d.check) };
  const candidate = s.pendingCandidates[0];
  if (candidate) {
    return {
      kind: 'recognise', candidateId: candidate.id,
      check: candidate.check, proposal: candidate.proposal,
    };
  }
  const ready = s.responsibilities.find((r) => r.state === 'understood' && r.check !== null);
  if (ready) {
    return {
      kind: 'expect', responsibilityId: ready.id,
      check: String(ready.check), title: ready.title,
    };
  }
  return null;
}

// ─── one visual system ──────────────────────────────────────────────────────

const page = (title: string, body: HtmlEscapedString | Promise<HtmlEscapedString>,
) => html`<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
<title>${title}</title>
<style>
  /* One family, one scale, one accent. Colour carries meaning or it is absent. */
  :root{
    --bg:#F2F3F0; --card:#FFFFFF; --line:#E0E4DC;
    --ink:#151C18; --ink-2:#5A645C; --ink-3:#8B948C;
    --accent:#256454; --accent-ink:#FFFFFF;
    --alert:#96601A;
    --s1:6px; --s2:12px; --s3:18px; --s4:28px; --s5:44px;
    --r:16px;
  }
  @media (prefers-color-scheme:dark){:root:not([data-theme="light"]){
    --bg:#0E1512; --card:#171F1B; --line:#25302A;
    --ink:#E8EDE8; --ink-2:#A6B0A8; --ink-3:#7A847C;
    --accent:#74BFA9; --accent-ink:#0C1512;
    --alert:#D6A75E;
  }}
  *,*::before,*::after{box-sizing:border-box}
  html,body{max-width:100%;overflow-x:hidden}
  body{
    margin:0;background:var(--bg);color:var(--ink);
    font:400 17px/1.5 ui-sans-serif,system-ui,-apple-system,"Segoe UI",sans-serif;
    -webkit-text-size-adjust:100%;-webkit-font-smoothing:antialiased;
  }
  .wrap{max-width:34rem;margin:0 auto;padding:var(--s4) var(--s3) 8.5rem}
  h1{font-size:1.55rem;line-height:1.2;font-weight:600;letter-spacing:-.015em;margin:0 0 var(--s2)}
  p{margin:0 0 var(--s2);overflow-wrap:anywhere}
  .lede{color:var(--ink-2);font-size:1.06rem;margin-bottom:var(--s4)}

  /* The one thing. There is never more than one of these on the page. */
  .one{background:var(--card);border:1px solid var(--line);border-radius:var(--r);
    margin:0 0 var(--s4);overflow:hidden}
  .one.alert{border-color:var(--alert)}
  .one-in{padding:var(--s3)}
  .one h2{font-size:1.2rem;line-height:1.3;font-weight:600;margin:0 0 var(--s2);letter-spacing:-.01em}
  .one p{color:var(--ink-2);font-size:.98rem}
  .one p:last-child{margin-bottom:0}
  .lead{color:var(--ink)}
  dl{display:grid;grid-template-columns:auto minmax(0,1fr);gap:var(--s1) var(--s3);
    margin:0;padding:var(--s2) var(--s3);border-top:1px solid var(--line);font-size:.93rem}
  dt{color:var(--ink-3)}
  dd{margin:0;min-width:0;overflow-wrap:anywhere}
  .do{padding:var(--s3);border-top:1px solid var(--line);display:flex;flex-wrap:wrap;gap:var(--s2)}
  .do form{flex:1 1 auto;min-width:0}
  .btn{font:inherit;font-size:1rem;font-weight:500;cursor:pointer;text-decoration:none;width:100%;
    display:inline-flex;align-items:center;justify-content:center;
    border-radius:12px;padding:13px 20px;min-height:48px;
    border:1px solid var(--line);background:var(--card);color:var(--ink)}
  .btn.go{background:var(--accent);border-color:var(--accent);color:var(--accent-ink)}
  .btn:focus-visible{outline:2px solid var(--accent);outline-offset:2px}
  .btn:active{transform:translateY(1px)}
  @media (prefers-reduced-motion:reduce){.btn:active{transform:none}}

  details{border-top:1px solid var(--line)}
  summary{cursor:pointer;list-style:none;padding:var(--s2) var(--s3);min-height:48px;
    display:flex;align-items:center;justify-content:space-between;gap:var(--s2);
    font-size:.93rem;color:var(--ink-2)}
  summary::-webkit-details-marker{display:none}
  summary::after{content:"+";color:var(--ink-3);font-size:1.1rem}
  details[open] summary::after{content:"\\2212"}
  .inner{padding:0 var(--s3) var(--s3);font-size:.93rem;color:var(--ink-2)}
  .mono{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:.8rem;
    color:var(--ink-3);overflow-wrap:anywhere}

  /* A question and its answer read as an exchange, not as more cards. */
  .asked{color:var(--ink-3);font-size:.93rem;margin:var(--s4) 0 var(--s1)}
  .said{font-size:1.02rem;margin:0 0 var(--s4)}
  .said p{margin:0 0 var(--s2)}
  .said p:last-child{margin-bottom:0}
  .said ul{margin:0 0 var(--s2);padding-left:1.1rem;color:var(--ink-2)}
  .said li{margin:0 0 var(--s1)}
  .said a{color:var(--accent)}

  .maybe{display:flex;flex-wrap:wrap;gap:var(--s2)}
  .maybe a{font-size:.93rem;text-decoration:none;color:var(--ink-2);
    border:1px solid var(--line);border-radius:999px;padding:10px 15px;min-height:44px;
    display:inline-flex;align-items:center}
  .maybe a:focus-visible{outline:2px solid var(--accent);outline-offset:2px}

  .ask{position:fixed;left:0;right:0;bottom:0;background:var(--bg);
    border-top:1px solid var(--line);
    padding:var(--s2) var(--s3) calc(var(--s2) + env(safe-area-inset-bottom))}
  .ask-in{max-width:34rem;margin:0 auto;display:flex;gap:var(--s2)}
  .ask input{flex:1;min-width:0;font:inherit;font-size:16px;padding:13px 15px;min-height:48px;
    border:1px solid var(--line);border-radius:12px;background:var(--card);color:var(--ink)}
  .ask input:focus-visible{outline:2px solid var(--accent);outline-offset:1px}
  .ask button{font:inherit;font-size:1rem;font-weight:500;border:0;border-radius:12px;
    padding:0 18px;min-height:48px;background:var(--accent);color:var(--accent-ink);cursor:pointer}
  .ask button:focus-visible{outline:2px solid var(--ink);outline-offset:2px}
  .sr{position:absolute;width:1px;height:1px;padding:0;margin:-1px;overflow:hidden;
    clip:rect(0,0,0,0);white-space:nowrap;border:0}

  footer{margin-top:var(--s5);padding-top:var(--s3);border-top:1px solid var(--line)}
  footer a{color:var(--ink-3);font-size:.85rem;text-decoration:none}
  footer a:hover,footer a:focus-visible{text-decoration:underline}
</style>
</head>
<body>
<main class="wrap">
${body}
<footer><a href="/letter">Advanced — inspect the system</a></footer>
</main>
<form class="ask" method="GET" action="/foundry">
  <div class="ask-in">
    <label for="q" class="sr">Ask Foundry anything</label>
    <input id="q" name="q" placeholder="Ask Foundry anything…" autocomplete="off" />
    <button type="submit">Ask</button>
  </div>
</form>
<script>
  // The time of day belongs to the reader, not the server: this said "good
  // morning" at eleven at night, because the machine runs in UTC.
  (function(){var e=document.getElementById('greet');if(!e)return;var h=new Date().getHours();
    e.textContent=h<12?'Good morning':h<18?'Good afternoon':'Good evening';})();
</script>
</body>
</html>`;

// ─── the one thing, rendered ────────────────────────────────────────────────

function theOneThing(a: Attention): HtmlEscapedString | Promise<HtmlEscapedString> {
  if (a === null) return html``;

  if (a.kind === 'stopped') {
    return html`<div class="one alert">
      <div class="one-in">
        <h2>Part of me has stopped running</h2>
        <p class="lead">${count(a.routines.length, 'routine')} of mine
          ${a.routines.length === 1 ? 'has' : 'have'} failed, so what I tell you may be out
          of date. Nothing is lost.</p>
      </div>
      <details><summary>Technical details</summary><div class="inner">
        <p class="mono">${a.routines.join(', ')}</p>
      </div></details>
    </div>`;
  }

  if (a.kind === 'drifted') {
    const name = CHECK_IN_PLAIN_WORDS[a.checks[0]]?.name ?? a.checks[0];
    return html`<div class="one alert">
      <div class="one-in">
        <h2>${name}</h2>
        <p class="lead">This no longer matches. I have not changed anything — I only look.</p>
      </div>
    </div>`;
  }

  if (a.kind === 'recognise') {
    const plain = a.check ? CHECK_IN_PLAIN_WORDS[a.check] : undefined;
    return html`<div class="one">
      <div class="one-in">
        <h2>${plain?.name ?? a.proposal}</h2>
        <p class="lead">${plain?.why ?? ''}</p>
        <p>I noticed this about myself and I would like to look after it.</p>
      </div>
      <dl>
        <dt>If you agree</dt><dd>I start watching it</dd>
        <dt>Cost</dt><dd>Nothing</dd>
        <dt>Undo</dt><dd>Any time</dd>
      </dl>
      <div class="do">
        <form method="POST" action="/letter/responsibility-candidates/${a.candidateId}/promote">
          <button class="btn go" type="submit">Yes, look after it</button>
        </form>
        <form method="POST" action="/letter/responsibility-candidates/${a.candidateId}/reject"
          style="flex:0 0 auto">
          <input type="hidden" name="reason" value="Not something Foundry should look after" />
          <button class="btn" type="submit" style="width:auto">No</button>
        </form>
      </div>
      <details><summary>Technical details</summary><div class="inner">
        <p class="mono">${a.proposal}<br />check ${a.check ?? 'unknown'} · capability development
          <br />candidate ${a.candidateId}</p>
      </div></details>
    </div>`;
  }

  const plain = CHECK_IN_PLAIN_WORDS[a.check];
  return html`<div class="one">
    <div class="one-in">
      <h2>${plain?.name ?? a.title}</h2>
      <p class="lead">I understand this well enough to be measured on it. If I am looking
        after it properly, my check on it should keep passing.</p>
      <p>I still cannot change anything.</p>
    </div>
    <dl>
      <dt>If you agree</dt><dd>I am scored on it from now on</dd>
      <dt>Cost</dt><dd>Nothing</dd>
      <dt>Undo</dt><dd>Any time</dd>
    </dl>
    <div class="do">
      <form method="POST" action="/letter/responsibilities/${a.responsibilityId}/watch-check">
        <input type="hidden" name="check" value="${a.check}" />
        <input type="hidden" name="expected_result" value="passed" />
        <button class="btn go" type="submit">Hold me to that</button>
      </form>
    </div>
    <details><summary>Technical details</summary><div class="inner">
      <p class="mono">${a.title}<br />check ${a.check} · development · understood
        <br />${a.responsibilityId}</p>
    </div></details>
  </div>`;
}

// ─── answers, from state ────────────────────────────────────────────────────

const QUESTIONS: Record<string, string> = {
  okay: 'Are you okay?',
  working: 'What are you working on?',
  companies: 'What do I own?',
  allowed: 'What are you allowed to do?',
  today: 'What happened today?',
  needs: 'What needs me?',
};

function matchQuestion(text: string): string {
  const t = text.toLowerCase();
  if (/\b(okay|ok|alright|fine|health|wrong|broken|problem)\b/.test(t)) return 'okay';
  if (/working on|doing|busy|up to|watching/.test(t)) return 'working';
  if (/own|compan|portfolio|business/.test(t)) return 'companies';
  if (/allow|permission|authority|can you|able to|spend|budget|money|cost/.test(t)) return 'allowed';
  if (/today|happen|since|yesterday|new/.test(t)) return 'today';
  if (/need|want|from me|should i/.test(t)) return 'needs';
  if (/responsib|upkeep|map|look after/.test(t)) return 'working';
  return 'unknown';
}

function answerTo(key: string, s: OwnerState, a: Attention,
): HtmlEscapedString | Promise<HtmlEscapedString> {
  const drifted = s.checks.filter((c) => c.result === 'failed');

  if (key === 'okay') {
    const well = s.routinesFailing.length === 0 && drifted.length === 0;
    return html`<div class="said">
      <p>${well ? 'Yes.' : 'Not entirely.'}</p>
      ${s.routinesFailing.length ? html`<p>${count(s.routinesFailing.length, 'routine')} of mine
        ${s.routinesFailing.length === 1 ? 'has' : 'have'} stopped, so some of what I tell you
        may be out of date.</p>` : ''}
      ${drifted.length ? html`<p>${drifted.map((d) => CHECK_IN_PLAIN_WORDS[d.check]?.name
    ?? d.check).join(', ')} no longer matches.</p>` : ''}
      ${well ? html`<p>${s.routinesHealthy === 0
    ? 'I have not run anything yet, so there is not much to go on.'
    : html`Everything I run is running${s.checks.length
      ? ', and everything I watch still matches' : ''}.`}</p>` : ''}
    </div>`;
  }

  if (key === 'working') {
    return html`<div class="said">
      ${s.checks.length === 0
    ? html`<p>Nothing yet. I can only see my own workings, and nobody has asked me to look
        after anything.</p>`
    : html`<p>I watch these, and record what I find:</p>
      <ul>${raw(s.checks.map((c) => `<li>${CHECK_IN_PLAIN_WORDS[c.check]?.name ?? c.check} — `
      + `${c.result === 'passed' ? 'still accurate' : 'out of step'}</li>`).join(''))}</ul>`}
      ${s.responsibilities.length ? html`<p>You have agreed that
        ${s.responsibilities.length === 1 ? 'one of them is' : `${String(s.responsibilities.length)} of them are`}
        mine to look after. Where that stands:
        ${LADDER_IN_PLAIN_WORDS[s.responsibilities[0].state] ?? s.responsibilities[0].state}.</p>` : ''}
      <p>I cannot change anything, and I have not asked to.</p>
    </div>`;
  }

  if (key === 'companies') {
    return html`<div class="said">
      <p>One: <strong>${s.companyName}</strong>, since ${s.establishedAt ?? 'recently'}.</p>
      <p>${s.connectedSenses.length === 0
    ? 'I can watch my own workings. I cannot see money, customers or code history — you have not connected anything.'
    : `I can see ${s.connectedSenses.join(', ')}.`}</p>
      <p>When there is a second one I will keep them apart and tell you which deserves your
        attention. There is no point pretending to compare one.</p>
    </div>`;
  }

  if (key === 'allowed') {
    return html`<div class="said">
      ${s.permissions.length === 0
    ? html`<p><strong>Nothing.</strong> I can look, and I can tell you what I find. I cannot
        change anything, spend anything, or contact anyone.</p>
      <p>Each of those would be something you allow separately, for a set time, and could take
        back whenever you wanted.</p>`
    : html`<p>${raw(s.permissions.map((p) => `I may ${p.what}, until ${p.until}.`).join(' '))}</p>
      <p><a href="/autopilot">Take that back</a></p>`}
      <p>${s.spent30d === 0
    ? html`I have spent nothing. Your limit is $${String(s.budgetMonthly)} a month.`
    : html`I have spent $${s.spent30d.toFixed(2)} of your $${String(s.budgetMonthly)} this month.`}</p>
    </div>`;
  }

  if (key === 'today') {
    return html`<div class="said">
      <p>${s.routinesFailing.length > 0
    ? html`${count(s.routinesFailing.length, 'routine')} of mine stopped.`
    : s.routinesHealthy === 0 ? html`I have not run anything yet.`
      : html`I ran ${count(s.routinesHealthy, 'routine')} and none failed.`}</p>
      ${s.checks.length ? html`<p>I checked ${count(s.checks.length, 'thing')} about myself.
        ${drifted.length === 0 ? 'All of them still match.'
    : `${count(drifted.length, 'thing')} went out of step.`}</p>` : ''}
      ${a === null ? html`<p>Nothing that needs you.</p>` : ''}
    </div>`;
  }

  if (key === 'needs') {
    return a === null
      ? html`<div class="said"><p>Nothing. I will tell you the moment that changes.</p></div>`
      : html`<div class="said"><p>The one thing above.</p></div>`;
  }

  return html`<div class="said">
    <p>I don't know yet. I can tell you how I am, what I am watching, what you own, what I am
      allowed to do, and what happened today.</p>
    <p>I would rather say that than make something up.</p>
  </div>`;
}

// ─── the surface ────────────────────────────────────────────────────────────

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function context(c: any): Promise<OwnerState | null> {
  const founder = c.get('founder') as { id?: string; name?: string; email?: string } | undefined;
  if (!founder?.id) return null;
  const productId = await selectedProductId(c, String(founder.id));
  if (!productId) return null;
  return readOwnerState(productId, String(founder.name ?? founder.email ?? ''));
}

foundryShellRoutes.get('/foundry', async (c) => {
  let s: OwnerState | null;
  try {
    s = await context(c);
  } catch {
    // A FAILURE IS STILL AN ANSWER. He should never meet a stack trace, and
    // never be left unsure whether something of his broke.
    return c.html(page('Foundry', html`
      <h1>I can't reach my own records</h1>
      <p class="lede">Nothing of yours has changed and nothing is lost. Try again in a moment.</p>`),
    503);
  }
  if (!s) return c.redirect('/onboarding');

  const asked = String(c.req.query('ask') ?? '').trim();
  const typed = String(c.req.query('q') ?? '').trim();
  const key = asked || (typed ? matchQuestion(typed) : '');
  const attention = whatNeedsHim(s);

  // ORIENTATION IS ONE SENTENCE. Not four green bullets: a routine count and a
  // spend of zero are true, measurable, and not why he opened this.
  const orientation = attention === null
    ? (s.routinesHealthy === 0 && s.checks.length === 0
      ? 'I am set up, and I have not learned anything about you yet.'
      : 'Everything is fine. Nothing needs you.')
    : attention.kind === 'stopped' || attention.kind === 'drifted'
      ? 'Something needs looking at.'
      : 'One thing needs you.';

  const body = html`
    <h1><span id="greet">Hello</span>${s.firstName ? `, ${s.firstName}` : ''}.</h1>
    <p class="lede">${orientation}</p>

    ${theOneThing(attention)}

    ${key ? html`<p class="asked">${typed || QUESTIONS[key] || asked}</p>
      ${answerTo(key, s, attention)}` : ''}

    ${!key && attention === null ? html`<div class="maybe">
      ${raw(['okay', 'working'].map((k) =>
    `<a href="/foundry?ask=${k}">${QUESTIONS[k]}</a>`).join(''))}
    </div>` : ''}`;

  return c.html(page('Foundry', body));
});
