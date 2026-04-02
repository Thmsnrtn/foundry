// =============================================================================
// FOUNDRY — Sovereign Company Protocol Types
// All types for the SCP runtime: agents, evolution, briefings, constitution.
// =============================================================================

// ─── Company Lifecycle ────────────────────────────────────────────────────────

/** The maturity stage of a company's AI operations. */
export type CompanyLifecycleState =
  | 'setup'        // Founder connecting integrations, filling DNA; agents not yet active
  | 'learning'     // Agents running at max oversight (Level 2); accumulating golden lessons
  | 'operating'    // Routine operations at Level 0-1; founder reviews daily briefing
  | 'optimizing'   // Experimentation active; agents compounding knowledge
  | 'scaling';     // Largely autonomous; founder sets quarterly direction

/** The provisioning/operational state of an SCP instance. */
export type SCPStatus = 'provisioning' | 'active' | 'paused' | 'archived';

// ─── Agent Identity ───────────────────────────────────────────────────────────

/** The 12 canonical agents in every SCP instance. */
export type AgentName =
  | 'atlas'     // CTO — code quality, architecture, technical debt, security
  | 'compass'   // PM — product roadmap, feature prioritization, lifecycle management
  | 'prism'     // UX — user experience, onboarding, friction identification
  | 'beacon'    // CMO — marketing, acquisition, brand, positioning experiments
  | 'scribe'    // Content — blog posts, docs, case studies, SEO content
  | 'forge'     // Revenue — pricing, conversion, sales enablement, expansion
  | 'harbor'    // CS — customer success, retention, health monitoring, outreach
  | 'sentinel'  // DevOps — infrastructure monitoring, deployment health, uptime
  | 'ledger'    // Finance — revenue tracking, financial health, AI ROI analysis
  | 'shield'    // Legal — compliance monitoring, terms, privacy, risk flags
  | 'oracle'    // Analytics — data interpretation, stressor identification, trends
  | 'crucible'; // QA — test coverage, regression prevention, quality gates

/** The 12 agent display names matching the design spec. */
export const AGENT_DISPLAY_NAMES: Record<AgentName, string> = {
  atlas:    'Atlas',
  compass:  'Compass',
  prism:    'Prism',
  beacon:   'Beacon',
  scribe:   'Scribe',
  forge:    'Forge',
  harbor:   'Harbor',
  sentinel: 'Sentinel',
  ledger:   'Ledger',
  shield:   'Shield',
  oracle:   'Oracle',
  crucible: 'Crucible',
};

/** Agent role titles. */
export const AGENT_ROLES: Record<AgentName, string> = {
  atlas:    'CTO',
  compass:  'Product Manager',
  prism:    'UX Lead',
  beacon:   'CMO',
  scribe:   'Content Director',
  forge:    'Revenue Lead',
  harbor:   'Customer Success',
  sentinel: 'DevOps',
  ledger:   'CFO',
  shield:   'Compliance',
  oracle:   'Analytics Lead',
  crucible: 'QA Lead',
};

/** Ordered list of all 12 agents. */
export const ALL_AGENTS: AgentName[] = [
  'atlas', 'compass', 'prism', 'beacon', 'scribe', 'forge',
  'harbor', 'sentinel', 'ledger', 'shield', 'oracle', 'crucible',
];

// ─── Authority Levels ─────────────────────────────────────────────────────────

/**
 * 0 = Fully autonomous — agent acts without any notification.
 * 1 = Notify + override — agent acts, founder has 24h to reverse.
 * 2 = Require approval — agent proposes, founder must approve before execution.
 */
export type AgentAuthorityLevel = 0 | 1 | 2;

/** Default authority levels (conservative — trust is earned via evolution). */
export const DEFAULT_AUTHORITY_LEVELS: Record<AgentName, AgentAuthorityLevel> = {
  atlas:    2, // Code changes always need approval
  compass:  2, // Roadmap decisions need approval
  prism:    2, // UX experiments need approval
  beacon:   2, // Marketing spend needs approval
  scribe:   1, // Content drafts: notify + override window
  forge:    2, // Pricing changes need approval
  harbor:   1, // Retention emails: notify + override window
  sentinel: 1, // Infrastructure changes: notify + override
  ledger:   1, // Financial recommendations: notify
  shield:   2, // Legal advice always needs review
  oracle:   0, // Analytics/reporting: fully autonomous
  crucible: 1, // QA alerts: notify
};

/** Default activation cadence (hours between agent runs). */
export const DEFAULT_CADENCE_HOURS: Record<AgentName, number> = {
  atlas:    24,
  compass:  48,
  prism:    48,
  beacon:   24,
  scribe:   168, // Weekly
  forge:    24,
  harbor:   12,  // Twice daily for CS
  sentinel: 6,   // Every 6 hours
  ledger:   24,
  shield:   168, // Weekly compliance check
  oracle:   24,
  crucible: 24,
};

/** Contribution weight for company health score (must sum to 1.0). */
export const AGENT_HEALTH_WEIGHTS: Record<AgentName, number> = {
  oracle:   0.20, // Analytics drives overall view
  harbor:   0.20, // Customer success is critical
  atlas:    0.15, // Code quality matters
  ledger:   0.15, // Financial health matters
  beacon:   0.10, // Marketing effectiveness
  forge:    0.10, // Revenue operations
  sentinel: 0.05, // Infrastructure reliability
  crucible: 0.05, // Quality assurance
  compass:  0.00, // PM — qualitative, not scored
  prism:    0.00, // UX — qualitative
  scribe:   0.00, // Content — qualitative
  shield:   0.00, // Legal — qualitative
};

// ─── Agent Instance (DB Record) ───────────────────────────────────────────────

export interface AgentInstance {
  id: string;
  product_id: string;
  agent_name: AgentName;
  display_name: string;
  role_description: string | null;
  version: number;
  authority_level: AgentAuthorityLevel;
  activation_cadence_hours: number;
  status: 'active' | 'paused' | 'error';
  total_sessions: number;
  successful_sessions: number;
  total_decisions_proposed: number;
  total_decisions_approved: number;
  total_evolution_cycles: number;
  domain_health_score: number;
  system_prompt_core: string | null;
  behavioral_constraints: string[] | null;
  config_json: Record<string, unknown> | null;
  last_run_at: string | null;
  next_run_at: string | null;
  created_at: string;
  updated_at: string;
}

// ─── Agent Session Output ─────────────────────────────────────────────────────

/** An action the agent took or proposes to take. */
export interface AgentAction {
  id: string;
  type: string;                        // e.g., 'send_email', 'create_pr', 'update_config'
  description: string;                 // Human-readable description
  authority_level: AgentAuthorityLevel;
  executed: boolean;                   // true = already done, false = pending approval
  executed_at?: string;
  result?: string;                     // What happened when executed
  target?: string;                     // Who/what it affects
}

/** A decision the agent is proposing that requires founder approval. */
export interface AgentDecision {
  id: string;
  agent_name: AgentName;
  title: string;
  description: string;
  rationale: string;
  expected_impact: string;
  estimated_impact_usd?: number;
  action_type: string;
  action_data: Record<string, unknown>;
  expires_at?: string;                 // When this decision expires if not acted on
  created_at: string;
}

/** An evolution candidate — a hypothesis about improving the agent's behavior. */
export interface EvolutionCandidate {
  trigger: string;                     // What prompted this candidate
  hypothesis: string;                  // Proposed behavioral change
  proposed_change: string;             // Specific change to config or constraints
  confidence: number;                  // 0-1: how confident the agent is
  evidence: string[];                  // Supporting evidence from this session
}

/** Full output of one agent session. */
export interface AgentSessionOutput {
  sessionId: string;
  agentName: AgentName;
  productId: string;
  success: boolean;
  durationMs: number;
  observations: string[];              // What the agent noticed
  actionsTaken: AgentAction[];         // Actions executed at Level 0/1
  pendingDecisions: AgentDecision[];   // Awaiting founder approval
  briefingContribution: string;        // 2-3 sentences for CEO briefing
  briefingPriority: 'high' | 'normal' | 'low';
  evolutionCandidates: EvolutionCandidate[];
  tokensUsed: number;
  costUsd: number;
}

// ─── Agent Run Context ────────────────────────────────────────────────────────

/** Context passed to each agent when it runs. */
export interface AgentRunContext {
  productId: string;
  companyName: string;
  agentInstance: AgentInstance;
  goldenLessons: GoldenSuiteEntry[];
  constitution: SCPConstitution | null;
  runDate: string;                     // YYYY-MM-DD
  // v2 enrichment — loaded by BaseAgent before calling analyzeAndAct
  agentConfig?: Record<string, string>;        // ConfigType -> content
  integrationEvents?: IntegrationEventSummary[]; // relevant events since last run
  unreadMessages?: IncomingAgentMessage[];     // unread messages for this agent
  // v3 coordination — what other agents found today (injected into system prompt)
  scratchpadContext?: string;
}

/** Slim summary of an integration event injected into agent context. */
export interface IntegrationEventSummary {
  source: string;       // e.g. 'stripe', 'posthog', 'github'
  event_type: string;
  summary: string;      // ≤200 chars human-readable summary
  created_at: string;
}

/** Slim view of an inter-agent message injected into agent context. */
export interface IncomingAgentMessage {
  from_agent: string;
  priority: string;
  subject: string;
  body: string;
  sent_at: string;
}

/** Result from an agent's domain-specific analysis (internal to BaseAgent). */
export interface AgentAnalysisResult {
  observations: string[];
  actionsTaken: AgentAction[];
  pendingDecisions: AgentDecision[];
  briefingContribution: string;
  briefingPriority: 'high' | 'normal' | 'low';
  evolutionCandidates: EvolutionCandidate[];
  tokensUsed: number;
  costUsd?: number;                    // Optional: if provided, used directly; otherwise computed from tokensUsed
  domainHealthScore?: number;          // 0-100; if provided, updates agent_instances.domain_health_score
  // v2/v3 signal fields — optional; BaseAgent processes these after analyzeAndAct returns
  customerSignals?: CustomerSignal[];  // Upserted into customer_intelligence
  outboundActions?: OutboundActionSignal[]; // Queued in outbound_actions
  agentMessages?: AgentMessageSignal[]; // Sent via agent_messages bus
  hypotheses?: HypothesisSignal[];     // Proposed into hypotheses table
}

// ─── v2/v3 Signal Types ───────────────────────────────────────────────────────

/** A customer signal emitted by an agent (e.g. Harbor identifying at-risk users). */
export interface CustomerSignal {
  external_id: string;          // Stripe customer ID, email, or any stable identifier
  name?: string;
  email?: string;
  mrr_cents?: number;
  plan?: string;
  health_login_score?: number;  // 0-100
  health_feature_score?: number;
  health_sentiment_score?: number;
  health_billing_score?: number;
  stage?: string;               // 'new' | 'active' | 'at_risk' | 'churned' | 'reactivated'
  note?: string;                // Agent-authored note stored in agent_notes JSON
}

/** An outbound action an agent wants to propose or execute. */
export interface OutboundActionSignal {
  action_type: string;          // e.g. 'send_email', 'create_pr', 'update_pricing'
  description: string;
  parameters: Record<string, unknown>;
  authority_level: 0 | 1 | 2;
  estimated_value_usd?: number;
}

/** A message an agent wants to send to another agent. */
export interface AgentMessageSignal {
  to_agent: string;             // agent name or 'broadcast'
  message_type: 'alert' | 'insight' | 'request' | 'update';
  priority: 'critical' | 'high' | 'normal' | 'low';
  subject: string;
  body: string;
}

/** A hypothesis an agent wants to propose for the experiments engine. */
export interface HypothesisSignal {
  title: string;
  description: string;
  hypothesis: string;
  success_metric: string;
  success_threshold: number;    // e.g. 0.15 = 15% improvement
  test_duration_days: number;
}

// ─── Evolution ────────────────────────────────────────────────────────────────

export interface EvolutionVersion {
  id: string;
  product_id: string;
  agent_name: AgentName;
  version: number;
  change_type:
    | 'golden_lesson'
    | 'constraint_added'
    | 'authority_change'
    | 'prompt_refinement'
    | 'founder_correction'
    | 'initial_provision';
  change_description: string;
  trigger_session_id: string | null;
  previous_config: Record<string, unknown> | null;
  new_config: Record<string, unknown>;
  validation_score: number | null;
  validation_notes: string | null;
  promoted_at: string | null;
  created_at: string;
}

// ─── Golden Suite ─────────────────────────────────────────────────────────────

export interface GoldenSuiteEntry {
  id: string;
  product_id: string;
  agent_name: AgentName;
  lesson_type: 'correction' | 'validation' | 'behavioral' | 'domain';
  input_context: string;
  expected_behavior: string;
  lesson: string;                      // Injected into agent prompts as constraint
  source: 'founder_correction' | 'self_observation' | 'evolution_synthesis';
  confidence: number;
  times_reinforced: number;
  active: boolean;
  created_at: string;
  updated_at: string;
}

// ─── CEO Briefing ─────────────────────────────────────────────────────────────

export interface AgentBriefingContribution {
  agent_name: AgentName;
  display_name: string;
  role: string;
  contribution: string;
  priority: 'high' | 'normal' | 'low';
  pending_decisions_count: number;
  actions_taken_count: number;
  session_id: string | null;
}

export interface FinancialSummary {
  mrr_cents: number | null;
  mrr_growth_pct: number | null;
  ai_cost_30d_usd: number;
  attributed_revenue_usd: number;
  roi: number | null;                  // attributed_revenue / ai_cost
}

export interface SCPBriefing {
  id: string;
  product_id: string;
  briefing_date: string;
  signal_score: number | null;
  risk_state: string | null;
  health_score: number | null;
  headline: string;
  full_briefing: string;
  agent_contributions: AgentBriefingContribution[];
  pending_decisions: AgentDecision[];
  overnight_actions: AgentAction[];
  financial_summary: FinancialSummary | null;
  lifecycle_state: CompanyLifecycleState | null;
  tokens_used: number;
  cost_usd: number;
  created_at: string;
}

// ─── SCP Constitution ─────────────────────────────────────────────────────────

export interface EvolutionPolicy {
  enabled: boolean;
  min_sessions_before_evolution: number;     // Don't evolve until N sessions completed
  correction_threshold: number;              // 0-1: correction rate that triggers evolution
  auto_promote_on_validation_score: number;  // If validation ≥ this, auto-promote
  max_constraints_per_agent: number;         // Cap on behavioral constraints
}

export interface SCPConstitution {
  id: string;
  product_id: string;
  version: number;
  core_values: string[];
  operating_principles: string[];
  authority_framework: Record<AgentName, AgentAuthorityLevel>;
  evolution_policy: EvolutionPolicy;
  created_at: string;
  updated_at: string;
}

/** Default constitution for new companies. */
export const DEFAULT_CONSTITUTION: Omit<SCPConstitution, 'id' | 'product_id' | 'created_at' | 'updated_at'> = {
  version: 1,
  core_values: [
    'Move fast but verify: act on high-confidence signals, pause on ambiguity',
    'Founder authority is absolute: when the founder corrects, learn immediately',
    'Compound learning: every session should make the next session better',
    'Revenue integrity: never take actions that risk customer trust for short-term gain',
    'Transparent operation: the founder should always understand what we did and why',
  ],
  operating_principles: [
    'Propose before acting on anything with revenue, legal, or customer-facing implications',
    'Cite evidence for every observation — no assertions without data',
    'When uncertain, report and ask rather than guess and execute',
    'Coordinate with other agents through the briefing, not unilaterally',
    'Golden suite lessons override general training — company-specific knowledge wins',
  ],
  authority_framework: DEFAULT_AUTHORITY_LEVELS,
  evolution_policy: {
    enabled: true,
    min_sessions_before_evolution: 5,
    correction_threshold: 0.15,            // Evolve if >15% of sessions have corrections
    auto_promote_on_validation_score: 0.85,
    max_constraints_per_agent: 20,
  },
};

// ─── SCP Instance Status ──────────────────────────────────────────────────────

export interface SCPInstanceStatus {
  productId: string;
  companyName: string;
  lifecycleState: CompanyLifecycleState;
  scpStatus: SCPStatus;
  healthScore: number;
  agents: Array<{
    name: AgentName;
    displayName: string;
    version: number;
    authorityLevel: AgentAuthorityLevel;
    status: 'active' | 'paused' | 'error';
    totalSessions: number;
    successRate: number;
    domainHealthScore: number;
    lastRunAt: string | null;
    nextRunAt: string | null;
  }>;
  totalEvolutionCycles: number;
  goldenSuiteSize: number;
  latestBriefingDate: string | null;
  aiCost30d: number;
  attributedRevenue30d: number;
}

// ─── Provisioning ─────────────────────────────────────────────────────────────

export interface ProvisionResult {
  success: boolean;
  productId: string;
  agentsCreated: number;
  constitutionCreated: boolean;
  error?: string;
}
