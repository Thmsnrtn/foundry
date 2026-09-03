process.env.TURSO_DATABASE_URL = 'file::memory:';
process.env.ENCRYPTION_KEY = '0'.repeat(64);
process.env.FOUNDRY_INSTANCE_POSTURE = 'private_owner';
process.env.FOUNDRY_OWNER_EMAIL = 'owner@example.com';

import { beforeAll, expect, vi } from 'vitest';
import cases from './cases/reading-a-signal.json' assert { type: 'json' };
import { defineEval } from './_framework.js';

// =============================================================================
// EVAL — what Foundry does with every shape of reply a reader can return.
//
// The prompt that reads a real sentence is the newest and most consequential
// prompt in the institution: it is the only place where a model's words become
// part of what Foundry believes. What CI can pin down deterministically is not
// whether the model reads WELL — that needs the real world — but whether
// Foundry HANDLES each shape of answer correctly, which is where a prompt edit
// would drift silently.
//
// The cases that matter most are the refusals. A reader that paraphrases the
// source into its own citation is how a paraphrase becomes evidence three steps
// later, and the expectation is written down here so that loosening it has to
// be a deliberate act with a failing case attached.
// =============================================================================

interface Input {
  said: string;
  /** What the reader returned: an object, a string of prose, or nothing. */
  reply: Record<string, unknown> | string | null;
}
interface Outcome {
  outcome: 'understood' | 'abstained' | 'refused';
  hasHypothesis: boolean;
  /** Whether what Foundry stored as the words it read is really in the text. */
  quotedFromSource: boolean;
}

let reply: string = '';
vi.mock('../../src/services/ai/client.js', async (orig) => ({
  ...(await orig<Record<string, unknown>>()),
  callSonnet: vi.fn(async () => ({ content: reply, tokensUsed: 10, costUsd: 0 })),
}));

const { runMigrations } = await import('../../src/db/migrate.js');
const { query } = await import('../../src/db/client.js');
const { abstained, interpret, understood } = await import(
  '../../src/services/venture/interpretation.js');
const { formClaim, observe } = await import('../../src/services/venture/market-evidence.js');

const OWNER = 'eval_reader';

beforeAll(async () => {
  await runMigrations();
  await query('INSERT INTO founders (id,clerk_user_id,email,name) VALUES (?,?,?,?)',
    [OWNER, 'clerk_eval_reader', 'owner@example.com', 'Owner']);
});

defineEval<Input, Outcome>({
  title: 'reading a real signal',
  cases: cases as unknown as Array<{ name: string; input: Input; expected: Outcome; notes?: string }>,
  run: async (input) => {
    reply = typeof input.reply === 'string' ? input.reply
      : input.reply === null ? '' : JSON.stringify(input.reply);
    const claimId = await formClaim({ founderId: OWNER,
      claim: `somebody wrote: "${input.said}"`, evidenceMode: 'real' });
    const observationId = await observe({ founderId: OWNER, claimId,
      sourceType: 'community', source: 'https://news.ycombinator.com/item?id=1',
      saw: input.said, bearing: 'supports', directness: 'direct',
      observedAt: new Date('2026-05-01'), evidenceMode: 'real' });

    const read = await interpret({ founderId: OWNER, observationId, world: 'real' });
    if ('refused' in read) {
      return { outcome: 'refused', hasHypothesis: false, quotedFromSource: false };
    }
    if (abstained(read)) {
      return { outcome: 'abstained', hasHypothesis: false, quotedFromSource: false };
    }
    if (!understood(read)) throw new Error('a reading that is neither');
    // WHAT WAS STORED, not what was returned. The guard lives in the database,
    // so the eval asks the database what it accepted.
    const row = (await query(
      'SELECT motivated_by, hypothesis FROM observation_interpretations WHERE id = ?',
      [read.id])).rows[0] as Record<string, unknown>;
    return {
      outcome: 'understood',
      hasHypothesis: row.hypothesis != null,
      quotedFromSource: input.said.includes(String(row.motivated_by)),
    };
  },
  matcher: (actual, expected, ctx) => {
    expect(actual, `${ctx.name}: ${ctx.notes ?? ''}`).toEqual(expected);
  },
});
