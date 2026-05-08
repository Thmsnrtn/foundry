// =============================================================================
// FOUNDRY — Architecture Freeze Period Service (V3.1 Layer A)
// Ambros's recursion finding: enforce discipline that blocks expansion-class
// changes for a window so the system can collect operational data.
//
// Principle: freeze blocks expansion of system behavior. Freeze permits
// tightening, corrections, and routine operations.
// =============================================================================

import { nanoid } from 'nanoid';
import { query } from '../../db/client.js';

// ─── Types ────────────────────────────────────────────────────────────────────

export type FreezeScope =
  | 'architecture_class'      // default: schema, crons, integrations, auth-expansion
  | 'all_evolution'           // wider: every evolution change_type except founder_correction
  | 'process_only';           // narrower: just process-introduction blocks

export type FreezeEndedBy = 'founder' | 'expired' | 'override';

export interface FreezePeriod {
  id: string;
  product_id: string;
  scope: FreezeScope;
  reason: string;
  started_at: string;
  expected_end_at: string | null;
  ended_at: string | null;
  ended_by: FreezeEndedBy | null;
  created_at: string;
}

export interface StartFreezeInput {
  scope?: FreezeScope;
  reason: string;
  duration_days?: number;     // default 90
}

// Categories of change the freeze classifies. Used by call sites to ask:
// "is this category blocked right now?"
export type ChangeCategory =
  | 'routine_operation'         // sends, scheduled-cadence runs — never blocked
  | 'tightening'                // golden_lesson, constraint_added, restriction-direction authority change
  | 'correction'                // founder_correction; never blocked
  | 'authority_expansion'       // 2→1, 1→0
  | 'prompt_refinement'         // standalone prompt edit not driven by correction
  | 'agent_provision'           // initial_provision of a new agent
  | 'schema_change'             // new tables, new columns, new indexes
  | 'cron_addition'             // new scheduled job
  | 'integration_addition'      // new external integration
  | 'architecture_decision';    // any decision flagged architecture_class = 1

// ─── Mappers ──────────────────────────────────────────────────────────────────

function rowToFreezePeriod(r: Record<string, unknown>): FreezePeriod {
  return {
    id: r.id as string,
    product_id: r.product_id as string,
    scope: (r.scope as FreezeScope) ?? 'architecture_class',
    reason: r.reason as string,
    started_at: r.started_at as string,
    expected_end_at: (r.expected_end_at as string | null) ?? null,
    ended_at: (r.ended_at as string | null) ?? null,
    ended_by: (r.ended_by as FreezeEndedBy | null) ?? null,
    created_at: r.created_at as string,
  };
}

// ─── Reads ────────────────────────────────────────────────────────────────────

export async function getActiveFreeze(productId: string): Promise<FreezePeriod | null> {
  const result = await query(
    `SELECT * FROM freeze_periods
     WHERE product_id = ? AND ended_at IS NULL
     ORDER BY started_at DESC LIMIT 1`,
    [productId]
  );
  if (result.rows.length === 0) return null;
  return rowToFreezePeriod(result.rows[0] as Record<string, unknown>);
}

export async function listFreezeHistory(
  productId: string,
  limit: number = 20
): Promise<FreezePeriod[]> {
  const result = await query(
    `SELECT * FROM freeze_periods
     WHERE product_id = ?
     ORDER BY started_at DESC, ROWID DESC
     LIMIT ?`,
    [productId, limit]
  );
  return (result.rows as Record<string, unknown>[]).map(rowToFreezePeriod);
}

// ─── Writes ───────────────────────────────────────────────────────────────────

export async function startFreeze(
  productId: string,
  input: StartFreezeInput
): Promise<FreezePeriod> {
  // Refuse to start a new freeze if one is already active
  const existing = await getActiveFreeze(productId);
  if (existing) {
    throw new Error(
      `freeze already active for product ${productId} (id=${existing.id}); ` +
      `end the active freeze before starting a new one`
    );
  }

  const id = nanoid();
  const scope = input.scope ?? 'architecture_class';
  const durationDays = input.duration_days ?? 90;
  const expectedEndAt = `datetime('now', '+${durationDays} days')`;

  await query(
    `INSERT INTO freeze_periods (id, product_id, scope, reason, expected_end_at)
     VALUES (?, ?, ?, ?, ${expectedEndAt})`,
    [id, productId, scope, input.reason]
  );

  const created = await query(
    `SELECT * FROM freeze_periods WHERE id = ?`,
    [id]
  );
  return rowToFreezePeriod(created.rows[0] as Record<string, unknown>);
}

export async function endFreeze(
  freezeId: string,
  endedBy: FreezeEndedBy
): Promise<void> {
  await query(
    `UPDATE freeze_periods
     SET ended_at = datetime('now'), ended_by = ?
     WHERE id = ? AND ended_at IS NULL`,
    [endedBy, freezeId]
  );
}

export async function endActiveFreeze(
  productId: string,
  endedBy: FreezeEndedBy
): Promise<boolean> {
  const active = await getActiveFreeze(productId);
  if (!active) return false;
  await endFreeze(active.id, endedBy);
  return true;
}

// ─── Predicates: is this change category blocked right now? ───────────────────

/**
 * Decides whether a given change category is blocked by an active freeze.
 *
 * Categories ALWAYS allowed (regardless of scope):
 *   routine_operation, tightening, correction
 *
 * Categories blocked by 'architecture_class' scope:
 *   schema_change, cron_addition, integration_addition, agent_provision,
 *   architecture_decision, authority_expansion, prompt_refinement
 *
 * 'all_evolution' adds: nothing more — already covered above.
 * 'process_only' is narrower — only blocks cron_addition and integration_addition.
 */
export async function isBlocked(
  productId: string,
  category: ChangeCategory
): Promise<{ blocked: boolean; freeze: FreezePeriod | null }> {
  const freeze = await getActiveFreeze(productId);
  if (!freeze) return { blocked: false, freeze: null };

  const alwaysAllowed: ChangeCategory[] = [
    'routine_operation',
    'tightening',
    'correction',
  ];
  if (alwaysAllowed.includes(category)) {
    return { blocked: false, freeze };
  }

  const archBlocked: ChangeCategory[] = [
    'schema_change',
    'cron_addition',
    'integration_addition',
    'agent_provision',
    'architecture_decision',
    'authority_expansion',
    'prompt_refinement',
  ];

  if (freeze.scope === 'architecture_class' || freeze.scope === 'all_evolution') {
    return { blocked: archBlocked.includes(category), freeze };
  }

  if (freeze.scope === 'process_only') {
    const processBlocked: ChangeCategory[] = ['cron_addition', 'integration_addition'];
    return { blocked: processBlocked.includes(category), freeze };
  }

  return { blocked: false, freeze };
}

/**
 * Specialized helper for SCP evolution: maps the existing change_type CHECK
 * values to a ChangeCategory and asks if blocked.
 *
 * change_type values from migration 017_scp_foundation.sql:
 *   'golden_lesson' | 'constraint_added' | 'authority_change' |
 *   'prompt_refinement' | 'founder_correction' | 'initial_provision'
 *
 * authorityDirection: 'expansion' if going 2→1 or 1→0, 'restriction' otherwise.
 * Pass null/undefined when not an authority_change.
 */
export async function isEvolutionBlocked(
  productId: string,
  changeType: string,
  options?: {
    authorityDirection?: 'expansion' | 'restriction';
    correctionLinked?: boolean;        // is this prompt_refinement linked to a correction?
  }
): Promise<{ blocked: boolean; freeze: FreezePeriod | null; mappedTo: ChangeCategory }> {
  const direction = options?.authorityDirection;
  const correctionLinked = options?.correctionLinked ?? false;

  let category: ChangeCategory;
  switch (changeType) {
    case 'golden_lesson':
    case 'constraint_added':
      category = 'tightening';
      break;
    case 'founder_correction':
      category = 'correction';
      break;
    case 'authority_change':
      category = direction === 'expansion' ? 'authority_expansion' : 'tightening';
      break;
    case 'prompt_refinement':
      category = correctionLinked ? 'correction' : 'prompt_refinement';
      break;
    case 'initial_provision':
      category = 'agent_provision';
      break;
    default:
      // Unknown change_type — conservative fallback: treat as architecture
      category = 'architecture_decision';
  }

  const { blocked, freeze } = await isBlocked(productId, category);
  return { blocked, freeze, mappedTo: category };
}
