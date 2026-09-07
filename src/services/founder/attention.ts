// =============================================================================
// FOUNDRY — Everything waiting on the owner, as one queue.
//
// Acts he must approve, advice he can agree to, things Foundry noticed and
// would look after, tests owed an answer: each lived on its own page and the
// first screen showed only the most important one. This reads them all, across
// his real companies, in the order the first screen already ranks them, so the
// rest can be answered where he is with one tap. It invents nothing: every
// item is a row, and every action is the form its own page already posts.
// =============================================================================
import { query } from '../../db/client.js';

export interface AttentionItem {
  kind: 'act' | 'advice' | 'noticed';
  id: string;
  productId: string;
  companyName: string;
  summary: string;
  detail: string;
  /** The routes its own page posts to: yes, and no. */
  yes: { label: string; action: string; fields?: Record<string, string> };
  no: { label: string; action: string; fields?: Record<string, string> };
  why: string | null;
  href: string;
}

type Row = Record<string, unknown>;
const rows = async (sql: string, params: unknown[]): Promise<Row[]> =>
  (await query(sql, params)).rows as unknown as Row[];

/** Everything waiting on him at his real companies, acts first. */
export async function waitingOn(founderId: string): Promise<AttentionItem[]> {
  // STANDING DOES NOT APPLY to what is waiting on him. An act proposed, advice
  // raised or a candidate noticed on an experimental asset is waiting on him
  // exactly as one on an earned company is; this queue shows the frontier as
  // the frontier. Reality still applies: an invented company waits for nobody.
  const acts = await rows(
    `SELECT a.id, a.summary, a.why, a.expires_at, p.id AS product_id, p.name FROM proposed_acts a
       JOIN products p ON p.id = a.product_id
      WHERE p.owner_id = ? AND p.reality = 'real' AND a.decision IS NULL AND a.revoked_at IS NULL
        AND a.expires_at > CURRENT_TIMESTAMP ORDER BY a.expires_at`, [founderId]);
  const advice = await rows(
    `SELECT r.id, r.summary, r.why, p.id AS product_id, p.name FROM situation_recommendations r
       JOIN products p ON p.id = r.product_id
       JOIN company_situations s ON s.id = r.situation_id AND s.ended_at IS NULL
      WHERE p.owner_id = ? AND p.reality = 'real' AND r.decided_at IS NULL ORDER BY r.raised_at`, [founderId]);
  const noticed = await rows(
    `SELECT rc.id, rc.proposed_responsibility, rc.rationale, p.id AS product_id, p.name FROM responsibility_candidates rc
       JOIN products p ON p.id = rc.product_id
      WHERE p.owner_id = ? AND p.reality = 'real' AND rc.status = 'pending' ORDER BY rc.created_at`, [founderId]);
  return [
    ...acts.map((a): AttentionItem => ({
      kind: 'act', id: String(a.id), productId: String(a.product_id), companyName: String(a.name),
      summary: String(a.summary), detail: `An act I cannot take until you say yes. Expires ${String(a.expires_at).slice(0, 10)}.`,
      yes: { label: 'Approve this one thing', action: `/foundry/proposals/${String(a.id)}/approve` },
      no: { label: 'Do not do it', action: `/foundry/proposals/${String(a.id)}/refuse` },
      why: `/foundry/why/proposal/${String(a.id)}`, href: `/foundry/companies/${String(a.product_id)}#decide`,
    })),
    ...advice.map((r): AttentionItem => ({
      kind: 'advice', id: String(r.id), productId: String(r.product_id), companyName: String(r.name),
      summary: String(r.summary), detail: 'What I would do about the situation. Agreeing starts nothing.',
      yes: { label: 'Do that', action: `/foundry/advice/${String(r.id)}/accept` },
      no: { label: 'Not that', action: `/foundry/advice/${String(r.id)}/decline` },
      why: `/foundry/why/advice/${String(r.id)}`, href: `/foundry/companies/${String(r.product_id)}#advice`,
    })),
    ...noticed.map((n): AttentionItem => ({
      kind: 'noticed', id: String(n.id), productId: String(n.product_id), companyName: String(n.name),
      summary: String(n.proposed_responsibility), detail: String(n.rationale ?? 'Something I noticed and would look after, if you say so.'),
      yes: { label: 'Yes — look after this', action: `/letter/responsibility-candidates/${String(n.id)}/promote`, fields: { return_to: 'foundry' } },
      no: { label: 'No', action: `/letter/responsibility-candidates/${String(n.id)}/reject`, fields: { return_to: 'foundry' } },
      why: null, href: `/foundry/companies/${String(n.product_id)}#noticed`,
    })),
  ];
}
