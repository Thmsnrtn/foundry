import { query } from '../../db/client.js';

/** Derived instrumentation only. These counts describe current institutional
 * state and explicit owner decisions; they do not measure attention saved. */
export interface FounderAttentionBaseline {
  totalResponsibilities: number;
  unresolvedResponsibilities: number;
  requiringOwnerAuthority: number;
  reconstructionRequired: number;
  explicitOwnerInterventions: number;
  reopenedDeliberateNonActions: number;
  exceptionOwnedResponsibilities: number;
}

export async function getFounderAttentionBaseline(
  productId: string,
  since: Date = new Date(Date.now() - 30 * 86_400_000),
): Promise<FounderAttentionBaseline> {
  const state = await query(
    `SELECT
       COUNT(*) AS total,
       SUM(CASE WHEN disposition='active' AND state NOT IN ('mature','exception_owned') THEN 1 ELSE 0 END) AS unresolved,
       SUM(CASE WHEN disposition='active' AND state='shadowing' THEN 1 ELSE 0 END) AS needs_authority,
       SUM(CASE WHEN disposition='active' AND state IN ('unknown','visible','understood') THEN 1 ELSE 0 END) AS reconstruction,
       SUM(CASE WHEN state='exception_owned' THEN 1 ELSE 0 END) AS exception_owned
     FROM institutional_responsibilities WHERE product_id=?`,
    [productId],
  );
  const decisions = await query(
    `SELECT
       COUNT(*) AS interventions,
       SUM(CASE WHEN d.disposition='active' AND EXISTS (
         SELECT 1 FROM responsibility_dispositions prior
          WHERE prior.responsibility_id=d.responsibility_id
            AND prior.disposition='deliberately_not_done'
            AND (prior.created_at<d.created_at OR (prior.created_at=d.created_at AND prior.rowid<d.rowid))
       ) THEN 1 ELSE 0 END) AS reopened
     FROM responsibility_dispositions d
     WHERE d.product_id=? AND d.created_at>=?`,
    [productId, since.toISOString()],
  );
  const s = state.rows[0] as Record<string, unknown>;
  const d = decisions.rows[0] as Record<string, unknown>;
  return {
    totalResponsibilities: Number(s.total ?? 0),
    unresolvedResponsibilities: Number(s.unresolved ?? 0),
    requiringOwnerAuthority: Number(s.needs_authority ?? 0),
    reconstructionRequired: Number(s.reconstruction ?? 0),
    explicitOwnerInterventions: Number(d.interventions ?? 0),
    reopenedDeliberateNonActions: Number(d.reopened ?? 0),
    exceptionOwnedResponsibilities: Number(s.exception_owned ?? 0),
  };
}
