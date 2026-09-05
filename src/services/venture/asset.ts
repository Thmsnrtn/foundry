// =============================================================================
// FOUNDRY — an economic asset exists before revenue, and is not a company for it
//
// THE TIMING CONFLICT THIS RESOLVES. A stranger cannot pay for something that
// has no identity to act as, nowhere for an offer to live, no provider
// references and no budget. Before this module the only object that could
// hold any of those was a company, and creating a company for an idea is the
// confusion the venture mandate exists to prevent: idea = company. Refusing the
// object any existence until revenue would have left the first payment with
// nothing to be paid TO.
//
// So an approved experiment gets an EXPERIMENTAL asset: a `products` row with
// `standing = 'experimental'`, carrying lineage, form, a business identity and
// the allowance the owner approved with the test. It is structurally not an
// operating company — the canonical predicate excludes it, and the database
// refuses agent provisioning, ordinary model spend, situations, concentrations,
// responsibilities and standing delegations for it (migration 276).
//
// REALITY EARNS IT. The move to `earned` requires a prediction resolution
// settled by a business outcome, or the owner saying in words why he is
// calling it real without the world having done so — which the record keeps
// as HIS judgment, never as the world's. EARNED means only that: real economic
// evidence earned recognition that the object is real. Not validated, not
// profitable, not durable, not worth keeping, not authorised for anything.
//
// AND IT DOES NOT SURVIVE A FAILED TEST BY DEFAULT. A valid contradiction with
// no narrowed rerun approved within the grace period the origination policy
// names archives the row, with the reason on it. Lineage is preserved either
// way: an archived asset still knows the sentence somebody wrote that started
// all of this.
// =============================================================================

import { nanoid } from 'nanoid';
import { query } from '../../db/client.js';

export interface ExperimentalAsset {
  id: string; name: string; form: string | null; reality: 'real' | 'reference';
  standing: 'experimental' | 'earned'; experimentId: string; opportunityId: string | null;
  /** Where the test stands, in the owner's words. */
  testStanding: string;
  createdAt: string;
}

/**
 * GIVE AN APPROVED TEST SOMETHING TO BE.
 *
 * Idempotent on the experiment: a double-tapped approval, or a page reload
 * after one, is the same test and gets the same asset. Called from the
 * experiment decision, never from a page, so an asset cannot exist for a test
 * nobody approved — and the database checks the approval again regardless.
 */
export async function beginExperimentalAsset(input: {
  experimentId: string; by: string;
}): Promise<{ productId: string; created: boolean } | { refused: string }> {
  const e = (await query(
    `SELECT e.id, e.founder_id, e.opportunity_id, e.decision, e.decided_by, e.evidence_mode,
            e.cost_cents, e.what_we_do,
            o.headline, o.lighter_architecture
       FROM venture_experiments e
       JOIN venture_opportunities o ON o.id = e.opportunity_id
      WHERE e.id = ?`, [input.experimentId]))
    .rows[0] as Record<string, unknown> | undefined;
  if (!e) return { refused: 'no such experiment' };
  if (String(e.decision) !== 'approved') return { refused: 'the experiment is not approved' };

  const existing = (await query(
    `SELECT id FROM products WHERE from_experiment_id = ? AND deleted_at IS NULL`,
    [input.experimentId])).rows[0] as Record<string, unknown> | undefined;
  if (existing) return { productId: String(existing.id), created: false };

  const founderId = String(e.founder_id);
  const reference = String(e.evidence_mode) === 'reference';
  const id = nanoid();
  // THE NAME IS THE CANDIDATE'S HEADLINE, bounded the way the company form
  // bounds a name. It is a working title for a test object, not a brand.
  const name = String(e.headline).trim().slice(0, 60) || 'an experiment';
  await query(
    `INSERT INTO products
       (id, name, owner_id, status, reality, standing, operating_boundary,
        from_opportunity_id, from_experiment_id, form)
     VALUES (?,?,?,'active',?,'experimental','asset_only',?,?,?)`,
    [id, name, founderId, reference ? 'reference' : 'real',
      String(e.opportunity_id), input.experimentId,
      e.lighter_architecture == null ? null : String(e.lighter_architecture)]);

  // A NAME OF ITS OWN, FROM ITS FIRST DAY — the same rule a company gets at
  // birth. An offer placed under the owner's personal identity is an asset
  // that can never be separated from him.
  const { nameAnActor } = await import('../institution/acting.js');
  await nameAnActor({ founderId, productId: id, kind: 'asset', displayName: name });

  // THE BUDGET HE APPROVED WITH THE TEST IS THE ASSET'S ALLOWANCE. The
  // allowance is what the spend door and the money meter already read, so
  // "spend no more than $25 proving anything" becomes arithmetic at the door
  // rather than a sentence on a card. A test approved at $0 gets no allowance
  // and therefore no spend, which is what $0 means.
  const cost = Number(e.cost_cents ?? 0);
  if (cost > 0) {
    await query(
      `INSERT INTO owner_allowances (id, product_id, purpose, statement, amount_cents)
       VALUES (?,?,?,?,?)`,
      [nanoid(), id, `testing: ${String(e.what_we_do).slice(0, 120)}`,
        `${String(e.decided_by)} approved this test at $${(cost / 100).toFixed(2)}`, cost]);
  }
  return { productId: id, created: true };
}

/**
 * REALITY EARNED IT, OR THE OWNER SAYS SO IN WORDS.
 *
 * The database refuses the transition without a business-outcome resolution
 * unless `by` names the owner, and refuses it without a reason either way. An
 * override is recorded as what it is: his judgment about an unearned object.
 * Nothing here rewrites the resolution record.
 */
export async function earnAsset(input: {
  productId: string; by: string; because: string;
}): Promise<{ earned: boolean; because: string }> {
  const row = (await query(
    `SELECT standing, from_experiment_id, from_opportunity_id FROM products WHERE id = ?`,
    [input.productId])).rows[0] as Record<string, unknown> | undefined;
  if (!row) return { earned: false, because: 'no such asset' };
  if (String(row.standing) === 'earned') return { earned: true, because: 'already earned' };
  try {
    await query(
      `UPDATE products
          SET standing = 'earned', earned_at = datetime('now'), earned_by = ?,
              earned_because = ?
        WHERE id = ? AND standing = 'experimental'`,
      [input.by, input.because.trim(), input.productId]);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (message.includes('reality_has_not_earned_it')) {
      return { earned: false,
        because: 'no business outcome has settled its test, and only reality or the '
          + 'owner in his own words can call it real' };
    }
    throw err;
  }
  // THE CANDIDATE ADVANCED AND THE SEARCH FOUND SOMETHING. Recorded on the
  // objects that asked the question, so the mandate can say what it became.
  if (row.from_opportunity_id != null) {
    await query(
      `UPDATE venture_opportunities
          SET verdict = 'advanced', verdict_why = ?, decided_at = datetime('now')
        WHERE id = ? AND verdict IS NULL`,
      [`${input.by}: ${input.because.trim()}`, String(row.from_opportunity_id)]);
    await query(
      `UPDATE venture_mandates SET became_product = ?
        WHERE became_product IS NULL
          AND id = (SELECT mandate_id FROM venture_opportunities WHERE id = ?)`,
      [input.productId, String(row.from_opportunity_id)]);
  }
  return { earned: true, because: input.because.trim() };
}

/**
 * A FAILED TEST DOES NOT KEEP ITS OBJECT ALIVE BY DEFAULT. Archived, with the
 * reason on the row; lineage stays. An earned asset is never retired here —
 * that is a posture decision and the owner's.
 */
export async function retireExperimentalAsset(input: {
  productId: string; because: string;
}): Promise<boolean> {
  const r = await query(
    `UPDATE products SET status = 'archived', retired_because = ?, updated_at = datetime('now')
      WHERE id = ? AND standing = 'experimental' AND status = 'active'`,
    [input.because.trim(), input.productId]);
  return (r.rowsAffected ?? 0) > 0;
}

/** The experimental frontier, for the places that show it as itself. */
export async function experimentalAssetsFor(
  founderId: string, world: 'real' | 'reference' = 'real',
): Promise<ExperimentalAsset[]> {
  const rows = (await query(
    `SELECT p.id, p.name, p.form, p.reality, p.standing, p.from_experiment_id,
            p.from_opportunity_id, p.created_at,
            e.decision, e.ran_at, e.verdict, e.due_at
       FROM products p
       JOIN venture_experiments e ON e.id = p.from_experiment_id
      WHERE p.owner_id = ? AND p.status = 'active' AND p.deleted_at IS NULL
        AND p.standing = 'experimental' AND p.reality = ?
      ORDER BY p.created_at, p.rowid`, [founderId, world]))
    .rows as unknown as Array<Record<string, unknown>>;
  return rows.map((r) => ({
    id: String(r.id), name: String(r.name), form: r.form == null ? null : String(r.form),
    reality: String(r.reality) as 'real' | 'reference',
    standing: String(r.standing) as 'experimental' | 'earned',
    experimentId: String(r.from_experiment_id),
    opportunityId: r.from_opportunity_id == null ? null : String(r.from_opportunity_id),
    testStanding: testStanding(r), createdAt: String(r.created_at).slice(0, 10),
  }));
}

function testStanding(e: Record<string, unknown>): string {
  if (e.ran_at == null) {
    return e.due_at == null ? 'test approved, not yet run'
      : `test approved; owes an answer by ${String(e.due_at).slice(0, 10)}`;
  }
  return String(e.verdict) === 'as_predicted' ? 'the test came back as predicted'
    : 'the test came back against the thesis';
}
