// =============================================================================
// FOUNDRY — Board Packet Generator
// Auto-generates quarterly board meeting materials from product data.
// =============================================================================

import { nanoid } from 'nanoid';
import { query } from '../../../db/client.js';
import { callSonnet, parseJSONResponse } from '../../ai/client.js';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface BoardPacketNarrative {
  executive_summary: string;
  key_metrics: Array<{
    name: string;
    value: string;
    trend: 'up' | 'down' | 'flat';
    vs_last_quarter: string;
  }>;
  wins: string[];
  risks: string[];
  asks: string[];
  next_quarter_goals: Array<{
    goal: string;
    owner: string;
    success_metric: string;
  }>;
  agent_insights: string[];
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function parseJSON<T>(value: string | null | undefined, fallback: T): T {
  if (value === null || value === undefined) return fallback;
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}

export function quarterToDateRange(quarter: string): { start: string; end: string } {
  // '2026-Q2' → { start: '2026-04-01', end: '2026-06-30' }
  const match = quarter.match(/^(\d{4})-Q([1-4])$/);
  if (!match) {
    const now = new Date();
    return { start: now.toISOString().slice(0, 10), end: now.toISOString().slice(0, 10) };
  }
  const year = parseInt(match[1], 10);
  const q = parseInt(match[2], 10);
  const quarterStarts = ['01-01', '04-01', '07-01', '10-01'];
  const quarterEnds = ['03-31', '06-30', '09-30', '12-31'];
  return {
    start: `${year}-${quarterStarts[q - 1]}`,
    end: `${year}-${quarterEnds[q - 1]}`,
  };
}

function currentQuarter(): string {
  const now = new Date();
  const q = Math.ceil((now.getMonth() + 1) / 3);
  return `${now.getFullYear()}-Q${q}`;
}

/**
 * What an experiment established, from the columns that are actually written.
 *
 * BOTH INVESTOR DOCUMENTS READ `experiments.learnings`, WHICH NOTHING WRITES.
 * Concluding an experiment writes `winner`, `results_json` and
 * `early_stop_reason`; stopping one early writes `early_stop_reason`. The
 * `learnings` column has no writer anywhere — not in TypeScript, not in a
 * trigger — so the Experiments section of a board packet and of an investor
 * update has always listed names against a NULL outcome, and the model then
 * wrote about a quarter of experiments that apparently concluded nothing.
 *
 * 'inconclusive' is a real winner value and is reported as itself: an
 * experiment whose arms did not separate says nothing about the statement, and
 * telling an investor it "won" or "lost" would be the same overclaim the
 * hypothesis vocabulary was fixed to avoid.
 */
export function experimentOutcome(row: {
  status?: unknown; winner?: unknown; early_stop_reason?: unknown;
}): string {
  const winner = row.winner == null ? null : String(row.winner);
  const stopped = row.early_stop_reason == null ? null : String(row.early_stop_reason);
  if (winner === 'inconclusive') return 'inconclusive — the arms did not separate';
  if (winner) return `${winner} won`;
  if (stopped) return `stopped early: ${stopped}`;
  return String(row.status ?? 'pending');
}

// ─── generateBoardPacket ──────────────────────────────────────────────────────

export async function generateBoardPacket(
  productId: string,
  quarter: string
): Promise<string> {
  // 1. Check if packet already exists for this quarter
  const existing = await query(
    'SELECT id FROM board_packets WHERE product_id=? AND quarter=?',
    [productId, quarter]
  );
  if (existing.rows.length > 0) {
    return (existing.rows[0] as Record<string, unknown>).id as string;
  }

  const { start, end } = quarterToDateRange(quarter);

  // 2. Load product info
  const productResult = await query(
    'SELECT name, company_lifecycle_state FROM products WHERE id=?',
    [productId]
  );
  const prod = (productResult.rows[0] as Record<string, unknown>) ?? {};
  const companyName = (prod.name as string) ?? 'Unknown';

  // 3. Load metrics: latest metric_snapshots
  let metricsSnapshot: Record<string, unknown> = {};
  try {
    const metricsResult = await query(
      `SELECT * FROM metric_snapshots WHERE product_id=? ORDER BY snapshot_date DESC LIMIT 2`,
      [productId]
    );
    if (metricsResult.rows.length > 0) {
      metricsSnapshot = metricsResult.rows[0] as Record<string, unknown>;
    }
  } catch {
    // table may not have expected columns
  }

  // 4. Load briefings from this quarter
  let briefingsSummary = 'No briefings available for this quarter.';
  try {
    const briefingsResult = await query(
      `SELECT headline, briefing_date, agent_contributions FROM scp_briefings
       WHERE product_id=? AND briefing_date >= ? AND briefing_date <= ?
       ORDER BY briefing_date DESC LIMIT 50`,
      [productId, start, end]
    );
    if (briefingsResult.rows.length > 0) {
      const lines = briefingsResult.rows.map((r) => {
        const row = r as Record<string, unknown>;
        return `[${row.briefing_date as string}] ${row.headline as string}`;
      });
      briefingsSummary = lines.join('\n');
    }
  } catch {
    // briefings table may not exist yet
  }

  // 5. Load active stressors
  let stressorsText = 'None active.';
  try {
    const stressorsResult = await query(
      `SELECT stressor_name AS title, severity, signal AS description FROM stressor_history
       WHERE product_id=? AND status='active'`,
      [productId]
    );
    if (stressorsResult.rows.length > 0) {
      stressorsText = stressorsResult.rows
        .map((r) => {
          const row = r as Record<string, unknown>;
          return `[${row.severity as string}] ${row.title as string}: ${row.description as string}`;
        })
        .join('\n');
    }
  } catch {
    // stressor_history may not exist
  }

  // Load recent decisions
  //
  // THIS READ `agent_decisions`, WHICH NOTHING HAS EVER WRITTEN. Migration 083
  // created the table because three surfaces queried a table that did not
  // exist, and said so plainly: "No writer yet — the tab renders empty until
  // agents populate it." Nothing ever did. So the decisions section of a
  // document founders send to their INVESTORS has said "No recent decisions."
  // for every company in every quarter, however many decisions the company
  // actually made, while the real ledger sat one table away. The catch made the
  // two indistinguishable: an empty result and a missing table produced the
  // same sentence.
  //
  // `decisions` is the canonical ledger — the queue the founder resolves, the
  // rows the shadow ledger and the autopilot read, the thing the word means
  // everywhere else in the system. Under-reporting to investors is not a
  // neutral failure, so this now says what is true, and says nothing when it
  // has nothing.
  let decisionsText = 'No recent decisions.';
  const decisionsResult = await query(
    `SELECT what, status, chosen_option FROM decisions
      WHERE product_id = ? AND created_at >= ? AND deleted_at IS NULL
      ORDER BY created_at DESC LIMIT 20`,
    [productId, start]
  );
  if (decisionsResult.rows.length > 0) {
    decisionsText = (decisionsResult.rows as unknown as Array<Record<string, unknown>>)
      .map((row) => {
        // A resolved decision is worth more to a reader than its status word:
        // what was chosen is the thing an investor is being told.
        const chosen = row.chosen_option == null ? '' : ` → ${String(row.chosen_option)}`;
        return `[${String(row.status)}] ${String(row.what)}${chosen}`;
      })
      .join('\n');
  }

  // Load experiment outcomes
  let experimentsText = 'No experiments this quarter.';
  try {
    const experimentsResult = await query(
      `SELECT name, status, winner, early_stop_reason FROM experiments
       WHERE product_id=? AND updated_at >= ? ORDER BY updated_at DESC LIMIT 10`,
      [productId, start]
    );
    if (experimentsResult.rows.length > 0) {
      experimentsText = experimentsResult.rows
        .map((r) => {
          const row = r as Record<string, unknown>;
          return `[${row.status as string}] ${row.name as string}: ${experimentOutcome(row)}`;
        })
        .join('\n');
    }
  } catch {
    // experiments table may vary
  }

  // 6. Compute MRR display values
  const mrrCents = (metricsSnapshot.mrr_cents as number) ?? null;
  const mrrGrowthPct = (metricsSnapshot.mrr_growth_pct as number) ?? null;
  const mrrDisplay = mrrCents !== null ? `$${(mrrCents / 100).toLocaleString()}` : 'N/A';
  const growthDisplay = mrrGrowthPct !== null ? `${mrrGrowthPct.toFixed(1)}%` : 'N/A';

  // 7. Build prompt and call Claude
  const systemPrompt = `You are a board-level strategic advisor helping a founder prepare for their board meeting.
Generate a structured, honest board packet that surfaces both wins and risks clearly.
Be specific with numbers. Investors respect candor about challenges more than spin.`;

  const userPrompt = `Generate a complete board packet for ${companyName} for ${quarter}.

Company Context:
- Lifecycle State: ${(prod.company_lifecycle_state as string) ?? 'unknown'}
- Current MRR: ${mrrDisplay}
- MRR Growth: ${growthDisplay} MoM

Quarterly Briefing Headlines:
${briefingsSummary}

Active Stressors / Risks:
${stressorsText}

Key Decisions This Quarter:
${decisionsText}

Experiments:
${experimentsText}

Return a JSON object with this exact structure:
{
  "executive_summary": "2-3 sentence summary of the quarter",
  "key_metrics": [
    { "name": "MRR", "value": "${mrrDisplay}", "trend": "up|down|flat", "vs_last_quarter": "description of change" },
    { "name": "MRR Growth", "value": "${growthDisplay}", "trend": "up|down|flat", "vs_last_quarter": "description" }
  ],
  "wins": ["3-5 specific wins as bullet strings"],
  "risks": ["2-4 specific risks as bullet strings"],
  "asks": ["what you need from the board as strings"],
  "next_quarter_goals": [
    { "goal": "goal description", "owner": "Founder/CTO/etc", "success_metric": "measurable outcome" }
  ],
  "agent_insights": ["top 3 insights from AI agent work this quarter"]
}`;

  const response = await callSonnet(systemPrompt, userPrompt, 2000, productId);
  const narrative = parseJSONResponse<BoardPacketNarrative>(response.content);

  // 8. INSERT into board_packets
  //
  // `period_start` and `period_end` are NOT NULL with no default, and this
  // INSERT never supplied them — so every board packet this system has ever
  // tried to generate raised at the last step. The AI call happens FIRST, so
  // the money was spent, the narrative was written, and then the write threw
  // and the founder saw nothing. The two values were computed at the top of
  // this function and simply not passed down.
  //
  // A column check that only asks "does this column exist" cannot see this:
  // every column named here is real. What was missing is a column that is not
  // named and cannot be absent.
  const id = nanoid();
  await query(
    `INSERT INTO board_packets
       (id, product_id, quarter, period_start, period_end,
        narrative_json, metrics_snapshot_json, status)
     VALUES (?, ?, ?, ?, ?, ?, ?, 'draft')`,
    [
      id,
      productId,
      quarter,
      start,
      end,
      JSON.stringify(narrative),
      JSON.stringify(metricsSnapshot),
    ]
  );

  // 9. Return id
  return id;
}

// ─── getBoardPacket ───────────────────────────────────────────────────────────

export async function getBoardPacket(
  packetId: string
): Promise<{
  packet: BoardPacketNarrative;
  quarter: string;
  generated_at: string;
  status: string;
} | null> {
  const result = await query(
    'SELECT * FROM board_packets WHERE id=?',
    [packetId]
  );
  if (result.rows.length === 0) return null;
  const row = result.rows[0] as Record<string, unknown>;
  return {
    packet: parseJSON<BoardPacketNarrative>(row.narrative_json as string, {
      executive_summary: '',
      key_metrics: [],
      wins: [],
      risks: [],
      asks: [],
      next_quarter_goals: [],
      agent_insights: [],
    }),
    quarter: row.quarter as string,
    generated_at: row.generated_at as string,
    status: row.status as string,
  };
}

// ─── listBoardPackets ─────────────────────────────────────────────────────────

export async function listBoardPackets(
  productId: string
): Promise<
  Array<{
    id: string;
    quarter: string;
    generated_at: string;
    status: string;
    overall_health_summary: string;
  }>
> {
  const result = await query(
    'SELECT id, quarter, generated_at, status, narrative_json FROM board_packets WHERE product_id=? ORDER BY quarter DESC',
    [productId]
  );
  return result.rows.map((r) => {
    const row = r as Record<string, unknown>;
    const narrative = parseJSON<BoardPacketNarrative>(row.narrative_json as string, {
      executive_summary: '',
      key_metrics: [],
      wins: [],
      risks: [],
      asks: [],
      next_quarter_goals: [],
      agent_insights: [],
    });
    return {
      id: row.id as string,
      quarter: row.quarter as string,
      generated_at: row.generated_at as string,
      status: row.status as string,
      overall_health_summary: narrative.executive_summary
        ? narrative.executive_summary.slice(0, 120)
        : 'Board packet generated.',
    };
  });
}

// ─── markPacketFinalized ──────────────────────────────────────────────────────

/**
 * The founder has been through the packet and it is ready to share.
 *
 * THIS USED TO WRITE status='reviewed'. `board_packets` was created by
 * migration 011 with the vocabulary draft/finalized/shared. Migration 039 then
 * wrote `CREATE TABLE IF NOT EXISTS board_packets` with draft/reviewed/
 * published — and because the table already existed, that definition was a
 * silent no-op. The code was written against the version that never took
 * effect, so this UPDATE raised every time, the route caught it as
 * "non-fatal", and the founder's Mark Reviewed button did nothing, forever,
 * without saying so. The button never even disappeared, because the status it
 * was waiting for could not be reached.
 *
 * `finalized` is the live value and, per migration 011's own comment on the
 * column beside it, means exactly this: "when founder marks it ready to
 * share". So the timestamp is set too, which nothing had ever done.
 *
 * Returns whether a row was actually changed, so a caller cannot report
 * success for a packet that does not exist or is not theirs.
 */
export async function markPacketFinalized(packetId: string, ownerId: string): Promise<boolean> {
  const res = await query(
    `UPDATE board_packets SET status='finalized', finalized_at=datetime('now')
     WHERE id=? AND product_id IN (SELECT id FROM products WHERE owner_id=?)`,
    [packetId, ownerId]
  );
  return (res.rowsAffected ?? 0) > 0;
}
