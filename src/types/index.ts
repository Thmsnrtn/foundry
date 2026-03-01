// =============================================================================
// FOUNDRY — Complete Type Definitions
// =============================================================================

// ─── Gate Definitions ────────────────────────────────────────────────────────

/** Gate 0: Fully autonomous. Gate 4: Human only. */
export type Gate = 0 | 1 | 2 | 3 | 4;

export type RiskStateValue = 'green' | 'yellow' | 'red';

export type SubscriptionTier = 'founding_cohort' | 'growth' | 'scale';

export type DecisionCategory = 'urgent' | 'strategic' | 'product' | 'marketing' | 'informational';

export type DecisionStatus = 'pending' | 'approved' | 'rejected' | 'executed' | 'expired';

export type StressorSeverity = 'watch' | 'elevated' | 'critical';

export type StressorStatus = 'active' | 'resolved' | 'escalated';

export type AuditRunType = 'initial' | 'post_remediation' | 'periodic';

export type AuditVerdict = 'READY' | 'READY_WITH_CONDITIONS' | 'NOT_READY';

export type ProductStatus = 'active' | 'paused' | 'archived';

export type CompetitiveSignalType =
  | 'pricing_change'
  | 'feature_launch'
  | 'positioning_shift'
  | 'new_entrant'
  | 'market_exit'
  | 'funding'
  | 'acquisition';

export type CompetitiveSignificance = 'low' | 'medium' | 'high';

export type ArtifactType =
  | 'audit'
  | 'remediation'
  | 'beta_outcome'
  | 'lifecycle_activation'
  | 'risk_event'
  | 'ecosystem_connection'
  | 'recovery'
  | 'milestone';

export type OutcomeDirection = 'positive' | 'neutral' | 'negative';

export type OutcomeMagnitude = 'significant' | 'moderate' | 'minimal';

export type PromptNumber = 1 | 2 | 2.5 | 3 | 4 | 5 | 6 | 7 | 8 | 9;

export type PromptStatus = 'not_started' | 'in_progress' | 'completed' | 'dormant';

// ─── Core Entities ───────────────────────────────────────────────────────────

export interface Founder {
  id: string;
  clerk_user_id: string;
  email: string;
  name: string | null;
  stripe_customer_id: string | null;
  tier: SubscriptionTier | null;
  cohort_id: string | null;
  created_at: string;
  preferences: FounderPreferences | null;
}

export interface FounderPreferences {
  digest_time?: string; // HH:MM in founder's timezone
  timezone?: string;
  notification_channels?: ('email' | 'dashboard')[];
}

export interface Product {
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
  status: ProductStatus;
}

export interface LifecycleState {
  product_id: string;
  current_prompt: string;
  risk_state: RiskStateValue;
  risk_state_changed_at: string | null;
  risk_state_reason: string | null;
  prompt_1_status: PromptStatus;
  prompt_1_completed_at: string | null;
  prompt_1_verdict: string | null;
  prompt_1_composite: number | null;
  prompt_2_status: PromptStatus;
  prompt_2_completed_at: string | null;
  prompt_2_hypotheses: Record<string, 'confirmed' | 'failed' | 'pending'> | null;
  prompt_2_5_status: PromptStatus;
  prompt_2_5_tier: number;
  prompt_3_status: PromptStatus;
  prompt_3_completed_at: string | null;
  prompt_4_status: PromptStatus;
  prompt_4_completed_at: string | null;
  prompt_5_status: PromptStatus;
  prompt_5_last_run: string | null;
  prompt_6_status: PromptStatus;
  prompt_7_status: PromptStatus;
  prompt_8_status: PromptStatus;
  prompt_9_status: PromptStatus;
  prompt_9_started_at: string | null;
  updated_at: string;
}

export interface RiskState {
  state: RiskStateValue;
  reason: string;
  changed_at: string | null;
}

export interface AuditScore {
  id: string;
  product_id: string;
  run_type: AuditRunType;
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
  verdict: AuditVerdict | null;
  findings: AuditFinding[] | null;
  blocking_issues: BlockingIssue[] | null;
  created_at: string;
  notes: string | null;
}

export interface AuditFinding {
  dimension: string;
  dimension_number: number;
  finding: string;
  evidence: string;
  severity: 'critical' | 'major' | 'minor' | 'informational';
}

export interface BlockingIssue {
  id: string;
  dimension: string;
  issue: string;
  evidence: string;
  definition_of_done: string;
  dependencies: string[];
  status: 'open' | 'resolved';
}

export interface Decision {
  id: string;
  product_id: string;
  category: DecisionCategory;
  gate: Gate;
  what: string;
  why_now: string;
  context: DecisionContext[] | null;
  options: DecisionOption[] | null;
  recommendation: string | null;
  impact: string | null;
  scenario_model: string | null;
  deadline: string | null;
  status: DecisionStatus;
  chosen_option: string | null;
  outcome: string | null;
  outcome_measured_at: string | null;
  created_at: string;
  decided_at: string | null;
  decided_by: string | null;
}

export interface DecisionContext {
  label: string;
  value: string;
  source: string;
}

export interface DecisionOption {
  label: string;
  description: string;
  trade_offs: string;
}

export interface AuditLogEntry {
  id: string;
  product_id: string;
  action_type: string;
  gate: Gate;
  trigger: string;
  reasoning: string;
  input_context: Record<string, unknown> | null;
  output: Record<string, unknown> | null;
  outcome: string | null;
  confidence_score: number | null;
  risk_state_at_action: RiskStateValue | null;
  created_at: string;
  reviewed: boolean;
}

export interface BetaIntake {
  id: string;
  product_id: string;
  participant_name: string | null;
  interview_summary: string | null;
  key_quotes: BetaQuote[] | null;
  activation_outcome: Record<string, unknown> | null;
  testimonial_text: string | null;
  testimonial_permitted: boolean;
  positioning_feedback: string | null;
  hypothesis_signals: Record<string, unknown> | null;
  created_at: string;
  processed: boolean;
}

export interface BetaQuote {
  quote: string;
  theme: string;
}

export interface LifecycleCondition {
  product_id: string;
  prompt: string;
  condition_name: string;
  condition_met: boolean;
  current_value: string | null;
  threshold_value: string | null;
  last_checked: string | null;
}

export interface FoundingStoryArtifact {
  id: string;
  product_id: string;
  phase: string;
  artifact_type: ArtifactType;
  title: string;
  content: string;
  evidence_links: string[] | null;
  created_at: string;
  published: boolean;
}

export interface MetricSnapshot {
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
  custom_metrics: Record<string, unknown> | null;
  created_at: string;
}

// ─── Intelligence Layer ──────────────────────────────────────────────────────

export interface Stressor {
  id: string;
  product_id: string;
  stressor_name: string;
  signal: string;
  timeframe_days: number;
  neutralizing_action: string;
  severity: StressorSeverity;
  status: StressorStatus;
  identified_at: string;
  resolved_at: string | null;
  resolution_notes: string | null;
  risk_state_at_identification: RiskStateValue | null;
}

export interface StressorReport {
  stressors: StressorReportItem[];
  evaluation_context: {
    mrr_health_ratio: number | null;
    mrr_health_trend: 'improving' | 'stable' | 'degrading' | null;
    latest_cohort_retention_vs_avg: number | null;
    high_significance_competitive_signals: number;
  };
  generated_at: string;
}

export interface StressorReportItem {
  name: string;
  signal: string;
  timeframe_days: number;
  neutralizing_action: string;
  severity: StressorSeverity;
  competitive_correlation: string | null;
}

export interface ScenarioModel {
  id: string;
  decision_id: string;
  product_id: string;
  option_label: string;
  best_case: ScenarioCase;
  base_case: ScenarioCase;
  stress_case: StressCase;
  data_inputs_used: string[];
  patterns_referenced: string[] | null;
  created_at: string;
  outcome_accuracy: ScenarioAccuracy | null;
}

export interface ScenarioCase {
  narrative: string;
  metrics_30d: Record<string, number>;
  metrics_60d: Record<string, number>;
  metrics_90d: Record<string, number>;
  probability: number;
}

export interface StressCase extends ScenarioCase {
  what_breaks: string;
  time_to_impact: string;
  recovery_requirements: string;
}

export interface ScenarioAccuracy {
  predicted_direction: OutcomeDirection;
  actual_direction: OutcomeDirection;
  accuracy_score: number;
  measured_at: string;
}

export interface DecisionPattern {
  id: string;
  decision_type: string;
  product_lifecycle_stage: string;
  risk_state_at_decision: RiskStateValue;
  key_metrics_context: Record<string, unknown>;
  option_chosen_category: string;
  outcome_direction: OutcomeDirection | null;
  outcome_magnitude: OutcomeMagnitude | null;
  outcome_timeframe_days: number | null;
  market_category: string | null;
  contributing_factors: Record<string, unknown> | null;
  scenario_accuracy_score: number | null;
  created_at: string;
}

export interface Cohort {
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

export interface CohortSummary {
  period: string;
  channel: string | null;
  retention_day_14: number;
  retention_day_30: number;
  vs_historical_average_14: number;
  vs_historical_average_30: number;
}

export interface Competitor {
  id: string;
  product_id: string;
  name: string;
  website: string | null;
  positioning: string | null;
  primary_icp: string | null;
  pricing_model: string | null;
  known_weaknesses: string | null;
  monitoring_active: boolean;
  added_at: string;
  last_checked: string | null;
}

export interface CompetitiveSignal {
  id: string;
  product_id: string;
  competitor_name: string;
  signal_type: CompetitiveSignalType;
  signal_summary: string;
  signal_detail: Record<string, unknown> | null;
  significance: CompetitiveSignificance;
  detected_at: string;
  reviewed: boolean;
  linked_stressor_id: string | null;
}

export interface MRRDecomposition {
  new_cents: number;
  expansion_cents: number;
  contraction_cents: number;
  churned_cents: number;
  total_cents: number;
  health_ratio: number | null;
}

export interface MRRHealthRatio {
  value: number;
  indicator: 'green' | 'yellow' | 'red';
}

// ─── AI Interfaces ───────────────────────────────────────────────────────────

export interface AIDecision {
  action: string;
  confidence: number; // 0.0 to 1.0
  reasoning: string;
  gate: Gate;
  context_used: string[];
  alternatives_considered: string[];
  risk_state_at_decision: RiskStateValue;
}

export interface SystemPromptComponents {
  methodology: string;
  productContext: string;
  wisdomContext: string;
  riskContext: string;
  revenueContext: string;
  cohortContext: string;
  competitiveContext: string;
  patternContext: string;
  priorOutputs: string;
  constraints: string;
  safetyGates: string;
  responseFormat: string;
}

export interface PromptContext {
  product: Product;
  lifecycleState: LifecycleState;
  riskState: RiskState;
  priorPhaseOutputs: PhaseOutput[];
  currentMetrics: MetricSnapshot | null;
  mrrDecomposition: MRRDecomposition | null;
  activeStressors: Stressor[];
  recentCohortPerformance: CohortSummary[];
  recentCompetitiveSignals: CompetitiveSignal[];
  relevantDecisionPatterns: DecisionPattern[];
  relevantDecisions: Decision[];
  relevantAuditLog: AuditLogEntry[];
}

export interface PhaseOutput {
  prompt_number: PromptNumber;
  output: Record<string, unknown>;
  completed_at: string;
}

// ─── Confidence Thresholds ───────────────────────────────────────────────────

export interface GateThresholds {
  gate_0: number;
  gate_1: number;
  gate_2: number;
}

export const DEFAULT_THRESHOLDS: Record<RiskStateValue, GateThresholds> = {
  green: { gate_0: 0.85, gate_1: 0.75, gate_2: 0.60 },
  yellow: { gate_0: 0.85, gate_1: 0.85, gate_2: 0.60 },
  red: { gate_0: 0.85, gate_1: 0.85, gate_2: 0.60 },
};

// ─── Audit Dimension Weights ─────────────────────────────────────────────────

export const AUDIT_DIMENSION_WEIGHTS: Record<string, number> = {
  d1_functional_completeness: 0.15,
  d2_experience_coherence: 0.10,
  d3_trust_density: 0.15,
  d4_value_legibility: 0.10,
  d5_operational_readiness: 0.15,
  d6_commercial_integrity: 0.10,
  d7_self_sufficiency: 0.10,
  d8_competitive_defensibility: 0.05,
  d9_launch_readiness: 0.05,
  d10_stranger_test: 0.05,
};

export const AUDIT_DIMENSION_NAMES: Record<string, string> = {
  d1: 'Functional Completeness',
  d2: 'Experience Coherence',
  d3: 'Trust Density',
  d4: 'Value Legibility',
  d5: 'Operational Readiness',
  d6: 'Commercial Integrity',
  d7: 'Self-Sufficiency',
  d8: 'Competitive Defensibility',
  d9: 'Launch Readiness',
  d10: 'Stranger Test',
};

// ─── Weekly Synthesis Output ─────────────────────────────────────────────────

export interface WeeklySynthesisOutput {
  product_recommendation: {
    recommendation: string;
    evidence: string[];
    expected_impact: string;
  };
  stressor_report: StressorReport;
  risk_state_evaluation: {
    current_state: RiskStateValue;
    recommended_state: RiskStateValue;
    transition_warranted: boolean;
    reason: string;
    triggering_signals: string[];
  };
}

// ─── Recovery Protocol ───────────────────────────────────────────────────────

export interface RecoveryProtocol {
  diagnosis: string;
  root_variable: string;
  recovery_plan: RecoveryStep[];
  what_to_stop: string[];
  estimated_recovery_days: number;
}

export interface RecoveryStep {
  order: number;
  action: string;
  expected_effect: string;
  measurement: string;
}

// ─── Digest ──────────────────────────────────────────────────────────────────

export interface Digest {
  risk_state: RiskState;
  stressor_report: StressorReport | null;
  competitive_context: string | null;
  narrative: string;
  mrr: MRRDecomposition;
  mrr_health: MRRHealthRatio;
  metrics: DashboardMetrics;
  cohort_snapshot: CohortSummary | null;
  generated_at: string;
  digest_type: 'weekly' | 'yellow_pulse' | 'red_daily';
}

export interface DashboardMetrics {
  signups_7d: number;
  active_users: number;
  activation_rate: number;
  day_30_retention: number;
  support_volume_7d: number;
  nps_score: number;
  churn_rate: number;
}

// ─── Dashboard Data (API) ────────────────────────────────────────────────────

export interface DashboardData {
  app: string;
  timestamp: string;
  risk_state: {
    state: RiskStateValue;
    reason: string;
    changed_at: string | null;
  };
  stressors: StressorReportItem[];
  health: { status: string; services: Record<string, unknown> };
  mrr: MRRDecomposition;
  metrics: DashboardMetrics & {
    mrr_health_ratio: number;
  };
  cohort_latest: CohortSummary | null;
  competitive_signals_recent: number;
  alerts: Alert[];
  decisions_pending: number;
  lifecycle_prompt_status: Record<string, string>;
}

export interface Alert {
  id: string;
  severity: 'info' | 'warning' | 'critical';
  message: string;
  action_url: string | null;
  created_at: string;
}

// ─── Cold Start Mode ─────────────────────────────────────────────────────────

export interface ColdStartStatus {
  active: boolean;
  decisions_logged: number;
  decisions_required: number;
  days_elapsed: number;
  days_required: number;
  started_at: string;
}

// ─── Behavioral Trigger ──────────────────────────────────────────────────────

export interface BehavioralTrigger {
  name: string;
  condition: string;
  email_subject: string;
  email_summary: string;
  gate: Gate;
  risk_states: RiskStateValue[];
}

// ─── Koldly Integration ──────────────────────────────────────────────────────

export interface ICPConfig {
  product_id: string;
  target_role: string;
  target_industry: string;
  company_size: string;
  pain_points: string[];
  qualifying_signals: string[];
}

export interface ConversionSignal {
  product_id: string;
  event_type: string;
  event_data: Record<string, unknown>;
  timestamp: string;
}

// ─── Telemetry Events ────────────────────────────────────────────────────────

export type TelemetryEvent =
  | 'founder_signed_up'
  | 'github_connected'
  | 'repo_selected'
  | 'competitors_identified'
  | 'audit_started'
  | 'audit_completed'
  | 'audit_compared'
  | 'prompt_started'
  | 'prompt_completed'
  | 'decisions_viewed'
  | 'decision_made'
  | 'decision_outcome_recorded'
  | 'scenario_viewed'
  | 'digest_opened'
  | 'digest_viewed'
  | 'stressor_viewed'
  | 'risk_history_viewed'
  | 'cohort_intelligence_viewed'
  | 'competitive_intel_viewed'
  | 'mrr_reported'
  | 'story_published'
  | 'support_contacted'
  | 'lifecycle_condition_met'
  | 'risk_state_changed'
  | 'competitive_signal_detected';

export interface TelemetryPayload {
  event: TelemetryEvent;
  founder_id: string;
  product_id?: string;
  metadata?: Record<string, unknown>;
  timestamp: string;
}

// ─── API Request/Response Types ──────────────────────────────────────────────

export interface CreateProductRequest {
  name: string;
  github_repo_url?: string;
  github_repo_owner?: string;
  github_repo_name?: string;
  market_category?: string;
}

export interface ReportMetricsRequest {
  signups_7d?: number;
  active_users?: number;
  new_mrr_cents?: number;
  expansion_mrr_cents?: number;
  contraction_mrr_cents?: number;
  churned_mrr_cents?: number;
  activation_rate?: number;
  day_30_retention?: number;
  support_volume_7d?: number;
  nps_score?: number;
  churn_rate?: number;
  custom_metrics?: Record<string, unknown>;
}

export interface ResolveDecisionRequest {
  chosen_option: string;
  reason?: string;
}

export interface RecordOutcomeRequest {
  outcome: string;
}

export interface AddCompetitorRequest {
  name: string;
  website?: string;
  positioning?: string;
  primary_icp?: string;
  pricing_model?: string;
}

export interface BetaIntakeRequest {
  participant_name: string;
  interview_summary?: string;
  key_quotes?: BetaQuote[];
  activation_outcome?: Record<string, unknown>;
  testimonial_text?: string;
  testimonial_permitted?: boolean;
  positioning_feedback?: string;
  hypothesis_signals?: Record<string, unknown>;
}

// ─── Wisdom Layer ────────────────────────────────────────────────────────────

export interface ProductDNA {
  id: string;
  product_id: string;
  icp_description: string | null;
  icp_pain: string | null;
  icp_trigger: string | null;
  icp_sophistication: string | null;
  positioning_statement: string | null;
  positioning_history: PositioningHistoryEntry[] | null;
  what_we_are_not: string | null;
  primary_objection: string | null;
  objection_response: string | null;
  voice_principles: VoicePrinciple[] | null;
  market_insight: string | null;
  retention_hypothesis: string | null;
  growth_hypothesis: string | null;
  sections_completed: string[];
  completion_pct: number;
  created_at: string;
  updated_at: string;
}

export interface PositioningHistoryEntry {
  statement: string;
  reason_abandoned: string;
  date: string;
}

export interface VoicePrinciple {
  do: string;
  dont: string;
}

export type FailureCategory = 'positioning' | 'pricing' | 'onboarding' | 'acquisition' | 'retention' | 'messaging' | 'feature' | 'operations' | 'other';

export interface FailureLog {
  id: string;
  product_id: string;
  owner_id: string;
  category: FailureCategory;
  what_was_tried: string;
  timeframe: string | null;
  outcome: string;
  founder_hypothesis: string | null;
  linked_stressor_id: string | null;
  created_at: string;
}

export interface FounderJudgmentPattern {
  id: string;
  product_id: string;
  owner_id: string;
  category: string;
  pattern_description: string;
  evidence_decision_ids: string[];
  confidence: number;
  times_observed: number;
  invalidated: boolean;
  created_at: string;
  updated_at: string;
}

export interface FailureInput {
  category: FailureCategory;
  what_was_tried: string;
  timeframe?: string;
  outcome: string;
  founder_hypothesis?: string;
  linked_stressor_id?: string;
}

export interface WisdomContext {
  wisdom_active: boolean;
  dna_completion_pct: number;
  dna_context: string;
  judgment_patterns: string;
  failure_context: string;
  completeness_warnings: string[];
  meta: {
    patterns_injected: number;
    failures_injected: number;
    dna_sections_complete: number;
    dna_sections_total: number;
  };
}

// ─── Remediation Engine ──────────────────────────────────────────────────────

export type RemediabilityClassification = 'AUTO' | 'WISDOM_REQUIRED' | 'HUMAN_ONLY';

export interface RemediabilityResult {
  classification: RemediabilityClassification;
  reason: string;
  wisdom_sections_needed?: string[];
}

export interface RemediationPR {
  id: string;
  product_id: string;
  owner_id: string;
  audit_score_id: string;
  blocking_issue_id: string;
  blocking_issue_dimension: string;
  blocking_issue_summary: string;
  wisdom_context_pct: number | null;
  wisdom_patterns_used: number;
  wisdom_failures_used: number;
  fix_summary: string | null;
  fix_approach: string | null;
  files_modified: Array<{ path: string; change_summary: string }> | null;
  github_branch: string | null;
  github_pr_number: number | null;
  github_pr_url: string | null;
  github_base_branch: string;
  status: 'generating' | 'pr_open' | 'merged' | 'rejected' | 'failed' | 'skipped';
  skipped_reason: string | null;
  rejection_reason: string | null;
  failure_reason: string | null;
  pre_fix_dimension_score: number | null;
  post_fix_dimension_score: number | null;
  re_audit_triggered_at: string | null;
  re_audit_completed_at: string | null;
  created_at: string;
  resolved_at: string | null;
}

export interface RemediationStats {
  total_issues: number;
  auto_count: number;
  wisdom_required_count: number;
  human_only_count: number;
  prs_generating: number;
  prs_open: number;
  prs_merged: number;
  prs_skipped: number;
  prs_failed: number;
  composite_before: number | null;
  composite_after: number | null;
}

// ─── Hono Context Extensions ─────────────────────────────────────────────────

// ─── UX Intelligence Layer ────────────────────────────────────────────────────

export interface NextAction {
  priority: number;
  type: string;
  headline: string;
  subtext: string;
  action_label: string;
  action_url: string;
  urgency: 'critical' | 'elevated' | 'normal' | 'positive';
}

export interface PageHint {
  id: string;
  type: 'empty_state' | 'contextual' | 'warning' | 'tip';
  headline: string;
  body: string;
  action_label?: string;
  action_url?: string;
  dismissible: boolean;
}

export interface MilestoneEvent {
  id: string;
  founder_id: string;
  product_id: string;
  milestone_key: string;
  milestone_title: string;
  milestone_description: string;
  seen_at: string | null;
  created_at: string;
}

export interface OnboardingTour {
  founder_id: string;
  started_at: string;
  current_step: number;
  completed_steps: number[];
  completed_at: string | null;
  skipped_at: string | null;
  product_id: string;
}

export interface AppNotification {
  id: string;
  founder_id: string;
  product_id: string | null;
  type: string;
  title: string;
  body: string;
  action_url: string | null;
  action_label: string | null;
  read_at: string | null;
  created_at: string;
}

export interface NavBadges {
  decisions_count: number;
  has_overdue_audit: boolean;
  unread_signals: boolean;
  unseen_milestones: boolean;
  open_prs_count: number;
  dna_completion: number;
}

export interface FeatureGateConfig {
  requiredTier: SubscriptionTier[];
  name: string;
  description: string;
  upgradeMessage: string;
}

export interface DimensionHint {
  audit_score_id: string;
  dimension: string;
  hint_text: string;
}

// ─── Hono Context Extensions ─────────────────────────────────────────────────

export interface AuthContext {
  founder: Founder;
}

export interface ProductContext extends AuthContext {
  product: Product;
  lifecycleState: LifecycleState;
}
