// =============================================================================
// LAW (remediation 1.6): A CLAIM NO SOURCE CAN READ WAITS, AND THE REST GO ON.
//
// `real_market_evidence_tick` looks at each unread real claim. Since Roadmap G3
// a pass in which any claim failed throws at the end, so the failure reaches
// `job_health` instead of reading as a calm day — and that stays. What the
// simulation campaign found: one claim that no source could answer failed the
// routine on every morning, forever, with no backoff, recorded only in a log.
//
// Now the failed look is kept against the claim (`claim_look_failures`, 389),
// the claim waits 1, 2, 4 then 8 days, and after the fourth failure it is left.
// A waiting claim does not take a readable claim's turn, and a pass in which
// nothing failed passes.
// =============================================================================
process.env.TURSO_DATABASE_URL = 'file::memory:';
process.env.ENCRYPTION_KEY = '9'.repeat(64);

import { beforeAll, describe, expect, it, vi } from 'vitest';

const asked: string[] = [];
vi.mock('../../src/services/venture/research-sources.js', async (orig) => ({
  ...(await orig<Record<string, unknown>>()),
  waysOfLooking: vi.fn(async () => [{ sourceType: 'directory' }]),
}));
vi.mock('../../src/services/venture/sources/index.js', async (orig) => ({
  ...(await orig<Record<string, unknown>>()),
  askWhatAlreadyExists: vi.fn(async (input: { claimId: string }) => {
    asked.push(input.claimId);
    if (input.claimId === 'cl_unreadable') throw new Error('the directory answered 500');
    return {};
  }),
}));

const { runMigrations } = await import('../../src/db/migrate.js');
const { query } = await import('../../src/db/client.js');
const { JOB_REGISTRY } = await import('../../src/jobs/index.js');
const { claimMayBeLookedAt, CLAIM_LOOK_GIVES_UP_AFTER } = await import('../../src/services/venture/market-evidence.js');

const OWNER = 'cl_owner';
const tick = () => JOB_REGISTRY.real_market_evidence_tick.fn();
const failures = async () => Number(((await query(`SELECT COUNT(*) AS n FROM claim_look_failures WHERE claim_id = 'cl_unreadable'`, [])).rows[0] as Record<string, unknown>).n);
/** Move every recorded failure back, as days passing would. */
const daysPass = (d: number) => query(`UPDATE claim_look_failures SET failed_at = strftime('%Y-%m-%dT%H:%M:%fZ', failed_at, ?)`, [`-${String(d)} days`]);

beforeAll(async () => {
  await runMigrations();
  await query('INSERT INTO founders (id,clerk_user_id,email,name) VALUES (?,?,?,?)', [OWNER, 'clerk_cl', 'cl@example.com', 'Owner']);
  // The unreadable claim was formed first, so it is first in line every pass.
  await query(`INSERT INTO market_claims (id, founder_id, claim, evidence_mode, formed_at) VALUES ('cl_unreadable',?,'plumbers price emergency callouts by hand','real','2026-09-01 00:00:00')`, [OWNER]);
  await query(`INSERT INTO market_claims (id, founder_id, claim, evidence_mode, formed_at) VALUES ('cl_readable',?,'electricians track permits in spreadsheets','real','2026-09-02 00:00:00')`, [OWNER]);
});

describe('one claim no source can read', () => {
  it('the first pass that fails on it still fails, as G3 requires, and the failure is kept against the claim', async () => {
    await expect(tick()).rejects.toThrow(/1 claim\(s\) could not be looked at: cl_unreadable/);
    expect(await failures()).toBe(1);
    expect(asked).toContain('cl_readable');
  });

  it('the next morning it waits, and the routine passes', async () => {
    asked.length = 0;
    await query(`DELETE FROM market_observations WHERE claim_id = 'cl_readable'`, []);
    await expect(tick()).resolves.toBeUndefined();
    expect(asked).not.toContain('cl_unreadable');
    expect((await claimMayBeLookedAt('cl_unreadable', new Date())).may).toBe(false);
  });

  it('it is tried again after 1, 2 and 4 days, and after the fourth failure it is left for good', async () => {
    for (const wait of [1, 2, 4]) {
      await daysPass(wait);
      await expect(tick()).rejects.toThrow(/cl_unreadable/);
    }
    expect(await failures()).toBe(CLAIM_LOOK_GIVES_UP_AFTER);
    await daysPass(365);
    asked.length = 0;
    await expect(tick()).resolves.toBeUndefined();
    expect(asked).not.toContain('cl_unreadable');
  });
});

describe('a waiting claim does not take a readable one\'s turn', () => {
  it('three readable claims behind three waiting ones are all looked at in one pass', async () => {
    for (const id of ['cl_w1', 'cl_w2', 'cl_w3']) {
      await query(`INSERT INTO market_claims (id, founder_id, claim, evidence_mode, formed_at) VALUES (?,?,?,'real','2026-08-01 00:00:00')`, [id, OWNER, `waiting claim about roofers ${id}`]);
      await query(`INSERT INTO claim_look_failures (id, claim_id, because, failed_at) VALUES (?,?,'earlier','2026-10-01T00:00:00.000Z')`, [`f_${id}`, id]);
      await query(`INSERT INTO claim_look_failures (id, claim_id, because, failed_at) VALUES (?,?,'earlier',?)`, [`g_${id}`, id, new Date().toISOString()]);
    }
    for (const id of ['cl_r1', 'cl_r2', 'cl_r3']) {
      await query(`INSERT INTO market_claims (id, founder_id, claim, evidence_mode, formed_at) VALUES (?,?,?,'real','2026-09-10 00:00:00')`, [id, OWNER, `readable claim about painters ${id}`]);
    }
    asked.length = 0;
    await tick();
    // Three looks, as before — every one at a claim that can be read, though
    // the three waiting claims were formed first and head the queue.
    expect(asked).toHaveLength(3);
    expect(asked.filter((a) => a.startsWith('cl_w') || a === 'cl_unreadable')).toEqual([]);
  });
});

// THE WINDOW (remediation audit, 6 October 2026). A claim given up on has no
// observation and is never settled, so it stayed at the front of a window of
// twenty for good; twenty such claims and no newer claim was ever looked at,
// while every pass reported success. Given up now means out of the window,
// and named on Controls.
describe('claims given up on do not fill the window', () => {
  it('a readable claim behind twenty-one given-up ones is still looked at', async () => {
    await query(`DELETE FROM market_claims WHERE id LIKE 'cl_r%' OR id LIKE 'cl_w%'`, []);
    for (let i = 0; i < 21; i += 1) {
      const id = `cl_gone_${String(i).padStart(2, '0')}`;
      await query(`INSERT INTO market_claims (id, founder_id, claim, evidence_mode, formed_at) VALUES (?,?,?,'real','2026-07-01 00:00:00')`, [id, OWNER, `given up claim about masons ${id}`]);
      for (let k = 0; k < CLAIM_LOOK_GIVES_UP_AFTER; k += 1) {
        await query(`INSERT INTO claim_look_failures (id, claim_id, because, failed_at) VALUES (?,?,'no source answered','2026-07-02T00:00:00.000Z')`, [`f_${id}_${String(k)}`, id]);
      }
    }
    await query(`INSERT INTO market_claims (id, founder_id, claim, evidence_mode, formed_at) VALUES ('cl_late',?,'tilers quote jobs from photographs','real','2026-09-20 00:00:00')`, [OWNER]);
    asked.length = 0;
    await tick();
    expect(asked).toContain('cl_late');
    expect(asked.filter((a) => a.startsWith('cl_gone_'))).toEqual([]);
  });

  it('and the owner can read which were left, and why', async () => {
    const { productionFacts } = await import('../../src/services/control/production-facts.js');
    const left = (await productionFacts(OWNER)).claimsLeft ?? [];
    expect(left.length).toBeGreaterThanOrEqual(10);
    expect(left[0]!.because).toBe('no source answered');
    expect(left.map((l) => l.claimId)).not.toContain('cl_late');
  });
});

// THE SECOND AUDIT (6 October 2026): a claim whose words leave nothing to
// search for had no observation, no settlement and no failure, so it stayed in
// the window for good; and Controls showed ten given-up claims with no total.
describe('a claim with nothing to search for leaves the window too', () => {
  it('each pass that reaches it records why, without failing the pass, and after four it is left', async () => {
    await query(`INSERT INTO market_claims (id, founder_id, claim, evidence_mode, formed_at) VALUES ('cl_mute',?,'a b c — the !!','real','2026-06-01 00:00:00')`, [OWNER]);
    const mute = async () => Number(((await query(`SELECT COUNT(*) AS n FROM claim_look_failures WHERE claim_id = 'cl_mute'`, [])).rows[0] as Record<string, unknown>).n);
    for (let pass = 0; pass < CLAIM_LOOK_GIVES_UP_AFTER; pass += 1) {
      await expect(tick(), 'no source was asked, so nothing failed').resolves.toBeUndefined();
      await daysPass(16);
    }
    expect(await mute()).toBe(CLAIM_LOOK_GIVES_UP_AFTER);
    asked.length = 0;
    await tick();
    expect(await mute(), 'left: not reached again').toBe(CLAIM_LOOK_GIVES_UP_AFTER);
    const { productionFacts } = await import('../../src/services/control/production-facts.js');
    const facts = await productionFacts(OWNER);
    expect(facts.claimsLeftTotal, 'the twenty-one given up, cl_unreadable, and this one').toBe(23);
    expect(facts.claimsLeft?.[0]).toMatchObject({ claimId: 'cl_mute', because: 'its words leave nothing a source could search for' });
  });

  it('the facts Controls reads say how many were left when they carry only the oldest ten', async () => {
    const { productionFacts } = await import('../../src/services/control/production-facts.js');
    const facts = await productionFacts(OWNER);
    expect(facts.claimsLeft?.length).toBe(10);
    expect(facts.claimsLeftTotal).toBe(23);
  });
});
