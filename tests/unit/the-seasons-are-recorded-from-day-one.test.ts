// =============================================================================
// THE SEASONS ARE RECORDED FROM DAY ONE (F2, 9 October 2026).
//
// Printables are seasonal: planners peak at the new year, tax organisers in the
// spring, back-to-school in late summer. Foundry cannot know its own seasons
// until it has a year of its own, so:
//   * every month, its own demand is RECORDED: sales, refunds and net, per
//     channel, from the rows the ledgers hold — counted, never estimated, once
//     per month (a second pass changes nothing), and real money kept apart from
//     a rehearsal's;
//   * visits are NOT recorded, and the reason is said: the Workshop carries no
//     tracking by design, and a channel's lifetime counts are not monthly;
//   * until its own year exists, SEASONAL PRIORS stand in, each one labelled an
//     assumption with its reasoning, never presented as observed; the launch
//     timing reads them with the time search takes to send anybody.
// =============================================================================
process.env.TURSO_DATABASE_URL = 'file::memory:';
process.env.ENCRYPTION_KEY = '4'.repeat(64);
import { beforeAll, describe, expect, it } from 'vitest';
import { runMigrations } from '../../src/db/migrate.js';
import { query } from '../../src/db/client.js';

const SZ = await import('../../src/services/venture/storefront/seasonality.js');
const OWNER = 'f_season';

beforeAll(async () => {
  await runMigrations();
  await query('INSERT INTO founders (id,clerk_user_id,email,name) VALUES (?,?,?,?)', [OWNER, 'clk_season', 'owner@example.com', 'Owner']);
  // What two channels said in September 2026 (sandbox) and one real sale.
  const ins = (id: string, ch: string, kind: string, cents: number, fee: number | null, at: string, mode: string) => query(
    `INSERT INTO channel_sales (id, founder_id, experiment_id, version, channel, kind, provider_ref, gross_cents, fee_cents, tax_cents, currency, occurred_at, evidence_mode)
     VALUES (?,?,?,?,?,?,?,?,?,0,'usd',?,?)`, [id, OWNER, 'exp_s', 1, ch, kind, `ref_${id}`, cents, fee, at, mode]);
  await ins('a', 'gumroad', 'sale', 900, 140, '2026-09-03T10:00:00Z', 'sandbox');
  await ins('b', 'gumroad', 'sale', 900, 140, '2026-09-20T10:00:00Z', 'sandbox');
  await ins('c', 'gumroad', 'refund', 900, null, '2026-09-21T10:00:00Z', 'sandbox');
  await ins('d', 'lemonsqueezy', 'sale', 900, null, '2026-09-25T10:00:00Z', 'sandbox');
  await ins('e', 'gumroad', 'sale', 900, 140, '2026-09-26T10:00:00Z', 'real');
});

describe('Foundry\'s own demand, month by month', () => {
  it('records September per channel, counted from the rows, real and rehearsal apart', async () => {
    const r = await SZ.recordDemandSignals(OWNER, '2026-09');
    expect(r.recorded).toBeGreaterThan(0);
    const rows = (await query(`SELECT signal, channel, value, evidence_mode, source FROM demand_signals WHERE founder_id = ? AND month = '2026-09' ORDER BY evidence_mode, channel, signal`, [OWNER])).rows as Array<Record<string, unknown>>;
    const v = (mode: string, ch: string, sig: string) => Number(rows.find((x) => x.evidence_mode === mode && x.channel === ch && x.signal === sig)?.value);
    expect(v('sandbox', 'gumroad', 'sales')).toBe(2);
    expect(v('sandbox', 'gumroad', 'refunds')).toBe(1);
    expect(v('sandbox', 'gumroad', 'net_cents')).toBe(1800 - 900 - 280);
    expect(v('sandbox', 'lemonsqueezy', 'sales')).toBe(1);
    // Lemon Squeezy's order stated no fee: its net is not known, so it is not recorded as a number.
    expect(rows.some((x) => x.channel === 'lemonsqueezy' && x.signal === 'net_cents')).toBe(false);
    expect(v('real', 'gumroad', 'sales')).toBe(1);
    for (const x of rows) expect(String(x.source)).toMatch(/counted from/);
  });

  it('a second pass for the same month changes nothing', async () => {
    const before = (await query(`SELECT COUNT(*) AS n FROM demand_signals`)).rows[0] as Record<string, unknown>;
    expect((await SZ.recordDemandSignals(OWNER, '2026-09')).recorded).toBe(0);
    expect((await query(`SELECT COUNT(*) AS n FROM demand_signals`)).rows[0]).toEqual(before);
  });

  it('visits are not recorded, and why is said', () => {
    expect(SZ.VISITS_NOT_RECORDED).toMatch(/no tracking/);
  });

  // THE MONTH IS RECORDED ONCE ITS LATE REPORTS ARE IN (F3 audit of F2): it was
  // recorded the morning it ended, so a channel unread that morning left it short.
  it('the monthly pass records a month only once it has ended and settled', () => {
    expect(SZ.monthToRecord(new Date('2026-10-01T03:00:00Z'))).toBe('2026-08');
    expect(SZ.monthToRecord(new Date('2026-10-04T03:00:00Z'))).toBe('2026-09');
    expect(SZ.monthToRecord(new Date('2026-10-15T03:00:00Z'))).toBe('2026-09');
    expect(SZ.monthToRecord(new Date('2027-01-05T03:00:00Z'))).toBe('2026-12');
  });
});

describe('seasonal priors, labelled, until its own year exists', () => {
  it('every prior is an assumption with its reasoning, twelve months each, averaging one', () => {
    for (const [theme, p] of Object.entries(SZ.SEASONAL_PRIORS)) {
      expect(p.source.kind, theme).toBe('assumption');
      expect(p.source.why.length, theme).toBeGreaterThan(30);
      expect(p.byMonth, theme).toHaveLength(12);
      expect(p.byMonth.reduce((a, b) => a + b, 0) / 12, theme).toBeCloseTo(1, 1);
    }
  });

  it('launch timing: listed with the time search takes, ahead of the peak; an unknown theme has no timing', () => {
    // Planners peak in January: a file listed in October has its lag behind it by the peak.
    const t = SZ.launchTiming('planner', new Date('2026-10-09T00:00:00Z'));
    expect(t).toMatchObject({ peakMonth: 1, listBy: '2026-11', because: expect.stringMatching(/assumption/) });
    expect(SZ.launchTiming('no-such-theme', new Date('2026-10-09T00:00:00Z'))).toBeNull();
  });
});

describe('wired, not only built', () => {
  it('the hand\'s daily tick records the month that ended (parsed, so a comment does not count)', async () => {
    const ts = (await import('typescript')).default;
    const { readFileSync } = await import('node:fs');
    const sf = ts.createSourceFile('jobs.ts', readFileSync('src/jobs/index.ts', 'utf8'), ts.ScriptTarget.Latest, true);
    const called = new Set<string>();
    const v = (n: import('typescript').Node): void => {
      if (ts.isCallExpression(n) && ts.isIdentifier(n.expression)) called.add(n.expression.text);
      ts.forEachChild(n, v);
    };
    v(sf);
    expect(called.has('recordDemandSignals')).toBe(true);
    expect(called.has('monthToRecord')).toBe(true);
  });
});
