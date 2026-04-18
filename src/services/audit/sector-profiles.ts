// =============================================================================
// FOUNDRY — Sector Profile System
// Provides sector-aware scoring overrides, finding filters, and remediation tone.
// =============================================================================

import { query } from '../../db/client.js';
import type { SectorProfile, SectorScoringOverride } from '../../types/index.js';
import type { SectorScoringOverrideRow } from '../../types/database.js';

const VALID_SECTORS: SectorProfile[] = [
  'b2b_saas', 'consumer', 'marketplace', 'healthcare', 'education',
  'government', 'climate_impact', 'developer_tools', 'fintech',
  'deep_tech', 'vertical_saas',
];

/**
 * Get the sector profile for a product.
 */
export async function getSectorProfile(productId: string): Promise<SectorProfile> {
  const result = await query('SELECT sector_profile FROM products WHERE id = ?', [productId]);
  const row = result.rows[0] as Record<string, string> | undefined;
  const sector = row?.sector_profile ?? 'b2b_saas';
  return (VALID_SECTORS.includes(sector as SectorProfile) ? sector : 'b2b_saas') as SectorProfile;
}

/**
 * Get dimension weight/threshold overrides for a given sector.
 */
export async function getScoringOverrides(sector: SectorProfile): Promise<SectorScoringOverride[]> {
  const result = await query('SELECT * FROM sector_scoring_overrides WHERE sector = ?', [sector]);
  return (result.rows as unknown as SectorScoringOverrideRow[]).map((row) => ({
    id: row.id,
    sector: row.sector,
    dimension: row.dimension,
    weight_override: row.weight_override,
    passing_threshold_override: row.passing_threshold_override,
    critical_findings_override: row.critical_findings_override
      ? (JSON.parse(row.critical_findings_override) as string[])
      : null,
    created_at: row.created_at,
    updated_at: row.updated_at,
  }));
}

/**
 * Determine the remediation tone based on sector and founder experience.
 * Non-technical founders in regulated sectors get plain_english tone.
 * First-time founders get encouraging tone.
 */
export function getRemediationTone(
  sector: SectorProfile,
  founderExperience?: 'first_time' | 'experienced' | 'serial'
): 'standard' | 'encouraging' | 'direct' | 'plain_english' {
  // Government and healthcare get plain english for non-technical compliance guidance
  if (sector === 'government' || sector === 'healthcare') return 'plain_english';
  // Education founders often non-technical
  if (sector === 'education') return 'encouraging';
  // First-time founders get encouraging tone
  if (founderExperience === 'first_time') return 'encouraging';
  // Serial founders get direct
  if (founderExperience === 'serial') return 'direct';
  return 'standard';
}

/**
 * Check if an audit finding is relevant for this product's sector.
 * Some findings are meaningless in certain sectors (e.g. "no monthly billing" for education).
 */
export function isFindingRelevant(
  findingCode: string,
  sector: SectorProfile,
  suppressedFindings: string[]
): boolean {
  // Sector-specific suppressions from the override table
  if (suppressedFindings.includes(findingCode)) return false;

  // Hard-coded universal suppressions per sector
  const sectorSuppressions: Partial<Record<SectorProfile, string[]>> = {
    education: ['no_monthly_billing', 'no_credit_card_flow', 'missing_free_trial'],
    government: ['no_monthly_billing', 'no_credit_card_flow', 'missing_free_trial', 'no_self_serve_signup'],
    healthcare: ['missing_free_trial'],
    climate_impact: ['no_monthly_billing'],
  };

  const suppressed = sectorSuppressions[sector] ?? [];
  return !suppressed.includes(findingCode);
}

/**
 * Build effective dimension weights, merging defaults with sector overrides.
 */
export function buildEffectiveWeights(
  defaultWeights: Record<string, number>,
  overrides: SectorScoringOverride[]
): Record<string, number> {
  const effective = { ...defaultWeights };

  for (const override of overrides) {
    if (override.weight_override !== null) {
      // Map dimension like 'd5' to the key format 'd5_operational_readiness'
      const dimKey = Object.keys(effective).find((k) => k.startsWith(override.dimension + '_'));
      if (dimKey) {
        effective[dimKey] = override.weight_override;
      }
    }
  }

  // Normalize weights to sum to 1.0
  const total = Object.values(effective).reduce((sum, w) => sum + w, 0);
  if (total > 0 && Math.abs(total - 1.0) > 0.001) {
    for (const key of Object.keys(effective)) {
      effective[key] = effective[key]! / total;
    }
  }

  return effective;
}

/**
 * Collect all suppressed finding codes for a sector from its overrides.
 */
export function collectSuppressedFindings(overrides: SectorScoringOverride[]): string[] {
  const suppressed: string[] = [];
  for (const override of overrides) {
    if (override.critical_findings_override) {
      suppressed.push(...override.critical_findings_override);
    }
  }
  return suppressed;
}

/**
 * Validate a sector string.
 */
export function isValidSector(sector: string): sector is SectorProfile {
  return VALID_SECTORS.includes(sector as SectorProfile);
}
