// =============================================================================
// FOUNDRY — Show your work, for anything the institution says.
//
// Every claim the owner meets on a screen descends the same way:
//
//   ANSWER   — the claim itself, the sentence he read
//   WHY      — the readings it was derived from
//   EVIDENCE · ASSUMPTIONS · ALTERNATIVES · UNCERTAINTY
//   ACTIVITY · OUTCOME · COST · AUTHORITY
//   TECHNICAL — the rows, for an engineer
//
// This is institutional state, never a model's chain of thought: every line
// here is read from a row that would survive replacing the model that wrote
// it. Where a level has nothing behind it, it says so; it is never padded.
// =============================================================================
import { query } from '../../db/client.js';
import { money } from './portfolio.js';

export type WhyKind = 'company' | 'advice' | 'proposal' | 'candidate' | 'experiment';
export const WHY_KINDS: ReadonlySet<string> = new Set(['company', 'advice', 'proposal', 'candidate', 'experiment']);

export interface Why {
  kind: WhyKind;
  id: string;
  /** The page title: "Why I say …". */
  title: string;
  /** Where this claim lives, so he can go up. */
  object: { kind: 'company' | 'search'; id: string | null; name: string; href: string };
  answer: string;
  because: string[];
  evidence: string[];
  assumptions: string[];
  alternatives: string[];
  uncertainty: string[];
  activity: string[];
  outcome: string[];
  cost: string[];
  authority: string[];
  technical: Array<[string, string]>;
}

type Row = Record<string, unknown>;
const rows = async (sql: string, params: unknown[]): Promise<Row[]> =>
  (await query(sql, params)).rows as unknown as Row[];
const day = (s: unknown): string => String(s ?? '').slice(0, 10);

/** Read the work behind one claim. Null when it is not his or does not exist. */
export async function whyOf(founderId: string, kind: string, id: string): Promise<Why | null> {
  switch (kind) {
    case 'company': return whyCompany(founderId, id);
    case 'advice': return whyAdvice(founderId, id);
    case 'proposal': return whyProposal(founderId, id);
    case 'candidate': return whyCandidate(founderId, id);
    case 'experiment': return whyExperiment(founderId, id);
    default: return null;
  }
}

async function ownedProduct(founderId: string, productId: string): Promise<Row | null> {
  const r = await rows(
    `SELECT id, name, reality, standing, from_opportunity_id FROM products
      WHERE id = ? AND owner_id = ? AND deleted_at IS NULL`, [productId, founderId]);
  return r[0] ?? null;
}

/** What he told Foundry not to do here, as authority lines. */
async function authorityOver(productId: string): Promise<string[]> {
  const bounds = await rows(
    `SELECT b.statement, s.owner_words, b.subject FROM owner_boundaries b
       JOIN owner_boundary_subjects s ON s.subject = b.subject
      WHERE b.product_id = ? AND b.lifted_at IS NULL ORDER BY b.set_at`, [productId]);
  const allowance = await rows(
    `SELECT statement, amount_cents FROM owner_allowances
      WHERE product_id = ? AND withdrawn_at IS NULL ORDER BY set_at DESC LIMIT 1`, [productId])
    .catch(() => [] as Row[]);
  const out = bounds.map((b) => `You told me not to ${String(b.owner_words)} here: “${String(b.statement)}”.`);
  if (allowance[0]) out.push(`You allowed up to ${money(Number(allowance[0].amount_cents))}: “${String(allowance[0].statement)}”.`);
  if (out.length === 0) out.push('You have set no boundary and no allowance for this company. I cannot act here anyway: every act is proposed and waits for your yes.');
  return out;
}

async function whyCompany(founderId: string, productId: string): Promise<Why | null> {
  const p = await ownedProduct(founderId, productId);
  if (!p) return null;
  const { whatSituation } = await import('./what-situation.js');
  const { whatTheNumbersSay } = await import('./what-the-numbers-say.js');
  const { currentSpell } = await import('./situation-chain.js');
  const { recentDecisions } = await import('../institution/standing-intent.js');
  const [situation, numbers, spell, decided] = await Promise.all([
    whatSituation(productId), whatTheNumbersSay(productId), currentSpell(productId),
    recentDecisions(productId, 5),
  ]);
  const senses = await rows(
    `SELECT cs.provider, cs.mode, cs.last_observed_at, cs.last_error, s.would_learn, s.sense_key
       FROM company_senses cs JOIN senses s ON s.sense_key = cs.sense_key
      WHERE cs.product_id = ? AND cs.disconnected_at IS NULL ORDER BY s.sort_order`, [productId]);
  const blind = await rows(
    `SELECT s.cannot_see FROM senses s WHERE s.sense_key NOT IN
       (SELECT sense_key FROM company_senses WHERE product_id = ? AND disconnected_at IS NULL)
       AND s.sense_key <> 'reference_world' ORDER BY s.sort_order`, [productId]);
  const advice = await rows(
    `SELECT summary, decision FROM situation_recommendations r
      WHERE r.product_id = ? AND r.situation_id = ? ORDER BY r.raised_at`,
    [productId, spell?.id ?? '']);
  const responsibilities = await rows(
    `SELECT title, state FROM institutional_responsibilities WHERE product_id = ? AND state <> 'unknown'
      ORDER BY title`, [productId]);
  const spend = await rows(
    `SELECT COALESCE(SUM(amount_cents),0) AS cents, COUNT(*) AS n FROM asset_money_spent
      WHERE product_id = ? AND recorded_at >= datetime('now','-30 day')`, [productId]);
  const name = String(p.name);
  const invented = String(p.reality) === 'reference';
  return {
    kind: 'company', id: productId,
    title: `Why I say this about ${name}`,
    object: { kind: 'company', id: productId, name, href: `/foundry/companies/${productId}` },
    answer: situation.headline,
    because: situation.because.length ? situation.because : ['Nothing reports on it, so this is what I say when I can see nothing.'],
    evidence: [
      ...numbers.numbers.map((n) => `${n.label}: ${n.now} — ${n.movement}.`),
      ...(numbers.absence ? [numbers.absence] : []),
      ...senses.map((s) => `${String(s.would_learn)}, from ${String(s.provider)}${
        String(s.mode) === 'reference' ? ' (invented)' : String(s.mode) === 'sandbox' ? ' (test mode)' : ''}; ${
        s.last_observed_at ? `last reported ${day(s.last_observed_at)}` : 'nothing reported yet'}.`),
    ],
    assumptions: [
      numbers.asOf ? `That the reading of ${numbers.asOf} is the latest true one, compared against the nearest reading to a month before.`
        : 'No readings, so nothing is assumed about the numbers.',
      invented ? 'Every number here is invented. The arithmetic is real; none of it is a fact about a real company.'
        : 'That what each connected source reports is what it says it reports. I check freshness, not truth.',
      ...(spell ? [`That the situation began ${day(spell.beganAt)}; before that it was different, and that history is on the company page.`] : []),
    ],
    alternatives: advice.length
      ? advice.map((a) => `${String(a.summary)} — ${a.decision === null ? 'raised, and waiting on you' : `you ${String(a.decision)} it`}.`)
      : ['I have not raised anything to do about this. Watching is the whole of what I am doing.'],
    uncertainty: [
      ...senses.filter((s) => s.last_error).map((s) => `${String(s.provider)} is failing: ${String(s.last_error)}. What I show from it may be out of date.`),
      ...blind.map((b) => `I cannot see ${String(b.cannot_see)}.`),
    ],
    activity: responsibilities.length
      ? responsibilities.map((r) => `${String(r.title)} — ${String(r.state).replaceAll('_', ' ')}.`)
      : ['I look after nothing here yet. I watch, and I have not been asked to carry anything.'],
    outcome: decided.length
      ? decided.map((d) => `${d.summary} — ${d.outcome}${d.used ? ', and done' : ''} on ${day(d.at)}.`)
      : ['No act has been approved or refused here.'],
    cost: [Number(spend[0]?.cents ?? 0) > 0
      ? `${money(Number(spend[0]?.cents))} spent in the last thirty days, across ${String(spend[0]?.n)} entries.`
      : 'Nothing spent for this company in the last thirty days.'],
    authority: await authorityOver(productId),
    technical: [
      ['product', productId], ['situation', situation.situation],
      ["situation row", spell?.id ?? "none"], ['began', spell ? day(spell.beganAt) : 'n/a'],
      ['reality', String(p.reality)], ['standing', String(p.standing)],
      ['tables', 'products, company_situations, situation_recommendations, metric_snapshots, company_senses, institutional_responsibilities, proposed_acts, asset_money_spent, owner_boundaries, owner_allowances'],
    ],
  };
}

async function whyAdvice(founderId: string, adviceId: string): Promise<Why | null> {
  const r = (await rows(
    `SELECT r.id, r.product_id, r.kind, r.summary, r.why, r.would_need, r.raised_at, r.decided_at,
            r.decision, r.situation_id, s.headline, s.because_json, s.evidence_mode, s.began_at,
            p.name
       FROM situation_recommendations r
       JOIN products p ON p.id = r.product_id
       LEFT JOIN company_situations s ON s.id = r.situation_id
      WHERE r.id = ? AND p.owner_id = ?`, [adviceId, founderId]))[0];
  if (!r) return null;
  const others = await rows(
    `SELECT summary, decision FROM situation_recommendations WHERE situation_id = ? AND id <> ?`,
    [String(r.situation_id), adviceId]);
  let because: string[] = [];
  try { because = JSON.parse(String(r.because_json ?? '[]')) as string[]; } catch { because = []; }
  const productId = String(r.product_id);
  return {
    kind: 'advice', id: adviceId,
    title: `Why I raised this for ${String(r.name)}`,
    object: { kind: 'company', id: productId, name: String(r.name), href: `/foundry/companies/${productId}` },
    answer: String(r.summary),
    because: [String(r.why)],
    evidence: [`The situation it answers: ${String(r.headline ?? 'none recorded')}.`, ...because],
    assumptions: [`That I would have ${String(r.would_need)}.`,
      String(r.evidence_mode) === 'reference' ? 'The situation is invented; so is this advice.' : 'Read from real readings.'],
    alternatives: [
      ...others.map((o) => `${String(o.summary)} — ${o.decision === null ? 'also raised' : `you ${String(o.decision)} it`}.`),
      'Doing nothing: the situation stays as it is and I keep watching.',
    ],
    uncertainty: ['Advice is a sentence about what I would do. It is not a prediction of what would happen; a test would be.'],
    activity: [`Raised ${day(r.raised_at)}${r.began_at ? `, against a situation that began ${day(r.began_at)}` : ''}.`],
    outcome: [r.decision === null ? 'Waiting on you.' : `You ${String(r.decision)} it on ${day(r.decided_at)}.`],
    cost: ['Nothing. Agreeing starts nothing and spends nothing.'],
    authority: ['Agreeing is not authorising. Where an act is needed it is proposed separately and waits for your yes to that exact act.',
      ...await authorityOver(productId)],
    technical: [['situation_recommendations', adviceId], ['kind', String(r.kind)],
      ['situation', String(r.situation_id)], ['product', productId]],
  };
}

async function whyProposal(founderId: string, actId: string): Promise<Why | null> {
  const a = (await rows(
    `SELECT a.*, r.what_it_means, r.putting_it_back, r.absorbable, p.name,
            (SELECT b.statement FROM owner_boundaries b WHERE b.product_id = a.product_id
                AND b.subject = a.subject AND b.lifted_at IS NULL LIMIT 1) AS boundary
       FROM proposed_acts a
       JOIN products p ON p.id = a.product_id
       LEFT JOIN consequence_rungs r ON r.rung = a.rung
      WHERE a.id = ? AND p.owner_id = ?`, [actId, founderId]))[0];
  if (!a) return null;
  const productId = String(a.product_id);
  const state = a.revoked_at ? `You took the approval back on ${day(a.revoked_at)}${a.revoke_reason ? ` — ${String(a.revoke_reason)}` : ''}.`
    : a.decision === null ? `Waiting on you. If you do nothing it expires ${day(a.expires_at)} and nothing happens.`
      : `You ${String(a.decision)} it on ${day(a.decided_at)}${a.consumed_at ? `, and I did it on ${day(a.consumed_at)}` : a.decision === 'approved' ? ', and I have not used that yet' : ''}.`;
  return {
    kind: 'proposal', id: actId,
    title: `Why I am asking to do this at ${String(a.name)}`,
    object: { kind: 'company', id: productId, name: String(a.name), href: `/foundry/companies/${productId}` },
    answer: String(a.summary),
    because: [String(a.why)],
    evidence: [`What I expect: ${String(a.expected_effect)}`],
    assumptions: [a.rung ? `That this ${String(a.what_it_means)}. Putting it back: ${String(a.putting_it_back ?? 'not stated')}.`
      : 'I have not classified what kind of act this is, so treat it as though it cannot be undone.'],
    alternatives: ['Not doing it. Nothing happens, and I will not raise the same act again.'],
    uncertainty: [`What could go wrong: ${String(a.risk)}`],
    activity: [`Proposed ${day(a.proposed_at)} by ${String(a.proposed_by)}.`],
    outcome: [state],
    cost: [a.cost_cents == null ? 'I do not know what it costs.' : `${money(Number(a.cost_cents))}.`],
    authority: [
      a.boundary ? `I am asking because you said: “${String(a.boundary)}”.` : 'I am asking because I do not act here without a yes.',
      Number(a.absorbable ?? 1) === 0 ? 'Nothing you could set up would let me do this on my own. It is yours, one act at a time.'
        : 'A yes covers only this one act, exactly as described.',
    ],
    technical: [['proposed_acts', actId], ['subject', String(a.subject)], ['rung', String(a.rung ?? 'unclassified')],
      ['consequence', String(a.consequence)], ['product', productId],
      ...(a.experiment_id ? [['experiment', String(a.experiment_id)] as [string, string]] : [])],
  };
}

async function whyCandidate(founderId: string, opportunityId: string): Promise<Why | null> {
  const o = (await rows(
    `SELECT o.*, m.statement FROM venture_opportunities o JOIN venture_mandates m ON m.id = o.mandate_id
      WHERE o.id = ? AND o.founder_id = ?`, [opportunityId, founderId]))[0];
  if (!o) return null;
  const { candidatesFor } = await import('../venture/mandate.js');
  const { whatWasTried } = await import('../venture/validation.js');
  const presented = (await candidatesFor(String(o.mandate_id))).find((c) => c.id === opportunityId) ?? null;
  const tried = await whatWasTried(opportunityId);
  let sources: string[] = []; let unknowns: string[] = [];
  try { sources = JSON.parse(String(o.sources_json ?? '[]')) as string[]; } catch { sources = []; }
  try {
    unknowns = (JSON.parse(String(o.unknowns_json ?? '[]')) as Array<string | { question?: string }>)
      .map((u) => typeof u === 'string' ? u : String(u.question ?? ''));
  } catch { unknowns = []; }
  const invented = String(o.evidence_mode) === 'reference';
  return {
    kind: 'candidate', id: opportunityId,
    title: 'Why I brought you this',
    object: { kind: 'search', id: String(o.mandate_id), name: String(o.statement), href: '/foundry/searching' },
    answer: String(o.headline),
    because: [String(o.why_it_might)],
    evidence: [
      `Who has it: ${String(o.who_has_it)}.`, `The problem: ${String(o.the_problem)}.`,
      ...(presented?.standing ?? []).map((s) => `${s.claim}: ${String(s.supports)} for, ${String(s.contradicts)} against (${String(s.direct)} direct, ${String(s.stale)} stale).`),
      ...sources.map((s) => `Source: ${s}`),
      ...(invented ? ['All of this is invented, for a search I made up.'] : []),
    ],
    assumptions: unknowns.length ? unknowns.map((u) => `Open: ${u}`) : ['No open unknowns are recorded.'],
    alternatives: [`What would kill it: ${String(o.kill_thesis)}.`,
      ...(presented?.against ?? []).map((a) => `Against your stated preference: ${a}.`),
      'Burying it. I remember why and do not bring the same thing again unless something changes.'],
    uncertainty: [
      ...(presented?.blockedBy ? [`Cannot be advanced: ${presented.blockedBy}.`] : []),
      ...(presented?.failsBecause ? [`Fails your guidance: ${presented.failsBecause}.`] : []),
      ...(unknowns.length ? [`${String(unknowns.length)} ${unknowns.length === 1 ? 'question is' : 'questions are'} still open; a test settles them, not more reading.`] : []),
    ],
    activity: tried.length
      ? tried.map((t) => `${t.whatWeDo} — ${t.decision === null ? 'proposed' : t.decision}${t.ranAt ? `, ran ${day(t.ranAt)}` : ''}${t.verdict ? `, ${t.verdict.replace('_', ' ')}` : ''}.`)
      : ['No test has been designed for it yet.'],
    outcome: [o.verdict ? `${String(o.verdict)} on ${day(o.decided_at)}${o.verdict_why ? ` — ${String(o.verdict_why)}` : ''}.` : 'Undecided. Advancing or burying it is yours.'],
    cost: [tried.length ? `${money(tried.reduce((n, t) => n + t.costCents, 0))} across ${String(tried.length)} ${tried.length === 1 ? 'test' : 'tests'}.` : 'Nothing spent.'],
    authority: ['I can find and test. Making it a company is yours to do, and I have not made one.'],
    technical: [['venture_opportunities', opportunityId], ['mandate', String(o.mandate_id)],
      ['evidence_mode', String(o.evidence_mode)], ['found', day(o.found_at)]],
  };
}

async function whyExperiment(founderId: string, experimentId: string): Promise<Why | null> {
  const e = (await rows(
    `SELECT e.opportunity_id, e.decided_by, e.decided_at, e.evidence_mode, e.proposed_at, o.headline
       FROM venture_experiments e JOIN venture_opportunities o ON o.id = e.opportunity_id
      WHERE e.id = ? AND e.founder_id = ?`, [experimentId, founderId]))[0];
  if (!e) return null;
  const { whatWasTried } = await import('../venture/validation.js');
  const t = (await whatWasTried(String(e.opportunity_id))).find((x) => x.id === experimentId);
  if (!t) return null;
  const resolutions = await rows(
    `SELECT verdict, because, resolved_by, resolved_at FROM prediction_resolutions WHERE prediction_id = ?`,
    [experimentId]);
  return {
    kind: 'experiment', id: experimentId,
    title: 'Why I expect this',
    object: { kind: 'search', id: String(e.opportunity_id), name: String(e.headline), href: `/foundry/why/candidate/${String(e.opportunity_id)}` },
    answer: t.whatWeExpect,
    because: [`The question it settles: ${t.question}`, `What I do: ${t.whatWeDo}`],
    evidence: t.whatHappened ? [`What happened: ${t.whatHappened}`] : ['It has not run, so there is no evidence yet — only a prediction, sealed so the result can disagree with me.'],
    assumptions: [`What would disprove it: ${t.wouldDisprove}`,
      ...(t.settlesWhen ? [`Settles when: ${t.settlesWhen}`] : [])],
    alternatives: ['Declining it: the question stays open, and it stays in the way of this becoming a company.'],
    uncertainty: t.validity === 'invalid'
      ? [`Invalid: ${t.invalidBecause ?? 'it did not measure what it was for'}. It has no verdict and is re-run, not read.`]
      : ['One test answers one question. A result is what the world did once, not what it will do.'],
    activity: [`Proposed ${day(e.proposed_at)}.`, t.decision ? `You ${t.decision} it${e.decided_at ? ` on ${day(e.decided_at)}` : ''}.` : 'Waiting on you.',
      ...(t.ranAt ? [`Ran ${day(t.ranAt)}.`] : [])],
    outcome: [
      t.verdict ? `${t.verdict.replace('_', ' ')}.` : 'No verdict yet.',
      ...resolutions.map((r) => `Resolved ${String(r.verdict).replace('_', ' ')} by ${String(r.resolved_by)} on ${day(r.resolved_at)}: ${String(r.because)}`),
    ],
    cost: [t.costCents > 0 ? `${money(t.costCents)}.` : 'Nothing.'],
    authority: [`Decided by ${e.decided_by ? String(e.decided_by) : 'nobody yet'}. I cannot run a test you have not approved.`],
    technical: [['venture_experiments', experimentId], ['opportunity', String(e.opportunity_id)],
      ['validity', t.validity], ['evidence_mode', String(e.evidence_mode)],
      ...(t.rerunOf ? [['rerun_of', t.rerunOf] as [string, string]] : [])],
  };
}
