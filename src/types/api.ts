// =============================================================================
// FOUNDRY — API Request/Response Types
// =============================================================================

import type {
  AuditScore,
  Cohort,
  CompetitiveSignal,
  Competitor,
  DashboardData,
  Decision,
  Digest,
  FoundingStoryArtifact,
  LifecycleCondition,
  LifecycleState,
  MetricSnapshot,
  Product,
  RiskState,
  Stressor,
} from './index.js';

// ─── Generic API Response ────────────────────────────────────────────────────

export interface APIResponse<T> {
  success: boolean;
  data?: T;
  error?: string;
  meta?: {
    page?: number;
    per_page?: number;
    total?: number;
  };
}

// ─── Products ────────────────────────────────────────────────────────────────

export interface ProductListResponse {
  products: Product[];
}

export interface ProductDetailResponse {
  product: Product;
  lifecycle: LifecycleState;
  risk_state: RiskState;
}

// ─── Audit ───────────────────────────────────────────────────────────────────

export interface AuditResultResponse {
  current: AuditScore;
  prior: AuditScore | null;
  comparison: AuditComparison | null;
}

export interface AuditComparison {
  dimension_deltas: Record<string, number>;
  composite_delta: number;
  verdict_change: string | null;
  blocking_resolved: string[];
  blocking_still_open: string[];
}

export interface RunAuditResponse {
  audit_id: string;
  status: 'running' | 'completed' | 'failed';
}

// ─── Decisions ───────────────────────────────────────────────────────────────

export interface DecisionListResponse {
  decisions: Decision[];
  pending_count: number;
}

export interface DecisionDetailResponse {
  decision: Decision;
  scenarios: import('./index.js').ScenarioModel[] | null;
  similar_patterns: import('./index.js').DecisionPattern[] | null;
}

// ─── Lifecycle ───────────────────────────────────────────────────────────────

export interface LifecycleResponse {
  state: LifecycleState;
  conditions: LifecycleCondition[];
}

// ─── Digest ──────────────────────────────────────────────────────────────────

export interface DigestListResponse {
  digests: Digest[];
}

// ─── Metrics ─────────────────────────────────────────────────────────────────

export interface MetricsResponse {
  snapshots: MetricSnapshot[];
  latest: MetricSnapshot | null;
}

// ─── Stressors ───────────────────────────────────────────────────────────────

export interface StressorListResponse {
  active: Stressor[];
  resolved: Stressor[];
}

// ─── Risk History ────────────────────────────────────────────────────────────

export interface RiskHistoryResponse {
  transitions: Array<{
    from: string;
    to: string;
    reason: string;
    timestamp: string;
  }>;
}

// ─── Cohorts ─────────────────────────────────────────────────────────────────

export interface CohortListResponse {
  cohorts: Cohort[];
  historical_average: {
    retention_day_7: number;
    retention_day_14: number;
    retention_day_30: number;
  } | null;
}

// ─── Competitive ─────────────────────────────────────────────────────────────

export interface CompetitiveResponse {
  competitors: Competitor[];
  recent_signals: CompetitiveSignal[];
}

// ─── Journey ─────────────────────────────────────────────────────────────────

export interface JourneyResponse {
  artifacts: FoundingStoryArtifact[];
}

// ─── Internal API ────────────────────────────────────────────────────────────

export interface HealthResponse {
  status: 'ok' | 'degraded';
  timestamp: string;
  version: string;
}

export interface InternalDashboardResponse extends DashboardData {}
