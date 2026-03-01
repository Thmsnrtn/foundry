// =============================================================================
// FOUNDRY — Audit Scorer: Claude Opus Ten-Dimension Scoring
// =============================================================================

import { callOpus, parseJSONResponse } from '../ai/client.js';
import { AUDIT_DIMENSION_WEIGHTS, AUDIT_DIMENSION_NAMES } from '../../types/index.js';
import type { AuditScoringRequest, ScoringOutput } from '../../types/ai.js';
import type { WisdomContext } from '../../types/index.js';

const SCORING_SYSTEM_PROMPT = `You are the Foundry Audit Engine. You score software products across 10 dimensions.

DIMENSIONS AND WEIGHTS:
D1 Functional Completeness (15%): Core features work end-to-end without dead ends.
D2 Experience Coherence (10%): Consistent design, navigation, and interaction patterns.
D3 Trust Density (15%): Every claim verifiable. Social proof present and real.
D4 Value Legibility (10%): A stranger understands what the product does and why they'd pay.
D5 Operational Readiness (15%): Error handling, logging, monitoring, deployment config.
D6 Commercial Integrity (10%): Pricing exists, billing works, plans make sense.
D7 Self-Sufficiency (10%): Product handles edge cases, errors, and support without human intervention.
D8 Competitive Defensibility (5%): Clear differentiation from alternatives.
D9 Launch Readiness (5%): Marketing pages, onboarding flow, analytics in place.
D10 Stranger Test (5%): A skeptical stranger feels trust, not doubt.

SCORING RULES:
- Each dimension scored 1-10 (integers only)
- Composite = weighted average using the weights above
- Verdict: READY (7.0+ composite, all dims 7+), READY_WITH_CONDITIONS (6.0-6.9 or any dim below 7 but above 5), NOT_READY (below 6.0 or any dim 5 or below)

For each dimension, provide specific evidence from the analysis.
Generate blocking issues with unique IDs, evidence, definitions of done, and dependency sequencing.

Respond in JSON format only:
{
  "dimensions": [{"dimension": "D1", "dimension_number": 1, "score": 7, "weight": 0.15, "rationale": "..."}],
  "composite": 7.2,
  "verdict": "READY",
  "findings": [{"dimension": "D1", "dimension_number": 1, "finding": "...", "evidence": "...", "severity": "major"}],
  "blocking_issues": [{"id": "BLOCK-001", "dimension": "D5", "issue": "...", "evidence": "...", "definition_of_done": "...", "dependencies": []}]
}`;

export async function scoreAudit(request: AuditScoringRequest, wisdomContext?: WisdomContext): Promise<ScoringOutput> {
  const userPrompt = buildScoringPrompt(request);
  let systemPrompt = SCORING_SYSTEM_PROMPT;
  if (wisdomContext) {
    const wisdomInstruction = wisdomContext.wisdom_active
      ? '\n\nIMPORTANT: Product Wisdom is available. For D2 (Experience Coherence), D3 (Trust Density), and D4 (Value Legibility), score against this product\'s specific ICP and positioning rather than generic best practices.\n'
      : '';
    systemPrompt = SCORING_SYSTEM_PROMPT + wisdomInstruction + '\n' + wisdomContext.dna_context;
  }
  const response = await callOpus(systemPrompt, userPrompt, 8192);
  const output = parseJSONResponse<ScoringOutput>(response.content);

  // Validate and recalculate composite using official weights
  const weights = Object.values(AUDIT_DIMENSION_WEIGHTS);
  let weightedSum = 0;
  for (const dim of output.dimensions) {
    const weight = weights[dim.dimension_number - 1] ?? 0;
    weightedSum += dim.score * weight;
  }
  output.composite = Math.round(weightedSum * 10) / 10;

  // Enforce verdict rules
  const allAbove7 = output.dimensions.every((d) => d.score >= 7);
  const anyAt5OrBelow = output.dimensions.some((d) => d.score <= 5);

  if (output.composite >= 7.0 && allAbove7) {
    output.verdict = 'READY';
  } else if (output.composite < 6.0 || anyAt5OrBelow) {
    output.verdict = 'NOT_READY';
  } else {
    output.verdict = 'READY_WITH_CONDITIONS';
  }

  return output;
}

function buildScoringPrompt(request: AuditScoringRequest): string {
  const parts = [
    `Product: ${request.product_name}`,
    '',
    '--- ANALYSIS RESULTS ---',
    '',
    `DISCOVERY:`,
    `Stack: ${request.analysis_results.discovery.stack.join(', ')}`,
    `Framework: ${request.analysis_results.discovery.framework ?? 'Unknown'}`,
    `Language: ${request.analysis_results.discovery.language ?? 'Unknown'}`,
    `File count: ${request.analysis_results.discovery.file_count}`,
    '',
    `CONFIGURATION:`,
    `Env vars: ${request.analysis_results.configuration.env_vars.join(', ')}`,
    `Config files: ${request.analysis_results.configuration.config_files.join(', ')}`,
    `Deployment: ${request.analysis_results.configuration.deployment_manifests.join(', ')}`,
    `Production config: ${request.analysis_results.configuration.has_production_config}`,
    '',
    `ROUTES:`,
    `API routes (${request.analysis_results.routes.api_routes.length}): ${request.analysis_results.routes.api_routes.slice(0, 20).join(', ')}`,
    `Page routes (${request.analysis_results.routes.page_routes.length}): ${request.analysis_results.routes.page_routes.slice(0, 20).join(', ')}`,
    `Auth protected: ${request.analysis_results.routes.auth_protected}`,
    '',
    `BILLING:`,
    `Stripe integration: ${request.analysis_results.billing.stripe_integration}`,
    `Plans: ${request.analysis_results.billing.plan_definitions.join(', ')}`,
    `Webhook handlers: ${request.analysis_results.billing.webhook_handlers}`,
    '',
    `TRUST SIGNALS:`,
    `Landing pages: ${request.analysis_results.trust_signals.landing_pages.join(', ')}`,
    `Social proof: ${request.analysis_results.trust_signals.social_proof.join(', ')}`,
    '',
    `ERROR HANDLING:`,
    `Error boundaries: ${request.analysis_results.error_handling.error_boundaries.length}`,
    `Fallbacks: ${request.analysis_results.error_handling.fallbacks.length}`,
    `Silent failures: ${request.analysis_results.error_handling.silent_failures.length}`,
    `Logging: ${request.analysis_results.error_handling.logging_present}`,
    '',
    `ANALYTICS:`,
    `Telemetry: ${request.analysis_results.analytics.telemetry}`,
    `Event tracking files: ${request.analysis_results.analytics.event_tracking.length}`,
    `Data persistence: ${request.analysis_results.analytics.data_persistence}`,
    '',
    `DEPENDENCIES:`,
    `External services: ${request.analysis_results.dependencies.external_services.join(', ')}`,
    `Fallback defined: ${request.analysis_results.dependencies.fallback_defined}`,
  ];

  if (request.prior_audit) {
    parts.push('', '--- PRIOR AUDIT (for comparison) ---');
    parts.push(`Prior composite: ${request.prior_audit.composite}`);
    parts.push(`Prior verdict: ${request.prior_audit.verdict}`);
    parts.push(`Prior scores: ${JSON.stringify(request.prior_audit.scores)}`);
    parts.push(`Open blocking issues: ${request.prior_audit.blocking_issues_open.join(', ')}`);
  }

  parts.push('', 'Score this product across all 10 dimensions. Be rigorous and evidence-based.');
  return parts.join('\n');
}
