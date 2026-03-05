// =============================================================================
// FOUNDRY — Intercom Integration
// Pull support volume, NPS from CSAT, and churn signals from conversation data.
// Support spikes auto-create stressors via the intelligence layer.
// =============================================================================

import { query } from '../../db/client.js';
import { invalidateSignalCache } from '../signal.js';
import { nanoid } from 'nanoid';

interface IntercomCredentials {
  access_token: string;
}

interface IntercomConversation {
  id: string;
  created_at: number;
  updated_at: number;
  state: 'open' | 'closed' | 'snoozed';
  conversation_rating?: {
    rating: number;  // 1-5
    remark: string;
    contact: { id: string };
  };
}

interface IntercomListResponse {
  data: IntercomConversation[];
  pages: { total_count: number; next?: string };
}

// ─── Core Sync Function ───────────────────────────────────────────────────────

export async function syncIntercomMetrics(
  productId: string,
  integrationId: string,
  credentials: IntercomCredentials,
): Promise<{ metricsUpdated: string[]; recordsProcessed: number; supportSpikeDetected: boolean }> {
  const headers = {
    'Authorization': `Bearer ${credentials.access_token}`,
    'Accept': 'application/json',
    'Content-Type': 'application/json',
    'Intercom-Version': '2.10',
  };

  const sevenDaysAgo = Math.floor((Date.now() - 7 * 24 * 60 * 60 * 1000) / 1000);
  const today = new Date().toISOString().slice(0, 10);

  // ── Fetch recent conversations ────────────────────────────────────────────
  const conversations = await fetchIntercomConversations(headers, sevenDaysAgo);

  // ── Compute support volume (7d) ───────────────────────────────────────────
  const supportVolume7d = conversations.length;

  // ── Compute NPS proxy from CSAT ratings ──────────────────────────────────
  const ratedConversations = conversations.filter((c) => c.conversation_rating?.rating);
  let npsScore: number | null = null;

  if (ratedConversations.length >= 5) {
    const ratings = ratedConversations.map((c) => c.conversation_rating!.rating);
    // Convert 1-5 scale to NPS-like proxy: 4-5 = promoter, 3 = neutral, 1-2 = detractor
    const promoters = ratings.filter((r) => r >= 4).length;
    const detractors = ratings.filter((r) => r <= 2).length;
    npsScore = Math.round(((promoters - detractors) / ratings.length) * 100);
  }

  // ── Check for support spike (>50% increase from 30d average) ─────────────
  const prevVolumeResult = await query(
    `SELECT AVG(support_volume_7d) as avg FROM metric_snapshots
     WHERE product_id = ? AND snapshot_date >= date('now', '-30 days')
     AND support_volume_7d IS NOT NULL`,
    [productId],
  );
  const prevAvg = (prevVolumeResult.rows[0] as Record<string, number | null>)?.avg ?? 0;
  const supportSpikeDetected = prevAvg > 0 && supportVolume7d > prevAvg * 1.5;

  // ── Update metrics ────────────────────────────────────────────────────────
  const columns = ['support_volume_7d'];
  const values: (number | null)[] = [supportVolume7d];

  if (npsScore !== null) {
    columns.push('nps_score');
    values.push(npsScore);
  }

  const setClause = columns.map((c) => `${c} = ?`).join(', ');
  await query(
    `INSERT INTO metric_snapshots (id, product_id, snapshot_date, ${columns.join(', ')})
     VALUES (?, ?, ?, ${columns.map(() => '?').join(', ')})
     ON CONFLICT(product_id, snapshot_date) DO UPDATE SET ${setClause}`,
    [nanoid(), productId, today, ...values, ...values],
  );

  invalidateSignalCache(productId);

  await query(
    `UPDATE integrations SET last_synced_at = CURRENT_TIMESTAMP, last_error = NULL WHERE id = ?`,
    [integrationId],
  );

  return { metricsUpdated: columns, recordsProcessed: conversations.length, supportSpikeDetected };
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

async function fetchIntercomConversations(
  headers: Record<string, string>,
  createdAfter: number,
  maxPages = 3,
): Promise<IntercomConversation[]> {
  const results: IntercomConversation[] = [];
  let page = 1;

  while (page <= maxPages) {
    const url = `https://api.intercom.io/conversations?` + new URLSearchParams({
      per_page: '50',
      page: String(page),
      created_at_after: String(createdAfter),
      sort_by: 'created_at',
      sort_order: 'desc',
    });

    try {
      const response = await fetch(url, { headers });
      if (!response.ok) break;
      const data = await response.json() as IntercomListResponse;
      results.push(...data.data);
      if (!data.pages.next) break;
      page++;
    } catch {
      break;
    }
  }

  return results;
}
