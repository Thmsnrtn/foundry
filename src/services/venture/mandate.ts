// =============================================================================
// FOUNDRY — an entrepreneurial mandate
//
// "I'd like you to add a new micro-SaaS venture to my portfolio."
//
// THE FAILURE THIS EXISTS TO PREVENT is hearing that as "build me a SaaS". It
// is a standing instruction to go and LOOK — under constraints, with a budget,
// accreting guidance over weeks, stoppable — and the software, if it ever
// exists, is the last thing that happens rather than the first.
//
// STEERING IS ABSORBED, NOT ACKNOWLEDGED. "I don't want paid acquisition"
// becomes a row every later candidate is filtered by; "try harder to disprove
// it" raises the bar a candidate must clear. A mandate that heard those and
// kept its own counsel would be a chat window with a database behind it.
//
// AND IT PRODUCES NOTHING UNTIL IT CAN SEE. Foundry has no market sense
// (migration 234), so there is nowhere for a claim about the world to come
// from. It says so. The alternative — a fluent analysis assembled from a
// model's recollection, with no source anyone could check — is invented
// evidence wearing a research report's clothes, and it would be laundered into
// owner truth the moment a company was created on the strength of it.
// =============================================================================

import { nanoid } from 'nanoid';
import { query } from '../../db/client.js';

export type GuidanceKind =
  | 'avoid' | 'prefer' | 'industry' | 'budget' | 'harder' | 'deeper'
  | 'favour' | 'another';

export interface MandateProposal {
  kind: 'mandate'; statement: string; shape: string | null;
}
export interface GuidanceProposal {
  kind: 'guidance'; statement: string; guidance: GuidanceKind; subject: string | null;
}
export interface StopProposal { kind: 'stop_mandate'; statement: string }
export interface NotVenture { kind: 'not_venture'; statement: string }

export type VentureReading =
  | MandateProposal | GuidanceProposal | StopProposal | NotVenture;

/** The shapes he might name. Absence is a real mandate: "find me a business". */
const SHAPES: Array<[string, string[]]> = [
  ['micro_saas', ['micro-saas', 'micro saas', 'microsaas', 'small saas', 'tiny saas']],
  ['saas', ['saas', 'software business', 'subscription business']],
  ['marketplace', ['marketplace', 'two-sided']],
  ['newsletter', ['newsletter', 'media business']],
  ['agency', ['agency', 'services business', 'consultancy']],
  ['ecommerce', ['ecommerce', 'e-commerce', 'physical product', 'shop']],
];

const ASKING = [
  'add a new', 'add another', 'start a new', 'start another', 'find me a',
  'find me another', 'new venture', 'another venture', 'new business',
  'another business', 'originate', 'a new company', 'another company',
];

/**
 * READ ONE SENTENCE ABOUT VENTURES.
 *
 * Deterministic and narrow, for the reason every other owner-intent reader here
 * is: a mandate that misheard would send the institution looking for the wrong
 * thing for weeks, and he would not find out until it came back. What it does
 * not recognise it says it does not recognise.
 */
export function readVentureSentence(raw: string): VentureReading {
  const statement = raw.trim();
  const t = ` ${statement.toLowerCase().replace(/[’]/g, "'")} `;

  if (/\b(stop|abandon|cancel|forget)\b.*\b(look|search|hunt|venture|business|company)/.test(t)
    || /\bstop looking\b|\bstop searching\b|\bcall it off\b/.test(t)) {
    return { kind: 'stop_mandate', statement };
  }

  // GUIDANCE BEFORE MANDATE. "Look for higher-ticket opportunities" contains
  // "look for" and is steering an existing search, not starting a new one.
  const guidance = readGuidance(t, statement);
  if (guidance) return guidance;

  if (ASKING.some((p) => t.includes(p))
    && /\b(venture|business|company|saas|product|opportunit)/.test(t)) {
    const shape = SHAPES.find(([, phrases]) => phrases.some((p) => t.includes(p)));
    return { kind: 'mandate', statement, shape: shape ? shape[0] : null };
  }
  return { kind: 'not_venture', statement };
}

function readGuidance(t: string, statement: string): GuidanceProposal | null {
  const say = (guidance: GuidanceKind, subject: string | null = null): GuidanceProposal =>
    ({ kind: 'guidance', statement, guidance, subject });

  if (/\b(don'?t|do not|no|avoid|without)\b.*\b(paid acquisition|paid ads|ads|advertising|paid marketing)\b/.test(t)) {
    return say('avoid', 'paid acquisition');
  }
  if (/\b(don'?t|do not|avoid|no)\b.*\b(venture capital|investors|raising|fundraising)\b/.test(t)) {
    return say('avoid', 'outside investment');
  }
  if (/higher[- ]ticket|bigger deals|larger contracts|more expensive|higher price/.test(t)) {
    return say('prefer', 'higher ticket');
  }
  if (/lower[- ]ticket|cheaper|smaller|self[- ]serve/.test(t)) return say('prefer', 'lower ticket');
  if (/\btarget\b.*\binstead\b|\bfocus on\b.*\bindustry\b|\blook (at|in)\b.*\binstead\b/.test(t)) {
    // The industry is his words minus the instruction, kept whole rather than
    // parsed into a taxonomy Foundry would then have to maintain.
    const named = statement.replace(/^.*?\b(target|focus on|look at|look in)\b/i, '')
      .replace(/\binstead\b\.?/i, '').trim();
    return say('industry', named || null);
  }
  if (/spend (no more than|up to|at most)|budget of|no more than \$?\d/.test(t)) {
    const amount = /(\d+(?:\.\d{1,2})?)/.exec(t);
    return amount ? say('budget', amount[1]) : say('budget');
  }
  if (/try harder to (disprove|kill)|be more sceptical|be more skeptical|tear it apart|attack it/.test(t)) {
    return say('harder');
  }
  if (/research (this|it) (more|further|deeper)|dig (deeper|into)|look into (this|it) more/.test(t)) {
    return say('deeper');
  }
  if (/\bi like (this|that) one\b|\bthat one\b.*\b(interesting|promising)\b|\bgo with (this|that)\b/.test(t)) {
    return say('favour');
  }
  if (/show me another|something else|a different one|next option|other options/.test(t)) {
    return say('another');
  }
  return null;
}

// ─── the mandate ─────────────────────────────────────────────────────────────

export interface Mandate {
  id: string; statement: string; shape: string | null; state: string;
  evidenceMode: 'real' | 'reference'; openedAt: string;
  guidance: Array<{ id: string; statement: string; kind: GuidanceKind; subject: string | null }>;
}

export async function openMandate(input: {
  founderId: string; statement: string; shape: string | null;
  evidenceMode?: 'real' | 'reference';
}): Promise<Mandate | { refused: string }> {
  const open = await currentMandate(input.founderId);
  if (open) {
    // ONE SEARCH AT A TIME. Two mandates would compete for the same attention
    // and the same budget, and deciding which wins is exactly the judgement
    // that is his.
    return {
      refused: 'you already have a search running. Tell me to stop that one '
        + 'first, or steer it instead.',
    };
  }
  const id = nanoid();
  await query(
    `INSERT INTO venture_mandates (id, founder_id, statement, shape, evidence_mode)
     VALUES (?,?,?,?,?)`,
    [id, input.founderId, input.statement.trim(), input.shape,
      input.evidenceMode ?? 'real']);
  // A REFERENCE MANDATE GETS SOMETHING TO WORK ON. Foundry cannot see a real
  // market, so a real mandate honestly finds nothing until it can — but the
  // machinery around a candidate (unknowns, kill theses, the source
  // requirement, rejection kept with its reason) has to be exercised somewhere,
  // and this is the same reference world everything else is proven in.
  if ((input.evidenceMode ?? 'real') === 'reference') {
    const { exerciseReferenceMandate } = await import('./reference-candidates.js');
    await exerciseReferenceMandate(id);
  }

  const made = await currentMandate(input.founderId);
  if (!made) throw new Error('mandate did not open');
  return made;
}

export async function currentMandate(founderId: string): Promise<Mandate | null> {
  const row = (await query(
    `SELECT id, statement, shape, state, evidence_mode, opened_at
       FROM venture_mandates WHERE founder_id = ? AND closed_at IS NULL`, [founderId]))
    .rows[0] as Record<string, unknown> | undefined;
  if (!row) return null;
  const guidance = ((await query(
    `SELECT id, statement, kind, subject FROM venture_guidance
      WHERE mandate_id = ? AND superseded_by IS NULL ORDER BY rowid`, [String(row.id)]))
    .rows as unknown as Array<Record<string, unknown>>).map((g) => ({
    id: String(g.id), statement: String(g.statement),
    kind: String(g.kind) as GuidanceKind,
    subject: g.subject == null ? null : String(g.subject),
  }));
  return {
    id: String(row.id), statement: String(row.statement),
    shape: row.shape == null ? null : String(row.shape),
    state: String(row.state), evidenceMode: String(row.evidence_mode) as 'real' | 'reference',
    openedAt: String(row.opened_at).slice(0, 10), guidance,
  };
}

/**
 * Absorb one piece of steering.
 *
 * SUPERSEDING RATHER THAN EDITING. "Target this industry instead" replaces an
 * earlier industry by marking it superseded, so the record still says he
 * changed his mind and when — which is the difference between a search that
 * remembers being redirected and one that only knows where it currently points.
 */
export async function absorbGuidance(input: {
  mandateId: string; statement: string; kind: GuidanceKind; subject: string | null;
}): Promise<string> {
  // Resolved from the mandate rather than taken from a caller: a guidance row
  // naming a different person would erase with the wrong account, or not at all.
  const owner = (await query(
    'SELECT founder_id FROM venture_mandates WHERE id = ?', [input.mandateId]))
    .rows[0] as Record<string, unknown> | undefined;
  if (!owner) throw new Error('no such mandate');
  const id = nanoid();
  // THE NEW ROW FIRST. `superseded_by` is a foreign key into this same table,
  // so pointing the old guidance at an id that does not exist yet fails — which
  // it did, on the first sentence that replaced an earlier one. The order is
  // not stylistic: the successor has to exist before anything can name it.
  await query(
    `INSERT INTO venture_guidance (id, mandate_id, founder_id, statement, kind, subject)
     VALUES (?,?,?,?,?,?)`,
    [id, input.mandateId, String(owner.founder_id), input.statement.trim(),
      input.kind, input.subject]);

  // The kinds that REPLACE rather than accumulate. Two industries is a wider
  // search; two budgets is no budget.
  const replaces: GuidanceKind[] = ['industry', 'budget', 'prefer'];
  if (replaces.includes(input.kind)) {
    await query(
      `UPDATE venture_guidance SET superseded_by = ?
        WHERE mandate_id = ? AND kind = ? AND superseded_by IS NULL AND id <> ?`,
      [id, input.mandateId, input.kind, id]);
  }
  return id;
}

export async function stopMandate(founderId: string, reason: string): Promise<boolean> {
  const open = await currentMandate(founderId);
  if (!open) return false;
  await query(
    `UPDATE venture_mandates SET state = 'stopped', closed_at = datetime('now'),
            closed_reason = ? WHERE id = ?`, [reason, open.id]);
  return true;
}

// ─── what it can honestly report ─────────────────────────────────────────────

export interface MandateProgress {
  mandate: Mandate;
  looked: number; rejected: number; open: number;
  /** Non-null when the search cannot proceed, saying exactly why. */
  blocked: string | null;
  /** What it would take to unblock it, in owner language. */
  wouldNeed: string | null;
}

/**
 * WHERE THE SEARCH ACTUALLY IS.
 *
 * The honest answer today is that it has not started, because Foundry cannot
 * see the market. Saying that plainly is the whole point: an institution that
 * produced three plausible opportunities instead would be inventing the
 * evidence it was asked to gather.
 */
export async function mandateProgress(founderId: string): Promise<MandateProgress | null> {
  const mandate = await currentMandate(founderId);
  if (!mandate) return null;

  const counts = (await query(
    `SELECT COUNT(*) AS looked,
            SUM(CASE WHEN verdict = 'rejected' THEN 1 ELSE 0 END) AS rejected,
            SUM(CASE WHEN verdict IS NULL THEN 1 ELSE 0 END) AS open
       FROM venture_opportunities WHERE mandate_id = ?`, [mandate.id]))
    .rows[0] as Record<string, unknown>;

  // The market sense, asked for rather than assumed absent — so the day one
  // exists this unblocks itself without anybody editing this function.
  const seeing = (await query(
    `SELECT COUNT(*) AS n FROM company_senses
      WHERE sense_key = 'market' AND disconnected_at IS NULL`, []))
    .rows[0] as Record<string, unknown>;
  const canSeeMarket = Number(seeing.n) > 0;

  return {
    mandate,
    looked: Number(counts.looked ?? 0),
    rejected: Number(counts.rejected ?? 0),
    open: Number(counts.open ?? 0),
    blocked: canSeeMarket ? null
      : 'I cannot see what is happening outside your companies, so I have '
        + 'nowhere to look. I am not going to describe opportunities from '
        + 'memory — that would read like research and be nothing of the kind.',
    wouldNeed: canSeeMarket ? null
      : 'a way to actually look at the market. Nothing I can connect today '
        + 'would give me one, and I would rather say so than hand you a '
        + 'plausible list.',
  };
}

/**
 * Would this candidate survive what he has told me?
 *
 * The steering is applied HERE, to every candidate, rather than being consulted
 * when someone remembers. A mandate that collected guidance and filtered
 * nothing would be the failure the owner named: treating it as chat.
 */
export function survivesGuidance(
  candidate: { headline: string; why: string },
  guidance: Mandate['guidance'],
): { survives: boolean; because: string | null } {
  const text = `${candidate.headline} ${candidate.why}`.toLowerCase();
  for (const g of guidance) {
    if (g.kind !== 'avoid' || !g.subject) continue;
    if (text.includes(g.subject.toLowerCase())) {
      return {
        survives: false,
        because: `it depends on ${g.subject}, and you told me not to`,
      };
    }
  }
  return { survives: true, because: null };
}

/** How hard a candidate has to be attacked before it may advance. */
export function scepticismLevel(guidance: Mandate['guidance']): number {
  return 1 + guidance.filter((g) => g.kind === 'harder').length;
}

// ─── presenting them ─────────────────────────────────────────────────────────

/**
 * A SMALL NUMBER OF SERIOUS OPTIONS, IN PLAIN OWNER LANGUAGE.
 *
 * The owner's acceptance test asks for exactly that, and the shape of what he
 * is shown is the whole argument: who has the problem, what it is, why this
 * might matter, the strongest reason it fails, what is verified, and what
 * remains unknown. Not a score. Not a ranking with a number on it.
 *
 * `blockedBy` is what makes it honest rather than a pitch. A candidate whose
 * unknowns include whether anyone would pay has not earned a company however
 * good the rest reads, and it says so on the card rather than in a footnote —
 * which is the difference between advancing on evidence and advancing on prose.
 */
export interface PresentedCandidate {
  id: string; headline: string; whoHasIt: string; theProblem: string;
  whyItMight: string; killThesis: string;
  unknowns: string[]; sources: string[];
  /** Non-null when this cannot be advanced, saying which unknown stops it. */
  blockedBy: string | null;
  survivesGuidance: boolean; failsBecause: string | null;
  reference: boolean;
}

/** The unknowns that are not "more work", but "we do not have a business". */
const DISQUALIFYING = [
  'would pay', 'will pay', 'anyone pays', 'ever paid', 'willing to pay',
];

export async function candidatesFor(mandateId: string): Promise<PresentedCandidate[]> {
  const mandate = (await query(
    'SELECT founder_id FROM venture_mandates WHERE id = ?', [mandateId]))
    .rows[0] as Record<string, unknown> | undefined;
  if (!mandate) return [];
  const open = await currentMandate(String(mandate.founder_id));
  const guidance = open?.guidance ?? [];

  return ((await query(
    `SELECT id, headline, who_has_it, the_problem, why_it_might, kill_thesis,
            unknowns_json, sources_json, evidence_mode
       FROM venture_opportunities
      WHERE mandate_id = ? AND verdict IS NULL
      ORDER BY rowid`, [mandateId]))
    .rows as unknown as Array<Record<string, unknown>>).map((r) => {
    const unknowns = JSON.parse(String(r.unknowns_json)) as string[];
    const sources = JSON.parse(String(r.sources_json)) as string[];
    const blocking = unknowns.find((u) =>
      DISQUALIFYING.some((phrase) => u.toLowerCase().includes(phrase)));
    const verdict = survivesGuidance({
      headline: String(r.headline), why: String(r.why_it_might),
    }, guidance);
    return {
      id: String(r.id), headline: String(r.headline),
      whoHasIt: String(r.who_has_it), theProblem: String(r.the_problem),
      whyItMight: String(r.why_it_might), killThesis: String(r.kill_thesis),
      unknowns, sources,
      blockedBy: blocking ?? (sources.length === 0
        ? 'nothing about it has been checked against anything' : null),
      survivesGuidance: verdict.survives, failsBecause: verdict.because,
      reference: String(r.evidence_mode) === 'reference',
    };
  });
}

/**
 * SEARCHES HE HAS ALREADY CALLED OFF, AND WHY.
 *
 * Starting again should not begin from nothing. A closed mandate carries what
 * he asked for and the reason it ended, so the next one can say "you looked for
 * this before and stopped because —" rather than making him remember.
 */
export interface PastSearch { statement: string; closedAt: string; why: string }

export async function pastSearches(founderId: string, limit = 3): Promise<PastSearch[]> {
  return ((await query(
    `SELECT statement, closed_at, closed_reason FROM venture_mandates
      WHERE founder_id = ? AND closed_at IS NOT NULL
      ORDER BY closed_at DESC, rowid DESC LIMIT ?`, [founderId, limit]))
    .rows as unknown as Array<Record<string, unknown>>).map((r) => ({
    statement: String(r.statement), closedAt: String(r.closed_at).slice(0, 10),
    why: String(r.closed_reason ?? ''),
  }));
}
