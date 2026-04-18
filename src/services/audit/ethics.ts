// =============================================================================
// FOUNDRY — Ethical AI Assessment
// Evaluates products for demographic fairness, consent, safety, social license.
// =============================================================================

import { query } from '../../db/client.js';
import { callOpus, parseJSONResponse } from '../ai/client.js';
import { nanoid } from 'nanoid';

export interface EthicalAssessment {
  has_ai_components: boolean;
  demographic_fairness_score: number;
  consent_adequacy_score: number;
  minor_user_risk: 'none' | 'possible' | 'confirmed';
  claims_substantiation_score: number;
  surveillance_proportionality_score: number;
  crisis_safety_score: number;
  social_license_risk: 'low' | 'medium' | 'high';
  overall_ethics_score: number;
  findings: EthicsFinding[];
}

interface EthicsFinding {
  dimension: string;
  severity: 'critical' | 'major' | 'minor' | 'informational';
  finding: string;
  remediation: string;
}

/**
 * Comprehensive ethical evaluation using Claude Opus.
 */
export async function assessEthicalDimensions(productId: string): Promise<EthicalAssessment> {
  const product = await query(
    'SELECT p.*, f.country_code FROM products p JOIN founders f ON p.owner_id = f.id WHERE p.id = ?',
    [productId]
  );
  const p = product.rows[0] as Record<string, string> | undefined;
  if (!p) {
    return defaultAssessment();
  }

  // Get product DNA for context
  const dna = await query('SELECT * FROM product_dna WHERE product_id = ?', [productId]);
  const dnaRow = dna.rows[0] as Record<string, string> | undefined;

  const prompt = `Conduct an ethical assessment of this SaaS product.

Product: ${p.name}
Sector: ${p.sector_profile ?? 'b2b_saas'}
Market: ${p.market_category ?? 'general'}
ICP: ${dnaRow?.icp_description ?? 'unknown'}
Value prop: ${dnaRow?.positioning_statement ?? 'unknown'}
Stack: ${p.stack_description ?? 'unknown'}

Evaluate these dimensions (0-100 each):

1. **Demographic fairness**: Does the product work equally across populations?
2. **Consent adequacy**: Is data collection transparent and consensual?
3. **Minor user risk**: Could minors use this product? (none/possible/confirmed)
4. **Claims substantiation**: Are marketing claims backed by evidence?
5. **Surveillance proportionality**: Is data collection proportionate to value delivered?
6. **Crisis safety**: For health/safety-adjacent products, are safeguards adequate?
7. **Social license risk**: Is this product category facing public trust challenges? (low/medium/high)

Also determine:
- has_ai_components: boolean
- overall_ethics_score: weighted composite 0-100
- findings: array of {dimension, severity, finding, remediation}

Return JSON:
{
  "has_ai_components": boolean,
  "demographic_fairness_score": 0-100,
  "consent_adequacy_score": 0-100,
  "minor_user_risk": "none|possible|confirmed",
  "claims_substantiation_score": 0-100,
  "surveillance_proportionality_score": 0-100,
  "crisis_safety_score": 0-100,
  "social_license_risk": "low|medium|high",
  "overall_ethics_score": 0-100,
  "findings": [{"dimension": "...", "severity": "...", "finding": "...", "remediation": "..."}]
}

Be rigorous but fair. Most B2B SaaS products will score well. Only flag genuine concerns.`;

  const response = await callOpus(
    'You are an AI ethics evaluator for SaaS products. Be rigorous but proportionate.',
    prompt,
    4096
  );

  const assessment = parseJSONResponse<EthicalAssessment>(response.content);

  // Persist
  const ownerId = p.owner_id;
  await query(
    `INSERT INTO ethical_assessment (id, product_id, owner_id, has_ai_components, demographic_fairness_score, consent_adequacy_score, minor_user_risk, claims_substantiation_score, surveillance_proportionality_score, crisis_safety_score, social_license_risk, overall_ethics_score, findings)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      nanoid(), productId, ownerId,
      assessment.has_ai_components ? 1 : 0,
      assessment.demographic_fairness_score,
      assessment.consent_adequacy_score,
      assessment.minor_user_risk,
      assessment.claims_substantiation_score,
      assessment.surveillance_proportionality_score,
      assessment.crisis_safety_score,
      assessment.social_license_risk,
      assessment.overall_ethics_score,
      JSON.stringify(assessment.findings),
    ]
  );

  return assessment;
}

/**
 * Generate ethics-specific remediations for a finding.
 */
export async function getEthicsRemediationPlan(
  productId: string,
  finding: EthicsFinding
): Promise<{ steps: string[]; priority: string; estimated_effort: string }> {
  const product = await query('SELECT name, sector_profile FROM products WHERE id = ?', [productId]);
  const p = product.rows[0] as Record<string, string> | undefined;

  const prompt = `Create a remediation plan for this ethics finding.

Product: ${p?.name ?? 'Unknown'} (${p?.sector_profile ?? 'b2b_saas'})
Finding: [${finding.severity}] ${finding.dimension}: ${finding.finding}

Return JSON: {"steps": ["specific step 1", "step 2"], "priority": "immediate|soon|planned", "estimated_effort": "hours/days/weeks"}`;

  const response = await callOpus(
    'You are an ethics remediation advisor. Be specific and practical.',
    prompt,
    1024
  );

  return parseJSONResponse<{ steps: string[]; priority: string; estimated_effort: string }>(response.content);
}

/**
 * Get the latest ethics assessment for a product.
 */
export async function getLatestEthicsAssessment(productId: string): Promise<EthicalAssessment | null> {
  const result = await query(
    'SELECT * FROM ethical_assessment WHERE product_id = ? ORDER BY assessed_at DESC LIMIT 1',
    [productId]
  );
  const row = result.rows[0] as Record<string, unknown> | undefined;
  if (!row) return null;

  return {
    has_ai_components: (row.has_ai_components as number) === 1,
    demographic_fairness_score: (row.demographic_fairness_score as number) ?? 0,
    consent_adequacy_score: (row.consent_adequacy_score as number) ?? 0,
    minor_user_risk: (row.minor_user_risk as 'none' | 'possible' | 'confirmed') ?? 'none',
    claims_substantiation_score: (row.claims_substantiation_score as number) ?? 0,
    surveillance_proportionality_score: (row.surveillance_proportionality_score as number) ?? 0,
    crisis_safety_score: (row.crisis_safety_score as number) ?? 0,
    social_license_risk: (row.social_license_risk as 'low' | 'medium' | 'high') ?? 'low',
    overall_ethics_score: (row.overall_ethics_score as number) ?? 0,
    findings: row.findings ? JSON.parse(row.findings as string) : [],
  };
}

function defaultAssessment(): EthicalAssessment {
  return {
    has_ai_components: false,
    demographic_fairness_score: 0,
    consent_adequacy_score: 0,
    minor_user_risk: 'none',
    claims_substantiation_score: 0,
    surveillance_proportionality_score: 0,
    crisis_safety_score: 0,
    social_license_risk: 'low',
    overall_ethics_score: 0,
    findings: [],
  };
}
