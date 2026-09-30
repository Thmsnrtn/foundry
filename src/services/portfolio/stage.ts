// =============================================================================
// FOUNDRY — where each thing the owner owns stands, in one word.
//
// INSTITUTION_MODEL §5.9 (30 September 2026). A company's stage was spread
// over four columns — standing (a test or earned), posture (what the owner
// told Foundry to do with it), status (archived or not) and the lifecycle a
// company reports — and no page said it in a word. `assetStage` says it,
// derived and never stored, so it can never disagree with the columns it
// reads; `stagesOf` reads it for every asset, retired ones included, with the
// lineage a graduation keeps: the test it came from and the day it earned
// its place.
//
// A TEST IS PROVEN ONLY WHEN A REAL BUYER PAID. The same bar Explore uses:
// the one stage a hope cannot reach.
// =============================================================================

import { query, realCompany } from '../../db/client.js';

type Row = Record<string, unknown>;

export type AssetStage = 'testing' | 'proven' | 'operating' | 'growing' | 'harvesting' | 'retired';

export const STAGE_WORDS: Record<AssetStage, string> = {
  testing: 'Testing', proven: 'Proven', operating: 'Operating', growing: 'Growing', harvesting: 'Harvesting', retired: 'Retired',
};

/** Which group a stage is shown under on the Portfolio. */
export const STAGE_GROUP: Record<AssetStage, 'Operating' | 'Testing' | 'Retired'> = {
  testing: 'Testing', proven: 'Testing', operating: 'Operating', growing: 'Operating', harvesting: 'Operating', retired: 'Retired',
};

export interface StageInputs {
  status: string;
  standing: string;
  posture: string;
  lifecycle: string | null;
  /** Payments the world recorded against the test it came from, in cents. */
  paidCents: number;
}

/** THE ONE WORD. Pure: the same columns always give the same word. */
export function assetStage(i: StageInputs): AssetStage {
  if (i.status === 'archived' || i.posture === 'retire') return 'retired';
  if (i.standing === 'experimental') return i.paidCents > 0 ? 'proven' : 'testing';
  if (i.posture === 'harvest') return 'harvesting';
  if (i.posture === 'grow' && (i.lifecycle === 'optimizing' || i.lifecycle === 'scaling')) return 'growing';
  return 'operating';
}

export interface AssetStanding {
  productId: string;
  name: string;
  stage: AssetStage;
  stageWord: string;
  group: 'Operating' | 'Testing' | 'Retired';
  /** Why, in a sentence, from the columns that decided it. */
  because: string;
  /** Where it came from, when a test made it. */
  lineage: { experimentId: string; test: string; earnedAt: string | null } | null;
  retiredBecause: string | null;
}

const REASON: Record<AssetStage, string> = {
  testing: 'It is a test: it has not earned a place yet, and no real buyer has paid.',
  proven: 'A real buyer paid in its test. It is still a test until you give it a place.',
  operating: 'It has earned its place and is running.',
  growing: 'It has earned its place, and you asked me to make it bigger.',
  harvesting: 'You asked me to take the cash and spend nothing on growth.',
  retired: 'It is wound down. Its history stays on the record.',
};

/**
 * EVERY ASSET'S STAGE, retired ones included, with its lineage. Real assets
 * only: an invented company is a rehearsal and has no place in a portfolio.
 */
export async function stagesOf(founderId: string): Promise<AssetStanding[]> {
  const rows = (await query(
    `SELECT p.id, p.name, p.status, p.standing, p.posture, p.company_lifecycle_state, p.retired_because,
            p.from_experiment_id, p.earned_at, e.what_we_do AS test,
            (SELECT COALESCE(SUM(b.amount_cents), 0) FROM business_outcome_events b
               JOIN experiment_exposures x ON x.id = b.exposure_id
              WHERE x.experiment_id = p.from_experiment_id AND b.kind = 'payment' AND b.evidence_mode = 'real') AS paid
       FROM products p LEFT JOIN venture_experiments e ON e.id = p.from_experiment_id
      WHERE p.owner_id = ? AND ${realCompany('p')} AND p.deleted_at IS NULL
      ORDER BY p.name COLLATE NOCASE, p.rowid`, [founderId])).rows as unknown as Row[];
  return rows.map((r) => {
    const stage = assetStage({
      status: String(r.status ?? 'active'), standing: String(r.standing), posture: String(r.posture),
      lifecycle: r.company_lifecycle_state == null ? null : String(r.company_lifecycle_state), paidCents: Number(r.paid ?? 0),
    });
    return {
      productId: String(r.id), name: String(r.name), stage, stageWord: STAGE_WORDS[stage], group: STAGE_GROUP[stage],
      because: REASON[stage],
      lineage: r.from_experiment_id ? { experimentId: String(r.from_experiment_id), test: String(r.test ?? 'a test'),
        earnedAt: r.earned_at == null ? null : String(r.earned_at).slice(0, 10) } : null,
      retiredBecause: r.retired_because == null ? null : String(r.retired_because),
    };
  });
}
