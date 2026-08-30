import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { stripComments } from '../../scripts/lib/strip-comments.mjs';

const ROOT = resolve(import.meta.dirname, '../..');
const SRC = join(ROOT, 'src');

function walk(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = join(dir, e.name);
    if (e.isDirectory()) return walk(p);
    return e.isFile() && p.endsWith('.ts') ? [p] : [];
  });
}

const FILES = walk(SRC).map((f) => ({ path: relative(ROOT, f), src: stripComments(readFileSync(f, 'utf8')) }));

/**
 * THE LADDER IS ONLY A LADDER IF IT IS THE ONLY WAY UP.
 *
 * `ux/interruption.ts` decides how loudly Foundry may speak: a four-rung ladder,
 * a demotion when the founder's measured strain says to be quieter, and the
 * founder's own ceiling on top, which always wins. It is a good policy and it
 * governed only the paths that chose to use it.
 *
 * A route approving an SCP decision wrote `INSERT INTO notifications` directly.
 * That skipped the ceiling and the strain rule, and what it delivered was a
 * bell telling the founder that the founder had just approved something — an
 * echo of the reader's own click, one moment after the click. Its own comment
 * called it an audit notification, which is the ladder's BOTTOM rung by
 * definition ("log — audit trail only"), delivered two rungs up.
 *
 * So the table gets one writer. Anything that reaches a founder goes through
 * the policy that knows what they have asked for.
 */
describe('nothing reaches a founder around the interruption policy', () => {
  it('has exactly one writer for the notifications table', () => {
    const writers = FILES
      .filter((f) => /INSERT\s+INTO\s+notifications\b/i.test(f.src))
      .map((f) => f.path);

    expect(writers,
      'Every write to `notifications` must go through `createNotification`, which is ' +
      'reached through `deliver()` in ux/interruption.ts — that is where the founder\'s ' +
      'ceiling and the strain demotion are applied. A direct INSERT is a bell that ' +
      'ignores both:\n' + writers.join('\n')).toEqual(['src/services/ux/notifications.ts']);
  });

  it('keeps the set of callers that skip the ladder small and argued for', () => {
    // `createNotification` writes the row; `deliver()` decides whether it should
    // be written at all. A caller reaching past `deliver` has chosen the bell
    // for the founder rather than letting the founder's settings choose.
    //
    // Billing is the one standing exception and says why in place: a founder
    // whose card is failing must be told their service is about to lapse
    // whatever they set about notification volume, and that notice is
    // founder-scoped rather than company-scoped. It is listed here so it stays
    // a decision somebody made, rather than the first of many.
    const ALLOWED = [
      'src/services/ux/interruption.ts',   // the ladder itself
      'src/services/billing/stripe.ts',    // service-lapse notices, reasoned in place
    ];

    const callers = FILES
      .filter((f) => f.path !== 'src/services/ux/notifications.ts')
      .filter((f) => /\bcreateNotification\s*\(/.test(f.src))
      .map((f) => f.path)
      .sort();

    const unexpected = callers.filter((c) => !ALLOWED.includes(c));
    expect(unexpected,
      'These call `createNotification` without going through `deliver()`, so the ' +
      'founder\'s ceiling and their measured strain do not apply. Route them through ' +
      '`deliver()` with an importance, or add them here with the reason they must ' +
      'always be heard:\n' + unexpected.join('\n')).toEqual([]);
  });
});
