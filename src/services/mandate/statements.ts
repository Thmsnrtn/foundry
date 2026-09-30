// =============================================================================
// FOUNDRY — the Mandate: what the owner wants, as statements Foundry can read.
//
// INSTITUTION_MODEL §3.2, §4, §7 (30 September 2026). "No SaaS for now",
// "Prioritize cash flow", "Spend less this month", "Keep trading theoretical":
// the portfolio-level steering no other row could hold. Three parts, each
// small enough to check by reading it:
//
//   readMandate   a phrase table, never a model, from one sentence to one
//                 typed statement with its scope and how long it lasts. Pure.
//   stateMandate  the one writer: the typed statement, whether it arrived by
//                 sentence or by a tap, supersedes the live one it replaces.
//   mandateOf     what is in force now: live, unexpired, newest first.
//
// And `diffOf`, which says what a change changed — worked out from the rows
// before and after, never written by a model — and what it left alone.
//
// IT GRANTS NOTHING. Nothing here is read by a gate that lets Foundry act, and
// every sentence that would move what Foundry may do ("never…", "up to $…",
// "don't contact…") belongs to the readers that bind authority, which run
// first; this reader refuses them outright.
// =============================================================================

import { nanoid } from 'nanoid';
import { query } from '../../db/client.js';

type Row = Record<string, unknown>;

export type MandateDimension =
  | 'interest' | 'avoid' | 'optimize' | 'experiment_style' | 'involvement' | 'risk' | 'allocation' | 'posture';

export interface MandateReading {
  dimension: MandateDimension;
  subject: string;
  /** The subject as the owner reads it: "SaaS", "cash flow". */
  label: string;
  value: Record<string, unknown>;
  scope: { kind: 'portfolio' | 'domain'; ref: string | null };
  statement: string;
  until: string | null;
  reviewAt: string | null;
  /** One plain sentence of what Foundry understood. */
  understoodAs: string;
}

export interface MandateStatement extends MandateReading {
  id: string;
  source: string;
  saidAt: string;
}

// ─── The reader ──────────────────────────────────────────────────────────────

/** Words that make a sentence an act or a hard rule, never steering. */
const NOT_STEERING = /\b(never|always|up to|at most|no more than|ask me|stop everything|panic|(?:contact|e-?mail|text|sms|call|messag|send|pay|buy|sell|refund|delet|publish|post|sign|approv|withdr[ae]w|transfer|order|plac)\w*)\b|\$\s?\d/i;

const KNOWN: Array<[RegExp, string, string]> = [
  [/^(?:saas|software as a service|subscription software|saas (?:products|businesses|apps))$/i, 'saas', 'SaaS'],
  [/^(?:digital (?:downloads|products)|downloadable products|printables)$/i, 'digital_downloads', 'digital downloads'],
  [/^(?:trading|trades|prediction markets|markets)$/i, 'trading', 'trading'],
  [/^(?:cash ?flow|cash)$/i, 'cash_flow', 'cash flow'],
  [/^(?:low[- ]maintenance(?: businesses| products| work| things)?|less maintenance)$/i, 'low_maintenance', 'low maintenance'],
  [/^(?:services?|service businesses|client work|consulting)$/i, 'services', 'services'],
  [/^(?:physical products?|inventory|shipping things)$/i, 'physical_products', 'physical products'],
  [/^(?:paid ads|ads|advertising)$/i, 'paid_ads', 'paid ads'],
];

const DROP = /^(?:the|a|an|any|more|some|my|our)\s+/i;

/** A subject key and its label, from the owner's noun phrase. Null if it is not a short noun phrase. */
export function subjectOf(phrase: string): { subject: string; label: string } | null {
  const p = phrase.trim().replace(/[.!]+$/, '').replace(DROP, '').replace(/\s+/g, ' ');
  if (!p || p.length > 40 || p.split(' ').length > 4) return null;
  if (/^(?:it|that|this|them|those|anything|everything|nothing|me|you|us)$/i.test(p)) return null;
  for (const [re, subject, label] of KNOWN) if (re.test(p)) return { subject, label };
  const subject = p.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 40);
  return subject ? { subject, label: p.toLowerCase() } : null;
}

const MONTHS = ['january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december'];
const iso = (d: Date): string => d.toISOString().slice(0, 10);
const addDays = (d: Date, n: number): Date => new Date(d.getTime() + n * 86_400_000);
const endOfMonth = (d: Date): Date => new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1));

/**
 * HOW LONG IT LASTS. "This month" lapses when the month does; "until
 * November" on the first of it; "for now" and "for a while" are brought back
 * in thirty days and never lapse by themselves. Nothing temporary becomes
 * permanent silently, and nothing said without a time is made temporary.
 */
export function durationOf(said: string, now: Date): { rest: string; until: string | null; reviewAt: string | null } {
  let rest = said.trim().replace(/[.!]+$/, '');
  const cut = (re: RegExp): RegExpExecArray | null => { const m = re.exec(rest); if (m) rest = (rest.slice(0, m.index) + rest.slice(m.index + m[0].length)).trim(); return m; };
  if (cut(/[,\s]*\b(?:for )?this month\b/i)) return { rest, until: iso(endOfMonth(now)), reviewAt: null };
  if (cut(/[,\s]*\b(?:for )?this week\b/i)) return { rest, until: iso(addDays(now, 7)), reviewAt: null };
  if (cut(/[,\s]*\b(?:for )?today\b/i)) return { rest, until: iso(addDays(now, 1)), reviewAt: null };
  // "UNTIL OCTOBER 8": back on the day named, so it lapses the day after.
  const dated = cut(/[,\s]*\buntil (january|february|march|april|may|june|july|august|september|october|november|december) (\d{1,2})(?:st|nd|rd|th)?\b/i);
  if (dated) {
    const m = MONTHS.indexOf(dated[1]!.toLowerCase());
    const day = Number(dated[2]);
    const thisYear = new Date(Date.UTC(now.getUTCFullYear(), m, day));
    const when = thisYear.getTime() < now.getTime() - 86_400_000 ? new Date(Date.UTC(now.getUTCFullYear() + 1, m, day)) : thisYear;
    return { rest, until: iso(addDays(when, 1)), reviewAt: null };
  }
  const until = cut(/[,\s]*\buntil (\d{4}-\d{2}-\d{2}|january|february|march|april|may|june|july|august|september|october|november|december)\b/i);
  if (until) {
    const w = until[1]!.toLowerCase();
    if (/^\d/.test(w)) return { rest, until: w, reviewAt: null };
    const m = MONTHS.indexOf(w);
    const year = now.getUTCFullYear() + (m <= now.getUTCMonth() ? 1 : 0);
    return { rest, until: iso(new Date(Date.UTC(year, m, 1))), reviewAt: null };
  }
  // "FOR A WEEK", "FOR TEN DAYS", "FOR TWO WEEKS": a length from today.
  const WORD_N: Record<string, number> = { a: 1, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, fourteen: 14 };
  const span = cut(/[,\s]*\bfor (a|one|two|three|four|five|six|seven|eight|nine|ten|fourteen|\d{1,2}) (day|days|week|weeks)\b/i);
  if (span) {
    const n = WORD_N[span[1]!.toLowerCase()] ?? Number(span[1]);
    const days = /week/i.test(span[2]!) ? n * 7 : n;
    if (days >= 1 && days <= 90) return { rest, until: iso(addDays(now, days)), reviewAt: null };
  }
  if (cut(/[,\s]*\b(?:for now|for the moment|for a while|right now|at the moment|for the time being)\b/i)) {
    return { rest, until: null, reviewAt: iso(addDays(now, 30)) };
  }
  return { rest, until: null, reviewAt: null };
}

const when = (r: { until: string | null; reviewAt: string | null }): string =>
  r.until ? `, until ${r.until}` : r.reviewAt ? `, and I will ask you again on ${r.reviewAt}` : ', until you change it';

/**
 * ONE SENTENCE TO ONE STATEMENT, or null. A phrase table: the reading is the
 * same every time, and a sentence it does not know is not guessed at.
 */
export function readMandate(raw: string, now: Date = new Date()): MandateReading | null {
  const said = raw.trim().slice(0, 800);
  if (!said || said.length > 160 || NOT_STEERING.test(said)) return null;
  const { rest, until, reviewAt } = durationOf(said, now);
  const t = { until, reviewAt };
  const make = (dimension: MandateDimension, s: { subject: string; label: string }, value: Record<string, unknown>,
    understood: string, scope: MandateReading['scope'] = { kind: 'portfolio', ref: null }): MandateReading =>
    ({ dimension, subject: s.subject, label: s.label, value, scope, statement: said, until, reviewAt, understoodAs: understood + when(t) });

  // HOW INVOLVED THE OWNER IS, AND WHETHER THEY ARE AWAY. A check-in style is
  // not permission (INSTITUTION_MODEL §5.1): away, Foundry carries exactly
  // what it already may, and everything else waits.
  if (/^(?:i(?:'m| am| will be|'ll be)\s+)?(?:away|out|off|travelling|traveling|on holiday|on vacation|offline)$/i.test(rest)) {
    const lasting = until ? t : { until: iso(addDays(now, 7)), reviewAt: null };
    return { dimension: 'involvement', subject: 'away', label: 'away', value: { style: 'away' },
      scope: { kind: 'portfolio', ref: null }, statement: said, ...lasting,
      understoodAs: `you are away, so I carry only what I already may and everything else waits for you${when(lasting)}` };
  }
  // "I'M BACK": the away statement is replaced, not left to lapse.
  if (/^(?:i(?:'m| am)\s+)?back(?: now)?$/i.test(rest)) {
    return { dimension: 'involvement', subject: 'present', label: 'back', value: { style: 'present' },
      scope: { kind: 'portfolio', ref: null }, statement: said, until: null, reviewAt: null,
      understoodAs: 'you are back, and everything that waited for you is in Needs you' };
  }
  const style = /^(?:be\s+)?(?:(quiet ceo|quiet)|(hands[- ]on)|(check in occasionally|occasional(?:ly)?))(?: mode)?$/i.exec(rest);
  if (style) {
    const s = style[1] ? 'quiet' : style[2] ? 'hands_on' : 'occasional';
    const words = { quiet: 'only what cannot wait', hands_on: 'more of what I am doing', occasional: 'a regular summary' }[s];
    return make('involvement', { subject: s, label: s.replace('_', '-') }, { style: s },
      `you want to hear ${words} (how you hear from me, never what I may do)`);
  }

  // A TEMPORARY POSTURE: spend less. Until the month ends when said of the
  // month; otherwise brought back in thirty days.
  if (/^(?:please\s+)?(?:spend less|cut back(?: on spending)?|cut (?:costs|spending)|be (?:more )?frugal|conserve(?: money| cash)?|tighten (?:the )?belt)\b\s*$/i.test(rest)) {
    const lasting = until || reviewAt ? t : { until: null, reviewAt: iso(addDays(now, 30)) };
    return { dimension: 'posture', subject: 'conserve', label: 'spending less', value: { mode: 'conserve' },
      scope: { kind: 'portfolio', ref: null }, statement: said, ...lasting,
      understoodAs: `you want Foundry to spend less across everything${when(lasting)}` };
  }

  // A DOMAIN KEPT THEORETICAL: "keep trading theoretical", "trading on paper only".
  const theory = /^(?:keep\s+)?(\w[\w ]{1,30}?)\s+(?:theoretical|on paper(?: only)?|paper only|simulated|simulation only|in simulation)$/i.exec(rest);
  if (theory) {
    const s = subjectOf(theory[1]!);
    if (s) return make('posture', { subject: `${s.subject}_theoretical`, label: s.label }, { mode: 'theoretical' },
      `you want ${s.label} kept to simulation and paper, with nothing real at stake`, { kind: 'domain', ref: s.subject });
  }

  const avoid = /^(?:no|no more|avoid|stay away from|skip|not|pause|drop)\s+(.+)$/i.exec(rest)
    ?? /^(?:don'?t|do not)\s+(?:pursue|do|build|explore|look at)\s+(.+)$/i.exec(rest)
    ?? /^stop (?:exploring|pursuing|looking at)\s+(.+)$/i.exec(rest);
  if (avoid) {
    const s = subjectOf(avoid[1]!);
    if (s) return make('avoid', s, { level: 'avoid' }, `you want Foundry to leave ${s.label} alone`);
  }

  const interest = /^(?:focus on|explore|look (?:at|into)|more|lean into|i(?:'m| am) interested in|interested in)\s+(.+)$/i.exec(rest);
  if (interest) {
    const s = subjectOf(interest[1]!);
    if (s) return make('interest', s, { level: 'focus' }, `you want Foundry to look harder at ${s.label}`);
  }

  const optimize = /^(?:prioriti[sz]e|optimi[sz]e for|favou?r|i prefer|prefer|care most about)\s+(.+)$/i.exec(rest);
  if (optimize) {
    const s = subjectOf(optimize[1]!);
    if (s) return make('optimize', s, { weight: 'high' }, `you want Foundry to favour ${s.label} when it weighs options`);
  }

  const risk = /^be (?:more |a bit |much )?(aggressive|bold|adventurous|cautious|careful|conservative)(?: with (?:experiments|tests|risk))?$/i.exec(rest);
  if (risk) {
    const bolder = /aggressive|bold|adventurous/i.test(risk[1]!);
    return make('risk', { subject: 'experiments', label: 'experiments' }, { lean: bolder ? 'bolder' : 'careful' },
      bolder ? 'you want Foundry to propose bolder tests (your charter and limits still bound every one)'
        : 'you want Foundry to propose more careful tests');
  }
  return null;
}

// ─── The writer and the reader of what is in force ────────────────────────────

export class MandateRefused extends Error {}

const DIMENSION_WORDS: Record<MandateDimension, string> = {
  interest: 'Look harder at', avoid: 'Leave alone', optimize: 'Favour', experiment_style: 'Test style',
  involvement: 'How you hear from me', risk: 'Risk', allocation: 'Share of attention', posture: 'For now',
};

/** Statements that answer the same question — a newer one replaces an older one. */
function sameQuestion(a: { dimension: string; subject: string; scope_kind: string; scope_ref: string | null },
  b: { dimension: string; subject: string; scope: { kind: string; ref: string | null } }): boolean {
  if (a.scope_kind !== b.scope.kind || (a.scope_ref ?? null) !== (b.scope.ref ?? null)) return false;
  const family = (d: string): string => (d === 'interest' || d === 'avoid' ? 'lean' : d);
  if (family(a.dimension) !== family(b.dimension)) return false;
  // One posture per scope at a time; one lean, favour or risk per subject.
  return (a.dimension === 'posture' || a.dimension === 'involvement') && a.dimension === b.dimension && b.scope.kind === 'portfolio'
    ? true : a.subject === b.subject;
}

const statementOf = (r: Row): MandateStatement => ({
  id: String(r.id), dimension: String(r.dimension) as MandateDimension, subject: String(r.subject),
  label: String((JSON.parse(String(r.value_json ?? '{}')) as { label?: string }).label ?? r.subject).replace(/_/g, ' '),
  value: JSON.parse(String(r.value_json ?? '{}')) as Record<string, unknown>,
  scope: { kind: String(r.scope_kind) as 'portfolio' | 'domain', ref: r.scope_ref == null ? null : String(r.scope_ref) },
  statement: String(r.statement), until: r.until == null ? null : String(r.until), reviewAt: r.review_at == null ? null : String(r.review_at),
  understoodAs: '', source: String(r.source), saidAt: String(r.said_at),
});

/** WHAT IS IN FORCE NOW: live, not lapsed, newest first. */
export async function mandateOf(founderId: string, now: Date = new Date()): Promise<MandateStatement[]> {
  return ((await query(
    `SELECT id, dimension, subject, value_json, scope_kind, scope_ref, statement, source, until, review_at, said_at
       FROM mandate_statements
      WHERE founder_id = ? AND superseded_by IS NULL AND (until IS NULL OR until > ?)
      ORDER BY said_at DESC, rowid DESC`, [founderId, iso(now)])).rows as unknown as Row[]).map(statementOf);
}

/**
 * STATE ONE THING THE OWNER WANTS. The same typed reading whether it came
 * from a sentence (source 'intent:<id>') or a tap ('direct'); it supersedes
 * the live statement that answered the same question. Returns what was in
 * force before, and what is now, so the page can say what changed.
 */
export async function stateMandate(founderId: string, r: MandateReading, source: string, now: Date = new Date()):
  Promise<{ before: MandateStatement | null; after: MandateStatement }> {
  if (!/^(?:direct|intent:[\w-]{1,64}|undo:[\w-]{1,64})$/.test(source)) throw new MandateRefused('That source is not one the Mandate accepts.');
  if (r.scope.kind !== 'portfolio' && r.scope.kind !== 'domain') throw new MandateRefused('That scope is not one the Mandate holds yet.');
  const live = await mandateOf(founderId, now);
  const before = live.find((s) => sameQuestion({ dimension: s.dimension, subject: s.subject, scope_kind: s.scope.kind, scope_ref: s.scope.ref }, r)) ?? null;
  const id = `ms_${nanoid(14)}`;
  await query(
    `INSERT INTO mandate_statements (id, founder_id, dimension, subject, value_json, scope_kind, scope_ref, statement, source, until, review_at)
     VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
    [id, founderId, r.dimension, r.subject, JSON.stringify({ ...r.value, label: r.label }), r.scope.kind, r.scope.ref,
      r.statement.slice(0, 800), source, r.until, r.reviewAt]);
  if (before) await query(`UPDATE mandate_statements SET superseded_by = ? WHERE id = ? AND founder_id = ? AND superseded_by IS NULL`, [id, before.id, founderId]);
  const after = (await mandateOf(founderId, now)).find((s) => s.id === id);
  if (!after) throw new MandateRefused('That lapses before it would begin.');
  return { before, after };
}

/** TAKE ONE BACK. Kept, pointed at 'withdrawn'; the owner's own only. */
export async function withdrawMandate(founderId: string, id: string): Promise<MandateStatement | null> {
  const row = (await query(
    `SELECT id, dimension, subject, value_json, scope_kind, scope_ref, statement, source, until, review_at, said_at
       FROM mandate_statements WHERE id = ? AND founder_id = ? AND superseded_by IS NULL`, [id, founderId])).rows[0] as Row | undefined;
  if (!row) return null;
  await query(`UPDATE mandate_statements SET superseded_by = 'withdrawn' WHERE id = ? AND founder_id = ? AND superseded_by IS NULL`, [id, founderId]);
  return statementOf(row);
}

// ─── What changed ────────────────────────────────────────────────────────────

/** One statement, as a short phrase: "Leave alone: SaaS (review 2026-10-30)". */
export function phraseOf(s: Pick<MandateStatement, 'dimension' | 'label' | 'until' | 'reviewAt' | 'scope'> | null): string {
  if (!s) return 'nothing said';
  const where = s.scope.kind === 'domain' ? ` (${String(s.scope.ref).replace(/_/g, ' ')})` : '';
  const lasting = s.until ? `, until ${s.until}` : s.reviewAt ? `, review ${s.reviewAt}` : '';
  return `${DIMENSION_WORDS[s.dimension]}: ${s.label}${where}${lasting}`;
}

/**
 * THE STATE DIFF, FROM THE ROWS. What changed, before → after, and what did
 * not: a Mandate statement never moves what Foundry may do, spend or send,
 * and the line says so every time rather than leaving it to be assumed.
 */
export function diffOf(before: MandateStatement | null, after: MandateStatement | null): { changed: string; unchanged: string } {
  return {
    changed: `${phraseOf(before)} → ${phraseOf(after)}`,
    unchanged: 'What Foundry may do, spend or send: unchanged.',
  };
}

export const MANDATE_DIMENSION_WORDS = DIMENSION_WORDS;
