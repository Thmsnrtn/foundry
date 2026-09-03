// =============================================================================
// FOUNDRY - what can I actually see?
//
// A DEFECT THIS FIXES, AND IT WAS MINE. The institution could reach a public
// discussion archive, had a working adapter for it, and left the capability at
// `declared` forever - because the only line that ever promoted it sat inside a
// branch that ran when one of Foundry's own dependencies had gone quiet. Since
// none had, the eye never opened; since the eye never opened, discovery refused
// every search with "nothing I can look through tells me what people say".
//
// That conflated two different rungs of the same ladder:
//
//   AVAILABLE       the provider exists, answers, and answers in a usable shape.
//   REALITY_PROVEN  it did real institutional work and the result was checked.
//
// The second must be earned by doing the work, and manufacturing a question so
// a capability could earn it would be staging exactly what the proof is
// supposed to rule out. But the first is a fact about the instrument, not about
// the world, and the institution has a standing need to know it: an institution
// that cannot say which of its senses still work is one that will eventually
// tell its owner it looked when it did not.
//
// So this asks each declared way of looking one cheap question and checks the
// SHAPE of the answer. It never files a market observation, because the answer
// is not evidence about any market - the adapters it calls are pure reads that
// write nothing, and that separation is the point. It promotes no further than
// `available`. And it reports a sense that has stopped working, which is the
// half nobody notices until a search quietly returns nothing.
// =============================================================================

import { query } from '../../db/client.js';
import { recordMaturity } from './capabilities.js';

export interface SenseCheck {
  provider: string;
  sourceType: string;
  was: string;
  answered: boolean;
  /** What came back, or what went wrong, in one sentence. */
  because: string;
  /** The rung it moved to, or null where nothing changed. */
  movedTo: 'available' | 'degraded' | null;
}

/** A working state: the provider is believed to answer. */
const WORKING = new Set(['available', 'controlled_proven', 'reality_proven', 'reliable']);

/**
 * ONE CHEAP QUESTION, ASKED OF THE INSTRUMENT RATHER THAN THE WORLD.
 *
 * The terms are deliberately dull and deliberately fixed. This is not a search
 * for anything - what is being established is whether the archive answers at
 * all and whether what comes back has the shape the adapter promises. A probe
 * whose terms looked like a market question would be a market question, and
 * would end up quoted somewhere as though somebody had asked it.
 */
async function ask(sourceType: string): Promise<{ ok: boolean; because: string }> {
  try {
    if (sourceType === 'community') {
      const { whatPeopleSaid } = await import('../venture/sources/community.js');
      const said = await whatPeopleSaid('software', 3);
      if (said.found.length === 0 && said.total === 0) {
        return { ok: false, because: 'it answered, but with nothing at all — an archive '
          + 'of public discussion that knows no comment mentioning software is not '
          + 'answering about the world it claims to index' };
      }
      const usable = said.found.filter((f) => f.url.startsWith('https://'));
      return usable.length === 0
        ? { ok: false, because: 'it answered but nothing it returned could be visited' }
        : { ok: true, because: `it answered with ${String(usable.length)} item(s), each `
          + 'naming an address that can be visited' };
    }
    if (sourceType === 'directory') {
      const { whatAlreadyExists } = await import('../venture/sources/npm-registry.js');
      const found = await whatAlreadyExists('logger', 3);
      const usable = found.found.filter((f) => f.url.startsWith('https://'));
      return usable.length === 0
        ? { ok: false, because: 'it answered but nothing it returned could be visited' }
        : { ok: true, because: `it answered with ${String(usable.length)} item(s), each `
          + 'naming an address that can be visited' };
    }
    return { ok: false, because: `nothing here knows how to ask a ${sourceType} source` };
  } catch (err) {
    return { ok: false,
      because: `it did not answer: ${err instanceof Error ? err.message.slice(0, 120) : 'unknown'}` };
  }
}

/**
 * CHECK EVERY WAY OF LOOKING FOUNDRY CLAIMS TO HAVE.
 *
 * Both directions. A declared sense that answers becomes available, so the
 * institution can look through what it has; a working sense that stops
 * answering becomes degraded, so it stops claiming to see through something
 * that is broken. Nothing here reaches reality-proven - that is earned by doing
 * real work whose result is checked, and no amount of answering a dull question
 * is that.
 */
export async function checkTheSenses(): Promise<SenseCheck[]> {
  const providers = ((await query(
    `SELECT id, provider, maturity, supplies_source_type
       FROM capability_providers
      WHERE supplies_source_type IS NOT NULL
      ORDER BY sort_order, rowid`))
    .rows as unknown as Array<Record<string, unknown>>);

  const checked: SenseCheck[] = [];
  for (const row of providers) {
    const was = String(row.maturity);
    const sourceType = String(row.supplies_source_type);
    const answer = await ask(sourceType);

    let movedTo: SenseCheck['movedTo'] = null;
    if (answer.ok && (was === 'declared' || was === 'unavailable' || was === 'degraded')) {
      movedTo = 'available';
    } else if (!answer.ok && WORKING.has(was)) {
      movedTo = 'degraded';
    }
    if (movedTo !== null) {
      await recordMaturity({
        providerId: String(row.id), to: movedTo, evidenceMode: 'real',
        witnessedBy: 'sense_check_tick',
        evidence: `asked it one dull question to see whether the instrument works, `
          + `and ${answer.because}`,
      });
      await query('UPDATE capability_providers SET maturity = ?, maturity_since = '
        + "datetime('now') WHERE id = ?", [movedTo, String(row.id)]);
    }
    checked.push({ provider: String(row.provider), sourceType, was,
      answered: answer.ok, because: answer.because, movedTo });
  }
  return checked;
}

/**
 * WHAT FOUNDRY CANNOT SEE THROUGH, AND WHY.
 *
 * The sentence an owner surface can use without listing providers at him: not
 * a catalogue of instruments, just the honest shape of what is dark.
 */
export async function whatIsNotAnswering(): Promise<string | null> {
  const broken = ((await query(
    `SELECT p.provider, p.maturity, c.what_it_does
       FROM capability_providers p
       JOIN capabilities c ON c.capability_key = p.capability_key
      WHERE p.supplies_source_type IS NOT NULL
        AND p.maturity IN ('degraded','unavailable')
      ORDER BY p.sort_order`))
    .rows as unknown as Array<Record<string, unknown>>);
  if (broken.length === 0) return null;
  return `I cannot currently ${broken.map((b) => String(b.what_it_does).split(' - ')[0]).join('; ')}.`;
}
