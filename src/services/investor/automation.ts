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

/**
 * A BOARD DECK ASSEMBLED FROM WHAT THE COMPANY ACTUALLY REPORTED.
 *
 * This asked a model for eight slides including "Key Metrics (MRR, growth,
 * churn, NPS)", "Customer Health (cohort trends, churn analysis)" and
 * "Financial Overview (runway, unit economics)" — and passed it the company's
 * NAME, SECTOR AND STAGE. Nothing else. No metric, no customer, no runway.
 *
 * So every number on those slides was invented, by a model told to be
 * "data-focused", in a document a founder takes to their investors. Of every
 * claim-without-evidence in this repository this is the one with the furthest
 * reach: the others mislead the founder, and this one is handed onward by them
 * to people making funding decisions.
 *
 * The company's real figures are passed now, through `ai/measured.ts`, which
 * says `unknown` where nothing was reported rather than letting a fallback
 * become a fact. And the model is told, in the system prompt, that unknown must
 * survive to the slide — because a model asked for a board deck will otherwise
 * write a plausible number over a gap without being asked to.
 *
 * `board_decks` stays on the unread-tables baseline. The route returns the deck
 * to its caller, so nothing is lost by nobody reading the row; whether a
 * founder should be able to retrieve a past deck is a product question, and the
 * two sibling functions retired from this file (migrations 164 and 165) show
 * what happens when that question is answered by writing a row and hoping.
 */
export async function generateBoardDeck(productId: string, ownerId: string): Promise<{ id: string; slides: string[] }> {
  const product = await query('SELECT name, sector_profile, growth_stage FROM products WHERE id = ?', [productId]);
  const p = product.rows[0] as Record<string, string> | undefined;

  const { pctOfFraction, measured, money } = await import('../ai/measured.js');

  const metricsRow = (await query(
    `SELECT mrr_cents, churn_rate, activation_rate, day_30_retention, nps_score,
            active_users, new_mrr_cents, churned_mrr_cents, snapshot_date
       FROM metric_snapshots WHERE product_id = ?
      ORDER BY snapshot_date DESC LIMIT 1`, [productId]))
    .rows[0] as Record<string, unknown> | undefined;

  const { getCompanyCustomers, getCustomersAtRisk, getFallingCustomers } =
    await import('../institution/company-customers.js');
  const [customers, atRisk, falling] = await Promise.all([
    getCompanyCustomers(productId), getCustomersAtRisk(productId),
    getFallingCustomers(productId),
  ]);

  const { getFinancialPosition } = await import('../financial/position.js');
  const position = await getFinancialPosition(productId);

  const competitorRows = (await query(
    'SELECT name FROM competitors WHERE product_id = ? LIMIT 8', [productId]))
    .rows as unknown as Array<Record<string, unknown>>;

  const facts = [
    `As of: ${metricsRow?.snapshot_date ? String(metricsRow.snapshot_date) : 'no metric snapshot has ever been reported'}`,
    `MRR: ${money(metricsRow?.mrr_cents)}`,
    `New MRR this period: ${money(metricsRow?.new_mrr_cents)}`,
    `Churned MRR this period: ${money(metricsRow?.churned_mrr_cents)}`,
    `Churn rate: ${pctOfFraction(metricsRow?.churn_rate)}`,
    `Activation rate: ${pctOfFraction(metricsRow?.activation_rate)}`,
    `30-day retention: ${pctOfFraction(metricsRow?.day_30_retention)}`,
    `NPS: ${measured(metricsRow?.nps_score, 1)}`,
    `Active users: ${measured(metricsRow?.active_users)}`,
    `Customers on record: ${customers.length}`,
    `Customers currently at risk: ${atRisk.length}`,
    `Customers whose health is falling: ${falling.length}`,
    position === null
      ? 'Cash and burn: not stated by the founder, so runway cannot be computed'
      : `Cash on hand: ${money(position.cashOnHandCents)}; monthly burn: `
        + `${money(position.monthlyBurnCents)}; as of ${position.asOfDate}`,
    competitorRows.length
      ? `Competitors on record: ${competitorRows.map((c) => String(c.name)).join(', ')}`
      : 'Competitors on record: none',
  ].join('\n');

  const prompt = `Generate board deck slide content (text only) for a quarterly board meeting.

Product: ${p?.name ?? 'Unknown'} (${p?.sector_profile ?? 'SaaS'}, ${p?.growth_stage ?? 'growth'})

THE COMPANY'S REPORTED FIGURES — the only numbers you may state:
${facts}

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
    'You are writing board meeting slides for a SaaS startup. Be strategic and data-focused.\n\n'
    + 'EVERY NUMBER YOU WRITE MUST COME FROM THE REPORTED FIGURES GIVEN TO YOU. '
    + 'Where a figure reads "unknown", or is absent from that list, say so on the '
    + 'slide in plain words — "not yet measured", "no snapshot reported" — and do '
    + 'NOT estimate, interpolate, illustrate or use a placeholder. This deck goes '
    + 'to investors. A slide that says a number is not known is useful; a slide '
    + 'with an invented number on it is a false statement made by the founder to '
    + 'people deciding whether to fund them. Sections about plans, priorities and '
    + 'discussion topics may be written freely — the constraint is on FACTS about '
    + 'this company, not on prose.',
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
