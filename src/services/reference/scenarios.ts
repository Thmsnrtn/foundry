// =============================================================================
// FOUNDRY — the reference world: what it is a company OF
//
// A reference company that exercises nothing is fiction in the database. A
// scenario is the reason one is allowed to exist: the situation it puts the
// institution in, stated before the company is created and stored immutably
// beside it (migration 222).
//
// WHY THESE ARE DECLARATIONS AND NOT DATA. Each scenario is a handful of
// numbers describing how a business moves — a starting level, a daily drift, a
// jitter. The world is DERIVED from them, deterministically, so there is no
// generated dataset to keep, no fixture to drift out of date, and the same
// scenario is the same world on every machine and every rerun. That matters
// more here than it usually does: a rehearsal you cannot reproduce is an
// anecdote.
//
// WHAT A SCENARIO MAY NOT CONTAIN. Anything drawn from a real company. These
// are shapes — falling revenue, rising support load — not a copy of anyone's
// numbers, and nothing here is anonymised from anything.
// =============================================================================

import type { ObservableField } from '../institution/external-observation.js';

/**
 * `mrr_cents` is the LEVEL — what the company's MRR is — and is a snapshot
 * column rather than an observable field: the institution watches movements,
 * and every investor-facing surface reads the level. A scenario states both.
 */
export type ScenarioField = ObservableField | 'mrr_cents';

export interface ScenarioMetric {
  field: ScenarioField;
  /** The level on the first day of history. */
  start: number;
  /** Proportional movement per day. -0.008 falls a little under 1% a day. */
  dailyDrift: number;
  /** Proportional jitter, so movement is not a clean line nobody would believe. */
  noise: number;
  /** Whole numbers for counts and cents; four places for rates. */
  precision: 'integer' | 'rate';
}

export interface ReferenceScenario {
  key: string;
  companyName: string;
  /** Stored in `reference_companies.scenario`: the situation being exercised. */
  situation: string;
  /** Stored in `reference_companies.purpose`: what it is for. */
  purpose: string;
  /** What a person reading the company page should understand it to be. */
  premise: string;
  metrics: ScenarioMetric[];
}

// THE FIRST SCENARIO, AND WHY IT IS THIS ONE.
//
// A business quietly coming apart is where an institution either earns its
// place or does not. Revenue is still arriving, so nothing looks like an
// emergency; churn is climbing under it, support load is rising, and retention
// is slipping. Every individual day is unremarkable. The question the
// institution exists to answer is whether anybody notices before it is a
// crisis — which is exactly the question a founder cannot ask themselves.
const FALLING: ReferenceScenario = {
  key: 'revenue_quietly_falling',
  companyName: 'Northgate Reference Co',
  situation: 'a subscription business whose revenue is falling while nothing looks urgent',
  purpose: 'exercise the institution end to end without touching a real company',
  premise:
    'New revenue is drifting down while churn and support load climb. No single '
    + 'day looks like a problem. The question is whether the institution notices.',
  metrics: [
    { field: 'mrr_cents', start: 4_120_000, dailyDrift: -0.0031, noise: 0.012, precision: 'integer' },
    { field: 'new_mrr_cents', start: 418_000, dailyDrift: -0.0085, noise: 0.05, precision: 'integer' },
    { field: 'expansion_mrr_cents', start: 96_000, dailyDrift: -0.0040, noise: 0.08, precision: 'integer' },
    { field: 'contraction_mrr_cents', start: 41_000, dailyDrift: 0.0075, noise: 0.09, precision: 'integer' },
    { field: 'churned_mrr_cents', start: 88_000, dailyDrift: 0.0120, noise: 0.07, precision: 'integer' },
    { field: 'active_users', start: 1_840, dailyDrift: -0.0022, noise: 0.01, precision: 'integer' },
    { field: 'signups_7d', start: 74, dailyDrift: -0.0060, noise: 0.12, precision: 'integer' },
    { field: 'support_volume_7d', start: 31, dailyDrift: 0.0100, noise: 0.15, precision: 'integer' },
    { field: 'day_30_retention', start: 0.62, dailyDrift: -0.0035, noise: 0.02, precision: 'rate' },
    { field: 'activation_rate', start: 0.44, dailyDrift: -0.0015, noise: 0.03, precision: 'rate' },
    { field: 'churn_rate', start: 0.031, dailyDrift: 0.0090, noise: 0.06, precision: 'rate' },
  ],
};

// THE CONTROL. A business going nowhere in particular.
//
// A rehearsal against a company in trouble proves the institution can raise an
// alarm. It does not prove the institution can stay quiet, which is the harder
// half and the one that makes it liveable: an institution that finds something
// urgent every day is one the owner stops reading.
const STEADY: ReferenceScenario = {
  key: 'steady_and_unremarkable',
  companyName: 'Ashfield Reference Co',
  situation: 'a business that is doing fine, to test whether the institution can stay quiet',
  purpose: 'exercise the institution against a company that needs nothing from it',
  premise:
    'Nothing is wrong here. Movement is noise around a flat line. The institution '
    + 'should find nothing worth the owner\'s attention, and saying so is the result.',
  metrics: [
    { field: 'mrr_cents', start: 2_480_000, dailyDrift: 0.0005, noise: 0.010, precision: 'integer' },
    { field: 'new_mrr_cents', start: 265_000, dailyDrift: 0.0004, noise: 0.06, precision: 'integer' },
    { field: 'churned_mrr_cents', start: 44_000, dailyDrift: 0.0002, noise: 0.09, precision: 'integer' },
    { field: 'active_users', start: 980, dailyDrift: 0.0006, noise: 0.012, precision: 'integer' },
    { field: 'signups_7d', start: 41, dailyDrift: 0.0005, noise: 0.14, precision: 'integer' },
    { field: 'support_volume_7d', start: 12, dailyDrift: 0.0000, noise: 0.18, precision: 'integer' },
    { field: 'day_30_retention', start: 0.71, dailyDrift: 0.0002, noise: 0.02, precision: 'rate' },
    { field: 'churn_rate', start: 0.018, dailyDrift: -0.0003, noise: 0.07, precision: 'rate' },
  ],
};

export const REFERENCE_SCENARIOS: ReferenceScenario[] = [FALLING, STEADY];

export function referenceScenario(key: string): ReferenceScenario | null {
  return REFERENCE_SCENARIOS.find((s) => s.key === key) ?? null;
}
