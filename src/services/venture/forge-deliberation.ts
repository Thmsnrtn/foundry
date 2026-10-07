// =============================================================================
// FOUNDRY — the forge deliberates: five lenses, one design, one attacker
//
// The forge used to have no button, on purpose: an experiment is the most
// expensive thing this institution does, and the sentences that decide one —
// what it settles, which exchange, what it can and cannot prove, where it
// stops — were the owner's or nobody's. Every real design was written by hand.
//
// A studio cannot run on hand-written designs, and the owner asked not to be
// the job. So the forge now writes them, under a discipline that is stricter
// than a person's, not looser:
//
//   THE LENSES COME FIRST AND ARE KEPT. Five disciplines each read the record
//   — the candidate, its evidence with addresses, its unknowns, the legal
//   picture, the lessons of settled tests, the charter — and say what they see
//   and on what rows. Each finding is written before the design is composed,
//   so the design can be checked against what was actually found, and the
//   row guard refuses a forge design with fewer than five findings behind it.
//
//   THE COMPOSER IS NOT THE ATTACKER. One call composes the design from the
//   findings. A separate call is given only the draft and told to break it;
//   an attack that names an amendable sentence and a better one becomes an
//   amendment in the ledger, signed by the adversary; an attack that says the
//   design should not run is recorded and stops the forge from sealing.
//
//   THE RULE THAT SEALS IS NEITHER. A design is sealed only when it recommends
//   running, nothing the design itself names stands in the way, the attacker
//   did not object, and the probe is inside the charter the owner signed. Any
//   other outcome leaves the design unsealed for him, with every reason on
//   the page, and costs him nothing until he looks.
//
//   NOTHING HERE MAY INVENT A FACT. The lenses may create readings, questions
//   and designs. They may not create pain, demand, prices, counts or names not
//   in the record in front of them, and the prompt says so in the same words
//   the reader uses. A number in a finding that is not in the record is a
//   defect, and the grounds each finding must cite are how it is caught.
// =============================================================================
import { fourQuestionsOf } from './economic-forms.js';
import { nanoid } from 'nanoid';
import { query } from '../../db/client.js';
import { callOpus, callSonnet, ModelDoorError, ModelReplyRefused } from '../ai/client.js';
import { numbersNotIn } from './invented-numbers.js';
import { dataBlockInstruction } from '../ai/sanitize.js';
import { shieldUntrustedContent } from '../ai/prompt-shield.js';
import { institutionSpend } from '../ai/what-it-is-for.js';
import { bearingAsRead } from './market-evidence.js';
import {
  amendDesign, designOf, designStandsInTheWay, exchanges, recordDesign, sealDesign,
} from './probe-design.js';
import type { AmendableField, CostLevel, Exchange, ProbeDesign, Recommendation, StopKind } from './probe-design.js';

export const LENSES = [
  'market_reality', 'experimental_design', 'commercial_operations', 'risk_ethics_compliance', 'economics_portfolio',
] as const;
export type Lens = typeof LENSES[number];

const WHAT_EACH_LENS_ASKS: Record<Lens, string> = {
  market_reality: 'Whose problem is this, on the evidence, and how sure can anyone be that it hurts? Which observation says so, which contradicts it, and what is still unknown that reading cannot settle?',
  experimental_design: 'What is the one thing a small real test could settle here, which exchange would settle it, what would a null result be unable to distinguish, and what must be written down before the answer arrives?',
  commercial_operations: 'What would actually have to be made, delivered and supported if it worked, by software with no person on call? What breaks first, and what is owed to a buyer afterwards?',
  risk_ethics_compliance: 'Who could be harmed or misled, what the legal picture already says, what the contact rules forbid, and what an irreversible act here would look like. Say plainly what is never inside a charter.',
  economics_portfolio: 'What it would cost in cash, attention and reputation against what it could earn as one small trickle among many; what it correlates with in the portfolio; and whether it is worth a place in flight this month.',
};

export const FORGE = 'forge';
export const ADVERSARY = 'forge:adversary';
type Row = Record<string, unknown>;
const rows = async (sql: string, params: unknown[]): Promise<Row[]> => (await query(sql, params)).rows as unknown as Row[];
const one = async (sql: string, params: unknown[]): Promise<Row | null> => (await rows(sql, params))[0] ?? null;

// ─── The record a deliberation reads ─────────────────────────────────────────

export interface TheRecord {
  founderId: string;
  experiment: { id: string; opportunityId: string; whatWeDo: string; whatWeExpect: string; wouldDisprove: string; costCents: number; unknown: string };
  candidate: { headline: string; whoHasIt: string; theProblem: string; whyItMight: string; killThesis: string; lighter: string | null };
  evidence: Array<{ sourceType: string; stance: string | null; bearing: string; saw: string; source: string; observedAt: string; fromAbsence: boolean }>;
  /** The retrievals the evidence came from: the words the eyes were asked with, and what came back. A brief can be built only from these. */
  retrievals: Array<{ sourceType: string; terms: string; source: string; returned: number; relevant: number; at: string }>;
  unknowns: Array<{ question: string; blocking: boolean; cheapestTest: string | null; asks: 'demand' | 'distribution' | 'conversion' | 'fulfilment' }>;
  /** Each with the test it came from, so a design can record which lessons it read. */
  lessons: Array<{ experimentId: string; whatWeDid: string; verdict: string | null; couldNotEstablish: string | null }>;
  /** WHAT IS ALREADY KNOWN ABOUT THIS CANDIDATE, with its scope: the settled tests on it, and whether the proposed act repeats one. */
  precedent: { stands: 'clear' | 'asked_before' | 'narrowed'; because: string; settled: string[] };
  legal: { sentence: string; inTheWay: string[] };
  charter: { monthlyCents: number; remainingCents: number; probesInFlight: number; inFlight: number; contactRules: string; publicVoice: string } | null;
  exchanges: Array<{ exchange: Exchange; whatItIs: string; reveals: string; confounds: string; available: boolean }>;
  costDimensions: Array<{ dimension: string; whatItIs: string }>;
  stopKinds: Array<{ kind: StopKind; whatItIs: string }>;
  /**
   * WHAT THIS KIND OF THING TAKES, as far as a source has shown it
   * (`form-knowledge.ts`): the form its own sentences name, each sourced fact
   * with its grade, the aspects nobody has shown, and what could serve it
   * today. Institution-written, never a model's; demand is never among it.
   */
  form: { kind: string; known: string[]; notKnown: string[]; canServe: string };
}

/** Only rows. Nothing here is written by a model, and nothing a model wrote elsewhere is read as fact. */
export async function theRecordOf(experimentId: string): Promise<TheRecord | null> {
  const e = await one(
    `SELECT e.id, e.founder_id, e.opportunity_id, e.what_we_do, e.what_we_expect, e.would_disprove, e.cost_cents,
            u.question AS unknown, o.headline, o.who_has_it, o.the_problem, o.why_it_might, o.kill_thesis, o.lighter_architecture
       FROM venture_experiments e
       JOIN market_unknowns u ON u.id = e.unknown_id
       JOIN venture_opportunities o ON o.id = e.opportunity_id
      WHERE e.id = ? AND e.evidence_mode = 'real'`, [experimentId]);
  if (!e) return null;
  const founderId = String(e.founder_id);
  const opportunityId = String(e.opportunity_id);
  const evidence = (await rows(
    `SELECT o.source_type, t.epistemic_stance, o.bearing, o.saw, o.source, o.observed_at, o.from_absence
       FROM market_observations o
       JOIN market_claims c ON c.id = o.claim_id
       LEFT JOIN market_source_types t ON t.source_type = o.source_type
      WHERE (c.opportunity_id = ? OR c.seed_id IN (SELECT id FROM opportunity_seeds WHERE promoted_to = ?))
        AND o.evidence_mode = 'real'
      ORDER BY o.observed_at DESC, o.rowid DESC LIMIT 40`, [opportunityId, opportunityId])).map((r) => ({
    sourceType: String(r.source_type), stance: r.epistemic_stance == null ? null : String(r.epistemic_stance),
    // WHAT A STRANGER WROTE IS EVIDENCE, NOT AN ORDER. A post is stored as the
    // world said it, and that is right; what reaches a model is shielded here,
    // so text addressed to the model arrives as a redaction it can see rather
    // than as an instruction it might follow. The fence below does the rest.
    // A SEARCH THAT FOUND NOTHING IS NOT SUPPORT (F1.7): it reaches the
    // lenses as `found_nothing`, not as the `supports` it was filed as.
    bearing: bearingAsRead(r.bearing, r.from_absence), saw: shieldUntrustedContent(String(r.saw).slice(0, 400)).sanitized, source: String(r.source),
    observedAt: String(r.observed_at).slice(0, 10), fromAbsence: Number(r.from_absence) === 1,
  }));
  const retrievals = (await rows(
    `SELECT DISTINCT r.source_type, r.terms, r.source, r.returned_count, r.relevant_count, r.retrieved_at
       FROM market_retrievals r
      WHERE r.founder_id = ? AND r.evidence_mode = 'real' AND r.id IN (
        SELECT o.retrieval_id FROM market_observations o
          JOIN market_claims c ON c.id = o.claim_id
         WHERE o.retrieval_id IS NOT NULL
           AND (c.opportunity_id = ? OR c.seed_id IN (SELECT id FROM opportunity_seeds WHERE promoted_to = ?)))
      ORDER BY r.relevant_count DESC, r.retrieved_at DESC LIMIT 12`, [founderId, opportunityId, opportunityId])).map((r) => ({
    sourceType: String(r.source_type), terms: String(r.terms), source: String(r.source),
    returned: Number(r.returned_count), relevant: Number(r.relevant_count), at: String(r.retrieved_at).slice(0, 10),
  }));
  const unknowns = (await rows(
    `SELECT question, blocking, cheapest_test FROM market_unknowns
      WHERE opportunity_id = ? AND answered_at IS NULL AND kind = 'question' ORDER BY blocking DESC, rowid`, [opportunityId]))
    .map((r) => ({ question: String(r.question), blocking: Number(r.blocking) === 1, cheapestTest: r.cheapest_test == null ? null : String(r.cheapest_test), asks: fourQuestionsOf(String(r.question)) }));
  const { lessonsFor } = await import('./forge.js');
  const lessons = (await lessonsFor(founderId)).filter((l) => l.experimentId !== String(e.id))
    .map((l) => ({ experimentId: l.experimentId, whatWeDid: l.whatWeDid, verdict: l.verdict, couldNotEstablish: l.couldNotEstablish }));
  const { precedentOfExperiment } = await import('./precedent.js');
  const p = await precedentOfExperiment(experimentId);
  const precedent = { stands: p?.stands ?? 'clear' as const, because: p?.because ?? 'no test on this candidate has settled',
    settled: [...(p?.sameQuestion ?? []), ...(p?.nearby ?? [])].map((s) => s.line) };
  const { legalPictureOf } = await import('./legal-surface.js');
  const picture = await legalPictureOf({ founderId, opportunityId, world: 'real' });
  const { envelopeReading } = await import('../institution/charter.js');
  const envelope = await envelopeReading(founderId);
  const x = await exchanges();
  const { subscriptionsRunnable } = await import('./hand.js');
  const subscriptions = await subscriptionsRunnable(founderId);
  const costDimensions = (await rows('SELECT dimension, what_it_is FROM probe_cost_dimensions ORDER BY sort_order', []))
    .map((r) => ({ dimension: String(r.dimension), whatItIs: String(r.what_it_is) }));
  const stopKinds = (await rows('SELECT kind, what_it_is FROM probe_stop_kinds ORDER BY sort_order', []))
    .map((r) => ({ kind: String(r.kind) as StopKind, whatItIs: String(r.what_it_is) }));
  // The form the candidate's own sentences name, as its shelf names it.
  const { formOf } = await import('./economic-forms.js');
  const { whatAFormTakes, ASPECT_WORDS } = await import('./form-knowledge.js');
  const takes = await whatAFormTakes(formOf([
    { said: String(e.headline), where: 'its headline' },
    { said: String(e.the_problem), where: 'the problem it names' },
    { said: String(e.why_it_might), where: 'why it might work' },
  ]).form, founderId);
  return {
    founderId,
    experiment: { id: String(e.id), opportunityId, whatWeDo: String(e.what_we_do), whatWeExpect: String(e.what_we_expect),
      wouldDisprove: String(e.would_disprove), costCents: Number(e.cost_cents), unknown: String(e.unknown) },
    candidate: { headline: String(e.headline), whoHasIt: String(e.who_has_it), theProblem: String(e.the_problem),
      whyItMight: String(e.why_it_might), killThesis: String(e.kill_thesis), lighter: e.lighter_architecture == null ? null : String(e.lighter_architecture) },
    evidence, retrievals, unknowns, lessons, precedent,
    legal: { sentence: picture.sentence, inTheWay: picture.inTheWay },
    charter: envelope ? { monthlyCents: envelope.charter.monthlyCents, remainingCents: envelope.remainingCents,
      probesInFlight: envelope.charter.probesInFlight, inFlight: envelope.inFlight,
      contactRules: envelope.charter.contactRules, publicVoice: envelope.charter.publicVoice } : null,
    // A SUBSCRIPTION IS AVAILABLE TO THIS OWNER, NOT TO THE INSTITUTION: only
    // once they have allowed it and Foundry could cancel one (hand.ts).
    exchanges: x.map((f) => ({ exchange: f.exchange, whatItIs: f.whatItIs, reveals: f.reveals, confounds: f.confounds,
      available: f.available && (f.exchange !== 'subscription' || subscriptions.ok) })),
    costDimensions, stopKinds,
    form: { kind: takes.label, known: takes.known.map((k) => `${k.claim} (${k.source.title}, read ${k.read}, grade ${k.grade})`),
      notKnown: takes.unknown.map((a) => ASPECT_WORDS[a]), canServe: takes.canServe },
  };
}

// ─── What the model may and may not do, said once ────────────────────────────

const MAY_NOT_INVENT = [
  'YOU MAY CREATE readings, questions, designs, and judgements about what a test could settle.',
  'YOU MAY NOT CREATE customer pain, market demand, willingness to pay, usage figures, prices',
  'people accept, counts of people, or the names of companies or people. Those are facts about',
  'the world; reality supplies them, and the record in front of you is the only reality in',
  'play. Never write a number, a name or a market size that is not in the record. When the',
  'record is silent, say it is silent.',
  '',
  'THE OWNER IS NOT A PUBLIC FIGURE. The Workshop is the only public voice; no person is named',
  'on any public surface. THE LEGAL AND DESTRUCTIVE RUNGS ARE NEVER INSIDE A CHARTER: a legal',
  'commitment or an act that cannot be undone waits for the owner, each time, and a design',
  'that needs one says so rather than pretending otherwise.',
].join('\n');

function recordBlock(r: TheRecord): string {
  // THE FENCE HOLDS ONLY IF NOTHING INSIDE IT CAN CLOSE IT. `JSON.stringify`
  // escapes quotes and not angle brackets, so a post containing `</record>`
  // ended the block and everything after it read as prompt, not data — and
  // what the model then wrote came back as a lesson into every later
  // deliberation. Everything between the tags is escaped, as `wrapDataBlock`
  // escapes its content; the model reads `&lt;` as the character it stands for.
  const j = (v: unknown): string => JSON.stringify(v, null, 1)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  return [
    '<record>',
    `CANDIDATE: ${j(r.candidate)}`,
    `THE TEST AS PROPOSED (from the cheapest thing that would settle an unknown): ${j(r.experiment)}`,
    `EVIDENCE (each with its source type, the stance that kind of source supplies, what it bore on its own claim — "found_nothing" is a search that came back with nothing on the subject, which is not support — and an address): ${j(r.evidence)}`,
    `RETRIEVALS (the words the eyes were asked with, and what came back; a brief can be built only from these): ${j(r.retrievals)}`,
    `OPEN UNKNOWNS (each with which of the four questions it asks — demand, distribution, conversion, fulfilment — so the cheapest test is for the question actually open): ${j(r.unknowns)}`,
    `LESSONS OF SETTLED TESTS (what each could not establish): ${j(r.lessons)}`,
    `PRECEDENT ON THIS CANDIDATE (what is already known, with its scope; "asked_before" means this act repeats a settled test by the same mechanism and will not seal unless it says what it changes): ${j(r.precedent)}`,
    `LEGAL PICTURE: ${j(r.legal)}`,
    `THE CHARTER (null means none is standing and the owner decides each test himself): ${j(r.charter)}`,
    `EXCHANGES (only "available": true can be run today): ${j(r.exchanges)}`,
    `WHAT THIS KIND OF THING TAKES (sourced and graded; "notKnown" is unknown and must not be assumed; none of it is evidence of demand): ${j(r.form)}`,
    `COST DIMENSIONS: ${j(r.costDimensions)}`,
    `STOP KINDS: ${j(r.stopKinds)}`,
    '</record>',
  ].join('\n');
}

function parseObject(text: string): Row | null {
  const from = text.indexOf('{');
  const to = text.lastIndexOf('}');
  if (from === -1 || to <= from) return null;
  try { return JSON.parse(text.slice(from, to + 1)) as Row; } catch { return null; }
}
const str = (raw: Row, k: string): string | null => {
  const v = raw[k];
  return typeof v === 'string' && v.trim() !== '' ? v.trim() : null;
};
const oneOf = <T extends string>(v: unknown, allowed: readonly T[]): T | null =>
  typeof v === 'string' && (allowed as readonly string[]).includes(v) ? v as T : null;

// ─── The lenses ──────────────────────────────────────────────────────────────

export interface LensFinding {
  lens: Lens; finding: string; grounds: string[]; risk: 'low' | 'material' | 'high';
  recommends: Recommendation; because: string;
}

const LENS_SYSTEM = (lens: Lens): string => [
  `You are one discipline — ${lens.replace(/_/g, ' ')} — on a small studio's design review, reading the`,
  'record of one candidate test. Your job is to say what the record shows from your discipline,',
  'on which rows, and what it leaves unknown. Other disciplines cover the rest; do not.',
  '',
  `WHAT YOUR DISCIPLINE ASKS: ${WHAT_EACH_LENS_ASKS[lens]}`,
  '',
  MAY_NOT_INVENT,
  '',
  'Reply with one JSON object and nothing else:',
  '{',
  '  "finding": <what the record shows from your discipline, two to five sentences, plain words>,',
  '  "grounds": <an array of the addresses ("source" values) or record fields your finding rests on;',
  '              at least one. A finding with no grounds is an opinion and is thrown away>,',
  '  "risk": <"low" | "material" | "high" — how badly this discipline could be wrong here>,',
  '  "recommends": <"run" | "reframe" | "defer" | "kill">,',
  '  "because": <one sentence for the recommendation>',
  '}',
  '',
  dataBlockInstruction('record'),
].join('\n');

/**
 * WHAT A DISCIPLINE MAY NOT SAY, checked rather than asked for. A number the
 * record does not hold is invented (invented-numbers.ts) — "this file sold
 * 312 copies last month" was stored as a finding before this was read. And a
 * discipline gives a reading, never a commitment: a finding that signs, agrees
 * or accepts something on the owner's behalf is asking for his act as though
 * it were routine, and the legal rung is never inside a charter.
 */
const COMMITS_THE_OWNER = /\b(?:sign|accept|agree to|commit to|enter into)\b[^.]{0,120}\b(?:on (?:the owner's|his|her|their) behalf|for the owner|in the owner's name)\b/i;

function whatAFindingMayNotSay(record: TheRecord, lens: Lens, finding: string, because: string): string | null {
  const invented = numbersNotIn(recordBlock(record), [finding, because]);
  if (invented.length > 0) return `the ${lens.replace(/_/g, ' ')} discipline wrote a number the record does not hold: ${invented.slice(0, 2).join('; ')}`;
  const said = `${finding} ${because}`;
  const commits = COMMITS_THE_OWNER.exec(said);
  if (commits) return `the ${lens.replace(/_/g, ' ')} discipline treated the owner's own act as routine: "…${said.slice(Math.max(0, commits.index - 40), commits.index + commits[0].length + 40).trim()}…"`;
  return null;
}

async function lensFinding(record: TheRecord, lens: Lens): Promise<LensFinding | { refused: string } | null> {
  const reply = await callSonnet(LENS_SYSTEM(lens), recordBlock(record), 1400, institutionSpend(
    'one discipline reading the record of a candidate test for the owner\'s portfolio search, which has no company to charge yet',
    'a lens', { kind: 'experiment', id: record.experiment.id }));
  const raw = parseObject(reply.content);
  if (!raw) return null;
  const finding = str(raw, 'finding');
  const because = str(raw, 'because');
  const risk = oneOf(raw.risk, ['low', 'material', 'high'] as const);
  const recommends = oneOf(raw.recommends, ['run', 'reframe', 'defer', 'kill'] as const);
  const grounds = Array.isArray(raw.grounds) ? raw.grounds.map(String).map((g) => g.trim()).filter(Boolean).slice(0, 12) : [];
  if (!finding || !because || !risk || !recommends || grounds.length === 0) return null;
  const refused = whatAFindingMayNotSay(record, lens, finding, because);
  if (refused) return { refused };
  return { lens, finding, grounds, risk, recommends, because };
}

async function recordFinding(record: TheRecord, f: LensFinding): Promise<void> {
  await query(
    `INSERT INTO probe_lens_findings (id, experiment_id, founder_id, lens, finding, grounds_json, risk, recommends, because, recorded_by)
     VALUES (?,?,?,?,?,?,?,?,?,?)`,
    [nanoid(), record.experiment.id, record.founderId, f.lens, f.finding, JSON.stringify(f.grounds), f.risk, f.recommends, f.because, FORGE]);
}

export async function findingsOf(experimentId: string): Promise<Array<LensFinding & { recordedAt: string }>> {
  return (await rows(
    `SELECT lens, finding, grounds_json, risk, recommends, because, recorded_at FROM probe_lens_findings
      WHERE experiment_id = ? ORDER BY recorded_at, rowid`, [experimentId])).map((r) => ({
    lens: String(r.lens) as Lens, finding: String(r.finding), grounds: JSON.parse(String(r.grounds_json)) as string[],
    risk: String(r.risk) as LensFinding['risk'], recommends: String(r.recommends) as Recommendation,
    because: String(r.because), recordedAt: String(r.recorded_at),
  }));
}

// ─── Composition ─────────────────────────────────────────────────────────────

const COMPOSE_SYSTEM = [
  'You compose the design of one small real test for a studio, from five disciplines\' findings',
  'and the record they read. The design is a set of judgement sentences the owner will read',
  'before anybody is written to; every sentence is sealed at the decision and cannot be edited',
  'to match the result, so write only what you would stand behind after the answer arrives.',
  '',
  MAY_NOT_INVENT,
  '',
  'RULES OF THE DESIGN. Choose an exchange whose "available" is true; if the only honest test',
  'needs one that is not, say so in exchange_because and recommend "defer". Name at least two',
  'readings of the likely result that the test could not tell apart. Name the cost on at least',
  'three dimensions with grounds. Name at least two stop conditions from the stop kinds. The',
  'distribution must obey the charter\'s contact rules where a charter stands. Nothing may',
  'name a person; the Workshop is the voice.',
  '',
  'Reply with one JSON object and nothing else:',
  '{',
  '  "decides": <the one thing this test settles, one sentence>,',
  '  "decides_because": <why that is the thing worth settling now>,',
  '  "exchange": <one of the exchange keys>,',
  '  "exchange_because": <why this exchange, against what it confounds>,',
  '  "can_prove": <what a positive result would establish>,',
  '  "cannot_prove": <what it still would not establish, honestly>,',
  '  "rather_than_waiting": <why run this now rather than read more>,',
  '  "distribution": <how it reaches people, inside the contact rules>,',
  '  "if_it_succeeds": <what happens next if it works>,',
  '  "fulfilment_cap": <integer or null — the most that may be owed at once>,',
  '  "recommendation": <"run" | "reframe" | "defer" | "kill">,',
  '  "recommendation_because": <one or two sentences>,',
  '  "interpretations": [{"observation": <a possible result>, "reading": <what it could mean>, "distinguished_by": <what would tell it apart, or null>}, ...],',
  '  "alternatives": [{"exchange": <key>, "not_chosen_because": <why>}, ...],',
  '  "costs": [{"dimension": <key>, "level": <"none"|"low"|"material"|"high">, "grounds": <why>}, ...],',
  '  "stop_conditions": [{"kind": <key>, "threshold": <integer>, "because": <why that number>}, ...]',
  '}',
  '',
  dataBlockInstruction('record'),
  dataBlockInstruction('findings'),
].join('\n');

interface Composed {
  decides: string; decidesBecause: string; exchange: Exchange; exchangeBecause: string; canProve: string; cannotProve: string;
  ratherThanWaiting: string; distribution: string; ifItSucceeds: string; fulfilmentCap: number | null;
  recommendation: Recommendation; recommendationBecause: string;
  interpretations: Array<{ observation: string; reading: string; distinguishedBy: string | null }>;
  alternatives: Array<{ exchange: Exchange; notChosenBecause: string }>;
  costs: Array<{ dimension: string; level: CostLevel; grounds: string }>;
  stopConditions: Array<{ kind: StopKind; threshold: number; because: string }>;
}

const WRITES_AS_A_PERSON = /\b(?:the owner's|his|her|my)\s+(?:own\s+|personal\s+|private\s+)?(?:address|e-?mail|inbox|account|name|phone)\b/i;
const NEW_CHANNEL = /\bpost(?:ing|s)?\s+(?:it\s+)?(?:in|to|on)\s+(?:their\s+|the\s+|online\s+|relevant\s+)?(?:groups?|forums?|communities|subreddits?|threads?)\b|\b(?:facebook|instagram|tiktok|twitter|reddit|social media|text messages?|sms|cold[- ]call(?:ing|s)?|direct messages?)\b/i;

function composed(raw: Row, record: TheRecord): Composed | { refused: string } {
  const need = (k: string): string => str(raw, k) ?? '';
  const exchangeKeys = record.exchanges.map((x) => x.exchange);
  const exchange = oneOf(raw.exchange, exchangeKeys);
  const recommendation = oneOf(raw.recommendation, ['run', 'reframe', 'defer', 'kill'] as const);
  const missing = ['decides', 'decides_because', 'exchange_because', 'can_prove', 'cannot_prove', 'rather_than_waiting',
    'distribution', 'if_it_succeeds', 'recommendation_because'].filter((k) => need(k) === '');
  if (missing.length || !exchange || !recommendation) return { refused: `the composition left out ${[...missing, ...(exchange ? [] : ['exchange']), ...(recommendation ? [] : ['recommendation'])].join(', ')}` };
  // AN EXCHANGE THAT IS NOT AVAILABLE IS THE OWNER'S TO OPEN. The prompt says
  // to recommend deferring when the only honest test needs one; a design that
  // runs it anyway is asking for his act as though it were routine.
  const chosen = record.exchanges.find((x) => x.exchange === exchange);
  if (chosen && !chosen.available && recommendation === 'run') {
    return { refused: `the design runs an exchange that is not available today (${chosen.whatItIs}); opening it is the owner's act, not a routine one: "${need('exchange_because').slice(0, 200)}"` };
  }
  // THE CONTACT RULES, IN WORDS A CHECK CAN READ. The Workshop writes in its
  // own name (SEALED_CONTACT_RULES), and a new class of channel is the owner's
  // to open the first time (CONSTITUTION, the charter). Narrow on purpose: it
  // refuses a distribution that names writing as a person or a channel the
  // charter does not name, and says which words it refused.
  const distribution = need('distribution');
  const asAPerson = WRITES_AS_A_PERSON.exec(distribution);
  if (asAPerson) return { refused: `the distribution would write as a person, and the Workshop is the only voice the charter's contact rules allow: "…${distribution.slice(0, 200)}…"` };
  const channel = NEW_CHANNEL.exec(distribution);
  if (channel) return { refused: `the distribution opens a channel the charter does not name ("${channel[0]}"); a new class of channel is the owner's to open the first time: "…${distribution.slice(0, 200)}…"` };
  const interpretations = (Array.isArray(raw.interpretations) ? raw.interpretations : []).map((i) => {
    const r = i as Row;
    return { observation: str(r, 'observation') ?? '', reading: str(r, 'reading') ?? '', distinguishedBy: str(r, 'distinguished_by') };
  }).filter((i) => i.observation && i.reading);
  const alternatives = (Array.isArray(raw.alternatives) ? raw.alternatives : []).map((a) => {
    const r = a as Row;
    return { exchange: oneOf(r.exchange, exchangeKeys), notChosenBecause: str(r, 'not_chosen_because') ?? '' };
  }).filter((a): a is { exchange: Exchange; notChosenBecause: string } => a.exchange !== null && a.exchange !== exchange && a.notChosenBecause !== '');
  const dims = record.costDimensions.map((d) => d.dimension);
  const costs = (Array.isArray(raw.costs) ? raw.costs : []).map((c) => {
    const r = c as Row;
    return { dimension: oneOf(r.dimension, dims), level: oneOf(r.level, ['none', 'low', 'material', 'high'] as const), grounds: str(r, 'grounds') ?? '' };
  }).filter((c): c is { dimension: string; level: CostLevel; grounds: string } => c.dimension !== null && c.level !== null && c.grounds !== '');
  const kinds = record.stopKinds.map((k) => k.kind);
  const stopConditions = (Array.isArray(raw.stop_conditions) ? raw.stop_conditions : []).map((s) => {
    const r = s as Row;
    const threshold = Number(r.threshold);
    return { kind: oneOf(r.kind, kinds), threshold: Number.isInteger(threshold) && threshold > 0 ? threshold : null, because: str(r, 'because') ?? '' };
  }).filter((s): s is { kind: StopKind; threshold: number; because: string } => s.kind !== null && s.threshold !== null && s.because !== '');
  if (interpretations.length < 2) return { refused: 'fewer than two readings of the likely result' };
  if (costs.length < 3) return { refused: 'cost named on fewer than three dimensions' };
  if (stopConditions.length < 2) return { refused: 'fewer than two stop conditions' };
  const cap = raw.fulfilment_cap;
  return {
    decides: need('decides'), decidesBecause: need('decides_because'), exchange, exchangeBecause: need('exchange_because'),
    canProve: need('can_prove'), cannotProve: need('cannot_prove'), ratherThanWaiting: need('rather_than_waiting'),
    distribution: need('distribution'), ifItSucceeds: need('if_it_succeeds'),
    fulfilmentCap: typeof cap === 'number' && Number.isInteger(cap) && cap > 0 ? cap : null,
    recommendation, recommendationBecause: need('recommendation_because'),
    interpretations, alternatives, costs, stopConditions,
  };
}

// ─── The attacker ────────────────────────────────────────────────────────────

const ATTACK_SYSTEM = [
  'You are the adversary on a small studio\'s design review. You are given ONLY a draft design of',
  'one real test and the record it claims to rest on. Your job is to break it: find the sentence',
  'that is wrong, the reading it cannot tell apart, the cost it understates, the rule it would',
  'cross, the fact it invented. You did not write it and you do not defend it.',
  '',
  MAY_NOT_INVENT,
  '',
  'An attack that names one of these sentences and gives a better one becomes an amendment in',
  'the record, signed by you: decides, decides_because, exchange_because, can_prove,',
  'cannot_prove, rather_than_waiting, distribution, if_it_succeeds, recommendation_because.',
  'An attack on anything else is recorded as a finding. If, after your attacks, the test',
  'should not run as drafted, say so in the verdict and the design will not be sealed.',
  '',
  'Reply with one JSON object and nothing else:',
  '{',
  '  "attacks": [{"claim": <what is wrong, one sentence>, "why": <on what grounds>,',
  '               "field": <one of the sentence names above, or null>,',
  '               "reads_now": <the better sentence, or null>}, ...],',
  '  "verdict": <"run" | "reframe" | "defer" | "kill">,',
  '  "because": <one or two sentences>',
  '}',
  '',
  dataBlockInstruction('draft'),
  dataBlockInstruction('record'),
].join('\n');

export interface Attack { claim: string; why: string; field: AmendableField | null; readsNow: string | null; accepted: boolean }

const FIELD_NAMES: Record<string, AmendableField> = {
  decides: 'decides', decides_because: 'decidesBecause', exchange_because: 'exchangeBecause', can_prove: 'canProve',
  cannot_prove: 'cannotProve', rather_than_waiting: 'ratherThanWaiting', distribution: 'distribution',
  if_it_succeeds: 'ifItSucceeds', recommendation_because: 'recommendationBecause',
};

function draftBlock(d: ProbeDesign): string {
  return `<draft>${JSON.stringify({
    decides: d.decides, decides_because: d.decidesBecause, exchange: d.exchange.exchange, exchange_because: d.exchangeBecause,
    can_prove: d.canProve, cannot_prove: d.cannotProve, rather_than_waiting: d.ratherThanWaiting, distribution: d.distribution,
    if_it_succeeds: d.ifItSucceeds, fulfilment_cap: d.fulfilmentCap, recommendation: d.recommendation,
    recommendation_because: d.recommendationBecause, interpretations: d.interpretations, alternatives: d.alternatives,
    costs: d.costs, stop_conditions: d.stopConditions.map((s) => ({ kind: s.kind, threshold: s.threshold, because: s.because })),
  }, null, 1)}</draft>`;
}

export async function attacksOf(experimentId: string): Promise<Array<Attack & { verdict: Recommendation; because: string }>> {
  return (await rows(
    `SELECT claim, why, field, reads_now, accepted, verdict, because FROM probe_attacks WHERE experiment_id = ? ORDER BY rowid`, [experimentId]))
    .map((r) => ({
      claim: String(r.claim), why: String(r.why), field: r.field == null ? null : String(r.field) as AmendableField,
      readsNow: r.reads_now == null ? null : String(r.reads_now), accepted: Number(r.accepted) === 1,
      verdict: String(r.verdict) as Recommendation, because: String(r.because),
    }));
}

// ─── The deliberation, end to end ────────────────────────────────────────────

export interface Deliberation {
  experimentId: string;
  /** `reconsidered`: an unsealed design taken up again because what it was refused on changed. */
  outcome: 'already_designed' | 'designed' | 'refused' | 'reconsidered';
  /** What stopped it, when refused. */
  because: string | null;
  findings: LensFinding[];
  design: ProbeDesign | null;
  attacks: Attack[];
  attackerVerdict: Recommendation | null;
  sealed: boolean;
  /** Why it was not sealed, when it was not. */
  unsealedBecause: string[];
  /** What the seal was decided against (`sealingFacts`), when a design was judged; how a later pass knows they changed. */
  facts?: string;
}

/** The forge's verdict on whether a probe is inside the charter, for the sealing rule. */
async function insideTheCharter(record: TheRecord): Promise<{ inside: boolean; because: string[] }> {
  const { chartered } = await import('../institution/charter.js');
  const c = await chartered({ founderId: record.founderId, experimentId: record.experiment.id,
    costCents: record.experiment.costCents, rungs: ['public', 'financial'] });
  return c.inside ? { inside: true, because: [] } : { inside: false, because: c.because };
}

export async function deliberate(experimentId: string): Promise<Deliberation> {
  const empty = { findings: [] as LensFinding[], design: null, attacks: [] as Attack[], attackerVerdict: null, sealed: false, unsealedBecause: [] as string[] };
  if (await designOf(experimentId)) return { experimentId, outcome: 'already_designed', because: null, ...empty };
  const record = await theRecordOf(experimentId);
  if (!record) return { experimentId, outcome: 'refused', because: 'no real test with a candidate and an unknown behind it', ...empty };

  // THE LENSES, WRITTEN AS THEY RETURN, BEFORE ANYTHING IS COMPOSED.
  const findings: LensFinding[] = [];
  const refusedFindings: string[] = [];
  for (const lens of LENSES) {
    const f = await lensFinding(record, lens);
    if (f && 'refused' in f) refusedFindings.push(f.refused);
    else if (f) { await recordFinding(record, f); findings.push(f); }
  }
  if (findings.length < LENSES.length) {
    return { experimentId, outcome: 'refused', because: `${String(LENSES.length - findings.length)} of ${String(LENSES.length)} disciplines returned nothing usable; no design is composed on a partial review${refusedFindings.length ? `. Refused: ${refusedFindings.join('; ')}` : ''}`, ...empty, findings };
  }

  const reply = await callOpus(COMPOSE_SYSTEM, `${recordBlock(record)}\n<findings>${JSON.stringify(findings, null, 1)}</findings>`, 4000, institutionSpend(
    'composing the design of a real test from five disciplines\' findings; being wrong here costs a probe and the Workshop\'s standing',
    'composing a probe', { kind: 'experiment', id: experimentId }));
  const raw = parseObject(reply.content);
  const c = raw ? composed(raw, record) : { refused: 'the composition was not a design' };
  if ('refused' in c) return { experimentId, outcome: 'refused', because: c.refused, ...empty, findings };
  await recordDesign({
    founderId: record.founderId, experimentId,
    decides: c.decides, decidesBecause: c.decidesBecause, exchange: c.exchange, exchangeBecause: c.exchangeBecause,
    canProve: c.canProve, cannotProve: c.cannotProve, ratherThanWaiting: c.ratherThanWaiting, distribution: c.distribution,
    ifItSucceeds: c.ifItSucceeds, fulfilmentCap: c.fulfilmentCap, recommendation: c.recommendation,
    recommendationBecause: c.recommendationBecause, designedBy: FORGE,
    interpretations: c.interpretations, alternatives: c.alternatives, costs: c.costs, stopConditions: c.stopConditions,
  });
  // WHICH LESSONS THIS DESIGN HAD IN FRONT OF IT, kept so a lesson can say what
  // it went on to influence.
  for (const l of record.lessons) {
    await query(
      `INSERT OR IGNORE INTO lessons_read (design_experiment_id, lesson_experiment_id, founder_id) VALUES (?,?,?)`,
      [experimentId, l.experimentId, record.founderId]);
  }
  const attacked = await attackTheDraft(record, (await designOf(experimentId))!);
  const { design, attacks, verdict, attackBecause } = attacked;
  const rule = await theRuleThatSeals(record, design, verdict, attackBecause);
  if (design.recommendation === 'kill' && verdict === 'kill') {
    // Both the composer and its adversary say no: the test is retired with
    // both reasons, and the candidate keeps its record on Discover.
    await query(`UPDATE venture_experiments SET retired_at = datetime('now'), retired_because = ? WHERE id = ? AND retired_at IS NULL AND decision IS NULL`,
      [`the forge and its adversary both recommend against it: ${design.recommendationBecause} ${attackBecause ?? ''}`.trim(), experimentId]);
  }
  return { experimentId, outcome: 'designed', because: null, findings, design, attacks, attackerVerdict: verdict,
    sealed: rule.sealed, unsealedBecause: rule.unsealedBecause, facts: rule.facts };
}

/** THE ATTACKER, GIVEN ONLY THE DRAFT AND THE RECORD. Its attacks are rows; an accepted one is an amendment it signs. */
async function attackTheDraft(record: TheRecord, draft: ProbeDesign): Promise<{
  design: ProbeDesign; attacks: Attack[]; verdict: Recommendation | null; attackBecause: string | null;
}> {
  const experimentId = record.experiment.id;
  let design = draft;
  const attackReply = await callOpus(ATTACK_SYSTEM, `${draftBlock(design)}\n${recordBlock(record)}`, 3000, institutionSpend(
    'attacking the draft design of a real test before it is sealed; a design nobody argued against is one the world argues against instead',
    'attacking a probe', { kind: 'experiment', id: experimentId }));
  const attackRaw = parseObject(attackReply.content);
  const verdict = attackRaw ? oneOf(attackRaw.verdict, ['run', 'reframe', 'defer', 'kill'] as const) : null;
  const attackBecause = attackRaw ? str(attackRaw, 'because') : null;
  const attacks: Attack[] = [];
  const amendments: Partial<Record<AmendableField, string>> = {};
  const reasons: string[] = [];
  for (const a of Array.isArray(attackRaw?.attacks) ? attackRaw.attacks : []) {
    const r = a as Row;
    const claim = str(r, 'claim'); const why = str(r, 'why');
    if (!claim || !why) continue;
    const field = typeof r.field === 'string' && r.field in FIELD_NAMES ? FIELD_NAMES[r.field]! : null;
    const readsNow = str(r, 'reads_now');
    const accepted = field !== null && readsNow !== null && readsNow !== (design[field] as string);
    if (accepted) { amendments[field] = readsNow; reasons.push(`${claim} ${why}`); }
    attacks.push({ claim, why, field, readsNow, accepted });
  }
  for (const a of attacks) {
    await query(
      `INSERT INTO probe_attacks (id, experiment_id, founder_id, claim, why, field, reads_now, accepted, verdict, because, recorded_by)
       VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
      [nanoid(), experimentId, record.founderId, a.claim, a.why, a.field, a.readsNow, a.accepted ? 1 : 0,
        verdict ?? 'reframe', attackBecause ?? 'the attacker gave no verdict', ADVERSARY]);
  }
  if (Object.keys(amendments).length > 0) {
    await amendDesign({ experimentId, amendedBy: ADVERSARY, because: `The adversary's accepted attacks: ${reasons.join(' ')}`, fields: amendments });
    design = (await designOf(experimentId))!;
  }
  return { design, attacks, verdict, attackBecause };
}

/**
 * WHAT A DESIGN'S SEAL IS DECIDED AGAINST, apart from the design's own
 * sentences and the attacker's verdict: the charter's answer, what stands in
 * the design's way (an exchange Foundry cannot run yet, a precedent), and the
 * evidence on the candidate. One comparable string, recorded with each
 * refusal, so a later pass can tell that what the seal was refused on has
 * changed — a charter signed or renewed with room, an exchange newly
 * available, new evidence — and that only then is it worth asking again.
 */
export async function sealingFacts(record: TheRecord): Promise<string> {
  const charter = await insideTheCharter(record);
  const inTheWay = await designStandsInTheWay(record.experiment.id);
  return JSON.stringify({
    charter: charter.because,
    inTheWay,
    evidence: [record.evidence.length, record.evidence[0]?.observedAt ?? null, record.retrievals.length],
  });
}

/** THE RULE THAT SEALS. Neither the composer nor the attacker. */
async function theRuleThatSeals(
  record: TheRecord, design: ProbeDesign, verdict: Recommendation | null, attackBecause: string | null,
): Promise<{ sealed: boolean; unsealedBecause: string[]; facts: string }> {
  const experimentId = record.experiment.id;
  const unsealedBecause: string[] = [];
  if (design.recommendation !== 'run') unsealedBecause.push(`the design recommends ${design.recommendation}`);
  if (verdict !== 'run') unsealedBecause.push(verdict === null ? 'the attacker returned no verdict' : `the attacker says ${verdict}: ${attackBecause ?? ''}`.trim());
  for (const s of await designStandsInTheWay(experimentId)) unsealedBecause.push(s);
  const charter = await insideTheCharter(record);
  if (!charter.inside) unsealedBecause.push(...charter.because);
  const facts = await sealingFacts(record);
  if (unsealedBecause.length === 0) {
    await sealDesign(experimentId);
    return { sealed: true, unsealedBecause, facts };
  }
  return { sealed: false, unsealedBecause, facts };
}

// ─── The daily pass ──────────────────────────────────────────────────────────

export interface ForgePass {
  proposed: number;
  deliberated: Deliberation[];
  /** Tests let in under the charter this pass, and those that were not, with why. */
  allowed: string[];
  notAllowed: Array<{ experimentId: string; because: string }>;
  skipped: string | null;
  /** Tests whose attempt threw this pass, with why; the pass went on (R27). */
  failed: Array<{ experimentId: string; because: string }>;
  /** Tests left alone this pass because they were refused recently, and when they are tried again (R27). */
  waiting: string[];
}

// ─── Backing off what keeps being refused (R27) ─────────────────────────────

export type ForgeStage = 'deliberate' | 'make';
/** Refused this many times at one stage, a test is retired with its reasons. */
export const FORGE_GIVES_UP_AFTER = 4;
const DAY_MS = 86_400_000;
const STAGE_WORDS: Record<ForgeStage, string> = { deliberate: 'designing it', make: 'making what it sells' };
const isoAt = (v: unknown): number => { const t = String(v); return new Date(t.includes('T') ? t : `${t.replace(' ', 'T')}Z`).getTime(); };

/**
 * WHETHER THIS STAGE OF THIS TEST MAY BE TRIED NOW, and if not, when. Refused
 * n times, it waits 2^(n-1) days after the last refusal: a day, two, four.
 */
export async function forgeMayTry(experimentId: string, stage: ForgeStage, now: Date): Promise<{ may: boolean; refused: number; from: Date | null }> {
  const r = (await query(`SELECT COUNT(*) AS n, MAX(refused_at) AS last FROM forge_refusals WHERE experiment_id = ? AND stage = ?`, [experimentId, stage])).rows[0] as Row | undefined;
  const n = Number(r?.n ?? 0);
  if (n === 0 || r?.last == null) return { may: true, refused: 0, from: null };
  const from = new Date(isoAt(r.last) + 2 ** (n - 1) * DAY_MS);
  return { may: n < FORGE_GIVES_UP_AFTER && now.getTime() >= from.getTime(), refused: n, from };
}

/** Record a refusal; at the last one, retire the undecided test with its reasons. `facts`: what an unsealed design's seal was decided against. */
export async function recordForgeRefusal(experimentId: string, stage: ForgeStage, because: string, now: Date, facts: string | null = null): Promise<void> {
  await query(`INSERT INTO forge_refusals (id, experiment_id, stage, because, refused_at, facts) VALUES (?,?,?,?,?,?)`,
    [nanoid(), experimentId, stage, because, now.toISOString(), facts]);
  const r = (await query(`SELECT COUNT(*) AS n, MIN(refused_at) AS first FROM forge_refusals WHERE experiment_id = ? AND stage = ?`, [experimentId, stage])).rows[0] as Row;
  const n = Number(r.n);
  if (n < FORGE_GIVES_UP_AFTER) return;
  const days = Math.round((now.getTime() - isoAt(r.first)) / DAY_MS);
  await query(`UPDATE venture_experiments SET retired_at = datetime('now'), retired_because = ? WHERE id = ? AND retired_at IS NULL AND decision IS NULL`,
    [`the forge was refused ${String(n)} times over ${String(days)} days ${STAGE_WORDS[stage]}; the last: ${because}`, experimentId]);
}

const timesWord = (n: number): string => (n === 1 ? 'once' : n === 2 ? 'twice' : `${String(n)} times`);

/**
 * HOW LONG ONE FORGE PASS MAY TAKE, by the wall clock (remediation 1.4). The
 * door breaker bounds a door that is down; this bounds one that is merely
 * slow, so a pass of lenses and compositions cannot hold `forge_tick` for the
 * best part of an hour. What is left over waits for the next pass, said so.
 * FORGE_PASS_BUDGET_MS overrides it; measured on the monotonic clock, so
 * simulated time never trips it.
 *
 * FOUR MINUTES, INSIDE THE JOB LOCK'S FIVE-MINUTE LEASE (Stage 1 F1.4, kept
 * when the two fixes were reconciled): `runScheduledJob` holds `forge_tick`
 * for 300 seconds, so no new design starts after the lease could have lapsed
 * and another instance could have taken the routine. A design already started
 * finishes under its own calls' budgets (ai/client.ts).
 */
export function forgePassBudgetMs(env: NodeJS.ProcessEnv = process.env): number {
  // Zero is a budget too: a pass that may begin no design (used to prove the
  // budget without racing the clock).
  const set = Number.parseInt(env.FORGE_PASS_BUDGET_MS ?? '', 10);
  return Number.isFinite(set) && set >= 0 ? set : 4 * 60_000;
}

// ─── A design that was not sealed is not stranded (Stage 1, F1.5) ───────────
//
// A design was sealed or not once, inside `deliberate`, and nothing looked at
// it again: one refused because no charter stood, the charter was full, an
// exchange was not yet runnable, or the attacker said reframe or defer, waited
// for ever, and — not being a refusal — was never retired either. Now:
//
//   - every unsealed design is a forge refusal at the designing stage, with
//     its reasons and the facts it was decided against, so the give-up rule
//     (four refusals, then retired) sees it like any other;
//   - a later pass takes it up again ONCE when those facts have changed (a
//     charter signed or renewed with room, an exchange now runnable, new
//     evidence on the candidate), or the owner asked: the attacker is asked
//     again where it did not say run, and the same rule that seals is applied
//     to what is true now. The design's own sentences are the record and are
//     not recomposed; a design that itself recommends against running is not
//     asked again, and only the owner or the give-up rule ends it;
//   - what is still waiting reaches the owner as ONE item, with why.

/** The one needs-you item's id: every waiting design is one item, not one each. */
export const DESIGNS_WAITING = 'forge-designs-waiting';

const designedButNot = (reasons: string[]): string => `designed but not sealed: ${reasons.join('; ')}`;

/**
 * TAKE UP AN UNSEALED FORGE DESIGN AGAIN, if what it was refused on has
 * changed or the owner asked; otherwise null, and nothing is called or
 * written. Idempotent: the refusal it writes carries the facts it was decided
 * against, so the same facts never ask twice. `mayAskTheAttacker` false leaves
 * a design that would need the model for a pass with room (returns null).
 */
export async function reconsiderDesign(experimentId: string, now: Date, opts: { mayAskTheAttacker: boolean } = { mayAskTheAttacker: true }): Promise<(Deliberation & { askedTheModel: boolean; reconsideredBecause: string }) | null> {
  const design = await designOf(experimentId);
  if (!design || design.sealedAt !== null || design.designedBy !== FORGE) return null;
  const last = await one(
    `SELECT COUNT(*) AS n, MAX(refused_at) AS at,
            (SELECT facts FROM forge_refusals WHERE experiment_id = ? AND stage = 'deliberate' ORDER BY refused_at DESC, rowid DESC LIMIT 1) AS facts
       FROM forge_refusals WHERE experiment_id = ? AND stage = 'deliberate'`, [experimentId, experimentId]);
  const n = Number(last?.n ?? 0);
  if (n >= FORGE_GIVES_UP_AFTER) return null;
  const asked = await one(`SELECT asked_at FROM forge_rerun_asks WHERE experiment_id = ? AND asked_at > ? ORDER BY asked_at DESC LIMIT 1`,
    [experimentId, last?.at == null ? '' : String(last.at)]);
  const record = await theRecordOf(experimentId);
  if (!record) return null;
  const factsNow = await sealingFacts(record);
  const lastFacts = last?.facts == null ? null : String(last.facts);
  // A design with no facts on record was judged before they were kept (or
  // before unsealed designs were refusals at all): it is taken up once.
  const changed = lastFacts === null || lastFacts !== factsNow;
  if (!changed && !asked) return null;
  const reconsideredBecause = asked ? 'the owner asked for it to be taken up again'
    : lastFacts === null ? 'it was designed before what it was refused on was kept' : 'what it was refused on has changed';

  // THE ATTACKER'S STANDING VERDICT, from its rows; asked again only where it
  // did not say run and the design itself does.
  const prior = await one(`SELECT verdict, because FROM probe_attacks WHERE experiment_id = ? ORDER BY rowid DESC LIMIT 1`, [experimentId]);
  let verdict = prior ? oneOf(prior.verdict, ['run', 'reframe', 'defer', 'kill'] as const) : null;
  let attackBecause = prior?.because == null ? null : String(prior.because);
  let current = design;
  let attacks: Attack[] = [];
  let askedTheModel = false;
  if (design.recommendation === 'run' && verdict !== 'run') {
    if (!opts.mayAskTheAttacker) return null;
    const a = await attackTheDraft(record, design);
    ({ design: current, attacks, verdict, attackBecause } = a);
    askedTheModel = true;
  }
  const rule = await theRuleThatSeals(record, current, verdict, attackBecause);
  if (!rule.sealed) await recordForgeRefusal(experimentId, 'deliberate', designedButNot(rule.unsealedBecause), now, rule.facts);
  return { experimentId, outcome: 'reconsidered', because: reconsideredBecause, findings: [], design: current, attacks,
    attackerVerdict: verdict, sealed: rule.sealed, unsealedBecause: rule.unsealedBecause, facts: rule.facts, askedTheModel, reconsideredBecause };
}

export interface WaitingDesign {
  experimentId: string;
  whatWeDo: string;
  designedAt: string;
  /** The last reason it was not sealed, or that it has not been judged since reasons were kept. */
  because: string;
  /** Refusals at the designing stage so far; at FORGE_GIVES_UP_AFTER it is retired. */
  refusals: number;
  /** When the owner last asked for it to be taken up again, if after its last refusal. */
  rerunAskedAt: string | null;
}

/** EVERY FORGE DESIGN THAT IS NOT SEALED AND NOT ENDED: what waits, and why. */
export async function designsWaiting(founderId: string): Promise<WaitingDesign[]> {
  return (await rows(
    `SELECT d.experiment_id, d.designed_at, e.what_we_do,
            (SELECT r.because FROM forge_refusals r WHERE r.experiment_id = d.experiment_id AND r.stage = 'deliberate' ORDER BY r.refused_at DESC, r.rowid DESC LIMIT 1) AS because,
            (SELECT MAX(r.refused_at) FROM forge_refusals r WHERE r.experiment_id = d.experiment_id AND r.stage = 'deliberate') AS refused_at,
            (SELECT COUNT(*) FROM forge_refusals r WHERE r.experiment_id = d.experiment_id AND r.stage = 'deliberate') AS refusals,
            (SELECT MAX(a.asked_at) FROM forge_rerun_asks a WHERE a.experiment_id = d.experiment_id) AS asked_at
       FROM probe_designs d JOIN venture_experiments e ON e.id = d.experiment_id
      WHERE e.founder_id = ? AND e.evidence_mode = 'real' AND e.decision IS NULL AND e.retired_at IS NULL AND e.superseded_by IS NULL
        AND d.sealed_at IS NULL AND d.designed_by = ?
      ORDER BY d.designed_at, d.experiment_id`, [founderId, FORGE])).map((r) => ({
    experimentId: String(r.experiment_id), whatWeDo: String(r.what_we_do), designedAt: String(r.designed_at),
    because: r.because == null ? 'designed but not yet judged against what is true now; the next forge pass takes it up' : String(r.because).replace(/^designed but not sealed: /, ''),
    refusals: Number(r.refusals),
    rerunAskedAt: r.asked_at != null && (r.refused_at == null || String(r.asked_at) > String(r.refused_at)) ? String(r.asked_at) : null,
  }));
}

/** HE ASKED: every waiting design is taken up again on the next pass, whatever its facts. Returns how many. */
export async function askToReconsiderDesigns(founderId: string, now: Date = new Date()): Promise<number> {
  const waiting = await designsWaiting(founderId);
  for (const w of waiting) {
    await query(`INSERT INTO forge_rerun_asks (id, experiment_id, asked_at) VALUES (?,?,?)`, [nanoid(), w.experimentId, now.toISOString()]);
  }
  return waiting.length;
}

/** HE RETIRED THEM: every waiting design's test is retired, each with its own last reason. Returns how many. */
export async function retireWaitingDesigns(founderId: string): Promise<number> {
  let n = 0;
  for (const w of await designsWaiting(founderId)) {
    const r = await query(
      `UPDATE venture_experiments SET retired_at = datetime('now'), retired_because = ?
        WHERE id = ? AND founder_id = ? AND retired_at IS NULL AND decision IS NULL`,
      [`retired by the owner while its design waited unsealed: ${w.because}`, w.experimentId, founderId]);
    n += Number(r.rowsAffected ?? 0);
  }
  return n;
}

/** THE MOST DESIGNS IN A DAY. Two compositions and two attacks on the frontier
 *  model is about a dollar; the charter's thinking is the hard stop beneath it. */
export const MOST_DESIGNS_PER_PASS = 2;

export async function forgePass(founderId: string, now: Date = new Date()): Promise<ForgePass> {
  const out: ForgePass = { proposed: 0, deliberated: [], allowed: [], notAllowed: [], skipped: null, failed: [], waiting: [] };
  const startedAt = performance.now();
  const budgetMs = forgePassBudgetMs();
  const outOfTime = (): boolean => performance.now() - startedAt >= budgetMs;
  const minutes = budgetMs < 60_000 ? 'time' : `${String(Math.round(budgetMs / 60_000))} minutes`;
  const { envelopeReading } = await import('../institution/charter.js');
  const envelope = await envelopeReading(founderId);
  // THE CHARTER'S THINKING FOR TODAY. Read from the same ledger the door writes,
  // so a day that has already spent what he signed for designs nothing more.
  // AND WHAT IT THINKS WITH BEFORE HE HAS SIGNED ANYTHING. This read the
  // charter's daily figure and so capped nothing at all when no charter stood:
  // an institution asking for authority to spend was meanwhile thinking
  // without a ceiling. Deliberation stays charter-free — it is not a
  // consequential act — inside a bound of its own until he sets one.
  // The same reading the door refuses a call by (institution/spending.ts);
  // skipping the pass here only saves the refusal's noise.
  {
    const { thinkingToday } = await import('../institution/spending.js');
    const t = await thinkingToday(founderId);
    if (t.spentTodayCents >= t.bindingCents) {
      out.skipped = envelope
        ? `today's thinking under the charter is spent ($${(t.spentTodayCents / 100).toFixed(2)} of $${(t.bindingCents / 100).toFixed(2)})`
        : `today's thinking is spent ($${(t.spentTodayCents / 100).toFixed(2)} of $${(t.bindingCents / 100).toFixed(2)}, the bound before a charter is signed)`;
      return out;
    }
  }
  const { proposeWhatRealityWouldSettle } = await import('./validation.js');
  const candidates = await rows(
    `SELECT id FROM venture_opportunities WHERE founder_id = ? AND evidence_mode = 'real'
        AND (verdict IS NULL OR verdict = 'advanced') ORDER BY found_at`, [founderId]);
  for (const c of candidates) {
    const p = await proposeWhatRealityWouldSettle({ founderId, opportunityId: String(c.id), proposedBy: FORGE });
    out.proposed += p.proposed.length;
  }
  const undesigned = await rows(
    `SELECT e.id FROM venture_experiments e
      WHERE e.founder_id = ? AND e.evidence_mode = 'real' AND e.decision IS NULL AND e.retired_at IS NULL
        AND NOT EXISTS (SELECT 1 FROM probe_designs d WHERE d.experiment_id = e.id)
      ORDER BY e.proposed_at`, [founderId]);
  let attempted = 0;
  for (const e of undesigned) {
    if (attempted >= MOST_DESIGNS_PER_PASS) break;
    const id = String(e.id);
    if (outOfTime()) { out.waiting.push(`${id}: this pass used its ${minutes}; it is deliberated on the next`); continue; }
    // REFUSED RECENTLY, IT WAITS (R27): the same question asked again the
    // next morning costs another five readings and comes back the same.
    const may = await forgeMayTry(id, 'deliberate', now);
    if (!may.may) { out.waiting.push(`${id}: refused ${timesWord(may.refused)}; tried again from ${may.from!.toISOString().slice(0, 10)}`); continue; }
    attempted += 1;
    try {
      const d = await deliberate(id);
      out.deliberated.push(d);
      if (d.outcome === 'refused') await recordForgeRefusal(id, 'deliberate', d.because ?? 'refused', now);
      // AN UNSEALED DESIGN IS A REFUSAL TOO, with the facts it was refused on (F1.5).
      else if (d.outcome === 'designed' && !d.sealed) await recordForgeRefusal(id, 'deliberate', designedButNot(d.unsealedBecause), now, d.facts ?? null);
    } catch (err) {
      // THE DOOR, NOT THE TEST: every later test would fail the same way.
      if (err instanceof ModelDoorError) throw err;
      // A REPLY THE DOOR REFUSED is a refusal of this test, with the door's reason.
      if (err instanceof ModelReplyRefused) { await recordForgeRefusal(id, 'deliberate', err.message, now); continue; }
      out.failed.push({ experimentId: id, because: err instanceof Error ? err.message : String(err) });
    }
  }
  // WHAT WAS DESIGNED AND NOT SEALED IS TAKEN UP AGAIN when what it was
  // refused on has changed, or he asked (F1.5). Re-judging costs nothing; only
  // asking the attacker again counts against the day's designs.
  const unsealed = await rows(
    `SELECT d.experiment_id FROM probe_designs d JOIN venture_experiments e ON e.id = d.experiment_id
      WHERE e.founder_id = ? AND e.evidence_mode = 'real' AND e.decision IS NULL AND e.retired_at IS NULL
        AND d.sealed_at IS NULL AND d.designed_by = ? ORDER BY d.designed_at, d.experiment_id`, [founderId, FORGE]);
  for (const u of unsealed) {
    const id = String(u.experiment_id);
    if (out.deliberated.some((d) => d.experimentId === id)) continue;
    if (outOfTime()) { out.waiting.push(`${id}: this pass used its ${minutes}; it is taken up again on the next`); continue; }
    try {
      const r = await reconsiderDesign(id, now, { mayAskTheAttacker: attempted < MOST_DESIGNS_PER_PASS });
      if (!r) continue;
      if (r.askedTheModel) attempted += 1;
      out.deliberated.push(r);
    } catch (err) {
      if (err instanceof ModelDoorError) throw err;
      if (err instanceof ModelReplyRefused) { await recordForgeRefusal(id, 'deliberate', err.message, now); continue; }
      out.failed.push({ experimentId: id, because: err instanceof Error ? err.message : String(err) });
    }
  }
  // ONE TEST THAT THROWS DOES NOT STOP THE OTHERS; A PASS THAT COULD DO
  // NOTHING AT ALL IS STILL A FAILED PASS, recorded as one and told to him.
  if (out.failed.length > 0 && out.deliberated.length === 0) {
    throw new Error(`the forge could not deliberate any test this pass: ${out.failed.map((f) => `${f.experimentId}: ${f.because}`).join('; ')}`);
  }

  // SEALED INSIDE THE CHARTER AND READY: let in, as the charter's principal.
  const sealed = await rows(
    `SELECT d.experiment_id FROM probe_designs d JOIN venture_experiments e ON e.id = d.experiment_id
      WHERE e.founder_id = ? AND e.decision IS NULL AND e.retired_at IS NULL AND d.sealed_at IS NOT NULL
        AND d.designed_by = ? AND d.recommendation = 'run' ORDER BY d.sealed_at`, [founderId, FORGE]);
  if (sealed.length > 0) {
    const { allowExperiment, readiness, materialOf, HandRefused } = await import('./hand.js');
    const { shapeAndMake } = await import('./products/offer-composition.js');
    for (const s of sealed) {
      const id = String(s.experiment_id);
      // THE HANDS MAKE THE THING FIRST, when nothing has been made: the offer
      // shape, the deliverable and the offer text, or the reason none could be.
      if (!(await materialOf(id, 'deliverable'))) {
        if (outOfTime()) { out.waiting.push(`${id}: this pass used its ${minutes}; the hands make it on the next`); continue; }
        const may = await forgeMayTry(id, 'make', now);
        if (!may.may) { out.waiting.push(`${id}: the hands were refused ${timesWord(may.refused)}; tried again from ${may.from!.toISOString().slice(0, 10)}`); continue; }
        let made: Awaited<ReturnType<typeof shapeAndMake>>;
        try { made = await shapeAndMake(id); } catch (err) {
          if (err instanceof ModelDoorError) throw err;
          if (err instanceof ModelReplyRefused) {
            await recordForgeRefusal(id, 'make', err.message, now);
            out.notAllowed.push({ experimentId: id, because: `the hands could not make it: ${err.message}` });
            continue;
          }
          out.failed.push({ experimentId: id, because: err instanceof Error ? err.message : String(err) });
          continue;
        }
        if ('refused' in made) {
          await recordForgeRefusal(id, 'make', made.refused, now);
          out.notAllowed.push({ experimentId: id, because: `the hands could not make it: ${made.refused}` });
          continue;
        }
      }
      const ready = await readiness(id).catch(() => null);
      if (!ready?.ok) { out.notAllowed.push({ experimentId: id, because: ready ? ready.missing.join('; ') : 'readiness could not be read' }); continue; }
      try {
        await allowExperiment({ founderId, experimentId: id, under: 'the charter' });
        out.allowed.push(id);
      } catch (err) {
        out.notAllowed.push({ experimentId: id, because: err instanceof HandRefused ? err.message : String(err) });
      }
    }
  }
  return out;
}
