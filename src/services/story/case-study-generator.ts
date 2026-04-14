// =============================================================================
// FOUNDRY — Case Study Generator
// Transforms product journey data into publishable case studies and reports.
// =============================================================================

import { query, getLatestAudit } from '../../db/client.js';
import { callSonnet } from '../ai/client.js';
import { nanoid } from 'nanoid';
import { log } from '../../lib/logger.js';

/**
 * Generate a publishable case study from a product's journey data.
 * Pulls audit history, decisions, risk transitions, and milestones.
 */
export async function generateCaseStudy(productId: string, productName: string): Promise<{ title: string; content: string; artifactId: string }> {
  // Gather journey data
  const [audits, decisions, riskTransitions, milestones, metrics] = await Promise.all([
    query('SELECT composite, verdict, created_at FROM audit_scores WHERE product_id = ? ORDER BY created_at ASC', [productId]),
    query("SELECT what, category, status, chosen_option, outcome, created_at, decided_at FROM decisions WHERE product_id = ? AND status != 'pending' ORDER BY created_at ASC LIMIT 20", [productId]),
    query("SELECT reasoning, created_at FROM audit_log WHERE product_id = ? AND action_type = 'risk_state_transition' ORDER BY created_at ASC", [productId]),
    query('SELECT milestone_title, created_at FROM milestone_events WHERE product_id = ? ORDER BY created_at ASC', [productId]),
    query('SELECT snapshot_date, new_mrr_cents, churned_mrr_cents, active_users, activation_rate FROM metric_snapshots WHERE product_id = ? ORDER BY snapshot_date ASC', [productId]),
  ]);

  const firstAudit = audits.rows[0] as Record<string, unknown> | undefined;
  const latestAudit = audits.rows[audits.rows.length - 1] as Record<string, unknown> | undefined;

  const context = {
    product_name: productName,
    audit_count: audits.rows.length,
    first_score: firstAudit?.composite ?? null,
    latest_score: latestAudit?.composite ?? null,
    verdict: latestAudit?.verdict ?? null,
    first_audit_date: firstAudit?.created_at ?? null,
    decisions_made: decisions.rows.length,
    risk_transitions: riskTransitions.rows.length,
    milestones_achieved: milestones.rows.length,
    metric_snapshots: metrics.rows.length,
  };

  const prompt = `Generate a compelling case study for "${productName}" based on this journey data:

${JSON.stringify(context, null, 2)}

Key decisions made:
${decisions.rows.slice(0, 5).map((d) => {
  const row = d as Record<string, string>;
  return `- ${row.what} (${row.category}): chose "${row.chosen_option ?? 'pending'}" → ${row.outcome ?? 'outcome pending'}`;
}).join('\n')}

Risk transitions:
${riskTransitions.rows.map((r) => (r as Record<string, string>).reasoning).join('\n')}

Milestones:
${milestones.rows.map((m) => (m as Record<string, string>).milestone_title).join('\n')}

Write a 500-800 word case study with:
1. Opening hook (the problem the founder faced)
2. The journey (audit → remediation → intelligence → decisions)
3. Key turning points (specific decisions and their outcomes)
4. Results (score improvement, revenue impact, risk management)
5. Founder takeaway (what they learned)

Use specific numbers from the data. Write in third person. Professional but not corporate.`;

  const response = await callSonnet(
    'You are a SaaS case study writer. Write compelling, data-driven narratives about product journeys. Use specific metrics and outcomes.',
    prompt,
    2048,
  );

  const title = `How ${productName} went from ${firstAudit?.composite ?? '?'} to ${latestAudit?.composite ?? '?'} — A Foundry Case Study`;
  const artifactId = nanoid();

  // Store as artifact
  await query(
    `INSERT INTO founding_story_artifacts (id, product_id, phase, artifact_type, title, content, published)
     VALUES (?, ?, 'operational', 'milestone', ?, ?, 0)`,
    [artifactId, productId, title, response.content]
  );

  return { title, content: response.content, artifactId };
}

/**
 * Generate an investor-ready product report.
 */
export async function generateInvestorReport(productId: string, productName: string): Promise<string> {
  const [audit, metrics, decisions, stressors] = await Promise.all([
    getLatestAudit(productId),
    query('SELECT * FROM metric_snapshots WHERE product_id = ? ORDER BY snapshot_date DESC LIMIT 12', [productId]),
    query("SELECT COUNT(*) as total, SUM(CASE WHEN status = 'approved' THEN 1 ELSE 0 END) as resolved FROM decisions WHERE product_id = ?", [productId]),
    query("SELECT COUNT(*) as total, SUM(CASE WHEN status = 'resolved' THEN 1 ELSE 0 END) as resolved FROM stressor_history WHERE product_id = ?", [productId]),
  ]);

  const auditRow = audit.rows[0] as Record<string, unknown> | undefined;
  const decisionStats = decisions.rows[0] as Record<string, number>;
  const stressorStats = stressors.rows[0] as Record<string, number>;
  const latestMetric = metrics.rows[0] as Record<string, number> | undefined;

  return `# ${productName} — Product Intelligence Report
*Generated by Foundry on ${new Date().toISOString().split('T')[0]}*

## Product Health Score
- **Audit Composite**: ${auditRow?.composite ?? 'N/A'}/10
- **Verdict**: ${auditRow?.verdict ?? 'N/A'}
- **Active Users**: ${latestMetric?.active_users ?? 'N/A'}
- **Activation Rate**: ${latestMetric?.activation_rate != null ? `${(latestMetric.activation_rate * 100).toFixed(1)}%` : 'N/A'}
- **Day 30 Retention**: ${latestMetric?.day_30_retention != null ? `${(latestMetric.day_30_retention * 100).toFixed(1)}%` : 'N/A'}

## Revenue
- **New MRR**: $${((latestMetric?.new_mrr_cents ?? 0) / 100).toFixed(0)}/mo
- **Churned MRR**: $${((latestMetric?.churned_mrr_cents ?? 0) / 100).toFixed(0)}/mo
- **Health Ratio**: ${latestMetric?.mrr_health_ratio?.toFixed(2) ?? 'N/A'}
- **Data Points**: ${metrics.rows.length} monthly snapshots

## Operational Maturity
- **Decisions Made**: ${decisionStats?.resolved ?? 0} of ${decisionStats?.total ?? 0}
- **Risks Identified**: ${stressorStats?.total ?? 0} (${stressorStats?.resolved ?? 0} resolved)
- **Metric History**: ${metrics.rows.length} data points

## Audit Dimensions (0-10)
${auditRow ? [1,2,3,4,5,6,7,8,9,10].map((d) => `- D${d}: ${(auditRow as any)[`d${d}_score`] ?? 'N/A'}`).join('\n') : 'No audit data'}

---
*This report was generated by Foundry's autonomous business intelligence platform.*
*Data is verified and timestamped. Contact the founder for access to the full Foundry dashboard.*`;
}
