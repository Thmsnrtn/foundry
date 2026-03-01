// =============================================================================
// FOUNDRY — Database Row Types (raw rows from libsql)
// These map directly to SQL columns. JSON fields are strings until parsed.
// =============================================================================

export interface FounderRow {
  id: string;
  clerk_user_id: string;
  email: string;
  name: string | null;
  stripe_customer_id: string | null;
  tier: string | null;
  cohort_id: string | null;
  created_at: string;
  preferences: string | null; // JSON string
}

export interface ProductRow {
  id: string;
  name: string;
  owner_id: string;
  github_repo_url: string | null;
  github_repo_owner: string | null;
  github_repo_name: string | null;
  github_access_token: string | null;
  stack_description: string | null;
  market_category: string | null;
  created_at: string;
  updated_at: string;
  status: string;
}

export interface LifecycleStateRow {
  product_id: string;
  current_prompt: string;
  risk_state: string;
  risk_state_changed_at: string | null;
  risk_state_reason: string | null;
  prompt_1_status: string;
  prompt_1_completed_at: string | null;
  prompt_1_verdict: string | null;
  prompt_1_composite: number | null;
  prompt_2_status: string;
  prompt_2_completed_at: string | null;
  prompt_2_hypotheses: string | null;
  prompt_2_5_status: string;
  prompt_2_5_tier: number;
  prompt_3_status: string;
  prompt_3_completed_at: string | null;
  prompt_4_status: string;
  prompt_4_completed_at: string | null;
  prompt_5_status: string;
  prompt_5_last_run: string | null;
  prompt_6_status: string;
  prompt_7_status: string;
  prompt_8_status: string;
  prompt_9_status: string;
  prompt_9_started_at: string | null;
  updated_at: string;
}

export interface AuditScoreRow {
  id: string;
  product_id: string;
  run_type: string | null;
  d1_score: number | null;
  d2_score: number | null;
  d3_score: number | null;
  d4_score: number | null;
  d5_score: number | null;
  d6_score: number | null;
  d7_score: number | null;
  d8_score: number | null;
  d9_score: number | null;
  d10_score: number | null;
  composite: number | null;
  verdict: string | null;
  findings: string | null;
  blocking_issues: string | null;
  created_at: string;
  notes: string | null;
}

export interface DecisionRow {
  id: string;
  product_id: string;
  category: string | null;
  gate: number | null;
  what: string;
  why_now: string;
  context: string | null;
  options: string | null;
  recommendation: string | null;
  impact: string | null;
  scenario_model: string | null;
  deadline: string | null;
  status: string;
  chosen_option: string | null;
  outcome: string | null;
  outcome_measured_at: string | null;
  created_at: string;
  decided_at: string | null;
  decided_by: string | null;
}

export interface AuditLogRow {
  id: string;
  product_id: string;
  action_type: string;
  gate: number;
  trigger: string;
  reasoning: string;
  input_context: string | null;
  output: string | null;
  outcome: string | null;
  confidence_score: number | null;
  risk_state_at_action: string | null;
  created_at: string;
  reviewed: number; // SQLite boolean
}

export interface MetricSnapshotRow {
  id: string;
  product_id: string;
  snapshot_date: string;
  signups_7d: number | null;
  active_users: number | null;
  new_mrr_cents: number;
  expansion_mrr_cents: number;
  contraction_mrr_cents: number;
  churned_mrr_cents: number;
  activation_rate: number | null;
  day_30_retention: number | null;
  support_volume_7d: number | null;
  nps_score: number | null;
  churn_rate: number | null;
  mrr_health_ratio: number | null;
  custom_metrics: string | null;
  created_at: string;
}

export interface StressorHistoryRow {
  id: string;
  product_id: string;
  stressor_name: string;
  signal: string;
  timeframe_days: number;
  neutralizing_action: string;
  severity: string | null;
  status: string;
  identified_at: string;
  resolved_at: string | null;
  resolution_notes: string | null;
  risk_state_at_identification: string | null;
}

export interface ScenarioModelRow {
  id: string;
  decision_id: string;
  product_id: string;
  option_label: string;
  best_case: string;
  base_case: string;
  stress_case: string;
  data_inputs_used: string;
  patterns_referenced: string | null;
  created_at: string;
  outcome_accuracy: string | null;
}

export interface DecisionPatternRow {
  id: string;
  decision_type: string;
  product_lifecycle_stage: string;
  risk_state_at_decision: string;
  key_metrics_context: string;
  option_chosen_category: string;
  outcome_direction: string | null;
  outcome_magnitude: string | null;
  outcome_timeframe_days: number | null;
  market_category: string | null;
  contributing_factors: string | null;
  scenario_accuracy_score: number | null;
  created_at: string;
}

export interface CohortRow {
  id: string;
  product_id: string;
  acquisition_period: string;
  acquisition_channel: string | null;
  acquisition_source: string | null;
  founder_count: number;
  activated_count: number;
  retained_day_7: number;
  retained_day_14: number;
  retained_day_30: number;
  retained_day_60: number;
  retained_day_90: number;
  converted_to_paid: number;
  churned_count: number;
  avg_activation_minutes: number | null;
  mrr_contribution_cents: number;
  created_at: string;
  updated_at: string;
}

export interface CompetitorRow {
  id: string;
  product_id: string;
  name: string;
  website: string | null;
  positioning: string | null;
  primary_icp: string | null;
  pricing_model: string | null;
  known_weaknesses: string | null;
  monitoring_active: number; // SQLite boolean
  added_at: string;
  last_checked: string | null;
}

export interface CompetitiveSignalRow {
  id: string;
  product_id: string;
  competitor_name: string;
  signal_type: string | null;
  signal_summary: string;
  signal_detail: string | null;
  significance: string | null;
  detected_at: string;
  reviewed: number; // SQLite boolean
  linked_stressor_id: string | null;
}

export interface BetaIntakeRow {
  id: string;
  product_id: string;
  participant_name: string | null;
  interview_summary: string | null;
  key_quotes: string | null;
  activation_outcome: string | null;
  testimonial_text: string | null;
  testimonial_permitted: number;
  positioning_feedback: string | null;
  hypothesis_signals: string | null;
  created_at: string;
  processed: number;
}

export interface LifecycleConditionRow {
  product_id: string;
  prompt: string;
  condition_name: string;
  condition_met: number;
  current_value: string | null;
  threshold_value: string | null;
  last_checked: string | null;
}

export interface FoundingStoryArtifactRow {
  id: string;
  product_id: string;
  phase: string;
  artifact_type: string | null;
  title: string;
  content: string;
  evidence_links: string | null;
  created_at: string;
  published: number;
}
