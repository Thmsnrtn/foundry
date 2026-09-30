process.env.TURSO_DATABASE_URL = 'file::memory:';
process.env.ENCRYPTION_KEY = '8'.repeat(64);
process.env.FOUNDRY_INSTANCE_POSTURE = 'private_owner';
process.env.FOUNDRY_OWNER_EMAIL = 'owner@example.com';

import { readFileSync } from 'node:fs';
import { beforeAll, describe, expect, it } from 'vitest';
import { runMigrations } from '../../src/db/migrate.js';
import { query } from '../../src/db/client.js';
import { openMandate, candidatesFor, survivesGuidance } from '../../src/services/venture/mandate.js';
import { mandateOf, readMandate, stateMandate, withdrawMandate } from '../../src/services/mandate/statements.js';
import { avoidsAsGuidance, spendFactor } from '../../src/services/mandate/narrowing.js';
import { thinkingCapFor, thinkingToday } from '../../src/services/institution/spending.js';

// =============================================================================
// A MANDATE NARROWS AND NEVER WIDENS (Institution V2b, 30 September 2026;
// INSTITUTION_MODEL §3.2, §4.1; scenarios 610 and 611).
//
// "No SaaS for now" turns a SaaS candidate away from the search exactly as
// the same words said to the search would, and says why. "Spend less this
// month" lowers the daily thinking ceiling the model client is handed, and
// the lower ceiling lapses with the month. Neither can do the opposite: no
// statement, however worded, raises a ceiling or lets a candidate through
// that the search's own guidance turned away.
// =============================================================================

const OWNER = 'f_narrow';
const NOW = new Date('2026-09-30T12:00:00Z');
let mandateId = '';

beforeAll(async () => {
  await runMigrations();
  await query('INSERT INTO founders (id,clerk_user_id,email,name) VALUES (?,?,?,?)', [OWNER, 'clk_narrow', 'owner@example.com', 'Owner']);
  const m = await openMandate({ founderId: OWNER, statement: 'Find a small product I can run', shape: null });
  if ('refused' in m) throw new Error(m.refused);
  mandateId = m.id;
  for (const [id, headline] of [['opp_saas', 'A SaaS dashboard for bakeries'], ['opp_dl', 'A printable pricing workbook for bakeries']]) {
    await query(`INSERT INTO venture_opportunities (id, mandate_id, founder_id, headline, who_has_it, the_problem, why_it_might, kill_thesis, sources_json, evidence_mode)
      VALUES (?,?,?,?,'bakers','they guess prices','they asked','nobody pays','[]','real')`, [id, m.id, OWNER, headline]);
  }
});

describe('No SaaS for now (610)', () => {
  it('turns the SaaS candidate away, says why, and leaves the other alone', async () => {
    const before = await candidatesFor(mandateId);
    expect(before.find((c) => c.id === 'opp_saas')?.survivesGuidance).toBe(true);
    await stateMandate(OWNER, readMandate('No SaaS for now', NOW)!, 'direct', NOW);
    const after = await candidatesFor(mandateId);
    const saas = after.find((c) => c.id === 'opp_saas')!;
    expect(saas.survivesGuidance).toBe(false);
    expect(saas.failsBecause).toContain('SaaS');
    expect(after.find((c) => c.id === 'opp_dl')!.survivesGuidance).toBe(true);
  });

  it('never lets through what the search itself turned away: it only adds reasons to say no', async () => {
    const own = [{ id: 'g1', statement: 'no dashboards', kind: 'avoid' as const, subject: 'dashboard', dimension: null }];
    const candidate = { headline: 'A dashboard for florists', why: 'they asked' };
    expect((await survivesGuidance(candidate, own)).survives).toBe(false);
    expect((await survivesGuidance(candidate, [...own, ...(await avoidsAsGuidance(OWNER))])).survives).toBe(false);
    // Whatever the owner says to look harder at is not a filter at all.
    await stateMandate(OWNER, readMandate('Focus on dashboards', NOW)!, 'direct', NOW);
    expect((await avoidsAsGuidance(OWNER)).every((g) => g.kind === 'avoid')).toBe(true);
  });

  it('stops turning it away once the owner takes it back', async () => {
    const saas = (await mandateOf(OWNER)).find((s) => s.subject === 'saas')!;
    await withdrawMandate(OWNER, saas.id);
    expect((await candidatesFor(mandateId)).find((c) => c.id === 'opp_saas')!.survivesGuidance).toBe(true);
  });
});

describe('Spend less this month (611)', () => {
  it('halves the ceiling the model client is handed, names why, and lapses with the month', async () => {
    const full = await thinkingCapFor(OWNER, NOW);
    await stateMandate(OWNER, readMandate('Spend less this month', NOW)!, 'direct', NOW);
    const less = await thinkingCapFor(OWNER, NOW);
    expect(less).toBe(Math.min(full, Math.floor(full * 0.5)));
    expect(less).toBeLessThan(full);
    const today = await thinkingToday(OWNER, NOW);
    expect(today.bindingCents).toBe(less);
    expect(today.bindingIs).toBe('spend-less');
    expect(today.ceilings.map((c) => c.name)).toContain('You asked me to spend less');
    expect(await thinkingCapFor(OWNER, new Date('2026-10-02T12:00:00Z'))).toBe(full);
  });

  it('never raises a ceiling: every statement the reader can make leaves the factor at or below 1', async () => {
    const said = ['Be more aggressive with experiments', 'Focus on SaaS', 'Prioritize growth', 'No SaaS', 'Spend less', 'Keep trading theoretical',
      'Explore trading', 'Favour speed', 'I prefer big bets'];
    const full = await thinkingCapFor('f_nobody_else', NOW);
    for (const s of said) {
      const r = readMandate(s, NOW);
      if (!r) continue;
      await stateMandate(OWNER, r, 'direct', NOW);
      expect((await spendFactor(OWNER, NOW)).factor, s).toBeLessThanOrEqual(1);
      // Never above what an owner who has said nothing at all is allowed.
      expect(await thinkingCapFor(OWNER, NOW), s).toBeLessThanOrEqual(full);
    }
    expect(full).toBeGreaterThan(0);
  });

  it('is the only way the Mandate reaches spending, and it can only multiply down', () => {
    const src = readFileSync('src/services/mandate/narrowing.ts', 'utf8');
    expect(src).toMatch(/Math\.min\(1, Math\.max\(0, CONSERVE_FACTOR\)\)/);
    expect(src).not.toMatch(/\b(?:INSERT INTO|UPDATE)\b/);
    const spending = readFileSync('src/services/institution/spending.ts', 'utf8');
    expect(spending).toMatch(/Math\.floor\(rate \* Math\.min\(1, factor\)\)/);
  });
});
