process.env.TURSO_DATABASE_URL = 'file::memory:';
process.env.ENCRYPTION_KEY = '0'.repeat(64);

import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { nanoid } from 'nanoid';
import { stripComments } from '../../scripts/lib/strip-comments.mjs';
import { runMigrations } from '../../src/db/migrate.js';
import { query } from '../../src/db/client.js';
import { computeSignal, signalText, signalNumber } from '../../src/services/signal.js';

// =============================================================================
// A RULE WRITTEN DOWN, AND OBEYED ONCE.
//
// `SignalResult.hasData` is declared in `services/signal.ts` with the Honesty
// Law and this sentence:
//
//     "False for a brand-new product with no metrics yet: the score is a
//      default, not a measurement. First-run surfaces must say 'not enough
//      data yet' rather than present a falsely-confident number."
//
// Ten places computed a Signal. ONE honoured it. The rest printed the default,
// so a company Foundry had never measured appeared as a confident 85 out of 100:
//
//   • on a PUBLIC share link, under a badge reading "LIVE SIGNAL"
//   • SPOKEN ALOUD in the voice briefing, where there is no colour, no asterisk
//     and no second glance
//   • in the conversation context — into a model, which then reasons from it and
//     repeats it back
//   • and as the BASELINE FOR A DROP ALERT: the default was written into
//     `signal_history` like any other score, so the first day a company
//     actually reported something, the founder was told their Signal had fallen
//     from a number their company was never at.
//
// Several of the offending surfaces were Commercial Foundry pages and are gone;
// the ones named above are not, and the scan below is over whatever calls
// `computeSignal` today rather than over a list written by hand.
//
// The rule did not need to be discovered. It needed one way to obey it, which
// is `signalText`/`signalNumber`, and a test that notices when a consumer does
// not — which is the last describe block here.
// =============================================================================

beforeAll(async () => { await runMigrations(); });
beforeEach(async () => {
  await query('DELETE FROM signal_history');
  await query('DELETE FROM metric_snapshots');
  await query('DELETE FROM lifecycle_state');
  await query('DELETE FROM products');
  await query('DELETE FROM founders');
});

async function company(withMetrics: boolean): Promise<string> {
  const owner = `f_${nanoid(8)}`;
  await query('INSERT INTO founders (id, clerk_user_id, email) VALUES (?,?,?)',
    [owner, `c_${owner}`, `${owner}@example.com`]);
  const pid = `p_${nanoid(8)}`;
  await query("INSERT INTO products (id, name, owner_id, status) VALUES (?,?,?,'active')",
    [pid, 'C', owner]);
  await query("INSERT INTO lifecycle_state (product_id, risk_state) VALUES (?,'green')", [pid]);
  if (withMetrics) {
    await query(
      `INSERT INTO metric_snapshots (id, product_id, snapshot_date, mrr_cents, mrr_health_ratio)
       VALUES (?,?, date('now'), 500000, 0.2)`, [nanoid(), pid]);
  }
  return pid;
}

describe('the default is still a default', () => {
  it('is flagged as unmeasured', async () => {
    const signal = await computeSignal(await company(false));
    expect(signal.hasData).toBe(false);
    expect(signal.score, 'the default is still computed, and still confident-looking')
      .toBeGreaterThan(70);
  });

  it('is flagged as measured once a snapshot exists', async () => {
    expect((await computeSignal(await company(true))).hasData).toBe(true);
  });
});

describe('one way to say it', () => {
  it('refuses to print an unmeasured score', () => {
    expect(signalText({ score: 85, tier: 'high', hasData: false })).toBe('not enough data yet');
    expect(signalNumber({ score: 85, hasData: false })).toBe('—');
  });

  it('prints a measured one', () => {
    expect(signalText({ score: 62, tier: 'mid', hasData: true })).toBe('62/100 (mid tier)');
    expect(signalNumber({ score: 62, hasData: true })).toBe('62');
  });
});

describe('a default does not become a past', () => {
  it('writes no history row for an unmeasured company', async () => {
    const pid = await company(false);
    await computeSignal(pid);
    await new Promise((r) => setTimeout(r, 60)); // the write is fire-and-forget
    const rows = await query('SELECT id FROM signal_history WHERE product_id = ?', [pid]);
    expect(rows.rows.length,
      'a sparkline, a 7-day trend and a drop alert all read this table').toBe(0);
  });

  it('writes one for a measured company', async () => {
    const pid = await company(true);
    await computeSignal(pid);
    await new Promise((r) => setTimeout(r, 60));
    const rows = await query('SELECT id FROM signal_history WHERE product_id = ?', [pid]);
    expect(rows.rows.length).toBe(1);
  });
});

describe('every surface that shows a Signal', () => {
  /** Files that call `computeSignal`, other than the service itself. */
  function consumers(): string[] {
    const out: string[] = [];
    const walk = (d: string) => {
      for (const e of readdirSync(d, { withFileTypes: true })) {
        const p = join(d, e.name);
        if (e.isDirectory()) walk(p);
        else if (p.endsWith('.ts') && p !== 'src/services/signal.ts'
          && /\bcomputeSignal\b/.test(
            stripComments(readFileSync(p, 'utf8'), { lineComments: true }))) out.push(p);
      }
    };
    walk('src');
    return out;
  }

  // A consumer that neither reads `hasData` nor uses the helpers is presenting
  // a default as a measurement. `team/members.ts` imports `computeSignal` and
  // never calls it for a score, so it carries its reason here rather than a
  // silent pass.
  const NO_SCORE_SHOWN = new Set(['src/services/team/members.ts']);

  it('reads hasData or says why it does not', () => {
    const offenders = consumers().filter((f) => {
      if (NO_SCORE_SHOWN.has(f)) return false;
      const src = stripComments(readFileSync(f, 'utf8'), { lineComments: true });
      return !/hasData|signalText|signalNumber|has_data/.test(src);
    });
    expect(offenders, 'nine of ten used to be on this list').toEqual([]);
  });

  it('covers every consumer that exists', () => {
    // A CENSUS, NOT A TARGET: the number is here so that a new surface reading
    // `computeSignal` cannot appear without somebody deciding it obeys the rule
    // above. It was five until `conversation/context.ts` was deleted as
    // production-dead, then four until `GET /share/:token` went — the investor
    // read-only view, whose token nothing can mint now that the control that
    // generated it is deleted. The three left are `jobs/index.ts`,
    // `services/team/members.ts` and `services/voice/briefing.ts`, each
    // asserted by name below or exempted by name above.
    expect(consumers().length, 'if this moves, a new surface appeared')
      .toBeGreaterThanOrEqual(3);
  });

  it('does not let a bare score reach the voice', () => {
    // THE PUBLIC SHARE PAGE WAS THE OTHER HALF OF THIS. It drew the score under
    // a badge reading LIVE SIGNAL, and the rule was that it had to go through
    // `signalNumber(signal)` so an unmeasured Signal reached an investor as a
    // dash rather than as a zero. The page is deleted — nothing writes
    // `products.share_token` since the control that minted it went with the
    // subscription tiers — so the surface that had to obey the rule no longer
    // exists. What remains is the check that it has not come back: no Signal is
    // computed in that file at all.
    const share = stripComments(readFileSync('src/routes/share/index.ts', 'utf8'),
      { lineComments: true });
    expect(share).not.toMatch(/computeSignal/);

    const voice = stripComments(readFileSync('src/services/voice/briefing.ts', 'utf8'),
      { lineComments: true });
    expect(voice).toMatch(/signalText\(signal\)/);
  });

  // The prompt case was `conversation/context.ts`, which passed
  // `signal.hasData ? signal.score : null` so an unmeasured Signal never
  // reached a model as a number. That module was deleted as production-dead, so
  // there is no prompt left carrying it — and `consumers()` above is what
  // catches the next one that appears.

  it('does not alert on a drop from a number nobody measured', () => {
    const src = stripComments(readFileSync('src/jobs/index.ts', 'utf8'), { lineComments: true });
    expect(src).toMatch(/if \(!signal\.hasData\) continue;/);
  });
});
