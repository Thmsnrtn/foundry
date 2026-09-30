// =============================================================================
// FOUNDRY — Explore, as one reading: what Foundry is looking at for the owner.
//
// THE EXPLORE DOOR (long-horizon directive, 30 September 2026; the model in
// docs/foundry-institution/INSTITUTION_MODEL.md §5.10, §6, §8). The search,
// its tests, the trading research and every idea turned down were four pages
// under four names. This composes them into one read model the Explore page
// binds to, and stores nothing: every count is a COUNT over the row that is
// the fact, and every piece of work is a Mission read by `mission/read.ts`.
//
// ONLY STAGES A ROW CAN PROVE. Noticed (a seed), screened (a seed promoted or
// buried), looked at closely (an opportunity), tested (an experiment), a real
// buyer paid (a payment the world recorded against a test's exposure), became
// a company (the lineage a graduation writes) — and, beside them, parked
// (turned down with a condition for another look) and turned down for good.
// "Promising" in the model is "a real buyer paid" here, because anything
// softer would be a number Foundry chose to believe.
// =============================================================================

import { query } from '../../db/client.js';
import { currentMandate, graveyardFor, type Buried } from '../venture/mandate.js';
import { missionsOf, type Mission } from '../mission/read.js';
import { mandateOf } from '../mandate/statements.js';

type Row = Record<string, unknown>;

export interface ExploreStage {
  key: 'noticed' | 'screened' | 'looked_at' | 'tested' | 'paid' | 'became_company';
  label: string;
  /** Counted from the real market only. */
  n: number;
  /** Counted from reference material a rehearsal used, said apart and never added in. */
  reference: number;
  means: string;
  href: string;
}

export interface ExploreSummary {
  search: { statement: string; since: string; avoid: string[]; href: string } | null;
  stages: ExploreStage[];
  /** Turned down for good, and parked: turned down with a condition under which it is worth another look. */
  turnedDown: { n: number; parked: number; recent: Buried[] };
  /** The work in flight under Explore: the search, its tests, the research, and Missions the owner stated to explore. */
  work: Mission[];
  trading: { observing: number; capitalAtRiskCents: 0 };
  /** Everything in flight, Explore's and the Portfolio's, for "All work". */
  allWork: number;
  /** What the owner's Mandate says about where to look: areas to look harder at, and areas paused. */
  mandate: {
    focus: Array<{ label: string; lasting: string }>;
    paused: Array<{ label: string; lasting: string }>;
    tradingTheoretical: boolean;
  };
}

const EXPLORING = new Set(['explore', 'validate', 'monitor']);

async function counted(sql: string, args: unknown[]): Promise<{ real: number; reference: number }> {
  const out = { real: 0, reference: 0 };
  for (const r of (await query(sql, args)).rows as unknown as Row[]) {
    if (String(r.mode) === 'reference') out.reference += Number(r.n ?? 0);
    else out.real += Number(r.n ?? 0);
  }
  return out;
}

/** What Explore shows, read once. Bounded: six queries and the Missions reader. */
export async function exploreSummary(founderId: string, now: Date = new Date()): Promise<ExploreSummary> {
  const [mandate, noticed, screened, lookedAt, tested, paid, turned, parked, buried, missions, wants] = await Promise.all([
    currentMandate(founderId),
    counted(`SELECT evidence_mode AS mode, COUNT(*) AS n FROM opportunity_seeds WHERE founder_id = ? GROUP BY evidence_mode`, [founderId]),
    // SCREENED: a seed something was decided about — promoted to a closer
    // look, or buried with its reason.
    counted(`SELECT evidence_mode AS mode, COUNT(*) AS n FROM opportunity_seeds
              WHERE founder_id = ? AND (promoted_to IS NOT NULL OR buried_at IS NOT NULL) GROUP BY evidence_mode`, [founderId]),
    counted(`SELECT evidence_mode AS mode, COUNT(*) AS n FROM venture_opportunities WHERE founder_id = ? GROUP BY evidence_mode`, [founderId]),
    counted(`SELECT o.evidence_mode AS mode, COUNT(*) AS n FROM venture_experiments e
               JOIN venture_opportunities o ON o.id = e.opportunity_id
              WHERE e.founder_id = ? GROUP BY o.evidence_mode`, [founderId]),
    // A REAL BUYER PAID: a test with at least one payment the world recorded
    // against one of its exposures — the one stage a hope cannot reach.
    counted(`SELECT e.evidence_mode AS mode, COUNT(DISTINCT e.id) AS n FROM venture_experiments e
               JOIN experiment_exposures x ON x.experiment_id = e.id
               JOIN business_outcome_events b ON b.exposure_id = x.id AND b.kind = 'payment'
              WHERE e.founder_id = ? GROUP BY e.evidence_mode`, [founderId]),
    counted(`SELECT evidence_mode AS mode, COUNT(*) AS n FROM venture_opportunities
              WHERE founder_id = ? AND verdict = 'rejected' AND revisit_if IS NULL GROUP BY evidence_mode`, [founderId]),
    counted(`SELECT evidence_mode AS mode, COUNT(*) AS n FROM venture_opportunities
              WHERE founder_id = ? AND verdict = 'rejected' AND revisit_if IS NOT NULL GROUP BY evidence_mode`, [founderId]),
    graveyardFor(founderId, 3),
    missionsOf(founderId, now),
    mandateOf(founderId, now),
  ]);
  const lasting = (w: { until: string | null; reviewAt: string | null }): string =>
    w.until ? `until ${w.until}` : w.reviewAt ? `until you say otherwise; I will ask again ${w.reviewAt}` : 'until you change it';
  // WHAT BECAME A COMPANY: the lineage column a graduation writes. Reality and
  // standing are not filtered here on purpose — a company that is not real
  // still came from a real idea or it did not, and the evidence mode of the
  // idea it came from is what splits the count.
  const became = await counted(
    `SELECT o.evidence_mode AS mode, COUNT(*) AS n FROM products p
       JOIN venture_opportunities o ON o.id = p.from_opportunity_id
      WHERE p.owner_id = ? AND p.deleted_at IS NULL GROUP BY o.evidence_mode`, [founderId]);

  const live = missions.filter((m) => !m.concluded);
  const work = live.filter((m) => m.source === 'mandate' || m.source === 'experiment' || m.source === 'thesis'
    || (m.source === 'mission' && EXPLORING.has(m.mode)));

  return {
    search: mandate ? {
      statement: mandate.statement, since: String(mandate.openedAt).slice(0, 10),
      avoid: mandate.guidance.filter((g) => g.kind === 'avoid').map((g) => g.statement),
      href: '/foundry/searching',
    } : null,
    stages: [
      { key: 'noticed', label: 'Noticed', n: noticed.real, reference: noticed.reference,
        means: 'Something in the world that might be worth looking into.', href: '/foundry/searching' },
      { key: 'screened', label: 'Screened', n: screened.real, reference: screened.reference,
        means: 'Kept for a closer look, or set aside with a reason.', href: '/foundry/searching' },
      { key: 'looked_at', label: 'Looked at closely', n: lookedAt.real, reference: lookedAt.reference,
        means: 'Who has the problem, why it might work, and what would kill it.', href: '/foundry/experiments/explore' },
      { key: 'tested', label: 'Tested', n: tested.real, reference: tested.reference,
        means: 'Put in front of the real world, inside limits you set.', href: '/foundry/experiments/history' },
      { key: 'paid', label: 'A real buyer paid', n: paid.real, reference: paid.reference,
        means: 'A test in which somebody actually paid. Nothing else counts here.', href: '/foundry/experiments/history' },
      { key: 'became_company', label: 'Became a company', n: became.real, reference: became.reference,
        means: 'Earned a place in your portfolio.', href: '/foundry/companies' },
    ],
    turnedDown: { n: turned.real + turned.reference, parked: parked.real + parked.reference, recent: buried },
    work,
    trading: { observing: missions.filter((m) => m.source === 'thesis' && !m.concluded).length, capitalAtRiskCents: 0 },
    allWork: live.length,
    mandate: {
      focus: wants.filter((w) => w.dimension === 'interest' && w.scope.kind === 'portfolio').map((w) => ({ label: w.label, lasting: lasting(w) })),
      paused: wants.filter((w) => w.dimension === 'avoid' && w.scope.kind === 'portfolio').map((w) => ({ label: w.label, lasting: lasting(w) })),
      tradingTheoretical: wants.some((w) => w.dimension === 'posture' && w.scope.kind === 'domain' && w.scope.ref === 'trading'),
    },
  };
}
