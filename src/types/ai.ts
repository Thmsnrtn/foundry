// =============================================================================
// FOUNDRY — AI Type Definitions
// =============================================================================

import type { Gate, RiskStateValue } from './index.js';

export type AIModel = 'claude-opus-4-6' | 'claude-sonnet-4-5-20250929';

export interface AICallConfig {
  model: AIModel;
  maxTokens: number;
  temperature?: number;
  systemPrompt: string;
  userPrompt: string;
}

export interface AIResponse {
  content: string;
  model: AIModel;
  usage: {
    input_tokens: number;
    output_tokens: number;
  };
  stop_reason: string | null;
}

export interface AIDecisionOutput {
  action: string;
  confidence: number;
  reasoning: string;
  gate: Gate;
  context_used: string[];
  alternatives_considered: string[];
  risk_state_at_decision: RiskStateValue;
}

export interface PromptComposerConfig {
  maxTokens: number; // Total token budget for the prompt
  priorities: ComponentPriority[];
}

export interface ComponentPriority {
  name: string;
  priority: number; // Higher = trimmed last
  content: string;
  estimatedTokens: number;
}

export interface AuditScoringRequest {
  product_name: string;
  analysis_results: AnalysisPipelineOutput;
  prior_audit: PriorAuditContext | null;
}

export interface AnalysisPipelineOutput {
  discovery: DiscoveryResult;
  configuration: ConfigurationResult;
  routes: RouteAnalysisResult;
  billing: BillingAnalysisResult;
  trust_signals: TrustSignalResult;
  error_handling: ErrorHandlingResult;
  analytics: AnalyticsResult;
  dependencies: DependencyResult;
}

export interface DiscoveryResult {
  project_structure: string[];
  stack: string[];
  framework: string | null;
  language: string | null;
  file_count: number;
}

export interface ConfigurationResult {
  env_vars: string[];
  config_files: string[];
  deployment_manifests: string[];
  has_production_config: boolean;
}

export interface RouteAnalysisResult {
  api_routes: string[];
  page_routes: string[];
  middleware: string[];
  auth_protected: boolean;
}

export interface BillingAnalysisResult {
  stripe_integration: boolean;
  pricing_config: string | null;
  plan_definitions: string[];
  webhook_handlers: boolean;
}

export interface TrustSignalResult {
  landing_pages: string[];
  verifiable_claims: string[];
  unverifiable_claims: string[];
  social_proof: string[];
}

export interface ErrorHandlingResult {
  error_boundaries: string[];
  fallbacks: string[];
  silent_failures: string[];
  logging_present: boolean;
}

export interface AnalyticsResult {
  telemetry: boolean;
  event_tracking: string[];
  data_persistence: boolean;
}

export interface DependencyResult {
  external_services: string[];
  failure_modes: string[];
  fallback_defined: boolean;
}

export interface PriorAuditContext {
  scores: Record<string, number>;
  composite: number;
  verdict: string;
  blocking_issues_open: string[];
}

export interface ScoringOutput {
  dimensions: DimensionScore[];
  composite: number;
  verdict: string;
  findings: Finding[];
  blocking_issues: BlockingIssueOutput[];
}

export interface DimensionScore {
  dimension: string;
  dimension_number: number;
  score: number;
  weight: number;
  rationale: string;
}

export interface Finding {
  dimension: string;
  dimension_number: number;
  finding: string;
  evidence: string;
  severity: 'critical' | 'major' | 'minor' | 'informational';
}

export interface BlockingIssueOutput {
  id: string;
  dimension: string;
  issue: string;
  evidence: string;
  definition_of_done: string;
  dependencies: string[];
}

export interface WeeklySynthesisInput {
  product_id: string;
  product_name: string;
  feature_usage: Record<string, unknown>;
  support_categories: Record<string, number>;
  interview_summaries: string[];
  retention_correlation: Record<string, unknown>;
  prior_recommendations: string[];
  stressor_history: string[];
  scenario_accuracy_records: Record<string, unknown>;
  mrr_decomposition: Record<string, number>;
  mrr_health_ratio_trend: number[];
  cohort_data: Record<string, unknown>;
  competitive_signals: Record<string, unknown>[];
  decision_patterns: Record<string, unknown>[];
  current_risk_state: RiskStateValue;
}

export interface CompetitiveScanInput {
  product_id: string;
  product_positioning: string;
  product_icp: string;
  competitors: Array<{
    name: string;
    website: string | null;
    last_known_positioning: string | null;
    last_known_pricing: string | null;
  }>;
}

export interface RecoveryProtocolInput {
  product_id: string;
  product_name: string;
  active_stress: string;
  operational_history: string;
  mrr_trajectory: Record<string, number>[];
  cohort_trends: Record<string, unknown>;
  competitive_signals: Record<string, unknown>[];
  active_decisions: Record<string, unknown>[];
  stressor_trajectory: string[];
}
