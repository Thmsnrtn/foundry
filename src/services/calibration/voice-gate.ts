// =============================================================================
// FOUNDRY — Voice Gate (V3.1 Layer B)
// Decides whether a draft artifact's content passes the active product
// voice fingerprint. Single concern: classify artifacts as voice-bearing,
// score them against the fingerprint, return a clear pass/warn/block verdict
// callers can act on.
//
// Designed as a standalone module — callers (action_drafts pipeline,
// outbound executor, manual review tools) opt in by calling voiceGateDraft.
// No global side effects. No wire-in until a caller integrates it.
// =============================================================================

import {
  scoreArtifactAgainstVoice,
  getActiveFingerprint,
  type VoiceScore,
} from './voice-fingerprint.js';

// ─── Types ────────────────────────────────────────────────────────────────────

/**
 * Artifact types whose content reaches a customer or the public surface.
 * Drafts of these types are what voice-gate scores. Internal artifact types
 * (memos, configs, PRs without copy) are exempt — voice doesn't apply.
 */
export const VOICE_BEARING_ARTIFACT_TYPES = new Set<string>([
  'email_draft',
  'pricing_page_copy',
  'landing_page_copy',
  'churn_rescue_email',
  'customer_survey',
  'onboarding_flow',
  'support_response',
  'announcement',
  'cs_message',
  'blog_draft',
  'social_post',
]);

export type VoiceVerdict =
  | 'pass'              // score >= threshold; ship as-is
  | 'warn'              // score in [threshold-15, threshold); reviewer should glance
  | 'block'             // score < threshold-15; require explicit human override
  | 'exempt'            // not voice-bearing; gate doesn't apply
  | 'no_fingerprint'    // no active fingerprint; gate has no opinion
  // The judge was asked and did not answer — unreachable, or an answer that
  // could not be read. Distinct from 'no_fingerprint', which is a settled state
  // (there is nothing to compare against) rather than a failure. The scorer
  // used to answer an outage with a passing score, so this verdict did not
  // exist and could not: every outage arrived here already wearing a 'pass'.
  | 'unscored';

export interface VoiceGateResult {
  verdict: VoiceVerdict;
  score: number | null;             // null when exempt or no_fingerprint
  threshold: number;
  rationale: string;
  /** Suggested action for the caller: 'ship'|'review'|'rewrite'|'ignore' */
  suggested_action: 'ship' | 'review' | 'rewrite' | 'ignore';
  /** Full breakdown when scored; null otherwise */
  breakdown: VoiceScore['breakdown'] | null;
}

export interface DraftLike {
  artifact_type: string;
  draft_content: string;
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Run the voice gate against a draft artifact for a product.
 *
 * Decision tree:
 *   - artifact_type not voice-bearing       → exempt
 *   - no active fingerprint for product     → no_fingerprint
 *   - score >= threshold                    → pass
 *   - threshold - WARN_BAND <= score < t    → warn
 *   - score < threshold - WARN_BAND         → block
 */
export async function voiceGateDraft(
  productId: string,
  draft: DraftLike,
  options?: { threshold?: number; warnBand?: number }
): Promise<VoiceGateResult> {
  const threshold = options?.threshold ?? 70;
  const warnBand = options?.warnBand ?? 15;

  if (!isVoiceBearing(draft.artifact_type)) {
    return {
      verdict: 'exempt',
      score: null,
      threshold,
      rationale: `artifact_type "${draft.artifact_type}" is not voice-bearing`,
      suggested_action: 'ignore',
      breakdown: null,
    };
  }

  const fp = await getActiveFingerprint(productId);
  if (!fp) {
    return {
      verdict: 'no_fingerprint',
      score: null,
      threshold,
      rationale: `no active voice fingerprint for product ${productId}`,
      suggested_action: 'ignore',
      breakdown: null,
    };
  }

  const result = await scoreArtifactAgainstVoice(productId, draft.draft_content, {
    threshold,
  });
  if (!result) {
    // Defensive: scoreArtifactAgainstVoice returned null despite fingerprint
    // existing. Caller proceeds without opinion.
    return {
      verdict: 'no_fingerprint',
      score: null,
      threshold,
      rationale: 'voice scoring unavailable',
      suggested_action: 'ignore',
      breakdown: null,
    };
  }

  if (result.score === null) {
    // Nothing was measured. The gate withholds the permission it was asked to
    // grant rather than granting it on a judgment that did not happen: a
    // customer-facing draft does not auto-ship because the judge was down.
    return {
      verdict: 'unscored',
      score: null,
      threshold,
      rationale: result.rationale,
      suggested_action: 'review',
      breakdown: null,
    };
  }

  const score = result.score;
  const verdict: VoiceVerdict =
    score >= threshold
      ? 'pass'
      : score >= threshold - warnBand
        ? 'warn'
        : 'block';

  const suggested_action: VoiceGateResult['suggested_action'] =
    verdict === 'pass'
      ? 'ship'
      : verdict === 'warn'
        ? 'review'
        : 'rewrite';

  return {
    verdict,
    score,
    threshold,
    rationale: result.rationale,
    suggested_action,
    breakdown: result.breakdown,
  };
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

export function isVoiceBearing(artifactType: string): boolean {
  return VOICE_BEARING_ARTIFACT_TYPES.has(artifactType);
}
