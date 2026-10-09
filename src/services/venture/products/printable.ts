// =============================================================================
// FOUNDRY — the printable: a file a stranger can buy, made by the hands
//
// WHY THIS EXISTS. The institution could find demand and design an offer, and
// had never made a thing a stranger could buy without a person making it. A
// bench showed a capable model with simple hands can: it wrote a 22-page
// fill-in file as HTML, headless Chromium printed it, and a buyer panel read
// it. This is those hands, inside the institution's rules.
//
// THE MODEL WRITES WORDS; THE REPOSITORY OWNS THE LAYOUT. A printable's pages
// are written in a closed vocabulary (`ALLOWED`: a few elements, a few
// classes, no attribute but `class`) against an owned stylesheet
// (src/public/printable.css) and owned fonts. A style attribute, a <style>, a
// link, an image or a class outside the list is refused, never stripped,
// because a file that was silently changed is not the file that was checked.
// The cover, the contents, every footer, the version and the colophon are the
// template's, so the version and the disclaimers are printed by code.
//
// NOTHING SHIPS UNTIL IT HAS PASSED, each refusal said in the institution's
// own words and recorded where the forge's refusals live (`forge_refusals`,
// stage 'make'):
//   1. the vocabulary (above);
//   2. nothing invented: a deterministic scan for statistics, testimonials,
//      reviews and credentials, then a model check that FAILS CLOSED;
//   3. a legal, medical or money topic carries the owned general-education
//      disclaimer, and advice about a reader's own regulated decision is
//      refused outright;
//   4. the printed file has exactly the pages it was composed with, within
//      bounds, and no page's content runs past its margin;
//   5. a panel of independent stranger personas: a clear yes ships, a clear
//      no is refused, and the middle is held for the owner as ONE item;
//   6. a version, printed on every page and carried on the listing.
//
// STORED THROUGH THE MATERIALS, NOT BESIDE THEM. The printed bytes, their
// sha256 and the version live in the `deliverable` material's body as a JSON
// manifest; `experiment_materials` is immutable and supersedes by kind, which
// is exactly the versioning a file needs. There is no second store.
//
// WHO MAY TURN THIS ON. Making files is the class of decision PENDING 34 asks
// the owner about for workbooks, and STRATEGY H52 refuses a universal
// factory. So this kind is off until his own `origination_policy` row says
// `make_printable_pdf = yes` (PENDING 41: he decided yes on 8 October 2026,
// and the row is written only by his own press of Control's button), and off
// on any machine with no Chromium to print with (the production image carries
// Debian's headless shell at FOUNDRY_CHROMIUM_PATH). Nothing here decides either.
// =============================================================================
import { createHash, createHmac, timingSafeEqual } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { query } from '../../../db/client.js';
import { dataBlockInstruction, wrapDataBlock } from '../../ai/sanitize.js';
import { BANNED_CLAIMS, HAND, recordMaterial } from '../hand.js';
import type { Material, OfferShapePlan } from '../hand.js';

type Row = Record<string, unknown>;

// ─── The kind is the owner's to turn on ──────────────────────────────────────

/** The `origination_policy` requirement his row answers (migration 392). */
export const PRINTABLE_POLICY = 'make_printable_pdf';

/** His answer, read from his own live row only: allowed means value `yes`. */
export async function printablesChoice(founderId: string): Promise<{ allowed: boolean; on: string | null }> {
  const row = (await query(
    `SELECT value, set_at FROM origination_policy
      WHERE founder_id = ? AND requirement = ? AND superseded_at IS NULL
      ORDER BY set_at DESC, rowid DESC LIMIT 1`, [founderId, PRINTABLE_POLICY])).rows[0] as Row | undefined;
  return { allowed: !!row && String(row.value ?? '') === 'yes', on: row ? String(row.set_at).slice(0, 10) : null };
}

/** Whether the hands may make printables for him: his own row says yes, and a renderer exists here. */
export async function mayMakePrintables(founderId: string, env: NodeJS.ProcessEnv = process.env): Promise<{ may: boolean; because: string }> {
  const choice = await printablesChoice(founderId);
  if (!choice.allowed) {
    return { may: false, because: 'you have not said Foundry may make printable files itself (PENDING 41)' };
  }
  if (!substitute && !chromiumPath(env)) {
    return { may: false, because: `you allowed it on ${choice.on ?? 'a recorded date'}, but there is no Chromium on this machine to print a page with` };
  }
  return { may: true, because: `you allowed it on ${choice.on ?? 'a recorded date'}` };
}

// ─── The vocabulary the model may write in ───────────────────────────────────

/** Each element the model may use, and the classes it may carry. Nothing else, and no attribute but `class` (and `colspan`). */
export const ALLOWED: Readonly<Record<string, readonly string[]>> = Object.freeze({
  h3: [], p: ['small'], ul: ['check'], ol: [], li: [], strong: [], em: [], b: [], br: [],
  table: ['ws', 'tall'], thead: [], tbody: [], tr: [], th: [], td: ['lbl'],
  div: ['box', 'green', 'cols', 'cols3', 'lines', 'field'], span: ['small', 'pill'], i: [],
});
const VOID = new Set(['br']);
const ENTITIES: Record<string, string> = {
  amp: '&', lt: '<', gt: '>', quot: '"', '#39': '\'', apos: '\'', nbsp: ' ', rsquo: '’', lsquo: '‘',
  ldquo: '“', rdquo: '”', mdash: '—', ndash: '–', hellip: '…', times: '×', middot: '·',
};

/**
 * WHAT IN THIS PAGE THE DESIGN SYSTEM DOES NOT ALLOW, each said by name; an
 * empty list is a page that may be printed. A refusal, never a repair.
 */
export function sanitizePageHtml(html: string): string[] {
  const problems: string[] = [];
  if (/<!-{2}/.test(html)) problems.push('a comment is not allowed');
  const stack: string[] = [];
  const tag = /<(\/?)([a-zA-Z][a-zA-Z0-9]*)([^<>]*)>|[<>]/g;
  let m: RegExpExecArray | null;
  while ((m = tag.exec(html)) !== null) {
    if (m[2] === undefined) { problems.push('a bare "<" or ">" is not allowed; write &lt; or &gt;'); continue; }
    const closing = m[1] === '/';
    const name = m[2].toLowerCase();
    const allowed = ALLOWED[name];
    if (!allowed) { problems.push(`<${name}> is not in the printable vocabulary`); continue; }
    if (closing) {
      const open = stack.pop();
      if (open !== name) problems.push(open ? `</${name}> closes <${open}>` : `</${name}> closes nothing`);
      continue;
    }
    let rest = m[3] ?? '';
    const selfClosing = /\/\s*$/.test(rest);
    rest = rest.replace(/\/\s*$/, '');
    const attr = /\s+([a-zA-Z_:][-a-zA-Z0-9_:.]*)(?:\s*=\s*"([^"]*)")?/g;
    let consumed = '';
    let a: RegExpExecArray | null;
    while ((a = attr.exec(rest)) !== null) {
      consumed += a[0];
      const key = a[1]!.toLowerCase();
      const value = a[2] ?? '';
      if (key === 'class') {
        for (const cls of value.split(/\s+/).filter(Boolean)) if (!allowed.includes(cls)) problems.push(`class "${cls}" is not allowed on <${name}>`);
      } else if (key === 'colspan' && (name === 'td' || name === 'th')) {
        if (!/^[1-6]$/.test(value)) problems.push('colspan must be 1 to 6');
      } else problems.push(`attribute "${key}" on <${name}> is not allowed`);
    }
    if (consumed.length !== rest.length && rest.trim() !== '') problems.push(`<${name}> has an attribute that cannot be read`);
    if (!VOID.has(name) && !selfClosing) stack.push(name);
  }
  for (const open of stack.reverse()) problems.push(`<${open}> is not closed`);
  for (const ent of html.matchAll(/&([a-zA-Z0-9#]+);?/g)) {
    if (!ent[0].endsWith(';') || !(ent[1]! in ENTITIES || /^#\d{2,5}$/.test(ent[1]!))) problems.push(`"${ent[0]}" is not an entity the file may use`);
  }
  return [...new Set(problems)];
}

// ─── The spec the model writes, and its plain text ───────────────────────────

export interface PrintablePage { heading: string; lede: string; html: string }
export interface PrintableSpec { kind: 'printable_pdf'; title: string; subtitle: string; kicker: string; pages: PrintablePage[] }

/** Bounds on the printed file: cover, contents and colophon included. */
export const PRINTABLE_PAGES = { min: 5, max: 40 } as const;

const decode = (s: string): string => s.replace(/&([a-zA-Z0-9#]+);/g, (all, e: string) => ENTITIES[e]
  ?? (/^#\d+$/.test(e) ? String.fromCharCode(Number(e.slice(1))) : all));
const textOf = (html: string): string => decode(html.replace(/<br\s*\/?>/gi, '\n').replace(/<\/(p|li|h3|div|tr|th|td)>/gi, '\n').replace(/<[^>]*>/g, ' '))
  .replace(/[ \t]+/g, ' ').replace(/\s*\n\s*/g, '\n').trim();

/** Everything the file says in words: what the gates and the panel read. */
export function plainTextOf(spec: Pick<PrintableSpec, 'title' | 'subtitle' | 'kicker' | 'pages'>): string {
  return [spec.title, spec.subtitle, spec.kicker, ...spec.pages.flatMap((p) => [p.heading, p.lede, textOf(p.html)])].join('\n');
}

/** What is wrong with the spec's shape, before anything is read for meaning. */
export function specProblems(spec: PrintableSpec): string[] {
  const out: string[] = [];
  const len = (what: string, s: unknown, max: number) => {
    if (typeof s !== 'string' || s.trim() === '') out.push(`${what} is empty`);
    else if (s.length > max) out.push(`${what} is longer than ${String(max)} characters`);
  };
  len('the title', spec.title, 90); len('the subtitle', spec.subtitle, 240); len('the kicker', spec.kicker, 60);
  if (!Array.isArray(spec.pages) || spec.pages.length < PRINTABLE_PAGES.min - 3 || spec.pages.length > PRINTABLE_PAGES.max - 3) {
    out.push(`a file has ${String(PRINTABLE_PAGES.min - 3)} to ${String(PRINTABLE_PAGES.max - 3)} pages of its own; this has ${String(Array.isArray(spec.pages) ? spec.pages.length : 0)}`);
    return out;
  }
  spec.pages.forEach((p, i) => {
    len(`page ${String(i + 1)}'s heading`, p.heading, 80); len(`page ${String(i + 1)}'s lede`, p.lede, 240); len(`page ${String(i + 1)}`, p.html, 7000);
    if (typeof p.html === 'string') for (const why of sanitizePageHtml(p.html)) out.push(`page ${String(i + 1)} ("${String(p.heading)}"): ${why}`);
  });
  return out;
}

// ─── Nothing invented ────────────────────────────────────────────────────────

const quoteAround = (text: string, index: number, length: number): string =>
  text.slice(Math.max(0, index - 40), index + length + 40).replace(/\s+/g, ' ').trim();

const NUMBER_WORD = '(?:\\d+|one|two|three|four|five|six|seven|eight|nine|ten)';
const FABRICATION: Array<{ kind: string; re: RegExp }> = [
  { kind: 'a statistic', re: /\b\d+(?:\.\d+)?\s?%|\bper ?cent\b/gi },
  { kind: 'a statistic', re: new RegExp(`\\b${NUMBER_WORD}\\s+(?:out of|in)\\s+(?:\\d+|ten|a hundred|every)\\b`, 'gi') },
  { kind: 'a statistic with no source', re: /\b(?:studies|research|surveys?|statistics|data|experts)\s+(?:show|shows|found|finds|suggests?|proves?|say)\b/gi },
  { kind: 'a statistic', re: /\b(?:most|the majority of|the average|on average,?)\s+(?:people|homeowners|americans|buyers|users|parents|families|households|owners|customers)\b/gi },
  { kind: 'a statistic', re: /\b\d[\d,.]*\s?(?:million|billion|thousand)\b/gi },
  { kind: 'a source nobody can check', re: /\baccording to\b/gi },
  { kind: 'a testimonial', re: /["“][^"”]{6,240}["”]\s*[—–-]\s*[A-Z][a-z]+/g },
  { kind: 'a testimonial', re: /\b(?:testimonials?|customers say|buyers say|what (?:our )?(?:buyers|customers|users) say|loved by)\b/gi },
  { kind: 'a review or rating', re: /\b\d(?:\.\d)?\s*(?:\/\s*5\s*)?stars?\b|★|\b(?:rated|reviews|five-star|5-star|best-?sell(?:ing|er))\b/gi },
  { kind: 'a credential', re: /\b(?:written|created|designed|developed|reviewed|approved|made|checked)\s+by\s+(?:an?\s+|our\s+)?(?:[a-z-]+\s+){0,3}(?:certified|licensed|accredited|expert|professional|doctor|nurse|lawyer|attorney|accountant|cpa|inspector|therapist|coach|specialist)s?\b/gi },
  { kind: 'a credential', re: /\b\d+\+?\s+years of experience\b|\b(?:award-winning|as seen (?:in|on)|featured in|endorsed by|recommended by)\b/gi },
];

/** The invented-looking things in the text, each quoted. Deterministic; the model check comes after. */
export function fabricationScan(text: string): string[] {
  const out: string[] = [];
  for (const { kind, re } of FABRICATION) {
    for (const m of text.matchAll(re)) out.push(`${kind}: "${quoteAround(text, m.index ?? 0, m[0].length)}"`);
  }
  const lower = text.toLowerCase();
  for (const phrase of BANNED_CLAIMS) if (lower.includes(phrase)) out.push(`a claim the Workshop does not make: "${phrase}"`);
  return [...new Set(out)];
}

// ─── Sensitive topics and regulated advice ───────────────────────────────────

export type SensitiveTopic = 'legal' | 'medical' | 'financial';
const TOPICS: Record<SensitiveTopic, RegExp> = {
  legal: /\b(?:(?:a|the|your|my|his|her|their|living|last) wills?|testament|probate|power of attorney|executors?|estate plan(?:ning)?|living trust|guardianship|custody|leases?|landlords?|tenants?|eviction|contracts?|lawsuits?|divorce|copyright|trademark)\b/i,
  medical: /\b(?:medications?|medicines?|prescriptions?|dosage|doses?|diagnos\w*|symptoms?|treatments?|therapy|blood pressure|insulin|allerg(?:y|ies)|physicians?|pregnan\w*|mental health|\d+\s?mg)\b/i,
  financial: /\b(?:invest(?:ing|ment|ments)?|retirement|401\(?k\)?|stocks?|index funds?|tax(?:es)?|debts?|loans?|mortgages?|credit (?:score|cards?)|budget(?:ing)?|savings)\b/i,
};

/** The owned disclaimers. Printed by the template, never written by the model. */
export const DISCLAIMERS: Readonly<Record<SensitiveTopic, string>> = Object.freeze({
  legal: 'General information for your own records, not legal advice. Law differs from place to place; for a decision about your own situation, ask a qualified lawyer where you live.',
  medical: 'General information for your own records, not medical advice. For anything about your own health or medicines, ask a doctor, nurse or pharmacist.',
  financial: 'General information for your own records, not financial, tax or investment advice. For a decision about your own money, ask a qualified adviser.',
});

export function sensitiveTopicsOf(text: string): SensitiveTopic[] {
  return (Object.keys(TOPICS) as SensitiveTopic[]).filter((t) => TOPICS[t].test(text));
}

const REGULATED: Array<{ topic: SensitiveTopic; re: RegExp }> = [
  { topic: 'legal', re: /\byou (?:do not|don't) need (?:a|an) (?:lawyer|attorney|solicitor|notary)\b/gi },
  { topic: 'legal', re: /\b(?:is|will be|becomes) (?:legally )?(?:valid|binding|enforceable)\b/gi },
  { topic: 'legal', re: /\byou should (?:sue|file|sign|contest|evict)\b/gi },
  { topic: 'medical', re: /\b(?:take|give|use)\s+\d+(?:\.\d+)?\s?(?:mg|ml|milligrams?|tablets?|pills?)\b/gi },
  { topic: 'medical', re: /\b(?:stop|start|increase|decrease|double|skip) (?:taking )?(?:your |the )?(?:medication|medicine|dose|prescription)s?\b/gi },
  { topic: 'medical', re: /\byou (?:have|probably have|may have|likely have) (?:a |an )?[a-z]+ (?:disorder|disease|condition|infection|deficiency)\b/gi },
  { topic: 'financial', re: /\byou should (?:invest|buy|sell|move|put|withdraw|borrow|refinance)\b/gi },
  { topic: 'financial', re: /\bguaranteed (?:return|income|profit)s?\b/gi },
];

/** Advice about the reader's own legal, medical or money decision: refused, never disclaimed. */
export function regulatedAdviceScan(text: string): string[] {
  const out: string[] = [];
  for (const { topic, re } of REGULATED) for (const m of text.matchAll(re)) out.push(`${topic} advice: "${quoteAround(text, m.index ?? 0, m[0].length)}"`);
  return [...new Set(out)];
}

// ─── The model check, failing closed ─────────────────────────────────────────

const HONESTY_SYSTEM = [
  'You check a printable file before a small workshop sells it to strangers. You are not its author.',
  'Find every sentence that states something about the world nobody could stand behind: an invented',
  'statistic or figure, a testimonial or quoted buyer, a review or rating, a credential or endorsement,',
  'a named source that is not checkable, a claim about results. Blank fields, instructions and',
  'checklists are not claims. Also say whether it tells the reader what to do about their OWN legal,',
  'medical or money decision (regulated advice), which is different from general information.',
  'Reply with one JSON object and nothing else:',
  '{"invented": [{"kind": "statistic|testimonial|review|credential|source|result", "quote": <exact words>}],',
  ' "regulated_advice": true|false, "regulated_why": <one sentence or null>}',
  dataBlockInstruction('file'),
].join('\n');

/**
 * THE SECOND READING, BY A MODEL, THAT FAILS CLOSED. An answer that could not
 * be had or could not be read is a refusal with that reason; the model door
 * being down is the forge's own error, re-thrown so the pass stops rather
 * than counting a refusal against the design.
 */
export async function modelHonestyCheck(text: string, ctx: { founderId: string; experimentId: string }): Promise<{ clean: boolean; findings: string[] }> {
  const { callSonnet, ModelDoorError } = await import('../../ai/client.js');
  const { institutionSpend } = await import('../../ai/what-it-is-for.js');
  let content: string;
  try {
    content = (await callSonnet(HONESTY_SYSTEM, wrapDataBlock('file', text, 40_000), 900,
      institutionSpend('checking a printable the hands made for invented facts before it is sold', 'scoring an audit', { kind: 'experiment', id: ctx.experimentId }))).content;
  } catch (err) {
    if (ModelDoorError && err instanceof ModelDoorError) throw err;
    return { clean: false, findings: [`the check for invented facts could not be asked (${err instanceof Error ? err.message : String(err)}), so nothing is shipped`] };
  }
  const from = content.indexOf('{'); const to = content.lastIndexOf('}');
  let raw: Row | null = null;
  try { raw = from >= 0 && to > from ? JSON.parse(content.slice(from, to + 1)) as Row : null; } catch { raw = null; }
  if (!raw || !Array.isArray(raw.invented) || typeof raw.regulated_advice !== 'boolean') {
    return { clean: false, findings: ['the check for invented facts answered with nothing that could be read, so nothing is shipped'] };
  }
  const findings = (raw.invented as unknown[]).map((x) => {
    const r = (x && typeof x === 'object' ? x : {}) as Row;
    return `${String(r.kind ?? 'a claim')}: "${String(r.quote ?? '').slice(0, 200)}"`;
  });
  if (raw.regulated_advice) findings.push(`regulated advice: ${String(raw.regulated_why ?? 'it tells the reader what to do about their own legal, medical or money decision')}`);
  return { clean: findings.length === 0, findings };
}

// ─── Would a stranger pay? ───────────────────────────────────────────────────

export interface PanelAnswer { persona: string; verdict: 'yes' | 'maybe' | 'no'; maxPriceDollars: number; why: string }

/**
 * THE PANEL'S THRESHOLDS. yes counts 1, maybe ½, no 0. A mean at or above
 * `shipAt` with a median top price at or above the asking price ships; a mean
 * below `refuseBelow`, or a median top price under half the asking price, is
 * refused; everything between is held for the owner. These are the numbers
 * he decided against on 8 October 2026 ("ship on panel yes now", PENDING 41):
 * a clear yes here goes on sale without him once his own row says yes.
 */
export const PANEL = { minimum: 3, shipAt: 0.6, refuseBelow: 0.3 } as const;

export const PERSONAS: readonly string[] = Object.freeze([
  'one of the people it is for, who buys a printable file online a few times a year and prints it at home',
  'one of the people it is for, who once paid for a thin PDF that was mostly filler and has been careful since',
  'one of the people it is for, who prints things, fills them in by hand and keeps paper files',
  'a skeptic among the people it is for, who assumes a cheap PDF is padding unless its pages prove otherwise',
]);

const median = (xs: number[]): number => {
  const s = [...xs].sort((a, b) => a - b);
  return s.length === 0 ? 0 : s.length % 2 ? s[(s.length - 1) / 2]! : (s[s.length / 2 - 1]! + s[s.length / 2]!) / 2;
};

export function panelVerdict(answers: PanelAnswer[], priceDollars: number): { outcome: 'ship' | 'hold' | 'refuse'; because: string; score: number; medianMax: number } {
  const score = answers.length ? answers.reduce((n, a) => n + (a.verdict === 'yes' ? 1 : a.verdict === 'maybe' ? 0.5 : 0), 0) / answers.length : 0;
  const medianMax = median(answers.map((a) => a.maxPriceDollars));
  const tally = `${String(answers.filter((a) => a.verdict === 'yes').length)} yes, ${String(answers.filter((a) => a.verdict === 'maybe').length)} maybe, ${String(answers.filter((a) => a.verdict === 'no').length)} no; the middle of what they would pay is $${String(medianMax)} against $${String(priceDollars)} asked`;
  if (answers.length < PANEL.minimum) return { outcome: 'refuse', because: `only ${String(answers.length)} of the strangers could be heard; a panel is at least ${String(PANEL.minimum)}`, score, medianMax };
  if (score >= PANEL.shipAt && medianMax >= priceDollars) return { outcome: 'ship', because: tally, score, medianMax };
  if (score < PANEL.refuseBelow || medianMax < priceDollars / 2) return { outcome: 'refuse', because: `strangers would not pay for it: ${tally}`, score, medianMax };
  return { outcome: 'hold', because: `the strangers were split: ${tally}`, score, medianMax };
}

/** Each persona asked on its own, with nothing from the others. An unreadable answer is not counted as a yes. */
export async function askThePanel(input: { experimentId: string; listing: string; text: string; priceDollars: number }): Promise<PanelAnswer[]> {
  const { callSonnet, ModelDoorError } = await import('../../ai/client.js');
  const { institutionSpend } = await import('../../ai/what-it-is-for.js');
  const out: PanelAnswer[] = [];
  for (const persona of PERSONAS) {
    const system = [
      `You are ${persona}. You are shown a listing and the full text of the file it sells, for $${String(input.priceDollars)}, one-time.`,
      'Decide as that buyer, with your own money, not as a reviewer; politeness helps nobody.',
      dataBlockInstruction('listing'), dataBlockInstruction('file'),
      'Reply with one JSON object and nothing else:',
      '{"verdict": "yes"|"maybe"|"no", "max_price_dollars": <the most you would pay, a number>, "why": <one sentence>}',
    ].join('\n');
    let content = '';
    try {
      content = (await callSonnet(system, `${wrapDataBlock('listing', input.listing, 4000)}\n${wrapDataBlock('file', input.text, 24_000)}`, 400,
        institutionSpend('asking whether a stranger would pay for a printable before it is sold', 'scoring an audit', { kind: 'experiment', id: input.experimentId }))).content;
    } catch (err) {
      if (ModelDoorError && err instanceof ModelDoorError) throw err;
      continue;
    }
    const from = content.indexOf('{'); const to = content.lastIndexOf('}');
    try {
      const r = JSON.parse(content.slice(from, to + 1)) as Row;
      const verdict = r.verdict === 'yes' || r.verdict === 'maybe' || r.verdict === 'no' ? r.verdict : null;
      const max = Number(r.max_price_dollars);
      if (verdict && Number.isFinite(max) && max >= 0) out.push({ persona, verdict, maxPriceDollars: max, why: String(r.why ?? '').slice(0, 300) });
    } catch { /* an answer that cannot be read is not counted */ }
  }
  return out;
}

// ─── Composing and printing ──────────────────────────────────────────────────

const esc = (s: string): string => s.replace(/[&<>"]/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[ch] ?? ch));
const two = (n: number): string => String(n).padStart(2, '0');
const dayWords = (iso: string): string => new Date(`${iso.slice(0, 10)}T12:00:00Z`).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric', timeZone: 'UTC' });

export interface PrintMeta { workshop: string; version: number; madeOn: string }

/** The whole document: the template's cover, contents, footers and colophon around the model's pages. */
export function composePrintableHtml(spec: PrintableSpec, meta: PrintMeta & { css: string }): string {
  const total = spec.pages.length + 3;
  const foot = (n: number) => `<div class="foot"><span><b>${esc(spec.title)}</b> · Version ${String(meta.version)}</span><span>${esc(meta.workshop)} · page ${String(n)} of ${String(total)}</span></div>`;
  const topics = sensitiveTopicsOf(plainTextOf(spec));
  const parts: string[] = [];
  parts.push(`<section class="page cover" data-heading="cover"><div class="kicker">${esc(spec.kicker)}</div><h1>${esc(spec.title)}</h1><p class="sub">${esc(spec.subtitle)}</p>`
    + `<div class="edition">${esc(meta.workshop)} · Version ${String(meta.version)} · ${dayWords(meta.madeOn)}</div></section>`);
  parts.push(`<section class="page" data-heading="Contents"><div class="kicker">Contents</div><h2>What is inside</h2><div class="body contents">`
    + spec.pages.map((p, i) => `<div><span class="n">${two(i + 1)}</span><span class="t">${esc(p.heading)}</span><span class="small">p.${String(i + 3)}</span></div>`).join('')
    + `</div>${foot(2)}</section>`);
  spec.pages.forEach((p, i) => {
    parts.push(`<section class="page" data-heading="${esc(p.heading)}"><div class="kicker">${two(i + 1)}</div><h2>${esc(p.heading)}</h2><p class="lede">${esc(p.lede)}</p>`
      + `<div class="body">${p.html}</div>${foot(i + 3)}</section>`);
  });
  parts.push(`<section class="page colophon" data-heading="About this file"><div class="kicker">About this file</div><h2>About this file</h2><div class="body">`
    + `<p>${esc(spec.title)}, version ${String(meta.version)}, made on ${dayWords(meta.madeOn)} by ${esc(meta.workshop)}, a small digital workshop.</p>`
    + '<p>Its words were written with an AI model inside a fixed layout, and the file was checked before it was sold: for invented figures, testimonials, reviews and credentials, for advice that is not ours to give, and for whether every page fits.</p>'
    + topics.map((t) => `<div class="box green"><strong>${t === 'legal' ? 'Not legal advice.' : t === 'medical' ? 'Not medical advice.' : 'Not financial advice.'}</strong> ${esc(DISCLAIMERS[t])}</div>`).join('')
    + '<p>If it is no use to you, you can have your money back: the link is in the email that brought you this file.</p>'
    + `</div>${foot(total)}</section>`);
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>${esc(spec.title)} · Version ${String(meta.version)}</title><style>${meta.css}</style></head><body>${parts.join('\n')}</body></html>`;
}

const here = dirname(fileURLToPath(import.meta.url));
/** The owned stylesheet with its fonts embedded, so printing needs no network. */
export function printableCss(): string {
  const dir = [resolve(here, '../../../public'), resolve(here, '../../../../src/public')].find((d) => existsSync(resolve(d, 'printable.css')));
  if (!dir) throw new Error('the printable stylesheet is missing from this build');
  return readFileSync(resolve(dir, 'printable.css'), 'utf8').replace(/url\(([a-z0-9-]+\.woff2)\)/g, (_all, file: string) =>
    `url(data:font/woff2;base64,${readFileSync(resolve(dir, file)).toString('base64')})`);
}

export interface RenderResult { pdf: Buffer; sections: number; overflow: string[]; fields?: FieldBox[] }

// ─── Blanks a reader can fill (FQ, 9 October 2026) ───────────────────────────
//
// Every buyer persona asked whether the file could be filled in on screen. The
// design system already draws every blank — a labelled underline (div.field),
// writing lines (div.lines), the empty cells of a worksheet table (table.ws),
// the square before a checklist item (ul.check) — so the printer measures each
// one where Chromium laid it out (FIELD_PROBE) and `addFormFields` puts a real
// AcroForm field on it: transparent and borderless, so the printed page looks
// exactly as it did, and named for what it asks, so a screen reader can say it.

/** One blank, measured in CSS pixels from the top-left of its printed page. */
export interface FieldBox { page: number; kind: 'text' | 'check'; label: string; x: number; y: number; w: number; h: number; pageW: number; pageH: number }

const FIELD_PROBE = `(() => {
  const out = [];
  const clean = (s) => (s || '').replace(/\\s+/g, ' ').trim();
  Array.from(document.querySelectorAll('section.page')).forEach((page, pi) => {
    const o = page.getBoundingClientRect();
    const heading = clean(page.getAttribute('data-heading')) || ('page ' + (pi + 1));
    const push = (kind, label, r) => {
      if (r.width < 4 || r.height < 4) return;
      out.push({ page: pi, kind, label: clean(label).slice(0, 120), x: r.left - o.left, y: r.top - o.top, w: r.width, h: r.height, pageW: o.width, pageH: o.height });
    };
    page.querySelectorAll('div.field').forEach((f) => {
      const line = f.querySelector('i');
      const label = f.querySelector('span');
      if (line) push('text', label ? label.textContent : heading, line.getBoundingClientRect());
    });
    page.querySelectorAll('div.lines').forEach((d) => {
      Array.from(d.querySelectorAll('i')).forEach((line, k) => push('text', heading + ', line ' + (k + 1), line.getBoundingClientRect()));
    });
    page.querySelectorAll('table.ws').forEach((t) => {
      const heads = Array.from(t.querySelectorAll('thead th')).map((th) => clean(th.textContent));
      Array.from(t.querySelectorAll('tbody tr')).forEach((tr, ri) => {
        const lbl = tr.querySelector('td.lbl');
        Array.from(tr.children).forEach((td, ci) => {
          if (td.tagName !== 'TD' || td.classList.contains('lbl') || clean(td.textContent) !== '') return;
          const col = heads[ci] || ('column ' + (ci + 1));
          push('text', (lbl ? clean(lbl.textContent) + ', ' : '') + col + (lbl ? '' : ', row ' + (ri + 1)), td.getBoundingClientRect());
        });
      });
    });
    page.querySelectorAll('ul.check li').forEach((li) => {
      const r = li.getBoundingClientRect();
      const b = getComputedStyle(li, '::before');
      const w = parseFloat(b.width); const h = parseFloat(b.height);
      push('check', li.textContent, { left: r.left + (parseFloat(b.left) || 0), top: r.top + (parseFloat(b.top) || 0), width: w, height: h });
    });
  });
  return out;
})()`;

/**
 * PUT A FIELD ON EVERY BLANK. Pixels become points by the page's own width
 * (8.5 in is 816 CSS px and 612 pt), and the top-left origin becomes the PDF's
 * bottom-left. Each field is transparent and borderless, carries its label as
 * its accessible name (TU), and has a name unique in the file. No boxes: the
 * file comes back untouched.
 */
export async function addFormFields(pdf: Buffer, boxes: FieldBox[]): Promise<Buffer> {
  if (boxes.length === 0) return pdf;
  const { PDFDocument, PDFName, PDFHexString } = await import('pdf-lib');
  const doc = await PDFDocument.load(pdf);
  const form = doc.getForm();
  const pages = doc.getPages();
  const counts = new Map<string, number>();
  for (const b of boxes) {
    const page = pages[b.page];
    if (!page) throw new Error(`a blank was measured on page ${String(b.page + 1)}, and the file has ${String(pages.length)}`);
    const k = page.getWidth() / b.pageW;
    const rect = { x: b.x * k, y: page.getHeight() - (b.y + b.h) * k, width: b.w * k, height: b.h * k,
      backgroundColor: undefined, borderColor: undefined, borderWidth: 0 };
    const key = `p${String(b.page + 1)}_${b.kind}`;
    const n = (counts.get(key) ?? 0) + 1;
    counts.set(key, n);
    const name = `${key}_${String(n)}`;
    // The accessible name on the field AND its widget: readers differ in which they read.
    const named = (acro: { dict: { set: (k: unknown, v: unknown) => void }; getWidgets: () => Array<{ dict: { set: (k: unknown, v: unknown) => void } }> }): void => {
      acro.dict.set(PDFName.of('TU'), PDFHexString.fromText(b.label));
      for (const w of acro.getWidgets()) w.dict.set(PDFName.of('TU'), PDFHexString.fromText(b.label));
    };
    if (b.kind === 'text') {
      const f = form.createTextField(name);
      f.addToPage(page, rect);
      named(f.acroField);
    } else {
      const f = form.createCheckBox(name);
      f.addToPage(page, rect);
      named(f.acroField);
    }
  }
  // No object streams: every page object stays readable as itself, so the
  // page count (`pdfPageCount`) and any reader that scans the file still work.
  return Buffer.from(await doc.save({ useObjectStreams: false }));
}
/**
 * Print one document. ONE FUNCTION, so a test can stand in for Chromium. The
 * signal fires when the print has run past its time: a renderer that holds a
 * process must kill it then.
 */
export type Renderer = (html: string, signal?: AbortSignal) => Promise<RenderResult>;
let substitute: Renderer | null = null;
/** For tests: print with this instead of Chromium (null restores Chromium). */
export function useRenderer(r: Renderer | null): void { substitute = r; }

// ─── Printing fits the machine (F1, 9 October 2026) ──────────────────────────
//
// Production is ONE Fly machine with 1 GB, the web server and the scheduler in
// one process (fly.private.toml). Chromium is the largest thing that process
// ever starts, so a print is held to three rules:
//   * ONE AT A TIME. A second browser beside the first is how 1 GB is
//     exceeded; a print asked for while another runs waits its turn.
//   * A PRINT THAT RUNS OVER IS KILLED, the browser process with it, and the
//     queue moves on (`PRINT_TIMEOUT_MS`, FOUNDRY_PRINT_TIMEOUT_MS to change it).
//   * IT IS LAUNCHED SMALL AND CLOSED AFTER EVERY PRINT (`CHROMIUM_LAUNCH_ARGS`).
// The peak measured under a 1 GB cap with the server resident is recorded in
// IMPLEMENTATION_STATE; `scripts/measure-print-memory.mjs` measures it again.

/** How long one print may take before its browser is killed. */
export const PRINT_TIMEOUT_MS = (() => {
  const v = Number(process.env.FOUNDRY_PRINT_TIMEOUT_MS);
  return Number.isFinite(v) && v > 0 ? v : 90_000;
})();
let timeoutOverride: number | null = null;
/** For tests: a shorter timeout (null restores PRINT_TIMEOUT_MS). */
export function setPrintTimeoutMs(ms: number | null): void { timeoutOverride = ms; }
/** How long a stopped print may take to be gone before the queue moves on regardless. */
export const STOP_GRACE_MS = 10_000;
let graceOverride: number | null = null;
/** For tests: a shorter grace (null restores STOP_GRACE_MS). */
export function setStopGraceMs(ms: number | null): void { graceOverride = ms; }

/**
 * THE LAUNCH LINE. Each flag is here for memory, not speed: no GPU process,
 * no /dev/shm (Fly's is small; Chromium falls back to /tmp), one renderer, no
 * site-per-process isolation (the document is ours and the network is refused),
 * no extensions, no background networking, a capped V8 heap for the page.
 */
export const CHROMIUM_LAUNCH_ARGS: readonly string[] = Object.freeze([
  '--no-sandbox',
  '--disable-dev-shm-usage',
  '--disable-gpu',
  '--renderer-process-limit=1',
  '--disable-site-isolation-trials',
  '--disable-features=site-per-process,Translate,MediaRouter,OptimizationHints',
  '--disable-extensions',
  '--disable-background-networking',
  '--disable-component-update',
  '--disable-default-apps',
  '--disable-sync',
  '--no-first-run',
  '--mute-audio',
  '--js-flags=--max-old-space-size=128',
]);

let queue: Promise<unknown> = Promise.resolve();

/**
 * PRINT ONE DOCUMENT, IN TURN. Waits for any print before it, then gives the
 * renderer the time it has; past it, the renderer's signal fires (Chromium is
 * killed) and the print is refused with the reason.
 */
export function printOne(html: string, renderer: Renderer): Promise<RenderResult> {
  const limit = timeoutOverride ?? PRINT_TIMEOUT_MS;
  // ONE PROCESS AT A TIME, NOT ONE PROMISE (F2 audit of F1). The caller hears
  // of an overrun the moment the timer fires, but the QUEUE is released only
  // when the stopped renderer has actually returned — its browser killed and
  // reaped — or, if it never returns, after STOP_GRACE_MS. Releasing on the
  // timer let the next print launch a browser beside a dying one.
  let gone: Promise<unknown> = Promise.resolve();
  const run = async (): Promise<RenderResult> => {
    const controller = new AbortController();
    let timer: NodeJS.Timeout | undefined;
    const printing = renderer(html, controller.signal);
    const settled = printing.then(() => undefined, () => undefined);
    gone = settled;
    const overrun = new Promise<never>((_, reject) => {
      timer = setTimeout(() => {
        controller.abort();
        const grace = graceOverride ?? STOP_GRACE_MS;
        gone = Promise.race([settled, new Promise<void>((r) => { setTimeout(r, grace).unref(); })]);
        reject(new Error(`the file did not finish printing within ${String(Math.round(limit / 1000))} s, so its browser was stopped`));
      }, limit);
    });
    try {
      return await Promise.race([printing, overrun]);
    } finally {
      clearTimeout(timer);
    }
  };
  const mine = queue.then(run, run);
  queue = mine.then(() => gone, () => gone).then(() => undefined, () => undefined);
  return mine;
}

/** Where Chromium is on this machine, or null. FOUNDRY_CHROMIUM_PATH first. */
export function chromiumPath(env: NodeJS.ProcessEnv = process.env): string | null {
  const candidates = [env.FOUNDRY_CHROMIUM_PATH, '/usr/bin/chromium', '/usr/bin/chromium-browser', '/usr/bin/google-chrome',
    '/opt/pw-browsers/chromium-1194/chrome-linux/chrome'].filter((p): p is string => !!p && p.trim() !== '');
  return candidates.find((p) => existsSync(p)) ?? null;
}

/**
 * WHAT OVERFLOWS, measured in the page as printed: any element whose box
 * runs past its page's bottom or right margin. The footer is the template's
 * and sits in the margin on purpose.
 */
const LAYOUT_PROBE = `(() => {
  const out = [];
  const pages = Array.from(document.querySelectorAll('section.page'));
  pages.forEach((page, i) => {
    const box = page.getBoundingClientRect();
    const cs = getComputedStyle(page);
    const bottom = box.bottom - parseFloat(cs.paddingBottom) + 1;
    const right = box.right - parseFloat(cs.paddingRight) + 1;
    const name = page.getAttribute('data-heading') || ('page ' + (i + 1));
    let worst = 0; let wide = 0;
    for (const el of Array.from(page.querySelectorAll('*'))) {
      if (el.closest('.foot') || el.closest('.edition')) continue;
      const r = el.getBoundingClientRect();
      if (r.width === 0 && r.height === 0) continue;
      if (r.bottom > bottom) worst = Math.max(worst, r.bottom - bottom);
      if (r.right > right) wide = Math.max(wide, r.right - right);
    }
    if (worst > 0) out.push('page ' + (i + 1) + ' ("' + name + '"): its content runs ' + Math.ceil(worst) + 'px past the bottom margin');
    if (wide > 0) out.push('page ' + (i + 1) + ' ("' + name + '"): its content runs ' + Math.ceil(wide) + 'px past the right margin');
  });
  return { sections: pages.length, overflow: out };
})()`;

/**
 * Headless Chromium, with the network refused: the document carries everything
 * it needs. Started as a server so the process can be KILLED when a print runs
 * over (a closed connection to a hung browser leaves the browser running), and
 * closed after every print.
 */
export function chromiumRenderer(executablePath: string): Renderer {
  return async (html: string, signal?: AbortSignal) => {
    const { chromium } = await import('playwright-core');
    const server = await chromium.launchServer({ executablePath, args: [...CHROMIUM_LAUNCH_ARGS] });
    const kill = (): void => { void server.kill().catch(() => undefined); };
    if (signal?.aborted) { kill(); throw new Error('the print was stopped before it started'); }
    signal?.addEventListener('abort', kill, { once: true });
    try {
      const browser = await chromium.connect(server.wsEndpoint());
      try {
        const page = await browser.newPage();
        await page.route('**/*', (route) => (route.request().url().startsWith('data:') ? route.continue() : route.abort()));
        await page.emulateMedia({ media: 'print' });
        await page.setContent(html, { waitUntil: 'load' });
        await page.evaluate('document.fonts.ready.then(() => true)');
        const layout = await page.evaluate(LAYOUT_PROBE) as { sections: number; overflow: string[] };
        // Measured under print media, where the page is laid out as it prints.
        const fields = await page.evaluate(FIELD_PROBE) as FieldBox[];
        // TAGGED, WITH AN OUTLINE (FQ): a structure tree built from the HTML
        // (headings, paragraphs, lists, tables) and bookmarks from the
        // headings, so a screen reader reads the file as a document.
        const pdf = await page.pdf({ printBackground: true, preferCSSPageSize: true, tagged: true, outline: true });
        return { pdf: Buffer.from(pdf), sections: layout.sections, overflow: layout.overflow, fields };
      } finally {
        await browser.close().catch(() => undefined);
      }
    } finally {
      signal?.removeEventListener('abort', kill);
      await server.close().catch(() => undefined);
      // close() asks politely; a browser that did not go is killed.
      await server.kill().catch(() => undefined);
    }
  };
}

/** How many pages a PDF has, read from its own page objects. */
export function pdfPageCount(pdf: Buffer): number {
  return (pdf.toString('latin1').match(/\/Type\s*\/Page(?![a-zA-Z])/g) ?? []).length;
}

export async function renderPrintable(spec: PrintableSpec, meta: PrintMeta, renderer?: Renderer): Promise<RenderResult & { html: string }> {
  const html = composePrintableHtml(spec, { ...meta, css: printableCss() });
  const path = chromiumPath();
  const r = renderer ?? substitute ?? (path ? chromiumRenderer(path) : null);
  if (!r) throw new Error('there is no Chromium on this machine to print a page with');
  const printed = await printOne(html, r);
  // The blanks become fields after the browser is gone: no Chromium is held for it.
  const pdf = printed.fields?.length ? await addFormFields(printed.pdf, printed.fields) : printed.pdf;
  return { ...printed, pdf, html };
}

// ─── The stored file ─────────────────────────────────────────────────────────

export interface PrintableManifest {
  kind: 'printable_pdf'; version: number; title: string; filename: string; pages: number; bytes: number;
  sha256: string; madeAt: string; topics: SensitiveTopic[]; pdfBase64: string;
}

/** The manifest a deliverable material holds, or null when it is not a printable. */
export function printableOf(m: Pick<Material, 'body'> | null): PrintableManifest | null {
  if (!m || !m.body.startsWith('{"kind":"printable_pdf"')) return null;
  try {
    const p = JSON.parse(m.body) as PrintableManifest;
    return p.kind === 'printable_pdf' ? p : null;
  } catch { return null; }
}

/** What the offer shape records about the file it sells. */
export interface PrintablePlan { version: number; sha256: string; pages: number; filename: string; topics: SensitiveTopic[];
  panel: { outcome: 'ship' | 'hold'; because: string; answers: PanelAnswer[] };
  /** Set while the panel was split and the owner has not said; cleared only by him. */
  held: string | null; releasedBy?: string; releasedAt?: string }

export function printablePlanOf(shapeBody: string | null | undefined): PrintablePlan | null {
  if (!shapeBody) return null;
  try {
    const p = JSON.parse(shapeBody) as { kind?: unknown; printable?: PrintablePlan };
    return p.kind === 'printable_pdf' && p.printable ? p.printable : null;
  } catch { return null; }
}

/**
 * THE GATE A STORED PRINTABLE MUST PASS TO GO OUT, at launch, on the page's
 * readiness and at every delivery: the bytes are the bytes that were checked
 * (their hash, against the manifest and the offer), a PDF with the pages it
 * says, in bounds, with a version — and not held for the owner.
 */
export function checkPrintable(m: Material, plan: PrintablePlan | null): { ok: boolean; failures: string[] } {
  const failures: string[] = [];
  const p = printableOf(m);
  if (!p) return { ok: false, failures: ['the deliverable is not a printable file'] };
  const bytes = Buffer.from(p.pdfBase64 ?? '', 'base64');
  const sha = createHash('sha256').update(bytes).digest('hex');
  if (sha !== p.sha256) failures.push('the stored file is not the file that was checked: its hash differs');
  if (bytes.subarray(0, 5).toString('latin1') !== '%PDF-') failures.push('the stored file is not a PDF');
  const pages = pdfPageCount(bytes);
  if (pages !== p.pages) failures.push(`the file has ${String(pages)} pages, not the ${String(p.pages)} it was checked with`);
  if (pages < PRINTABLE_PAGES.min || pages > PRINTABLE_PAGES.max) failures.push(`${String(pages)} pages is outside ${String(PRINTABLE_PAGES.min)}–${String(PRINTABLE_PAGES.max)}`);
  if (!Number.isInteger(p.version) || p.version < 1) failures.push('the file carries no version');
  if (!plan) failures.push('the offer does not say which file it sells');
  else {
    if (plan.sha256 !== p.sha256 || plan.version !== p.version) failures.push(`the offer sells version ${String(plan.version)}, and the file attached is version ${String(p.version)}`);
    if (plan.held) failures.push(`held for you: ${plan.held}`);
  }
  return { ok: failures.length === 0, failures };
}

const slug = (s: string): string => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60) || 'file';

// ─── Making it ───────────────────────────────────────────────────────────────

export interface PrintableMade {
  deliverableId: string; offerTemplateId: string; offerShapeId: string; items: number;
  quality: { ok: boolean; failures: string[] }; version: number; held: string | null;
}

/**
 * MAKE THE FILE, OR SAY WHY NOT. Cheap readings first (shape, vocabulary,
 * invented facts, regulated advice), then printing, then the two model
 * readings. A refusal records nothing but the refusal; a split panel records
 * the file and holds it for the owner.
 */
export async function makePrintable(input: {
  founderId: string; experimentId: string; spec: PrintableSpec; plan: OfferShapePlan; now?: Date;
  /** The listing a stranger would read beside the file: what the panel is shown. */
  listing: string;
}): Promise<PrintableMade | { refused: string }> {
  const now = input.now ?? new Date();
  const { publicWorkshopOf, workshopRegion } = await import('../../public-workshop/settings.js');
  const w = await publicWorkshopOf(input.founderId);
  if (!w) return { refused: 'there is no Workshop to speak as' };
  const may = await mayMakePrintables(input.founderId);
  if (!may.may) return { refused: `the hands may not make a printable: ${may.because}` };

  const shape = specProblems(input.spec);
  if (shape.length) return { refused: `the file uses what its design system does not allow: ${shape.slice(0, 6).join('; ')}` };
  const text = plainTextOf(input.spec);
  const invented = fabricationScan(text);
  if (invented.length) return { refused: `the file says what nobody can stand behind: ${invented.slice(0, 6).join('; ')}` };
  const advice = regulatedAdviceScan(text);
  if (advice.length) return { refused: `the file tells a reader what to do about their own legal, medical or money decision, which is regulated advice and not the Workshop's to give: ${advice.slice(0, 4).join('; ')}` };
  if (w.operatorName && text.includes(w.operatorName)) return { refused: 'a person is named; the Workshop is the voice' };

  const prior = Number(((await query(`SELECT COUNT(*) AS n FROM experiment_materials WHERE experiment_id = ? AND kind = 'deliverable' AND body LIKE '{"kind":"printable_pdf"%'`,
    [input.experimentId])).rows[0] as Row).n ?? 0);
  const version = prior + 1;
  let printed: RenderResult & { html: string };
  try {
    printed = await renderPrintable(input.spec, { workshop: w.publicName, version, madeOn: now.toISOString().slice(0, 10) });
  } catch (err) {
    return { refused: `the file could not be printed: ${err instanceof Error ? err.message : String(err)}` };
  }
  const pages = pdfPageCount(printed.pdf);
  const fit: string[] = [];
  if (printed.pdf.subarray(0, 5).toString('latin1') !== '%PDF-') fit.push('the printer did not return a PDF');
  if (pages !== printed.sections) fit.push(`it was composed as ${String(printed.sections)} pages and printed as ${String(pages)}, so a page broke in two`);
  if (pages < PRINTABLE_PAGES.min || pages > PRINTABLE_PAGES.max) fit.push(`${String(pages)} pages is outside ${String(PRINTABLE_PAGES.min)}–${String(PRINTABLE_PAGES.max)}`);
  fit.push(...printed.overflow);
  if (fit.length) return { refused: `the printed file does not fit its pages: ${fit.slice(0, 6).join('; ')}` };
  // THE LISTING SAYS THE PAGES THE FILE HAS. A count the listing states is
  // read against the file as printed: "a 30-page bundle" over seven pages was
  // let through by every gate, because each checked one side.
  const stated = [...input.listing.matchAll(/\b(\d{1,3})[\s-]+(?:fill-in\s+|printable\s+)?pages?\b/gi)].map((m) => Number(m[1])).find((n) => n !== pages);
  if (stated !== undefined) return { refused: `the listing says ${String(stated)} pages and the file has ${String(pages)}` };

  const honest = await modelHonestyCheck(text, { founderId: input.founderId, experimentId: input.experimentId });
  if (!honest.clean) return { refused: `the second reading found what nobody can stand behind: ${honest.findings.slice(0, 6).join('; ')}` };

  const priceDollars = input.plan.price.amountCents / 100;
  const answers = await askThePanel({ experimentId: input.experimentId, listing: input.listing, text, priceDollars });
  const panel = panelVerdict(answers, priceDollars);
  if (panel.outcome === 'refuse') return { refused: `the panel of strangers would not buy it: ${panel.because}` };

  const sha256 = createHash('sha256').update(printed.pdf).digest('hex');
  const filename = `${slug(input.spec.title)}-v${String(version)}.pdf`;
  const topics = sensitiveTopicsOf(text);
  const manifest: PrintableManifest = { kind: 'printable_pdf', version, title: input.spec.title, filename, pages, bytes: printed.pdf.length,
    sha256, madeAt: now.toISOString(), topics, pdfBase64: printed.pdf.toString('base64') };
  const held = panel.outcome === 'hold' ? panel.because : null;
  const printable: PrintablePlan = { version, sha256, pages, filename, topics, panel: { outcome: panel.outcome, because: panel.because, answers }, held };
  const plan: OfferShapePlan = { ...input.plan, price: { ...input.plan.price, productName: `${input.plan.price.productName} (version ${String(version)})` } };
  const offerShapeId = await recordMaterial({ founderId: input.founderId, experimentId: input.experimentId, kind: 'offer_shape', title: 'offer shape',
    body: JSON.stringify({ ...plan, kind: 'printable_pdf', spec: { ...input.spec, pages: input.spec.pages.length }, printable }), by: HAND });
  const deliverableId = await recordMaterial({ founderId: input.founderId, experimentId: input.experimentId, kind: 'deliverable',
    title: input.spec.title, body: JSON.stringify(manifest), by: HAND });
  const { renderOfferTemplate } = await import('./registry.js');
  const offerTemplateId = await recordMaterial({ founderId: input.founderId, experimentId: input.experimentId, kind: 'offer_template',
    title: `Offer: ${input.spec.title}`, body: renderOfferTemplate(plan, w.publicName, workshopRegion(w)), by: HAND });
  return { deliverableId, offerTemplateId, offerShapeId, items: pages, quality: { ok: true, failures: [] }, version, held };
}

/**
 * HE SAID SHIP IT. A file the panel was split on is released only by the
 * owner, signed in: the offer shape is recorded again without the hold, and
 * his name and the time are on it. Nothing else changes; the file is the one
 * that was checked.
 */
export async function releaseHeldPrintable(input: { founderId: string; experimentId: string; by: string }): Promise<{ released: boolean; because: string }> {
  if (input.by !== `founder:${input.founderId}`) return { released: false, because: 'only the owner may release a file the panel was split on' };
  const { materialOf } = await import('../hand.js');
  const shape = await materialOf(input.experimentId, 'offer_shape');
  const plan = printablePlanOf(shape?.body);
  if (!shape || !plan) return { released: false, because: 'this test does not sell a printable' };
  if (!plan.held) return { released: false, because: 'it is not held' };
  const body = JSON.parse(shape.body) as Record<string, unknown>;
  await recordMaterial({ founderId: input.founderId, experimentId: input.experimentId, kind: 'offer_shape', title: 'offer shape',
    body: JSON.stringify({ ...body, printable: { ...plan, held: null, releasedBy: input.by, releasedAt: new Date().toISOString() } }), by: input.by });
  return { released: true, because: `released by you; the panel had said: ${plan.held}` };
}

/** Printables the panel was split on, waiting for him: one entry per test. */
export async function printablesHeld(founderId: string): Promise<Array<{ experimentId: string; title: string; because: string }>> {
  const rows = (await query(
    `SELECT m.experiment_id, m.body FROM experiment_materials m JOIN venture_experiments e ON e.id = m.experiment_id
      WHERE m.founder_id = ? AND m.kind = 'offer_shape' AND m.superseded_at IS NULL AND m.body LIKE '%"kind":"printable_pdf"%'
        AND e.decision IS NULL AND e.retired_at IS NULL AND e.superseded_by IS NULL
      ORDER BY m.recorded_at, m.rowid`, [founderId])).rows as unknown as Row[];
  const out: Array<{ experimentId: string; title: string; because: string }> = [];
  for (const r of rows) {
    const plan = printablePlanOf(String(r.body));
    if (!plan?.held) continue;
    let title = plan.filename;
    try { title = String((JSON.parse(String(r.body)) as { spec?: { title?: string } }).spec?.title ?? title); } catch { /* the filename stands */ }
    out.push({ experimentId: String(r.experiment_id), title, because: plan.held });
  }
  return out;
}

// ─── The buyer's download ────────────────────────────────────────────────────

/** How long a download link works. The delivery email says so. */
export const DOWNLOAD_LINK_DAYS = 30;

function downloadKey(): Buffer {
  const key = process.env.ENCRYPTION_KEY ?? '';
  if (key.length < 32) throw new Error('ENCRYPTION_KEY is required to sign download links');
  return Buffer.from(key, 'utf8');
}
export function downloadTokenFor(fulfilmentId: string, expiresAt: number): string {
  return createHmac('sha256', downloadKey()).update(`experiment_download:${fulfilmentId}:${String(expiresAt)}`).digest('hex');
}
export function downloadLinkFor(fulfilmentId: string, now: Date = new Date()): string {
  const base = (process.env.APP_URL ?? 'http://localhost:8080').replace(/\/$/, '');
  const expiresAt = Math.floor(now.getTime() / 1000) + DOWNLOAD_LINK_DAYS * 86_400;
  return `${base}/share/download/${fulfilmentId}/${String(expiresAt)}/${downloadTokenFor(fulfilmentId, expiresAt)}`;
}
/** 'ok', 'expired' (signed by us, and past its time), or 'invalid'. The expiry is inside the signature. */
export function checkDownloadToken(fulfilmentId: string, expires: string, token: string, now: Date = new Date()): 'ok' | 'expired' | 'invalid' {
  if (!/^[A-Za-z0-9_-]{6,64}$/.test(fulfilmentId) || !/^\d{9,11}$/.test(expires) || !/^[0-9a-f]{64}$/.test(token)) return 'invalid';
  const expected = Buffer.from(downloadTokenFor(fulfilmentId, Number(expires)), 'utf8');
  const given = Buffer.from(token, 'utf8');
  if (expected.length !== given.length || !timingSafeEqual(expected, given)) return 'invalid';
  return Number(expires) * 1000 < now.getTime() ? 'expired' : 'ok';
}

/**
 * THE FILE THIS BUYER PAID FOR, by their signed link: the version recorded on
 * their fulfilment when it was delivered, never a later one silently. A
 * refunded purchase is not served.
 */
export async function downloadFor(fulfilmentId: string, expires: string, token: string, now: Date = new Date()): Promise<
  { status: 'ok'; pdf: Buffer; filename: string; sha256: string } | { status: 'expired'; title: string; refundLink: string } | { status: 'not_found' }> {
  const verdict = checkDownloadToken(fulfilmentId, expires, token, now);
  if (verdict === 'invalid') return { status: 'not_found' };
  const f = (await query('SELECT experiment_id, status, refund_ref, delivered_files_json FROM experiment_fulfilments WHERE id = ?', [fulfilmentId])).rows[0] as Row | undefined;
  if (!f || String(f.status) === 'refunded' || f.refund_ref != null) return { status: 'not_found' };
  let sold: { sha256?: string } | null = null;
  try { sold = f.delivered_files_json == null ? null : ((JSON.parse(String(f.delivered_files_json)) as Array<{ sha256?: string }>)[0] ?? null); } catch { sold = null; }
  if (!sold?.sha256) return { status: 'not_found' };
  const all = (await query(`SELECT body, title FROM experiment_materials WHERE experiment_id = ? AND kind = 'deliverable' ORDER BY recorded_at DESC, rowid DESC`,
    [String(f.experiment_id)])).rows as unknown as Row[];
  const m = all.map((r) => ({ title: String(r.title), p: printableOf({ body: String(r.body) }) })).find((x) => x.p?.sha256 === sold!.sha256);
  if (!m?.p) return { status: 'not_found' };
  if (verdict === 'expired') {
    const { refundLinkFor } = await import('../hand.js');
    return { status: 'expired', title: m.title, refundLink: refundLinkFor(fulfilmentId) };
  }
  const pdf = Buffer.from(m.p.pdfBase64, 'base64');
  if (createHash('sha256').update(pdf).digest('hex') !== m.p.sha256) return { status: 'not_found' };
  return { status: 'ok', pdf, filename: m.p.filename, sha256: m.p.sha256 };
}
