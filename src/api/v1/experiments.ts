// =============================================================================
// FOUNDRY REST API v1 — Experiments
// =============================================================================

import { Hono } from 'hono';
import { nanoid } from 'nanoid';
import { query } from '../../db/client.js';
import { requireScope } from '../middleware/auth.js';
import type { ApiAuthEnv } from '../middleware/auth.js';

export const experimentsApi = new Hono<ApiAuthEnv>();

// GET / — list experiments
experimentsApi.get('/', requireScope('agents:read'), async (c) => {
  const productId = c.get('productId');
  const limit = Math.min(Number(c.req.query('limit') ?? 50), 200);
  const offset = Number(c.req.query('offset') ?? 0);

  try {
    const result = await query(
      `SELECT id, name, hypothesis, status, success_metric, success_threshold,
              results_json, started_at, concluded_at, created_at
       FROM experiments
       WHERE product_id = ?
       ORDER BY created_at DESC
       LIMIT ? OFFSET ?`,
      [productId, limit, offset]
    );

    const countResult = await query(
      `SELECT COUNT(*) as total FROM experiments WHERE product_id = ?`,
      [productId]
    );
    const total = (countResult.rows[0] as Record<string, unknown>)?.total as number ?? 0;

    return c.json({ data: result.rows, meta: { total, limit, offset } });
  } catch (err) {
    return c.json({ error: 'Failed to fetch experiments' }, 500);
  }
});

// GET /:experimentId — full experiment detail
experimentsApi.get('/:experimentId', requireScope('agents:read'), async (c) => {
  const productId = c.get('productId');
  const experimentId = c.req.param('experimentId');

  try {
    const result = await query(
      `SELECT * FROM experiments WHERE id = ? AND product_id = ?`,
      [experimentId, productId]
    );
    if (result.rows.length === 0) {
      return c.json({ error: 'Experiment not found' }, 404);
    }

    const exp = result.rows[0] as Record<string, unknown>;

    // Fetch variants
    const variantsResult = await query(
      `SELECT id, name, description, traffic_pct, results_json, created_at
       FROM experiment_variants
       WHERE experiment_id = ?
       ORDER BY created_at ASC`,
      [experimentId]
    );

    return c.json({
      data: {
        ...exp,
        variants: variantsResult.rows,
      },
    });
  } catch (err) {
    return c.json({ error: 'Failed to fetch experiment' }, 500);
  }
});

// POST / — create new experiment
experimentsApi.post('/', requireScope('experiments:write'), async (c) => {
  const productId = c.get('productId');
  const userId = c.get('userId');

  let body: Record<string, unknown>;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: 'Invalid JSON body' }, 400);
  }

  const { title, hypothesis, success_metric, success_threshold, variants } = body;

  if (!title || !hypothesis) {
    return c.json({ error: 'title and hypothesis are required' }, 400);
  }

  try {
    const id = nanoid();
    // experiments requires a hypothesis FK + A/B descriptions (all NOT NULL).
    // Create the hypothesis from the supplied text, then a minimal single-change
    // experiment. `name` (not title) and `designed_by` (not created_by) are the
    // real columns; status must satisfy the CHECK ('designed').
    const hypothesisId = nanoid();
    await query(
      `INSERT INTO hypotheses (id, product_id, proposed_by, statement) VALUES (?, ?, 'api', ?)`,
      [hypothesisId, productId, hypothesis]
    );
    await query(
      `INSERT INTO experiments
         (id, product_id, hypothesis_id, name, hypothesis, type, control_description,
          treatment_description, success_metric, success_threshold, status, designed_by)
       VALUES (?, ?, ?, ?, ?, 'ab_test', 'Control (no change)', ?, ?, ?, 'designed', ?)`,
      [id, productId, hypothesisId, title, hypothesis, hypothesis,
       success_metric ?? 'primary_metric', success_threshold ?? null, userId]
    );

    // Insert variants if provided
    if (Array.isArray(variants) && variants.length > 0) {
      for (const variant of variants as Array<Record<string, unknown>>) {
        await query(
          `INSERT INTO experiment_variants (id, experiment_id, name, description, traffic_pct)
           VALUES (?, ?, ?, ?, ?)`,
          [nanoid(), id, variant.name ?? 'Variant', variant.description ?? null, variant.traffic_pct ?? null]
        );
      }
    }

    const result = await query(`SELECT * FROM experiments WHERE id = ?`, [id]);
    return c.json({ data: result.rows[0] }, 201);
  } catch (err) {
    return c.json({ error: 'Failed to create experiment' }, 500);
  }
});

// PUT /:experimentId/results — update current results
experimentsApi.put('/:experimentId/results', requireScope('experiments:write'), async (c) => {
  const productId = c.get('productId');
  const experimentId = c.req.param('experimentId');

  let body: Record<string, unknown>;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: 'Invalid JSON body' }, 400);
  }

  try {
    const check = await query(
      `SELECT id, status, success_threshold FROM experiments WHERE id = ? AND product_id = ?`,
      [experimentId, productId]
    );
    if (check.rows.length === 0) {
      return c.json({ error: 'Experiment not found' }, 404);
    }

    // Interim results are stored in results_json; the status transition to a
    // terminal state happens only at /conclude (the status CHECK has no
    // "winning" value, and an experiment receiving results is still running).
    await query(
      `UPDATE experiments
       SET results_json = ?, updated_at = CURRENT_TIMESTAMP
       WHERE id = ? AND product_id = ?`,
      [JSON.stringify(body), experimentId, productId]
    );

    const result = await query(`SELECT * FROM experiments WHERE id = ?`, [experimentId]);
    return c.json({ data: result.rows[0] });
  } catch (err) {
    return c.json({ error: 'Failed to update results' }, 500);
  }
});

// POST /:experimentId/conclude — mark as concluded
experimentsApi.post('/:experimentId/conclude', requireScope('experiments:write'), async (c) => {
  const productId = c.get('productId');
  const experimentId = c.req.param('experimentId');

  let body: Record<string, unknown> = {};
  try {
    body = await c.req.json().catch(() => ({}));
  } catch {
    // optional body
  }

  try {
    const check = await query(
      `SELECT id FROM experiments WHERE id = ? AND product_id = ?`,
      [experimentId, productId]
    );
    if (check.rows.length === 0) {
      return c.json({ error: 'Experiment not found' }, 404);
    }

    const { outcome, winning_variant_id, winner } = body;

    // THE DOCUMENTED DOOR COULD NOT SAY THE ONE THING THE INSTITUTION READS.
    //
    // Concluding through this endpoint wrote `outcome` and
    // `winning_variant_id` and left `winner` NULL — and every institutional
    // reader (the board packet, the investor update, the accuracy tracker,
    // `WHERE winner = 'treatment'`) reads `winner`. A company that concluded an
    // experiment the documented way was invisible to every surface that reports
    // experiments.
    //
    // The mapping cannot be inferred: `experiment_variants` carries no
    // control/treatment marker, so `winning_variant_id` cannot be turned into
    // the shared vocabulary without inventing a convention — and inventing one
    // on a documented contract is a product decision, not a repair. What CAN be
    // done is let the caller state it, in the vocabulary the column already
    // has. A value outside it is refused rather than stored and dropped by the
    // CHECK later.
    const WINNER_VALUES = ['control', 'treatment', 'inconclusive'];
    if (winner !== undefined && winner !== null
        && !WINNER_VALUES.includes(String(winner))) {
      return c.json({
        error: `winner must be one of ${WINNER_VALUES.join(', ')}`,
      }, 400);
    }

    await query(
      `UPDATE experiments
       SET status = 'completed', outcome = ?, winning_variant_id = ?,
           winner = COALESCE(?, winner),
           concluded_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP
       WHERE id = ? AND product_id = ?`,
      [outcome ?? null, winning_variant_id ?? null,
       winner == null ? null : String(winner), experimentId, productId]
    );

    const result = await query(`SELECT * FROM experiments WHERE id = ?`, [experimentId]);
    return c.json({ data: result.rows[0] });
  } catch (err) {
    return c.json({ error: 'Failed to conclude experiment' }, 500);
  }
});
