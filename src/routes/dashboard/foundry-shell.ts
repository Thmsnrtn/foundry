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
import { query, realCompany, referenceCompany } from '../../db/client.js';
import { selectedProductId } from './_shared.js';
import { requireInstitutionOwner } from '../../middleware/rbac.js';
import type { CompanyNumbers } from '../../services/founder/what-the-numbers-say.js';

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
  /** Whose institution this is. Read here so no surface re-derives it. */
  ownerId: string;
  /**
   * ANYTHING NEEDING HIM THAT IS NOT ABOUT FOUNDRY ITSELF.
   *
   * The rest of this object describes ONE company — the one that is Foundry —
   * because self-maintenance is what the ladder has actually climbed. His
   * institution is larger than that, and the first screen has to answer "does
   * anything need me" about all of it or the answer is a lie of omission.
   */
  elsewhere: Array<{
    productId: string; companyName: string;
    candidateId: string; proposal: string; rationale: string;
  }>;
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

/**
 * WHICH COMPANY IS FOUNDRY.
 *
 * The first screen used to find it with `selectedProductId`, whose rule is
 * "exactly one company, so the choice is unambiguous". That was true while the
 * owner had one. The moment he added a second — which the product now invites
 * him to do on the Companies page — it returned null, `context` returned null,
 * and the home page REDIRECTED HIM TO ONBOARDING. The sacred screen was one tap
 * away from disappearing, and nothing would have said why.
 *
 * Foundry is not "his only company". It is a specific row, named once in
 * `system_identities` and immutable there. Asking the right question removes
 * the dependency on how many companies he happens to own.
 */
async function foundryProductId(founderId: string): Promise<string | null> {
  const row = (await query(
    `SELECT p.id FROM system_identities i
       JOIN products p ON p.id = i.product_id
      WHERE i.identity_key = 'foundry' AND p.owner_id = ?`, [founderId]))
    .rows[0] as Record<string, unknown> | undefined;
  return row ? String(row.id) : null;
}

/**
 * The questions Foundry is holding about his OTHER companies.
 *
 * Ordered so the oldest unanswered one surfaces first: a question that has been
 * waiting is a question he has already been shown and did not answer, and
 * burying it under a newer one is how an institution quietly gives up asking.
 */
async function questionsElsewhere(
  founderId: string, exceptProductId: string | null,
): Promise<OwnerState['elsewhere']> {
  const rows = (await query(
    `SELECT c.id, c.proposed_responsibility, c.rationale, p.id AS product_id, p.name
       FROM responsibility_candidates c
       JOIN products p ON p.id = c.product_id
      WHERE p.owner_id = ? AND c.status = 'pending'
        AND p.status = 'active' AND p.deleted_at IS NULL
        -- OWNER ATTENTION IS CAPITAL, AND A COMPANY THAT DOES NOT EXIST MAY NOT
        -- SPEND IT. The reference world exists to be watched, and its questions
        -- are real questions about real machinery — but nothing is at stake in
        -- one, so nothing about it NEEDS him, which is what this screen answers.
        -- They wait on the company's own page, where he goes to look.
        AND ${realCompany('p')}
        AND (? IS NULL OR c.product_id <> ?)
      ORDER BY c.created_at, c.rowid`,
    [founderId, exceptProductId, exceptProductId]))
    .rows as unknown as Array<Record<string, unknown>>;
  return rows.map((r) => ({
    productId: String(r.product_id), companyName: String(r.name),
    candidateId: String(r.id), proposal: String(r.proposed_responsibility),
    rationale: String(r.rationale),
  }));
}

async function readOwnerState(
  productId: string, founderName: string, founderId: string,
): Promise<OwnerState> {
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
    ownerId: founderId,
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
    elsewhere: await questionsElsewhere(founderId, productId),
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
  | { kind: 'recognise_company'; candidateId: string; productId: string;
      companyName: string; proposal: string; rationale: string }
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
  // AND THE REST OF HIS INSTITUTION. Last, because everything above is about
  // Foundry being broken or about a permission — both of which outrank a
  // question — but never never: a question about one of his companies that the
  // first screen does not surface is a question he will not answer.
  const asked = s.elsewhere[0];
  if (asked) {
    return {
      kind: 'recognise_company', candidateId: asked.candidateId,
      productId: asked.productId, companyName: asked.companyName,
      proposal: asked.proposal, rationale: asked.rationale,
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
  /* A revenue collapse should not be the same weight as twelve healthy metrics.
     One class, used once per page, on the single sentence that says so. */
  .alarm{color:var(--alert);font-weight:600}
  /* Deliberately not named ask: that class is the fixed bar at the bottom of
     every page, and reusing it would pin every question to the floor. */
  .noticed{border:1px solid var(--line);border-radius:var(--r);padding:var(--s3);
    margin:0 0 var(--s3);background:var(--card)}
  .noticed h4{font-size:.72rem;letter-spacing:.12em;text-transform:uppercase;
    color:var(--ink-3);font-weight:700;margin:0 0 var(--s2)}
  .noticed p{margin:0 0 var(--s2);color:var(--ink-2);font-size:.97rem}
  .noticed form{margin:0 0 var(--s2)}
  .noticed form:last-child{margin:0}
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

  // A QUESTION ABOUT ONE OF HIS COMPANIES, NOT ABOUT FOUNDRY.
  //
  // Same act — RECOGNITION — and deliberately the same card, because it is the
  // same decision with the same consequence. What differs is that it has to
  // NAME THE COMPANY: the first screen is the one place where "is this worth
  // looking after?" could otherwise be read as being about the wrong business.
  if (a.kind === 'recognise_company') {
    return decisionCard({
      act: 'Recognition',
      question: `Is this worth looking after at ${a.companyName}?`,
      title: a.proposal,
      meaning: [
        a.rationale,
        'Saying yes means I watch it and tell you what I see — nothing more. '
        + 'I cannot change anything, spend anything, or contact anyone either way.',
      ],
      facts: [
        ['Company', a.companyName],
        ['Cost', 'Nothing'],
        ['What I could change', 'Nothing'],
        ['If you change your mind', 'Say so and I will look at it again'],
      ],
      primary: {
        label: 'Yes — worth looking after',
        action: `/letter/responsibility-candidates/${a.candidateId}/promote`,
        fields: { return_to: 'foundry' },
      },
      secondary: {
        label: 'No',
        action: `/letter/responsibility-candidates/${a.candidateId}/reject`,
        fields: { return_to: 'foundry' },
      },
      technical: `${a.proposal} · company ${a.productId} · candidate ${a.candidateId}`,
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

/**
 * WHICH COMPANY HE MEANT.
 *
 * "How is AcreOS doing?" is the mandate's own example, and until now the ask box
 * could not tell one company from another — every answer was about Foundry,
 * whichever business he named. That is worse than not answering: it is a
 * confident answer about the wrong thing.
 *
 * Longest name first, so "Acre" does not answer for "AcreOS". Reference
 * companies are included deliberately: if he asks about one by name he should
 * get an answer, and the answer says what it is.
 */
async function companyHeMeant(
  founderId: string, text: string,
): Promise<{ id: string; name: string; reference: boolean } | null> {
  if (!text.trim()) return null;
  const haystack = text.toLowerCase();
  // NO REALITY PREDICATE, AND THIS IS THE ONE PLACE THAT IS RIGHT. He asked
  // about a company BY NAME; refusing to recognise the name would be answering
  // "I don't know what you mean" about a company he is looking at. `reality` is
  // selected and travels with the answer, which discloses that the company does
  // not exist before it says anything else about it — disclosure, not exclusion.
  // Nothing here becomes owner truth: the numbers it leads to carry the same
  // banner the company's own page does.
  const rows = (await query(
    `SELECT id, name, reality FROM products
      WHERE owner_id = ? AND status = 'active' AND deleted_at IS NULL
      ORDER BY length(name) DESC, rowid`, [founderId]))
    .rows as unknown as Array<Record<string, unknown>>;
  for (const row of rows) {
    const name = String(row.name);
    if (name.length >= 3 && haystack.includes(name.toLowerCase())) {
      return { id: String(row.id), name, reference: String(row.reality) === 'reference' };
    }
  }
  return null;
}

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
  // ASKED ABOUT A COMPANY, WHICH IS A DIFFERENT QUESTION FROM ASKED ABOUT
  // FOUNDRY. These two run first because "how is AcreOS doing" also matches
  // /okay/ below, and answering it with Foundry's own health would be a
  // confident answer about the wrong business.
  if (/show me the numbers|the numbers|how much|revenue|mrr|metrics|customers|churn/.test(t)) {
    return 'numbers';
  }
  if (/how is|how are|how'?s |doing|going|healthy|health of/.test(t)) return 'howdoing';
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

/**
 * AN ANSWER ABOUT ONE OF HIS COMPANIES, FROM WHAT IS ACTUALLY THERE.
 *
 * STRUCTURE WHERE STRUCTURE HELPS, PROSE WHERE PROSE HELPS — the owner was
 * explicit that "show me the numbers" must not produce a wall of text, and that
 * "why isn't it growing" must not produce a bare table. So a health question
 * answers in sentences and a numbers question answers in a list, and both come
 * from the same institutional truth rather than from a model retelling it.
 *
 * Nothing here interprets. "New revenue is down about a quarter" is arithmetic
 * on two readings; whether that is bad is his to say, and an institution that
 * quietly decided would be inventing the one thing it cannot observe.
 */
async function answerAboutCompany(
  about: { id: string; name: string; reference: boolean; key: string },
): Promise<HtmlEscapedString> {
  const { whatTheNumbersSay } = await import('../../services/founder/what-the-numbers-say.js');
  const intent = await import('../../services/institution/standing-intent.js');

  const disclaimer = about.reference
    ? html`<p class="quiet"><strong>${about.name} does not exist.</strong> I made it up so you
        could watch me work. The arithmetic is real; the numbers are invented, and nothing
        here is a fact about a real company.</p>`
    : '';

  if (about.key === 'numbers') {
    const read = await whatTheNumbersSay(about.id);
    return html`<div class="said">
      ${disclaimer}
      ${read.absence
    ? html`<p>${read.absence}</p>`
    : html`<ul>${raw(read.numbers.map((n) =>
      `<li><strong>${n.now}</strong> — ${n.sentence}</li>`).join(''))}</ul>
      <p class="quiet">As of ${String(read.asOf)}, against the nearest reading to a month
        before it.</p>`}
      <a class="btn" href="/foundry/companies/${about.id}">Open ${about.name}</a>
    </div>`;
  }

  if (about.key === 'allowed') {
    const bounds = await intent.boundariesFor(about.id);
    return html`<div class="said">
      ${disclaimer}
      ${bounds.length
    ? html`<p>You have told me not to do these at ${about.name}:</p>
      <ul>${raw(bounds.map((b) =>
      `<li>${b.statement}${b.everywhere ? ' — for every company' : ''}</li>`).join(''))}</ul>`
    : html`<p>You have not told me to hold back on anything at ${about.name}.</p>`}
      <p>I cannot change anything, spend anything or contact anyone for ${about.name} unless
        you have given me a permission for it, and I would ask first.</p>
    </div>`;
  }

  if (about.key === 'working' || about.key === 'needs') {
    const held = (await query(
      `SELECT title, state FROM institutional_responsibilities
        WHERE product_id = ? AND disposition = 'active' ORDER BY created_at`, [about.id]))
      .rows as unknown as Array<Record<string, unknown>>;
    const asking = (await query(
      `SELECT proposed_responsibility FROM responsibility_candidates
        WHERE product_id = ? AND status = 'pending' ORDER BY created_at`, [about.id]))
      .rows as unknown as Array<Record<string, unknown>>;
    return html`<div class="said">
      ${disclaimer}
      ${held.length
    ? html`<p>At ${about.name} I look after:</p>
      <ul>${raw(held.map((r) =>
      `<li>${String(r.title)} — ${LADDER_IN_PLAIN_WORDS[String(r.state)] ?? String(r.state)}</li>`)
    .join(''))}</ul>`
    : html`<p>I do not look after anything at ${about.name} yet.</p>`}
      ${asking.length
    ? html`<p>And ${asking.length === 1 ? 'there is one thing' : `there are ${String(asking.length)} things`}
        I have asked you about:</p>
      <ul>${raw(asking.map((r) => `<li>${String(r.proposed_responsibility)}</li>`).join(''))}</ul>
      <a class="btn go" href="/foundry/companies/${about.id}">Answer at ${about.name}</a>`
    : ''}
    </div>`;
  }

  // How is it doing. Sentences, because that is how the question was asked.
  const read = await whatTheNumbersSay(about.id);
  const objective = await intent.objectiveFor(about.id);
  const falling = read.numbers.filter((n) => n.direction === 'fell');
  const rising = read.numbers.filter((n) => n.direction === 'rose');
  return html`<div class="said">
    ${disclaimer}
    ${read.absence
    ? html`<p>${read.absence}</p>`
    : html`<p>${falling.length === 0 && rising.length === 0
      ? `Nothing at ${about.name} has moved much since a month ago.`
      : `At ${about.name}, ${String(falling.length)} of the numbers I can see are down on a `
        + `month ago and ${String(rising.length)} are up.`}</p>
      <ul>${raw(read.numbers.map((n) => `<li>${n.sentence}</li>`).join(''))}</ul>
      <p class="quiet">That is where things are and which way they are going. Whether it is
        good is yours to say — I am not judging it.</p>`}
    ${objective
    ? html`<p>You told me ${about.name} is for: <strong>${objective.statement}</strong></p>`
    : html`<p class="quiet">You have not told me what ${about.name} is for, so I have no way
        to judge which of these matters most.</p>`}
    <a class="btn" href="/foundry/companies/${about.id}">Open ${about.name}</a>
  </div>`;
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
      : a.kind === 'recognise_company'
        // A company's job has no self-check behind it to look up a friendlier
        // name for; the proposal already IS the plain words.
        ? `${a.proposal} at ${a.companyName}`
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
  // Foundry itself, by name. `selectedProductId` remains the fallback for a
  // deployment where Foundry has not yet been established as a company —
  // it is right there and wrong the moment a second company exists, which is
  // why it is second.
  const founderId = String(founder.id);
  const productId = await foundryProductId(founderId) ?? await selectedProductId(c, founderId);
  if (!productId) return null;
  return readOwnerState(productId, String(founder.name ?? founder.email ?? ''), founderId);
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

  // Only when he TYPED a company's name. The chips below are institutional
  // questions and must not silently acquire a subject.
  const named = typed
    ? await companyHeMeant(s.ownerId, typed) : null;
  const about = named && (key === 'howdoing' || key === 'numbers' || key === 'working'
    || key === 'needs' || key === 'allowed') ? { ...named, key } : null;

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
      ${about ? answerAboutCompany(about) : answerTo(key, s, attention)}` : ''}

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
  budgetMonthly: number; spent30d: number;
  knows: string[]; gaps: Array<{ missing: string; unlocks: string; connect: string | null }>;
  responsibilities: Array<{ title: string; state: string }>;
  numbers: CompanyNumbers;
  /** Non-null only for a reference company: what it is, said before anything else. */
  reference: { situation: string; premise: string } | null;
  /** What Foundry has noticed and is asking about. Recognition, and nothing more. */
  asks: Array<{ id: string; proposal: string; rationale: string }>;
  /** The one sentence at the top: what situation this company is in. */
  situation: { situation: string; headline: string; because: string[]; demandsAttention: boolean };
  /** What he decided about acts, and what he took back. Auditable, and read. */
  decisions: Array<{
    id: string; summary: string; outcome: string; at: string;
    note: string | null; used: boolean;
  }>;
  /** Acts it has proposed and cannot take until he answers. */
  proposals: Array<{
    id: string; summary: string; why: string; expectedEffect: string;
    risk: string; consequence: string; expiresAt: string;
  }>;
  /** What he said this company is for, in his words. */
  said: { statement: string; steers: boolean } | null;
  /** What he told Foundry not to do. Enforced, and liftable in one tap. */
  boundaries: Array<{
    id: string; statement: string; ownerWords: string; mode: string;
    everywhere: boolean; enforcedNow: boolean;
  }>;
  /** What he lifted, offered back — because changing your mind runs both ways. */
  lifted: Array<{ statement: string; liftedAt: string; liftedReason: string }>;
  /** What Foundry can see here, from where, and how fresh. */
  senses: Array<{
    id: string; senseKey: string; wouldLearn: string; neverGrants: string;
    provider: string; providerName: string; shortName: string; mode: string;
    lastObservedAt: string | null; lastError: string | null;
  }>;
  /** What he turned off, offered back — disconnecting is as reversible as lifting. */
  stoppedSeeing: Array<{
    senseKey: string; cannotSee: string; provider: string; providerName: string;
    mode: string; disconnectedAt: string; reason: string;
  }>;
  /** What it cannot see, and who could fix it. Replaces the hardcoded gap list. */
  blind: Array<{
    senseKey: string; cannotSee: string; wouldLearn: string; neverGrants: string;
    offers: Array<{ provider: string; providerName: string; mode: string;
      reads: string; handsOver: string }>;
  }>;
  /** What this company was for before, and when that changed. */
  formerly: { statement: string; retiredAt: string; retiredReason: string } | null;
}

async function readCompany(productId: string, founderId: string): Promise<CompanyView | null> {
  const row = (await query(
    `SELECT id, name, created_at, operating_budget_monthly_usd, ai_cost_trailing_30d_usd,
            github_repo_url, reality
       FROM products WHERE id = ? AND owner_id = ?`, [productId, founderId]))
    .rows[0] as Record<string, unknown> | undefined;
  if (!row) return null;

  // WHAT IT IS, BEFORE ANYTHING IT SAYS. A reference company's page shows real
  // arithmetic on invented numbers, and a page that showed that without saying
  // so would be the single most misleading screen in the product.
  let reference: CompanyView['reference'] = null;
  if (String(row.reality) === 'reference') {
    const ref = (await query(
      'SELECT scenario FROM reference_companies WHERE product_id = ?', [productId]))
      .rows[0] as Record<string, unknown> | undefined;
    const { REFERENCE_SCENARIOS } = await import('../../services/reference/scenarios.js');
    const situation = String(ref?.scenario ?? 'a company that does not exist');
    reference = {
      situation,
      premise: REFERENCE_SCENARIOS.find((sc) => sc.situation === situation)?.premise ?? '',
    };
  }

  const { whatTheNumbersSay } = await import('../../services/founder/what-the-numbers-say.js');
  const numbers = await whatTheNumbersSay(productId);

  // THE QUESTIONS BELONG ON THE COMPANY THEY ARE ABOUT. The home page asks one
  // thing about Foundry itself; a question about this company would be
  // homeless anywhere but here.
  const { getPendingResponsibilityCandidates } = await import(
    '../../services/institution/responsibility-candidate.js');
  const pending = await getPendingResponsibilityCandidates(productId);
  const rationales = new Map(((await query(
    `SELECT id, rationale FROM responsibility_candidates
      WHERE product_id = ? AND status = 'pending'`, [productId]))
    .rows as unknown as Array<Record<string, unknown>>).map((r) => [String(r.id), String(r.rationale)]));
  const asks = pending.map((candidate) => ({
    id: candidate.id, proposal: candidate.proposedResponsibility,
    rationale: rationales.get(candidate.id) ?? '',
  }));

  // STANDING INTENT, NOT AN OKR. `company_okrs` is a quarterly system with key
  // results, progress percentages and agent owners; writing "focus on
  // retention" into it invented a period, a status and a progress figure the
  // owner never stated. Migration 225 gave his sentence a place of its own.
  const intent = await import('../../services/institution/standing-intent.js');
  const objective = await intent.objectiveFor(productId);
  const liveBoundaries = await intent.boundariesFor(productId);
  const lifted = await intent.liftedBoundariesFor(productId);
  const proposals = await intent.openProposals(productId);
  const decisions = await intent.recentDecisions(productId);
  const { whatSituation } = await import('../../services/founder/what-situation.js');
  const situation = await whatSituation(productId);
  const formerly = await intent.formerObjectiveFor(productId);

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
  // WHAT IT CAN SEE, AND WHAT IT CANNOT, FROM THE SENSE SYSTEM.
  //
  // This list used to be three hardcoded sentences — code, money, customers —
  // asserted unconditionally, which is how a company reporting $31.4k of
  // revenue came to be told four inches below the figure that Foundry cannot
  // see any money. It is now derived from what is actually connected, which
  // means it can never disagree with the numbers above it, and every gap
  // carries the one thing that makes it actionable: who could fix it, and what
  // fixing it would NOT allow.
  const senseSystem = await import('../../services/senses/index.js');
  const live = await senseSystem.connectedSenses(productId);
  const blind = await senseSystem.whatItCannotSee(productId);
  const stoppedSeeing = await senseSystem.whatItStoppedSeeing(productId);

  // DELIBERATELY NOT LISTING THE SENSES HERE. They have their own section
  // directly above, and saying "I can see revenue, from Stripe" in both places
  // made the page longer without making it say more — the exact shape the
  // owner's "ruthlessly remove" rule is about. What belongs here is what
  // Foundry UNDERSTANDS, which is a different question from what it is
  // plugged into.
  for (const gap of blind) {
    gaps.push({
      missing: `I cannot see ${gap.cannotSee}`,
      unlocks: gap.wouldLearn,
      connect: gap.offers.length ? `/foundry/companies/${productId}/see/${gap.key}` : null,
    });
  }

  return {
    id: String(row.id), name: String(row.name),
    established: row.created_at == null ? null : String(row.created_at).slice(0, 10),
    said: objective ? { statement: objective.statement, steers: objective.channels.length > 0 } : null,
    boundaries: liveBoundaries.map((b) => ({
      id: b.id, statement: b.statement, ownerWords: b.ownerWords, mode: b.mode,
      everywhere: b.everywhere, enforcedNow: b.door != null,
    })),
    lifted: lifted.map((b) => ({
      statement: b.statement, liftedAt: b.liftedAt, liftedReason: b.liftedReason,
    })),
    senses: live.map((sense) => ({
      id: sense.id, senseKey: sense.senseKey, wouldLearn: sense.wouldLearn,
      neverGrants: sense.neverGrants, provider: sense.provider,
      providerName: senseSystem.providerName(sense.provider),
      shortName: sense.cannotSee, mode: sense.mode,
      lastObservedAt: sense.lastObservedAt, lastError: sense.lastError,
    })),
    stoppedSeeing: stoppedSeeing.map((lost) => ({
      senseKey: lost.senseKey, cannotSee: lost.cannotSee, provider: lost.provider,
      providerName: senseSystem.providerName(lost.provider),
      mode: lost.mode, disconnectedAt: lost.disconnectedAt, reason: lost.reason,
    })),
    blind: blind.map((gap) => ({
      senseKey: gap.key, cannotSee: gap.cannotSee, wouldLearn: gap.wouldLearn,
      neverGrants: gap.neverGrants,
      offers: gap.offers.map((o) => ({
        provider: o.provider, providerName: senseSystem.providerName(o.provider),
        mode: o.mode, reads: o.reads, handsOver: o.handsOver,
      })),
    })),
    formerly, situation, decisions,
    proposals: proposals.map((p) => ({
      id: p.id, summary: p.summary, why: p.why, expectedEffect: p.expectedEffect,
      risk: p.risk, consequence: p.consequence, expiresAt: p.expiresAt.slice(0, 10),
    })),
    budgetMonthly: Number(row.operating_budget_monthly_usd ?? 0),
    spent30d: Number(row.ai_cost_trailing_30d_usd ?? 0),
    knows, gaps,
    responsibilities: responsibilities.map((r) => ({
      title: String(r.title), state: String(r.state),
    })),
    numbers, reference, asks,
  };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
foundryShellRoutes.get('/foundry/companies', async (c: any) => {
  const founder = c.get('founder') as { id?: string } | undefined;
  if (!founder?.id) return c.redirect('/onboarding');

  // YOUR companies means yours. A reference company appearing in this list
  // would put a company he does not own, and that does not exist, under a
  // heading that says both — and would make the count wrong everywhere the
  // count is read. It appears below, under its own heading, saying what it is.
  const rows = (await query(
    `SELECT id, name, created_at FROM products
      WHERE owner_id = ? AND status = 'active' AND deleted_at IS NULL
        AND ${realCompany()}
      ORDER BY created_at`, [String(founder.id)])).rows as unknown as Array<Record<string, unknown>>;

  const references = (await query(
    `SELECT p.id, p.name, r.scenario FROM products p
       JOIN reference_companies r ON r.product_id = p.id
      WHERE p.owner_id = ? AND p.status = 'active' AND ${referenceCompany('p')}
      ORDER BY p.created_at`, [String(founder.id)]))
    .rows as unknown as Array<Record<string, unknown>>;

  const { REFERENCE_SCENARIOS } = await import('../../services/reference/scenarios.js');
  const unstarted = REFERENCE_SCENARIOS.filter((sc) =>
    !references.some((r) => String(r.scenario) === sc.situation));

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
      anything or let me do anything — those are separate, and I will ask.</p>

    <div class="know" style="margin-top:var(--s5)">
      <h3>Companies I made up</h3>
      <p class="quiet">You should not have to hand me a real business to find out what I do
        with one. These are invented. I run them exactly as I would run yours — same
        numbers, same judgement, same ladder — and nothing I learn from them can ever be
        told to you as fact about a real company, or let me act in the world.</p>
      ${raw(references.map((r) => `<a class="item" href="/foundry/companies/${String(r.id)}">
        <h3>${String(r.name)}</h3>
        <p>${String(r.scenario)}</p></a>`).join(''))}
      ${raw(unstarted.map((sc) => `<form method="POST" action="/foundry/reference"
          style="margin-top:var(--s3)">
          <input type="hidden" name="scenario" value="${sc.key}" />
          <button class="btn" type="submit">Show me ${sc.situation}</button>
        </form>`).join(''))}
      ${unstarted.length === 0 && references.length === 0
    ? html`<p class="lede">None.</p>` : ''}
    </div>`;

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

/**
 * BRING A COMPANY THAT DOES NOT EXIST INTO BEING.
 *
 * This is not one of the three owner acts. It is not RECOGNITION (there is
 * nothing to recognise), not RESPONSIBILITY (nothing is being taken on), and
 * emphatically not AUTHORITY — establishing a reference company grants Foundry
 * nothing it did not already have, and the company it creates is refused at the
 * door to the world and at every place money is spent. It is setup: the owner
 * asking to be shown the work before entrusting any of his own.
 *
 * Owner-gated all the same, because it creates a row he will see.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
foundryShellRoutes.post('/foundry/reference', requireInstitutionOwner(), async (c: any) => {
  const founder = c.get('founder') as { id?: string } | undefined;
  if (!founder?.id) return c.redirect('/onboarding');
  const body = await c.req.parseBody();

  const { establishReferenceCompany } = await import('../../services/reference/world.js');
  const established = await establishReferenceCompany({
    scenarioKey: String(body.scenario ?? ''), ownerId: String(founder.id),
  });
  if (!established) return c.redirect('/foundry/companies');

  // Its first day arrives immediately, so the page he lands on has something on
  // it. Every day after this one is the job's, at the same hour as everything
  // else. Failing to advance must not fail the establishment: the company and
  // its history are already real facts about the database.
  try {
    const { advanceReferenceWorld } = await import('../../services/reference/world.js');
    await advanceReferenceWorld(established.productId);
    // And the institution looks at it, rather than making him wait for 05:00 to
    // find out whether anything here was worth noticing. The same function the
    // tick calls, on the company just created.
    const { noticeWhatTheNumbersAreDoing } = await import(
      '../../services/institution/noticing.js');
    await noticeWhatTheNumbersAreDoing(established.productId);
  } catch (err) {
    const { log } = await import('../../lib/logger.js');
    log.error(`reference world did not advance: ${err instanceof Error ? err.message : String(err)}`,
      { productId: established.productId });
  }
  return c.redirect(`/foundry/companies/${established.productId}`);
});

// eslint-disable-next-line @typescript-eslint/no-explicit-any
foundryShellRoutes.get('/foundry/companies/:id', async (c: any) => {
  const founder = c.get('founder') as { id?: string } | undefined;
  if (!founder?.id) return c.redirect('/onboarding');
  const view = await readCompany(c.req.param('id'), String(founder.id));
  // A company of someone else's and one that does not exist answer the same.
  if (!view) return c.notFound();
  const done = String(c.req.query('done') ?? '');
  // Named from the query only to decide WHICH connection to describe; every
  // word describing it comes from the connection itself.
  const justConnected = done === 'seeing'
    ? view.senses.find((sense) => sense.senseKey === String(c.req.query('sense') ?? '')) ?? null
    : null;

  const body = html`
    <h1>${view.name}</h1>
    ${view.reference ? html`<div class="know" style="border-color:var(--warn,#b45309)">
      <h3>This company does not exist</h3>
      <p>I made it up, so you could watch me work before handing me anything real.
        It is ${view.reference.situation}.</p>
      ${view.reference.premise ? html`<p class="quiet">${view.reference.premise}</p>` : ''}
      <p class="quiet">The arithmetic below is real. The numbers it runs on are invented, and
        they can never become a fact I tell you about a real company. I cannot send anything
        for it, spend anything on it, or count it as a track record.</p>
    </div>` : ''}
    ${done === 'added' ? html`<div class="done"><p><strong>Added.</strong> I know it exists and
      that it is yours. I cannot see anything about it yet.</p></div>` : ''}
    ${done === 'steered' ? html`<div class="done"><p><strong>Noted.</strong> I will weigh that
      when I decide what is worth your attention here.</p></div>` : ''}
    ${done === 'bound' ? html`<div class="done"><p><strong>Held.</strong> I will refuse that
      every time until you lift it, and tell whatever asked that you said so.</p></div>` : ''}
    ${done === 'lifted' ? html`<div class="done"><p><strong>Lifted.</strong> I am no longer
      refusing that. Nothing has happened as a result — it only means I may again.</p></div>` : ''}
    ${done === 'seeing' && justConnected ? html`<div class="done">
      <p><strong>I can see it now.</strong> ${justConnected.wouldLearn}, from
        ${justConnected.providerName}. I still cannot ${justConnected.neverGrants}.</p>
      <p class="quiet">${justConnected.lastObservedAt
    ? `Last reported ${justConnected.lastObservedAt.slice(0, 10)}.`
    : 'Nothing has reported yet. Until something does, this is a channel and not an answer, '
      + 'and I will say so rather than showing you a number I do not have.'}</p>
    </div>` : ''}
    ${done === 'blind' ? html`<div class="done"><p><strong>Disconnected.</strong> I can no
      longer see that. What I already learned stays; nothing new will arrive.</p></div>` : ''}
    ${done === 'approved' ? html`<div class="done"><p><strong>Approved.</strong> I can do that
      one thing. The boundary stays exactly as it was — I will ask again next time.</p></div>` : ''}
    ${done === 'refused' ? html`<div class="done"><p><strong>Not doing it.</strong> Nothing
      happened. I will not raise that same act again.</p></div>` : ''}
    ${done === 'recognised' ? html`<div class="done"><p><strong>Taken on.</strong> I will watch
      it and tell you what I see. I still cannot change anything.</p></div>` : ''}
    ${done === 'declined' ? html`<div class="done"><p><strong>Left alone.</strong> I will not
      raise it again. Say so and I will look at it once more.</p></div>` : ''}

    <p class="${view.situation.demandsAttention ? 'lede alarm' : 'lede'}">
      ${view.situation.headline}</p>
    ${view.situation.demandsAttention ? html`<p class="quiet">${
  view.situation.because.join('; ')}. That is what the numbers did — whether it is a problem,
      and what to do about it, is yours.</p>` : ''}

    ${view.proposals.length ? html`<div class="know">
      <h3>${view.proposals.length === 1 ? 'I need you to decide this' : 'I need you to decide these'}</h3>
      <p class="quiet">You told me not to do this without asking. I cannot do any of it until
        you say yes to that exact thing, and a yes covers only the one act described.</p>
      ${raw(view.proposals.map((p) => `<div class="noticed">
        <h4>${p.summary}</h4>
        <p><strong>Why</strong> — ${p.why}</p>
        <p><strong>What I expect</strong> — ${p.expectedEffect}</p>
        <p><strong>What could go wrong</strong> — ${p.risk}</p>
        <p class="quiet">If you do nothing, I do not do it, and this expires
          ${p.expiresAt}.</p>
        <form method="POST" action="/foundry/proposals/${p.id}/approve">
          <button class="btn go" type="submit">Approve this one thing</button>
        </form>
        <form method="POST" action="/foundry/proposals/${p.id}/refuse">
          <button class="btn" type="submit">Do not do it</button>
        </form>
      </div>`).join(''))}
    </div>` : ''}

    ${view.asks.length ? html`<div class="know">
      <h3>${view.asks.length === 1 ? 'Something I noticed' : 'Things I noticed'}</h3>
      <p class="quiet">Each of these is a movement, not a diagnosis. I am asking whether it is
        worth me looking after — I am not saying anything is wrong, and I do not know why it
        moved.</p>
      <p class="quiet">Saying yes means I watch it and tell you what I see. It does not let me
        change anything, spend anything, or contact anyone — those are separate questions I
        would have to earn and then ask.</p>
      ${raw(view.asks.map((a) => `<div class="noticed">
        <h4>Is this worth me looking after?</h4>
        <p><strong>${a.proposal}</strong></p>
        <p>${a.rationale}</p>
        <form method="POST" action="/letter/responsibility-candidates/${a.id}/promote">
          <input type="hidden" name="return_to" value="company" />
          <button class="btn go" type="submit">Yes — look after this</button>
        </form>
        <form method="POST" action="/letter/responsibility-candidates/${a.id}/reject">
          <input type="hidden" name="return_to" value="company" />
          <button class="btn" type="submit">No</button>
        </form>
      </div>`).join(''))}
    </div>` : ''}

    <div class="know">
      <h3>Where the numbers are</h3>
      ${view.numbers.absence
    ? html`<p class="lede">${view.numbers.absence}</p>`
    : html`<ul>${raw(view.numbers.numbers.map((n) =>
      `<li><strong>${n.now}</strong> — ${n.sentence}</li>`).join(''))}</ul>
      <p class="quiet">As of ${String(view.numbers.asOf)}. Movement is against the nearest
        reading to a month before that. I am telling you where things are and which way they
        are going; whether that is good is yours to say.</p>`}
    </div>

    <div class="know">
      <h3>What I know</h3>
      ${view.knows.length === 0
    ? html`<p class="lede">Almost nothing. You have told me it exists; that is all.</p>`
    : html`<ul>${raw(view.knows.map((k) => `<li>${k}</li>`).join(''))}</ul>`}
    </div>

    ${view.senses.length ? html`<div class="know">
      <h3>What I can see</h3>
      <ul>${raw(view.senses.map((sense) =>
    `<li><strong>${sense.wouldLearn}</strong> — from ${sense.providerName}${
  sense.mode === 'sandbox' ? ', in test mode, so none of it is the world'
    : sense.mode === 'reference' ? ', so none of it is real' : ''}. ${sense.lastError
  ? `<span class="gap">Something is wrong with it: ${sense.lastError}.</span> What I show you may be out of date.`
  : sense.lastObservedAt
    ? `Last reported ${sense.lastObservedAt.slice(0, 10)}.`
    : 'It has not reported yet.'}</li>`).join(''))}</ul>
      <p class="quiet">None of this lets me act. I cannot
        ${view.senses.map((sense) => sense.neverGrants).join('; ')}.</p>
      ${raw(view.senses.map((sense) =>
    `<form method="POST" action="/foundry/companies/${view.id}/senses/${sense.id}/disconnect">
      <button class="btn" type="submit">Stop seeing ${sense.shortName}</button>
    </form>`).join(''))}
    </div>` : ''}

    <div class="know">
      <h3>What I cannot see</h3>
      ${view.blind.length === 0
    ? html`<p class="lede">Nothing I know how to look at is missing.</p>`
    : raw(view.blind.map((gap) => `<p><span class="gap">I cannot see ${gap.cannotSee}.</span>
        ${gap.offers.length
  ? `Connecting ${[...new Set(gap.offers.map((o) => o.providerName))].join(' or ')} would show me ${gap.wouldLearn}.
     <a href="/foundry/companies/${view.id}/see/${gap.senseKey}">Look at that</a>`
  : `Nothing I can connect would tell me this.`}</p>`).join(''))}
      ${view.stoppedSeeing.length ? raw(view.stoppedSeeing.map((lost) =>
    `<p class="quiet">You turned off ${lost.providerName} on ${lost.disconnectedAt}
      &mdash; ${lost.reason}. <a href="/foundry/companies/${view.id}/see/${lost.senseKey}">Turn it
      back on</a>.</p>`).join('')) : ''}
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
      ${view.said
    ? html`<p>${view.said.statement}</p>
        <p class="quiet">${view.said.steers
    ? 'I weigh that when deciding what is worth your attention here.'
    : 'I could not tell which numbers that points at, so I watch all of them equally.'}</p>`
    : html`<p class="lede">You have not told me what you are trying to do with this company,
        or what I should not do. Until you do, I have no way to judge what is worth your
        attention.</p>`}
      <form class="inline" method="POST" action="/foundry/companies/${view.id}/said">
        <input type="text" name="said" required maxlength="300"
          placeholder="${view.said ? 'Say something else' : 'What matters here — or what should I not do?'}"
          aria-label="What matters for this company, or what Foundry should not do" />
        <button class="btn" type="submit">Tell me</button>
      </form>
      <p class="quiet">Tell me what this company is for, or tell me not to do something and
        I will refuse it every time until you say otherwise. I will say what I understood
        before anything takes effect.</p>
      ${view.formerly ? html`<p class="quiet">Before ${view.formerly.retiredAt} it was:
        &ldquo;${view.formerly.statement}&rdquo; — replaced because
        ${view.formerly.retiredReason}.</p>` : ''}
    </div>

    ${view.boundaries.length ? html`<div class="know">
      <h3>What you told me not to do</h3>
      ${raw(view.boundaries.map((b) => `<div class="noticed">
        <p><strong>${b.statement}</strong></p>
        <p class="quiet">${b.mode === 'ask_first'
    ? `I will not ${b.ownerWords}${b.everywhere ? ', for any company' : ''} without asking you
       first and being told yes to that exact thing.`
    : `I will not ${b.ownerWords}${b.everywhere ? ', for any company' : ''}.`}
          ${b.enforcedNow
    ? 'Refused at the point I would act, not by me remembering.'
    : 'I have no way to do that today in any case.'}</p>
        <form method="POST" action="/foundry/companies/${view.id}/boundaries/${b.id}/lift">
          <button class="btn" type="submit">Lift this</button>
        </form>
      </div>`).join(''))}
    </div>` : ''}

    ${view.decisions.length ? html`<div class="know">
      <h3>What you decided</h3>
      <ul>${raw(view.decisions.map((d) =>
    `<li><strong>${d.summary}</strong> — ${
  d.outcome === 'approved' ? (d.used ? 'you approved it and I did it' : 'you approved it; I have not done it yet')
    : d.outcome === 'refused' ? 'you said no, and nothing happened'
      : `you took the approval back${d.note ? ` — ${d.note}` : ''}, before I used it`
} on ${d.at}.</li>`).join(''))}</ul>
    </div>` : ''}

    ${view.lifted.length ? html`<div class="know">
      <h3>What you lifted</h3>
      <p class="quiet">Changing your mind runs both ways. These are no longer in force.</p>
      ${raw(view.lifted.map((b) => `<div class="noticed">
        <p>${b.statement}</p>
        <p class="quiet">Lifted ${b.liftedAt} — ${b.liftedReason}.</p>
        <form method="POST" action="/foundry/companies/${view.id}/said/confirm">
          <input type="hidden" name="said" value="${b.statement}" />
          <button class="btn" type="submit">Hold me to this again</button>
        </form>
      </div>`).join(''))}
    </div>` : ''}

    <div class="know">
      <h3>Money</h3>
      ${view.reference
    ? html`<p class="lede">None, and none ever. I am refused at every place money is spent
        for a company that does not exist, so it cannot draw on what the real ones share.</p>`
    : html`<ul><li>$${view.spent30d.toFixed(2)} spent of
        $${String(view.budgetMonthly)} a month.</li></ul>`}
    </div>`;

  return c.html(page(view.name, body, 'companies'));
});

// ─── being asked ────────────────────────────────────────────────────────────

/**
 * THE OTHER HALF OF "ASK ME FIRST".
 *
 * A boundary that only ever refuses is a boundary the owner eventually lifts
 * out of frustration, which is the worst outcome: he removes a control because
 * the institution had no way to work inside it. So when he has said "not
 * without asking", Foundry proposes — in full, in advance — and this is where
 * he answers.
 *
 * The decision is bound to HIM (the database checks `founder:<owner>` against
 * the company), to THIS act (the parameters are fingerprinted), and it is spent
 * once. Approving one message does not open the door for the next one.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
foundryShellRoutes.post('/foundry/proposals/:proposalId/:decision',
  requireInstitutionOwner(), async (c: any) => {
    const founder = c.get('founder') as { id?: string } | undefined;
    if (!founder?.id) return c.redirect('/onboarding');
    const decision = c.req.param('decision');
    if (decision !== 'approve' && decision !== 'refuse') return c.notFound();

    // The company is resolved from the proposal and the authenticated owner. A
    // proposal for anyone else's company is refused without revealing it exists.
    const owned = await query(
      `SELECT a.id, a.product_id FROM proposed_acts a
         JOIN products p ON p.id = a.product_id
        WHERE a.id = ? AND p.owner_id = ? AND a.decision IS NULL`,
      [c.req.param('proposalId'), String(founder.id)]);
    if (!owned.rows.length) return c.notFound();
    const productId = String((owned.rows[0] as Record<string, unknown>).product_id);

    const { decideProposedAct } = await import('../../services/institution/standing-intent.js');
    const { principalRef } = await import('../../services/outbound/acting-principal.js');
    await decideProposedAct({
      id: c.req.param('proposalId'),
      decision: decision === 'approve' ? 'approved' : 'refused',
      // BUILT FROM THE SESSION, NEVER FROM THE REQUEST. The database checks it
      // against the company's actual owner regardless, which is the belt to
      // this brace.
      decidedBy: principalRef('founder', String(founder.id)),
    });
    return c.redirect(
      `/foundry/companies/${productId}?done=${decision === 'approve' ? 'approved' : 'refused'}`);
  });

// ─── letting Foundry see something ──────────────────────────────────────────

/**
 * THE SEAM THAT HAD TO DISAPPEAR.
 *
 * The company page said "I cannot see its code" and linked to
 * `/agents/integrations` — a technical surface about providers, scopes and
 * credentials, arrived at from a sentence about understanding. The owner cannot
 * answer "which integrations do you want". He can answer "may I see your
 * revenue".
 *
 * So a connection starts from what Foundry CANNOT KNOW, and every offer states
 * both halves of the rule that governs this institution: what it would let
 * Foundry understand, and what it would never let Foundry do. The second half
 * is not reassurance written into a template — it is constitutional, immutable,
 * and stored verbatim on the connection so that a later change to the wording
 * cannot retroactively alter what he agreed to.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
foundryShellRoutes.get('/foundry/companies/:id/see/:sense',
  requireInstitutionOwner(), async (c: any) => {
    const founder = c.get('founder') as { id?: string } | undefined;
    if (!founder?.id) return c.redirect('/onboarding');
    const productId = c.req.param('id');
    const owned = await query('SELECT id, name FROM products WHERE id = ? AND owner_id = ?',
      [productId, String(founder.id)]);
    if (!owned.rows.length) return c.notFound();
    const name = String((owned.rows[0] as Record<string, unknown>).name);

    const senses = await import('../../services/senses/index.js');
    const gap = (await senses.whatItCannotSee(productId))
      .find((g) => g.key === c.req.param('sense'));
    if (!gap) return c.redirect(`/foundry/companies/${productId}`);

    const body = html`
      <h1>Let me see ${gap.cannotSee}?</h1>
      <p class="lede">Right now I cannot, so anything I told you about it would be invented.</p>

      <div class="know">
        <h3>What I would understand</h3>
        <p>${gap.wouldLearn}, for ${name}.</p>
      </div>
      <div class="know">
        <h3>What it would still not let me do</h3>
        <p><strong>${gap.neverGrants}.</strong> Seeing something is not permission to change
          it. That is always a separate question, and I would have to earn it and then ask.</p>
      </div>

      ${gap.offers.length === 0 ? html`<div class="know">
        <h3>Nothing I can connect</h3>
        <p class="lede">There is no source I know of that would tell me this. I am saying so
          rather than leaving the gap unexplained.</p>
      </div>` : raw(gap.offers.map((offer) => `<div class="noticed">
        <h4>${senses.providerName(offer.provider)}${offer.mode === 'sandbox' ? ' — test mode' : ''}</h4>
        <p>Reads ${offer.reads}.</p>
        <p class="quiet">${offer.handsOver}.</p>
        ${offer.mode === 'sandbox'
    ? '<p class="quiet">Test mode runs everything the real connection runs against numbers '
      + 'that are not the world&rsquo;s. I will never count what I learn here as proof '
      + 'about a real business.</p>' : ''}
        <form method="POST" action="/foundry/companies/${productId}/see/${gap.key}">
          <input type="hidden" name="provider" value="${offer.provider}" />
          <input type="hidden" name="mode" value="${offer.mode}" />
          <button class="btn go" type="submit">Let me see ${gap.cannotSee}</button>
        </form>
      </div>`).join(''))}

      <a class="btn" href="/foundry/companies/${productId}">Not now</a>`;
    return c.html(page(`See ${gap.cannotSee}`, body, 'companies'));
  });

/**
 * CONNECT IT — AND SAY WHAT ACTUALLY CHANGED.
 *
 * "Integration connected" is a fact about software. What the owner needs to
 * know is that Foundry's understanding changed: which numbers it can now read,
 * and what it still cannot see. The provider, sense and mode are all re-derived
 * from the constitutional vocabulary here; the form carries a choice, never a
 * disclosure.
 *
 * WHAT THIS DOES NOT DO: hold a credential. A real provider still needs its own
 * authorization, and this route refuses to pretend otherwise — a sense
 * connected without one is recorded as connected and reports nothing, which the
 * company page then says out loud. That is the honest state, and it is exactly
 * the state a real credential later replaces.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
foundryShellRoutes.post('/foundry/companies/:id/see/:sense',
  requireInstitutionOwner(), async (c: any) => {
    const founder = c.get('founder') as { id?: string } | undefined;
    if (!founder?.id) return c.redirect('/onboarding');
    const productId = c.req.param('id');
    const owned = await query('SELECT id, name FROM products WHERE id = ? AND owner_id = ?',
      [productId, String(founder.id)]);
    if (!owned.rows.length) return c.notFound();
    const name = String((owned.rows[0] as Record<string, unknown>).name);

    const form = await c.req.parseBody();
    const senses = await import('../../services/senses/index.js');
    const mode = String(form.mode ?? '');
    if (mode !== 'real' && mode !== 'sandbox' && mode !== 'reference') {
      return c.redirect(`/foundry/companies/${productId}`);
    }
    const connected = await senses.connectSense({
      productId, companyName: name, senseKey: c.req.param('sense'),
      provider: String(form.provider ?? ''), mode,
    });
    if (!connected) return c.redirect(`/foundry/companies/${productId}`);
    return c.redirect(`/foundry/companies/${productId}?done=seeing&sense=${c.req.param('sense')}`);
  });

/** Stop seeing it. The reason is Foundry's; he does not owe one. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
foundryShellRoutes.post('/foundry/companies/:id/senses/:senseId/disconnect',
  requireInstitutionOwner(), async (c: any) => {
    const founder = c.get('founder') as { id?: string } | undefined;
    if (!founder?.id) return c.redirect('/onboarding');
    const productId = c.req.param('id');
    const owned = await query(
      `SELECT s.id FROM company_senses s JOIN products p ON p.id = s.product_id
        WHERE s.id = ? AND p.owner_id = ? AND s.disconnected_at IS NULL`,
      [c.req.param('senseId'), String(founder.id)]);
    if (!owned.rows.length) return c.notFound();
    const { disconnectSense } = await import('../../services/senses/index.js');
    await disconnectSense(c.req.param('senseId'), 'the owner disconnected it');
    return c.redirect(`/foundry/companies/${productId}?done=blind`);
  });

// ─── what the owner said ────────────────────────────────────────────────────

/**
 * ONE FIELD, IN HIS WORDS, FOR TWO DIFFERENT ACTS.
 *
 * The owner does not think in objects. He thinks in sentences: "focus on
 * retention", "don't contact anyone", "get the first ten paying customers". A
 * form with an Objective box and a Boundary box would make him classify his own
 * instruction before giving it, which is the institution's job.
 *
 * So one field reads the sentence and says what it understood — and NOTHING IS
 * BOUND HERE. This renders a confirmation showing exactly what will happen, and
 * only the confirm below writes anything. A boundary is a governance control:
 * he has to be able to predict the resulting state before it binds.
 *
 * NO CAPABILITY GATE, AND THE REASON, because the route-guard gate asks.
 * Reading a sentence back to the owner grants Foundry nothing and changes
 * nothing. Ownership is checked server-side regardless — a company id for
 * anyone else is refused as not found without revealing that it exists.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
foundryShellRoutes.post('/foundry/companies/:id/said',
  requireInstitutionOwner(), async (c: any) => {
  const founder = c.get('founder') as { id?: string } | undefined;
  if (!founder?.id) return c.redirect('/onboarding');
  const productId = c.req.param('id');
  const owned = await query(
    'SELECT id, name FROM products WHERE id = ? AND owner_id = ?', [productId, String(founder.id)]);
  if (!owned.rows.length) return c.notFound();
  const name = String((owned.rows[0] as Record<string, unknown>).name);

  const form = await c.req.parseBody();
  const said = String(form.said ?? '').trim().slice(0, 300);
  if (!said) return c.redirect(`/foundry/companies/${productId}`);

  const intent = await import('../../services/institution/standing-intent.js');
  const proposal = intent.interpret(said);

  if (proposal.kind === 'unclear') {
    // TAUGHT IN ONE INTERACTION, RATHER THAN IN A GLOSSARY. He sees what it can
    // hold at the moment he needed it, which is the only moment it is useful.
    const subjects = await intent.everySubject();
    return c.html(page('What you said', html`
      <h1>I did not follow that</h1>
      <p class="lede">You said: <strong>${said}</strong></p>
      <p>${proposal.because}.</p>
      <div class="know">
        <h3>What I can hold you to</h3>
        <p class="quiet">Tell me not to do any of these and I will refuse, every time,
          until you say otherwise.</p>
        <ul>${raw(subjects.map((sub) => `<li>${sub.ownerWords}</li>`).join(''))}</ul>
      </div>
      <div class="know">
        <h3>Or tell me what matters</h3>
        <p class="quiet">Anything else you say about what this company is for, I will keep,
          and I will weigh it when deciding what is worth your attention.</p>
      </div>
      <a class="btn" href="/foundry/companies/${productId}">Back to ${name}</a>`, 'companies'));
  }

  if (proposal.kind === 'boundary') {
    const facts = await intent.subjectFacts(proposal.subject);
    return c.html(page('What you said', html`
      <h1>Hold you to this?</h1>
      <p class="lede">You said: <strong>${said}</strong></p>
      <div class="know">
        <h3>What I will do</h3>
        ${proposal.mode === 'ask_first'
    ? html`<p>I will not ${facts?.ownerWords ?? proposal.subject} for ${name} without asking
        you first. When I think it should happen I will tell you exactly what I intend to do,
        why, what I expect, and what could go wrong — and I will not be able to do it until
        you approve that particular thing.</p>`
    : html`<p>I will not ${facts?.ownerWords ?? proposal.subject} for ${name}. Every time,
        without exception, until you lift it.</p>`}
        ${facts?.door == null
    ? html`<p class="quiet">I have no way to do that today, so this is already true.
        I am recording it anyway, so that if I ever can, I will not.</p>`
    : html`<p class="quiet">This is enforced at the point I would act, not by me
        remembering. Anything that tries will be refused and told why.</p>`}
        <ul>
          <li><strong>Cost</strong> — nothing.</li>
          <li><strong>How long</strong> — until you lift it.</li>
          <li><strong>Undo</strong> — one tap, on this company's page.</li>
          ${proposal.mode === 'ask_first'
    ? html`<li><strong>An approval covers one act</strong> — exactly the one I described,
        and it is spent once. It does not open the door for the next one.</li>` : ''}
        </ul>
      </div>
      <form method="POST" action="/foundry/companies/${productId}/said/confirm">
        <input type="hidden" name="said" value="${said}" />
        <button class="btn go" type="submit">Yes — hold me to that</button>
      </form>
      <form method="POST" action="/foundry/companies/${productId}/said/confirm">
        <input type="hidden" name="said" value="${said}" />
        <input type="hidden" name="as" value="objective" />
        <button class="btn" type="submit">No — just remember I said it</button>
      </form>`, 'companies'));
  }

  return c.html(page('What you said', html`
    <h1>Understood</h1>
    <p class="lede">You said: <strong>${said}</strong></p>
    <div class="know">
      <h3>What I will do</h3>
      <p>I will treat that as what ${name} is for right now.</p>
      ${proposal.channels.length
    ? html`<p class="quiet">I will weigh ${proposal.concerns.join(' and ')} more heavily when
        deciding what is worth your attention here, and raise other things only when they
        move far enough that staying quiet would be wrong.</p>`
    : html`<p class="quiet">I could not tell which of this company's numbers that points at,
        so I will keep watching all of them equally. That is not a refusal — I have kept
        what you said, and it is what I will show you when you ask what this company is for.</p>`}
      <ul>
        <li><strong>Cost</strong> — nothing.</li>
        <li><strong>What I could change</strong> — nothing. This changes what I raise, not what I may do.</li>
        <li><strong>Undo</strong> — say something else and this is replaced.</li>
      </ul>
    </div>
    <form method="POST" action="/foundry/companies/${productId}/said/confirm">
      <input type="hidden" name="said" value="${said}" />
      <button class="btn go" type="submit">Yes — that is right</button>
    </form>
    <a class="btn" href="/foundry/companies/${productId}">No — leave it</a>`, 'companies'));
});

/**
 * BIND IT — AND RE-READ THE SENTENCE HERE RATHER THAN TRUSTING THE FORM.
 *
 * The confirmation carries his words and nothing else. The subject, the
 * channels and the kind are derived again, server-side, from those words. A
 * form field naming a subject would be a caller asserting what binds, and the
 * one thing a governance control must never take from a request is what it
 * governs.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
foundryShellRoutes.post('/foundry/companies/:id/said/confirm',
  requireInstitutionOwner(), async (c: any) => {
    const founder = c.get('founder') as { id?: string } | undefined;
    if (!founder?.id) return c.redirect('/onboarding');
    const productId = c.req.param('id');
    const owned = await query('SELECT id FROM products WHERE id = ? AND owner_id = ?',
      [productId, String(founder.id)]);
    if (!owned.rows.length) return c.notFound();

    const form = await c.req.parseBody();
    const said = String(form.said ?? '').trim().slice(0, 300);
    if (!said) return c.redirect(`/foundry/companies/${productId}`);

    const intent = await import('../../services/institution/standing-intent.js');
    const proposal = intent.interpret(said);

    // He read a boundary and chose to keep it as a note instead. His sentence
    // is kept verbatim either way; only what it binds differs.
    const asObjective = String(form.as ?? '') === 'objective';

    if (proposal.kind === 'boundary' && !asObjective) {
      await intent.setBoundary({
        productId, subject: proposal.subject, statement: said, mode: proposal.mode,
      });
      return c.redirect(`/foundry/companies/${productId}?done=bound`);
    }
    if (proposal.kind === 'unclear') return c.redirect(`/foundry/companies/${productId}`);

    await intent.setObjective({
      productId, statement: said,
      channels: proposal.kind === 'objective' ? proposal.channels : [],
    });
    return c.redirect(`/foundry/companies/${productId}?done=steered`);
  });

/**
 * LIFT ONE. The reason is Foundry's, not his: he does not owe an explanation
 * for changing his mind about his own company, and a required free-text box
 * before undoing something is a dark pattern with a compliance excuse.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
foundryShellRoutes.post('/foundry/companies/:id/boundaries/:boundaryId/lift',
  requireInstitutionOwner(), async (c: any) => {
    const founder = c.get('founder') as { id?: string } | undefined;
    if (!founder?.id) return c.redirect('/onboarding');
    const productId = c.req.param('id');
    // The boundary must be one this authenticated owner set, resolved from the
    // join rather than from the URL. A global boundary is his by definition and
    // is reached through whichever company he happened to be looking at.
    //
    // NO REALITY PREDICATE HERE, DELIBERATELY. This reads no company answer: it
    // binds one BOUNDARY by id and asks only who owns the company it names. A
    // boundary set on a reference company must be liftable exactly as any other
    // is, and scoping this to real companies would strand it — the one shape
    // that predicate must never take.
    const owned = await query(
      `SELECT b.id FROM owner_boundaries b
         LEFT JOIN products p ON p.id = b.product_id
        WHERE b.id = ? AND b.lifted_at IS NULL
          AND (b.product_id IS NULL OR p.owner_id = ?)`,
      [c.req.param('boundaryId'), String(founder.id)]);
    if (!owned.rows.length) return c.notFound();

    const { liftBoundary } = await import('../../services/institution/standing-intent.js');
    await liftBoundary(c.req.param('boundaryId'), 'the owner lifted it');
    return c.redirect(`/foundry/companies/${productId}?done=lifted`);
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
