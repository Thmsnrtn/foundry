// =============================================================================
// FOUNDRY — Missions, read from the work that already exists.
//
// A MISSION IS A THREAD THROUGH ROWS, NOT A SECOND RECORD OF THEM. The owner's
// directive (30 September 2026) asks for one object he can hand work to and
// watch: a goal, its limits, where it stands, what Foundry does next, what
// came of it. Foundry already carried that work under four names — the one
// open search (`venture_mandates`), each test (`venture_experiments`, with a
// prediction, a budget, a window and stop conditions), each piece of work
// taken on for a company (`undertakings`), and the trading research
// (`capital_research_theses`, simulation only by construction). This module
// reads them as Missions. It writes nothing and stores no status: every word
// here is derived from the row it cites, so a Mission can never disagree with
// the page of the thing it is.
//
// A MISSION GRANTS NOTHING. Nothing in this file can act, spend or widen what
// Foundry may do; the doors that act (the charter, allowances, boundaries,
// consents, the outbound gateway) are untouched and unconsulted here.
// =============================================================================

import { query } from '../../db/client.js';
import { listExperiments, type ExperimentView } from '../founder/experiment-view.js';
import { currentMandate } from '../venture/mandate.js';
import { underWayFor, type Undertaking } from '../institution/undertaking.js';

/** What kind of work it is. */
export type MissionMode = 'explore' | 'validate' | 'build' | 'operate' | 'optimize' | 'monitor';
/** Whether it touches the real world, or a paper or simulated one. */
export type MissionRealm = 'real' | 'paper' | 'simulation';
/**
 * WHERE IT STANDS. One vocabulary, derived — never a column. `draft` exists
 * only for a Mission the owner has not yet confirmed; nothing read here is one.
 */
export type MissionStatus =
  | 'draft' | 'ready' | 'running' | 'waiting' | 'needs_you' | 'paused'
  | 'succeeded' | 'stopped' | 'failed' | 'archived';

export const STATUS_WORDS: Record<MissionStatus, string> = {
  draft: 'Draft', ready: 'Ready', running: 'Running', waiting: 'Waiting', needs_you: 'Needs you',
  paused: 'Paused', succeeded: 'Succeeded', stopped: 'Stopped', failed: 'Failed', archived: 'Archived',
};

export const MODE_WORDS: Record<MissionMode, string> = {
  explore: 'Explore', validate: 'Validate', build: 'Build', operate: 'Operate', optimize: 'Optimize', monitor: 'Monitor',
};

export const REALM_WORDS: Record<MissionRealm, string> = { real: 'Real', paper: 'Paper', simulation: 'Simulation' };

/** Where a Mission's facts live: the one row it is a thread through. */
export type MissionSource = 'mission' | 'mandate' | 'experiment' | 'undertaking' | 'thesis';

export interface Mission {
  /** `source:id` — stable, and names the row. */
  key: string;
  source: MissionSource;
  goal: string;
  mode: MissionMode;
  realm: MissionRealm;
  status: MissionStatus;
  /** The status word, and one sentence of why. */
  statusWord: string;
  statusDetail: string;
  company: { id: string; name: string } | null;
  /** The limits, as written on the row. Null means none was set — never zero. */
  limits: { budget: string | null; until: string | null; success: string | null; stop: string | null };
  /** What Foundry will do next, or what it is waiting for. Null when concluded. */
  next: string | null;
  /** The outcome, once concluded. */
  outcome: string | null;
  /** The Mission this one belongs to, by key. */
  parent: string | null;
  /** The page that holds the whole record. */
  href: string;
  openedAt: string;
  concluded: boolean;
  /** The limits HE put on it (migration 371), when he has; null means none of his own. */
  terms: { budgetCents: number | null; until: string | null; success: string | null; stopWhen: string | null;
    interruptAt: 'silent' | 'today' | 'needs_you' | 'urgent'; saidAt: string } | null;
  /** What was spent through it, in cents, where the rows can say; null where they cannot. */
  spentCents: number | null;
  /** Which of his limits it has crossed, if any. Foundry brings it to him; it never acts on it. */
  tripped: 'budget' | 'until' | null;
}

const CONCLUDED: ReadonlySet<MissionStatus> = new Set(['succeeded', 'stopped', 'failed', 'archived']);

/** A Mission is over when its status says so. */
export const isConcluded = (s: MissionStatus): boolean => CONCLUDED.has(s);

/**
 * A TEST, READ AS A MISSION. The test already has everything a Mission asks
 * for: what it tries (the goal), what it may spend, when its window closes,
 * what counts as an answer and what stops it. The status follows its state;
 * the outcome is the one outcome vocabulary (`outcomeOf`) the test page uses.
 */
export function missionOfExperiment(e: ExperimentView, mandateKey: string | null): Mission {
  const status: MissionStatus = (() => {
    switch (e.state) {
      case 'needs_you': return 'needs_you';
      case 'ready': return 'ready';
      case 'running': return e.blocking.length ? 'waiting' : 'running';
      case 'completed': return e.outcome.word === 'as predicted' ? 'succeeded' : 'failed';
      default: return 'stopped';
    }
  })();
  const concluded = isConcluded(status);
  const m = e.money;
  const dollars = (c: number): string => `$${(c / 100).toFixed(2)}`;
  const budget = m.authorisedCents > 0
    ? `${dollars(m.authorisedCents)} authorised; ${dollars(m.spentCents)} spent` : null;
  return {
    key: `experiment:${e.id}`, source: 'experiment', goal: e.title, mode: 'validate',
    realm: 'real', status, statusWord: STATUS_WORDS[status],
    statusDetail: concluded ? e.outcome.meaning : e.stateDetail,
    company: e.productId && e.assetName ? { id: e.productId, name: e.assetName } : null,
    limits: {
      budget: budget, until: e.rules.windowClosesAt ? e.rules.windowClosesAt.slice(0, 10) : null,
      success: e.rules.success || null, stop: e.rules.stop.length ? e.rules.stop.join('; ') : null,
    },
    next: concluded ? null
      : status === 'needs_you' ? 'Waiting for your decision before anything reaches anyone.'
        : status === 'waiting' ? `Waiting: ${e.blocking[0] ?? 'on the world'}.`
          : status === 'ready' ? 'Ready to begin once you allow it.'
            : e.rules.daysLeft !== null ? `Reading the world each day; the window closes in ${String(e.rules.daysLeft)} day${e.rules.daysLeft === 1 ? '' : 's'}.`
              : 'Reading the world each day until it answers.',
    outcome: concluded ? outcomeSentence(e) : null,
    parent: mandateKey, href: `/foundry/experiments/${e.id}`,
    openedAt: e.timeline[0]?.at ?? '', concluded, terms: null, spentCents: m.spentCents, tripped: null,
  };
}

/**
 * "KILLED EARLY — USEFUL." A test stopped or surprised is not a failure of
 * Foundry if it taught something; the outcome says what it established when
 * the record holds it, and says so plainly when it does not.
 */
function outcomeSentence(e: ExperimentView): string {
  const learned = e.outcome.establishes ?? (e.learned.headline || null);
  if (e.outcome.word === 'as predicted') return `The prediction held. ${learned ?? ''}`.trim();
  if (learned && e.state !== 'completed') return `Stopped early — useful: ${learned}`;
  if (learned) return `${e.outcome.label}: ${learned}`;
  return `${e.outcome.label}. ${e.outcome.reason ?? 'Nothing was established.'}`.trim();
}

const UNDERTAKING_MODE: Record<string, MissionMode> = {
  understand: 'explore', investigate: 'explore', test: 'validate',
  fix: 'operate', handle: 'operate', grow: 'optimize', economise: 'optimize',
};

/** Work taken on for one company, read as a Mission. */
export function missionOfUndertaking(u: Undertaking, latest: string | null): Mission {
  const closed = u.closedAt !== null;
  const status: MissionStatus = !closed ? 'running'
    : u.closedAs === 'done' ? 'succeeded' : u.closedAs === 'superseded' ? 'archived' : 'stopped';
  return {
    key: `undertaking:${u.id}`, source: 'undertaking', goal: u.understoodAs,
    mode: UNDERTAKING_MODE[u.kind] ?? 'operate', realm: u.evidenceMode === 'real' ? 'real' : 'simulation',
    status, statusWord: STATUS_WORDS[status],
    statusDetail: closed ? (u.closedBecause ?? 'Closed.') : `${u.kindInWords}, for ${u.companyName}.`,
    company: { id: u.productId, name: u.companyName },
    limits: { budget: null, until: null, success: null, stop: null },
    next: closed ? null : (latest ?? 'Looking at what the company already shows.'),
    outcome: closed ? (u.closedBecause ?? null) : null,
    parent: null, href: `/foundry/companies/${u.productId}/work`,
    openedAt: u.openedAt, concluded: closed, terms: null, spentCents: null, tripped: null,
  };
}

type Row = Record<string, unknown>;
const rows = async (sql: string, params: unknown[]): Promise<Row[]> => (await query(sql, params)).rows as unknown as Row[];

/**
 * EVERY MISSION FOUNDRY IS CARRYING FOR THE OWNER, and the ones that ended in
 * the last fortnight. Ordered so what needs him leads, then what is moving,
 * then what is waiting or ready, then what is over.
 */
export async function missionsOf(founderId: string, now: Date = new Date()): Promise<Mission[]> {
  const out: Mission[] = [];

  // The one search. Its tests belong to it when they came from it.
  const mandate = await currentMandate(founderId);
  const mandateKey = mandate ? `mandate:${mandate.id}` : null;
  const experiments = await listExperiments(founderId, now, 'all');
  const ofMandate = mandate ? new Set((await rows(
    `SELECT e.id FROM venture_experiments e JOIN venture_opportunities o ON o.id = e.opportunity_id
      WHERE e.founder_id = ? AND o.mandate_id = ?`, [founderId, mandate.id])).map((r) => String(r.id))) : new Set<string>();
  const cutoff = new Date(now.getTime() - 14 * 86_400_000).toISOString();
  const tests = experiments
    .filter((e) => !e.concluded || (e.concludedAt ?? '') >= cutoff.slice(0, 10))
    .map((e) => missionOfExperiment(e, ofMandate.has(e.id) ? mandateKey : null));

  if (mandate) {
    const inFlight = tests.filter((t) => t.parent === mandateKey && !t.concluded);
    const needs = inFlight.some((t) => t.status === 'needs_you');
    const status: MissionStatus = needs ? 'needs_you' : 'running';
    const budget = mandate.guidance.find((g) => g.kind === 'budget');
    const avoid = mandate.guidance.filter((g) => g.kind === 'avoid').map((g) => g.statement);
    out.push({
      key: mandateKey!, source: 'mandate', goal: mandate.statement, mode: 'explore',
      realm: mandate.evidenceMode === 'real' ? 'real' : 'simulation', status, statusWord: STATUS_WORDS[status],
      statusDetail: needs ? 'A test from this search is waiting for your decision.'
        : inFlight.length ? `${String(inFlight.length)} test${inFlight.length === 1 ? '' : 's'} from this search in flight.`
          : `Searching (${mandate.state}).`,
      company: null,
      limits: { budget: budget ? budget.statement : null, until: null, success: null, stop: avoid.length ? avoid.join('; ') : null },
      next: needs ? 'Waiting for your decision on a test.' : 'Looking for candidates, and designing a test for the strongest.',
      outcome: null, parent: null, href: '/foundry/searching', openedAt: mandate.openedAt, concluded: false,
      terms: null, spentCents: null, tripped: null,
    });
  }
  out.push(...tests);

  // Work taken on for his companies.
  for (const u of await underWayFor(founderId)) {
    const latest = (await rows(
      `SELECT said FROM undertaking_steps WHERE undertaking_id = ? ORDER BY at DESC, rowid DESC LIMIT 1`, [u.id]))[0];
    out.push(missionOfUndertaking(u, latest ? String(latest.said) : null));
  }

  // The trading research: simulation, by construction. No order path exists.
  for (const t of await rows(
    `SELECT id, venue, hypothesis, falsifier, status, begun_at, stopped_at, stopped_because
       FROM capital_research_theses WHERE founder_id = ? AND (status = 'observing' OR stopped_at >= ?)
      ORDER BY begun_at, rowid`, [founderId, cutoff])) {
    const observing = String(t.status) === 'observing';
    const status: MissionStatus = observing ? 'running' : 'stopped';
    out.push({
      key: `thesis:${String(t.id)}`, source: 'thesis', goal: String(t.hypothesis), mode: 'monitor', realm: 'simulation',
      status, statusWord: STATUS_WORDS[status],
      statusDetail: observing ? `Observing ${String(t.venue)} markets. No order is possible.` : String(t.stopped_because ?? 'Stopped.'),
      company: null,
      limits: { budget: 'None: nothing here spends or trades.', until: null, success: null, stop: String(t.falsifier) },
      next: observing ? 'Sealing a forecast before each window closes, and scoring it after.' : null,
      outcome: observing ? null : String(t.stopped_because ?? ''), parent: null,
      href: '/foundry/money/research', openedAt: String(t.begun_at), concluded: !observing,
      terms: null, spentCents: 0, tripped: null,
    });
  }

  // MISSIONS HE STATED (migration 371): goals no engine carries yet. Their
  // status is his acts, newest first; nothing Foundry does changes it.
  const acts = new Map<string, Row[]>();
  for (const e of await rows(
    `SELECT mission_key, kind, said, at FROM mission_events WHERE founder_id = ? ORDER BY at DESC, rowid DESC`, [founderId])) {
    const k = String(e.mission_key);
    acts.set(k, [...(acts.get(k) ?? []), e]);
  }
  // The company is joined for its NAME only — the Mission's subject, which he
  // chose. Reality and standing do not apply: naming a company acts on nothing,
  // and an invented company's page discloses that it is invented.
  for (const r of await rows(
    `SELECT m.id, m.product_id, p.name AS company, m.asked, m.goal, m.mode, m.realm, m.supersedes, m.opened_at
       FROM missions m LEFT JOIN products p ON p.id = m.product_id
      WHERE m.founder_id = ? ORDER BY m.opened_at, m.rowid`, [founderId])) {
    const key = `mission:${String(r.id)}`;
    const last = (acts.get(key) ?? []).find((a) => String(a.kind) !== 'amended');
    const lastKind = last ? String(last.kind) : null;
    const status: MissionStatus = lastKind === null ? 'draft'
      : lastKind === 'paused' ? 'paused' : lastKind === 'stopped' ? 'stopped'
        : lastKind === 'concluded' ? 'succeeded' : lastKind === 'archived' ? 'archived'
          : r.mode === 'build' ? 'waiting' : 'ready';
    const concluded = isConcluded(status);
    if (concluded && String(last?.at ?? '') < cutoff.slice(0, 19).replace('T', ' ')) continue;
    out.push({
      key, source: 'mission', goal: String(r.goal), mode: String(r.mode) as MissionMode,
      realm: String(r.realm) as MissionRealm, status, statusWord: STATUS_WORDS[status],
      statusDetail: status === 'paused' ? 'You paused it. Nothing is done for it until you resume it.'
        : r.mode === 'build' && !concluded ? 'Foundry can propose, not build, yet: each step comes to you as a proposal.'
          : concluded ? String(last?.said ?? '') : 'Stated by you; it waits for the first step.',
      company: r.product_id ? { id: String(r.product_id), name: String(r.company ?? '') } : null,
      limits: { budget: null, until: null, success: null, stop: null },
      next: concluded || status === 'paused' ? null
        : r.mode === 'build' ? 'Bringing you the first step as a proposal, for you to approve or refuse.'
          : 'Waiting for you, or for an engine that can carry it.',
      outcome: concluded ? String(last?.said ?? '') : null,
      parent: r.supersedes ? `mission:${String(r.supersedes)}` : null, href: `/foundry/missions/${encodeURIComponent(key)}`,
      openedAt: String(r.opened_at), concluded, terms: null, spentCents: null, tripped: null,
    });
  }

  // HIS LIMITS, ON ANY MISSION, AND THE TRIPWIRES THEY SET. A limit he wrote
  // replaces the one the work carries for display, and crossing it makes the
  // Mission need him — Foundry watches the limit and says so; it does not act
  // on it, because a Mission grants nothing and stops nothing by itself.
  const liveTerms = new Map<string, Row>();
  for (const t of await rows(
    `SELECT mission_key, budget_cents, until, success, stop_when, interrupt_at, said_at
       FROM mission_terms WHERE founder_id = ? AND superseded_by IS NULL`, [founderId])) liveTerms.set(String(t.mission_key), t);
  const today = now.toISOString().slice(0, 10);
  const dollars = (c: number): string => `$${(c / 100).toFixed(2)}`;
  for (const m of out) {
    const t = liveTerms.get(m.key);
    if (!t) continue;
    m.terms = {
      budgetCents: t.budget_cents == null ? null : Number(t.budget_cents), until: t.until == null ? null : String(t.until),
      success: t.success == null ? null : String(t.success), stopWhen: t.stop_when == null ? null : String(t.stop_when),
      interruptAt: String(t.interrupt_at) as 'silent' | 'today' | 'needs_you' | 'urgent', saidAt: String(t.said_at),
    };
    if (m.terms.budgetCents !== null) m.limits.budget = `${dollars(m.terms.budgetCents)} (your limit)${m.spentCents !== null ? `; ${dollars(m.spentCents)} spent` : ''}`;
    if (m.terms.until) m.limits.until = m.terms.until;
    if (m.terms.success) m.limits.success = m.terms.success;
    if (m.terms.stopWhen) m.limits.stop = m.terms.stopWhen;
    if (m.concluded || m.status === 'paused') continue;
    const over = m.terms.budgetCents !== null && m.spentCents !== null && m.spentCents > m.terms.budgetCents;
    const late = m.terms.until !== null && m.terms.until < today;
    if (over || late) {
      m.tripped = over ? 'budget' : 'until';
      m.status = 'needs_you'; m.statusWord = STATUS_WORDS.needs_you;
      m.statusDetail = over ? `It has spent ${dollars(m.spentCents!)}, past the ${dollars(m.terms.budgetCents!)} you set.`
        : `It is past the end date you set, ${m.terms.until!}.`;
      m.next = 'Waiting for you: stop it, or give it more room.';
    }
  }

  const rank: Record<MissionStatus, number> = {
    needs_you: 0, running: 1, waiting: 2, ready: 3, paused: 4, draft: 5, succeeded: 6, failed: 6, stopped: 6, archived: 7,
  };
  return out.sort((a, b) => rank[a.status] - rank[b.status] || (a.openedAt < b.openedAt ? 1 : a.openedAt > b.openedAt ? -1 : 0));
}
