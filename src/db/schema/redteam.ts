// =============================================================================
// FOUNDRY — Red Team schema (Ascent B2 / Dissent Law)
// Typed shapes for adversarial pre-mortem reviews. Insert shapes are the single
// source of column truth (schema-as-code kernel).
// =============================================================================

import type { PremiseComparator } from './memory.js';

export const RED_TEAM_REVIEWS = 'red_team_reviews';

export type RedTeamVerdict = 'proceed' | 'proceed_with_changes' | 'do_not_proceed';
export type RedTeamLens = 'downside' | 'competitor' | 'capacity';
export type ObjectionSeverity = 'fatal' | 'serious' | 'note';

/** A single adversarial objection. When it carries a metric triple it is
 *  FALSIFIABLE — overruling it records the inverse as a monitored premise. */
export interface RedTeamObjection {
  lens: RedTeamLens;
  claim: string;                       // the predicted failure, concretely
  severity: ObjectionSeverity;
  metric_key?: string;                 // e.g. 'churn_rate'
  comparator?: PremiseComparator;      // the FAILURE condition (e.g. '>' 0.07)
  threshold?: number;
  mitigation?: string;                 // what would have to be true/done to proceed safely
}

export interface RedTeamReview {
  id: string;
  product_id: string;
  decision_id: string;
  verdict: RedTeamVerdict;
  strongest_objection: string | null;
  objections_json: string;
  confidence: number | null;
  resolved_outcome: 'vindicated' | 'overruled_held' | null;
  resolved_at: string | null;
  tokens_used: number;
  created_at: string;
}

export interface RedTeamReviewInsert {
  id: string;
  product_id: string;
  decision_id: string;
  verdict: RedTeamVerdict;
  strongest_objection?: string | null;
  objections_json: string;
  confidence?: number | null;
  tokens_used?: number;
}
