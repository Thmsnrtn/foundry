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
import { requireInstitutionOwner } from '../../middleware/rbac.js';

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
  permissions: Array<{ id: string; what: string; until: string; path: string | null }>;
  declined: Array<{ id: string; title: string }>;
  grantable: Array<{ responsibilityId: string; title: string; check: string;
    path: string; verification: string[]; matched: number; wrong: number }>;
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
    `SELECT id, capability, expires_at, allowed_path_prefixes_json FROM autonomy_consents
      WHERE product_id = ? AND revoked_at IS NULL AND datetime(expires_at) > datetime('now')
      ORDER BY expires_at`, [productId])).rows as unknown as Array<Record<string, unknown>>;

  // What he turned down, so refusal is reversible rather than a dead end. The
  // database always allowed reconsidering; nothing ever offered it.
  const declined = (await query(
    `SELECT id, proposed_responsibility FROM responsibility_candidates
      WHERE product_id = ? AND status = 'rejected' ORDER BY updated_at DESC LIMIT 5`,
    [productId])).rows as unknown as Array<Record<string, unknown>>;

  // What Foundry could be permitted to do, and the evidence it would be
  // permitted on. Read here so the authority request lives where he already is
  // rather than behind a door he no longer has.
  const { listGrantableDevelopmentResponsibilities } = await import(
    '../../services/institution/development-authority.js');
  const { SELF_MAINTENANCE_SCOPES } = await import(
    '../../services/foundry/self-observation.js');
  const offerable = await listGrantableDevelopmentResponsibilities(productId);
  const grantable: OwnerState['grantable'] = [];
  for (const g of offerable) {
    const scope = SELF_MAINTENANCE_SCOPES[g.check];
    if (!scope) continue;
    const seen = (await query(
      `SELECT c.classification, COUNT(*) AS n FROM responsibility_shadow_comparisons c
         JOIN responsibility_shadow_expectations x ON x.id = c.expectation_id
        WHERE x.responsibility_id = ? AND x.product_id = ?
        GROUP BY c.classification`, [g.responsibilityId, productId]))
      .rows as unknown as Array<Record<string, unknown>>;
    const of = (k: string) => Number(seen.find((r) => String(r.classification) === k)?.n ?? 0);
    grantable.push({
      responsibilityId: g.responsibilityId, title: g.title, check: g.check,
      path: scope.path, verification: scope.verification,
      matched: of('matched'), wrong: of('deviated'),
    });
  }

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
    permissions: consents.map((consent) => {
      let path: string | null = null;
      try {
        const paths = JSON.parse(String(consent.allowed_path_prefixes_json ?? '[]')) as string[];
        path = paths[0] ?? null;
      } catch { path = null; }
      return {
        id: String(consent.id), what: String(consent.capability),
        until: String(consent.expires_at).slice(0, 10), path,
      };
    }),
    grantable,
    declined: declined.map((d) => {
      const proposal = String(d.proposed_responsibility);
      const known = Object.values(CHECK_IN_PLAIN_WORDS).find((p) => proposal.includes('schema'));
      return { id: String(d.id), title: known?.name ?? proposal };
    }),
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
  | { kind: 'authorise'; responsibilityId: string; check: string; path: string;
      verification: string[]; matched: number; wrong: number }
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
  // AN EARNED PERMISSION REQUEST IS THE MOST CONSEQUENTIAL THING FOUNDRY EVER
  // PUTS TO HIM, so it comes before anything it is merely offering to notice.
  const grant = s.grantable.find((g) => !s.permissions.some((p) => p.what === 'development'));
  if (grant) {
    return {
      kind: 'authorise', responsibilityId: grant.responsibilityId, check: grant.check,
      path: grant.path, verification: grant.verification,
      matched: grant.matched, wrong: grant.wrong,
    };
  }
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

// THREE PLACES, BECAUSE PLACES WERE NEVER THE PROBLEM.
//
// The old product had thirty destinations and they were bad because they
// exposed MACHINERY — Ambient, Roster, Multi-Modal, Standing Orders. Reading
// "too technical" as "too much interface" was my error, and it left the owner
// with a chat box and nowhere to do anything. His companies, his money and what
// Foundry may do are his world, not the institution's internals, and each is
// worth being able to walk to.
type Place = 'foundry' | 'companies' | 'controls';

const page = (title: string, body: HtmlEscapedString | Promise<HtmlEscapedString>,
  active: Place = 'foundry',
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
  .one h2{font-size:1.2rem;line-height:1.3;font-weight:600;margin:0 0 var(--s1);letter-spacing:-.01em}
  .act{font-size:.7rem;letter-spacing:.13em;text-transform:uppercase;font-weight:700;
    color:var(--ink-3);margin:0 0 var(--s1)}
  .one .lead{font-size:1.02rem;margin:0 0 var(--s2)}
  .standing{background:var(--card);border:1px solid var(--accent);border-radius:var(--r);
    padding:var(--s3);margin:0 0 var(--s4);display:flex;flex-wrap:wrap;gap:var(--s2);
    align-items:center;justify-content:space-between}
  .standing>div{flex:1 1 12rem;min-width:0}
  .standing p{margin:0;color:var(--ink-2);font-size:.95rem}
  .standing .caveat{margin-top:var(--s2);color:var(--alert)}
  .standing strong{color:var(--ink)}
  .done{background:var(--card);border:1px solid var(--line);border-radius:var(--r);
    padding:var(--s3);margin:0 0 var(--s4)}
  .done p{color:var(--ink-2);font-size:.98rem}
  .done p:last-child{margin-bottom:0}
  .done strong{color:var(--ink)}
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

  nav.places{display:flex;gap:var(--s3);margin:0 0 var(--s4);border-bottom:1px solid var(--line)}
  nav.places a{text-decoration:none;color:var(--ink-3);font-size:.98rem;padding:0 0 var(--s2);
    border-bottom:2px solid transparent;margin-bottom:-1px}
  nav.places a.on{color:var(--ink);border-bottom-color:var(--accent);font-weight:600}
  nav.places a:focus-visible{outline:2px solid var(--accent);outline-offset:2px}
  .item{display:block;text-decoration:none;color:inherit;background:var(--card);
    border:1px solid var(--line);border-radius:var(--r);padding:var(--s3);margin:0 0 var(--s2)}
  .item:hover,.item:focus-visible{border-color:var(--ink-3);outline:none}
  .item h3{margin:0 0 var(--s1);font-size:1.08rem;font-weight:600}
  .item p{margin:0;color:var(--ink-2);font-size:.93rem}
  .know{margin:0 0 var(--s4)}
  .know h3{font-size:.72rem;letter-spacing:.12em;text-transform:uppercase;color:var(--ink-3);
    font-weight:700;margin:0 0 var(--s2)}
  .know ul{margin:0;padding-left:1.1rem;color:var(--ink-2);font-size:.97rem}
  .know li{margin:0 0 var(--s1)}
  .gap{color:var(--alert)}
  form.inline{display:flex;flex-wrap:wrap;gap:var(--s2);margin:0 0 var(--s3)}
  form.inline input[type=text]{flex:1 1 12rem;min-width:0;font:inherit;font-size:16px;
    padding:13px 15px;min-height:48px;border:1px solid var(--line);border-radius:12px;
    background:var(--card);color:var(--ink)}
  form.inline input:focus-visible{outline:2px solid var(--accent);outline-offset:1px}
  form.inline button{flex:0 0 auto}
  footer{margin-top:var(--s5);padding-top:var(--s3);border-top:1px solid var(--line)}
  footer a{color:var(--ink-3);font-size:.85rem;text-decoration:none}
  footer a:hover,footer a:focus-visible{text-decoration:underline}
</style>
</head>
<body>
<main class="wrap">
<nav class="places">
  <a href="/foundry"${active === 'foundry' ? ' class="on" aria-current="page"' : ''}>Foundry</a>
  <a href="/foundry/companies"${active === 'companies' ? ' class="on" aria-current="page"' : ''}>Companies</a>
  <a href="/foundry/controls"${active === 'controls' ? ' class="on" aria-current="page"' : ''}>Controls</a>
</nav>
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


// ─── the owner decision, as one reusable shape ──────────────────────────────

/**
 * THREE DIFFERENT ACTS, NEVER COLLAPSED INTO ONE.
 *
 * The institution's ladder connects them, which is exactly why the interface
 * must not: the owner should always know which of these he is doing.
 *
 *   RECOGNITION   this is genuinely worth looking after. No accountability, no
 *                 authority. Foundry keeps watching either way.
 *   RESPONSIBILITY Foundry is accountable for it and is measured against it.
 *                 Still no authority to change anything.
 *   AUTHORITY     Foundry may take consequential action, within stated limits,
 *                 for a stated time, revocably.
 *
 * Every decision the institution ever puts to him — a market worth researching,
 * a company worth taking on, eight dollars to test an assumption, a change to
 * deploy — is one of these three, and reads in the same shape: the question,
 * what it means, what it costs, what it does NOT permit, what he might be asked
 * next, and one button whose label states the resulting state.
 */
type OwnerAct = 'Recognition' | 'Responsibility' | 'Authority';

interface Decision {
  act: OwnerAct;
  question: string;
  title: string;
  meaning: string[];
  facts: Array<[string, string]>;
  primary: { label: string; action: string; fields?: Record<string, string> };
  secondary?: { label: string; action: string; fields?: Record<string, string> };
  technical: string;
  alert?: boolean;
}

const decisionCard = (d: Decision): HtmlEscapedString | Promise<HtmlEscapedString> => html`
  <section class="one${d.alert ? ' alert' : ''}" aria-labelledby="d-title">
    <div class="one-in">
      <p class="act">${d.act}</p>
      <h2 id="d-title">${d.question}</h2>
      <p class="lead">${d.title}</p>
      ${raw(d.meaning.map((m) => `<p>${m}</p>`).join(''))}
    </div>
    <dl>${raw(d.facts.map(([k, v]) => `<dt>${k}</dt><dd>${v}</dd>`).join(''))}</dl>
    <div class="do">
      <form method="POST" action="${d.primary.action}">
        <input type="hidden" name="return_to" value="foundry" />
        ${raw(Object.entries(d.primary.fields ?? {}).map(([k, v]) =>
    `<input type="hidden" name="${k}" value="${v}" />`).join(''))}
        <button class="btn go" type="submit">${d.primary.label}</button>
      </form>
      ${d.secondary ? html`<form method="POST" action="${d.secondary.action}" style="flex:0 0 auto">
        <input type="hidden" name="return_to" value="foundry" />
        ${raw(Object.entries(d.secondary.fields ?? {}).map(([k, v]) =>
    `<input type="hidden" name="${k}" value="${v}" />`).join(''))}
        <button class="btn" type="submit" style="width:auto">${d.secondary.label}</button>
      </form>` : ''}
    </div>
    <details><summary>Technical details</summary><div class="inner">
      <p class="mono">${d.technical}</p>
    </div></details>
  </section>`;

// ─── the one thing, rendered ────────────────────────────────────────────────

function theOneThing(a: Attention): HtmlEscapedString | Promise<HtmlEscapedString> {
  if (a === null) return html``;

  if (a.kind === 'stopped') {
    return html`<section class="one alert"><div class="one-in">
      <h2>Part of me has stopped running</h2>
      <p class="lead">${count(a.routines.length, 'routine')} of mine
        ${a.routines.length === 1 ? 'has' : 'have'} failed, so what I tell you may be out of
        date. Nothing is lost, and nothing needs you — I am the one that has to recover.</p>
    </div>
    <details><summary>Technical details</summary><div class="inner">
      <p class="mono">${a.routines.join(', ')}</p>
    </div></details></section>`;
  }

  if (a.kind === 'drifted') {
    const name = CHECK_IN_PLAIN_WORDS[a.checks[0]]?.name ?? a.checks[0];
    return html`<section class="one alert"><div class="one-in">
      <h2>${name}</h2>
      <p class="lead">This no longer matches. I have not changed anything — I only look.</p>
    </div></section>`;
  }

  if (a.kind === 'recognise') {
    const plain = a.check ? CHECK_IN_PLAIN_WORDS[a.check] : undefined;
    return decisionCard({
      act: 'Recognition',
      question: 'Is this worth looking after?',
      title: plain?.name ?? a.proposal,
      meaning: [
        plain?.why ?? '',
        'I noticed this about myself. Saying yes means it is real and worth watching — '
        + 'nothing more. I cannot change anything either way.',
      ].filter(Boolean),
      facts: [
        ['Cost', 'Nothing'],
        ['What I could change', 'Nothing'],
        ['If you change your mind', 'Say so and I will look at it again'],
      ],
      primary: {
        label: 'Yes — worth looking after',
        action: `/letter/responsibility-candidates/${a.candidateId}/promote`,
      },
      secondary: {
        label: 'No',
        action: `/letter/responsibility-candidates/${a.candidateId}/reject`,
      },
      technical: `${a.proposal} · check ${a.check ?? 'unknown'} · capability development`
        + ` · candidate ${a.candidateId}`,
    });
  }

  if (a.kind === 'authorise') {
    const named = CHECK_IN_PLAIN_WORDS[a.check]?.name ?? a.check;
    // ONE MATCHED PREDICTION IS ONE, AND IT SAYS SO. The evidence sentence is
    // the honest count, not a rate and not a boast: "reliable" from a single
    // observation is exactly the fabricated confidence this institution refuses
    // everywhere else, and this is the worst place to start.
    const record = a.wrong === 0
      ? `I said what my check would report ${count(a.matched, 'time')} and was right each time.`
      : `I said what my check would report ${count(a.matched + a.wrong, 'time')} and was wrong `
        + `${count(a.wrong, 'time')}.`;
    return decisionCard({
      act: 'Authority',
      question: 'May I do this myself, for seven days?',
      title: named,
      meaning: [
        record,
        'If you allow it, I may update one file — the description itself — and nothing else. '
        + 'After each change I re-run the check, and if it does not pass I put the file back.',
        'It ends on its own after seven days. You can take it back before that at any moment.',
      ],
      facts: [
        ['What I could change', 'One file, and only that one'],
        ['What I could not', 'The database, any other file, anything that alters behaviour'],
        ['Cost', 'Nothing'],
        ['Lasts', 'Seven days, then it stops by itself'],
        ['If you do nothing', 'It stays a manual job and I keep watching'],
      ],
      primary: {
        label: 'Allow for 7 days',
        action: '/autopilot/development/grant',
        fields: { responsibility_id: a.responsibilityId },
      },
      technical: `${a.path} · change class generated_artifact · verified by `
        + `${a.verification.join(', ')} · responsibility ${a.responsibilityId}`,
    });
  }

  const plain = CHECK_IN_PLAIN_WORDS[a.check];
  return decisionCard({
    act: 'Responsibility',
    question: 'Can I take responsibility for this?',
    title: plain?.name ?? a.title,
    meaning: [
      'I know how to tell whether this stays correct, and I have been watching it.',
      'If you say yes, I treat keeping it right as mine, and I am judged on whether it '
      + 'stays right. I still cannot change anything.',
      'If I show I can handle the work itself safely, I will ask you separately, for a '
      + 'limited time, before I am allowed to make any change.',
    ],
    facts: [
      ['Cost', 'Nothing'],
      ['What I could change', 'Nothing — this permits no changes'],
      ['If you change your mind', 'You can take it back at any time'],
      ['What I might ask next', 'Permission to do the work, for seven days'],
    ],
    primary: {
      label: 'Yes — take responsibility',
      action: `/letter/responsibilities/${a.responsibilityId}/watch-check`,
      fields: { check: a.check, expected_result: 'passed' },
    },
    technical: `${a.title} · check ${a.check} · development · understood`
      + ` · ${a.responsibilityId}`,
  });
}

/**
 * A PERMISSION HE HAS GIVEN IS NEVER BEHIND A DOOR.
 *
 * Authority the owner cannot see is authority he cannot withdraw. While one is
 * live it sits on the surface he opens, saying what it permits, when it ends by
 * itself, and offering the way out — not as a card that needs him, because it
 * does not, but as a standing fact about his institution.
 */
function standingPermission(s: OwnerState): HtmlEscapedString | Promise<HtmlEscapedString> {
  const live = s.permissions[0];
  if (!live) return html``;
  // A PERMISSION IT CANNOT USE MUST SAY SO, IN THE SAME BREATH.
  //
  // He granted this and it is real, correctly scoped and expiring — and there is
  // no path by which it can be used: nothing in the running system calls the
  // execute step, and the repository the file lives in is not connected, so a
  // write would land in a container that is replaced on the next deploy and
  // reach the repository never. Letting the page say only "you are letting me
  // change one file" would be the institution taking credit for a capability it
  // does not have, at the one moment he is extending trust.
  const unusable = live.path !== null && s.connectedSenses.length === 0;
  return html`<section class="standing">
    <div>
      <p><strong>You are letting me change ${live.path ? 'one file' : live.what}</strong>
        until ${live.until}. It stops then on its own.</p>
      ${unusable ? html`<p class="caveat">I cannot use it yet. I have no way to reach the
        repository that file lives in, so there is nothing I can change even with your
        permission. Connecting it would be a separate decision, and this permission would
        still cover only that one file.</p>` : ''}
    </div>
    <form method="POST" action="/autopilot/development/revoke">
      <input type="hidden" name="return_to" value="foundry" />
      <input type="hidden" name="consent_id" value="${live.id}" />
      <button class="btn" type="submit" style="width:auto">Take it back</button>
    </form>
  </section>`;
}

/**
 * WHAT JUST HAPPENED, said once, where he did it.
 *
 * Every owner action should end in orientation. Before this, acting sent him to
 * the old application and told him nothing: he was left wondering whether
 * anything had happened, what Foundry was doing now, and when he would hear
 * about it again.
 *
 * The marker in the URL only chooses WORDING — the state it describes is read
 * from the database like everything else, so a fabricated one says nothing that
 * is not true.
 */
function whatJustHappened(done: string, s: OwnerState,
): HtmlEscapedString | Promise<HtmlEscapedString> {
  const watching = s.responsibilities.some((r) => r.state === 'shadowing');
  const held = s.responsibilities.length > 0;

  if (done === 'recognised' && held) {
    return html`<div class="done">
      <p><strong>Noted.</strong> I will keep watching it and work out whether I can look
        after it properly.</p>
      <p>I have not been given anything, and I cannot change anything.</p>
    </div>`;
  }
  if (done === 'responsible' && watching) {
    return html`<div class="done">
      <p><strong>Got it.</strong> Keeping this right is mine now, and I am judged on whether
        it stays right.</p>
      <p>I am only watching and measuring myself — I still cannot make changes. If I show I
        can do the work safely, I will ask you before I am allowed to.</p>
      <p>Nothing else needs you.</p>
    </div>`;
  }
  if (done === 'declined') {
    return html`<div class="done">
      <p><strong>Understood.</strong> I will not bring that up again.</p>
      <p>If you change your mind, ask me what you turned down.</p>
    </div>`;
  }
  if (done === 'allowed' && s.permissions.length > 0) {
    return html`<div class="done">
      <p><strong>Allowed.</strong> From now until ${s.permissions[0].until} I can bring that one
        file back into step myself when it drifts.</p>
      <p>I check my work every time, and put it back if the check does not pass. It ends on
        its own after seven days, and you can take it back before then.</p>
      ${s.connectedSenses.length === 0 ? html`<p><strong>I cannot use it yet</strong> — I have
        no way to reach the repository that file lives in. The permission is real and it is
        waiting; connecting the repository is a separate decision.</p>`
    : html`<p>You will hear from me when I have actually done something.</p>`}
    </div>`;
  }
  if (done === 'withdrawn' && s.permissions.length === 0) {
    return html`<div class="done">
      <p><strong>Taken back.</strong> I can no longer change anything. I will keep watching
        and tell you when it drifts.</p>
    </div>`;
  }
  if (done === 'reopened') {
    return html`<div class="done"><p><strong>Back on the table.</strong></p></div>`;
  }
  return html``;
}

// ─── answers, from state ────────────────────────────────────────────────────

const QUESTIONS: Record<string, string> = {
  this: 'What does this mean?',
  ifyes: 'What happens if I say yes?',
  change: 'What can you change?',
  undo: 'Can I undo it?',
  turneddown: 'What did I turn down?',
  okay: 'Are you okay?',
  working: 'What are you working on?',
  companies: 'What do I own?',
  allowed: 'What are you allowed to do?',
  today: 'What happened today?',
  needs: 'What needs me?',
};

function matchQuestion(text: string): string {
  const t = text.toLowerCase();
  // CONTEXT FIRST. He is looking at something; "what does this mean" is about
  // that, and he should never have to name it again to be understood.
  if (/what.*(this|that).*(mean|about)|explain (this|that)/.test(t)) return 'this';
  if (/if i (say )?(yes|agree|approve)|what happens if/.test(t)) return 'ifyes';
  if (/what can you change|can you change|are you allowed to change/.test(t)) return 'change';
  if (/undo|reverse|take (it )?back|change my mind/.test(t)) return 'undo';
  if (/turn(ed)? down|declin|reject|said no/.test(t)) return 'turneddown';
  if (/what.*happens? next|what now|and then/.test(t)) return 'ifyes';
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

  if (key === 'this' || key === 'ifyes' || key === 'change' || key === 'undo') {
    if (a === null || a.kind === 'stopped' || a.kind === 'drifted') {
      return html`<div class="said"><p>There is nothing waiting on you at the moment,
        so there is nothing to explain yet.</p></div>`;
    }
    const named = a.kind === 'recognise'
      ? (a.check ? CHECK_IN_PLAIN_WORDS[a.check]?.name ?? a.proposal : a.proposal)
      : a.kind === 'authorise'
        ? CHECK_IN_PLAIN_WORDS[a.check]?.name ?? a.check
        : CHECK_IN_PLAIN_WORDS[a.check]?.name ?? a.title;
    if (key === 'change') {
      return a.kind === 'authorise'
        ? html`<div class="said">
          <p><strong>One file:</strong> the description of my own database, and nothing else.</p>
          <p>Not the database, not any other file, and nothing that alters how anything
            behaves. After each change I re-run the check; if it does not pass, I put the file
            back as it was.</p>
        </div>`
        : html`<div class="said">
          <p><strong>Nothing.</strong> I have no permission to change anything, and this
            decision does not give me one.</p>
          <p>If I ever ask for that, it will be a separate question, for a set number of days,
            naming exactly what I would touch — and you could take it back at any point.</p>
        </div>`;
    }
    if (key === 'undo') {
      if (a.kind === 'authorise') {
        return html`<div class="said">
          <p>Yes, at any moment — and it also ends on its own after seven days without you
            doing anything.</p>
        </div>`;
      }
      return html`<div class="said">
        <p>Yes. ${a.kind === 'recognise'
    ? 'If you say no I will not raise it again, but you can ask me what you turned down and put it back.'
    : 'You can take this back at any time, and I stop being judged on it.'}</p>
      </div>`;
    }
    if (key === 'ifyes') {
      if (a.kind === 'authorise') {
        return html`<div class="said">
          <p>When the description falls out of step with the database, I bring it back into
            step myself, instead of telling you about it.</p>
          <p>Every time, I re-run the check afterwards. If it does not pass, I undo the
            change. After seven days the permission ends on its own.</p>
        </div>`;
      }
      return a.kind === 'recognise'
        ? html`<div class="said">
          <p>I keep watching <strong>${named}</strong> and work out whether I can look after
            it properly. Nothing else changes, and I still cannot alter anything.</p>
        </div>`
        : html`<div class="said">
          <p>Keeping <strong>${named}</strong> right becomes mine, and I am judged on whether
            it stays right. I still cannot change anything.</p>
          <p>If I show I can do the work safely, I will come back and ask you for permission
            to make the change — for a set number of days, and revocable.</p>
        </div>`;
    }
    return html`<div class="said">
      <p><strong>${named}.</strong> ${a.kind === 'recognise'
    ? (a.check ? CHECK_IN_PLAIN_WORDS[a.check]?.why ?? '' : '')
    : 'I watch it, and I am asking to be held responsible for keeping it right.'}</p>
      <p>${a.kind === 'recognise'
    ? 'You are only telling me whether it is worth watching.'
    : 'It permits no changes. That would be a separate question.'}</p>
    </div>`;
  }

  if (key === 'turneddown') {
    return html`<div class="said">
      ${s.declined.length === 0
    ? html`<p>Nothing. You have not turned anything down.</p>`
    : html`<p>You told me not to look after
        ${raw(s.declined.map((d) => `<strong>${d.title}</strong>`).join(', '))}.</p>
      ${raw(s.declined.map((d) => `<form method="POST" style="margin-top:12px"
        action="/letter/responsibility-candidates/${d.id}/reconsider">
        <input type="hidden" name="return_to" value="foundry" />
        <button class="btn" type="submit" style="width:auto">Look at ${d.title} again</button>
      </form>`).join(''))}`}
    </div>`;
  }

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
    : html`<p>I may change ${s.permissions[0].path
      ? 'one file — my own description of my database — and nothing else'
      : s.permissions[0].what}, until ${s.permissions[0].until}. It ends then by itself,
      and you can take it back above.</p>
      ${s.connectedSenses.length === 0 ? html`<p>In practice I cannot use it: I have no way
        to reach the repository, so nothing I could change is reachable from here.</p>` : ''}`}
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
  const done = String(c.req.query('done') ?? '').trim();
  const key = asked || (typed ? matchQuestion(typed) : '');
  const attention = whatNeedsHim(s);

  // ORIENTATION IS ONE SENTENCE. Not four green bullets: a routine count and a
  // spend of zero are true, measurable, and not why he opened this.
  const orientation = done && attention === null
    ? ''
    : attention === null
      ? (s.routinesHealthy === 0 && s.checks.length === 0
        ? 'I am set up, and I have not learned anything about you yet.'
        : 'Everything is fine. Nothing needs you.')
      : attention.kind === 'stopped' || attention.kind === 'drifted'
        ? 'Something needs looking at.'
        : 'One thing needs you.';

  const body = html`
    <h1><span id="greet">Hello</span>${s.firstName ? `, ${s.firstName}` : ''}.</h1>
    ${orientation ? html`<p class="lede">${orientation}</p>` : ''}

    ${done ? whatJustHappened(done, s) : ''}
    ${standingPermission(s)}
    ${theOneThing(attention)}

    ${key ? html`<p class="asked">${typed || QUESTIONS[key] || asked}</p>
      ${answerTo(key, s, attention)}` : ''}

    ${!key ? html`<div class="maybe">
      ${raw((attention !== null && attention.kind !== 'stopped' && attention.kind !== 'drifted'
    ? ['ifyes', 'change']
    : ['okay', 'working']).map((k) =>
    `<a href="/foundry?ask=${k}">${QUESTIONS[k]}</a>`).join(''))}
    </div>` : ''}`;

  return c.html(page('Foundry', body, 'foundry'));
});

// ─── companies ──────────────────────────────────────────────────────────────

/**
 * WHAT FOUNDRY KNOWS ABOUT A COMPANY, AND WHAT IT CANNOT SEE.
 *
 * The absence is the useful half. A page of empty charts tells the owner
 * nothing and implies the numbers are coming; "I cannot see any money — nothing
 * is connected" tells him exactly where he stands and what would change it.
 * Every line here is read from state, and every gap names the one thing that
 * would close it.
 */
interface CompanyView {
  id: string; name: string; established: string | null;
  objective: string | null;
  budgetMonthly: number; spent30d: number;
  knows: string[]; gaps: Array<{ missing: string; unlocks: string; connect: string | null }>;
  responsibilities: Array<{ title: string; state: string }>;
}

async function readCompany(productId: string, founderId: string): Promise<CompanyView | null> {
  const row = (await query(
    `SELECT id, name, created_at, operating_budget_monthly_usd, ai_cost_trailing_30d_usd,
            github_repo_url
       FROM products WHERE id = ? AND owner_id = ?`, [productId, founderId]))
    .rows[0] as Record<string, unknown> | undefined;
  if (!row) return null;

  const objective = (await query(
    `SELECT objective_text FROM company_okrs WHERE product_id = ?
      ORDER BY created_at DESC LIMIT 1`, [productId])).rows[0] as Record<string, unknown> | undefined;

  const { getSelfCheckStanding } = await import(
    '../../services/institution/development-observation.js');
  const checks = await getSelfCheckStanding(productId);

  const responsibilities = (await query(
    `SELECT title, state FROM institutional_responsibilities
      WHERE product_id = ? AND disposition = 'active' ORDER BY created_at`, [productId]))
    .rows as unknown as Array<Record<string, unknown>>;

  const knows: string[] = [];
  const gaps: CompanyView['gaps'] = [];

  if (checks.length) {
    knows.push(`I check ${count(checks.length, 'thing')} about how it is built, `
      + `and ${checks.every((ch) => ch.result === 'passed') ? 'all of it still matches'
        : 'some of it has gone out of step'}.`);
  }
  if (row.github_repo_url) knows.push('I can read its code.');
  else {
    gaps.push({
      missing: 'I cannot see its code',
      unlocks: 'what it is built from, and what changes in it',
      connect: '/agents/integrations',
    });
  }
  gaps.push({
    missing: 'I cannot see any money',
    unlocks: 'revenue, what customers pay, and what is failing to collect',
    connect: '/agents/integrations',
  });
  gaps.push({
    missing: 'I cannot see any customers',
    unlocks: 'who is using it, who is stuck, and who is leaving',
    connect: '/agents/integrations',
  });

  return {
    id: String(row.id), name: String(row.name),
    established: row.created_at == null ? null : String(row.created_at).slice(0, 10),
    objective: objective ? String(objective.objective_text) : null,
    budgetMonthly: Number(row.operating_budget_monthly_usd ?? 0),
    spent30d: Number(row.ai_cost_trailing_30d_usd ?? 0),
    knows, gaps,
    responsibilities: responsibilities.map((r) => ({
      title: String(r.title), state: String(r.state),
    })),
  };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
foundryShellRoutes.get('/foundry/companies', async (c: any) => {
  const founder = c.get('founder') as { id?: string } | undefined;
  if (!founder?.id) return c.redirect('/onboarding');

  const rows = (await query(
    `SELECT id, name, created_at FROM products
      WHERE owner_id = ? AND status = 'active' AND deleted_at IS NULL
      ORDER BY created_at`, [String(founder.id)])).rows as unknown as Array<Record<string, unknown>>;

  const body = html`
    <h1>Your companies</h1>
    ${rows.length === 0 ? html`<p class="lede">You have not given me any yet.</p>` : ''}
    ${raw(rows.map((r) => `<a class="item" href="/foundry/companies/${String(r.id)}">
      <h3>${String(r.name)}</h3>
      <p>Since ${String(r.created_at ?? '').slice(0, 10)}</p></a>`).join(''))}

    <form class="inline" method="POST" action="/foundry/companies" style="margin-top:var(--s4)">
      <input type="text" name="name" required maxlength="60" placeholder="Add a company by name"
        aria-label="Company name" />
      <button class="btn go" type="submit" style="width:auto">Add</button>
    </form>
    <p class="quiet">Adding one tells me it exists and that you own it. It does not connect
      anything or let me do anything — those are separate, and I will ask.</p>`;

  return c.html(page('Companies', body, 'companies'));
});

// eslint-disable-next-line @typescript-eslint/no-explicit-any
foundryShellRoutes.post('/foundry/companies', requireInstitutionOwner(), async (c: any) => {
  const founder = c.get('founder') as { id?: string } | undefined;
  if (!founder?.id) return c.redirect('/onboarding');
  const body = await c.req.parseBody();
  const name = String(body.name ?? '').trim().slice(0, 60);
  if (!name) return c.redirect('/foundry/companies');

  // The smallest true thing: it exists, and he owns it. No invented sector, no
  // fabricated stage, no agents, no competitors — the first version of this
  // product created a company as a side effect of a four-step audit funnel and
  // filled it with guesses.
  const { nanoid } = await import('nanoid');
  const id = nanoid();
  await query(
    "INSERT INTO products (id, name, owner_id, status) VALUES (?, ?, ?, 'active')",
    [id, name, String(founder.id)]);
  return c.redirect(`/foundry/companies/${id}?done=added`);
});

// eslint-disable-next-line @typescript-eslint/no-explicit-any
foundryShellRoutes.get('/foundry/companies/:id', async (c: any) => {
  const founder = c.get('founder') as { id?: string } | undefined;
  if (!founder?.id) return c.redirect('/onboarding');
  const view = await readCompany(c.req.param('id'), String(founder.id));
  // A company of someone else's and one that does not exist answer the same.
  if (!view) return c.notFound();
  const done = String(c.req.query('done') ?? '');

  const body = html`
    <h1>${view.name}</h1>
    ${done === 'added' ? html`<div class="done"><p><strong>Added.</strong> I know it exists and
      that it is yours. I cannot see anything about it yet.</p></div>` : ''}
    ${done === 'steered' ? html`<div class="done"><p><strong>Noted.</strong> I will weigh that
      when I decide what is worth your attention here.</p></div>` : ''}

    <div class="know">
      <h3>What I know</h3>
      ${view.knows.length === 0
    ? html`<p class="lede">Almost nothing. You have told me it exists; that is all.</p>`
    : html`<ul>${raw(view.knows.map((k) => `<li>${k}</li>`).join(''))}</ul>`}
    </div>

    <div class="know">
      <h3>What I cannot see</h3>
      <ul>${raw(view.gaps.map((g) =>
    `<li><span class="gap">${g.missing}.</span> Connecting it would show me ${g.unlocks}.</li>`)
    .join(''))}</ul>
      <p class="quiet">Letting me read something never lets me change it. That is always a
        separate question.</p>
    </div>

    ${view.responsibilities.length ? html`<div class="know">
      <h3>What I look after</h3>
      <ul>${raw(view.responsibilities.map((r) =>
    `<li>${CHECK_IN_PLAIN_WORDS['schema-snapshot-freshness']?.name === r.title ? r.title : r.title}
       — ${LADDER_IN_PLAIN_WORDS[r.state] ?? r.state}</li>`).join(''))}</ul>
    </div>` : ''}

    <div class="know">
      <h3>What matters here</h3>
      ${view.objective
    ? html`<p>${view.objective}</p>`
    : html`<p class="lede">You have not told me what you are trying to do with this company.
        Until you do, I have no way to judge what is worth your attention.</p>`}
      <form class="inline" method="POST" action="/foundry/companies/${view.id}/objective">
        <input type="text" name="objective" required maxlength="200"
          placeholder="${view.objective ? 'Change it' : 'What are you trying to do here?'}"
          aria-label="What matters for this company" />
        <button class="btn" type="submit" style="width:auto">Save</button>
      </form>
    </div>

    <div class="know">
      <h3>Money</h3>
      <ul><li>$${view.spent30d.toFixed(2)} spent of $${String(view.budgetMonthly)} a month.</li></ul>
    </div>`;

  return c.html(page(view.name, body, 'companies'));
});

// NO CAPABILITY GATE, AND THE REASON, because the route-guard gate asks.
// Stating what he is trying to do with his own company grants Foundry nothing
// and causes nothing: it records the owner's intent, which is read when judging
// what is worth his attention and nowhere else. Authority is checked
// server-side regardless — the company must belong to this authenticated
// founder, and any other id is refused as not found without revealing whether
// it exists.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
foundryShellRoutes.post('/foundry/companies/:id/objective', async (c: any) => {
  const founder = c.get('founder') as { id?: string } | undefined;
  if (!founder?.id) return c.redirect('/onboarding');
  const productId = c.req.param('id');
  // Ownership server-side; a company id for anyone else is refused without
  // revealing that it exists.
  const owned = await query('SELECT id FROM products WHERE id = ? AND owner_id = ?',
    [productId, String(founder.id)]);
  if (!owned.rows.length) return c.notFound();

  const body = await c.req.parseBody();
  const objective = String(body.objective ?? '').trim().slice(0, 200);
  if (!objective) return c.redirect(`/foundry/companies/${productId}`);

  const { nanoid } = await import('nanoid');
  const now = new Date();
  const period = `${String(now.getUTCFullYear())}-Q${String(Math.floor(now.getUTCMonth() / 3) + 1)}`;
  await query(
    `INSERT INTO company_okrs (id, product_id, period, objective_text, objective_owner)
     VALUES (?, ?, ?, ?, 'founder')`, [nanoid(), productId, period, objective]);
  return c.redirect(`/foundry/companies/${productId}?done=steered`);
});

// ─── controls ───────────────────────────────────────────────────────────────

/**
 * WHAT FOUNDRY MAY DO, WHAT IT COSTS, AND HOW TO STOP IT.
 *
 * A place again, not because a concept exists but because these are the three
 * questions an owner asks about something operating on his behalf, and he
 * should be able to walk to the answer rather than remember to ask for it.
 * Everything here enforces something: a permission that is really live, a
 * ceiling really applied, a stop that really stops.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
foundryShellRoutes.get('/foundry/controls', async (c: any) => {
  let s: OwnerState | null;
  try {
    s = await context(c);
  } catch {
    return c.html(page('Controls', html`
      <h1>I can't reach my own records</h1>
      <p class="lede">Nothing of yours has changed and nothing is lost.</p>`, 'controls'), 503);
  }
  if (!s) return c.redirect('/onboarding');

  const body = html`
    <h1>What I'm allowed to do</h1>

    ${standingPermission(s)}

    ${s.permissions.length === 0 ? html`<div class="know">
      <h3>Permissions</h3>
      <p><strong>None.</strong> I can look at things and tell you what I find. I cannot change
        anything, spend anything, or contact anyone.</p>
      <p class="quiet">Each of those would be something you allow separately, for a set time,
        and could take back whenever you wanted. I ask on the front page when I have earned
        the right to.</p>
    </div>` : ''}

    <div class="know">
      <h3>Money</h3>
      <ul>
        <li>$${s.spent30d.toFixed(2)} spent in the last 30 days.</li>
        <li>$${String(s.budgetMonthly)} a month is the limit you set for ${s.companyName}.</li>
        <li>I stop thinking for a company at $2 a day, and for everything at $5 a day.</li>
      </ul>
      <p class="quiet">Watching costs nothing — comparing my own records uses no thinking.</p>
    </div>

    <div class="know">
      <h3>Connected to</h3>
      ${s.connectedSenses.length === 0
    ? html`<p><strong>Nothing.</strong> I have no way to see your code, your money or your
        customers.</p>`
    : html`<ul>${raw(s.connectedSenses.map((x) => `<li>${x}</li>`).join(''))}</ul>`}
    </div>

    <div class="know">
      <h3>Stopping me</h3>
      <p>One button halts every routine, every permission and every outgoing action at once.
        Nothing is lost — I stop acting on it.</p>
      <form method="POST" action="/autopilot/panic" style="margin-top:var(--s2)">
        <input type="hidden" name="return_to" value="foundry" />
        <button class="btn" type="submit" style="width:auto">Stop everything</button>
      </form>
    </div>`;

  return c.html(page('Controls', body, 'controls'));
});
