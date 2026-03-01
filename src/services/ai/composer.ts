// =============================================================================
// FOUNDRY — System Prompt Composer
// Context-window-aware. Tracks token usage across components.
// Trims lower-priority context before higher-priority context.
// =============================================================================

import type { SystemPromptComponents } from '../../types/index.js';
import type { ComponentPriority, PromptComposerConfig } from '../../types/ai.js';

// Rough estimate: 1 token ≈ 4 characters for English text
const CHARS_PER_TOKEN = 4;

function estimateTokens(text: string): number {
  return Math.ceil(text.length / CHARS_PER_TOKEN);
}

/**
 * Component priority levels (higher = trimmed last = more important).
 */
const PRIORITY = {
  METHODOLOGY: 10,      // Current prompt methodology — never trimmed
  PRODUCT_STATE: 9,     // Active product state, risk context
  WISDOM_CONTEXT: 9,    // Product DNA, judgment patterns, failure log
  RISK_CONTEXT: 9,      // Risk state, stressors, stressor history
  REVENUE_CONTEXT: 8,   // MRR decomposition, health ratio
  COHORT_CONTEXT: 8,    // Recent cohort data, retention curves
  SAFETY_GATES: 8,      // Gate definitions adjusted for risk state
  CONSTRAINTS: 7,       // Quality gates, scoring criteria
  RESPONSE_FORMAT: 7,   // Structured output specification
  COMPETITIVE: 6,       // Recent competitive signals
  PATTERN_CONTEXT: 6,   // Cross-product decision patterns
  PRIOR_OUTPUTS: 5,     // Prior phase outputs
} as const;

/**
 * Compose a system prompt from components, fitting within token budget.
 * Higher-priority components are preserved; lower-priority trimmed first.
 */
export function composeSystemPrompt(
  components: SystemPromptComponents,
  maxTokens: number = 100000
): string {
  const prioritized: ComponentPriority[] = [
    { name: 'methodology', priority: PRIORITY.METHODOLOGY, content: components.methodology, estimatedTokens: estimateTokens(components.methodology) },
    { name: 'productContext', priority: PRIORITY.PRODUCT_STATE, content: components.productContext, estimatedTokens: estimateTokens(components.productContext) },
    { name: 'wisdomContext', priority: PRIORITY.WISDOM_CONTEXT, content: components.wisdomContext, estimatedTokens: estimateTokens(components.wisdomContext) },
    { name: 'riskContext', priority: PRIORITY.RISK_CONTEXT, content: components.riskContext, estimatedTokens: estimateTokens(components.riskContext) },
    { name: 'revenueContext', priority: PRIORITY.REVENUE_CONTEXT, content: components.revenueContext, estimatedTokens: estimateTokens(components.revenueContext) },
    { name: 'cohortContext', priority: PRIORITY.COHORT_CONTEXT, content: components.cohortContext, estimatedTokens: estimateTokens(components.cohortContext) },
    { name: 'safetyGates', priority: PRIORITY.SAFETY_GATES, content: components.safetyGates, estimatedTokens: estimateTokens(components.safetyGates) },
    { name: 'constraints', priority: PRIORITY.CONSTRAINTS, content: components.constraints, estimatedTokens: estimateTokens(components.constraints) },
    { name: 'responseFormat', priority: PRIORITY.RESPONSE_FORMAT, content: components.responseFormat, estimatedTokens: estimateTokens(components.responseFormat) },
    { name: 'competitiveContext', priority: PRIORITY.COMPETITIVE, content: components.competitiveContext, estimatedTokens: estimateTokens(components.competitiveContext) },
    { name: 'patternContext', priority: PRIORITY.PATTERN_CONTEXT, content: components.patternContext, estimatedTokens: estimateTokens(components.patternContext) },
    { name: 'priorOutputs', priority: PRIORITY.PRIOR_OUTPUTS, content: components.priorOutputs, estimatedTokens: estimateTokens(components.priorOutputs) },
  ].filter((c) => c.content.length > 0);

  // Sort by priority ascending (lowest priority first — these get trimmed first)
  prioritized.sort((a, b) => a.priority - b.priority);

  let totalTokens = prioritized.reduce((sum, c) => sum + c.estimatedTokens, 0);

  // Trim from lowest priority until within budget
  const included = [...prioritized];
  while (totalTokens > maxTokens && included.length > 1) {
    const removed = included.shift();
    if (removed) {
      totalTokens -= removed.estimatedTokens;
    }
  }

  // Sort remaining by a logical document order for readability
  const ORDER: Record<string, number> = {
    methodology: 1,
    productContext: 2,
    wisdomContext: 3,
    riskContext: 4,
    revenueContext: 5,
    cohortContext: 6,
    competitiveContext: 7,
    patternContext: 8,
    priorOutputs: 9,
    constraints: 10,
    safetyGates: 11,
    responseFormat: 12,
  };

  included.sort((a, b) => (ORDER[a.name] ?? 99) - (ORDER[b.name] ?? 99));

  return included
    .map((c) => `<${c.name}>\n${c.content}\n</${c.name}>`)
    .join('\n\n');
}

/**
 * Build a minimal context object for operational intelligence calls (Sonnet).
 * Smaller context window, focused on immediate operational needs.
 */
export function composeOperationalPrompt(
  productDocs: string,
  userHistory: string,
  recentTickets: string,
  riskState: string
): string {
  return [
    '<productDocs>',
    productDocs,
    '</productDocs>',
    '<userHistory>',
    userHistory,
    '</userHistory>',
    '<recentTickets>',
    recentTickets,
    '</recentTickets>',
    '<riskState>',
    riskState,
    '</riskState>',
  ].join('\n');
}

/**
 * Assemble context for the weekly synthesis call.
 */
export function composeWeeklySynthesisPrompt(config: {
  featureUsage: string;
  supportCategories: string;
  interviewSummaries: string;
  retentionCorrelation: string;
  priorRecommendations: string;
  stressorHistory: string;
  scenarioAccuracy: string;
  mrrDecomposition: string;
  mrrHealthRatioTrend: string;
  cohortData: string;
  competitiveSignals: string;
  decisionPatterns: string;
  currentRiskState: string;
}): string {
  return Object.entries(config)
    .filter(([, v]) => v.length > 0)
    .map(([k, v]) => `<${k}>\n${v}\n</${k}>`)
    .join('\n\n');
}
