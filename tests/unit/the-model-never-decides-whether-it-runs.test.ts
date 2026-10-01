process.env.TURSO_DATABASE_URL = 'file::memory:';
process.env.ENCRYPTION_KEY = '4'.repeat(64);

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import { runMigrations } from '../../src/db/migrate.js';
import { query } from '../../src/db/client.js';
import {
  WHAT_IT_COULD_CHANGE, WORK_THE_MODEL_DOES, callsRefusedForChangingNothing, couldChange, refuseIfItChangesNothing,
  type Work,
} from '../../src/services/ai/what-it-is-for.js';
import { costPerDecision } from '../../src/services/economy/projection.js';

// =============================================================================
// THE MODEL NEVER DECIDES WHETHER IT RUNS (Roadmap 2027 R8, 30 September 2026;
// STRATEGY S35, "every model call names the decision it could change";
// OBJECTIVE §6, more nuanced = the same decision for less).
//
// Every kind of work a model may do now declares, in code, the decision it
// could change. Work that could change none is refused before a cent is
// reserved, and the refusal is counted. The declaration lives in a closed,
// total map the compiler holds complete; nothing a model returns can set it,
// because whether thinking is bought is not the thinker's to decide. And Money
// says what a decision cost to think about, as a ratio across the institution.
// =============================================================================

const SRC = readFileSync(resolve(import.meta.dirname, '../../src/services/ai/what-it-is-for.ts'), 'utf8');

beforeAll(async () => { await runMigrations(); });

describe('every kind of work names its decision', () => {
  it('is total: each kind of work is in the map, and nothing else is', () => {
    expect(Object.keys(WHAT_IT_COULD_CHANGE).sort()).toEqual(Object.keys(WORK_THE_MODEL_DOES).sort());
  });

  it('names a decision in words for every kind of work', () => {
    // The only kinds that served none were the agent society's, and they left
    // with the agents (Roadmap 2027 R9). Work that serves none can still be
    // declared, and is refused below; none is declared now.
    const none = Object.entries(WHAT_IT_COULD_CHANGE).filter(([, d]) => d === null).map(([w]) => w);
    expect(none).toEqual([]);
    for (const [work, decision] of Object.entries(WHAT_IT_COULD_CHANGE)) {
      if (decision !== null) expect(decision.length, work).toBeGreaterThan(10);
    }
    expect(couldChange('composing a probe')).toBe('whether a test is sealed, and what it decides');
  });
});

describe('a call that could change nothing', () => {
  it('is refused before anything is reserved, and counted', () => {
    // Declared here for the test alone and removed after: a kind of work that
    // could change nothing, as the retired agents' work was.
    const map = WHAT_IT_COULD_CHANGE as Record<string, string | null>;
    map['work that changes nothing'] = null;
    try {
      const before = callsRefusedForChangingNothing();
      expect(() => refuseIfItChangesNothing('work that changes nothing' as Work)).toThrow(/could change no decision/);
      expect(callsRefusedForChangingNothing()).toBe(before + 1);
      expect(() => refuseIfItChangesNothing('composing a probe' as Work)).not.toThrow();
    } finally {
      delete map['work that changes nothing'];
    }
  });

  it('is refused in the client before the spend is authorised', () => {
    const client = readFileSync(resolve(import.meta.dirname, '../../src/services/ai/client.ts'), 'utf8');
    const refusal = client.indexOf('refuseIfItChangesNothing(subjectWork(config.subject))');
    const reserve = client.indexOf('const reservation = await authorizeSpend(', refusal);
    expect(refusal).toBeGreaterThan(0);
    expect(reserve).toBeGreaterThan(refusal);
  });

  it('is decided by code alone: the map is a constant, and no model output reaches it', () => {
    expect(SRC).toMatch(/export const WHAT_IT_COULD_CHANGE: Record<Work, string \| null> = \{/);
    // Nothing assigns into it after the fact, anywhere in the source tree.
    expect(SRC).not.toMatch(/WHAT_IT_COULD_CHANGE\[[^\]]+\]\s*=[^=]/);
    expect(SRC).not.toMatch(/Object\.assign\(\s*WHAT_IT_COULD_CHANGE/);
  });
});

describe('what a decision cost to think about', () => {
  it('gives no number when nothing was decided', async () => {
    await query('INSERT INTO founders (id,clerk_user_id,email,name) VALUES (?,?,?,?)', ['f_cpd', 'clk_cpd', 'cpd@example.com', 'O']);
    const c = await costPerDecision('f_cpd');
    expect(c.decisions).toBe(0);
    expect(c.perDecisionCents).toBeNull();
    expect(c.sentence).toContain('no cost per decision to give');
  });

  it('divides thinking by what the owner recorded, and says it is a ratio', async () => {
    const { readMandate, stateMandate } = await import('../../src/services/mandate/statements.js');
    await stateMandate('f_cpd', readMandate('No SaaS for now')!, 'direct');
    await stateMandate('f_cpd', readMandate('Spend less this month')!, 'direct');
    const c = await costPerDecision('f_cpd');
    expect(c.decisions).toBe(2);
    expect(c.sentence).toContain('as a ratio, not a price on any one');
  });
});
