// =============================================================================
// WHAT EVERY SCRIPTED BRAIN NEEDS: reading the prompt the institution sent.
//
// The institution sends its model a system prompt and one user turn. The
// brains here answer the way a model would — from what is IN the prompt —
// so these helpers read it: which call site it is (by the system prompt's
// own first words, the same words the institution wrote), the data blocks,
// the record's labelled sections, and the theme the record is about.
// Nothing here reads the database or the twin's hidden state.
// =============================================================================
import { hashOf } from '../twin/rng.js';
import { themeOf, type ThemeKey } from '../twin/segments.js';

export type Site =
  | 'interpret' | 'legal' | 'lens' | 'compose' | 'attack' | 'shape' | 'write' | 'honesty' | 'panel' | 'mail' | 'other';

/** The call site, by the first words of the system prompt the institution wrote for it. */
export function siteOf(system: string): Site {
  if (system.startsWith('You are reading one thing a real person wrote')) return 'interpret';
  if (system.startsWith('You are recognising legal and liability exposure')) return 'legal';
  if (system.startsWith('You are one discipline')) return 'lens';
  if (system.startsWith('You compose the design of one small real test')) return 'compose';
  if (system.startsWith('You are the adversary on a small studio')) return 'attack';
  if (system.startsWith('You shape the offer for one small real test')) return 'shape';
  if (system.startsWith('You write the pages of a printable')) return 'write';
  if (system.startsWith('You check a printable file')) return 'honesty';
  if (system.startsWith('You are one of the people it is for') || system.startsWith('You are a skeptic among the people')) return 'panel';
  if (system.startsWith('You classify one email sent to a small workshop')) return 'mail';
  return 'other';
}

export const unescape = (s: string): string => s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');

/** The content of one data block (`<tag> … </tag>`), unescaped, or ''. */
export function block(user: string, tag: string): string {
  const m = new RegExp(`<${tag}>([\\s\\S]*?)</${tag}>`).exec(user);
  return m ? unescape(m[1]!.trim()) : '';
}

/** The raw (still escaped) content of a block, for quoting words exactly as the institution will check them. */
export function rawBlock(user: string, tag: string): string {
  const m = new RegExp(`<${tag}>([\\s\\S]*?)</${tag}>`).exec(user);
  return m ? m[1]!.trim() : '';
}

const LABELS = ['CANDIDATE', 'THE TEST AS PROPOSED', 'EVIDENCE', 'RETRIEVALS', 'OPEN UNKNOWNS', 'LESSONS OF SETTLED TESTS', 'SEASON OF WHAT IT WOULD SELL', 'PRECEDENT ON THIS CANDIDATE',
  'LEGAL PICTURE', 'THE CHARTER', 'EXCHANGES', 'WHAT THIS KIND OF THING TAKES', 'COST DIMENSIONS', 'STOP KINDS'] as const;

/** The forge's record block, section by section, parsed as JSON where it is JSON. */
export function recordSections(user: string): Partial<Record<typeof LABELS[number], unknown>> {
  const rec = block(user, 'record');
  const out: Partial<Record<typeof LABELS[number], unknown>> = {};
  const at = LABELS.map((l) => ({ l, i: rec.search(new RegExp(`^${l.replace(/[()]/g, '\\$&')}[ (:]`, 'm')) })).filter((x) => x.i >= 0).sort((a, b) => a.i - b.i);
  for (let k = 0; k < at.length; k++) {
    const seg = rec.slice(at[k]!.i, k + 1 < at.length ? at[k + 1]!.i : rec.length);
    const head = /^[A-Z ]+(?: \([^\n]*?\))?: /.exec(seg);
    const body = head ? seg.slice(head[0].length).trim() : '';
    try { out[at[k]!.l] = JSON.parse(body); } catch { out[at[k]!.l] = body; }
  }
  return out;
}

/** The theme a prompt is about: its record, offer or listing, by the twin's words. */
export function themeIn(text: string): ThemeKey | null { return themeOf(text); }

/** A deterministic choice keyed by what the call is ABOUT, never by row ids or call order. */
export function choose<T>(xs: readonly T[], ...key: Array<string | number>): T {
  return xs[hashOf(...key) % xs.length]!;
}
export function roll(...key: Array<string | number>): number { return (hashOf(...key) % 1_000_000) / 1_000_000; }

export const reply = (o: unknown): string => JSON.stringify(o);

/** Strip ids so a key built from prompt text does not depend on the database's random names. */
export const stable = (s: string): string => s.replace(/\b[A-Za-z0-9_-]{21}\b/g, '#').replace(/\b(?:exp|opp|unk|ful)_[A-Za-z0-9_-]+/g, '#').slice(0, 600);
