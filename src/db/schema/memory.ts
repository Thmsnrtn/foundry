// =============================================================================
// FOUNDRY — Memory Kernel schema (Ascent B1)
// Typed row + insert shapes for the belief ledger. The Insert type is the
// single source of column truth used by buildInsert (see kernel.ts).
// =============================================================================

export const DECISION_PREMISES = 'decision_premises';

export type PremiseStatus = 'holding' | 'falsified' | 'unverifiable' | 'revisited';
export type PremiseType = 'metric' | 'qualitative';
export type PremiseComparator = '<' | '<=' | '>' | '>=' | '==';
export type DecisionSource = 'strategic' | 'decision';

/** A full decision_premises row as read from the DB. */
export interface DecisionPremise {
  id: string;
  product_id: string;
  decision_id: string;
  decision_source: DecisionSource;
  premise: string;
  premise_type: PremiseType;
  metric_key: string | null;
  comparator: PremiseComparator | null;
  threshold: number | null;
  status: PremiseStatus;
  last_checked_at: string | null;
  falsified_at: string | null;
  evidence: string | null;
  created_at: string;
}

/** The shape accepted when inserting a premise. Only real columns are allowed;
 *  a typo'd column name is a compile error at the call site. */
export interface DecisionPremiseInsert {
  id: string;
  product_id: string;
  decision_id: string;
  decision_source?: DecisionSource;
  premise: string;
  premise_type?: PremiseType;
  metric_key?: string | null;
  comparator?: PremiseComparator | null;
  threshold?: number | null;
  status?: PremiseStatus;
}
