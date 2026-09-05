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
import { money } from '../../services/founder/portfolio.js';
import { selectedProductId } from '../../services/founder/selected-company.js';
import { requireInstitutionOwner } from '../../middleware/rbac.js';
import type { CompanyNumbers } from '../../services/founder/what-the-numbers-say.js';
import type { VentureReading } from '../../services/venture/mandate.js';
import { OWNER_SURFACE_SCRIPT } from '../../lib/owner-surface-script.js';
import { log as logger } from '../../lib/logger.js';
import { reportError } from '../../lib/error-reporter.js';
import { LAYER_IN_PLAIN_WORDS, layerOf } from '../../lib/repository-layers.js';

export const foundryShellRoutes = new Hono();

/**
 * WHEN SOMETHING BREAKS, HE STAYS IN HIS OWN PRODUCT.
 *
 * A 404 or an unhandled failure anywhere under /foundry rendered the public
 * marketing shell: a logged-out header, a "Get Started" button pointing at
 * sign-up, a command palette offering Fleet Observatory and Agent Debate, and
 * the dark stylesheet of the product this one replaced. Eight kilobytes of a
 * company he is not a customer of, shown to the only person who owns it.
 *
 * The same voice as everything else here, and one way back. It says what is and
 * is not true of his records, because that is the question a failure raises.
 */
export function ownerFailurePage(
  title: string, sentence: string,
): HtmlEscapedString | Promise<HtmlEscapedString> {
  return page('Foundry', html`
    <h1>${title}</h1>
    <p class="lede">${sentence}</p>
    <p class="quiet">Nothing of yours has changed. I have not acted on anything, and I
      have not lost anything — I could not show you a page.</p>
    <a class="btn go" href="/foundry">Back to Foundry</a>`, 'foundry');
}

// THE GUARD BY CONSTRUCTION, NOT BY MEMORY.
//
// Twenty of twenty-four routes named `requireInstitutionOwner()` themselves and
// four did not — /foundry, /foundry/companies, /foundry/companies/:id and
// /foundry/controls, every one of them a page that renders his institution.
// They were covered by the session middleware alone, and their handlers happen
// to scope their reads to the requesting founder, so nothing leaked. But
// "happens to" is the whole problem: the next route added here would have been
// guarded only if somebody remembered.
//
// Registered once, ahead of every handler in this file, so being under /foundry
// is what makes a route the owner's rather than an argument somebody passed.
foundryShellRoutes.use('/foundry', requireInstitutionOwner());
foundryShellRoutes.use('/foundry/*', requireInstitutionOwner());

// AND A BOUNDARY AROUND ALL OF IT, FOR THE SAME REASON.
//
// Two of twenty-four handlers had a try/catch and both wrapped a single call.
// A company page makes thirty-five database round-trips and guarded none of
// them. Anything that threw left this file entirely and landed on the global
// handler, which renders the marketing shell. Registered here, so the next
// handler added is covered by being in this file rather than by being
// remembered.
foundryShellRoutes.onError((err, c) => {
  logger.error('The owner surface could not render a page', {
    error: err instanceof Error ? err.message : String(err),
    stack: err instanceof Error ? err.stack : undefined,
    path: c.req.path,
  });
  return c.html(ownerFailurePage(
    'I cannot reach my own records',
    'Something went wrong on my side while I was putting this page together.'), 500);
});

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
  /** Searches he called off, so starting again does not begin from nothing. */
  pastSearches: Array<{ statement: string; closedAt: string; why: string }>;
  /** A venture search, if one is running, and where it honestly is. */
  /**
   * WHEN THERE IS NO SEARCH AT ALL.
   *
   * A defect found in production rather than in a test: the whole search card
   * is absent until a search exists, so an owner who has never started one is
   * shown nothing about it — no sign that Foundry could look for another asset,
   * no sign that it has working eyes ready, and no way to begin. The route to
   * start one existed and nothing on any screen offered it.
   *
   * One sentence and one box. Not a panel of options: the act is his and it is
   * a sentence, so the product should ask for a sentence.
   */
  notLooking: { canSeeThrough: string[] } | null;
  /**
   * WHAT HIS OWN COMPANIES ARE ASKING OF HIM, ranked by what is at stake.
   *
   * The first screen never read `proposed_acts` at all: they were rendered in
   * exactly one place, inside a company's own page. So a company asking for
   * $400 was invisible until he happened to open it, while the institution's
   * housekeeping held the front of the queue. Money his own asset wants is not
   * a footnote to Foundry looking after itself.
   */
  asked: import('../../services/institution/standing-intent.js').AskedOfHim[];
  /**
   * TESTS HE APPROVED THAT NOBODY HAS ACCOUNTED FOR.
   *
   * The institution sealed what it expected before each of these ran, and had
   * no path by which the answer ever came back. An unaccounted commitment
   * outranks a new one: taking on a second while the first is unresolved is
   * exactly the pattern that fills a portfolio with things nobody examined.
   */
  owed: import('../../services/institution/calibration.js').AwaitingAnswer[];
  /** How often this institution has been right before, when it has been graded. */
  record: string;
  search: {
    /**
     * WHETHER THIS SEARCH IS ONE HE ASKED FOR OR ONE FOUNDRY MADE UP.
     *
     * A rehearsal search looks identical to a real one on this card, and an
     * owner who could not tell them apart would read invented candidates as
     * findings about a real market. That is the single thing the reference
     * world exists to prevent, so the card says which it is.
     */
    invented: boolean;
    statement: string; guidance: string[]; looked: number; rejected: number;
    open: number; blocked: string | null; wouldNeed: string | null;
    /** The ways of looking it currently has, named. */
    seeingThrough: string[];
    /** What it still cannot answer even with those. */
    stillDark: string[];
    /** How much is being looked into privately, as one line. Never a list. */
    privately: string | null;
    /** What this search is for and what it has tried, in one quiet line. */
    brief: string | null;
    /** Whether adding anything is the right move, asked before any candidate. */
    another: {
      recommend: boolean; because: string; concentrations: string[];
    };
    /** What has already been turned down or taken forward, with the reason. */
    decided: string[];
    /** What the portfolio needs, derived from what it is concentrated on. */
    needs: string[];
    candidates: Array<{
      id: string;
      headline: string; whoHasIt: string; theProblem: string; whyItMight: string;
      killThesis: string; unknowns: string[]; sources: string[];
      blockedBy: string | null; failsBecause: string | null;
      /** What adding it would do to what he already owns. */
      fit: string | null; worseForThePortfolio: boolean;
      /** Preferences of his it does not meet. His to weigh, not disqualifying. */
      against: string[];
      /** Which stated portfolio needs it would serve. */
      serves: string[];
      /** Something like it that was buried before, and why. */
      buriedBefore: string | null;
      /** WHAT SOMEBODY ACTUALLY WROTE, and separately what Foundry made of it.
       * Never merged: the quote is the only evidence in the whole card that
       * came from outside this institution, and a candidate that shows its
       * reading without showing the sentence is asking to be trusted. */
      cameFrom: { said: string; reading: string; misreadIf: string | null } | null;
      /** The legal picture, one paragraph, and each exposure in a line. */
      legalProfile: string;
      exposures: string[];
      /** How it would earn and reach people, as declared: form, price, channel. */
      earns: string | null;
      /** The burden it would carry, as declared, or null when nobody has said. */
      burden: string | null;
      /** The maximum he could lose on the cheapest test, or null when no test waits. */
      downside: string | null;
      /** Foundry's one-line recommendation, from the rules already applied. */
      recommendation: string;
      /**
       * WHETHER THIS ONE HAS EARNED HIS ATTENTION.
       *
       * Every candidate rendered its whole dossier on the first screen — who
       * has the problem, how it earns, its burden, its legal surface, what it
       * would take, its kill thesis, what is unknown. Three of those at once
       * made the first screen a hundred and eleven lines deep, and not one of
       * them was asking him for anything: all three said "not yet".
       *
       * A candidate has earned his attention when Foundry is actually asking
       * him to act on it. Until then it is work in progress, and work in
       * progress is a count, not a dossier.
       */
      earnedAttention: boolean;
      /** What carrying it would take, one line per capability. */
      wouldTake: string[];
      /** Claims about the world and how each stands on its evidence. */
      standing: string[];
      /** How it was researched, collapsed into judgment — never sources. */
      research: Array<{ judgment: string; contradicts: string[]; coverage: string[] }>;
      /** Open questions, each with the cheapest thing that would settle it. */
      unanswered: string[];
      /** Whether reading more would change anything, in one sentence. */
      lookNext: string;
      readingIsDone: boolean;
      /** What would have to be true before this could become a company. */
      inTheWay: string[];
      /** A test waiting on him, with the prediction he would be approving. */
      awaiting: Array<{
        id: string; whatWeDo: string; whatWeExpect: string;
        wouldDisprove: string; cost: string;
      }>;
      reference: boolean;
    }>;
  } | null;
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
  /**
   * WHAT HAPPENED WHILE HE WAS AWAY.
   *
   * The fifth of the five questions the first screen is supposed to answer, and
   * the one it has never been able to: nothing anywhere recorded that he had
   * been here, so there was no "since" to measure anything against.
   */
  changed: { changes: Array<{ said: string }>; more: number };
  /**
   * WHAT FOUNDRY IS ACTUALLY LOOKING AFTER.
   *
   * The first screen said "I am set up, and I have not learned anything about
   * you yet" with two companies live in the portfolio, because it asked about
   * routines and never about companies. He could spend an afternoon exploring
   * and come back to a home screen that had not noticed.
   *
   * Invented companies are counted separately and never folded into the real
   * ones — the whole point of them is that they are not his.
   */
  watching: { real: number; itself: boolean; invented: number };
  routinesFailing: string[];
  checks: Array<{ check: string; result: string; detail: string; observedAt: string }>;
  responsibilities: Array<{ id: string; title: string; state: string; check: string | null }>;
  pendingCandidates: Array<{ id: string; proposal: string; check: string | null }>;
  /**
   * WHAT FOUNDRY WOULD HAVE TO ACQUIRE TO CARRY SOMETHING IT CANNOT.
   *
   * A capability it does not have is not a stop and it is not a technical
   * detail: it is one decision, with the route, what it costs, and — the part
   * that matters — what having it would still never permit on its own.
   */
  acquisitions: Array<{
    id: string; capabilityKey: string; whatItDoes: string; rung: string;
    route: string; provider: string; costNote: string; because: string;
    sentence: string;
  }>;
  permissions: Array<{ id: string; what: string; until: string; path: string | null }>;
  declined: Array<{ id: string; title: string }>;
  grantable: Array<{ responsibilityId: string; title: string; check: string;
    path: string; verification: string[]; matched: number; wrong: number;
    /** WHICH OF THE THREE THINGS CALLED FOUNDRY this change would touch. */
    layer: string; layerPlainly: string }>;
  /**
   * WHAT HE SET, OR NULL BECAUSE HE HAS NOT.
   *
   * This was rendered as "the limit you set", and nothing in the system has
   * ever written to the column — it is a migration default of 50, attributed to
   * him as his own decision on a page about what he has told Foundry it may do.
   */
  budgetMonthly: number | null;
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
  productId: string | null, founderName: string, founderId: string,
): Promise<OwnerState> {
  // Every self-maintenance read below is scoped to a company. With none, they
  // are all honestly empty, and the institutional half of the page — what needs
  // him across everything he owns — is unaffected.
  const self = productId ?? '';
  const product = productId === null ? undefined : (await query(
    `SELECT name, created_at, operating_budget_monthly_usd, ai_cost_trailing_30d_usd, github_repo_url
       FROM products WHERE id = ?`, [self])).rows[0] as Record<string, unknown> | undefined;

  const { getSelfCheckStanding } = await import(
    '../../services/institution/development-observation.js');
  const { getPendingResponsibilityCandidates } = await import(
    '../../services/institution/responsibility-candidate.js');

  const checks = await getSelfCheckStanding(self);
  const candidates = await getPendingResponsibilityCandidates(self);

  // A responsibility's own check, read from the evidence that created it, so one
  // name follows the thing from noticing through to permission.
  const responsibilities = (await query(
    `SELECT r.id, r.title, r.state, json_extract(e.payload_json,'$.check') AS check_name
       FROM institutional_responsibilities r
       LEFT JOIN signal_events e ON ('signal_event:' || e.id) = r.discovery_evidence_ref
        AND e.product_id = r.product_id
      WHERE r.product_id = ? AND r.disposition = 'active'
      ORDER BY r.created_at`, [self])).rows as unknown as Array<Record<string, unknown>>;

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
      ORDER BY expires_at`, [self])).rows as unknown as Array<Record<string, unknown>>;

  // What he turned down, so refusal is reversible rather than a dead end. The
  // database always allowed reconsidering; nothing ever offered it.
  const declined = (await query(
    `SELECT id, proposed_responsibility FROM responsibility_candidates
      WHERE product_id = ? AND status = 'rejected' ORDER BY updated_at DESC LIMIT 5`,
    [self])).rows as unknown as Array<Record<string, unknown>>;

  // What Foundry could be permitted to do, and the evidence it would be
  // permitted on. Read here so the authority request lives where he already is
  // rather than behind a door he no longer has.
  const { listGrantableDevelopmentResponsibilities } = await import(
    '../../services/institution/development-authority.js');
  const { SELF_MAINTENANCE_SCOPES } = await import(
    '../../services/foundry/self-observation.js');
  const offerable = await listGrantableDevelopmentResponsibilities(self);
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
    // WHAT HE IS ACTUALLY AGREEING TO CHANGE.
    //
    // "Foundry" means three things — his institution, the source that
    // constitutes it, and a commercial product that does not exist — and a
    // permission to change a file says nothing about which. Before he grants
    // anything, the path is classified and stated in words, so "improve my
    // experience" and "change the shared institution any future Foundry would
    // be built from" can never be the same tap.
    const layer = layerOf(scope.path) ?? 'kernel';
    grantable.push({
      responsibilityId: g.responsibilityId, title: g.title, check: g.check,
      path: scope.path, verification: scope.verification,
      matched: of('matched'), wrong: of('deviated'),
      layer, layerPlainly: LAYER_IN_PLAIN_WORDS[layer],
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

  // READ ONCE. `mandateProgress` assembles the whole search — its guidance, its
  // candidates, what it can and cannot see — and it ran twice on every render
  // of the first screen, because two fields each asked for it independently.
  const { mandateProgress } = await import('../../services/venture/mandate.js');
  const searchNow = await mandateProgress(founderId);

  return {
    productId: self,
    ownerId: founderId,
    asked: await (async () => {
      const { whatIsBeingAskedOf } = await import(
        '../../services/institution/standing-intent.js');
      return whatIsBeingAskedOf(founderId);
    })(),
    owed: await (async () => {
      const { awaitingAnswer } = await import(
        '../../services/institution/calibration.js');
      return awaitingAnswer(founderId);
    })(),
    record: await (async () => {
      const { howOftenRight } = await import(
        '../../services/institution/calibration.js');
      return (await howOftenRight(founderId)).sentence;
    })(),
    companyName: String(product?.name ?? 'this company'),
    firstName: founderName.split(' ')[0] || '',
    routinesHealthy: Number(health?.n ?? 0),
    changed: await (async () => {
      const { markVisit, whatChangedSince } = await import(
        '../../services/founder/what-changed.js');
      return whatChangedSince(founderId, await markVisit(founderId));
    })(),
    watching: await (async () => {
      // FOUNDRY IS A COMPANY, AND IT IS NOT ONE OF HIS BUSINESSES.
      //
      // The constitution is explicit that Foundry is a real owner-controlled
      // company and that running itself is genuine evidence — so it is not
      // excluded from the portfolio, and its own page still works. But saying
      // "I am looking after 1 company" over an empty portfolio, when the one
      // company is the thing saying it, is a category error at the centre of
      // the product: the institution counted as a tributary of its own river.
      //
      // Counted, and named. He is told what it is looking after and that one of
      // them is itself, which is both true statements at once.
      const counted = (await query(
        `SELECT SUM(CASE WHEN ${realCompany('p')}
                    AND p.id NOT IN (SELECT product_id FROM system_identities
                                      WHERE identity_key = 'foundry')
                    THEN 1 ELSE 0 END) AS real,
                SUM(CASE WHEN ${realCompany('p')}
                    AND p.id IN (SELECT product_id FROM system_identities
                                  WHERE identity_key = 'foundry')
                    THEN 1 ELSE 0 END) AS itself,
                SUM(CASE WHEN ${referenceCompany('p')} THEN 1 ELSE 0 END) AS invented
           FROM products p
          WHERE p.owner_id = ? AND p.status = 'active' AND p.deleted_at IS NULL`,
        [founderId])).rows[0] as Record<string, unknown> | undefined;
      return {
        real: Number(counted?.real ?? 0),
        itself: Number(counted?.itself ?? 0) > 0,
        invented: Number(counted?.invented ?? 0),
      };
    })(),
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
    acquisitions: await (async () => {
      const { acquisitionsAwaiting } = await import('../../services/institution/acquisition.js');
      return (await acquisitionsAwaiting(founderId)).map((a) => ({
        id: a.id, capabilityKey: a.capabilityKey, whatItDoes: a.whatItDoes,
        rung: a.rung, route: a.route, provider: a.provider, costNote: a.costNote,
        because: a.because, sentence: a.sentence,
      }));
    })(),
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
    budgetMonthly: product?.operating_budget_monthly_usd == null ? null
      : Number(product.operating_budget_monthly_usd),
    spent30d: Number(product?.ai_cost_trailing_30d_usd ?? 0),
    connectedSenses: product?.github_repo_url ? ['its code'] : [],
    establishedAt: product?.created_at == null ? null : String(product.created_at).slice(0, 10),
    elsewhere: await questionsElsewhere(founderId, productId),
    pastSearches: await (async () => {
      const { pastSearches } = await import('../../services/venture/mandate.js');
      return pastSearches(founderId);
    })(),
    notLooking: await (async () => {
      const { mandateProgress } = await import('../../services/venture/mandate.js');
      if (await mandateProgress(founderId) !== null) return null;
      const { waysOfLooking } = await import('../../services/venture/research-sources.js');
      const ways = await waysOfLooking(founderId, 'real');
      // WHAT IT CAN ACTUALLY SEE THROUGH, said plainly. An offer to go looking
      // from an institution with nothing to look through would be a promise it
      // could not keep, and he should be able to tell the difference.
      return { canSeeThrough: ways.map((w) => w.whatItIs) };
    })(),
    search: await (async () => {
      const { mandateProgress } = await import('../../services/venture/mandate.js');
      const progress = await mandateProgress(founderId);
      if (progress === null) return null;
      const { candidatesFor } = await import('../../services/venture/mandate.js');
      const candidates = await candidatesFor(progress.mandate.id);
      return {
        invented: progress.mandate.evidenceMode === 'reference',
        statement: progress.mandate.statement,
        guidance: progress.mandate.guidance.map((g) => g.statement),
        looked: progress.looked, rejected: progress.rejected, open: progress.open,
        blocked: progress.blocked, wouldNeed: progress.wouldNeed,
        seeingThrough: progress.seeingThrough, stillDark: progress.stillDark,
        // WHAT THE SEARCH IS FOR, so a search that found nothing reads
        // differently from one that was never pointed anywhere — and so the
        // absence of a named shape stays visible as his choice.
        brief: progress.brief === null ? null
          : `Looking for ${progress.brief.lookingFor}`
            + `${progress.brief.shapeNamed === null
              ? ', in any form — you did not name one' : `, as ${progress.brief.shapeNamed}`}`
            + `${progress.brief.termsTried === null ? ''
              : `. Searched for: ${progress.brief.termsTried}`}.`,
        // THE FRONTIER AS ONE LINE, NEVER AS A LIST.
        //
        // Seeds are institutional working memory, not an idea inbox. He asked
        // to be brought only things that deserve his attention, so what is
        // being looked into privately is a count and a sentence — the moment it
        // became a list, it would be a hundred speculative opportunities he had
        // to triage, which is the machinery this product exists to carry.
        privately: await (async () => {
          const { openSeeds } = await import('../../services/venture/seeds.js');
          const seeds = await openSeeds(founderId, 200);
          const real = seeds.filter((s) => !s.reference).length;
          if (real > 0) {
            return `I am looking into ${String(real)} ${real === 1 ? 'thing' : 'things'} `
              + 'privately. None has earned your attention yet, and most never will.';
          }
          // NOTHING FOUND AND NEVER LOOKED ARE DIFFERENT STATES.
          //
          // The minute after he gives me a mandate, this said nothing at all,
          // and the card fell back to "0 looked at, 0 rejected, 0 still open" —
          // three zeroes that read like failure when the truth is that the
          // morning has not come round yet. Saying "I have found nothing" when
          // I have not yet looked would be worse: it reports an outcome for
          // work that never happened.
          // WHETHER IT HAS EVER LOOKED IS A YES OR NO, not a total. This
          // counted every retrieval the institution had ever made, on the first
          // screen, to answer a question that one row settles.
          const looked = (await query(
            'SELECT 1 AS any FROM market_retrievals WHERE founder_id = ? LIMIT 1',
            [founderId])).rows[0] as Record<string, unknown> | undefined;
          return looked === undefined
            ? 'I have not looked yet. I go looking each morning.'
            : 'I have looked and found nothing worth pursuing yet.';
        })(),
        // WHETHER TO ADD ONE AT ALL, ASKED BEFORE ANY CANDIDATE IS SHOWN.
        //
        // A list of opportunities implies the answer is yes. Putting the prior
        // question first is what makes "I do not recommend adding another
        // venture right now" a thing this surface can actually say, rather
        // than a sentence buried under three cards arguing the opposite.
        another: await (async () => {
          const { shouldAddAnother } = await import('../../services/founder/resilience.js');
          const view = await shouldAddAnother(founderId,
            progress.mandate.evidenceMode === 'reference' ? 'reference' : 'real');
          return {
            recommend: view.recommend, because: view.because,
            concentrations: view.concentrations.map((con) =>
              `${String(con.carriedBy.length)} of your businesses share `
              + `${con.value} — if that goes wrong, ${con.ifItFails}`
              // SAID PLAINLY WHERE IT IS TRUE. Some of this he told me and
              // some of it I worked out, and rendering the two identically
              // would turn a guess into a fact on the way to a decision about
              // starting a business.
              + (con.guessed ? ' (partly worked out rather than told to me)' : '')),
          };
        })(),
        // WHAT HE HAS ALREADY TURNED DOWN, AND WHY. Kept on the page rather
        // than in the record only: the reason a candidate died is the most
        // reusable thing a search produces.
        needs: await (async () => {
          const { portfolioNeeds } = await import('../../services/founder/resilience.js');
          return (await portfolioNeeds(founderId,
            progress.mandate.evidenceMode === 'reference' ? 'reference' : 'real'))
            .map((n) => n.need);
        })(),
        decided: await (async () => {
          const { whatWasDecided } = await import('../../services/venture/mandate.js');
          return (await whatWasDecided(progress.mandate.id)).map((d) =>
            `${d.headline} — ${d.verdict === 'advanced' ? 'taken forward' : 'not taken'}`
            + `${d.why ? `, ${d.why}` : ''}`);
        })(),
        candidates: await Promise.all(candidates.map(async (c) => ({
          id: c.id,
          headline: c.headline, whoHasIt: c.whoHasIt, theProblem: c.theProblem,
          whyItMight: c.whyItMight, killThesis: c.killThesis,
          unknowns: c.unknowns, sources: c.sources, blockedBy: c.blockedBy,
          failsBecause: c.survivesGuidance ? null : c.failsBecause,
          // What adding it would do to what he already owns, on every card.
          fit: c.fit === null ? null : c.fit.verdict,
          worseForThePortfolio: c.fit?.makesItWorse ?? false,
          against: c.against,
          serves: c.serves,
          legalProfile: c.legal.profile,
          earns: c.declared.earns, burden: c.declared.burden,
          wouldTake: c.wouldTake.map((n) => n.sentence),
          downside: c.awaiting[0] ? (c.awaiting[0].costCents === 0 ? 'nothing'
            : `$${(c.awaiting[0].costCents / 100).toFixed(2)}`) : null,
          // THE RECOMMENDATION IS THE RULES, SAID ONCE. Nothing here is a new
          // judgement: it is the verdicts the card already carries, ordered.
          earnedAttention: c.survivesGuidance && !c.buriedBefore && !c.fit?.makesItWorse
            && (c.inTheWay.length === 0 || c.awaiting.length > 0),
          recommendation: !c.survivesGuidance ? `Not this one: ${c.failsBecause ?? ''}.`
            : c.buriedBefore ? 'Not this one: you have buried something like it before.'
              : c.fit?.makesItWorse ? 'Keep looking: this would make the portfolio more fragile, not less.'
                : c.inTheWay.length === 0 ? 'Take it forward. Nothing is left standing in the way.'
                  : c.awaiting.length > 0
                    ? `Run the test. It costs ${c.awaiting[0]?.costCents === 0 ? 'nothing' : `$${((c.awaiting[0]?.costCents ?? 0) / 100).toFixed(2)}`} and settles the thing that matters most.`
                    : `Not yet: ${c.inTheWay[0] ?? ''}.`,
          exposures: c.legal.surfaces.map((sf) =>
            `${sf.whatItIs} (${sf.severity}${sf.needsProfessional ? ', needs somebody qualified' : ''}`
            + `${sf.stale ? ', over six months old' : ''}) — ${sf.whatItCreates}`
            + `${sf.unknown ? `. Unknown: ${sf.unknown}` : ''}`),
          buriedBefore: c.buriedBefore === null ? null
            : `${c.buriedBefore.headline} — ${c.buriedBefore.why}`
              + (c.buriedBefore.revisitIf ? `. Worth another look if ${c.buriedBefore.revisitIf}` : ''),
          cameFrom: await (async () => {
            const { whyWeStartedLooking } = await import('../../services/venture/seeds.js');
            const chain = await whyWeStartedLooking(c.id);
            if (chain === null || chain.observation === null) return null;
            const quote = chain.motivatedBy ?? chain.observation;
            return {
              said: quote.length > 220 ? `${quote.slice(0, 217)}...` : quote,
              reading: chain.inference ?? chain.seed,
              // NULL RATHER THAN A SENTENCE ABOUT ITS OWN ABSENCE. Filling
              // this produced "I would have read it wrong if nothing was named
              // that would show I read it wrong", which parses to nothing.
              misreadIf: chain.misreadIf ?? null,
            };
          })(),
          standing: c.standing.map((how) => `${how.claim} — ${how.howItStands}`),
          research: c.research.map((r) => ({
            judgment: r.judgment,
            contradicts: r.whatContradicts,
            // Coverage is the honest half of a negative finding: what was
            // searched, how much of what came back was on the subject, what the
            // instrument cannot see, and what was never tried.
            coverage: r.coverage.map((cv) =>
              `${cv.sourceType}: searched "${cv.terms}" on ${cv.lookedAt} — the source had `
              + `${String(cv.had)}, ${String(cv.examined)} were examined, `
              + `${String(cv.onSubject)} were about it. It cannot see ${cv.cannotSee}.`
              + `${cv.notAlsoTried ? ` Not also tried: ${cv.notAlsoTried}.` : ''}`
              + ` What would help most: ${cv.wouldMostHelp}.`),
          })),
          lookNext: c.lookNext.because,
          readingIsDone: !c.lookNext.keepLooking && c.lookNext.onlyRealityCanSettle.length > 0,
          unanswered: c.unanswered.map((u) => u.cheapestTest === null
            ? `${u.question} (nothing cheap would settle it)`
            : `${u.question} — ${u.cheapestTest}`),
          inTheWay: c.inTheWay,
          awaiting: c.awaiting.map((e) => ({
            id: e.id, whatWeDo: e.whatWeDo, whatWeExpect: e.whatWeExpect,
            wouldDisprove: e.wouldDisprove,
            cost: e.costCents === 0 ? 'nothing'
              : `$${(e.costCents / 100).toFixed(2)}`,
          })),
          reference: c.reference,
        }))),
      };
    })(),
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
  | { kind: 'grade'; experimentId: string; about: string; expected: string;
      wouldDisprove: string | null; dueAt: string | null; record: string }
  | { kind: 'spend'; actId: string; productId: string; companyName: string;
      summary: string; why: string; rung: string | null; rungMeans: string | null;
      puttingItBack: string | null; costCents: number | null; expiresAt: string;
      absorbable: boolean | null }
  | { kind: 'authorise'; responsibilityId: string; check: string; path: string;
      verification: string[]; matched: number; wrong: number;
      layer: string; layerPlainly: string }
  | { kind: 'acquire'; acquisitionId: string; whatItDoes: string; rung: string;
      provider: string; costNote: string; because: string; route: string }
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
  // AN UNACCOUNTED COMMITMENT OUTRANKS A NEW ONE.
  //
  // He approved a test, the institution sealed what it expected, and it ran or
  // did not. Asking him to approve a second thing while the first has no answer
  // is how a portfolio fills up with things nobody ever examined — and it is
  // also the only way this institution ever learns whether its judgment is
  // worth anything.
  //
  // Only when it is DUE. A test with time left on it is not a question yet, and
  // nagging about one is spending his attention on the calendar.
  const owed = s.owed.find((o) => o.overdue);
  if (owed) {
    return {
      kind: 'grade', experimentId: owed.predictionId, about: owed.about,
      expected: owed.expected, wouldDisprove: owed.wouldDisprove,
      dueAt: owed.dueAt, record: s.record,
    };
  }

  // A COMPANY OF HIS ASKING FOR SOMETHING OUTRANKS THE INSTITUTION'S OWN
  // HOUSEKEEPING.
  //
  // This screen used to rank by KIND, which put a question about one of his
  // actual businesses last, behind Foundry looking after itself — and read
  // `proposed_acts` nowhere at all, so the question was not merely last, it was
  // absent. An act is ranked by its rung first and its money second: what it
  // commits him to matters more than what it costs.
  const ask = s.asked[0];
  if (ask) {
    return {
      kind: 'spend', actId: ask.id, productId: ask.productId,
      companyName: ask.companyName, summary: ask.summary, why: ask.why,
      rung: ask.rung, rungMeans: ask.rungMeans, puttingItBack: ask.puttingItBack,
      costCents: ask.costCents, expiresAt: ask.expiresAt, absorbable: ask.absorbable,
    };
  }
  // AN EARNED PERMISSION REQUEST IS THE MOST CONSEQUENTIAL THING FOUNDRY EVER
  // PUTS TO HIM, so it comes before anything it is merely offering to notice.
  const grant = s.grantable.find((g) => !s.permissions.some((p) => p.what === 'development'));
  if (grant) {
    return {
      kind: 'authorise', responsibilityId: grant.responsibilityId, check: grant.check,
      path: grant.path, verification: grant.verification,
      matched: grant.matched, wrong: grant.wrong,
      layer: grant.layer, layerPlainly: grant.layerPlainly,
    };
  }
  // A CAPABILITY IT CANNOT DO IS ONE DECISION, not a technical footnote — and
  // it outranks a recognition because acquiring may cost money where noticing
  // never does.
  const acquire = s.acquisitions[0];
  if (acquire) {
    return {
      kind: 'acquire', acquisitionId: acquire.id, whatItDoes: acquire.whatItDoes,
      rung: acquire.rung, provider: acquire.provider, costNote: acquire.costNote,
      because: acquire.because, route: acquire.route,
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

/**
 * WHAT A SITUATION WAS, IN HIS WORDS RATHER THAN THE COLUMN'S.
 *
 * The history read "growth not converting for 12 days, until 2026-08-02 — then
 * it became payments failing" — a database enum with its underscores taken out
 * and handed to the owner. Every other vocabulary in this product is translated
 * before it reaches him; this one was not.
 */
const SITUATION_IN_PLAIN_WORDS: Record<string, string> = {
  blind: 'nothing I could see',
  unknown: 'nothing I could tell',
  conflicting: 'numbers that disagreed with each other',
  payments_failing: 'payments failing',
  revenue_falling: 'revenue falling',
  growth_not_converting: 'more attention and no more revenue',
  churning: 'customers leaving faster',
  growing: 'growing',
  steady: 'steady',
};

/** The same, for a value that may be anything the column allows. */
function plainly(situation: string): string {
  return SITUATION_IN_PLAIN_WORDS[situation] ?? situation.replaceAll('_', ' ');
}

const page = (title: string, body: HtmlEscapedString | Promise<HtmlEscapedString>,
  active: Place = 'foundry',
) => html`<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
<title>${title}</title>
<!-- ON THE HOME SCREEN, IT IS HIS PRODUCT. The owner's surface was the one
     place not wired to the installable app: no manifest, no icon, no theme
     colour — so adding it to a phone gave a browser chrome bar in the wrong
     colour and a generic icon, while the manifest it would have used described
     the commercial product and its dark palette. -->
<link rel="manifest" href="/manifest.json" />
<link rel="apple-touch-icon" href="/static/icon-192.png" />
<meta name="apple-mobile-web-app-capable" content="yes" />
<meta name="apple-mobile-web-app-title" content="Foundry" />
<meta name="theme-color" content="#F3F4F1" media="(prefers-color-scheme: light)" />
<meta name="theme-color" content="#0D1310" media="(prefers-color-scheme: dark)" />
<style>
  /* Two families and one scale: a serif for the sentences that matter, the
     system sans for everything else. Colour carries meaning or it is absent:
     --good and --alert are the only two hues, and they mean direction. */
  :root{
    --bg:#F3F4F1; --card:#FFFFFF; --card-2:#F8F9F6; --line:#E2E6DE;
    --ink:#151C18; --ink-2:#4C554E; --ink-3:#68716A;
    --accent:#256454; --accent-ink:#FFFFFF; --accent-soft:#DDEBE4;
    --good:#2E7D5B; --alert:#96601A; --alert-soft:#F6EBDD;
    --s1:6px; --s2:12px; --s3:18px; --s4:28px; --s5:44px;
    --r:18px; --r2:12px;
    /* CATEGORIES ARE NOT MEANINGS. The revenue mix painted its series with
       --accent, --good, --alert, --ink-3 and --line — so one series was the
       colour of "this is good", another the colour of "look at this", and the
       fifth was the bar's own empty track, rendering as a hole. These four are
       one hue at four separations, none of which means anything. */
    --c1:#123D33; --c2:#2F7D68; --c3:#7FB8A2; --c4:#CADED6;
    --serif:"Iowan Old Style","Palatino Linotype",Palatino,"Book Antiqua",Georgia,serif;
  }
  @media (prefers-color-scheme:dark){:root:not([data-theme="light"]){
    --bg:#0D1310; --card:#151C18; --card-2:#1A231E; --line:#243029;
    --ink:#EAEFEA; --ink-2:#A8B2AA; --ink-3:#848F86;
    --accent:#8FD1B8; --accent-ink:#0C1512; --accent-soft:#1E2E27;
    --good:#7FCBA8; --alert:#D9A85E; --alert-soft:#2C2416;
    --c1:#B7E4D0; --c2:#7FC3A8; --c3:#4A8570; --c4:#2A4C40;
  }}
  *,*::before,*::after{box-sizing:border-box}
  /* REM AND BODY AGREE. The body was 17px while rem stayed 16px, so every size
     expressed in rem — which is all of them — was 6% smaller than the scale it
     was written against, and a .93rem "slightly smaller" was actually 15.8px
     beside 17px body text. */
  html{font-size:17px}
  html,body{max-width:100%;overflow-x:hidden}
  body{
    margin:0;background:var(--bg);color:var(--ink);
    font:400 1rem/1.5 ui-sans-serif,system-ui,-apple-system,"Segoe UI",sans-serif;
    -webkit-text-size-adjust:100%;-webkit-font-smoothing:antialiased;
  }
  /* ENOUGH ROOM FOR BOTH BARS AND THE HOME INDICATOR. The reserve was a flat
     10.5rem that did not know about the inset, so on a notched phone the last
     lines of every page sat underneath the composer. */
  .wrap{max-width:34rem;margin:0 auto;
    padding:var(--s3) var(--s3) calc(11rem + env(safe-area-inset-bottom))}
  h1{font-family:var(--serif);font-size:2rem;line-height:1.15;font-weight:500;
    letter-spacing:-.01em;margin:0 0 var(--s2)}
  .brand{display:flex;align-items:center;gap:10px;margin:0 0 var(--s4);color:var(--ink-2);
    font-size:.95rem}
  .brand b{display:inline-flex;align-items:center;justify-content:center;width:34px;height:34px;
    border-radius:50%;background:var(--card);border:1px solid var(--line);
    font-family:var(--serif);font-weight:500;color:var(--ink);font-size:1.05rem}

  /* THE GLANCE. Three facts in a row on a phone, each one a number and the
     sentence that keeps it honest. Never more than three. */
  .glance{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:var(--s2);margin:0 0 var(--s4)}
  .tile{background:var(--card);border:1px solid var(--line);border-radius:var(--r2);
    padding:var(--s2) var(--s2) 10px;min-width:0}
  .tile dt.k{font-size:.78rem;color:var(--ink-3);margin:0 0 4px;line-height:1.25}
  .tile dd.v{font-family:var(--serif);font-size:1.35rem;line-height:1.1;font-weight:500;
    margin:0 0 4px;overflow-wrap:anywhere}
  .tile dd.d{font-size:.78rem;color:var(--ink-2);margin:0;line-height:1.3}
  .tile .d.up{color:var(--good)} .tile .d.down{color:var(--alert)}

  /* THE NUMBERS. Two across on a phone, each with its trend. */
  .numbers{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:var(--s2);margin:0 0 var(--s2)}
  .numbers .tile dd.v{font-size:1.5rem}

  /* THE RIVER. One row per layer: name, what it is, what it carries. */
  .layer{display:flex;align-items:center;gap:var(--s2);background:var(--card);
    border:1px solid var(--line);border-radius:var(--r2);padding:var(--s2) var(--s3);
    margin:0 0 var(--s2);text-decoration:none;color:inherit}
  .layer .t{flex:1 1 auto;min-width:0}
  .layer .t b{display:block;font-size:.72rem;letter-spacing:.12em;text-transform:uppercase;
    color:var(--ink-3);font-weight:700}
  .layer .t span{font-size:.93rem;color:var(--ink-2)}
  .layer .n{font-family:var(--serif);font-size:1.3rem;color:var(--ink);flex:0 0 auto}
  .bar{display:flex;height:10px;border-radius:999px;overflow:hidden;background:var(--line);margin:var(--s2) 0 var(--s1)}
  /* A SEAM BETWEEN SEGMENTS. Four steps of one hue cannot reach the 3:1
     separation that would make them distinguishable on their own, and a
     multi-hue ramp would make each series look like it meant something.
     A boundary settles it without colour carrying meaning it does not have. */
  .bar i{display:block;height:100%;box-shadow:inset 1px 0 0 var(--card)}
  .bar i:first-child{box-shadow:none}
  .legend{display:flex;flex-wrap:wrap;gap:6px var(--s3);font-size:.85rem;color:var(--ink-2);margin:0}
  .legend i{display:inline-block;width:9px;height:9px;border-radius:50%;margin-right:6px;
    vertical-align:baseline;box-shadow:inset 0 0 0 1px rgba(0,0,0,.16)}

  /* THE DECISION. A labelled row grid, then the buttons. */
  /* A DEFINITION LIST, because that is what it is. It was <b>/<span> pairs in
     a grid: visually paired, and to a screen reader eighteen loose fragments in
     a row with nothing saying which label belonged to which value — on the
     densest and most consequential card in the product. */
  .facts{display:grid;grid-template-columns:auto minmax(0,1fr);gap:var(--s2) var(--s3);
    margin:0;
    padding:var(--s3);border-top:1px solid var(--line);font-size:.95rem}
  .facts dt{color:var(--ink-3);font-weight:500;font-size:.85rem;padding-top:2px}
  .facts dd{margin:0;min-width:0;overflow-wrap:anywhere;color:var(--ink)}
  .facts dd.quiet{color:var(--ink-2)}
  .facts span.quiet{color:var(--ink-2)}
  .pill{display:inline-block;font-size:.78rem;padding:3px 9px;border-radius:999px;
    background:var(--card-2);border:1px solid var(--line);color:var(--ink-2);margin-left:6px}
  .pill.warn{background:var(--alert-soft);color:var(--alert);border-color:transparent}
  .pill.ok{background:var(--accent-soft);color:var(--accent);border-color:transparent}
  .hero{background:var(--card);border:1px solid var(--line);border-radius:var(--r);
    padding:var(--s3);margin:0 0 var(--s3)}
  .hero h2{font-family:var(--serif);font-size:1.45rem;line-height:1.2;font-weight:500;margin:0 0 var(--s1)}
  .hero p{margin:0;color:var(--ink-2)}
  .hero.alert{border-color:var(--alert)}
  .quiet{color:var(--ink-2);font-size:.93rem}
  /* FOLDED, NOT HIDDEN. Each section is one line that says what is in it,
     and opens in place. The page is understood at a glance and explored when
     wanted, which is the difference between a company and a report. */
  details.fold{border-top:1px solid var(--line);margin:0}
  .fold>summary{padding:var(--s2) 0;min-height:48px;gap:var(--s3)}
  .fold>summary h3{margin:0;flex:0 0 auto}
  .fold .gist{flex:1 1 auto;min-width:0;text-align:right;color:var(--ink-2);font-size:.93rem;
    overflow-wrap:anywhere}
  .fold[open]>summary{padding-bottom:var(--s2)}
  .fold>ul,.fold>p,.fold>div,.fold>form{margin-bottom:var(--s3)}


  p{margin:0 0 var(--s2);overflow-wrap:anywhere}
  .lede{color:var(--ink-2);font-size:1.06rem;margin-bottom:var(--s4)}

  /* The one thing. There is never more than one of these on the page. */
  /* THE ONLY ACCENT BORDER ON THE PAGE. Everything else is --line, so the
     thing that needs him is the thing the eye lands on. */
  .one{background:var(--card);border:1px solid var(--accent);border-radius:var(--r);
    margin:0 0 var(--s4);overflow:hidden}
  .one.alert{border-color:var(--alert)}
  .one-in{padding:var(--s3)}
  .one h2{font-family:var(--serif);font-size:1.45rem;line-height:1.2;font-weight:500;margin:0 0 var(--s1)}
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

  .ask{position:fixed;left:0;right:0;bottom:var(--kb,0px);background:var(--bg);
    border-top:1px solid var(--line);
    /* THE INSET IS COUNTED ONCE. The tab bar below already reserves the home
       indicator, and the composer sits on top of the tab bar — adding it again
       here pushed the composer up by the height of the indicator a second time
       and took that much off the bottom of every page. */
    padding:var(--s2) var(--s3)}
  .ask-in{max-width:34rem;margin:0 auto;display:flex;gap:var(--s2)}
  .ask input{flex:1;min-width:0;font:inherit;font-size:max(16px,1rem);padding:13px 15px;min-height:48px;
    border:1px solid var(--line);border-radius:12px;background:var(--card);color:var(--ink)}
  .ask input:focus-visible{outline:2px solid var(--accent);outline-offset:1px}
  .ask button{font:inherit;font-size:1rem;font-weight:500;border:0;border-radius:12px;
    padding:0 18px;min-height:48px;background:var(--accent);color:var(--accent-ink);cursor:pointer}
  .ask button:focus-visible{outline:2px solid var(--ink);outline-offset:2px}
  .sr{position:absolute;width:1px;height:1px;padding:0;margin:-1px;overflow:hidden;
    clip:rect(0,0,0,0);white-space:nowrap;border:0}

  /* THREE PLACES, UNDER THE THUMB. The tab bar is the whole navigation: what
     matters, what he owns, what he has told me. Everything else is reached
     from inside one of those, never from a fourth tab. */
  nav.places{position:fixed;left:0;right:0;bottom:0;z-index:2;background:var(--bg);
    border-top:1px solid var(--line);padding:6px 0 calc(6px + env(safe-area-inset-bottom))}
  nav.places div{max-width:34rem;margin:0 auto;display:flex}
  nav.places a{flex:1 1 0;min-width:0;text-decoration:none;color:var(--ink-3);font-size:.72rem;
    display:flex;flex-direction:column;align-items:center;gap:3px;padding:4px 0;min-height:44px}
  nav.places a svg{width:22px;height:22px;stroke:currentColor;fill:none;stroke-width:1.6;
    stroke-linecap:round;stroke-linejoin:round}
  nav.places a.on{color:var(--accent)}
  nav.places a:focus-visible{outline:2px solid var(--accent);outline-offset:-2px;border-radius:8px}
  .ask{bottom:calc(58px + env(safe-area-inset-bottom) + var(--kb,0px));border-top:0;
    background:linear-gradient(to top,var(--bg) 70%,transparent)}
  .item{display:block;text-decoration:none;color:inherit;background:var(--card);
    border:1px solid var(--line);border-radius:var(--r);padding:var(--s3);margin:0 0 var(--s2)}
  .item:hover{border-color:var(--ink-3)}
  /* THE FOCUS RING WAS TURNED OFF. Keyboard focus had nothing to show for
     itself on the only link that repeats down the whole portfolio. */
  .item:focus-visible{border-color:var(--ink-3);outline:2px solid var(--accent);
    outline-offset:2px}
  .item h3{margin:0 0 var(--s1);font-size:1.08rem;font-weight:600}
  .item p{margin:0;color:var(--ink-2);font-size:.93rem}
  .know{margin:0 0 var(--s4)}
  /* The section headings on the top-level places are h2 — one level under the
     page's h1 — and the company page's stay h3 under its own h2. Same size
     either way: the outline is for the screen reader, not the eye. */
  .pill{display:inline-block;font-size:.68rem;letter-spacing:.08em;text-transform:uppercase;
    font-weight:700;color:var(--ink-2);background:var(--card-2);border:1px solid var(--line);
    border-radius:999px;padding:2px 8px;vertical-align:middle;margin-left:6px}
  h2.section{font-size:.72rem;letter-spacing:.12em;text-transform:uppercase;
    color:var(--ink-3);font-weight:700;margin:var(--s4) 0 var(--s2)}
  .know h2,.know h3{font-size:.72rem;letter-spacing:.12em;text-transform:uppercase;color:var(--ink-3);
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
  .pair{display:flex;gap:var(--s2);margin-top:var(--s1)}
  .pair form{flex:0 1 auto;min-width:0;margin:0}
  .pair form:first-child{flex:1 1 auto}
  .pair .btn{white-space:nowrap}
  form.inline{display:flex;flex-wrap:wrap;gap:var(--s2);margin:0 0 var(--s3)}
  /* THE TEXTAREA HAD NO RULE AT ALL, so it fell to the browser default —
     below the 16px floor, which makes iOS zoom in on focus and never zoom back
     out. It is the field he types a whole mandate into. */
  form.inline input[type=text],textarea{flex:1 1 12rem;min-width:0;font:inherit;font-size:max(16px,1rem);
    padding:13px 15px;min-height:48px;border:1px solid var(--line);border-radius:12px;
    background:var(--card);color:var(--ink)}
  form.inline input:focus-visible{outline:2px solid var(--accent);outline-offset:1px}
  form.inline button{flex:0 0 auto}
  form.inline .btn{width:auto}
  footer{margin-top:var(--s5);padding-top:var(--s3);border-top:1px solid var(--line)}
  footer a{color:var(--ink-3);font-size:.85rem;text-decoration:none}
  footer a:hover,footer a:focus-visible{text-decoration:underline}

  /* TWO CANVASES, NEITHER A VERSION OF THE OTHER. Under 900px the places sit
     under the thumb and the ask bar is fixed above them. From 900px the places
     become a rail on the left, the ask box sits at the top of the column where
     the eye starts, the column widens, and sections that were a single scroll
     flow into two columns. Nothing is hidden on either; what changes is where
     the hand and the eye are. */
  @media (min-width:900px){
    body{font-size:max(16px,1rem)}
    .wrap{max-width:68rem;margin:0 0 0 15rem;padding:var(--s4) var(--s5) var(--s5)}
    /* A LINE OF PROSE HAS A LENGTH. The cards were capped and the paragraphs
       between them were not, so on a wide screen the sentences ran to a
       hundred and forty characters — unreadable, and beside cards that stopped
       at half that. */
    .wrap>*{max-width:44rem}
    h1{font-size:2.4rem}
    nav.places{top:0;bottom:0;right:auto;width:15rem;border-top:0;border-right:1px solid var(--line);
      padding:var(--s4) var(--s3);background:var(--card-2)}
    nav.places div{flex-direction:column;gap:4px;max-width:none;margin:0}
    nav.places a{flex:0 0 auto;flex-direction:row;justify-content:flex-start;gap:10px;
      font-size:.98rem;padding:10px 12px;border-radius:10px;min-height:44px}
    nav.places a.on{background:var(--accent-soft)}
    nav.places div::before{content:"Private Foundry";display:block;font-family:var(--serif);
      font-size:1.1rem;color:var(--ink);margin:4px 12px var(--s4)}
    .brand{display:none}
    .ask{position:static;background:none;padding:0;margin:0 0 var(--s4);order:-1}
    .ask-in{max-width:none;margin:0}
    main.wrap{display:flex;flex-direction:column}
    .glance{grid-template-columns:repeat(3,minmax(0,1fr));max-width:44rem}
    .numbers{grid-template-columns:repeat(4,minmax(0,1fr))}
    .cols{column-count:2;column-gap:var(--s4)}
    .cols>*{break-inside:avoid;-webkit-column-break-inside:avoid}
    .one,.hero{max-width:44rem}
    .layer{max-width:44rem}
  }
  @media (min-width:1280px){.wrap{max-width:76rem}}
</style>
</head>
<body>
<main class="wrap">
<div class="brand"><b>F</b> Private Foundry</div>
${body}
<footer><a href="/letter">Advanced — inspect the system</a></footer>
<form class="ask" method="GET" action="/foundry">
  <div class="ask-in">
    <label for="q" class="sr">Ask Foundry anything</label>
    <input id="q" name="q" type="search" enterkeyhint="search" autocorrect="on"
      autocapitalize="sentences" spellcheck="true" placeholder="Ask Foundry anything…" />
    <button type="submit">Ask</button>
  </div>
</form>
</main>
<nav class="places" aria-label="Places"><div>
  <a href="/foundry"${active === 'foundry' ? ' class="on" aria-current="page"' : ''}>
    <svg viewBox="0 0 24 24"><path d="M3 11.5 12 4l9 7.5"/><path d="M5 10v10h14V10"/></svg>Foundry</a>
  <a href="/foundry/companies"${active === 'companies' ? ' class="on" aria-current="page"' : ''}>
    <svg viewBox="0 0 24 24"><path d="M3 17c3-4 6 0 9-3s6 1 9-3"/><path d="M3 12c3-4 6 0 9-3s6 1 9-3"/></svg>Portfolio</a>
  <a href="/foundry/controls"${active === 'controls' ? ' class="on" aria-current="page"' : ''}>
    <svg viewBox="0 0 24 24"><path d="M4 7h16M4 12h16M4 17h16"/><circle cx="9" cy="7" r="2" fill="var(--bg)"/><circle cx="15" cy="12" r="2" fill="var(--bg)"/><circle cx="8" cy="17" r="2" fill="var(--bg)"/></svg>Controls</a>
</div></nav>
<script>${raw(OWNER_SURFACE_SCRIPT)}</script>
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

/** The owner's own list of routes, in his words rather than the enum's. */
const ROUTE_WORDS: Record<string, string> = {
  reuse: 'reuse something the portfolio already has',
  existing_api: 'connect a provider that already exists',
  new_provider: 'bring in a new provider',
  browser: 'do it through a governed browser, holding no credential',
  adapter: 'write an adapter to a provider',
  build: 'build it once and reuse it across the portfolio',
  procure: 'pay for a service',
  license: 'license it from somebody',
  human: 'engage a qualified person',
};

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

  if (a.kind === 'grade') {
    return decisionCard({
      act: 'Recognition',
      question: 'You approved this test. What happened?',
      title: a.about,
      meaning: [
        `Before it ran I said: ${a.expected}`,
        a.wouldDisprove === null
          ? 'I did not name what would have meant I was wrong, which is itself worth knowing.'
          : `And I said I would be wrong if: ${a.wouldDisprove}`,
        'You are the reporter here, never me. I file what you say against what I '
        + 'said, and a surprise counts against the claim it was testing.',
      ],
      facts: [
        ['Due', a.dueAt === null ? 'Not set' : a.dueAt.slice(0, 10)],
        ['My record', a.record],
        ['Cost', 'Nothing'],
        ['If you do nothing', 'I keep asking, because an unanswered test is the '
          + 'one thing I cannot learn from'],
      ],
      primary: {
        label: 'Yes — that is what happened',
        action: `/foundry/venture/experiment/${a.experimentId}/result`,
        fields: { as_predicted: 'yes', return_to: 'foundry' },
      },
      secondary: {
        label: 'No — something else',
        action: `/foundry/venture/experiment/${a.experimentId}/result`,
        fields: { as_predicted: 'no', return_to: 'foundry' },
      },
      technical: `${a.expected} · experiment ${a.experimentId}`,
    });
  }

  if (a.kind === 'spend') {
    // THROUGH THE SAME CARD AS EVERY OTHER DECISION, with the two facts the
    // consequence ladder already stores and the first screen never showed: what
    // rung this stands on, and what it would take to put it back.
    const cost = a.costCents == null ? 'Not stated' : money(a.costCents);
    return decisionCard({
      act: 'Authority',
      question: `${a.companyName} is asking for something.`,
      title: a.summary,
      meaning: [
        a.why,
        a.rungMeans == null
          ? 'Nothing says what consequence this has, which is itself a reason to look.'
          : `This ${a.rungMeans}.`,
        a.absorbable === false
          ? 'This is not something I can ever be given standing permission for. You '
            + 'decide it each time, and that is deliberate.'
          : 'If you have allowed money for this company, this comes out of it.',
      ],
      facts: [
        ['Company', a.companyName],
        ['Cost', cost],
        ['Putting it back', a.puttingItBack ?? 'Not stated'],
        ['If you do nothing', `It lapses on ${a.expiresAt.slice(0, 10)} and I will not act`],
      ],
      primary: {
        label: 'Yes — go ahead',
        action: `/foundry/proposals/${a.actId}/approve`,
        fields: { return_to: 'foundry' },
      },
      secondary: {
        label: 'No',
        action: `/foundry/proposals/${a.actId}/refuse`,
        fields: { return_to: 'foundry' },
      },
      technical: `${a.summary} · rung ${a.rung ?? 'unclassified'} · act ${a.actId}`
        + ` · company ${a.productId}`,
    });
  }

  if (a.kind === 'acquire') {
    // WHAT IT WOULD STILL NOT PERMIT is the fact that keeps this honest. He is
    // approving an ACQUISITION, not an act: the new capability goes through the
    // same door, on the same rung, under the same boundaries as everything
    // else. Saying so here is what stops "yes" meaning more than he meant.
    const stillNot = a.rung === 'observe' || a.rung === 'prepare'
      ? 'Nothing. It can only look, or make drafts nobody outside can see.'
      : a.rung === 'public'
        ? 'Anything you have told me not to do still stands. Every use goes '
          + 'through the same door as every other message.'
        : a.rung === 'financial'
          ? 'It spends nothing on its own. Each use needs an allowance you set '
            + 'or an approval you give.'
          : 'Each single use still needs your approval, every time.';
    return decisionCard({
      act: 'Authority',
      question: 'Should I get hold of this?',
      title: a.whatItDoes,
      meaning: [
        `I would ${ROUTE_WORDS[a.route] ?? a.route} — ${a.provider}.`,
        `I want it because ${a.because}.`,
        'Saying yes gets me the ability. It does not let me use it for anything '
        + 'in particular — that is still a separate question, every time.',
      ],
      facts: [
        ['What it costs', a.costNote],
        ['What it would still not let me do', stillNot],
        ['If you say no', 'I leave it, and say so wherever the work needed it'],
      ],
      primary: { label: 'Yes — get it', action: `/foundry/acquisitions/${a.acquisitionId}/decide`,
        fields: { decision: 'approved' } },
      secondary: { label: 'Not this', action: `/foundry/acquisitions/${a.acquisitionId}/decide`,
        fields: { decision: 'declined' } },
      technical: `capability ${a.acquisitionId}`,
    });
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
      technical: `${a.path} · layer ${a.layer} · change class generated_artifact `
        + `· verified by ${a.verification.join(', ')} · responsibility ${a.responsibilityId}`,
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
  if (done === 'posture') {
    return html`<div class="done"><p><strong>Changed.</strong> What I recommend for this
      company, and where I would send money, follow from that now.</p></div>`;
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
  portfolio: 'What do I own, and how is everything doing?',
  capital: 'Where should the next dollar go?',
  venture: 'Find me a new business',
  away: 'Can I disappear for a week?',
  back: 'What happened while I was away?',
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
  // AN INSTRUCTION TO GO LOOKING IS READ BEFORE ANY QUESTION ABOUT WHAT HE
  // OWNS. His mandate says "make my portfolio more resilient", so it contains
  // the word the portfolio rule matches on — and reading it as a question would
  // answer him instead of starting the search he asked for.
  if (/venture|originate|new business|another business|new company|another company|a new saas|micro-?saas|income stream|revenue stream|the river/.test(t)
    || /stop looking|show me another option|try harder to disprove|higher[- ]ticket|paid acquisition/.test(t)) {
    return 'venture';
  }
  // THE PORTFOLIO QUESTION COMES FIRST, because "how are things?" is both the
  // most obvious thing he could type and a phrase that matches the
  // one-company rule below. It matched "how are", asked which company he meant,
  // found none named, and answered "I don't know yet" — to the question the
  // whole first screen exists to answer.
  if (/what do i own|my companies|everything doing|how are things|across (all|my)|portfolio|deteriorat|which company/.test(t)) {
    return 'portfolio';
  }
  if (/how is|how are|how'?s |doing|going|healthy|health of/.test(t)) return 'howdoing';
  // CONTEXT FIRST. He is looking at something; "what does this mean" is about
  // that, and he should never have to name it again to be understood.
  // PORTFOLIO QUESTIONS FIRST, because "where should the next dollar go" also
  // matches /money/ below and would be answered as a question about permissions.
  if (/disappear|step away|go away|take a (week|holiday|break)|on holiday|vacation|leave for a week|a week off|unplug/.test(t)) {
    return 'away';
  }
  if (/while i was (away|gone|out)|since i (left|went)|what did i miss|catch me up|been away/.test(t)) {
    return 'back';
  }
  if (/next (dollar|pound|\$|100|1000)|where should (i|we) (spend|invest|put)|allocate/.test(t)) {
    return 'capital';
  }
  // A VENTURE SENTENCE IS NOT A QUESTION. Asking Foundry to go and look, or
  // steering a search that is running, is an instruction — it goes to the
  // mandate, where it binds after he confirms, rather than being answered.
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
      <a class="btn" href="/foundry/companies/${about.id}">Answer at ${about.name}</a>`
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

/**
 * THE QUESTIONS THAT ARE ABOUT ALL OF IT.
 *
 * Structure where structure helps: "what do I own" is a comparison and reads as
 * a list. "Where should the next dollar go" is a judgement, and the honest
 * answer is an ordering plus what Foundry cannot see — never a number.
 */
async function answerAboutEverything(
  key: string, founderId: string,
): Promise<HtmlEscapedString> {
  const { portfolioFor, whereTheNextDollarGoes } = await import(
    '../../services/founder/portfolio.js');

  if (key === 'away') {
    return (async () => {
      const { canIDisappear } = await import('../../services/founder/a-week-away.js');
      const v = await canIDisappear(founderId);
      const list = (title: string, items: string[]): string => items.length
        ? `<p class="quiet"><strong>${title}</strong></p><ul>${items.map((i) => `<li>${i}</li>`).join('')}</ul>` : '';
      return html`<div class="said">
        <p><strong>${v.verdict}</strong></p>
        ${raw(list('What I carry', v.carries))}
        ${raw(list('What I cannot carry, so it will not be done', v.cannotCarry))}
        ${raw(list('What I may and may not do', v.authority))}
        ${raw(list('What might need you', v.mightNeedYou))}
        ${raw(list('What will wait for you', v.willWait))}
        ${v.blind.length ? html`<p class="gap">I cannot see ${v.blind.join(' or ')} at all, so
          silence from ${v.blind.length === 1 ? 'it' : 'them'} would mean nothing.</p>` : ''}
      </div>`;
    })();
  }
  if (key === 'back') {
    return (async () => {
      const { whileYouWereAway } = await import('../../services/founder/a-week-away.js');
      const l = await whileYouWereAway(founderId);
      const list = (title: string, items: string[], empty: string): string =>
        `<p class="quiet"><strong>${title}</strong>${items.length ? '' : ` — ${empty}`}</p>`
        + (items.length ? `<ul>${items.map((i) => `<li>${i}</li>`).join('')}</ul>` : '');
      return html`<div class="said">
        <p>Since ${l.since}.</p>
        ${raw(list('What happened', l.happened, 'nothing I could see changed'))}
        ${raw(list('What I handled', l.handled, 'nothing moved on my side'))}
        ${raw(list('What changed', l.changed, 'nothing you set changed'))}
        ${raw(list('Money', l.money, 'nothing was spent'))}
        ${raw(list('What reached the world', l.effects, 'nothing left the building'))}
        ${raw(list('What came back from the world', l.outcomes, 'nothing was tested'))}
        ${raw(list('What I learned', l.learned, 'nothing was buried or settled'))}
        ${raw(list('What needs you now', l.needsYou, 'nothing'))}
      </div>`;
    })();
  }
  if (key === 'capital') {
    const view = await whereTheNextDollarGoes(founderId);
    return html`<div class="said">
      <p><strong>${view.recommendation}</strong></p>
      ${view.candidates.length ? html`<ul>${raw(view.candidates.map((c) =>
    `<li><a href="/foundry/companies/${c.productId}">${c.name}</a> — ${c.forWhat}.</li>`)
    .join(''))}</ul>` : ''}
      <p class="quiet">What I do not know: ${view.whatIDoNotKnow.join('; ')}.</p>
      <p class="quiet">That is an ordering, not an allocation. The decision is yours, and
        I would rather say what I cannot see than put a number on it.</p>
    </div>`;
  }

  const portfolio = await portfolioFor(founderId);
  return html`<div class="said">
    <p><strong>${portfolio.headline}</strong></p>
    ${portfolio.companies.length === 0
    ? html`<p>Nothing yet.</p>`
    : html`<ul>${raw(portfolio.companies.map((c) =>
      `<li><a href="/foundry/companies/${c.productId}">${c.name}</a> — ${c.headline}`
      + `${c.days > 0 && c.situation !== 'steady'
        ? ` For ${String(c.days)} ${c.days === 1 ? 'day' : 'days'}.` : ''}`
      + `${c.needsHim ? ` <strong>${c.needsHim}.</strong>` : ''}</li>`).join(''))}</ul>`}
    ${portfolio.reference.length ? html`<p class="quiet">You also have
      ${String(portfolio.reference.length)} invented
      ${portfolio.reference.length === 1 ? 'company' : 'companies'} I made up so you could
      watch me work. ${portfolio.reference.length === 1 ? 'It is' : 'They are'} not counted
      above and nothing about ${portfolio.reference.length === 1 ? 'it' : 'them'} is a fact
      about a real business.</p>` : ''}
    <a class="btn" href="/foundry/companies">Open your companies</a>
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
    const named = a.kind === 'grade'
      ? `what happened with ${a.about}`
      : a.kind === 'spend'
      ? `${a.summary} at ${a.companyName}`
      : a.kind === 'recognise'
      ? (a.check ? CHECK_IN_PLAIN_WORDS[a.check]?.name ?? a.proposal : a.proposal)
      : a.kind === 'recognise_company'
        // A company's job has no self-check behind it to look up a friendlier
        // name for; the proposal already IS the plain words.
        ? `${a.proposal} at ${a.companyName}`
        : a.kind === 'authorise'
          ? CHECK_IN_PLAIN_WORDS[a.check]?.name ?? a.check
          : a.kind === 'acquire'
            ? a.whatItDoes
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
    ? html`I have spent nothing.`
    : html`I have spent $${s.spent30d.toFixed(2)} this month.`}</p>
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
  // NULL IS A RENDERABLE ANSWER. Neither resolving means Foundry has not been
  // established as a company here and he owns more than one, so there is no
  // unambiguous self to describe — but the screen is the INSTITUTION'S, not one
  // company's, and it still has to answer "does anything need me" about the
  // rest of what he owns. Returning null redirected him to onboarding, which is
  // the same disappearing act the `selectedProductId` dependency used to cause.
  const productId = await foundryProductId(founderId) ?? await selectedProductId(c, founderId);
  return readOwnerState(productId, String(founder.name ?? founder.email ?? ''), founderId);
}

foundryShellRoutes.get('/foundry', async (c) => {
  let s: OwnerState | null;
  try {
    s = await context(c);
  } catch (err) {
    // A FAILURE IS STILL AN ANSWER. He should never meet a stack trace, and
    // never be left unsure whether something of his broke.
    //
    // AND SOMEBODY HAS TO KEEP IT. This threw the error away entirely — no log
    // line, no report, no stack — so the one page that matters most could fail
    // for a week and leave nothing behind to find out why. The owner sees the
    // same calm sentence either way; the difference is whether it is
    // diagnosable afterwards.
    reportError(err, { source: 'owner_surface', meta: { path: c.req.path } });
    logger.error('The first screen could not be assembled', {
      error: err instanceof Error ? err.message : String(err),
      stack: err instanceof Error ? err.stack : undefined,
    });
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
  // Venture sentences are instructions, not questions: rendered as a form that
  // posts to the mandate, so the confirmation grammar is the same one every
  // other binding act in this product uses.
  const ventureSaid = key === 'venture' && typed ? typed : '';

  const named = typed
    ? await companyHeMeant(s.ownerId, typed) : null;
  const about = named && (key === 'howdoing' || key === 'numbers' || key === 'working'
    || key === 'needs' || key === 'allowed') ? { ...named, key } : null;

  // ORIENTATION IS ONE SENTENCE. Not four green bullets: a routine count and a
  // spend of zero are true, measurable, and not why he opened this.
  // IS EVERYTHING OKAY, ANSWERED AGAINST WHAT IS ACTUALLY THERE.
  //
  // This asked about routines and never about companies, so it told him it had
  // learned nothing about him while two companies sat in his portfolio being
  // watched. He could spend an afternoon exploring and come back to a home
  // screen that had not noticed. Invented companies are said to be invented,
  // every time, because the entire reason they exist is that they are not his.
  const nothingYet = s.watching.real === 0 && s.watching.invented === 0
    && s.routinesHealthy === 0 && s.checks.length === 0;
  const alsoInvented = s.watching.invented > 0
    ? `, and watching ${String(s.watching.invented)} I made up` : '';
  const settled = s.watching.real > 0
    ? `Everything is fine. I am looking after ${String(s.watching.real)} `
      + `${s.watching.real === 1 ? 'company' : 'companies'} of yours`
      + `${s.watching.itself ? ', and myself' : ''}${alsoInvented}. Nothing needs you.`
    : s.watching.itself || s.watching.invented > 0
      ? 'Everything is fine. I am looking after myself and none of your businesses '
        + `yet${alsoInvented}. Nothing needs you.`
      : 'Everything is fine. Nothing needs you.';
  const orientation = done && attention === null
    ? ''
    : attention === null
      ? (nothingYet
        ? 'I am set up, and I have not learned anything about you yet.'
        : settled)
      : attention.kind === 'stopped' || attention.kind === 'drifted'
        ? 'Something needs looking at.'
        : 'One thing needs you.';

  // THE GLANCE. Three facts, only when there is something real to glance at:
  // what the real companies earn (and how many that covers), whether anything
  // needed him this month, and the largest thing his businesses share. Not a
  // health grade and not a resilience score - the named thing a grade would
  // be hiding.
  const { glanceFor } = await import('../../services/founder/portfolio.js');
  const glance = await glanceFor(s.ownerId);

  const body = html`
    <h1><span id="greet">Hello</span>${s.firstName ? `, ${s.firstName}` : ''}.</h1>
    ${orientation ? html`<p class="lede">${orientation}</p>` : ''}
    ${glance.cashFlowCents !== null || glance.interruptions > 0 || glance.concentration
    ? html`<dl class="glance">
      <div class="tile"><dt class="k">Monthly cash flow</dt>
        <dd class="v">${glance.cashFlowCents === null ? '—' : money(glance.cashFlowCents)}</dd>
        <dd class="d">${glance.cashFlowCents === null ? 'nothing reports revenue yet'
    : `across ${String(glance.seen)} of ${String(glance.companies)} I can see`}</dd></div>
      <div class="tile"><dt class="k">Needed you</dt>
        <dd class="v">${String(glance.interruptions)}</dd>
        <dd class="d">${glance.interruptions === 0 ? 'not once this month' : 'times this month'}</dd></div>
      <div class="tile"><dt class="k">Most shared</dt>
        <dd class="v">${glance.concentration ? glance.concentration.split(' share ')[0] : 'nothing'}</dd>
        <dd class="d">${glance.concentration ? `share ${glance.concentration.split(' share ')[1]}`
    : 'no two depend on the same thing'}</dd></div>
    </div>` : ''}

    <!-- THE ONE THING HE CAME FOR, BEFORE ANYTHING HE DID NOT.
         This was rendered last: after what changed, after ninety lines of
         search block that can carry a whole opportunity's case. The screen said
         "One thing needs you" and then put everything else in front of it. -->
    ${standingPermission(s)}
    ${theOneThing(attention)}

    ${done === 'looking' ? html`<div class="done"><p><strong>I am looking.</strong>
      I will bring you very few, and telling you none of them are worth it is a real
      answer.</p></div>` : ''}
    ${done === 'steeredsearch' ? html`<div class="done"><p><strong>Held to that.</strong>
      Every candidate from here is tested against it.</p></div>` : ''}
    ${done === 'searchstopped' ? html`<div class="done"><p><strong>Stopped looking.</strong>
      What I found stays on the record, including what I rejected and why.</p></div>` : ''}
    ${done === 'acquiring' ? html`<div class="done"><p><strong>Getting it.</strong>
      That gets me the ability and nothing else — using it for anything in particular
      is still a separate question, every time.</p></div>` : ''}
    ${done === 'notacquiring' ? html`<div class="done"><p><strong>Left it.</strong>
      I will say so wherever the work needed it, rather than working around you.</p></div>` : ''}
    ${done === 'trying' ? html`<div class="done"><p><strong>Going ahead with that.</strong>
      What I said I expect is now fixed and cannot be edited, so the result can
      disagree with me.</p></div>` : ''}
    ${done === 'nottrying' ? html`<div class="done"><p><strong>Left it.</strong>
      The question stays open, and it stays in the way of that one becoming a
      company.</p></div>` : ''}
    ${done === 'advanced' ? html`<div class="done"><p><strong>Taken forward.</strong>
      Nothing was left standing in the way. Making it a company is still yours to
      do — I have not made one.</p></div>` : ''}
    ${done === 'rejected' ? html`<div class="done"><p><strong>Buried.</strong>
      I will remember it, and why, and not bring you the same thing again unless
      something changes.</p></div>` : ''}
    ${done === 'stillintheway' ? html`<div class="done"><p><strong>Not yet.</strong>
      Something is still in the way — it is on the candidate.</p></div>` : ''}
    ${done === 'alreadylooking' ? html`<div class="done"><p><strong>Already looking.</strong>
      Stop that search first, or steer it instead — two at once would compete for the same
      attention.</p></div>` : ''}
    ${s.changed.changes.length > 0 ? html`<div class="know">
      <h2>While you were away</h2>
      <ul>${s.changed.changes.map((ch) => html`<li>${ch.said}</li>`)}</ul>
      ${s.changed.more > 0 ? html`<p class="quiet">And ${String(s.changed.more)} other
        ${s.changed.more === 1 ? 'thing' : 'things'}.</p>` : ''}
    </div>` : ''}
    <!-- NOTHING TO LOOK AFTER IS A DIFFERENT SCREEN FROM NOTHING TO LOOK FOR.
         With no companies, this offered to go searching and then admitted in
         the next line that it had nowhere to look — an offer it could not keep,
         and the screen's only action. The first thing to do when you own
         nothing is name something you own. -->
    ${s.notLooking && s.watching.real === 0 && s.watching.invented === 0
    ? html`<div class="know">
      <h2>You have not told me about anything you own</h2>
      <p class="lede">Name one and I will start paying attention to it. That is all it
        does &mdash; it does not connect anything or let me act.</p>
      <form class="inline" method="POST" action="/foundry/companies">
        <input type="text" name="name" required maxlength="80" enterkeyhint="done"
          autocapitalize="words" autocorrect="off" spellcheck="false"
          placeholder="What is it called?" aria-label="The name of a company you own" />
        <button class="btn go" type="submit">Add it</button>
      </form>
      <p class="quiet">Or see what I do with one first &mdash; there are companies I made
        up on your <a href="/foundry/companies">Portfolio</a>.</p>
    </div>`
    : s.notLooking ? html`<div class="know">
      <h2>I am not looking for anything</h2>
      <p class="lede">Say what you want and I will start looking. One sentence &mdash;
        what you are after, and anything I should not do.</p>
      <form class="inline" method="POST" action="/foundry/ask">
        <input type="text" name="said" required maxlength="300"
          placeholder="Find another small income stream. Keep legal risk low."
          aria-label="What to look for, and what not to do" enterkeyhint="send" autocapitalize="sentences"
          autocorrect="on" spellcheck="true" />
        <!-- SECONDARY, DELIBERATELY. The one primary action on this screen is
             whatever actually needs him; an offer to go looking is an offer,
             and two things styled as the decision is one thing too many. -->
        <button class="btn" type="submit">Start looking</button>
      </form>
      ${s.notLooking.canSeeThrough.length ? html`<p class="quiet"><strong>What I would be
        looking through</strong> &mdash; ${s.notLooking.canSeeThrough.join('; ')}.</p>`
    : html`<p class="gap">I would be starting blind &mdash; I have nothing
        to look through yet.</p>`}
    </div>` : ''}
    ${s.search ? html`<div class="know">
      <h2>${s.search.invented ? 'A search I made up' : 'What I am looking for'}</h2>
      ${s.search.invented ? html`<p class="quiet">You did not ask for this one. I invented
        it so you could see what I do with a search before handing me a real one. Nothing
        it finds is a fact about any real market, and none of it can ever be counted or
        acted on.</p>` : ''}
      <p>${s.search.statement}</p>
      ${s.search.guidance.length ? html`<ul>${raw(s.search.guidance.map((g) =>
    `<li>${g}</li>`).join(''))}</ul>` : ''}
      ${s.search.blocked ? html`<p class="quiet"><strong>Where it has got to:</strong>
        ${s.search.blocked}</p>
        <p class="quiet">What I would need: ${s.search.wouldNeed}</p>`
    : html`<p class="quiet">${s.search.looked} looked at,
        ${s.search.rejected} rejected, ${s.search.open} still open.</p>
      <p class="quiet"><strong>What I am looking through</strong> —
        ${s.search.seeingThrough.join('; ')}.</p>
      ${s.search.stillDark.length ? html`<p class="gap"><strong>And what I still
        cannot see</strong> — ${s.search.stillDark.join('; ')}.</p>` : ''}`}
      ${!s.search.another.recommend ? html`<p class="gap"><strong>I do not
        recommend adding another venture right now.</strong>
        ${s.search.another.because}</p>` : ''}
      ${s.search.another.concentrations.length ? html`<div class="quiet">
        <p><strong>What a single thing going wrong could take out</strong></p>
        <ul>${raw(s.search.another.concentrations.map((con) =>
    `<li>${con}</li>`).join(''))}</ul></div>` : ''}
      ${s.search.brief ? html`<p class="quiet">${s.search.brief}</p>` : ''}
      ${s.search.privately ? html`<p class="quiet">${s.search.privately}</p>` : ''}
      ${s.search.needs.length ? html`<p class="quiet"><strong>What the portfolio
        needs</strong> — ${s.search.needs.join('; ')}.</p>` : ''}
      ${s.search.decided.length ? html`<div class="quiet">
        <p><strong>Already decided about</strong></p>
        <ul>${s.search.decided.map((d) => html`<li>${d}</li>`)}</ul></div>` : ''}
      ${(() => {
    // WORK IN PROGRESS IS A COUNT, NOT A DOSSIER.
    //
    // Every candidate rendered its whole dossier here, and three at once made
    // this screen a hundred and eleven lines deep while not one of them was
    // asking him for anything — all three said "not yet". The first screen is
    // for what needs him. The rest is a sentence, and the sentence is the
    // truthful one he asked for: none of them has earned his attention.
    const waiting = s.search.candidates.filter((cd) => !cd.earnedAttention).length;
    return waiting === 0 ? '' : html`<p class="quiet">I am working through
      ${String(waiting)} ${waiting === 1 ? 'possibility' : 'possibilities'}.
      ${waiting === 1 ? 'It has not' : 'None has'} earned your attention yet.</p>`;
  })()}
      ${s.search.candidates.filter((cand) => cand.earnedAttention).map((cand) => html`<div class="noticed">
        <div class="one-in">
          <p class="act">${cand.reference ? 'Invented, to show you how I judge' : 'Opportunity'}</p>
          <h2>${cand.headline}</h2>
          <p class="lead">${cand.whoHasIt} &mdash; ${cand.theProblem}.</p>
        </div>
        <dl class="facts">
          ${cand.cameFrom ? html`<dt>Somebody wrote</dt><dd>&ldquo;${cand.cameFrom.said}&rdquo;</dd>
          <dt>I read that as</dt><dd class="quiet">${cand.cameFrom.reading}${
  cand.cameFrom.misreadIf === null ? ''
    : html` I would have read it wrong if ${cand.cameFrom.misreadIf}.`}</dd>` : ''}
          <dt>Why it might</dt><dd>${cand.whyItMight}</dd>
          <dt>For the portfolio</dt><dd>${cand.fit ?? 'I cannot say yet'}${cand.serves.length ? ` It would give you ${cand.serves.join('; ')}.` : ''}</dd>
          ${cand.earns ? html`<dt>How it earns</dt><dd>${cand.earns}</dd>` : ''}
          ${cand.burden ? html`<dt>Its burden</dt><dd>${cand.burden}</dd>` : ''}
          <dt>Legal and risk</dt><dd>${cand.legalProfile}</dd>
          ${cand.wouldTake.length ? html`<dt>What it would take</dt><dd class="quiet">${cand.wouldTake.join(' ')}</dd>` : ''}
          <dt>Could fail because</dt><dd>${cand.killThesis}</dd>
          <dt>Checked</dt><dd class="quiet">${cand.standing.length ? cand.standing.join(' ') : (cand.sources.length ? cand.sources.join('; ') : 'nothing')}</dd>
          <dt>Unknown</dt><dd class="quiet">${cand.unanswered.length ? cand.unanswered.join('; ') : (cand.unknowns.join('; ') || 'nothing I can name')}</dd>
          ${cand.awaiting[0] ? html`<dt>Cheapest test</dt><dd>${cand.awaiting[0].whatWeDo}. I expect ${cand.awaiting[0].whatWeExpect}; I would be wrong if ${cand.awaiting[0].wouldDisprove}.</dd>
          <dt>Most you could lose</dt><dd>${cand.downside}</dd>` : ''}
          ${cand.against.length ? html`<dt>Not quite</dt><dd class="quiet">${cand.against.join('; ')}</dd>` : ''}
          ${cand.buriedBefore ? html`<dt>Seen before</dt><dd class="quiet">${cand.buriedBefore}</dd>` : ''}
          ${cand.failsBecause ? html`<dt>Against what you said</dt><dd>${cand.failsBecause}</dd>` : ''}
          ${cand.blockedBy ? html`<dt>Not yet</dt><dd>This cannot earn a company yet &mdash; ${cand.blockedBy}.</dd>` : ''}
          ${cand.inTheWay.length ? html`<dt>Before a company</dt><dd class="quiet">${cand.inTheWay.join('; ')}</dd>` : ''}
          <dt>I recommend</dt><dd>${cand.recommendation}</dd>
        </dl>
        <div class="do">
          ${cand.awaiting.map((e) => html`<form method="POST" action="/foundry/venture/experiment">
            <input type="hidden" name="experimentId" value="${e.id}" />
            <input type="hidden" name="decision" value="approved" />
            <button class="${attention === null ? 'btn go' : 'btn'}" type="submit">Go ahead
              &mdash; ${e.cost}</button>
          </form>`)}
          ${!cand.inTheWay.length ? html`<form method="POST" action="/foundry/venture/advance">
            <input type="hidden" name="opportunityId" value="${cand.id}" />
            <button class="${attention === null ? 'btn go' : 'btn'}" type="submit">Take it
              forward</button>
          </form>` : ''}
          <form method="POST" action="/foundry/venture/reject">
            <input type="hidden" name="opportunityId" value="${cand.id}" />
            <button class="btn" type="submit">Bury this one</button>
          </form>
        </div>
      </div>`)}
    </div>` : ''}

    ${!s.search && s.pastSearches.length ? html`<div class="know">
      <h2>What you have looked for before</h2>
      <ul>${raw(s.pastSearches.map((p) =>
    `<li>&ldquo;${p.statement}&rdquo; — stopped ${p.closedAt}${p.why ? `, ${p.why}` : ''}.</li>`)
    .join(''))}</ul>
      <p class="quiet">If you ask again I am not starting from nothing: what I rejected, and
        why, is still here.</p>
    </div>` : ''}

    ${done ? whatJustHappened(done, s) : ''}

    ${key ? html`<p class="asked">${typed || QUESTIONS[key] || asked}</p>
      ${ventureSaid ? html`<div class="said">
        <p>That sounds like something for me to go and do rather than a question.</p>
        <form method="POST" action="/foundry/venture">
          <input type="hidden" name="said" value="${ventureSaid}" />
          <button class="btn go" type="submit">Tell me what you would do</button>
        </form>
      </div>`
    : about ? answerAboutCompany(about)
      : key === 'portfolio' || key === 'capital' || key === 'away' || key === 'back'
        ? answerAboutEverything(key, s.ownerId)
        : answerTo(key, s, attention)}` : ''}

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
  budgetMonthly: number | null; spent30d: number;
  knows: string[]; gaps: Array<{ missing: string; unlocks: string; connect: string | null }>;
  responsibilities: Array<{ title: string; state: string }>;
  numbers: CompanyNumbers;
  /** Non-null only for a reference company: what it is, said before anything else. */
  reference: { situation: string; premise: string } | null;
  /** What Foundry has noticed and is asking about. Recognition, and nothing more. */
  asks: Array<{ id: string; proposal: string; rationale: string }>;
  /** The one sentence at the top: what situation this company is in. */
  situation: { situation: string; headline: string; because: string[]; demandsAttention: boolean };
  /** Since when, and what it was before. A diagnosis without duration is half of one. */
  spell: { days: number; beganAt: string } | null;
  past: Array<{ situation: string; becameWhat: string; days: number; endedAt: string }>;
  /** What Foundry would do about it, and what it would need. */
  advice: Array<{ id: string; summary: string; why: string; wouldNeed: string }>;
  /** What he decided about acts, and what he took back. Auditable, and read. */
  decisions: Array<{
    id: string; summary: string; outcome: string; at: string;
    note: string | null; used: boolean;
  }>;
  /** Acts it has proposed and cannot take until he answers. */
  proposals: Array<{
    id: string; summary: string; why: string; expectedEffect: string;
    risk: string; consequence: string; expiresAt: string;
    /** The rung and what it means, or null where nobody classified this act. */
    kindOfAct: string | null;
    /** What undoing it would actually involve, in the rung's own words. */
    puttingItBack: string | null;
    /** True where no standing policy could ever cover this class of act. */
    onlyEverYours: boolean;
    /** What it costs, already in words, or null where that is not known. */
    cost: string | null;
  }>;
  /** What he said this company is for, in his words. */
  said: { statement: string; steers: boolean } | null;
  /** A ceiling he set, and what is left of it. */
  allowance: { id: string; statement: string; amount: string; left: string } | null;
  /** How he would rather things were done. Consulted, never enforced. */
  preferences: Array<{ id: string; statement: string }>;
  /** What the ceiling used to be, so a change of mind about money is legible. */
  formerAllowance: { amount: string; withdrawnAt: string; reason: string } | null;
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
  /** What Foundry actually holds, so the disclosure can be checked rather than trusted. */
  keys: Array<{
    senseId: string; provider: string; grantedScopes: string[];
    renewedAt: string | null; failures: number;
  }>;
  /** Disconnections the provider never confirmed — his to finish, not Foundry's. */
  unconfirmed: Array<{ provider: string; when: string }>;
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
  /** What he is having Foundry do with it, and every time that changed. */
  posture: { now: string; inPlainWords: string; changes: Array<{ from: string; to: string; said: string; when: string }> };
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
  const allowance = await intent.allowanceFor(productId);
  const preferences = await intent.preferencesFor(productId);
  const formerAllowance = await intent.formerAllowanceFor(productId);
  const decisions = await intent.recentDecisions(productId);
  const { whatSituation } = await import('../../services/founder/what-situation.js');
  const situation = await whatSituation(productId);
  // RECORDED HERE TOO, not only in the tick. He may open a company the moment
  // he creates it, and a page that showed a situation the institution had not
  // recorded would be showing him something it cannot later refer back to.
  const chain = await import('../../services/founder/situation-chain.js');
  const spell = await chain.recordSituation(productId);
  const advice = await chain.recommendFor(productId);
  const past = await chain.spellHistory(productId);
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
  const credentials = await import('../../services/senses/credentials.js');
  const keys = await credentials.credentialHealthFor(productId);
  const unconfirmed = await credentials.unconfirmedRevocations(productId);

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

  const { postureHistory, POSTURE_IN_PLAIN_WORDS: POSTURE_WORDS } = await import(
    '../../services/founder/burden.js');
  const postureNow = String(((await query('SELECT posture FROM products WHERE id = ?', [productId]))
    .rows[0] as Record<string, unknown> | undefined)?.posture ?? 'grow');
  const postureChanges = await postureHistory(productId);

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
    keys: keys.map((k) => ({
      senseId: k.senseId, provider: senseSystem.providerName(k.provider),
      grantedScopes: k.grantedScopes, renewedAt: k.renewedAt, failures: k.failures,
    })),
    unconfirmed: unconfirmed.map((u) => ({
      provider: senseSystem.providerName(u.provider), when: u.when,
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
    posture: { now: postureNow, inPlainWords: POSTURE_WORDS[postureNow as keyof typeof POSTURE_WORDS] ?? postureNow, changes: postureChanges },
    spell: { days: spell.days, beganAt: spell.beganAt },
    past: past.map((p) => ({
      situation: p.situation, becameWhat: p.becameWhat, days: p.days, endedAt: p.endedAt,
    })),
    advice: advice.map((a) => ({
      id: a.id, summary: a.summary, why: a.why, wouldNeed: a.wouldNeed,
    })),
    allowance: allowance ? {
      id: allowance.id, statement: allowance.statement,
      amount: (allowance.amountCents / 100).toFixed(2),
      left: (allowance.remainingCents / 100).toFixed(2),
    } : null,
    preferences: preferences.map((p) => ({ id: p.id, statement: p.statement })),
    formerAllowance: formerAllowance ? {
      amount: (formerAllowance.amountCents / 100).toFixed(2),
      withdrawnAt: formerAllowance.withdrawnAt, reason: formerAllowance.reason,
    } : null,
    proposals: proposals.map((p) => ({
      id: p.id, summary: p.summary, why: p.why, expectedEffect: p.expectedEffect,
      risk: p.risk, consequence: p.consequence, expiresAt: p.expiresAt.slice(0, 10),
      // WHAT KIND OF ACT, WHAT IT COSTS, AND WHAT UNDOING IT WOULD INVOLVE.
      //
      // The card carried a low/medium/high consequence it never rendered, and
      // had no notion of cost or of putting anything back. Two of the three
      // the institution already knew: the rung says in its own words what the
      // act does, and whether any standing policy could ever cover the class.
      // THE MEANING, NOT THE ENUM. This read "public — publishes, messages or
      // contacts someone outside": the column's own value, then the sentence
      // that explains it, on a card asking him to authorise something.
      kindOfAct: p.rungMeans,
      puttingItBack: p.puttingItBack,
      onlyEverYours: p.absorbable === false,
      cost: p.costCents === null ? null
        : p.costCents === 0 ? 'nothing'
          : `$${(p.costCents / 100).toFixed(2)}`,
    })),
    budgetMonthly: row.operating_budget_monthly_usd == null ? null
      : Number(row.operating_budget_monthly_usd),
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

  // THE COMPANIES PLACE IS THE PORTFOLIO. It was a list of names and dates,
  // which answers "what do I own" and none of the questions that follow it:
  // how is everything doing, which one is deteriorating, does anything need me.
  //
  // AND NO NEW DOOR FOR IT. The Attention Law says top-level mounts may only
  // shrink, and the owner's rule is that increasing capability should not
  // produce more navigation. A portfolio is what this place always was.
  const { portfolioFor } = await import('../../services/founder/portfolio.js');
  const portfolio = await portfolioFor(String(founder.id));

  const { REFERENCE_SCENARIOS } = await import('../../services/reference/scenarios.js');
  const started = new Set(portfolio.reference.map((r) => r.name));
  const unstarted = REFERENCE_SCENARIOS.filter((sc) => !started.has(sc.companyName));

  // AN INVENTED COMPANY SAYS SO ON ITS OWN CARD.
  //
  // The two lists were told apart only by the heading above them, so a card
  // read on its own — which is how a screen reader reads it, and how a card
  // linked to directly arrives — was indistinguishable from one of his. The
  // whole point of these is that they are not his.
  const line = (c: typeof portfolio.companies[number]): string =>
    `<a class="item" href="/foundry/companies/${c.productId}"
      aria-label="${c.name}${c.reference ? ', a company I made up' : ''}">
      <h3>${c.name}${c.reference ? ' <span class="pill">Invented</span>' : ''}${
  c.needsHim ? ` <span class="gap">— ${c.needsHim}</span>` : ''}</h3>
      <p>${c.headline}${c.days > 0 && c.situation !== 'steady'
  ? ` <span class="quiet">For ${String(c.days)} ${c.days === 1 ? 'day' : 'days'}.</span>` : ''}</p>
      <p class="quiet">${c.canSee === 0 ? 'I cannot see anything about it.'
  : `I can see ${String(c.canSee)} ${c.canSee === 1 ? 'thing' : 'things'} about it`
    + `${c.cannotSee > 0 ? `, and ${String(c.cannotSee)} I cannot` : ''}.`}</p>
    </a>`;

  // WHAT EACH ONE EARNS AGAINST WHAT IT COSTS TO OWN, INCLUDING HIM. Headline
  // revenue is not the measure; a business that needs him four times a week is
  // worth less to him than one that needs nobody, and this is where the page
  // says so - in a sentence with a stated rule behind it, not a score.
  const { burdenFor, POSTURE_IN_PLAIN_WORDS } = await import('../../services/founder/burden.js');
  const burdens = new Map((await burdenFor(String(founder.id))).map((b) => [b.productId, b]));

  // THE RIVER, IN ITS LAYERS. Anchors and tributaries by stated arithmetic,
  // the frontier by what is being looked at; cash flow by how it is earned,
  // from what each company declared about itself. No valuations: Foundry
  // cannot see what a business is worth, and a number it cannot see is a
  // number it does not show.
  const { glanceFor, layersFor } = await import('../../services/founder/portfolio.js');
  const glance = await glanceFor(String(founder.id));
  // A rehearsal search is offered only when nothing is being searched for. One
  // search at a time is the rule, and an invented one must never displace his.
  const { currentMandate } = await import('../../services/venture/mandate.js');
  const searching = await currentMandate(String(founder.id)) !== null;
  const river = await layersFor(String(founder.id));
  const byForm = ((await query(
    `SELECT e.value, SUM(COALESCE((SELECT m.mrr_cents FROM metric_snapshots m
        WHERE m.product_id = p.id AND m.mrr_cents IS NOT NULL
                AND m.snapshot_date >= date('now','-45 day')
        ORDER BY m.snapshot_date DESC LIMIT 1), 0)) AS cents
       FROM portfolio_exposures e JOIN products p ON p.id = e.subject_id
      WHERE e.founder_id = ? AND e.subject_kind = 'company' AND e.dimension = 'revenue_model'
        AND e.retired_at IS NULL AND e.evidence_mode = 'real' AND p.reality = 'real'
        AND p.status = 'active' AND p.deleted_at IS NULL
      GROUP BY e.value ORDER BY cents DESC`, [String(founder.id)]))
    .rows as unknown as Array<Record<string, unknown>>)
    .map((r) => ({ form: String(r.value), cents: Number(r.cents) }))
    .filter((r) => r.cents > 0);
  const formTotal = byForm.reduce((n, r) => n + r.cents, 0);
  const swatches = ['var(--c1)', 'var(--c2)', 'var(--c3)', 'var(--c4)'];
  const frontierLine = (river.frontier.looking === 0 && river.frontier.awaiting === 0
    ? 'nothing being looked at'
    : `${String(river.frontier.looking)} being looked at`
      + (river.frontier.awaiting > 0 ? `, ${String(river.frontier.awaiting)} waiting on you` : ''))
    + (river.frontier.buried > 0 ? `, ${String(river.frontier.buried)} buried` : '');

  const body = html`
    <h1>Portfolio</h1>
    <p class="${portfolio.anythingNeedsHim ? 'lede alarm' : 'lede'}">${portfolio.headline}</p>
    ${glance.companies > 0 && glance.cashFlowCents === null && glance.interruptions === 0
    && !glance.concentration ? html`<p class="quiet">Nothing reports revenue to me yet, so
      there is nothing to total. The river below is its shape, not its size.</p>` : ''}
    ${glance.cashFlowCents !== null || glance.interruptions > 0 || glance.concentration
    ? html`<dl class="glance">
      <div class="tile"><dt class="k">Monthly cash flow</dt>
        <dd class="v">${glance.cashFlowCents === null ? '—' : money(glance.cashFlowCents)}</dd>
        <dd class="d">${glance.cashFlowCents === null ? 'nothing reports revenue yet'
    : `${String(glance.seen)} of ${String(glance.companies)} report it`}</dd></div>
      <div class="tile"><dt class="k">Needed you</dt>
        <dd class="v">${String(glance.interruptions)}</dd>
        <dd class="d">${glance.interruptions === 0 ? 'not once this month' : 'times this month'}</dd></div>
      <div class="tile"><dt class="k">Most shared</dt>
        <dd class="v">${glance.concentration ? glance.concentration.split(' share ')[0] : 'nothing'}</dd>
        <dd class="d">${glance.concentration ? `share ${glance.concentration.split(' share ')[1]}`
    : 'no two depend on the same thing'}</dd></div>
    </div>
    ${glance.companies > 0 ? html`${raw(river.layers.map((l) =>
    `<div class="layer"><div class="t"><b>${l.title}</b>
      <span>${l.companies.length === 0 ? 'none yet' : l.companies.map((c) => c.name).join(', ')} — ${l.what}</span></div>
      <div class="n">${l.cashFlowCents > 0 ? money(l.cashFlowCents) : '—'}</div></div>`).join(''))}
    <div class="layer"><div class="t"><b>Frontier</b>
      <span>${frontierLine}</span></div>
      <div class="n">${String(river.frontier.looking)}</div></div>` : ''}
    ${byForm.length > 0 ? html`<div class="know" style="margin-top:var(--s3)">
      <h2>Cash flow by how it is earned</h2>
      <div class="bar">${raw(byForm.map((r, i) =>
    `<i style="width:${((r.cents / formTotal) * 100).toFixed(1)}%;background:${swatches[i % swatches.length]}"></i>`).join(''))}</div>
      <p class="legend">${raw(byForm.map((r, i) =>
    `<span><i style="background:${swatches[i % swatches.length]}"></i>${r.form} ${Math.round((r.cents / formTotal) * 100)}%</span>`).join(''))}</p>
      <p class="quiet">From what each company says about how it earns. A company that has not said is not here.</p>
    </div>` : ''}` : ''}
    <!-- THE LIST HAS A NAME NOW. The company cards were h3 with no h2 above
         them, so a screen reader heard the page jump a level straight into
         them — and the page itself never said what the list was. -->
    ${portfolio.companies.length > 0
    ? html`<h2 class="section">What you own</h2>` : ''}
    ${raw(portfolio.companies.map((c) => {
    const b = burdens.get(c.productId);
    return line(c) + (b ? `<p class="${b.verdict === 'earning its keep' || b.verdict === 'too early to say' ? 'quiet' : 'gap'}"
      style="margin:-8px 0 var(--s3)">${b.sentence}${b.posture !== 'grow'
      ? ` You have me ${POSTURE_IN_PLAIN_WORDS[b.posture as keyof typeof POSTURE_IN_PLAIN_WORDS] ?? b.posture}.` : ''}</p>` : '');
  }).join(''))}

    <form class="inline" method="POST" action="/foundry/companies" style="margin-top:var(--s4)">
      <input type="text" name="name" required maxlength="60" placeholder="Add a company by name"
        aria-label="Company name" />
      <button class="btn go" type="submit">Add</button>
    </form>
    <p class="quiet">Adding one tells me it exists and that you own it. It does not connect
      anything or let me do anything — those are separate, and I will ask.</p>

    ${portfolio.companies.length > 1 ? html`<div class="know" style="margin-top:var(--s4)">
      <h2>Where the next dollar goes</h2>
      <p class="quiet">Ask me that and I will put them in an order and tell you what I
        cannot see. The allocation is yours.</p>
      <a class="btn" href="/foundry?q=${encodeURIComponent('Where should the next dollar go?')}">Ask</a>
    </div>` : ''}

    <div class="know" style="margin-top:var(--s5)">
      <h2>Companies I made up</h2>
      <p class="quiet">You should not have to hand me a real business to find out what I do
        with one. These are invented. I run them exactly as I would run yours — same
        numbers, same judgement, same ladder — and nothing I learn from them can ever be
        told to you as fact about a real company, counted in the totals above, or let me
        act in the world.</p>
      ${raw(portfolio.reference.map(line).join(''))}
      ${searching ? '' : html`<form method="POST" action="/foundry/reference/search"
          style="margin-top:var(--s3)">
          <button class="btn" type="submit">Show me what a search looks like, and what it
            brings me</button>
        </form>`}
      ${raw(unstarted.map((sc) => `<form method="POST" action="/foundry/reference"
          style="margin-top:var(--s3)">
          <input type="hidden" name="scenario" value="${sc.key}" />
          <button class="btn" type="submit">Show me ${sc.situation}</button>
        </form>`).join(''))}
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
  // A DOUBLE TAP IS ONE COMPANY.
  //
  // This inserted unconditionally, so two submissions — which is what a phone
  // on a slow connection produces, and what a page reload after a submit
  // produces — gave him two identical companies, each with its own history and
  // its own half of whatever Foundry later learned. Naming the same company
  // twice is not a new company; it is the same sentence said twice.
  // A company he already named is the company he meant. Only real ones are
  // considered: naming a business of his own must never collide with one of the
  // invented companies, whatever they happen to be called.
  const already = (await query(
    `SELECT id FROM products p
      WHERE p.owner_id = ? AND lower(p.name) = lower(?) AND p.status = 'active'
        AND p.deleted_at IS NULL AND ${realCompany('p')}
      ORDER BY p.created_at LIMIT 1`,
    [String(founder.id), name])).rows[0] as Record<string, unknown> | undefined;
  if (already) return c.redirect(`/foundry/companies/${String(already.id)}?done=added`);

  const { nanoid } = await import('nanoid');
  const id = nanoid();
  await query(
    "INSERT INTO products (id, name, owner_id, status) VALUES (?, ?, ?, 'active')",
    [id, name, String(founder.id)]);

  // AND A NAME OF ITS OWN, FROM ITS FIRST DAY.
  //
  // The owner is not the default actor for his own businesses. An asset whose
  // support inbox, sending domain and marketplace accounts are all personal
  // cannot be sold — the buyer cannot take any of it — and by the time anybody
  // notices, the accounts exist and the customers know them.
  //
  // Created here rather than offered as a setting, because a setting nobody
  // visits produces exactly the asset that was never separable.
  const { nameAnActor } = await import('../../services/institution/acting.js');
  await nameAnActor({ founderId: String(founder.id), productId: id,
    kind: 'company', displayName: name });
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

  const { sparkline } = await import('../../lib/sparkline.js');
  const tiles = view.numbers.numbers.map((n) => {
    const spark = sparkline(n.series, { meaning: n.meaning });
    const cls = n.direction === null || n.direction === 'held' || n.meaning === 'neutral' ? ''
      : (n.direction === 'rose') === (n.meaning === 'up_is_good') ? ' up' : ' down';
    return `<div class="tile"><dt class="k">${n.label}</dt><dd class="v">${n.now}</dd>`
      + `<p class="d${cls}">${n.movement}</p>${spark.svg}</div>`;
  }).join('');

  const body = html`
    <h1>${view.name}</h1>
    ${view.reference ? html`<div class="know" style="border-color:var(--alert)">
      <h3>This company does not exist</h3>
      <p>I made it up, so you could watch me work before handing me anything real.
        It is ${view.reference.situation}.</p>
      <details class="fold"><summary><span class="gist" style="text-align:left">What is invented, and what is not</span></summary>
      ${view.reference.premise ? html`<p class="quiet">${view.reference.premise}</p>` : ''}
      <p class="quiet">The arithmetic below is real. The numbers it runs on are invented, and
        they can never become a fact I tell you about a real company. I cannot send anything
        for it, spend anything on it, or count it as a track record.</p>
      </details>
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
    ${done === 'blind' ? html`<div class="done">
      <p><strong>Disconnected.</strong> I can no longer see that. What I already learned
        stays; nothing new will arrive.</p>
      ${String(c.req.query('unconfirmed') ?? '') === '1'
    ? html`<p class="gap">I have forgotten the authorisation, but the provider did not
        confirm it is dead. If you want to be certain, revoke Foundry's access in the
        provider directly.</p>` : ''}
    </div>` : ''}
    ${done === 'approved' ? html`<div class="done"><p><strong>Approved.</strong> I can do that
      one thing. The boundary stays exactly as it was — I will ask again next time.</p></div>` : ''}
    ${done === 'refused' ? html`<div class="done"><p><strong>Not doing it.</strong> Nothing
      happened. I will not raise that same act again.</p></div>` : ''}
    ${done === 'allowed' && view.allowance ? html`<div class="done"><p><strong>Allowed.</strong>
      Up to $${view.allowance.amount} for this company. I will stop and tell you when it
      runs out.</p></div>` : ''}
    ${done === 'allowancewithdrawn' ? html`<div class="done"><p><strong>Taken back.</strong>
      I cannot spend anything for this company again until you say otherwise.</p></div>` : ''}
    ${done === 'preferred' ? html`<div class="done"><p><strong>Noted.</strong> I will lean
      that way. I will not refuse anything because of it.</p></div>` : ''}
    ${done === 'agreed' ? html`<div class="done"><p><strong>Agreed.</strong> Nothing has
      started. Where I need a permission for it I will ask, and say exactly what I intend to
      do before anything happens.</p></div>` : ''}
    ${done === 'notthat' ? html`<div class="done"><p><strong>Not that.</strong> I will not
      raise it again for this situation.</p></div>` : ''}
    ${done === 'stopped' ? html`<div class="done"><p><strong>Stopped.</strong> I am no longer
      weighing that. Nothing else has changed.</p></div>` : ''}
    ${done === 'nothing' ? html`<div class="done"><p><strong>There was nothing to stop.</strong>
      You had not told me what this company is for.</p></div>` : ''}
    ${done === 'recognised' ? html`<div class="done"><p><strong>Taken on.</strong> I will watch
      it and tell you what I see. I still cannot change anything.</p></div>` : ''}
    ${done === 'declined' ? html`<div class="done"><p><strong>Left alone.</strong> I will not
      raise it again. Say so and I will look at it once more.</p></div>` : ''}

    <div class="hero${view.situation.demandsAttention ? ' alert' : ''}">
      <h2>${view.situation.headline}</h2>
      ${view.situation.demandsAttention ? html`<p>${
  view.situation.because.join('; ')}${view.spell && view.spell.days > 0
    ? `. This has been true for ${String(view.spell.days)} `
      + `${view.spell.days === 1 ? 'day' : 'days'}`
    : ''}. That is what the numbers did — whether it is a problem is yours to say.</p>` : ''}
    </div>

    ${view.advice.length ? html`<div class="know">
      <h2>${view.advice.length === 1 ? 'What I would do' : 'What I would do about it'}</h2>
      ${raw(view.advice.map((a) => `<div class="noticed">
        <p><strong>${a.summary}</strong></p>
        <p class="quiet">${a.why}.</p>
        <p class="quiet"><strong>What I would need:</strong> ${a.wouldNeed}.</p>
        <div class="pair">
        <form method="POST" action="/foundry/advice/${a.id}/accept">
          <button class="btn go" type="submit">Do that</button>
        </form>
        <form method="POST" action="/foundry/advice/${a.id}/decline">
          <button class="btn" type="submit">Not that</button>
        </form>
        </div>
      </div>`).join(''))}
      <p class="quiet">Agreeing does not start anything on its own. Where I need a
        permission I will ask for it separately, and say exactly what I intend to do.</p>
    </div>` : ''}

    ${view.proposals.length ? html`<div class="know">
      <h2>${view.proposals.length === 1 ? 'I need you to decide this' : 'I need you to decide these'}</h2>
      <p class="quiet">You told me not to do this without asking. I cannot do any of it until
        you say yes to that exact thing, and a yes covers only the one act described.</p>
      ${view.proposals.map((p) => html`<div class="noticed">
        <h4>${p.summary}</h4>
        <p><strong>Why</strong> — ${p.why}</p>
        <p><strong>What I expect</strong> — ${p.expectedEffect}</p>
        <p><strong>What could go wrong</strong> — ${p.risk}</p>
        ${p.kindOfAct === null ? html`<p class="quiet">I have not classified what kind of act this is, so treat it as though it cannot be undone.</p>`
    : html`<p><strong>What kind of act</strong> — it ${p.kindOfAct}.</p>
       <p><strong>Putting it back</strong> — ${p.puttingItBack ?? ''}.</p>`}
        ${p.cost === null
    ? html`<p class="quiet"><strong>What it costs</strong> — I do not know.</p>`
    : html`<p><strong>What it costs</strong> — ${p.cost}.</p>`}
        ${p.onlyEverYours ? html`<p class="gap">Nothing you could ever set up would let me
          do this on my own. It is yours, one act at a time, permanently.</p>` : ''}
        <p class="quiet">If you do nothing, I do not do it, and this expires
          ${p.expiresAt}.</p>
        <form method="POST" action="/foundry/proposals/${p.id}/approve">
          <button class="btn go" type="submit">Approve this one thing</button>
        </form>
        <form method="POST" action="/foundry/proposals/${p.id}/refuse">
          <button class="btn" type="submit">Do not do it</button>
        </form>
      </div>`)}
    </div>` : ''}

    ${view.asks.length ? html`<div class="know">
      <h2>${view.asks.length === 1 ? 'Something I noticed' : 'Things I noticed'}</h2>
      <p class="quiet">Each is a movement, not a diagnosis. Yes means I watch it and tell you
        what I see; it does not let me change, spend or contact anything.</p>
      ${raw(view.asks.map((a) => `<div class="noticed">
        <h4>Is this worth me looking after?</h4>
        <p><strong>${a.proposal}</strong></p>
        <p>${a.rationale}</p>
        <div class="pair">
        <form method="POST" action="/letter/responsibility-candidates/${a.id}/promote">
          <input type="hidden" name="return_to" value="company" />
          <button class="btn go" type="submit">Yes — look after this</button>
        </form>
        <form method="POST" action="/letter/responsibility-candidates/${a.id}/reject">
          <input type="hidden" name="return_to" value="company" />
          <button class="btn" type="submit">No</button>
        </form>
        </div>
      </div>`).join(''))}
    </div>` : ''}

    <div class="know">
      <h2>Where the numbers are</h2>
      ${view.numbers.absence
    ? html`<p class="lede">${view.numbers.absence}</p>`
    : html`<div class="numbers">${raw(tiles)}</div>
      <p class="quiet">As of ${String(view.numbers.asOf)}, against the nearest reading to a
        month before. Colour is direction, and only where a direction is good or bad; whether
        any of it is good enough is yours to say.</p>`}
    </div>

    <div class="cols">
    <details class="know fold"><summary><h3>What I know</h3><span class="gist">${view.knows.length === 0 ? 'almost nothing' : count(view.knows.length, 'thing')}</span></summary>
      ${view.knows.length === 0
    ? html`<p class="lede">Almost nothing. You have told me it exists; that is all.</p>`
    : html`<ul>${raw(view.knows.map((k) => `<li>${k}</li>`).join(''))}</ul>`}
    </details>

    ${view.senses.length ? html`<details class="know fold"><summary><h3>What I can see</h3><span class="gist">${count(view.senses.length, 'thing')}, from ${[...new Set(view.senses.map((x) => x.providerName))].join(' and ')}</span></summary>
      <!-- ESCAPED, AND THE REASON IS NOT HYPOTHETICAL. sense.lastError is a
           verbatim slice of a remote HTTP response body: the provider gateways
           throw the status followed by 300 characters of the body, and that
           message is stored on company_senses.last_error and shown here.
           grantedScopes comes straight off a provider's token endpoint. Both
           are text a third party chooses, and this block used to build a
           string and hand it to raw(). -->
      <ul>${view.senses.map((sense) => html`<li><strong>${sense.wouldLearn}</strong> —
        from ${sense.providerName}${sense.mode === 'sandbox'
    ? ', in test mode, so none of it is the world'
    : sense.mode === 'reference' ? ', so none of it is real' : ''}.
        ${sense.lastError
    ? html`<span class="gap">Something is wrong with it: ${sense.lastError}.</span>
          What I show you may be out of date.`
    : sense.lastObservedAt
      ? `Last reported ${sense.lastObservedAt.slice(0, 10)}.`
      : 'It has not reported yet.'}</li>`)}</ul>
      <p class="quiet">None of this lets me act. I cannot
        ${view.senses.map((sense) => sense.neverGrants).join('; ')}.</p>
      ${view.keys.length ? html`<p class="quiet">What I actually hold:
        ${view.keys.map((k) => html`${k.provider} — ${k.grantedScopes.join(', ')}${
  k.renewedAt ? `, renewed ${k.renewedAt}` : ''}${k.failures > 0
    ? html`, <span class="gap">${String(k.failures)} recent failures</span>` : ''}; `)}
        That is the permission the provider actually granted, not the one I
        asked for — if they ever differ, this is where you would see it.</p>` : ''}
      ${view.senses.map((sense) => html`<form method="POST"
        action="/foundry/companies/${view.id}/senses/${sense.id}/disconnect">
        <button class="btn" type="submit">Stop seeing ${sense.shortName}</button>
      </form>`)}
    </details>` : ''}

    <details class="know fold"><summary><h3>What I cannot see</h3><span class="gist">${view.blind.length === 0 ? 'nothing I know how to look at' : count(view.blind.length, 'thing')}</span></summary>
      ${view.blind.length === 0
    ? html`<p class="lede">Nothing I know how to look at is missing.</p>`
    : raw(view.blind.map((gap) => `<p><span class="gap">I cannot see ${gap.cannotSee}.</span>
        ${gap.offers.length
  ? `Connecting ${[...new Set(gap.offers.map((o) => o.providerName))].join(' or ')} would show me ${gap.wouldLearn}.
     <a href="/foundry/companies/${view.id}/see/${gap.senseKey}">Look at that</a>`
  : `Nothing I can connect would tell me this.`}</p>`).join(''))}
      ${view.unconfirmed.length ? raw(view.unconfirmed.map((u) =>
    `<p class="gap">You disconnected ${u.provider} on ${u.when}, and it never confirmed.
      I have forgotten the authorisation; if you want to be certain it is dead, revoke
      Foundry&rsquo;s access in ${u.provider} directly.</p>`).join('')) : ''}
      ${view.stoppedSeeing.length ? raw(view.stoppedSeeing.map((lost) =>
    `<p class="quiet">You turned off ${lost.providerName} on ${lost.disconnectedAt}
      &mdash; ${lost.reason}. <a href="/foundry/companies/${view.id}/see/${lost.senseKey}">Turn it
      back on</a>.</p>`).join('')) : ''}
      <p class="quiet">Letting me read something never lets me change it. That is always a
        separate question.</p>
    </details>

    ${view.responsibilities.length ? html`<details class="know fold"><summary><h3>What I look after</h3><span class="gist">${count(view.responsibilities.length, 'responsibility', 'responsibilities')}</span></summary>
      <ul>${raw(view.responsibilities.map((r) =>
    `<li>${CHECK_IN_PLAIN_WORDS['schema-snapshot-freshness']?.name === r.title ? r.title : r.title}
       — ${LADDER_IN_PLAIN_WORDS[r.state] ?? r.state}</li>`).join(''))}</ul>
    </details>` : ''}

    <details class="know fold"><summary><h3>What matters here</h3><span class="gist">${view.said ? 'you have told me' : 'you have not told me'}</span></summary>
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
          aria-label="What matters for this company, or what Foundry should not do" enterkeyhint="send" autocapitalize="sentences"
          autocorrect="on" spellcheck="true" />
        <button class="btn" type="submit">Tell me</button>
      </form>
      <p class="quiet">Tell me what this company is for, or tell me not to do something and
        I will refuse it every time until you say otherwise. I will say what I understood
        before anything takes effect.</p>
      ${view.allowance ? html`<p><strong>Up to $${view.allowance.amount}</strong> —
        $${view.allowance.left} of it left. ${view.allowance.statement}</p>
      <!-- A CEILING HE COULD SET AND NEVER REMOVE. The function to withdraw one
           existed, was exported, and was called from nowhere — so the only way
           to take back a spending allowance was to set a different one, which
           is not the same act and not what he would mean. -->
      <form method="POST"
        action="/foundry/companies/${view.id}/allowance/${view.allowance.id}/withdraw">
        <button class="btn" type="submit">Take that allowance back</button>
      </form>` : ''}
      ${view.preferences.length ? html`<ul>${raw(view.preferences.map((p) =>
    `<li>${p.statement} <span class="quiet">— a preference. I lean that way; I refuse
      nothing because of it.</span></li>`).join(''))}</ul>` : ''}
      ${view.formerAllowance ? html`<p class="quiet">Before ${view.formerAllowance.withdrawnAt}
        it was $${view.formerAllowance.amount} — ${view.formerAllowance.reason}.</p>` : ''}
      ${view.formerly ? html`<p class="quiet">Before ${view.formerly.retiredAt} it was:
        &ldquo;${view.formerly.statement}&rdquo; — replaced because
        ${view.formerly.retiredReason}.</p>` : ''}
    </details>

    ${view.boundaries.length ? html`<details class="know fold"><summary><h3>What you told me not to do</h3><span class="gist">${count(view.boundaries.length, 'thing')}</span></summary>
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
    </details>` : ''}

    ${view.past.length ? html`<details class="know fold"><summary><h3>What it has been</h3><span class="gist">${count(view.past.length, 'earlier situation')}</span></summary>
      <ul>${view.past.map((p) => html`<li>${plainly(p.situation)} for ${String(p.days)}
        ${p.days === 1 ? 'day' : 'days'}, until ${p.endedAt} — then it became
        ${plainly(p.becameWhat)}.</li>`)}</ul>
    </details>` : ''}

    ${view.decisions.length ? html`<details class="know fold"><summary><h3>What you decided</h3><span class="gist">${view.posture.now !== 'grow' ? view.posture.inPlainWords : count(view.decisions.length, 'decision')}</span></summary>
      ${view.posture.now !== 'grow' || view.posture.changes.length ? html`<p class="quiet">
        You have me <strong>${view.posture.inPlainWords}</strong>.
        ${raw(view.posture.changes.map((ch) =>
    `Since ${ch.when}, when you said &ldquo;${ch.said}&rdquo; (it was ${ch.from} before).`).join(' '))}</p>` : ''}
      <ul>${raw(view.decisions.map((d) =>
    `<li><strong>${d.summary}</strong> — ${
  d.outcome === 'approved' ? (d.used ? 'you approved it and I did it' : 'you approved it; I have not done it yet')
    : d.outcome === 'refused' ? 'you said no, and nothing happened'
      : `you took the approval back${d.note ? ` — ${d.note}` : ''}, before I used it`
} on ${d.at}.</li>`).join(''))}</ul>
    </details>` : ''}

    ${view.lifted.length ? html`<details class="know fold"><summary><h3>What you lifted</h3><span class="gist">${count(view.lifted.length, 'boundary', 'boundaries')}</span></summary>
      <p class="quiet">Changing your mind runs both ways. These are no longer in force.</p>
      <!-- ESCAPED, AND THE ATTRIBUTE IS THE REASON. His own sentence was
           interpolated into value="..." through raw(), so a boundary containing
           a quotation mark — "don't email anyone" typed with a real quote — cut
           the attribute short and the button silently re-bound him to a
           different, shorter rule than the one on the screen above it. -->
      ${view.lifted.map((b) => html`<div class="noticed">
        <p>${b.statement}</p>
        <p class="quiet">Lifted ${b.liftedAt} — ${b.liftedReason}.</p>
        <form method="POST" action="/foundry/companies/${view.id}/said/confirm">
          <input type="hidden" name="said" value="${b.statement}" />
          <button class="btn" type="submit">Hold me to this again</button>
        </form>
      </div>`)}
    </details>` : ''}

    <details class="know fold"><summary><h3>Money</h3><span class="gist">${view.reference ? 'none, ever' : `$${view.spent30d.toFixed(2)} of $${String(view.budgetMonthly)}`}</span></summary>
      ${view.reference
    ? html`<p class="lede">None, and none ever. I am refused at every place money is spent
        for a company that does not exist, so it cannot draw on what the real ones share.</p>`
    : html`<ul><li>$${view.spent30d.toFixed(2)} spent of
        $${String(view.budgetMonthly)} a month.</li></ul>`}
    </details>
    </div>`;

  return c.html(page(view.name, body, 'companies'));
});

// ─── agreeing, or not, with what Foundry would do ───────────────────────────

/**
 * AGREEING IS NOT AUTHORISING, and the route is separate from the act path for
 * exactly that reason.
 *
 * A recommendation is a sentence. Saying "do that" records that he agrees with
 * it; it starts nothing, because most of these need something Foundry does not
 * have and the ones that do not are reads it may already perform. Where an act
 * IS needed, it goes through `proposed_acts` with its owner-bound, act-bound,
 * spent-once approval — and he sees exactly what is intended before it happens.
 *
 * Collapsing the two would make "good idea" mean "go ahead", which is the one
 * confusion an institution operating someone's businesses must never introduce.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
foundryShellRoutes.post('/foundry/advice/:adviceId/:decision',
  requireInstitutionOwner(), async (c: any) => {
    const founder = c.get('founder') as { id?: string } | undefined;
    if (!founder?.id) return c.redirect('/onboarding');
    const decision = c.req.param('decision');
    if (decision !== 'accept' && decision !== 'decline') return c.notFound();

    const owned = await query(
      `SELECT r.id, r.product_id FROM situation_recommendations r
         JOIN products p ON p.id = r.product_id
        WHERE r.id = ? AND p.owner_id = ? AND r.decision IS NULL`,
      [c.req.param('adviceId'), String(founder.id)]);
    if (!owned.rows.length) return c.notFound();
    const productId = String((owned.rows[0] as Record<string, unknown>).product_id);

    const { decideRecommendation } = await import(
      '../../services/founder/situation-chain.js');
    const { principalRef } = await import('../../services/outbound/acting-principal.js');
    await decideRecommendation({
      id: c.req.param('adviceId'),
      decision: decision === 'accept' ? 'accepted' : 'declined',
      decidedBy: principalRef('founder', String(founder.id)),
    });
    return c.redirect(
      `/foundry/companies/${productId}?done=${decision === 'accept' ? 'agreed' : 'notthat'}`);
  });

/**
 * YES TO AN ACQUISITION, WHICH IS NOT YES TO AN ACT.
 *
 * Approving here makes a provider exist in the fabric, declared and then
 * available on the evidence that it was wired. It grants nothing: the acquired
 * capability reaches the world only through the same outbound door, on the same
 * rung, under the same boundaries and allowances. The door does not know the
 * provider is new, and that is the point.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
foundryShellRoutes.post('/foundry/acquisitions/:id/decide',
  requireInstitutionOwner(), async (c: any) => {
    const founder = c.get('founder') as { id?: string } | undefined;
    if (!founder?.id) return c.redirect('/onboarding');
    const form = await c.req.parseBody();
    const decision = String(form.decision ?? '');
    if (decision !== 'approved' && decision !== 'declined') return c.redirect('/foundry');

    const owned = await query(
      'SELECT id FROM capability_acquisitions WHERE id = ? AND founder_id = ? AND decision IS NULL',
      [c.req.param('id'), String(founder.id)]);
    if (!owned.rows.length) return c.notFound();

    const { decideAcquisition } = await import('../../services/institution/acquisition.js');
    await decideAcquisition({
      id: c.req.param('id'), decision, by: `founder:${String(founder.id)}` });
    return c.redirect(`/foundry?done=${decision === 'approved' ? 'acquiring' : 'notacquiring'}`);
  });

// ─── an entrepreneurial mandate ─────────────────────────────────────────────

/**
 * "I'D LIKE YOU TO ADD A NEW MICRO-SAAS VENTURE TO MY PORTFOLIO."
 *
 * Heard as a MANDATE — a standing instruction to go and look — rather than as
 * an instruction to build software. Everything he says afterwards is absorbed
 * into it: "I don't want paid acquisition" becomes a filter every candidate is
 * tested against, "try harder to disprove it" raises the bar one must clear.
 *
 * Nothing binds without confirmation, exactly as standing intent does, because
 * a misheard mandate would send the institution looking for the wrong thing for
 * weeks and he would not find out until it came back.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
/**
 * WHAT IT COULD NOT TAKE, HE HEARS ABOUT.
 *
 * A DEFECT FOUND BY READING THE SCREEN HE ACTUALLY LANDS ON. He gave four
 * constraints. Three were held; the fourth — "avoid increasing our biggest
 * existing dependencies" — was refused for a good reason: nothing is
 * concentrated yet, so there is nothing to avoid deepening. That reason was
 * computed, returned, and thrown away by the handler, which redirected him to a
 * screen saying the search had started. He would have believed all four were
 * being held.
 *
 * Silence about a refusal is worse than the refusal. So when something did not
 * land he sees what did, what did not, and why. When everything landed this
 * stays quiet and simply gets on with it, because a confirmation screen for a
 * submission with nothing to report is machinery.
 *
 * Shared by both entrances. Two handlers with the same responsibility drift,
 * and one of them silently losing his constraints is how this started.
 */
async function absorbAndAnswer(
  c: any, founderId: string, readings: VentureReading[],
): Promise<Response> {
  const venture = await import('../../services/venture/mandate.js');
  const hadMandate = readings.some((r) => r.kind === 'mandate');
  const result = await venture.absorbParagraph({ founderId, readings });

  if (result.refused.length > 0 || result.notHeard.length > 0) {
    const held = readings.filter((r) => r.kind === 'guidance').length - result.refused.length;
    return c.html(page('What I understood', html`
      <h1>${result.opened ? 'I am looking' : 'I heard you'}</h1>
      ${result.opened ? html`<p class="lede">The search is running.</p>` : ''}
      ${held > 0 ? html`<p>I am holding myself to ${String(held)} of the things you
        said.</p>` : ''}
      <div class="know">
        <h2>What I could not take, and why</h2>
        <ul>${raw(result.refused.map((r) => `<li>${r}</li>`).join(''))}
          ${raw(result.notHeard.map((n) =>
    `<li>&ldquo;${n}&rdquo; &mdash; I did not understand what to do with that</li>`).join(''))}</ul>
        <p class="quiet">Nothing is lost by being refused. Say it another way, or say it
          later when it applies.</p>
      </div>
      <form class="inline" method="POST" action="/foundry/ask">
        <input type="text" name="said" maxlength="800"
          placeholder="Say it another way" aria-label="Say it another way" enterkeyhint="send" autocapitalize="sentences"
          autocorrect="on" spellcheck="true" />
        <button class="btn" type="submit">Tell me</button>
      </form>
      <a class="btn go" href="/foundry">Back</a>`, 'foundry'));
  }

  if (hadMandate && !result.opened) return c.redirect('/foundry?done=alreadylooking');
  if (result.opened) return c.redirect('/foundry?done=looking');
  if (result.absorbed > 0) return c.redirect('/foundry?done=steeredsearch');
  return c.redirect('/foundry');
}

// A SEARCH HE CAN WATCH BEFORE HE HAS A REAL ONE.
//
// The reference world had seven invented companies and no invented search, so
// the opportunity card — the surface where an enormous amount of research is
// supposed to collapse into one decision — was unreachable from the product.
// It could only be seen by a real candidate surviving real evidence, which has
// never happened and should not be rushed.
//
// This opens a rehearsal search, the same way the invented companies work: the
// machinery is real, the market is not, and nothing it produces can be counted
// or acted on. It refuses while any search is open, because one search at a
// time is the rule and a rehearsal must never displace the real thing.
// TAKING BACK WHAT HE ALLOWED.
//
// Setting an allowance was reachable and removing one was not: the function
// existed, exported, called from nowhere. A ceiling he cannot lower is not a
// ceiling he set — it is one he is stuck with — and on a surface whose whole
// subject is what he has permitted, that is the wrong way round.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
foundryShellRoutes.post('/foundry/companies/:id/allowance/:allowanceId/withdraw',
  requireInstitutionOwner(), async (c: any) => {
    const founder = c.get('founder') as { id?: string } | undefined;
    if (!founder?.id) return c.redirect('/onboarding');
    const productId = c.req.param('id');
    const owned = await query(
      'SELECT id FROM products WHERE id = ? AND owner_id = ?',
      [productId, String(founder.id)]);
    if (!owned.rows.length) return c.notFound();

    const { withdrawAllowance } = await import('../../services/institution/standing-intent.js');
    await withdrawAllowance(String(c.req.param('allowanceId')), 'you took it back');
    return c.redirect(`/foundry/companies/${productId}?done=allowancewithdrawn`);
  });

foundryShellRoutes.post('/foundry/reference/search', requireInstitutionOwner(),
  async (c: any) => {
    const founder = c.get('founder') as { id?: string } | undefined;
    if (!founder?.id) return c.redirect('/onboarding');
    const { currentMandate, openMandate } = await import('../../services/venture/mandate.js');
    if (await currentMandate(String(founder.id)) !== null) {
      return c.redirect('/foundry?done=alreadylooking');
    }
    await openMandate({
      founderId: String(founder.id), evidenceMode: 'reference', shape: null,
      statement: 'Find another small digital income stream that would make the portfolio '
        + 'more resilient, without deepening what it already depends on',
    });
    return c.redirect('/foundry');
  });

// ONE DOOR.
//
// The owner opened the deployed product to give the institution its first real
// mandate and got a 404. The form was mine and posted to a route that does not
// exist — but the deeper failure was the shape: a form posting to
// /foundry/venture requires him to know that a venture mandate is a thing, and
// to have found the one screen that collects one.
//
// He says what he wants. Choosing which system receives it is Foundry's job.
//
// This adds no new capability. Every destination is a handler that already
// existed; what is new is that nobody has to know which.
foundryShellRoutes.post('/foundry/ask', requireInstitutionOwner(), async (c: any) => {
  const founder = c.get('founder') as { id?: string } | undefined;
  if (!founder?.id) return c.redirect('/onboarding');
  const form = await c.req.parseBody();
  const said = String(form.said ?? '').trim().slice(0, 800);

  const { whichDoor } = await import('../../services/institution/the-door.js');
  const { currentMandate } = await import('../../services/venture/mandate.js');
  const door = whichDoor(said, { searching: await currentMandate(String(founder.id)) !== null });

  // WHAT IT COULD PLACE, IT HANDS ON — by calling the handler that owns the
  // responsibility, rather than by redirecting the browser to it. A redirect
  // would turn one submission into two requests and lose the body on the way.
  if (door.destination === 'venture') {
    const venture = await import('../../services/venture/mandate.js');
    const readings = venture.readVentureParagraph(said);
    if (readings.some((r) => r.kind === 'stop_mandate') && readings.length === 1) {
      const stopped = await venture.stopMandate(String(founder.id), 'the owner said to stop');
      return c.redirect(`/foundry?done=${stopped ? 'searchstopped' : 'nothing'}`);
    }
    return absorbAndAnswer(c, String(founder.id), readings);
  }

  // A QUESTION IS ANSWERED, NOT APOLOGISED FOR.
  //
  // This routed anything the door read as a question to a page headed "Let me
  // answer that" whose next sentence was "I cannot answer questions in words
  // yet" — two consecutive sentences contradicting each other, the second of
  // them false. The first screen has answered these all along: the bar at the
  // bottom of every page submits the same sentence to /foundry?q= and gets a
  // real answer. Two entrances to one institution must not disagree about what
  // it can do, so this one hands the question to the path that answers it.
  if (door.destination === 'question') {
    return c.redirect(`/foundry?q=${encodeURIComponent(said)}`);
  }

  // AND WHAT IT COULD NOT PLACE COMES BACK WITH HIS WORDS IN IT. Losing three
  // hundred words of mandate because nothing recognised them is a worse failure
  // than the 404 was: the 404 at least did not pretend to have heard him.
  return c.html(page('What you said', html`
    <h1>I did not follow that</h1>
    <p class="lede">You said: <strong>${door.said}</strong></p>
    ${door.needs !== null ? html`<p>I understood ${door.understoodAs}, but I need
      ${door.needs} before I can act on it. Say it on that company's page and it will
      stick.</p>`
    : html`<p>I understood you were telling me something, but not what to do about it.</p>`}
    <div class="know">
      <h2>Your words are not lost</h2>
      <p class="quiet">Change anything you like and send it again.</p>
      <form method="POST" action="/foundry/ask">
        <textarea name="said" rows="4" maxlength="800"
          aria-label="What you want" enterkeyhint="send" autocapitalize="sentences" spellcheck="true">${door.said}</textarea>
        <button class="btn go" type="submit">Send it again</button>
      </form>
    </div>
    <a class="btn" href="/foundry">Back</a>`, 'foundry'));
});

foundryShellRoutes.post('/foundry/venture', requireInstitutionOwner(), async (c: any) => {
  const founder = c.get('founder') as { id?: string } | undefined;
  if (!founder?.id) return c.redirect('/onboarding');
  const form = await c.req.parseBody();
  const said = String(form.said ?? '').trim().slice(0, 800);
  if (!said) return c.redirect('/foundry');

  const venture = await import('../../services/venture/mandate.js');
  const readings = venture.readVentureParagraph(said);
  const reading = readings.find((r) => r.kind !== 'not_venture') ?? readings[0]
    ?? venture.readVentureSentence(said);

  if (reading.kind === 'not_venture') {
    return c.html(page('What you said', html`
      <h1>I did not follow that</h1>
      <p class="lede">You said: <strong>${said}</strong></p>
      <p>I understood you were talking about finding a business, but not what you
        wanted me to do about it.</p>
      <div class="know">
        <h2>What I can act on</h2>
        <ul>
          <li>Asking me to look — &ldquo;add a new micro-SaaS venture to my portfolio&rdquo;</li>
          <li>Steering the search — what to avoid, what to prefer, an industry, a budget</li>
          <li>Telling me to be harder on a candidate, or to show you another</li>
          <li>Telling me to stop</li>
        </ul>
      </div>
      <a class="btn" href="/foundry">Back</a>`, 'foundry'));
  }

  if (reading.kind === 'stop_mandate') {
    const open = await venture.currentMandate(String(founder.id));
    return c.html(page('What you said', html`
      <h1>${open ? 'Stop looking?' : 'There is nothing to stop'}</h1>
      <p class="lede">You said: <strong>${said}</strong></p>
      ${open
    ? html`<div class="know">
        <h2>What I would stop</h2>
        <p><strong>${open.statement}</strong></p>
        <p class="quiet">I will stop looking. Everything I have already found stays on the
          record, including what I rejected and why — so if you start again I am not
          beginning from nothing.</p>
      </div>
      ${readings.length > 1 ? html`<div class="know"><h3>Each part of that, as I heard it</h3>
      <ul>${raw(readings.map((r) => `<li>${r.statement} — ${
    r.kind === 'mandate' ? 'go and look'
      : r.kind === 'guidance' ? `hold the search to this (${r.guidance}${r.subject ? `: ${r.subject}` : ''})`
        : r.kind === 'stop_mandate' ? 'stop' : 'not understood; I will leave this one out'}</li>`)
    .join(''))}</ul></div>` : ''}
    <form method="POST" action="/foundry/venture/confirm">
        <input type="hidden" name="said" value="${said}" />
        <button class="btn go" type="submit">Yes — stop looking</button>
      </form>` : html`<p>I am not looking for anything at the moment.</p>`}
      <a class="btn" href="/foundry">Back</a>`, 'foundry'));
  }

  if (reading.kind === 'guidance') {
    const open = await venture.currentMandate(String(founder.id));
    if (!open) {
      return c.html(page('What you said', html`
        <h1>There is no search to steer</h1>
        <p class="lede">You said: <strong>${said}</strong></p>
        <p>Ask me to look for something first, and I will hold that against every
          candidate I find.</p>
        <a class="btn" href="/foundry">Back</a>`, 'foundry'));
    }
    return c.html(page('What you said', html`
      <h1>Hold the search to this?</h1>
      <p class="lede">You said: <strong>${said}</strong></p>
      <div class="know">
        <h2>What I will do</h2>
        <p>${GUIDANCE_IN_PLAIN_WORDS(reading.guidance, reading.subject)}</p>
        <p class="quiet">This becomes part of the search itself, not a note beside it.
          Every candidate from here is tested against it, and I will tell you when one
          fails because of something you said.</p>
      </div>
      <form method="POST" action="/foundry/venture/confirm">
        <input type="hidden" name="said" value="${said}" />
        <button class="btn go" type="submit">Yes</button>
      </form>
      <a class="btn" href="/foundry">No</a>`, 'foundry'));
  }

  return c.html(page('What you said', html`
    <h1>Go and look?</h1>
    <p class="lede">You said: <strong>${said}</strong></p>
    <div class="know">
      <h2>What I will do</h2>
      <p>I will treat that as an instruction to go and find you
        ${reading.shape ? `a ${reading.shape.replaceAll('_', '-')} business` : 'a business'}
        — not an instruction to build one.</p>
      <p class="quiet">That means looking for real problems people already have, working
        out who solves them now, how they reach anyone, and what anyone pays — and trying
        to kill each idea before I bring it to you. I will advance very few. Telling you
        none of them are worth it is a real answer.</p>
      <ul>
        <li><strong>Cost</strong> — nothing until you set a budget.</li>
        <li><strong>What I could do on my own</strong> — nothing. I cannot create a
          company, spend anything, or contact anyone without asking you.</li>
        <li><strong>Stopping</strong> — say so, any time.</li>
      </ul>
    </div>
    <form method="POST" action="/foundry/venture/confirm">
      <input type="hidden" name="said" value="${said}" />
      <button class="btn go" type="submit">Yes — go and look</button>
    </form>
    <a class="btn" href="/foundry">No</a>`, 'foundry'));
});

/** Plain words for what a piece of steering will actually do. */
function GUIDANCE_IN_PLAIN_WORDS(kind: string, subject: string | null): string {
  switch (kind) {
    case 'avoid':
      return `I will reject any candidate that depends on ${subject ?? 'that'}, and say `
        + 'that is why.';
    case 'prefer':
      return `I will weight the search toward ${subject ?? 'that'} — it makes a candidate `
        + 'more likely to reach you, not automatically right.';
    case 'industry':
      return `I will look in ${subject ?? 'that industry'} instead of wherever I was `
        + 'looking. This replaces the last industry you named.';
    case 'budget':
      return `I will spend at most $${subject ?? '0'} finding out whether a candidate is `
        + 'real, and stop and tell you when it is gone.';
    case 'harder':
      return 'I will raise the bar. A candidate now has to survive more attempts to kill '
        + 'it before I bring it to you at all.';
    case 'deeper':
      return 'I will keep working on that one rather than moving on.';
    case 'favour':
      return 'I will treat that one as the front runner and put my effort there — without '
        + 'stopping trying to kill it, which is when a favourite is most dangerous.';
    default:
      return 'I will look for a different kind of candidate.';
  }
}

/** Bind it. The sentence is re-read here rather than trusted from the form. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
foundryShellRoutes.post('/foundry/venture/confirm',
  requireInstitutionOwner(), async (c: any) => {
    const founder = c.get('founder') as { id?: string } | undefined;
    if (!founder?.id) return c.redirect('/onboarding');
    const form = await c.req.parseBody();
    const said = String(form.said ?? '').trim().slice(0, 800);
    if (!said) return c.redirect('/foundry');

    const venture = await import('../../services/venture/mandate.js');
    // THE WHOLE PARAGRAPH, EVERY SENTENCE OF IT LANDING. "Make the river
    // stronger. Keep legal risk low. Do not spend more than $25." is one
    // instruction with three parts, and an institution that heard the first
    // and dropped the rest would be a chat window with a database behind it.
    const readings = venture.readVentureParagraph(said);
    if (readings.some((r) => r.kind === 'stop_mandate') && readings.length === 1) {
      const stopped = await venture.stopMandate(String(founder.id), 'the owner said to stop');
      return c.redirect(`/foundry?done=${stopped ? 'searchstopped' : 'nothing'}`);
    }
    return absorbAndAnswer(c, String(founder.id), readings);
  });

/**
 * THE TEST HE APPROVES, AND THE PREDICTION HE IS APPROVING WITH IT.
 *
 * An experiment costs money or contacts people or both, and there is no company
 * here yet to have granted an allowance — so the decision is his, one at a
 * time, before anything happens. The database seals the prediction the moment
 * he decides, which is what makes his approval mean something: he agreed to a
 * specific test with a specific way of being wrong, and neither can be edited
 * afterwards.
 */
foundryShellRoutes.post('/foundry/venture/experiment',
  requireInstitutionOwner(), async (c: any) => {
    const founder = c.get('founder') as { id?: string } | undefined;
    if (!founder?.id) return c.redirect('/onboarding');
    const form = await c.req.parseBody();
    const experimentId = String(form.experimentId ?? '').trim();
    const decision = String(form.decision ?? '');
    if (!experimentId || (decision !== 'approved' && decision !== 'declined')) {
      return c.redirect('/foundry');
    }
    const { decideExperiment } = await import('../../services/venture/validation.js');
    await decideExperiment({
      experimentId, decision, by: `founder:${String(founder.id)}` });
    return c.redirect(`/foundry?done=${decision === 'approved' ? 'trying' : 'nottrying'}`);
  });

/**
 * WHAT HAPPENED, WHICH ONLY HE CAN SAY.
 *
 * `recordResult` has existed and been correct for some time, and had no caller
 * outside its tests — so the institution sealed a prediction before every
 * experiment and had no path by which the answer ever came back.
 *
 * HE IS THE REPORTER, NEVER THE MODEL. The verdict is stored beside the sealed
 * prediction so anybody can read both and disagree with the grading; an
 * institution that scored its own predictions with no record of what it
 * predicted would always have been right.
 *
 * The experiment is resolved from the authenticated owner rather than from the
 * form, and one belonging to anybody else is refused without revealing that it
 * exists.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
foundryShellRoutes.post('/foundry/venture/experiment/:experimentId/result',
  requireInstitutionOwner(), async (c: any) => {
    const founder = c.get('founder') as { id?: string } | undefined;
    if (!founder?.id) return c.redirect('/onboarding');
    const form = await c.req.parseBody();
    const experimentId = c.req.param('experimentId');

    const owned = await query(
      `SELECT id FROM venture_experiments
        WHERE id = ? AND founder_id = ? AND decision = 'approved' AND ran_at IS NULL`,
      [experimentId, String(founder.id)]);
    if (!owned.rows.length) return c.notFound();

    const asPredicted = String(form.as_predicted ?? '') === 'yes';
    // HIS WORDS WHEN HE HAS THEM, and a truthful placeholder when he does not —
    // never an invented account of what happened. A surprise with no detail is
    // still a surprise, and pretending otherwise would put a sentence Foundry
    // wrote into the evidence record as though somebody had observed it.
    const said = String(form.what_happened ?? '').trim();
    const whatHappened = said !== '' ? said
      : asPredicted
        ? 'The owner confirmed it went as predicted, without adding detail.'
        : 'The owner said something else happened, without adding detail.';

    const { recordResult } = await import('../../services/venture/validation.js');
    await recordResult({ experimentId, whatHappened, asPredicted });
    return c.redirect(`/foundry?done=${asPredicted ? 'aspredicted' : 'surprised'}`);
  });

/**
 * TAKING ONE FORWARD, WHICH IS HIS ACT AND NOT FOUNDRY'S.
 *
 * The check runs again here rather than trusting the page he clicked from: what
 * stood in the way may have changed since it was rendered, and an advancement
 * granted by a stale screen is an advancement nobody actually established.
 */
foundryShellRoutes.post('/foundry/venture/advance',
  requireInstitutionOwner(), async (c: any) => {
    const founder = c.get('founder') as { id?: string } | undefined;
    if (!founder?.id) return c.redirect('/onboarding');
    const form = await c.req.parseBody();
    const opportunityId = String(form.opportunityId ?? '').trim();
    if (!opportunityId) return c.redirect('/foundry');
    const { advance } = await import('../../services/venture/validation.js');
    const done = await advance({
      opportunityId, by: `founder:${String(founder.id)}` });
    return c.redirect(`/foundry?done=${done.advanced ? 'advanced' : 'stillintheway'}`);
  });

/**
 * REJECT, WHICH IS THE VALUABLE HALF. His reason is optional - he does not owe
 * one for declining to pursue something - but the record keeps that it was
 * his, and the graveyard's second question can be answered later.
 */
foundryShellRoutes.post('/foundry/venture/reject',
  requireInstitutionOwner(), async (c: any) => {
    const founder = c.get('founder') as { id?: string } | undefined;
    if (!founder?.id) return c.redirect('/onboarding');
    const form = await c.req.parseBody();
    const opportunityId = String(form.opportunityId ?? '').trim();
    if (!opportunityId) return c.redirect('/foundry');
    const owned = await query(
      'SELECT id FROM venture_opportunities WHERE id = ? AND founder_id = ?',
      [opportunityId, String(founder.id)]);
    if (!owned.rows.length) return c.notFound();
    const { rejectCandidate } = await import('../../services/venture/mandate.js');
    await rejectCandidate({
      opportunityId, by: `founder:${String(founder.id)}`,
      why: String(form.why ?? '').trim() || 'the owner declined it',
      revisitIf: String(form.revisitIf ?? '').trim() || null,
    });
    return c.redirect('/foundry?done=rejected');
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
        <h2>What I would understand</h2>
        <p>${gap.wouldLearn}, for ${name}.</p>
      </div>
      <div class="know">
        <h2>What it would still not let me do</h2>
        <p><strong>${gap.neverGrants}.</strong> Seeing something is not permission to change
          it. That is always a separate question, and I would have to earn it and then ask.</p>
      </div>

      ${raw(await Promise.all(gap.offers.map(async (offer) => {
    const { requiredScopes } = await import('../../services/senses/credentials.js');
    const { senseProvider } = await import('../../services/senses/providers/contract.js');
    const scopes = await requiredScopes(offer.provider, gap.key, offer.mode);
    const canAsk = (await senseProvider(offer.provider)) !== null;
    return `<div class="noticed">
      <h4>${senses.providerName(offer.provider)}${offer.mode === 'sandbox' ? ' — test mode' : ''}</h4>
      <p>Reads ${offer.reads}.</p>
      ${scopes.length ? `<p class="quiet"><strong>What I would ask for:</strong>
        ${scopes.map((sc) => `${sc.scope} — ${sc.because}`).join('; ')}. That is the whole
        request; I cannot ask for more than this.</p>` : ''}
      <p class="quiet">${offer.handsOver}.</p>
      ${offer.mode === 'sandbox'
    ? '<p class="quiet">Test mode runs everything the real connection runs against numbers '
      + 'that are not the world&rsquo;s. I will never count what I learn here as proof '
      + 'about a real business.</p>' : ''}
      ${canAsk
    ? `<form method="POST" action="/foundry/companies/${productId}/see/${gap.key}">
        <input type="hidden" name="provider" value="${offer.provider}" />
        <input type="hidden" name="mode" value="${offer.mode}" />
        <button class="btn go" type="submit">Let me see ${gap.cannotSee}</button>
      </form>`
    : `<p class="quiet">I know ${senses.providerName(offer.provider)} could tell me this,
        and I cannot ask it for permission yet. Nothing is missing on your side.</p>`}
    </div>`;
  })).then((blocks) => blocks.join('')))}

      ${gap.offers.length === 0 ? html`<div class="know">
        <h2>Nothing I can connect</h2>
        <p class="lede">There is no source I know of that would tell me this. I am saying so
          rather than leaving the gap unexplained.</p>
      </div>` : ''}

      <a class="btn" href="/foundry/companies/${productId}">Not now</a>`;
    return c.html(page(`See ${gap.cannotSee}`, body, 'companies'));
  });

/**
 * ASK THE PROVIDER, ON HIS BEHALF.
 *
 * He tapped "let me see revenue". What that costs is an authorisation: a state
 * nobody could guess, the minimum scopes the constitutional table declares, the
 * disclosure he was shown stored as what he agreed to, and a redirect. All of
 * it is server-derived — the form carries a choice between offers and nothing
 * else, because the one thing a permission request must never take from a
 * request is what it is requesting.
 *
 * WHEN IT CANNOT BE ASKED FOR, he is told so plainly and nothing is half-done.
 * A button that leads to a provider error page is worse than a button that is
 * not there.
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
    const mode = String(form.mode ?? '');
    if (mode !== 'real' && mode !== 'sandbox' && mode !== 'reference') {
      return c.redirect(`/foundry/companies/${productId}`);
    }

    const { beginAuthorization } = await import('../../services/senses/credentials.js');
    const started = await beginAuthorization({
      productId, founderId: String(founder.id), companyName: name,
      senseKey: c.req.param('sense'), provider: String(form.provider ?? ''), mode,
      redirectUri: senseCallbackUri(c),
    });
    if ('failed' in started) {
      return c.html(page('Not yet', html`
        <h1>I cannot ask for that yet</h1>
        <p class="lede">${started.ownerWords}.</p>
        <p class="quiet">Nothing has changed, and nothing is half-connected.</p>
        <a class="btn" href="/foundry/companies/${productId}">Back to ${name}</a>`,
      'companies'));
    }
    return c.redirect(started.authorizeUrl);
  });

/**
 * THE REDIRECT URI, DERIVED FROM THE REQUEST AND NOWHERE ELSE.
 *
 * A provider sends the owner back here, and an attacker who could choose this
 * value could send him — and the code — somewhere else. It is built from the
 * host this request actually arrived on, never from a parameter.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function senseCallbackUri(c: any): string {
  const url = new URL(String(c.req.url));
  return `${url.origin}/foundry/senses/callback`;
}

/**
 * THE REFERENCE WORLD, PLAYING THE PROVIDER'S PART.
 *
 * It needs no secret and is made to issue one anyway, because the owner asked
 * for the credential lifecycle to be controlled-proven before a real key is
 * requested — and a lifecycle is only proven if something travels all of it.
 * This route is the far end of the round trip: it receives the authorisation,
 * mints a code only this process could have made, and sends him back. No
 * network, no key, and every step the real path takes.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
foundryShellRoutes.get('/foundry/senses/reference-authorize',
  requireInstitutionOwner(), async (c: any) => {
    const state = String(c.req.query('state') ?? '');
    const redirect = String(c.req.query('redirect_uri') ?? '');
    const scopes = String(c.req.query('scope') ?? '').split(' ').filter(Boolean);
    // ONLY EVER BACK HERE. This took the destination from the query string and
    // appended a freshly minted authorisation code to it, so a link could send
    // the code somewhere else. The route already knows the one legitimate
    // destination — it computes it from the request origin on the way out.
    if (!state || redirect !== senseCallbackUri(c)) return c.notFound();
    const { issueReferenceCode } = await import(
      '../../services/senses/providers/reference.js');
    const code = issueReferenceCode(state, scopes);
    return c.redirect(`${redirect}?code=${encodeURIComponent(code)}`
      + `&state=${encodeURIComponent(state)}`);
  });

/**
 * HE CAME BACK — AND WHAT HE IS TOLD IS THAT FOUNDRY'S UNDERSTANDING CHANGED.
 *
 * Not "integration connected", which is a fact about software. What became
 * visible, what is still invisible, and what this still does not permit. Every
 * failure on the way here has its own sentence, because a connection that
 * half-worked is the state most likely to leave him believing something is
 * watched when it is not.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
foundryShellRoutes.get('/foundry/senses/callback',
  requireInstitutionOwner(), async (c: any) => {
    const founder = c.get('founder') as { id?: string } | undefined;
    if (!founder?.id) return c.redirect('/onboarding');

    // A PROVIDER MAY REFUSE, and it says so in the query rather than in a code.
    const providerError = String(c.req.query('error_description')
      ?? c.req.query('error') ?? '');
    const state = String(c.req.query('state') ?? '');
    const code = String(c.req.query('code') ?? '');

    if (providerError || !code) {
      return c.html(page('Not connected', html`
        <h1>That did not connect</h1>
        <p class="lede">${providerError
    ? `The provider said: ${providerError.slice(0, 200)}.`
    : 'The provider did not send back an authorisation.'}</p>
        <p class="quiet">Nothing changed here. I still cannot see it, and I have not
          stored anything.</p>
        <a class="btn" href="/foundry/companies">Back to your companies</a>`, 'companies'));
    }

    const { completeAuthorization } = await import('../../services/senses/credentials.js');
    const result = await completeAuthorization({
      state, code, founderId: String(founder.id), redirectUri: senseCallbackUri(c),
    });

    if (!result.connected) {
      return c.html(page('Not connected', html`
        <h1>That did not connect</h1>
        <p class="lede">${result.ownerWords}</p>
        <p class="quiet">Nothing changed here. ${result.recoverable
    ? 'Trying again is safe.'
    : 'Trying again will not help on its own.'}</p>
        <a class="btn" href="${result.productId
    ? `/foundry/companies/${result.productId}` : '/foundry/companies'}">Back</a>`,
      'companies'));
    }

    return c.redirect(
      `/foundry/companies/${result.productId}?done=seeing&sense=${result.senseKey}`);
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
    // THE PROVIDER IS TOLD FIRST, and whether it confirmed is what he is
    // shown. A local delete with a live token at the other end is not a
    // revocation, and reporting it as one would be the most dangerous thing
    // this surface could say.
    const { revokeCredential } = await import('../../services/senses/credentials.js');
    const revocation = await revokeCredential({
      senseId: c.req.param('senseId'), reason: 'the owner disconnected it',
    });
    const { disconnectSense } = await import('../../services/senses/index.js');
    await disconnectSense(c.req.param('senseId'), 'the owner disconnected it');
    return c.redirect(`/foundry/companies/${productId}?done=blind`
      + (revocation && !revocation.confirmedByProvider ? '&unconfirmed=1' : ''));
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

  // "LEAVE IT ALONE." "HARVEST IT." "SHUT IT DOWN." Posture is read before
  // anything else because "leave that alone" also contains a stopping phrase,
  // and hearing it as "stop what is live" would do the opposite of what he
  // meant. Nothing binds until he confirms, same as every other sentence here.
  const { readPosture, POSTURE_IN_PLAIN_WORDS } = await import('../../services/founder/burden.js');
  const posture = proposal.kind === 'preference' || proposal.kind === 'allowance'
    || proposal.kind === 'boundary' ? null : readPosture(said);
  if (posture !== null) {
    return c.html(page('What you said', html`
      <h1>Change what I am doing with ${name}?</h1>
      <p class="lede">You said: <strong>${said}</strong></p>
      <div class="know">
        <h2>What that means</h2>
        <p>From now on I would be <strong>${POSTURE_IN_PLAIN_WORDS[posture]}</strong>.
          ${posture === 'retire' || posture === 'sell'
    ? 'I will not shut anything down or contact any buyer on my own: this changes what I '
      + 'recommend and where money goes, and the act itself stays yours.'
    : posture === 'harvest' || posture === 'hold'
      ? 'I will stop recommending growth spending here and stop bringing you growth questions about it.'
      : 'I will start bringing you the things that would make it bigger.'}</p>
      </div>
      <form method="POST" action="/foundry/companies/${productId}/said/confirm">
        <input type="hidden" name="said" value="${said}" />
        <input type="hidden" name="as" value="posture" />
        <button type="submit">Yes, do that</button>
        <a class="btn quiet" href="/foundry/companies/${productId}">No</a>
      </form>`, 'companies'));
  }

  if (proposal.kind === 'unclear') {
    // TAUGHT IN ONE INTERACTION, RATHER THAN IN A GLOSSARY. He sees what it can
    // hold at the moment he needed it, which is the only moment it is useful.
    const subjects = await intent.everySubject();
    return c.html(page('What you said', html`
      <h1>I did not follow that</h1>
      <p class="lede">You said: <strong>${said}</strong></p>
      <p>${proposal.because}.</p>
      <div class="know">
        <h2>What I can hold you to</h2>
        <p class="quiet">Tell me not to do any of these and I will refuse, every time,
          until you say otherwise.</p>
        <ul>${raw(subjects.map((sub) => `<li>${sub.ownerWords}</li>`).join(''))}</ul>
      </div>
      <div class="know">
        <h2>Or tell me what matters</h2>
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
        <h2>What I will do</h2>
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

  if (proposal.kind === 'stop') {
    // AN ACT ON STATE, NOT NEW STATE. He should see what Foundry understood
    // "that" to be before it stops it, because a stop aimed at the wrong thing
    // is worse than no stop.
    const live = await intent.objectiveFor(productId);
    return c.html(page('What you said', html`
      <h1>${live ? 'Stop this?' : 'There is nothing to stop'}</h1>
      <p class="lede">You said: <strong>${said}</strong></p>
      ${live
    ? html`<div class="know">
        <h2>What I would stop</h2>
        <p><strong>${live.statement}</strong></p>
        <p class="quiet">I will stop weighing that when I decide what is worth your attention
          here. Nothing else changes: what I can see, what I look after, and what you have
          told me not to do all stay exactly as they are.</p>
      </div>
      <form method="POST" action="/foundry/companies/${productId}/said/confirm">
        <input type="hidden" name="said" value="${said}" />
        <button class="btn go" type="submit">Yes — stop that</button>
      </form>`
    : html`<p>You have not told me what ${name} is for, so there is nothing for me to
        stop doing. If you meant something else, tell me and I will say what I understood.</p>`}
      <a class="btn" href="/foundry/companies/${productId}">Back to ${name}</a>`, 'companies'));
  }

  if (proposal.kind === 'allowance') {
    const pounds = (proposal.amountCents / 100).toFixed(2);
    return c.html(page('What you said', html`
      <h1>Allow up to $${pounds}?</h1>
      <p class="lede">You said: <strong>${said}</strong></p>
      <div class="know">
        <h2>What I will do</h2>
        <p>I will spend up to <strong>$${pounds}</strong> on ${name}, and refuse to spend
          anything beyond it until you say otherwise.</p>
        <p class="quiet">This is a ceiling, not a plan. It does not mean I will spend it, and
          it does not let me do anything I could not already do — it only bounds what I may
          spend doing it.</p>
        <ul>
          <li><strong>What counts</strong> — everything I spend for this company, from when
            you set it.</li>
          <li><strong>When it runs out</strong> — I stop, and tell you.</li>
          <li><strong>Undo</strong> — one tap, on this company's page.</li>
        </ul>
      </div>
      <form method="POST" action="/foundry/companies/${productId}/said/confirm">
        <input type="hidden" name="said" value="${said}" />
        <button class="btn go" type="submit">Yes — up to $${pounds}</button>
      </form>
      <a class="btn" href="/foundry/companies/${productId}">No</a>`, 'companies'));
  }

  if (proposal.kind === 'preference') {
    return c.html(page('What you said', html`
      <h1>Noted as a preference</h1>
      <p class="lede">You said: <strong>${said}</strong></p>
      <div class="know">
        <h2>What I will do</h2>
        <p>I will lean that way when I have a choice between things that are otherwise
          equally good for ${name}.</p>
        <p class="quiet"><strong>I will not refuse anything because of this.</strong> That is
          the difference between a preference and a boundary — if you want me to be unable to
          do something, tell me not to do it and I will refuse it every time.</p>
      </div>
      <form method="POST" action="/foundry/companies/${productId}/said/confirm">
        <input type="hidden" name="said" value="${said}" />
        <button class="btn go" type="submit">Yes — lean that way</button>
      </form>
      <a class="btn" href="/foundry/companies/${productId}">No</a>`, 'companies'));
  }

  return c.html(page('What you said', html`
    <h1>Understood</h1>
    <p class="lede">You said: <strong>${said}</strong></p>
    <div class="know">
      <h2>What I will do</h2>
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

    if (String(form.as ?? '') === 'posture') {
      const { readPosture, setPosture } = await import('../../services/founder/burden.js');
      const to = readPosture(said);
      if (to === null) return c.redirect(`/foundry/companies/${productId}`);
      await setPosture({ productId, founderId: String(founder.id), to, said });
      return c.redirect(`/foundry/companies/${productId}?done=posture`);
    }

    if (proposal.kind === 'boundary' && !asObjective) {
      await intent.setBoundary({
        productId, subject: proposal.subject, statement: said, mode: proposal.mode,
      });
      return c.redirect(`/foundry/companies/${productId}?done=bound`);
    }
    if (proposal.kind === 'unclear') return c.redirect(`/foundry/companies/${productId}`);

    if (proposal.kind === 'stop') {
      const stopped = await intent.stopWhatIsLive(productId);
      return c.redirect(`/foundry/companies/${productId}?done=${stopped ? 'stopped' : 'nothing'}`);
    }
    if (proposal.kind === 'allowance') {
      await intent.setAllowance({
        productId, statement: said,
        amountCents: proposal.amountCents, purpose: proposal.purpose,
      });
      return c.redirect(`/foundry/companies/${productId}?done=allowed`);
    }
    if (proposal.kind === 'preference') {
      await intent.setPreference({ productId, statement: said });
      return c.redirect(`/foundry/companies/${productId}?done=preferred`);
    }

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
      <h2>Permissions</h2>
      <p><strong>None.</strong> I can look at things and tell you what I find. I cannot change
        anything, spend anything, or contact anyone.</p>
      <p class="quiet">Each of those would be something you allow separately, for a set time,
        and could take back whenever you wanted. I ask on the front page when I have earned
        the right to.</p>
    </div>` : ''}

    <div class="know">
      <h2>Money</h2>
      <ul>
        <li>$${s.spent30d.toFixed(2)} spent in the last 30 days.</li>
        <li>${s.budgetMonthly === null
    ? html`You have not set a monthly limit for ${s.companyName}. The daily ceilings
      below are what actually stops me.`
    : html`$${String(s.budgetMonthly)} a month is the limit you set for
      ${s.companyName}.`}</li>
        <li>I stop thinking for a company at $2 a day, and for everything at $5 a day.</li>
      </ul>
      <p class="quiet">Watching costs nothing — comparing my own records uses no thinking.</p>
    </div>

    <div class="know">
      <h2>Connected to</h2>
      ${s.connectedSenses.length === 0
    ? html`<p><strong>Nothing.</strong> I have no way to see your code, your money or your
        customers.</p>`
    : html`<ul>${raw(s.connectedSenses.map((x) => `<li>${x}</li>`).join(''))}</ul>`}
    </div>

    <div class="know">
      <h2>Stopping me</h2>
      <p>One button halts every routine, every permission and every outgoing action at once.
        Nothing is lost — I stop acting on it.</p>
      <form method="POST" action="/autopilot/panic" style="margin-top:var(--s2)">
        <input type="hidden" name="return_to" value="foundry" />
        <button class="btn" type="submit" style="width:auto">Stop everything</button>
      </form>
    </div>`;

  return c.html(page('Controls', body, 'controls'));
});
