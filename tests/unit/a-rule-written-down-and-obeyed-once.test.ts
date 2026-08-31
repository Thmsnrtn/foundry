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
// Ten places compute a Signal. ONE honoured it — the main dashboard. The other
// nine printed the default, so a company Foundry had never measured appeared as
// a confident 85 out of 100:
//
//   • on a PUBLIC share link, under a badge reading "LIVE SIGNAL"
//   • SPOKEN ALOUD in the voice briefing, where there is no colour, no asterisk
//     and no second glance
//   • in the weekly-plan prompt and the conversation context — twice into a
//     model, which then reasons from it and repeats it back
//   • in Fleet Triage, where it sorted among real companies and pulled the
//     fleet average, on a page whose whole purpose is choosing what to look at
//   • over the mobile API
//   • and as the BASELINE FOR A DROP ALERT: the default was written into
//     `signal_history` like any other score, so the first day a company
//     actually reported something, the founder was told their Signal had fallen
//     from a number their company was never at.
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

  it('covers the ten that exist', () => {
    expect(consumers().length, 'if this moves, a new surface appeared')
      .toBeGreaterThanOrEqual(9);
  });

  it('does not let a bare score reach the public share page or the voice', () => {
    const share = stripComments(readFileSync('src/routes/share/index.ts', 'utf8'),
      { lineComments: true });
    expect(share, 'under a badge reading LIVE SIGNAL').toMatch(/signalNumber\(signal\)/);
    expect(share).not.toMatch(/share-number">\$\{signal\.score\}/);

    const voice = stripComments(readFileSync('src/services/voice/briefing.ts', 'utf8'),
      { lineComments: true });
    expect(voice).toMatch(/signalText\(signal\)/);
  });

  it('does not put an unmeasured Signal into a model prompt', () => {
    const plan = stripComments(readFileSync('src/routes/dashboard/plan.ts', 'utf8'),
      { lineComments: true });
    expect(plan).toMatch(/Signal score: \$\{signalText\(signal\)\}/);

    const ctx = stripComments(readFileSync('src/services/conversation/context.ts', 'utf8'),
      { lineComments: true });
    expect(ctx).toMatch(/signal: signal\.hasData \? signal\.score : null/);
  });

  it('does not rank an unmeasured company among measured ones', () => {
    const src = stripComments(readFileSync('src/routes/dashboard/portfolio.ts', 'utf8'),
      { lineComments: true });
    expect(src, 'it is not the most urgent, and not the calmest either')
      .toMatch(/a\.signal\.hasData \? -1 : 1/);
    expect(src, 'and it was pulling the fleet average toward its default')
      .toMatch(/fleet\.filter\(\(f\) => f\.signal\.hasData\)/);
  });

  it('does not alert on a drop from a number nobody measured', () => {
    const src = stripComments(readFileSync('src/jobs/index.ts', 'utf8'), { lineComments: true });
    expect(src).toMatch(/if \(!signal\.hasData\) continue;/);
  });
});
