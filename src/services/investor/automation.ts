// =============================================================================
// FOUNDRY — Investor & Board Automation
// Auto-generated updates, board decks, fundraise readiness, data rooms.
// =============================================================================

import { query } from '../../db/client.js';
import { callOpus, callSonnet, parseJSONResponse } from '../ai/client.js';
import { nanoid } from 'nanoid';

// `generateInvestorUpdate` was here — the second writer into
// `investor_updates`, and the one that never set `month`. Every dashboard read
// keys on that column: `WHERE product_id=? AND month=?` for the duplicate
// check, `ORDER BY month DESC` for the list. So an update created through the
// API was invisible to the surface that shows updates AND invisible to the
// check that stops a second one being written for the same month.
//
// The canonical writer is in services/scp/investor/investor-update.ts, and it
// deliberately fills both generations of column names so every reader of
// either sees the same update. Retired in migration 164, which backfills
// `month` and `draft_text` for the rows this one left behind.

export async function generateBoardDeck(productId: string, ownerId: string): Promise<{ id: string; slides: string[] }> {
  const product = await query('SELECT name, sector_profile, growth_stage FROM products WHERE id = ?', [productId]);
  const p = product.rows[0] as Record<string, string> | undefined;

  const prompt = `Generate board deck slide content (text only) for a quarterly board meeting.

Product: ${p?.name ?? 'Unknown'} (${p?.sector_profile ?? 'SaaS'}, ${p?.growth_stage ?? 'growth'})

Generate 6-8 slides:
1. Executive Summary (3 bullets)
2. Key Metrics (MRR, growth, churn, NPS)
3. Customer Health (cohort trends, churn analysis)
4. Product & Engineering (shipped, roadmap)
5. Competitive Landscape
6. Financial Overview (runway, unit economics)
7. Asks & Discussion Topics
8. Next Quarter Priorities

Return JSON: {"slides": ["slide 1 content", "slide 2 content", ...]}`;

  const response = await callOpus(
    'You are writing board meeting slides for a SaaS startup. Be strategic and data-focused.',
    prompt,
    4096,
    productId
  );

  const result = parseJSONResponse<{ slides: string[] }>(response.content);
  const id = nanoid();
  const period = new Date().toISOString().slice(0, 7);

  await query(
    `INSERT INTO board_decks (id, product_id, owner_id, period, slides, status) VALUES (?, ?, ?, ?, ?, 'draft')`,
    [id, productId, ownerId, period, JSON.stringify(result.slides)]
  );

  return { id, slides: result.slides };
}

// `assessFundraiseReadiness` was here. It wrote into `fundraise_readiness`,
// which nothing has ever read — no page, no response, no prompt, no job. The
// API route that called it returns the assessment in its response body, so its
// caller loses nothing; only the row was pointless. Retired in migration 165,
// and the route now computes through the canonical round-based assessment in
// services/scp/investor/fundraising-readiness.ts.
