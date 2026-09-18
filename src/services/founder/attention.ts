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
  kind: 'act' | 'advice' | 'noticed' | 'experiment' | 'charter';
  id: string;
  productId: string;
  companyName: string;
  summary: string;
  detail: string;
  /**
   * THE SAME FACT, STILL IN PIECES. When what is in the way is several things,
   * `detail` joins them into a sentence and this keeps them apart. A card with
   * room shows the rows; one without falls back to the sentence, so nothing
   * has to be said twice in two shapes on one screen.
   */
  points?: string[];
  /** The routes its own page posts to: yes, and no. */
  yes: { label: string; action: string; fields?: Record<string, string> };
  no: { label: string; action: string; fields?: Record<string, string> };
  why: string | null;
  href: string;
  /** When the answer is a place rather than a yes or no: the one link to open. */
  open?: { label: string; href: string };
  /** Where an act lands, when it can be said. Rendered as a pill beside it. */
  effect?: 'internal' | 'provider' | 'account' | 'public' | 'person';
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
  // THE FIRST REAL TEST WAITS ON HIM TOO. Undecided real experiments with
  // materials attached: either everything is in place and the answer is yes
  // or no here, or something of his is missing and the answer is the page
  // where he does it. Read through the same derivation the page uses.
  const tests: AttentionItem[] = [];
  const undecided = await rows(
    `SELECT e.id FROM venture_experiments e WHERE e.founder_id = ? AND e.evidence_mode = 'real' AND e.decision IS NULL AND e.validity = 'valid'
        AND e.retired_at IS NULL AND e.superseded_by IS NULL
        AND EXISTS (SELECT 1 FROM experiment_materials m WHERE m.experiment_id = e.id) ORDER BY e.proposed_at`, [founderId]);
  if (undecided.length) {
    const { getExperimentView } = await import('./experiment-view.js');
    for (const t of undecided) {
      const v = await getExperimentView(founderId, String(t.id));
      if (!v) continue;
      const open = v.steps.find((s) => s.status === 'todo' && s.key !== 'allow');
      tests.push({
        kind: 'experiment', id: v.id, productId: v.productId ?? '', companyName: v.assetName ?? 'A real test',
        summary: v.state === 'ready' ? `Allow the test: ${v.title}` : `The test needs you: ${open?.label.toLowerCase() ?? v.stateDetail}`,
        detail: v.state === 'ready' ? v.allow.explanation[0] : v.stateDetail,
        ...(v.blocking.length > 1 ? { points: v.blocking } : {}),
        yes: { label: 'Allow', action: `/foundry/experiments/${v.id}/allow` },
        no: { label: 'Do not run it', action: `/foundry/experiments/${v.id}/decline` },
        why: `/foundry/why/experiment/${v.id}`, href: `/foundry/experiments/${v.id}`,
        ...(v.state === 'ready' ? {} : { open: { label: open?.label ?? 'Open the test', href: open?.href ?? `/foundry/experiments/${v.id}` } }),
      });
    }
  }
  // AN APPROVED LISTING WAITS ON HIS OWN ACT: the shop, the listing, the
  // address pasted back. Foundry cannot do any of it, so the queue says so
  // rather than showing an approved test as quiet.
  const listed = await rows(
    `SELECT e.id FROM venture_experiments e
      WHERE e.founder_id = ? AND e.evidence_mode = 'real' AND e.decision = 'approved' AND e.ran_at IS NULL AND e.validity = 'valid'
        AND e.retired_at IS NULL AND e.superseded_by IS NULL
        AND EXISTS (SELECT 1 FROM experiment_materials m WHERE m.experiment_id = e.id AND m.kind = 'offer_shape' AND m.superseded_at IS NULL AND m.body LIKE '%"listing":%')
        AND NOT EXISTS (SELECT 1 FROM experiment_exposures x WHERE x.experiment_id = e.id AND x.withdrawn_at IS NULL)
      ORDER BY e.decided_at`, [founderId]);
  if (listed.length) {
    const { getExperimentView } = await import('./experiment-view.js');
    for (const t of listed) {
      const v = await getExperimentView(founderId, String(t.id));
      if (!v) continue;
      const open = v.steps.find((s) => s.key === 'listing');
      tests.push({
        kind: 'experiment', id: v.id, productId: v.productId ?? '', companyName: v.assetName ?? 'A real test',
        summary: `The test needs you: ${open?.label.toLowerCase() ?? 'list it and paste the address'}`, detail: v.stateDetail,
        yes: { label: 'Open the test', action: `/foundry/experiments/${v.id}` }, no: { label: 'Stop it', action: `/foundry/experiments/${v.id}#stop` },
        why: `/foundry/why/experiment/${v.id}`, href: `/foundry/experiments/${v.id}`,
        open: { label: open?.label ?? 'Open the test', href: `/foundry/experiments/${v.id}#listing` },
      });
    }
  }
  // THE WORKSHOP NEEDS HIM when something only he can supply is missing or
  // the world stopped carrying what was put up. One item, one place to go.
  const workshop: AttentionItem[] = [];
  const w = (await rows('SELECT founder_id, product_id, public_name, postal_address, health_json FROM public_workshop WHERE founder_id = ?', [founderId]))[0];
  if (w) {
    const health = w.health_json == null ? null : JSON.parse(String(w.health_json)) as Record<string, { status: string; detail: string }>;
    const needs: string[] = [];
    if (w.postal_address == null) needs.push('a postal address for commercial mail');
    for (const k of ['site', 'cloudflare', 'sending', 'replyInbox'] as const) if (health?.[k]?.status === 'needs_attention') needs.push(`${k === 'replyInbox' ? 'the reply inbox' : k === 'site' ? 'the public site' : k === 'sending' ? 'email sending' : 'Cloudflare'}: ${health[k].detail}`);
    if (needs.length) {
      workshop.push({
        kind: 'experiment', id: 'workshop', productId: String(w.product_id), companyName: String(w.public_name),
        summary: `The Workshop needs you: ${needs[0]}`, detail: needs.length > 1 ? `Also: ${needs.slice(1).join('; ')}.` : 'Everything else is in place.',
        ...(needs.length > 2 ? { points: needs.slice(1) } : {}),
        yes: { label: 'Open the Workshop', action: '/foundry/public-workshop' }, no: { label: 'Later', action: '/foundry/public-workshop' },
        why: null, href: '/foundry/public-workshop', open: { label: 'Open the Workshop', href: '/foundry/public-workshop' },
      });
    }
  }
  // THE BUTTON NAMES THE CONSEQUENCE. "Approve this one thing" is the same
  // label on an act that reads logs and an act that emails six customers. The
  // act's own consequence — from the subject he asked to be consulted on and
  // the rung it stands on — goes on the button and beside the summary.
  const { consequenceOfAct, isCannotSay, labelFor } = await import('./what-it-would-do.js');
  const actItems: AttentionItem[] = [];
  for (const a of acts) {
    const c = await consequenceOfAct(String(a.id));
    actItems.push({
      kind: 'act', id: String(a.id), productId: String(a.product_id), companyName: String(a.name),
      summary: String(a.summary), detail: `An act I cannot take until you say yes. Expires ${String(a.expires_at).slice(0, 10)}.`,
      yes: { label: isCannotSay(c) ? `Approve — ${String(a.summary)}` : labelFor(c), action: `/foundry/proposals/${String(a.id)}/approve` },
      no: { label: 'Do not do it', action: `/foundry/proposals/${String(a.id)}/refuse` },
      why: `/foundry/why/proposal/${String(a.id)}`, href: `/foundry/companies/${String(a.product_id)}#decide`,
      ...(isCannotSay(c) ? {} : { effect: c.effect }),
    });
  }
  // THE CHARTER ENDS ON A DATE HE CAN SEE. Seven days out it asks once, from
  // the front page, to be renewed as it stands or let lapse; nothing else
  // about it is a decision, and until then it asks nothing.
  const { envelopeReading } = await import('../institution/charter.js');
  const envelope = await envelopeReading(founderId);
  const charterItems: AttentionItem[] = envelope && envelope.charter.daysLeft <= 7 ? [{
    kind: 'charter', id: envelope.charter.id, productId: '', companyName: envelope.charter.publicVoice,
    summary: envelope.charter.daysLeft === 0 ? 'The charter ends today' : `The charter ends in ${String(envelope.charter.daysLeft)} ${envelope.charter.daysLeft === 1 ? 'day' : 'days'}`,
    detail: `Renewed, it stands as signed for another 90 days: $${(envelope.charter.monthlyCents / 100).toFixed(0)} a month, ${String(envelope.charter.probesInFlight)} probes in flight, $${(envelope.charter.cognitionCentsPerDay / 100).toFixed(2)} a day of thinking. Lapsed, every real test waits for you again.`,
    yes: { label: 'Renew for 90 days', action: '/foundry/controls/charter', fields: {
      monthly_dollars: (envelope.charter.monthlyCents / 100).toFixed(0), probes: String(envelope.charter.probesInFlight),
      thinking_dollars: (envelope.charter.cognitionCentsPerDay / 100).toFixed(2), statement: envelope.charter.statement, return_to: 'foundry' } },
    no: { label: 'Let it lapse', action: '/foundry/controls/charter/withdraw', fields: { reason: 'let lapse from the front page', return_to: 'foundry' } },
    why: null, href: '/foundry/controls#charter',
  }] : [];
  return [
    ...tests,
    ...workshop,
    ...actItems,
    ...advice.map((r): AttentionItem => ({
      kind: 'advice', id: String(r.id), productId: String(r.product_id), companyName: String(r.name),
      summary: String(r.summary), detail: 'What I would do about the situation. Agreeing starts nothing.',
      yes: { label: 'Do that', action: `/foundry/advice/${String(r.id)}/accept` },
      no: { label: 'Not that', action: `/foundry/advice/${String(r.id)}/decline` },
      why: `/foundry/why/advice/${String(r.id)}`, href: `/foundry/companies/${String(r.product_id)}#advice`,
    })),
    ...charterItems,
    ...noticed.map((n): AttentionItem => ({
      kind: 'noticed', id: String(n.id), productId: String(n.product_id), companyName: String(n.name),
      summary: String(n.proposed_responsibility), detail: String(n.rationale ?? 'Something I noticed and would look after, if you say so.'),
      yes: { label: 'Yes — look after this', action: `/letter/responsibility-candidates/${String(n.id)}/promote`, fields: { return_to: 'foundry' } },
      no: { label: 'No', action: `/letter/responsibility-candidates/${String(n.id)}/reject`, fields: { return_to: 'foundry' } },
      why: null, href: `/foundry/companies/${String(n.product_id)}#noticed`,
    })),
  ];
}
