// =============================================================================
// FOUNDRY — Regulatory Intelligence Module
// Compliance tracking, regulatory change scanning, compliance debt scoring.
// =============================================================================

import { query } from '../../db/client.js';
import { callOpus, callSonnet, parseJSONResponse } from '../ai/client.js';
import { nanoid } from 'nanoid';
import type { StressorReportItem } from '../../types/index.js';

export interface RegulatoryExposure {
  jurisdictions: string[];
  classifications: Array<{
    authority: string;
    classification: string;
    status: string;
    cost_estimate: string;
    timeline_months: number;
  }>;
}

export interface ComplianceRequirement {
  requirement: string;
  status: 'met' | 'in_progress' | 'not_started' | 'not_applicable';
  deadline: string | null;
}

/**
 * Classify regulatory exposure based on sector, customer type, and geography.
 */
export async function classifyRegulatoryExposure(productId: string): Promise<RegulatoryExposure> {
  const product = await query(
    'SELECT p.*, f.country_code FROM products p JOIN founders f ON p.owner_id = f.id WHERE p.id = ?',
    [productId]
  );
  const p = product.rows[0] as Record<string, string> | undefined;
  if (!p) return { jurisdictions: [], classifications: [] };

  const prompt = `Classify the regulatory exposure for this SaaS product.

Product: ${p.name}
Sector: ${p.sector_profile ?? 'b2b_saas'}
Market category: ${p.market_category ?? 'general'}
Founder country: ${p.country_code ?? 'US'}

Determine:
1. Which jurisdictions apply (based on sector and likely customer base)
2. What regulatory classifications exist (HIPAA, SOC2, GDPR, PCI-DSS, FedRAMP, etc.)

Return JSON:
{
  "jurisdictions": ["US", "EU"],
  "classifications": [
    {"authority": "HHS", "classification": "HIPAA covered entity", "status": "required", "cost_estimate": "$50K-$100K", "timeline_months": 6}
  ]
}

Only include genuinely relevant regulations for this specific sector. Don't over-classify.`;

  const response = await callOpus(
    'You are a SaaS regulatory analyst. Only flag genuinely applicable regulations.',
    prompt,
    2048
  );

  const result = parseJSONResponse<RegulatoryExposure>(response.content);

  // Persist
  const owner = p.owner_id;
  await query(
    `INSERT INTO regulatory_profile (id, product_id, owner_id, jurisdictions, regulatory_classifications)
     VALUES (?, ?, ?, ?, ?)
     ON CONFLICT (product_id) DO UPDATE SET jurisdictions = excluded.jurisdictions, regulatory_classifications = excluded.regulatory_classifications, updated_at = datetime('now')`,
    [nanoid(), productId, owner, JSON.stringify(result.jurisdictions), JSON.stringify(result.classifications)]
  );

  return result;
}

/**
 * Map compliance requirements for each jurisdiction + classification.
 */
export async function mapComplianceRequirements(productId: string): Promise<ComplianceRequirement[]> {
  const profile = await query('SELECT * FROM regulatory_profile WHERE product_id = ?', [productId]);
  const p = profile.rows[0] as Record<string, unknown> | undefined;
  if (!p?.compliance_requirements) return [];

  return JSON.parse(p.compliance_requirements as string) as ComplianceRequirement[];
}

/**
 * Score how much required compliance is unmet.
 */
export async function assessComplianceDebt(productId: string): Promise<number> {
  const requirements = await mapComplianceRequirements(productId);
  if (requirements.length === 0) return 0;

  const weights = { met: 0, in_progress: 0.3, not_started: 1.0, not_applicable: 0 };
  const totalDebt = requirements.reduce(
    (sum, r) => sum + (weights[r.status] ?? 0),
    0
  );

  const maxDebt = requirements.filter((r) => r.status !== 'not_applicable').length;
  return maxDebt > 0 ? Math.round((totalDebt / maxDebt) * 100) : 0;
}

/**
 * Weekly scan for regulatory changes affecting the product's sector/jurisdictions.
 */
export async function scanRegulatoryChanges(
  productId: string,
  ownerId: string
): Promise<Array<{
  change_type: string;
  jurisdiction: string;
  description: string;
  impact_level: string;
  action_required: string;
}>> {
  const product = await query('SELECT name, sector_profile, market_category FROM products WHERE id = ?', [productId]);
  const p = product.rows[0] as Record<string, string> | undefined;
  if (!p) return [];

  const profile = await query('SELECT jurisdictions FROM regulatory_profile WHERE product_id = ?', [productId]);
  const jurisdictions = profile.rows[0]
    ? JSON.parse((profile.rows[0] as Record<string, string>).jurisdictions)
    : ['US'];

  const prompt = `Identify recent (last 30 days, as of April 2026) regulatory changes affecting:
Sector: ${p.sector_profile ?? 'b2b_saas'}
Market: ${p.market_category ?? 'general'}
Jurisdictions: ${jurisdictions.join(', ')}

Return JSON array:
[{"change_type": "new_regulation|amendment|enforcement_action|guidance|political_shift", "jurisdiction": "US", "description": "...", "impact_level": "low|medium|high|critical", "action_required": "..."}]

Only include real, significant changes. Return empty array if none.`;

  const response = await callSonnet(
    'You are a regulatory intelligence analyst. Only flag real, verified regulatory changes.',
    prompt,
    2048
  );

  const changes = parseJSONResponse<Array<{
    change_type: string;
    jurisdiction: string;
    description: string;
    impact_level: string;
    action_required: string;
  }>>(response.content);

  // Persist
  for (const change of changes) {
    await query(
      `INSERT INTO regulatory_changes (id, product_id, owner_id, change_type, jurisdiction, description, impact_level, action_required, source)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'ai_scan')`,
      [nanoid(), productId, ownerId, change.change_type, change.jurisdiction, change.description, change.impact_level, change.action_required]
    );
  }

  return changes;
}

/**
 * Model compliance pathway: cost, timeline, and alternatives.
 */
export async function modelCompliancePathway(
  productId: string,
  requirement: string
): Promise<{ cost: string; timeline: string; alternatives: string[] }> {
  const product = await query('SELECT name, sector_profile FROM products WHERE id = ?', [productId]);
  const p = product.rows[0] as Record<string, string> | undefined;

  const prompt = `Model the compliance pathway for this requirement.

Product: ${p?.name ?? 'Unknown'} (${p?.sector_profile ?? 'b2b_saas'})
Requirement: ${requirement}

Return JSON: {"cost": "$X-$Y", "timeline": "N months", "alternatives": ["alternative approaches"]}`;

  const response = await callSonnet(
    'You are a compliance pathway advisor. Be practical and cost-conscious.',
    prompt,
    1024
  );

  return parseJSONResponse<{ cost: string; timeline: string; alternatives: string[] }>(response.content);
}

/**
 * Identify regulatory stressors.
 */
export async function identifyRegulatoryStressors(productId: string): Promise<StressorReportItem[]> {
  const items: StressorReportItem[] = [];

  const debtScore = await assessComplianceDebt(productId);
  if (debtScore > 50) {
    items.push({
      name: 'Compliance debt critical',
      signal: `Compliance debt score ${debtScore}/100 — significant unmet compliance requirements`,
      timeframe_days: 60,
      neutralizing_action: 'Prioritize compliance requirements by deadline and business impact. Start with the highest-risk gaps.',
      severity: debtScore > 75 ? 'critical' : 'elevated',
      competitive_correlation: null,
    });
  }

  // Check for recent high-impact regulatory changes
  const changes = await query(
    `SELECT * FROM regulatory_changes WHERE product_id = ? AND status = 'active' AND impact_level IN ('high', 'critical') AND detected_at > datetime('now', '-30 days')`,
    [productId]
  );

  for (const row of changes.rows as unknown as Array<Record<string, string>>) {
    items.push({
      name: `Regulatory change: ${row.jurisdiction}`,
      signal: row.description,
      timeframe_days: 90,
      neutralizing_action: row.action_required,
      severity: row.impact_level === 'critical' ? 'critical' : 'elevated',
      competitive_correlation: null,
    });
  }

  return items;
}
