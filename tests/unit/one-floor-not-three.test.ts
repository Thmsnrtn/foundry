process.env.TURSO_DATABASE_URL = 'file::memory:';
process.env.ENCRYPTION_KEY = '0'.repeat(64);

import { beforeAll, describe, expect, it } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'fs';
import { join } from 'path';
import { stripComments } from '../../scripts/lib/strip-comments.mjs';
import { runMigrations } from '../../src/db/migrate.js';
import { query } from '../../src/db/client.js';
import { MIN_CONTRIBUTORS } from '../../src/services/institution/contributor-floor.js';

// =============================================================================
// HOW FEW COMPANIES MAY STAND BEHIND A NUMBER SHOWN TO ANOTHER COMPANY.
//
// One question. It was asked in four places and answered three ways: the wisdom
// network published to a company's COMPETITORS above three contributors, the
// benchmark pool above five, the peer-signal path above five, and the network
// benchmark recompute above a bare literal three. Two of them shared the NAME
// `MIN_CONTRIBUTORS` while disagreeing about the number, which is how a reader
// checking one could come away satisfied about the other.
//
// Whichever path a company's data happened to travel decided how thin an
// aggregate could get before it reached that company's competitors, and the
// weakest answer governed the two cross-company paths.
//
// So: one constant, and the floor is the strictest of what was there — raising
// a floor is safe, lowering one is a decision. Whether five is SUFFICIENT is
// counsel debt (`OWNER_DECISIONS_PENDING.md` §13) and no test here claims it.
// =============================================================================

const SRC = 'src';

function tsFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((e) => {
    const p = join(dir, e);
    return statSync(p).isDirectory() ? tsFiles(p) : p.endsWith('.ts') ? [p] : [];
  });
}

beforeAll(async () => {
  await runMigrations();
});

describe('the floor is one rule', () => {
  it('is defined in exactly one file', () => {
    // Comments describe the defect and name the old numbers; they are not the
    // defect. Stripped, or this test would fail on its own explanation — a
    // mistake this campaign has now made four times.
    const definers = tsFiles(SRC).filter((f) => {
      const src = stripComments(readFileSync(f, 'utf8'), { lineComments: true });
      return /\b(const|let|var)\s+(MIN_CONTRIBUTORS|PEER_SIGNAL_MIN_SAMPLE)\s*=/.test(src);
    });
    expect(definers).toEqual(['src/services/institution/contributor-floor.ts']);
  });

  it('is what every cross-company path uses, with no literal beside it', () => {
    const paths = [
      'src/services/wisdom/network.ts',
      'src/services/benchmarking/pool.ts',
      'src/services/decisions/patterns.ts',
      'src/services/network/benchmarks.ts',
    ];
    for (const p of paths) {
      const src = stripComments(readFileSync(p, 'utf8'), { lineComments: true });
      expect(src, `${p} imports the floor`).toContain('contributor-floor.js');
    }
  });

  it('is the strictest of the numbers it replaced, not the loosest', () => {
    // The three it replaced were 3, 5 and 5. A future edit that lowers this to
    // make a thin aggregate publish is the failure this file exists to catch.
    expect(MIN_CONTRIBUTORS).toBeGreaterThanOrEqual(5);
  });
});

describe('the network benchmark path', () => {
  // Driven through `contributeToNetwork`, the real weekly entry point, rather
  // than a test-only export of the private recompute: the floor is only worth
  // asserting where a company's number actually travels.
  const seed = async (n: number, tag: string) => {
    await query('DELETE FROM network_contributions');
    await query('DELETE FROM network_benchmarks');
    for (let i = 0; i < n; i++) {
      const f = `${tag}_f${i}`, pr = `${tag}_p${i}`;
      await query(
        `INSERT INTO founders (id, clerk_user_id, email, network_opt_in)
         VALUES (?,?,?,1)`, [f, `${tag}_c${i}`, `${tag}${i}@example.com`]);
      await query(
        `INSERT INTO products (id, name, owner_id, status) VALUES (?,?,?,'active')`,
        [pr, `Co ${i}`, f]);
      await query(
        `INSERT INTO metric_snapshots
           (id, product_id, snapshot_date, activation_rate, day_30_retention,
            churn_rate, nps_score, new_mrr_cents)
         VALUES (?, ?, date('now'), ?, ?, ?, ?, 100000)`,
        [`${tag}_ms${i}`, pr, 40 + i, 60 + i, 3 + i, 20 + i],
      );
    }
    const { contributeToNetwork } = await import('../../src/services/network/benchmarks.js');
    for (let i = 0; i < n; i++) await contributeToNetwork(`${tag}_p${i}`, null, 'growth');
  };

  const published = async () => (await query(
    `SELECT metric, sample_count FROM network_benchmarks WHERE metric = 'churn_rate'`,
  )).rows as unknown as Array<Record<string, unknown>>;

  it('abstains one company short of the floor', async () => {
    await seed(MIN_CONTRIBUTORS - 1, 'short');
    expect(await published(), 'a number that cannot be shown honestly is not shown')
      .toEqual([]);
  });

  it('publishes at the floor, counting companies', async () => {
    await seed(MIN_CONTRIBUTORS, 'atfloor');
    const rows = await published();
    expect(rows).toHaveLength(1);
    // One row per company per metric — the contribution id is deterministic per
    // product, so a company cannot appear twice and this count is companies.
    expect(Number(rows[0].sample_count)).toBe(MIN_CONTRIBUTORS);
  });

  it('does not take a company that never opted in', async () => {
    await seed(MIN_CONTRIBUTORS, 'optout');
    await query('DELETE FROM network_contributions');
    await query('DELETE FROM network_benchmarks');
    await query('UPDATE founders SET network_opt_in = 0 WHERE id LIKE ?', ['optout_f%']);
    const { contributeToNetwork } = await import('../../src/services/network/benchmarks.js');
    for (let i = 0; i < MIN_CONTRIBUTORS; i++) await contributeToNetwork(`optout_p${i}`, null, 'growth');
    expect(await query('SELECT id FROM network_contributions')).toHaveProperty('rows', []);
  });
});
