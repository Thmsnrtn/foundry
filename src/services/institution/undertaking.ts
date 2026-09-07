// =============================================================================
// FOUNDRY — What the institution has undertaken, and for whom.
//
// The owner speaks in verbs: investigate, grow, fix, test, spend less, handle
// it, take this on. Until now those verbs had nowhere to go. An UNDERTAKING is
// where they go: one thing the institution has taken on for one company, with
// his words kept verbatim, what it was understood as shown before anything
// bound, and every step since as a sentence resting on a row.
//
// FOUR RULES.
//   1. It reads with phrase tables, never with a model. A verb it does not know
//      is refused, not guessed; his words are kept for him to say again.
//   2. Opening one grants nothing. Every step that would act — an act, a spend,
//      a message — goes through the doors it always did. This is the thread
//      those doors were missing, not a way round them.
//   3. Every step is real. The first look is composed from the readers the
//      institution already has; what it cannot see becomes a `needs` step
//      naming what would let it see, not a promise.
//   4. It is a thread, not a second truth. A step references the row that
//      holds the fact — the act, the recommendation, the sense — and never
//      restates it. Nothing attaches to a thread by sharing a company with
//      it; an act joins a thread only because it was proposed inside it.
// =============================================================================
import { nanoid } from 'nanoid';
import { query } from '../../db/client.js';

/** The families the reader knows today. The table `undertaking_kinds` is the
 * vocabulary and grows by migration; rows may carry kinds this reader cannot
 * yet hear. */
export type UndertakingKind =
  'understand' | 'investigate' | 'grow' | 'fix' | 'test' | 'economise' | 'handle';
export type StepKind =
  'looked' | 'found' | 'needs' | 'asked_you' | 'you_said' | 'proposed' | 'approved' | 'refused'
  | 'did' | 'waiting_on_world' | 'outcome' | 'learned' | 'closed';
export type RefKind =
  'situation' | 'recommendation' | 'proposed_act' | 'responsibility' | 'candidate'
  | 'experiment' | 'workspace' | 'sense' | 'number' | 'posture';
export type ClosedAs = 'done' | 'dropped' | 'superseded' | 'nothing_to_do';

export interface UndertakingReading {
  kind: UndertakingKind;
  /** What Foundry took him to be asking, in his register — shown before it binds. */
  understoodAs: string;
  /** The rest of his sentence after the verb, when there was one. */
  subject: string | null;
}

// ─── reading ─────────────────────────────────────────────────────────────────

/** Each verb, and the phrase that names it. Longest phrase wins a sentence that matches two. */
const VERBS: Array<{ kind: UndertakingKind; pattern: RegExp }> = [
  { kind: 'understand', pattern: /\b(adopt|take on|get to know|learn about|understand|work out what (this|it|that) is)\b/ },
  { kind: 'investigate', pattern: /\b(investigate|look into|find out|figure out|work out why|dig into|diagnose|get to the bottom of)\b/ },
  { kind: 'economise', pattern: /\b(spend less|cheaper|cut (the |our |my )?costs?|reduce (the |our |my )?costs?|save money|less expensive|bring (the )?costs? down|lower (the )?costs?|costs? less)\b/ },
  { kind: 'fix', pattern: /\b(fix|repair|sort (it|this|that|things) out|put (it|this|that) right|make (it|this|that) work|get (it|this|that) working|unbreak)\b/ },
  { kind: 'test', pattern: /\b(test|try (it|this|that) out|experiment with|put (it|this|that) to the (world|market)|validate)\b/ },
  { kind: 'grow', pattern: /\b(grow|scale|make (it|this|that) bigger|more customers|more revenue|more users|more sales)\b/ },
  { kind: 'handle', pattern: /\b(handle|take care of|deal with|look after (it|this|that)|just do it|see to it|sort this)\b/ },
];

/**
 * "WHY AREN'T CUSTOMERS CONVERTING?" IS A REQUEST, NOT A QUESTION ABOUT FOUNDRY.
 * A why-question about the business is an instruction to find out. A why-
 * question about what Foundry said ("why do you say that") is not, and goes
 * to the work behind the claim instead.
 */
const WHY_ABOUT_THE_BUSINESS = /^\s*why\s+(is|are|isn't|aren't|do|does|don't|doesn't|did|didn't|has|have|hasn't|haven't|won't|can't|cannot|has|were|was|wasn't|weren't)\b/;
const WHY_ABOUT_FOUNDRY = /^\s*why\s*\??\s*$|^\s*why\s+(do|did|are|would|have|should)\s+you\b|what makes you say|how do you know|show (me )?(your )?work/;

/**
 * Read one sentence for an undertaking. Null when it holds no verb the
 * institution can take on. Boundaries, allowances, preferences and postures
 * are read elsewhere and first; this sees only what reaches it.
 */
export function readUndertaking(raw: string): UndertakingReading | null {
  const said = raw.trim().replace(/[’]/g, "'");
  if (!said) return null;
  const text = said.toLowerCase();
  if (WHY_ABOUT_FOUNDRY.test(text)) return null;
  if (WHY_ABOUT_THE_BUSINESS.test(text)) {
    // HIS QUESTION, KEPT AS THE QUESTION. Turning "why aren't customers
    // converting?" into a clause would mean rewriting his words; the honest
    // sentence is that the institution will answer exactly what he asked.
    const question = said.replace(/[.?!]+\s*$/, '').trim();
    return { kind: 'investigate', understoodAs: `answer “${question}?”`, subject: question.toLowerCase() };
  }
  const hits = VERBS.map((v) => ({ ...v, m: v.pattern.exec(text) }))
    .filter((v) => v.m !== null)
    .sort((a, b) => (a.m?.index ?? 0) - (b.m?.index ?? 0));
  const hit = hits[0];
  if (!hit || !hit.m) return null;
  const after = text.slice(hit.m.index + hit.m[0].length).replace(/[.!?]+\s*$/, '').trim();
  const subject = after.length >= 3 ? after.slice(0, 160) : null;
  return { kind: hit.kind, understoodAs: understoodAs(hit.kind, subject), subject };
}

/**
 * THE NAME HE GAVE, IN HIS OWN CASING. `readUndertaking` lowercases the
 * sentence to read it; a company's name must come back the way he typed it.
 * "Adopt my Etsy shop Tidewater Prints" → "Tidewater Prints" is out of reach
 * without a parser of English, so this takes what follows the verb, drops a
 * leading "my"/"the"/"our" and a trailing full stop, and gives up on anything
 * that is not a plausible name (too long, or a clause).
 */
export function companyNamedIn(raw: string): string | null {
  const said = raw.trim().replace(/[’]/g, "'");
  const text = said.toLowerCase();
  const hits = VERBS.map((v) => v.pattern.exec(text)).filter((m): m is RegExpExecArray => m !== null)
    .sort((a, b) => a.index - b.index);
  const m = hits[0];
  if (!m) return null;
  let name = said.slice(m.index + m[0].length).replace(/[.!?]+\s*$/, '').trim();
  name = name.replace(/^(my|the|our|this)\s+/i, '').replace(/^(company|business|shop|store|app|product|site)\s+(called\s+)?/i, '').trim();
  const quoted = /^["“'‘](.+)["”'’]$/.exec(name);
  if (quoted) name = quoted[1]!.trim();
  if (name.length < 2 || name.length > 60) return null;
  if (/\b(and|because|so that|which|that is|is|are|was|were|more|less|why|how|what)\b/i.test(name)) return null;
  // A NAME IS CAPITALISED OR QUOTED. "take on more customers" is a wish, not a
  // company; "Adopt Tidewater Prints" and 'adopt "the little shop"' name one.
  if (!quoted && !/^[A-Z0-9]/.test(name)) return null;
  if (name.split(/\s+/).length > 6) return null;
  return name;
}

function understoodAs(kind: UndertakingKind, subject: string | null): string {
  const about = subject ? subject.replace(/^(why|that|whether|if)\s+/, '') : null;
  switch (kind) {
    case 'understand': return about ? `learn what ${about} is, and say what I can and cannot see` : 'learn what this is, and say what I can and cannot see';
    case 'investigate': return about ? `find out why ${about}` : 'find out what is going on here';
    case 'grow': return about ? `find where growth is being lost in ${about}` : 'find where growth is being lost and what would change it';
    case 'fix': return about ? `find what is wrong with ${about} and propose the act that repairs it` : 'find what is broken and propose the act that repairs it';
    case 'test': return about ? `turn ${about} into one sealed prediction and the cheapest thing that could disprove it` : 'turn what we believe into one sealed prediction and the cheapest thing that could disprove it';
    case 'economise': return about ? `find what is being spent on ${about} and which of it need not be` : 'find what is being spent here and which of it need not be';
    case 'handle': return about ? `take care of ${about}, within what you have allowed, and ask for the rest` : 'take care of this, within what you have allowed, and ask for the rest';
  }
}

/**
 * "STOP EVERYTHING ON ACREOS" IS BROAD. "Stop that" is not: it names one thing,
 * and which one is resolved from what is open, or asked back when two are.
 */
const BROAD_STOP = /\b(everything|all of (it|them|this|these|those)|stop all|all the work|every one)\b/;
export function isBroadStop(raw: string): boolean {
  return BROAD_STOP.test(raw.toLowerCase());
}

/** The verb, in his words, for a chip or a heading. */
export async function kindInOwnerWords(kind: string): Promise<string> {
  const r = (await query(`SELECT in_owner_words FROM undertaking_kinds WHERE kind = ?`, [kind]))
    .rows[0] as Record<string, unknown> | undefined;
  return r ? String(r.in_owner_words) : kind;
}

// ─── rows ────────────────────────────────────────────────────────────────────

export interface Undertaking {
  id: string; productId: string; companyName: string; kind: string;
  kindInWords: string;
  asked: string | null; understoodAs: string; openedBy: string;
  openedFrom: { kind: string; id: string | null };
  openedAt: string; closedAt: string | null; closedAs: ClosedAs | null;
  closedBecause: string | null; closedBy: string | null; supersededBy: string | null;
  evidenceMode: 'real' | 'reference';
}

export interface Step {
  id: string; at: string; kind: StepKind; said: string;
  ref: { kind: RefKind; id: string } | null; actor: string;
}

type Row = Record<string, unknown>;
const rows = async (sql: string, params: unknown[]): Promise<Row[]> =>
  (await query(sql, params)).rows as unknown as Row[];

function toUndertaking(r: Row): Undertaking {
  return {
    id: String(r.id), productId: String(r.product_id), companyName: String(r.company_name),
    kind: String(r.kind), kindInWords: String(r.in_owner_words),
    asked: r.asked == null ? null : String(r.asked), understoodAs: String(r.understood_as),
    openedBy: String(r.opened_by),
    openedFrom: { kind: String(r.opened_from_kind), id: r.opened_from_id == null ? null : String(r.opened_from_id) },
    openedAt: String(r.opened_at), closedAt: r.closed_at == null ? null : String(r.closed_at),
    closedAs: r.closed_as == null ? null : String(r.closed_as) as ClosedAs,
    closedBecause: r.closed_because == null ? null : String(r.closed_because),
    closedBy: r.closed_by == null ? null : String(r.closed_by),
    supersededBy: r.superseded_by == null ? null : String(r.superseded_by),
    evidenceMode: String(r.evidence_mode) as 'real' | 'reference',
  };
}

const SELECT = `SELECT u.id, u.product_id, p.name AS company_name, u.kind, k.in_owner_words, u.asked,
    u.understood_as, u.opened_by, u.opened_from_kind, u.opened_from_id, u.opened_at,
    u.closed_at, u.closed_as, u.closed_because, u.closed_by, u.superseded_by, u.evidence_mode
  FROM undertakings u JOIN products p ON p.id = u.product_id
  JOIN undertaking_kinds k ON k.kind = u.kind`;

/**
 * Record one step. Refused by the schema once the undertaking is closed, and
 * a second step for the same fact (same kind, same row) is a no-op rather than
 * a second event: a replayed decision must not read as two decisions.
 */
export async function stepOn(undertakingId: string, step: {
  kind: StepKind; said: string; ref?: { kind: RefKind; id: string } | null; actor: string;
}): Promise<string | null> {
  const owner = (await rows(`SELECT founder_id FROM undertakings WHERE id = ?`, [undertakingId]))[0];
  if (!owner) throw new Error(`undertaking ${undertakingId} does not exist`);
  if (step.ref) {
    const already = (await rows(
      `SELECT id FROM undertaking_steps WHERE undertaking_id = ? AND kind = ? AND ref_kind = ? AND ref_id = ?`,
      [undertakingId, step.kind, step.ref.kind, step.ref.id]))[0];
    if (already) return null;
  }
  const id = 'us_' + nanoid(10);
  await query(
    `INSERT INTO undertaking_steps (id, undertaking_id, founder_id, kind, said, ref_kind, ref_id, actor)
     VALUES (?,?,?,?,?,?,?,?)`,
    [id, undertakingId, String(owner.founder_id), step.kind, step.said.slice(0, 500),
      step.ref?.kind ?? null, step.ref?.id ?? null, step.actor]);
  return id;
}

/**
 * Open one. The company is resolved against the owner so nobody opens work on
 * a company that is not his; the evidence mode is read from the company, and
 * the schema refuses a mismatch regardless.
 */
export async function openUndertaking(input: {
  founderId: string; productId: string; kind: UndertakingKind;
  asked: string | null; understoodAs: string; openedBy: string;
  from: { kind: 'owner' | 'situation' | 'recommendation' | 'candidate'; id: string | null };
}): Promise<Undertaking | null> {
  // OWNERSHIP AND REALITY, TOGETHER. Reality is read so the undertaking is
  // marked invented when the company is; an invented company may have work
  // taken on for it, and it is disclosed on every row.
  const company = (await rows(
    `SELECT id, reality FROM products WHERE id = ? AND owner_id = ? AND deleted_at IS NULL`,
    [input.productId, input.founderId]))[0];
  if (!company) return null;
  // THE SAME SENTENCE, ALREADY UNDER WAY, IS THE SAME UNDERTAKING. A replayed
  // confirmation returns what is open rather than opening it again; the
  // schema's unique index holds the same line if two arrive at once.
  if (input.asked) {
    const open = (await rows(
      `SELECT id FROM undertakings WHERE product_id = ? AND asked = ? AND closed_at IS NULL`,
      [input.productId, input.asked]))[0];
    if (open) return undertakingById(input.founderId, String(open.id));
  }
  const id = 'u_' + nanoid(10);
  await query(
    `INSERT INTO undertakings (id, founder_id, product_id, kind, asked, understood_as, opened_by,
        opened_from_kind, opened_from_id, evidence_mode)
     VALUES (?,?,?,?,?,?,?,?,?,?)`,
    [id, input.founderId, input.productId, input.kind, input.asked, input.understoodAs.slice(0, 300),
      input.openedBy, input.from.kind, input.from.id, String(company.reality)]);
  if (input.asked) {
    await stepOn(id, { kind: 'you_said', said: `You said: “${input.asked.slice(0, 300)}”`, actor: input.openedBy });
  }
  await firstLook(id, input.founderId, input.productId, input.kind);
  return undertakingById(input.founderId, id);
}

/** One, if it is his. */
export async function undertakingById(founderId: string, id: string): Promise<Undertaking | null> {
  const r = (await rows(`${SELECT} WHERE u.id = ? AND u.founder_id = ?`, [id, founderId]))[0];
  return r ? toUndertaking(r) : null;
}

/** Everything under way for one company, oldest first. */
export async function openUndertakings(productId: string): Promise<Undertaking[]> {
  return (await rows(`${SELECT} WHERE u.product_id = ? AND u.closed_at IS NULL ORDER BY u.opened_at`, [productId]))
    .map(toUndertaking);
}

/** What was closed for one company, newest first. */
export async function closedUndertakings(productId: string, limit = 5): Promise<Undertaking[]> {
  return (await rows(`${SELECT} WHERE u.product_id = ? AND u.closed_at IS NOT NULL
      ORDER BY u.closed_at DESC LIMIT ?`, [productId, limit])).map(toUndertaking);
}

/** Everything under way across his real companies, for "what are you doing". */
export async function underWayFor(founderId: string): Promise<Undertaking[]> {
  // His real companies only: an invented company's work is on its own page
  // and never in the answer to what the institution is doing for him.
  return (await rows(`${SELECT} WHERE u.founder_id = ? AND u.closed_at IS NULL AND p.reality = 'real'
      ORDER BY u.opened_at`, [founderId])).map(toUndertaking);
}

/**
 * The thread: every step in order, and what has actually been spent through
 * it. The thread keeps no money of its own: spend is read from the ledger,
 * through the acts that were proposed inside this undertaking.
 */
export async function threadOf(undertakingId: string): Promise<{ steps: Step[]; costCents: number; latest: Step | null }> {
  const steps = (await rows(
    `SELECT id, at, kind, said, ref_kind, ref_id, actor FROM undertaking_steps
      WHERE undertaking_id = ? ORDER BY at, rowid`, [undertakingId])).map((r) => ({
    id: String(r.id), at: String(r.at), kind: String(r.kind) as StepKind, said: String(r.said),
    ref: r.ref_kind == null ? null : { kind: String(r.ref_kind) as RefKind, id: String(r.ref_id) },
    actor: String(r.actor),
  }));
  const spent = (await rows(
    `SELECT COALESCE(SUM(CASE WHEN m.source = 'reversed' THEN -m.amount_cents ELSE m.amount_cents END), 0) AS cents
       FROM asset_money_spent m
      WHERE m.act_ref IN (SELECT id FROM proposed_acts WHERE undertaking_id = ?)`, [undertakingId]))[0];
  return { steps, costCents: Math.max(0, Number(spent?.cents ?? 0)), latest: steps[steps.length - 1] ?? null };
}

/** Close one. Final: the schema refuses a second close and any step after it. */
export async function closeUndertaking(input: {
  founderId: string; id: string; as: ClosedAs; because: string; by: string; supersededBy?: string | null;
}): Promise<boolean> {
  const mine = await undertakingById(input.founderId, input.id);
  if (!mine || mine.closedAt !== null) return false;
  await query(
    `UPDATE undertakings SET closed_at = CURRENT_TIMESTAMP, closed_as = ?, closed_because = ?, closed_by = ?,
        superseded_by = ?
      WHERE id = ? AND closed_at IS NULL`,
    [input.as, input.because.slice(0, 300), input.by, input.as === 'superseded' ? input.supersededBy ?? null : null, input.id]);
  await stepOn(input.id, { kind: 'closed', said: closedInWords(input.as, input.because), actor: input.by });
  return true;
}

function closedInWords(as: ClosedAs, because: string): string {
  switch (as) {
    case 'done': return `Done: ${because}`;
    case 'dropped': return `Dropped: ${because}`;
    case 'superseded': return `Superseded: ${because}`;
    case 'nothing_to_do': return `Nothing to do: ${because}`;
  }
}

/**
 * "STOP EVERYTHING ON X": drop everything under way for one company. Only for
 * explicitly broad intent — "stop that" resolves one thread, or asks which.
 */
export async function dropEverythingUnderWay(input: {
  founderId: string; productId: string; because: string; by: string;
}): Promise<number> {
  let n = 0;
  for (const u of await openUndertakings(input.productId)) {
    if (await closeUndertaking({ founderId: input.founderId, id: u.id, as: 'dropped', because: input.because, by: input.by })) n += 1;
  }
  return n;
}

// ─── hearing what happened, by reference only ───────────────────────────────

/**
 * THE OPEN THREADS THAT REFERENCE ONE ROW. Never "every open thread for the
 * company": a thread hears about a situation, a recommendation, a sense or an
 * act only because one of its own steps, or its origin, points at that row.
 * A sense is referenced by key, so for senses the company is required too.
 */
export async function openThreadsReferencing(
  ref: { kind: RefKind | 'origin'; id: string; originKind?: 'situation' | 'recommendation' | 'candidate' }, productId?: string,
): Promise<string[]> {
  const byStep = ref.kind === 'origin' ? [] : await rows(
    `SELECT DISTINCT u.id FROM undertaking_steps s JOIN undertakings u ON u.id = s.undertaking_id
      WHERE s.ref_kind = ? AND s.ref_id = ? AND u.closed_at IS NULL${productId ? ' AND u.product_id = ?' : ''}`,
    productId ? [ref.kind, ref.id, productId] : [ref.kind, ref.id]);
  const byOrigin = ref.kind === 'origin' && ref.originKind ? await rows(
    `SELECT id FROM undertakings WHERE opened_from_kind = ? AND opened_from_id = ? AND closed_at IS NULL`,
    [ref.originKind, ref.id]) : [];
  return [...new Set([...byStep, ...byOrigin].map((r) => String(r.id)))];
}

/**
 * NOTICE, ON EVERY OPEN THREAD THAT REFERENCES THE ROW. A pure notice: it
 * writes a step and changes nothing else. A thread closed between the lookup
 * and the write is skipped, not failed — the event still happened, and it is
 * the caller's job that must not fall over because a thread ended.
 */
export async function noticeOnThreadsReferencing(
  ref: Parameters<typeof openThreadsReferencing>[0],
  step: { kind: StepKind; said: string; ref?: { kind: RefKind; id: string } | null; actor: string },
  productId?: string,
): Promise<number> {
  let n = 0;
  for (const id of await openThreadsReferencing(ref, productId)) {
    try {
      if (await stepOn(id, step) !== null) n += 1;
    } catch (err) {
      if (!/undertaking_is_closed/.test(err instanceof Error ? err.message : String(err))) throw err;
    }
  }
  return n;
}

// ─── what the institution can honestly say on day one ───────────────────────

/** Which recommendation kinds are the same verb, so accepting advice opens the right undertaking. */
export function kindForRecommendation(recommendationKind: string): UndertakingKind {
  if (/^find_|^settle_|^check_/.test(recommendationKind)) return 'investigate';
  if (/^recover_|^restore_/.test(recommendationKind)) return 'fix';
  if (/^connect_/.test(recommendationKind)) return 'understand';
  if (/^talk_to_/.test(recommendationKind)) return 'handle';
  return 'handle';
}

/**
 * THE FIRST LOOK, FROM ROWS. What the situation reader says, what the numbers
 * did, what it can see and from where, what it cannot see and what would let
 * it. Nothing here is invented: an absence becomes a `needs` step, and a verb
 * with nothing to work from says so as its first step rather than pretending
 * to have begun.
 */
async function firstLook(id: string, founderId: string, productId: string, kind: UndertakingKind): Promise<void> {
  const by = 'institution:first_look';
  const { whatSituation } = await import('../founder/what-situation.js');
  const { currentSpell, openRecommendations } = await import('../founder/situation-chain.js');
  const { whatTheNumbersSay } = await import('../founder/what-the-numbers-say.js');
  const [situation, spell, numbers, advice] = await Promise.all([
    whatSituation(productId), currentSpell(productId), whatTheNumbersSay(productId), openRecommendations(productId),
  ]);
  const seen = await rows(
    `SELECT c.sense_key, c.provider, c.last_observed_at, s.would_learn FROM company_senses c
       JOIN senses s ON s.sense_key = c.sense_key WHERE c.product_id = ? AND c.disconnected_at IS NULL
      ORDER BY s.sort_order`, [productId]);
  const blind = await rows(
    `SELECT s.sense_key, s.cannot_see, s.would_learn FROM senses s
      WHERE s.sense_key <> 'reference_world' AND s.sense_key NOT IN
        (SELECT sense_key FROM company_senses WHERE product_id = ? AND disconnected_at IS NULL)
      ORDER BY s.sort_order`, [productId]);

  await stepOn(id, { kind: 'looked', said: `I read the situation: ${situation.headline}`,
    ref: spell ? { kind: 'situation', id: spell.id } : null, actor: by });
  if (numbers.absence) {
    await stepOn(id, { kind: 'needs', said: numbers.absence, actor: by });
  } else {
    const moved = numbers.numbers.filter((n) => n.direction === 'rose' || n.direction === 'fell');
    await stepOn(id, { kind: 'found', said: moved.length
      ? moved.slice(0, 3).map((n) => n.sentence).join(' ')
      : `Nothing I can see has moved much since a month ago (as of ${String(numbers.asOf)}).`, actor: by });
  }
  if (seen.length) {
    await stepOn(id, { kind: 'looked', said: `I can see ${seen.map((s) => `${String(s.would_learn)} (${String(s.provider)}${
      s.last_observed_at ? '' : ', nothing reported yet'})`).join('; ')}.`, actor: by });
  }
  for (const a of advice) {
    await stepOn(id, { kind: 'proposed', said: `I have already raised: ${a.summary} — waiting on you.`,
      ref: { kind: 'recommendation', id: a.id }, actor: by });
  }
  const noticed = await rows(
    `SELECT id, proposed_responsibility FROM responsibility_candidates WHERE product_id = ? AND status = 'pending'
      ORDER BY created_at`, [productId]);
  for (const c of noticed) {
    await stepOn(id, { kind: 'proposed', said: `I have noticed something and asked whether to look after it: ${String(c.proposed_responsibility)}.`,
      ref: { kind: 'candidate', id: String(c.id) }, actor: by });
  }

  // What each verb needs that it does not have, said as the thing that would let it.
  const wants: Record<UndertakingKind, string[]> = {
    understand: blind.map((b) => String(b.sense_key)),
    investigate: ['revenue', 'customers', 'product_usage'],
    grow: ['customers', 'product_usage', 'revenue'],
    fix: ['errors', 'product_usage', 'support'],
    test: ['product_usage', 'revenue'],
    economise: ['costs', 'revenue'],
    handle: ['support', 'errors', 'revenue'],
  };
  const missing = blind.filter((b) => wants[kind].includes(String(b.sense_key)));
  for (const b of missing.slice(0, kind === 'understand' ? 8 : 3)) {
    await stepOn(id, { kind: 'needs', said: `I cannot see ${String(b.cannot_see)}. Letting me would show me ${String(b.would_learn)}.`,
      ref: { kind: 'sense', id: String(b.sense_key) }, actor: by });
  }

  if (kind === 'economise') {
    const spent = (await rows(
      `SELECT COALESCE(SUM(amount_cents),0) AS cents FROM asset_money_spent
        WHERE product_id = ? AND recorded_at >= datetime('now','-30 day')`, [productId]))[0];
    const { burdenFor } = await import('../founder/burden.js');
    const mine = (await burdenFor(founderId)).find((b) => b.productId === productId);
    const cents = Number(spent?.cents ?? 0);
    await stepOn(id, { kind: 'found', said: `${cents > 0 ? `$${(cents / 100).toFixed(2)} left this company in thirty days` : 'No money left this company in thirty days'}${
      mine && mine.aiCostCents > 0 ? `, and my own thinking about it cost $${(mine.aiCostCents / 100).toFixed(2)}` : ''}.`, actor: by });
  }
  if (kind === 'handle') {
    const held = await rows(
      `SELECT id, title, state FROM institutional_responsibilities WHERE product_id = ? AND disposition = 'active'
        ORDER BY created_at`, [productId]);
    if (held.length) {
      for (const h of held) {
        await stepOn(id, { kind: 'looked', said: `In my hands here: ${String(h.title)} (${String(h.state).replaceAll('_', ' ')}).`,
          ref: { kind: 'responsibility', id: String(h.id) }, actor: by });
      }
    } else {
      await stepOn(id, { kind: 'needs', said: 'Nothing is in my hands here yet. Say what you want taken care of, or answer what I notice, and I will ask for what it needs.', actor: by });
    }
  }
  if (kind === 'test') {
    await stepOn(id, { kind: 'needs', said: 'A test needs one belief I can seal as a prediction. Tell me what you think would happen, and I will find the cheapest thing that could prove it wrong.', actor: by });
  }
}
