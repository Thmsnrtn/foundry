// =============================================================================
// FOUNDRY — Founder Health Intelligence
// Computes motivation, engagement trends, and key-person risk.
// =============================================================================

import { query } from '../../db/client.js';
import { nanoid } from 'nanoid';
import type { FounderHealth, EngagementTrend, KeyPerson } from '../../types/index.js';
import type { FounderHealthRow } from '../../types/database.js';

/**
 * Compute a motivation score (0-100) based on engagement signals.
 */
export async function computeMotivationScore(founderId: string): Promise<number | null> {
  // 50 is a BASELINE that evidence moves, which is a legitimate design — but a
  // baseline nothing moved is not a measurement of anybody's motivation, and it
  // was stored as one and read as one. `signalsUsed` counts how many of the
  // three signals below actually applied; none, and this returns null.
  let score = 50;
  let signalsUsed = 0;

  // 1. Login frequency trend (7-day vs 30-day)
  const recentLogins = await query(
    `SELECT COUNT(*) as c FROM audit_log WHERE product_id IN (SELECT id FROM products WHERE owner_id = ?) AND created_at > datetime('now', '-7 days')`,
    [founderId]
  );
  const monthLogins = await query(
    `SELECT COUNT(*) as c FROM audit_log WHERE product_id IN (SELECT id FROM products WHERE owner_id = ?) AND created_at > datetime('now', '-30 days')`,
    [founderId]
  );
  const recent = (recentLogins.rows[0] as Record<string, number>)?.c ?? 0;
  const monthly = (monthLogins.rows[0] as Record<string, number>)?.c ?? 0;
  const weeklyRate = recent;
  const avgWeeklyRate = monthly / 4;

  if (avgWeeklyRate > 0) {
    signalsUsed++;
    const loginTrend = weeklyRate / avgWeeklyRate;
    if (loginTrend >= 1.2) score += 15;      // Rising engagement
    else if (loginTrend >= 0.8) score += 5;   // Stable
    else if (loginTrend >= 0.5) score -= 10;  // Declining
    else score -= 25;                          // Critical drop
  }

  // 2. Decision response latency trend
  const recentDecisions = await query(
    `SELECT decided_at, created_at FROM decisions
     WHERE product_id IN (SELECT id FROM products WHERE owner_id = ?)
     AND decided_at IS NOT NULL AND created_at > datetime('now', '-30 days')
     ORDER BY decided_at DESC LIMIT 10`,
    [founderId]
  );
  if (recentDecisions.rows.length > 0) {
    signalsUsed++;
    const latencies = (recentDecisions.rows as unknown as Array<Record<string, string>>).map((d) => {
      const created = new Date(d.created_at).getTime();
      const decided = new Date(d.decided_at).getTime();
      return (decided - created) / (1000 * 60 * 60); // hours
    });
    const avgLatency = latencies.reduce((a, b) => a + b, 0) / latencies.length;
    if (avgLatency < 24) score += 15;         // Responsive
    else if (avgLatency < 72) score += 5;      // Normal
    else if (avgLatency < 168) score -= 10;    // Slow
    else score -= 20;                           // Very slow
  }

  // 3. Activity consistency
  if (recent > 0) { signalsUsed++; score += 10; }
  if (recent >= 5) score += 5;

  if (signalsUsed === 0) return null;
  return Math.max(0, Math.min(100, score));
}

/**
 * Detect engagement trend over recent period.
 */
export async function detectEngagementTrend(founderId: string): Promise<EngagementTrend> {
  const snapshots = await query(
    `SELECT motivation_score FROM founder_health_snapshots
     WHERE founder_id = ? ORDER BY snapshot_date DESC LIMIT 7`,
    [founderId]
  );

  // Three substitutions used to stand where absence should have been reported,
  // all about a person: fewer than three snapshots returned 'stable'; a
  // snapshot with no motivation score counted as 50; and with no older window
  // to compare against, the baseline was 50 again — so `delta` was measured
  // against a number nobody recorded.
  const scores = (snapshots.rows as unknown as Array<Record<string, unknown>>)
    .map((s) => s.motivation_score)
    .filter((v): v is number => v !== null && v !== undefined)
    .map(Number);

  if (scores.length < 3) return 'unknown';

  const recentScores = scores.slice(0, 3);
  const older = scores.slice(3);
  const recentAvg = recentScores.reduce((a, b) => a + b, 0) / recentScores.length;

  // A low recent average is a finding on its own; it does not need a comparison.
  if (recentAvg < 30) return 'critical';

  // Without an older window there is no trend, and 'stable' would be a claim
  // that it had not moved.
  if (older.length === 0) return 'unknown';

  const olderAvg = older.reduce((a, b) => a + b, 0) / older.length;
  const delta = recentAvg - olderAvg;

  if (delta > 10) return 'rising';
  if (delta < -10) return 'declining';
  return 'stable';
}

/**
 * Assess key-person dependency risk.
 */
export async function assessKeyPersonRisk(founderId: string): Promise<{
  riskLevel: 'low' | 'medium' | 'high' | 'critical';
  description: string;
}> {
  const result = await query('SELECT key_persons FROM founder_health WHERE founder_id = ?', [founderId]);
  const row = result.rows[0] as Record<string, string> | undefined;
  if (!row?.key_persons) {
    return { riskLevel: 'high', description: 'No key persons documented. Solo founder with no backup.' };
  }

  const persons: KeyPerson[] = JSON.parse(row.key_persons);
  if (persons.length === 0) {
    return { riskLevel: 'high', description: 'No key persons documented.' };
  }

  const highRisk = persons.filter((p) => p.departure_risk === 'high' && p.replaceability <= 2);
  const irreplaceable = persons.filter((p) => p.replaceability === 1);

  if (irreplaceable.length > 0) {
    return {
      riskLevel: 'critical',
      description: `${irreplaceable.length} irreplaceable person(s): ${irreplaceable.map((p) => p.name).join(', ')}`,
    };
  }
  if (highRisk.length > 0) {
    return {
      riskLevel: 'high',
      description: `${highRisk.length} high departure risk, hard-to-replace person(s)`,
    };
  }
  if (persons.some((p) => p.departure_risk === 'high')) {
    return { riskLevel: 'medium', description: 'Some team members have high departure risk but are replaceable.' };
  }
  return { riskLevel: 'low', description: 'Key person risk is manageable.' };
}

/**
 * Get the full founder health summary.
 */
export async function getFounderHealthSummary(founderId: string): Promise<FounderHealth | null> {
  const result = await query('SELECT * FROM founder_health WHERE founder_id = ?', [founderId]);
  const row = result.rows[0] as unknown as FounderHealthRow | undefined;
  if (!row) return null;

  return {
    id: row.id,
    founder_id: row.founder_id,
    personal_runway_months: row.personal_runway_months,
    weekly_hours_available: row.weekly_hours_available,
    immigration_status: row.immigration_status,
    visa_expiry_date: row.visa_expiry_date,
    key_persons: row.key_persons ? (JSON.parse(row.key_persons) as KeyPerson[]) : null,
    engagement_trend: row.engagement_trend as EngagementTrend,
    last_login_streak: row.last_login_streak,
    avg_decision_response_hours: row.avg_decision_response_hours,
    motivation_score: row.motivation_score,
    updated_at: row.updated_at,
  };
}

/**
 * Update self-reported fields on founder health.
 */
export async function updateFounderHealth(
  founderId: string,
  updates: Partial<{
    personal_runway_months: number;
    weekly_hours_available: number;
    immigration_status: string;
    visa_expiry_date: string;
    key_persons: KeyPerson[];
  }>
): Promise<void> {
  // Upsert the founder_health row
  const existing = await query('SELECT id FROM founder_health WHERE founder_id = ?', [founderId]);
  if (existing.rows.length === 0) {
    await query(
      `INSERT INTO founder_health (id, founder_id, personal_runway_months, weekly_hours_available, immigration_status, visa_expiry_date, key_persons)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [
        nanoid(),
        founderId,
        updates.personal_runway_months ?? null,
        updates.weekly_hours_available ?? null,
        updates.immigration_status ?? null,
        updates.visa_expiry_date ?? null,
        updates.key_persons ? JSON.stringify(updates.key_persons) : null,
      ]
    );
  } else {
    const sets: string[] = [];
    const args: unknown[] = [];
    if (updates.personal_runway_months !== undefined) { sets.push('personal_runway_months = ?'); args.push(updates.personal_runway_months); }
    if (updates.weekly_hours_available !== undefined) { sets.push('weekly_hours_available = ?'); args.push(updates.weekly_hours_available); }
    if (updates.immigration_status !== undefined) { sets.push('immigration_status = ?'); args.push(updates.immigration_status); }
    if (updates.visa_expiry_date !== undefined) { sets.push('visa_expiry_date = ?'); args.push(updates.visa_expiry_date); }
    if (updates.key_persons !== undefined) { sets.push('key_persons = ?'); args.push(JSON.stringify(updates.key_persons)); }
    if (sets.length > 0) {
      sets.push("updated_at = datetime('now')");
      args.push(founderId);
      await query(`UPDATE founder_health SET ${sets.join(', ')} WHERE founder_id = ?`, args);
    }
  }
}

/**
 * Refresh computed health fields (motivation, engagement trend).
 * Called by the daily health check job.
 */
export async function refreshFounderHealthMetrics(founderId: string): Promise<void> {
  const motivationScore = await computeMotivationScore(founderId);
  const engagementTrend = await detectEngagementTrend(founderId);

  // Upsert
  const existing = await query('SELECT id FROM founder_health WHERE founder_id = ?', [founderId]);
  if (existing.rows.length === 0) {
    await query(
      `INSERT INTO founder_health (id, founder_id, motivation_score, engagement_trend) VALUES (?, ?, ?, ?)`,
      [nanoid(), founderId, motivationScore, engagementTrend]
    );
  } else {
    await query(
      `UPDATE founder_health SET motivation_score = ?, engagement_trend = ?, updated_at = datetime('now') WHERE founder_id = ?`,
      [motivationScore, engagementTrend, founderId]
    );
  }

  // Snapshot
  const today = new Date().toISOString().split('T')[0]!;
  const health = await getFounderHealthSummary(founderId);
  await query(
    `INSERT INTO founder_health_snapshots (id, founder_id, snapshot_date, motivation_score, engagement_trend, weekly_hours_available, personal_runway_months)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [
      nanoid(),
      founderId,
      today,
      motivationScore,
      engagementTrend,
      health?.weekly_hours_available ?? null,
      health?.personal_runway_months ?? null,
    ]
  );
}

/**
 * Generate a discreet, supportive digest section for founder health.
 */
export function generateFounderHealthDigestSection(health: FounderHealth): string | null {
  if (!health.motivation_score && !health.personal_runway_months) return null;

  const parts: string[] = [];

  if (health.engagement_trend === 'declining') {
    parts.push('Your engagement with Foundry has been declining recently. Taking breaks is normal — but if you\'re feeling stuck, consider reaching out to a founder peer group.');
  } else if (health.engagement_trend === 'critical') {
    parts.push('We\'ve noticed significantly reduced activity. If things are tough right now, that\'s okay. Your product is still running. When you\'re ready, we\'re here.');
  }

  if (health.personal_runway_months !== null && health.personal_runway_months <= 3) {
    parts.push(`Your personal runway is ${health.personal_runway_months.toFixed(0)} months. Consider updating your financial plan or exploring revenue acceleration options.`);
  }

  if (health.visa_expiry_date) {
    const expiry = new Date(health.visa_expiry_date);
    const daysUntil = Math.floor((expiry.getTime() - Date.now()) / (1000 * 60 * 60 * 24));
    if (daysUntil <= 90 && daysUntil > 0) {
      parts.push(`Visa expiry in ${daysUntil} days. Ensure your immigration timeline is aligned with your startup plan.`);
    }
  }

  return parts.length > 0 ? parts.join('\n\n') : null;
}
