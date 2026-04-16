// =============================================================================
// FOUNDRY — Investor Update Generator
// Auto-generates monthly investor update drafts in professional markdown format.
// =============================================================================

import { nanoid } from 'nanoid';
import { query } from '../../../db/client.js';
import { callSonnet } from '../../ai/client.js';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function parseJSON<T>(value: string | null | undefined, fallback: T): T {
  if (value === null || value === undefined) return fallback;
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}

function monthToDateRange(month: string): { start: string; end: string } {
  // '2026-03' → { start: '2026-03-01', end: '2026-03-31' }
  const [year, mo] = month.split('-').map(Number);
  if (!year || !mo) {
    const now = new Date();
    return { start: now.toISOString().slice(0, 10), end: now.toISOString().slice(0, 10) };
  }
  const lastDay = new Date(year, mo, 0).getDate();
  const pad = (n: number) => String(n).padStart(2, '0');
  return {
    start: `${year}-${pad(mo)}-01`,
    end: `${year}-${pad(mo)}-${lastDay}`,
  };
}

// ─── generateInvestorUpdate ───────────────────────────────────────────────────

export async function generateInvestorUpdate(
  productId: string,
  month: string
): Promise<string> {
  // Check if update already exists
  const existing = await query(
    'SELECT id FROM investor_updates WHERE product_id=? AND month=?',
    [productId, month]
  );
  if (existing.rows.length > 0) {
    return (existing.rows[0] as Record<string, unknown>).id as string;
  }

  const { start, end } = monthToDateRange(month);

  // Load product info
  const productResult = await query(
    'SELECT name FROM products WHERE id=?',
    [productId]
  );
  const prod = (productResult.rows[0] as Record<string, unknown>) ?? {};
  const companyName = (prod.name as string) ?? 'Unknown';

  // Load metrics snapshot for the month
  let metricsRow: Record<string, unknown> = {};
  let prevMetricsRow: Record<string, unknown> = {};
  try {
    const metricsResult = await query(
      `SELECT * FROM metric_snapshots
       WHERE product_id=? AND snapshot_date <= ?
       ORDER BY snapshot_date DESC LIMIT 2`,
      [productId, end]
    );
    if (metricsResult.rows.length > 0) metricsRow = metricsResult.rows[0] as Record<string, unknown>;
    if (metricsResult.rows.length > 1) prevMetricsRow = metricsResult.rows[1] as Record<string, unknown>;
  } catch { /* ok */ }

  // Load briefings this month
  let briefingHeadlines = 'No briefings available.';
  try {
    const briefingsResult = await query(
      `SELECT headline, briefing_date FROM scp_briefings
       WHERE product_id=? AND briefing_date >= ? AND briefing_date <= ?
       ORDER BY briefing_date DESC LIMIT 20`,
      [productId, start, end]
    );
    if (briefingsResult.rows.length > 0) {
      briefingHeadlines = briefingsResult.rows
        .map((r) => {
          const row = r as Record<string, unknown>;
          return `- [${row.briefing_date as string}] ${row.headline as string}`;
        })
        .join('\n');
    }
  } catch { /* ok */ }

  // Load active stressors
  let stressorsText = 'None active.';
  try {
    const stressorsResult = await query(
      `SELECT title, severity FROM stressor_history
       WHERE product_id=? AND status='active'`,
      [productId]
    );
    if (stressorsResult.rows.length > 0) {
      stressorsText = stressorsResult.rows
        .map((r) => {
          const row = r as Record<string, unknown>;
          return `[${row.severity as string}] ${row.title as string}`;
        })
        .join(', ');
    }
  } catch { /* ok */ }

  // Load recent experiments
  let experimentsText = 'No experiments this month.';
  try {
    const expResult = await query(
      `SELECT name, status, outcome_summary FROM experiments
       WHERE product_id=? AND updated_at >= ? ORDER BY updated_at DESC LIMIT 5`,
      [productId, start]
    );
    if (expResult.rows.length > 0) {
      experimentsText = expResult.rows
        .map((r) => {
          const row = r as Record<string, unknown>;
          return `${row.name as string} (${row.status as string})`;
        })
        .join(', ');
    }
  } catch { /* ok */ }

  // Compute key metrics
  const mrrCents = (metricsRow.mrr_cents as number) ?? null;
  const prevMrrCents = (prevMetricsRow.mrr_cents as number) ?? null;
  const mrrDisplay = mrrCents !== null ? `$${(mrrCents / 100).toLocaleString()}` : 'N/A';
  const mrrGrowth = (metricsRow.mrr_growth_pct as number) ?? null;
  const churnRate = (metricsRow.churn_rate as number) ?? null;
  const activationRate = (metricsRow.activation_rate as number) ?? null;
  const customerCount = (metricsRow.customer_count as number) ?? null;

  const keyMetrics: Record<string, unknown> = {
    mrr: mrrDisplay,
    mrr_growth_pct: mrrGrowth,
    churn_rate: churnRate,
    activation_rate: activationRate,
    customer_count: customerCount,
  };

  // Generate the investor update via Claude
  const systemPrompt = `You are helping a startup founder write a professional monthly investor update.
Write in a direct, honest, founder voice. Be specific with numbers. Keep it concise (under 400 words).
Format as clean markdown with the exact sections requested.`;

  const userPrompt = `Write a monthly investor update for ${companyName} — ${month}.

Key Metrics:
- MRR: ${mrrDisplay}${mrrGrowth !== null ? ` (${mrrGrowth >= 0 ? '+' : ''}${mrrGrowth.toFixed(1)}% MoM)` : ''}
- Customers: ${customerCount ?? 'N/A'}
- Churn: ${churnRate !== null ? `${churnRate.toFixed(1)}%` : 'N/A'}
- Activation: ${activationRate !== null ? `${activationRate.toFixed(0)}%` : 'N/A'}

What happened this month (from CEO briefings):
${briefingHeadlines}

Active challenges: ${stressorsText}
Experiments underway: ${experimentsText}

Write the update in this exact markdown format:

## ${companyName} — ${month} Investor Update

### Highlights
- [3 bullet points of key wins]

### Key Metrics
| Metric | Value | vs Last Month |
|--------|-------|---------------|
| MRR | [value] | [change] |
| Customers | [value] | [change] |
| Churn | [value] | [change] |
| Activation | [value] | [change] |

### Challenges & How We're Addressing Them
[2-3 honest sentences about challenges and responses]

### Focus for Next Month
[2-3 bullet points of next month priorities]

### Asks
[1-2 specific asks from investors, or "No specific asks this month." if none]`;

  const response = await callSonnet(systemPrompt, userPrompt, 1500);
  const draftText = response.content.trim();

  // INSERT into investor_updates
  const id = nanoid();
  await query(
    `INSERT INTO investor_updates (id, product_id, month, draft_text, key_metrics_json, status)
     VALUES (?, ?, ?, ?, ?, 'draft')`,
    [id, productId, month, draftText, JSON.stringify(keyMetrics)]
  );

  return id;
}

// ─── getInvestorUpdate ────────────────────────────────────────────────────────

export async function getInvestorUpdate(
  updateId: string
): Promise<{
  draft_text: string;
  month: string;
  key_metrics: Record<string, unknown>;
  status: string;
} | null> {
  const result = await query(
    'SELECT * FROM investor_updates WHERE id=?',
    [updateId]
  );
  if (result.rows.length === 0) return null;
  const row = result.rows[0] as Record<string, unknown>;
  return {
    draft_text: row.draft_text as string,
    month: row.month as string,
    key_metrics: parseJSON<Record<string, unknown>>(row.key_metrics_json as string, {}),
    status: row.status as string,
  };
}

// ─── listInvestorUpdates ──────────────────────────────────────────────────────

export async function listInvestorUpdates(
  productId: string
): Promise<Array<{ id: string; month: string; status: string; generated_at: string }>> {
  const result = await query(
    'SELECT id, month, status, generated_at FROM investor_updates WHERE product_id=? ORDER BY month DESC',
    [productId]
  );
  return result.rows.map((r) => {
    const row = r as Record<string, unknown>;
    return {
      id: row.id as string,
      month: row.month as string,
      status: row.status as string,
      generated_at: row.generated_at as string,
    };
  });
}

// ─── markUpdateSent ───────────────────────────────────────────────────────────

export async function markUpdateSent(updateId: string): Promise<void> {
  await query(
    `UPDATE investor_updates SET status='sent', sent_at=datetime('now') WHERE id=?`,
    [updateId]
  );
}
