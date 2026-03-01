// =============================================================================
// FOUNDRY — Audit Comparator
// =============================================================================

import type { AuditScore, BlockingIssue } from '../../types/index.js';
import type { AuditComparison } from '../../types/api.js';

export function compareAudits(current: AuditScore, prior: AuditScore): AuditComparison {
  const dimensionDeltas: Record<string, number> = {};
  for (let i = 1; i <= 10; i++) {
    const key = `d${i}_score` as keyof AuditScore;
    const curr = current[key] as number | null;
    const prev = prior[key] as number | null;
    if (curr !== null && prev !== null) {
      dimensionDeltas[`d${i}`] = curr - prev;
    }
  }

  const compositeD = (current.composite ?? 0) - (prior.composite ?? 0);
  const verdictChange = current.verdict !== prior.verdict
    ? `${prior.verdict} → ${current.verdict}`
    : null;

  const priorBlocking = (prior.blocking_issues ?? []) as BlockingIssue[];
  const currentBlocking = (current.blocking_issues ?? []) as BlockingIssue[];
  const priorIds = new Set(priorBlocking.map((b) => b.id));
  const currentIds = new Set(currentBlocking.map((b) => b.id));

  const resolved = [...priorIds].filter((id) => !currentIds.has(id));
  const stillOpen = [...priorIds].filter((id) => currentIds.has(id));

  return {
    dimension_deltas: dimensionDeltas,
    composite_delta: Math.round(compositeD * 10) / 10,
    verdict_change: verdictChange,
    blocking_resolved: resolved,
    blocking_still_open: stillOpen,
  };
}
