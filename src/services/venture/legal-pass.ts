// =============================================================================
// FOUNDRY — recognising exposure without certifying anything
//
// THE BLOCKER THIS REMOVES. `legalPictureOf` gates advancement, and for a REAL
// candidate nothing ever wrote a legal surface or answered whether the same
// value could be created with less of one — only the reference world did. So
// every real candidate read "nobody has asked" forever and could never move.
//
// WHAT THIS IS. Recognition: which of the sixteen constitutional exposure
// classes a candidate record gives grounds to name, with the exact words those
// grounds are; how serious each looks in context; what the pass could NOT
// resolve from here; what structural facts the record supports and which are
// unknown because the offer has no shape yet; and the lighter architecture —
// the same value with less legal surface and less organisational machinery.
//
// WHAT THIS IS NOT. A legal opinion. The model may recognise; it may not
// certify. Four things keep it honest: every recognition must quote words that
// are actually in the record (checked here and thrown away if not, the same
// rule the reader applies to its readings); durable floors override an
// optimistic severity for the inherently consequential classes; "I cannot
// resolve this from here" is a first-class output and blocks under the
// first-proof policy; and an unknown structural fact is recorded as unknown
// rather than guessed. The strongest positive sentence that can come out of
// this is composed downstream, from what was recognised, and never here.
//
// TWO SUBJECTS, TWO MOMENTS. At candidate level the pass reads the candidate
// record and most architecture-dependent facts come back unknown. Once an
// experimental asset has an offer shape — what is sold, what is claimed, what
// is collected, how it is delivered, where it sells, how it charges — the
// pass runs again at asset level and those facts become answerable.
// =============================================================================

import { nanoid } from 'nanoid';
import { query } from '../../db/client.js';
import { callSonnet, institutionSpend } from '../ai/client.js';
import { shieldUntrustedContent } from '../ai/prompt-shield.js';
import { dataBlockInstruction, wrapDataBlock } from '../ai/sanitize.js';
import { answerLighter, noteLegalSurface, type Severity } from './legal-surface.js';

export interface Recognised {
  subjectKind: 'company' | 'opportunity';
  subjectId: string;
  surfaces: number;
  unresolved: number;
  facts: number;
  unknownFacts: number;
  floorsApplied: string[];
  /** Recognitions the model offered whose grounds were not in the record. */
  droppedForGrounds: number;
  lighter: string | null;
}

export type PassResult = Recognised | { abstained: string } | { refused: string };

const SYSTEM = [
  'You are recognising legal and liability exposure for a small institution that',
  'owns digital economic assets. You are NOT a lawyer and nothing you say is legal',
  'advice or certification. Your job is RECOGNITION: which kinds of exposure the',
  'record in front of you gives grounds to name, how serious each looks from what',
  'the record says, what you cannot resolve, and what structural facts the record',
  'supports.',
  '',
  'RULES THAT ARE NOT NEGOTIABLE.',
  '  1. Every surface you name must quote the EXACT words from the record that',
  '     drove it, in "grounds". Copied character for character. A recognition',
  '     whose grounds are not in the record will be thrown away.',
  '  2. If the record does not let you tell whether a class applies, and it would',
  '     matter if it did, say so with standing "unresolved" and severity "material".',
  '     Do not resolve uncertainty by confidence.',
  '  3. A structural fact you cannot establish from the record is "present": null',
  '     with "basis": "unknown". Most of them are unknown at candidate level,',
  '     because the offer has no shape yet. That is the correct answer.',
  '  4. Severity is three words — minor, material, serious — and depends on the',
  '     actual context in the record, not on the class name. Ordinary personal',
  '     data is not automatically material; a customer email address is not a',
  '     material privacy business. Custody of money, regulated decisions and',
  '     professional reliance are always serious and need a qualified person.',
  '  5. Never write a law, a statute, a jurisdiction, or a legal conclusion.',
  '     Never claim anything is legal, compliant, safe, or permitted.',
  '  6. The lighter architecture is the same value with LESS legal surface and',
  '     less organisational machinery, in plain words: what is delivered, how it',
  '     is received, what it does not need. No product form, no vendor.',
  '',
  'Reply with one JSON object and nothing else:',
  '{',
  '  "abstain": <string or null — if the record is not about an economic offer,',
  '              or is too thin to recognise anything, say why and set the rest null>,',
  '  "surfaces": [',
  '    { "class": <one of the classes listed>,',
  '      "standing": "recognised" | "unresolved",',
  '      "severity": "minor" | "material" | "serious",',
  '      "what_it_creates": <in what the exposure consists, for THIS record>,',
  '      "known": <what the record establishes, or null>,',
  '      "unknown": <what would have to be known to settle it, or null>,',
  '      "grounds": <EXACT words from the record, at least a dozen characters> }',
  '  ],',
  '  "facts": [',
  '    { "fact": <one of the facts listed>, "present": true | false | null,',
  '      "basis": "stated" | "assumed_by_lighter" | "unknown",',
  '      "grounds": <EXACT words from the record, or null when unknown> }',
  '  ],',
  '  "lighter": <the lighter architecture in plain words, or null>',
  '}',
  '',
  dataBlockInstruction('record'),
].join('\n');

interface ParsedSurface {
  class: string; standing: string; severity: string; what_it_creates: string;
  known: string | null; unknown: string | null; grounds: string;
}
interface ParsedFact {
  fact: string; present: boolean | null; basis: string; grounds: string | null;
}
interface Parsed {
  abstain: string | null; surfaces: ParsedSurface[]; facts: ParsedFact[]; lighter: string | null;
}

function parse(text: string): Parsed | null {
  const from = text.indexOf('{');
  const to = text.lastIndexOf('}');
  if (from === -1 || to <= from) return null;
  try {
    const raw = JSON.parse(text.slice(from, to + 1)) as Record<string, unknown>;
    const str = (v: unknown): string | null => typeof v === 'string' && v.trim() !== '' ? v.trim() : null;
    const surfaces = Array.isArray(raw.surfaces) ? raw.surfaces : [];
    const facts = Array.isArray(raw.facts) ? raw.facts : [];
    return {
      abstain: str(raw.abstain),
      surfaces: surfaces.map((x) => {
        const s = x as Record<string, unknown>;
        return {
          class: String(s.class ?? ''), standing: String(s.standing ?? 'recognised'),
          severity: String(s.severity ?? 'material'),
          what_it_creates: String(s.what_it_creates ?? ''),
          known: str(s.known), unknown: str(s.unknown), grounds: String(s.grounds ?? ''),
        };
      }),
      facts: facts.map((x) => {
        const f = x as Record<string, unknown>;
        return {
          fact: String(f.fact ?? ''),
          present: f.present === true ? true : f.present === false ? false : null,
          basis: String(f.basis ?? 'unknown'), grounds: str(f.grounds),
        };
      }),
      lighter: str(raw.lighter),
    };
  } catch {
    return null;
  }
}

function unescape(s: string): string {
  return s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
}

/** The words have to be in the record. Whitespace-normalised, case-exact. */
function quoted(grounds: string | null, record: string): boolean {
  if (grounds === null) return false;
  const g = unescape(grounds).replace(/\s+/g, ' ').trim();
  if (g.length < 12) return false;
  return record.replace(/\s+/g, ' ').includes(g);
}

/**
 * THE RECORD THE PASS READS. At candidate level: what the candidate is, whose
 * problem, why it might, its kill thesis, its unknowns and any lighter answer
 * already recorded. At asset level: the offer shape too, which is where the
 * facts that were unknown become answerable.
 */
async function recordFor(subjectKind: 'company' | 'opportunity', subjectId: string): Promise<{
  founderId: string; world: 'real' | 'reference'; text: string;
  opportunityId: string; productId: string | null;
} | null> {
  if (subjectKind === 'opportunity') {
    const o = (await query(
      `SELECT founder_id, headline, who_has_it, the_problem, why_it_might, kill_thesis,
              unknowns_json, lighter_architecture, evidence_mode
         FROM venture_opportunities WHERE id = ?`, [subjectId]))
      .rows[0] as Record<string, unknown> | undefined;
    if (!o) return null;
    const text = [
      `What it is: ${String(o.headline)}`,
      `Whose problem: ${String(o.who_has_it)}`,
      `The problem: ${String(o.the_problem)}`,
      `Why it might: ${String(o.why_it_might)}`,
      `How it dies: ${String(o.kill_thesis)}`,
      `Unknowns: ${String(o.unknowns_json ?? '[]')}`,
      // The pass's own earlier lighter answer is NOT part of the record: a fact
      // quoted from it would be the model citing itself.
    ].filter(Boolean).join('\n');
    return { founderId: String(o.founder_id), text, opportunityId: subjectId, productId: null,
      world: String(o.evidence_mode) === 'reference' ? 'reference' : 'real' };
  }
  const p = (await query(
    `SELECT p.owner_id, p.name, p.form, p.reality, p.from_opportunity_id, p.from_experiment_id,
            s.sells, s.claims_made, s.collects, s.delivers_by, s.sells_to, s.charges_how,
            s.stated_by, s.stated_at
       FROM products p
       LEFT JOIN offer_shapes s ON s.product_id = p.id AND s.superseded_at IS NULL
      WHERE p.id = ?`, [subjectId])).rows[0] as Record<string, unknown> | undefined;
  if (!p) return null;
  const text = [
    `What it is: ${String(p.name)}`,
    p.form == null ? '' : `Form: ${String(p.form)}`,
    p.sells == null ? 'Offer shape: none yet' : [
      `Sells: ${String(p.sells)}`, `Claims made: ${String(p.claims_made)}`,
      `Collects: ${String(p.collects)}`, `Delivers by: ${String(p.delivers_by)}`,
      `Sells to: ${String(p.sells_to)}`, `Charges: ${String(p.charges_how)}`,
      `Stated by ${String(p.stated_by)} on ${String(p.stated_at).slice(0, 10)}`,
    ].join('\n'),
  ].filter(Boolean).join('\n');
  return { founderId: String(p.owner_id), text,
    opportunityId: p.from_opportunity_id == null ? '' : String(p.from_opportunity_id),
    productId: subjectId, world: String(p.reality) === 'reference' ? 'reference' : 'real' };
}

/**
 * RECOGNISE WHAT A CANDIDATE OR AN ASSET CREATES, AND RECORD ONLY WHAT THE
 * RECORD SUPPORTS.
 *
 * Real subjects only: the reference world declares its surfaces on purpose so
 * the block on an unasked question is exercised, and a rehearsal of recognition
 * would be a rehearsal of confidence. Re-running supersedes what was recorded
 * before, so a candidate whose claims narrowed, or an asset whose offer took
 * shape, is read again rather than patched.
 */
export async function recogniseExposure(input: {
  subjectKind: 'company' | 'opportunity'; subjectId: string; recognisedBy?: string;
}): Promise<PassResult> {
  const record = await recordFor(input.subjectKind, input.subjectId);
  if (!record) return { refused: 'no such subject' };
  if (record.world === 'reference') {
    return { refused: 'the reference world declares its own surfaces; recognition is for real records' };
  }
  const by = input.recognisedBy ?? 'legal_pass:sonnet';

  const shielded = shieldUntrustedContent(record.text);
  if (shielded.triggered) {
    return { abstained: 'the record contains something shaped like an instruction to a reader '
      + `(${shielded.reasons.slice(0, 3).join(', ')}), so I did not read it` };
  }

  const classes = (await query(
    'SELECT class, what_it_is FROM exposure_classes ORDER BY sort_order', []))
    .rows as unknown as Array<Record<string, unknown>>;
  const factKinds = (await query(
    'SELECT fact, what_it_is FROM structural_fact_kinds ORDER BY sort_order', []))
    .rows as unknown as Array<Record<string, unknown>>;
  const user = [
    `This is ${input.subjectKind === 'company' ? 'an asset with an offer' : 'a candidate, before any offer exists'}.`,
    '',
    'The classes of exposure you may name:',
    ...classes.map((c) => `  ${String(c.class)} — ${String(c.what_it_is)}`),
    '',
    'The structural facts you may answer:',
    ...factKinds.map((f) => `  ${String(f.fact)} — ${String(f.what_it_is)}`),
    '',
    'Here is the record:',
    wrapDataBlock('record', record.text, 4000),
  ].join('\n');

  let reply;
  try {
    reply = await callSonnet(SYSTEM, user, 2000, institutionSpend(
      // eslint-disable-next-line max-len
      'recognising legal exposure on a candidate for the owner\'s own portfolio search; there is no operating company to charge because no venture exists yet'));
  } catch (err) {
    return { refused: `could not read it: ${err instanceof Error ? err.message : 'unknown'}` };
  }
  const parsed = parse(reply.content);
  if (parsed === null) {
    return { abstained: 'the recognition came back in a shape I could not use' };
  }
  if (parsed.abstain !== null) return { abstained: parsed.abstain };

  const known = new Set(classes.map((c) => String(c.class)));
  const knownFacts = new Set(factKinds.map((f) => String(f.fact)));
  const floors = (await query(
    `SELECT structural_fact, class, min_severity, needs_professional, why FROM exposure_floors
      ORDER BY sort_order`, []))
    .rows as unknown as Array<Record<string, unknown>>;

  // A RE-READ SUPERSEDES THE OLD READ. What was recognised before stays in the
  // record as retired; nothing is edited.
  await query(
    `UPDATE legal_surfaces SET retired_at = datetime('now')
      WHERE subject_kind = ? AND subject_id = ? AND retired_at IS NULL`,
    [input.subjectKind, input.subjectId]);
  await query(
    `UPDATE structural_facts SET superseded_at = datetime('now')
      WHERE subject_kind = ? AND subject_id = ? AND superseded_at IS NULL`,
    [input.subjectKind, input.subjectId]);

  // THE FACTS FIRST, because the floors read them.
  const present = new Map<string, boolean | null>();
  let facts = 0;
  let unknownFacts = 0;
  for (const kind of factKinds) {
    const fact = String(kind.fact);
    const offered = parsed.facts.find((f) => f.fact === fact);
    // A KNOWN ANSWER NEEDS GROUNDS IN THE RECORD; an offer-shape read may
    // rest on the shape itself. Anything else is unknown, whatever the model
    // said — an answer with no words behind it is a guess.
    let value: boolean | null = null;
    let basis = 'unknown';
    let grounds: string | null = null;
    if (offered && offered.present !== null) {
      const fromShape = input.subjectKind === 'company' && record.text.includes('Sells:');
      if (quoted(offered.grounds, record.text)) {
        value = offered.present;
        basis = offered.basis === 'assumed_by_lighter' ? 'assumed_by_lighter' : fromShape ? 'offer_shape' : 'stated';
        grounds = offered.grounds;
      }
    }
    present.set(fact, value);
    if (value === null) unknownFacts += 1;
    facts += 1;
    await query(
      `INSERT INTO structural_facts
         (id, founder_id, subject_kind, subject_id, fact, present, basis, grounds,
          recognised_by, evidence_mode)
       VALUES (?,?,?,?,?,?,?,?,?,'real')`,
      [nanoid(), record.founderId, input.subjectKind, input.subjectId, fact,
        value === null ? null : value ? 1 : 0, basis, grounds, by]);
  }

  // THE SURFACES, GROUNDED OR DROPPED.
  let surfaces = 0;
  let unresolved = 0;
  let dropped = 0;
  const written = new Map<string, { severity: Severity; needs: boolean }>();
  for (const s of parsed.surfaces) {
    if (!known.has(s.class) || !knownFacts) continue;
    if (!quoted(s.grounds, record.text)) { dropped += 1; continue; }
    // ANYTHING BUT A PLAIN 'recognised' IS UNRESOLVED. A reader that wrote
    // 'unclear', 'possible' or 'unresolved_internally' was not certain, and
    // uncertainty is the thing this pass must never round up.
    const standing = s.standing.trim().toLowerCase() === 'recognised' ? 'recognised' : 'unresolved_internally';
    let severity: Severity = s.severity === 'serious' ? 'serious'
      : s.severity === 'minor' ? 'minor' : 'material';
    // AN UNRESOLVED SURFACE IS AT LEAST MATERIAL: "I do not know whether this
    // applies" about a minor thing is not worth recording, and about anything
    // else it is a question that stands in the way.
    if (standing === 'unresolved_internally' && severity === 'minor') severity = 'material';
    let needs = severity === 'serious';
    // DURABLE FLOORS OVERRIDE AN OPTIMISTIC READ. A surface the model itself
    // named in a floor's class carries the floor unless the record ESTABLISHED
    // the floor fact as absent: naming financial activity and then leaving
    // "custody of money" unknown is not a way past custody's floor. (The
    // second loop below, which synthesises a surface the model did not name,
    // keys on the fact being present, because it must not invent one from an
    // unknown.)
    for (const floor of floors) {
      if (String(floor.class) !== s.class) continue;
      if (present.get(String(floor.structural_fact)) === false) continue;
      severity = worse(severity, String(floor.min_severity) as Severity);
      needs = needs || Number(floor.needs_professional) === 1;
    }
    const id = await noteLegalSurface({
      founderId: record.founderId, subjectKind: input.subjectKind, subjectId: input.subjectId,
      cls: s.class, whatItCreates: s.what_it_creates || String(classes.find((c) => String(c.class) === s.class)?.what_it_is ?? s.class),
      severity, needsProfessional: needs,
      known: s.known, unknown: s.unknown ?? (standing === 'unresolved_internally'
        ? 'what the offer actually does, which the record does not yet say' : null),
      evidenceMode: 'real', standing, grounds: s.grounds, recognisedBy: by,
    });
    if (id === null) continue;
    written.set(s.class, { severity, needs });
    surfaces += 1;
    if (standing === 'unresolved_internally') unresolved += 1;
  }

  // AND A FLOOR THE MODEL DID NOT NAME IS STILL A FLOOR. A record that
  // establishes custody of money has a serious financial-activity surface
  // whether or not the reader thought to say so.
  const floorsApplied: string[] = [];
  for (const floor of floors) {
    const fact = String(floor.structural_fact);
    if (present.get(fact) !== true) continue;
    const cls = String(floor.class);
    floorsApplied.push(`${fact} → ${cls} ${String(floor.min_severity)}`);
    if (written.has(cls)) continue;
    const grounds = (await query(
      `SELECT grounds FROM structural_facts
        WHERE subject_kind = ? AND subject_id = ? AND fact = ? AND superseded_at IS NULL`,
      [input.subjectKind, input.subjectId, fact])).rows[0] as Record<string, unknown> | undefined;
    const id = await noteLegalSurface({
      founderId: record.founderId, subjectKind: input.subjectKind, subjectId: input.subjectId,
      cls, whatItCreates: `${String(floor.why)} (from the record: ${fact.replace(/_/g, ' ')})`,
      severity: String(floor.min_severity) as Severity,
      needsProfessional: Number(floor.needs_professional) === 1,
      known: String(floor.why), evidenceMode: 'real', standing: 'recognised',
      grounds: grounds?.grounds == null ? null : String(grounds.grounds), recognisedBy: `${by}+floor`,
    });
    if (id !== null) { written.set(cls, { severity: String(floor.min_severity) as Severity, needs: true }); surfaces += 1; }
  }

  // THE LIGHTER ARCHITECTURE, at candidate level, where the question lives.
  if (input.subjectKind === 'opportunity' && parsed.lighter !== null) {
    await answerLighter({ opportunityId: input.subjectId, answer: parsed.lighter });
  }

  return {
    subjectKind: input.subjectKind, subjectId: input.subjectId,
    surfaces, unresolved, facts, unknownFacts, floorsApplied, droppedForGrounds: dropped,
    lighter: parsed.lighter,
  };
}

function worse(a: Severity, b: Severity): Severity {
  const rank: Record<Severity, number> = { minor: 0, material: 1, serious: 2 };
  return rank[b] > rank[a] ? b : a;
}

/**
 * WHAT STILL NEEDS RECOGNISING. Real candidates with no live surfaces, or
 * surfaces older than the staleness horizon, or a claim revised since the last
 * pass; and real experimental assets whose offer shape is newer than their last
 * pass. Nothing else is read twice.
 */
export async function subjectsNeedingRecognition(): Promise<Array<{
  subjectKind: 'company' | 'opportunity'; subjectId: string; because: string;
}>> {
  const out: Array<{ subjectKind: 'company' | 'opportunity'; subjectId: string; because: string }> = [];
  const candidates = (await query(
    `SELECT o.id,
            (SELECT MAX(f.recorded_at) FROM structural_facts f
              WHERE f.subject_kind = 'opportunity' AND f.subject_id = o.id AND f.superseded_at IS NULL) AS last_read,
            (SELECT MAX(c.revised_at) FROM market_claims c WHERE c.opportunity_id = o.id) AS last_revised
       FROM venture_opportunities o
      WHERE o.verdict IS NULL AND o.evidence_mode = 'real'
      ORDER BY o.rowid`, []))
    .rows as unknown as Array<Record<string, unknown>>;
  for (const c of candidates) {
    if (c.last_read == null) { out.push({ subjectKind: 'opportunity', subjectId: String(c.id), because: 'never read' }); continue; }
    const age = (Date.now() - Date.parse(String(c.last_read).replace(' ', 'T') + 'Z')) / 86_400_000;
    if (age > 180) { out.push({ subjectKind: 'opportunity', subjectId: String(c.id), because: 'over six months old' }); continue; }
    if (c.last_revised != null && Date.parse(String(c.last_revised)) > Date.parse(String(c.last_read))) {
      out.push({ subjectKind: 'opportunity', subjectId: String(c.id), because: 'a claim narrowed since' });
    }
  }
  const assets = (await query(
    `SELECT p.id, s.stated_at,
            (SELECT MAX(f.recorded_at) FROM structural_facts f
              WHERE f.subject_kind = 'company' AND f.subject_id = p.id AND f.superseded_at IS NULL) AS last_read
       FROM products p
       JOIN offer_shapes s ON s.product_id = p.id AND s.superseded_at IS NULL
      WHERE p.standing = 'experimental' AND p.reality = 'real' AND p.status = 'active'
        AND p.deleted_at IS NULL
      ORDER BY p.rowid`, []))
    .rows as unknown as Array<Record<string, unknown>>;
  for (const a of assets) {
    if (a.last_read == null
      || Date.parse(String(a.stated_at).replace(' ', 'T') + 'Z') > Date.parse(String(a.last_read).replace(' ', 'T') + 'Z')) {
      out.push({ subjectKind: 'company', subjectId: String(a.id), because: 'the offer has a shape' });
    }
  }
  return out;
}
