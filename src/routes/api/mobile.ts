// =============================================================================
// FOUNDRY — Mobile API Routes
// iOS app endpoints: /api/dashboard, /api/voice/*, /api/push/*
// Also: /api/threads (conversations), /api/decisions (mobile CRUD)
// =============================================================================

import { Hono } from 'hono';
import type { AuthEnv } from '../../middleware/auth.js';
import { query } from '../../db/client.js';
import { computeSignal } from '../../services/signal.js';
import { generateMorningBriefing, processVoiceTranscript } from '../../services/voice/briefing.js';
import { nanoid } from 'nanoid';

export const mobileRoutes = new Hono<AuthEnv>();

// ─── GET /api/dashboard ───────────────────────────────────────────────────────
// Bundled endpoint: signal + stressors + pending decisions + MRR for iOS app.

mobileRoutes.get('/api/dashboard', async (c) => {
  const founder = c.get('founder');
  const productId = c.req.query('product_id');
  if (!productId) return c.json({ error: 'product_id required' }, 400);

  // Verify access
  const productResult = await query(
    `SELECT id, name, market_category, lifecycle_stage
     FROM products WHERE id = ? AND owner_id = ?`,
    [productId, founder.id],
  );
  if (productResult.rows.length === 0) return c.json({ error: 'Not found' }, 404);
  const product = productResult.rows[0] as Record<string, string>;

  // Signal
  const [signalData, stressorData, decisionData, mrrData] = await Promise.all([
    computeSignal(productId),
    query(
      `SELECT id, stressor_name, signal, severity, neutralizing_action, status
       FROM stressor_history WHERE product_id = ? AND status = 'active'
       ORDER BY CASE severity WHEN 'critical' THEN 0 WHEN 'elevated' THEN 1 ELSE 2 END LIMIT 10`,
      [productId],
    ),
    query(
      `SELECT id, what, category, gate, status, created_at, deadline, decided_at, chosen_option, outcome, options_json, rationale
       FROM decisions WHERE product_id = ? AND decided_at IS NULL
       ORDER BY CASE category WHEN 'urgent' THEN 0 WHEN 'strategic' THEN 1 ELSE 2 END
       LIMIT 10`,
      [productId],
    ),
    query(
      `SELECT total_mrr, new_mrr, churned_mrr, expansion_mrr, contraction_mrr, health_ratio
       FROM mrr_snapshots WHERE product_id = ?
       ORDER BY snapshot_date DESC LIMIT 1`,
      [productId],
    ),
  ]);

  type StressorRow = { id: string; stressor_name: string; signal: string; severity: string; neutralizing_action: string; status: string };
  type DecisionRow = { id: string; what: string; category: string; gate: number; status: string; created_at: string; deadline: string | null; decided_at: string | null; chosen_option: string | null; outcome: string | null; options_json: string | null; rationale: string | null };
  type MrrRow = { total_mrr: number; new_mrr: number; churned_mrr: number; expansion_mrr: number; contraction_mrr: number; health_ratio: number | null };

  const stressors = (stressorData.rows as unknown as StressorRow[]).map((s) => ({
    id: s.id,
    stressor_name: s.stressor_name,
    signal: s.signal,
    severity: s.severity,
    neutralizing_action: s.neutralizing_action,
    status: s.status,
  }));

  const decisions = (decisionData.rows as unknown as DecisionRow[]).map((d) => ({
    id: d.id,
    product_id: productId,
    what: d.what,
    category: d.category,
    gate: d.gate,
    status: d.status,
    created_at: d.created_at,
    deadline: d.deadline,
    decided_at: d.decided_at,
    chosen_option: d.chosen_option,
    outcome: d.outcome,
    options: d.options_json ? JSON.parse(d.options_json) as string[] : null,
    rationale: d.rationale,
  }));

  const mrrRow = mrrData.rows.length > 0 ? (mrrData.rows[0] as unknown as MrrRow) : null;
  const mrr = mrrRow ? {
    total: mrrRow.total_mrr,
    new: mrrRow.new_mrr,
    churned: mrrRow.churned_mrr,
    health_ratio: mrrRow.health_ratio,
  } : null;

  return c.json({
    product_name: product.name,
    signal: {
      score: signalData.score,
      tier: signalData.tier,
      prose: signalData.prose,
      risk_state: signalData.riskState,
    },
    stressors,
    pending_decisions: decisions,
    mrr,
  });
});

// ─── GET /api/decisions ───────────────────────────────────────────────────────

mobileRoutes.get('/api/decisions', async (c) => {
  const founder = c.get('founder');
  const productId = c.req.query('product_id');
  if (!productId) return c.json({ error: 'product_id required' }, 400);

  const productCheck = await query(
    `SELECT 1 FROM products WHERE id = ? AND owner_id = ?`,
    [productId, founder.id],
  );
  if (productCheck.rows.length === 0) return c.json({ error: 'Not found' }, 404);

  const result = await query(
    `SELECT id, what, category, gate, status, created_at, deadline,
            decided_at, chosen_option, outcome, options_json, rationale
     FROM decisions WHERE product_id = ?
     ORDER BY CASE WHEN decided_at IS NULL THEN 0 ELSE 1 END,
              CASE category WHEN 'urgent' THEN 0 WHEN 'strategic' THEN 1 ELSE 2 END,
              created_at DESC
     LIMIT 100`,
    [productId],
  );

  type Row = { id: string; what: string; category: string; gate: number; status: string; created_at: string; deadline: string | null; decided_at: string | null; chosen_option: string | null; outcome: string | null; options_json: string | null; rationale: string | null };

  const decisions = (result.rows as unknown as Row[]).map((d) => ({
    id: d.id,
    product_id: productId,
    what: d.what,
    category: d.category,
    gate: d.gate,
    status: d.status,
    created_at: d.created_at,
    deadline: d.deadline,
    decided_at: d.decided_at,
    chosen_option: d.chosen_option,
    outcome: d.outcome,
    options: d.options_json ? JSON.parse(d.options_json) as string[] : null,
    rationale: d.rationale,
  }));

  return c.json({ decisions });
});

// ─── POST /api/decisions ──────────────────────────────────────────────────────

mobileRoutes.post('/api/decisions', async (c) => {
  const founder = c.get('founder');
  const body = await c.req.json<{ product_id: string; what: string; category?: string; gate?: number }>();
  if (!body.product_id || !body.what) return c.json({ error: 'product_id and what required' }, 400);

  const productCheck = await query(
    `SELECT 1 FROM products WHERE id = ? AND owner_id = ?`,
    [body.product_id, founder.id],
  );
  if (productCheck.rows.length === 0) return c.json({ error: 'Not found' }, 404);

  const id = nanoid();
  const category = body.category ?? 'strategic';
  const gate = body.gate ?? 2;

  await query(
    `INSERT INTO decisions (id, product_id, founder_id, what, category, gate, status)
     VALUES (?, ?, ?, ?, ?, ?, 'pending')`,
    [id, body.product_id, founder.id, body.what, category, gate],
  );

  return c.json({
    id,
    product_id: body.product_id,
    what: body.what,
    category,
    gate,
    status: 'pending',
    created_at: new Date().toISOString(),
    deadline: null,
    decided_at: null,
    chosen_option: null,
    outcome: null,
    options: null,
    rationale: null,
  }, 201);
});

// ─── GET /api/voice/briefing ──────────────────────────────────────────────────

mobileRoutes.get('/api/voice/briefing', async (c) => {
  const founder = c.get('founder');
  const productId = c.req.query('product_id');
  if (!productId) return c.json({ error: 'product_id required' }, 400);

  const productCheck = await query(
    `SELECT id, name, market_category FROM products WHERE id = ? AND owner_id = ?`,
    [productId, founder.id],
  );
  if (productCheck.rows.length === 0) return c.json({ error: 'Not found' }, 404);

  try {
    const session = await generateMorningBriefing(productId, founder.id, founder.name ?? null);

    // Build key metrics from latest snapshots
    const [mrrResult, metricsResult] = await Promise.all([
      query(
        `SELECT total_mrr, health_ratio FROM mrr_snapshots WHERE product_id = ? ORDER BY snapshot_date DESC LIMIT 1`,
        [productId],
      ),
      query(
        `SELECT DISTINCT field_name, value FROM metric_snapshots WHERE product_id = ?
         AND field_name IN ('activation_rate','churn_rate','nps_score','day_30_retention')
         ORDER BY snapshot_date DESC LIMIT 8`,
        [productId],
      ),
    ]);

    type MrrRow = { total_mrr: number; health_ratio: number | null };
    type MetricRow = { field_name: string; value: number };

    const mrrRow = mrrResult.rows[0] as unknown as MrrRow | undefined;
    const metrics = metricsResult.rows as unknown as MetricRow[];

    const keyMetrics: Array<{ label: string; value: string }> = [];
    if (mrrRow) {
      keyMetrics.push({ label: 'MRR', value: `$${Math.round(mrrRow.total_mrr).toLocaleString()}` });
      if (mrrRow.health_ratio !== null) {
        keyMetrics.push({ label: 'Health Ratio', value: mrrRow.health_ratio.toFixed(2) });
      }
    }
    const seenFields = new Set<string>();
    for (const m of metrics) {
      if (seenFields.has(m.field_name)) continue;
      seenFields.add(m.field_name);
      const label = m.field_name.replace(/_/g, ' ').replace(/\b\w/g, (ch) => ch.toUpperCase());
      const value = m.field_name.includes('rate') || m.field_name.includes('retention')
        ? `${(m.value * 100).toFixed(1)}%`
        : m.value.toFixed(0);
      keyMetrics.push({ label, value });
    }

    const actionMatch = session.briefing_text.match(/([A-Z][^.!?]*(?:today|now|this week)[^.!?]*[.!?])/i);

    return c.json({
      id: session.id,
      briefing_text: session.briefing_text,
      signal_score: session.signal_at_briefing,
      risk_state: session.risk_state_at_briefing,
      focus_item: actionMatch ? actionMatch[1].trim() : null,
      key_metrics: keyMetrics.slice(0, 6),
    });
  } catch (err) {
    console.error('[mobile] briefing generation failed:', err);
    return c.json({ error: 'Briefing generation failed' }, 500);
  }
});

// ─── POST /api/voice/transcript ───────────────────────────────────────────────

mobileRoutes.post('/api/voice/transcript', async (c) => {
  const founder = c.get('founder');
  const body = await c.req.json<{ product_id: string; transcript: string; session_id?: string }>();
  if (!body.product_id || !body.transcript) return c.json({ error: 'product_id and transcript required' }, 400);

  const productCheck = await query(
    `SELECT 1 FROM products WHERE id = ? AND owner_id = ?`,
    [body.product_id, founder.id],
  );
  if (productCheck.rows.length === 0) return c.json({ error: 'Not found' }, 404);

  try {
    // Create a voice session for this transcript first
    const sessionResult = await query(
      `SELECT id FROM voice_sessions WHERE product_id = ? AND session_date = date('now')`,
      [body.product_id],
    );
    const sessionId = sessionResult.rows.length > 0
      ? (sessionResult.rows[0] as Record<string, string>).id
      : body.session_id ?? null;

    const result = await processVoiceTranscript(sessionId ?? body.product_id, body.product_id, body.transcript);
    return c.json({
      actions_created: result.updates.map((u) => u.type),
      summary: result.summary,
    });
  } catch (err) {
    console.error('[mobile] transcript processing failed:', err);
    return c.json({ error: 'Transcript processing failed' }, 500);
  }
});

// ─── POST /api/push/register ──────────────────────────────────────────────────

mobileRoutes.post('/api/push/register', async (c) => {
  const founder = c.get('founder');
  const body = await c.req.json<{
    apns_device_token: string;
    apns_bundle_id: string;
    platform: string;
    product_id?: string;
  }>();

  if (!body.apns_device_token) return c.json({ error: 'apns_device_token required' }, 400);

  const productId = body.product_id ?? null;

  // Upsert push subscription
  await query(
    `INSERT INTO push_subscriptions
     (id, founder_id, product_id, platform, apns_device_token, apns_bundle_id, is_active)
     VALUES (?, ?, ?, ?, ?, ?, 1)
     ON CONFLICT(founder_id, apns_device_token) DO UPDATE SET
       apns_bundle_id = excluded.apns_bundle_id,
       product_id = COALESCE(excluded.product_id, product_id),
       is_active = 1,
       last_active_at = CURRENT_TIMESTAMP`,
    [nanoid(), founder.id, productId, body.platform ?? 'ios', body.apns_device_token, body.apns_bundle_id ?? null],
  );

  return c.json({ ok: true });
});

// ─── POST /api/push/preferences ───────────────────────────────────────────────

mobileRoutes.post('/api/push/preferences', async (c) => {
  const founder = c.get('founder');
  const body = await c.req.json<{
    product_id: string;
    signal_red?: boolean;
    signal_yellow?: boolean;
    new_decision?: boolean;
    new_stressor?: boolean;
    morning_briefing?: boolean;
    alignment_drop?: boolean;
  }>();
  if (!body.product_id) return c.json({ error: 'product_id required' }, 400);

  await query(
    `INSERT INTO notification_preferences
     (id, founder_id, product_id, signal_red, signal_yellow, new_decision, new_stressor, morning_briefing, alignment_drop)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(founder_id, product_id) DO UPDATE SET
       signal_red = COALESCE(excluded.signal_red, signal_red),
       signal_yellow = COALESCE(excluded.signal_yellow, signal_yellow),
       new_decision = COALESCE(excluded.new_decision, new_decision),
       new_stressor = COALESCE(excluded.new_stressor, new_stressor),
       morning_briefing = COALESCE(excluded.morning_briefing, morning_briefing),
       alignment_drop = COALESCE(excluded.alignment_drop, alignment_drop)`,
    [
      nanoid(),
      founder.id,
      body.product_id,
      body.signal_red !== undefined ? (body.signal_red ? 1 : 0) : null,
      body.signal_yellow !== undefined ? (body.signal_yellow ? 1 : 0) : null,
      body.new_decision !== undefined ? (body.new_decision ? 1 : 0) : null,
      body.new_stressor !== undefined ? (body.new_stressor ? 1 : 0) : null,
      body.morning_briefing !== undefined ? (body.morning_briefing ? 1 : 0) : null,
      body.alignment_drop !== undefined ? (body.alignment_drop ? 1 : 0) : null,
    ],
  );

  return c.json({ ok: true });
});

// ─── GET /api/ping ────────────────────────────────────────────────────────────

mobileRoutes.get('/api/ping', (c) => {
  return c.json({ ok: true, ts: new Date().toISOString() });
});
