// =============================================================================
// FOUNDRY — GDPR Compliance Jobs
// Data export (Article 20) and account deletion (Article 17).
// =============================================================================

import { query, batch } from '../db/client.js';
import { log } from '../lib/logger.js';

/**
 * Process pending data export requests.
 * Assembles all founder data into a JSON structure.
 */
export async function processDataExports(): Promise<void> {
  const pending = await query(
    "SELECT * FROM data_export_requests WHERE status = 'pending' LIMIT 5",
    []
  );

  for (const row of pending.rows) {
    const req = row as Record<string, string>;
    const founderId = req.founder_id;
    const requestId = req.id;

    try {
      await query("UPDATE data_export_requests SET status = 'processing' WHERE id = ?", [requestId]);

      // Gather all founder data
      const [founder, products, decisions, auditScores, auditLog, metrics, stressors, cohorts, competitors, signals, betaIntakes, storyArtifacts, failureLogs, patterns, dna] = await Promise.all([
        query('SELECT id, email, name, tier, created_at, preferences FROM founders WHERE id = ?', [founderId]),
        query('SELECT * FROM products WHERE owner_id = ?', [founderId]),
        query('SELECT d.* FROM decisions d JOIN products p ON d.product_id = p.id WHERE p.owner_id = ?', [founderId]),
        query('SELECT a.* FROM audit_scores a JOIN products p ON a.product_id = p.id WHERE p.owner_id = ?', [founderId]),
        query('SELECT al.* FROM audit_log al JOIN products p ON al.product_id = p.id WHERE p.owner_id = ?', [founderId]),
        query('SELECT m.* FROM metric_snapshots m JOIN products p ON m.product_id = p.id WHERE p.owner_id = ?', [founderId]),
        query('SELECT s.* FROM stressor_history s JOIN products p ON s.product_id = p.id WHERE p.owner_id = ?', [founderId]),
        query('SELECT c.* FROM cohorts c JOIN products p ON c.product_id = p.id WHERE p.owner_id = ?', [founderId]),
        query('SELECT comp.* FROM competitors comp JOIN products p ON comp.product_id = p.id WHERE p.owner_id = ?', [founderId]),
        query('SELECT cs.* FROM competitive_signals cs JOIN products p ON cs.product_id = p.id WHERE p.owner_id = ?', [founderId]),
        query('SELECT b.* FROM beta_intake b JOIN products p ON b.product_id = p.id WHERE p.owner_id = ?', [founderId]),
        query('SELECT f.* FROM founding_story_artifacts f JOIN products p ON f.product_id = p.id WHERE p.owner_id = ?', [founderId]),
        query('SELECT fl.* FROM failure_log fl WHERE fl.owner_id = ?', [founderId]),
        query('SELECT jp.* FROM founder_judgment_patterns jp WHERE jp.owner_id = ?', [founderId]),
        query('SELECT pd.* FROM product_dna pd JOIN products p ON pd.product_id = p.id WHERE p.owner_id = ?', [founderId]),
      ]);

      const exportData = {
        exported_at: new Date().toISOString(),
        founder: founder.rows[0] ?? null,
        products: products.rows,
        decisions: decisions.rows,
        audit_scores: auditScores.rows,
        audit_log: auditLog.rows,
        metric_snapshots: metrics.rows,
        stressor_history: stressors.rows,
        cohorts: cohorts.rows,
        competitors: competitors.rows,
        competitive_signals: signals.rows,
        beta_intake: betaIntakes.rows,
        founding_story_artifacts: storyArtifacts.rows,
        failure_log: failureLogs.rows,
        judgment_patterns: patterns.rows,
        product_dna: dna.rows,
      };

      // Store export data as JSON (in production, upload to secure storage and provide download link)
      const exportJson = JSON.stringify(exportData, null, 2);

      await query(
        "UPDATE data_export_requests SET status = 'completed', completed_at = ?, download_url = ?, expires_at = ? WHERE id = ?",
        [new Date().toISOString(), `data:application/json;base64,${Buffer.from(exportJson).toString('base64')}`, new Date(Date.now() + 7 * 86400000).toISOString(), requestId]
      );

      log.info('Data export completed', { founderId, requestId, recordCount: Object.values(exportData).flat().length });
    } catch (err) {
      await query("UPDATE data_export_requests SET status = 'failed' WHERE id = ?", [requestId]);
      log.error('Data export failed', err, { founderId, requestId });
    }
  }
}

/**
 * Process confirmed account deletion requests.
 * Deletes all data associated with the founder.
 * 30-day grace period from confirmation.
 */
export async function processAccountDeletions(): Promise<void> {
  // Only process deletions confirmed more than 30 days ago
  const confirmed = await query(
    "SELECT * FROM deletion_requests WHERE status = 'confirmed' AND confirmed_at < datetime('now', '-30 days') LIMIT 3",
    []
  );

  for (const row of confirmed.rows) {
    const req = row as Record<string, string>;
    const founderId = req.founder_id;
    const requestId = req.id;

    try {
      log.info('Processing account deletion', { founderId, requestId });

      // Get all product IDs
      const products = await query('SELECT id FROM products WHERE owner_id = ?', [founderId]);
      const productIds = products.rows.map((p) => (p as Record<string, string>).id);

      // Delete in dependency order (child tables first)
      for (const pid of productIds) {
        await query('DELETE FROM webhook_deliveries WHERE webhook_id IN (SELECT id FROM webhooks WHERE founder_id = ?)', [founderId]);
        await query('DELETE FROM competitive_signals WHERE product_id = ?', [pid]);
        await query('DELETE FROM competitors WHERE product_id = ?', [pid]);
        await query('DELETE FROM cohorts WHERE product_id = ?', [pid]);
        await query('DELETE FROM scenario_models WHERE product_id = ?', [pid]);
        await query('DELETE FROM stressor_history WHERE product_id = ?', [pid]);
        await query('DELETE FROM metric_snapshots WHERE product_id = ?', [pid]);
        await query('DELETE FROM founding_story_artifacts WHERE product_id = ?', [pid]);
        await query('DELETE FROM lifecycle_conditions WHERE product_id = ?', [pid]);
        await query('DELETE FROM beta_intake WHERE product_id = ?', [pid]);
        await query('DELETE FROM audit_log WHERE product_id = ?', [pid]);
        await query('DELETE FROM decisions WHERE product_id = ?', [pid]);
        await query('DELETE FROM audit_scores WHERE product_id = ?', [pid]);
        await query('DELETE FROM product_dna WHERE product_id = ?', [pid]);
        await query('DELETE FROM lifecycle_state WHERE product_id = ?', [pid]);
      }

      await query('DELETE FROM failure_log WHERE owner_id = ?', [founderId]);
      await query('DELETE FROM founder_judgment_patterns WHERE owner_id = ?', [founderId]);
      await query('DELETE FROM products WHERE owner_id = ?', [founderId]);
      await query('DELETE FROM webhooks WHERE founder_id = ?', [founderId]);
      await query('DELETE FROM api_keys WHERE founder_id = ?', [founderId]);
      await query('DELETE FROM notifications WHERE founder_id = ?', [founderId]);
      await query('DELETE FROM milestone_events WHERE founder_id = ?', [founderId]);
      await query('DELETE FROM onboarding_tour WHERE founder_id = ?', [founderId]);
      await query('DELETE FROM ai_usage_log WHERE product_id IN (' + productIds.map(() => '?').join(',') + ')', productIds);
      await query('DELETE FROM data_export_requests WHERE founder_id = ?', [founderId]);
      await query('DELETE FROM gate_events WHERE founder_id = ?', [founderId]);
      await query('DELETE FROM founders WHERE id = ?', [founderId]);

      await query("UPDATE deletion_requests SET status = 'completed', completed_at = ? WHERE id = ?",
        [new Date().toISOString(), requestId]);

      log.info('Account deletion completed', { founderId, requestId, productsDeleted: productIds.length });
    } catch (err) {
      log.error('Account deletion failed', err, { founderId, requestId });
    }
  }
}
