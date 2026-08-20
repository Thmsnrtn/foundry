process.env.TURSO_DATABASE_URL = 'file::memory:';
process.env.ENCRYPTION_KEY = '0'.repeat(64);

import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

// The model is stubbed because every assertion here is about what happens when
// the reading does NOT produce a result. `behaviour` is switched per test.
let behaviour: 'ok' | 'throw' | 'garbage' = 'ok';
vi.mock('../../src/services/ai/client.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../src/services/ai/client.js')>()),
  callSonnet: async () => {
    if (behaviour === 'throw') throw new Error('provider unreachable');
    if (behaviour === 'garbage') return { content: 'not json at all', model: 'stub', usage: { input_tokens: 0, output_tokens: 0 }, stop_reason: null };
    return {
      content: JSON.stringify({
        sentiment: 0.4, keyTopics: ['pricing'], competitorMentions: [],
        objections: [], commitments: ['send the quote'], summary: 'A call happened.',
      }),
      model: 'stub', usage: { input_tokens: 0, output_tokens: 0 }, stop_reason: null,
    };
  },
}));

import { runMigrations } from '../../src/db/migrate.js';
import { query } from '../../src/db/client.js';
import { analyzeTranscript, ANALYSIS_FAILURE_LABELS } from '../../src/services/integrations/transcripts.js';

// =============================================================================
// A FAILURE THAT LOOKED EXACTLY LIKE A CALM STATE.
//
// `analyzeTranscript` ended in `console.error`, and all three of its live
// callers — the Fathom webhook, the Fireflies webhook, and the manual upload
// page — wrap it in `.catch(() => {})`. Swallowed twice, into a line nobody
// reads.
//
// The consequence is not a missing log. `processed_at IS NULL` meant BOTH
// "not analysed yet" AND "analysed and failed", and nothing could tell them
// apart. A founder opened a call, saw no summary and no insights, and there was
// no state in which Foundry said it had tried. The same shape as a credential
// that authenticates and has every request discarded, and as a support channel
// whose drops looked like a quiet inbox.
//
// It costs money to get there, too: `callSonnet` reserves against the AI
// ceilings before dispatch, so a call that succeeded and then failed to parse
// has been paid for and left nothing behind.
// =============================================================================

const P = 'tfa_product';
const OWNER = 'tfa_owner';

const transcript = async (id: string, text: string | null) => {
  await query('DELETE FROM call_transcripts WHERE id = ?', [id]);
  await query(
    `INSERT INTO call_transcripts (id, product_id, source, call_type, transcript_text, call_date)
     VALUES (?, ?, 'fathom', 'customer', ?, date('now'))`,
    [id, P, text],
  );
};

const state = async (id: string) => (await query(
  `SELECT processed_at, analysis_failed_at, analysis_failure_reason, summary
     FROM call_transcripts WHERE id = ?`, [id],
)).rows[0] as Record<string, unknown>;

beforeAll(async () => {
  await runMigrations();
  await query('PRAGMA foreign_keys=OFF', []);
  await query(`INSERT INTO founders (id,clerk_user_id,email) VALUES (?,'tfa_c','o@example.com')`, [OWNER]);
  await query(`INSERT INTO products (id,name,owner_id,status) VALUES (?,'Callco',?,'active')`, [P, OWNER]);
});

beforeEach(() => { behaviour = 'ok'; });

describe('a call whose reading did not finish', () => {
  it('says the transcript was empty, rather than returning in silence', async () => {
    await transcript('t_empty', null);
    await analyzeTranscript('t_empty');
    const s = await state('t_empty');
    expect(s.analysis_failure_reason).toBe('transcript_empty');
    expect(s.analysis_failed_at).toBeTruthy();
    expect(s.processed_at, 'and is not marked analysed').toBeFalsy();
  });

  it('says the model could not be reached', async () => {
    behaviour = 'throw';
    await transcript('t_down', 'We talked about pricing.');
    await analyzeTranscript('t_down');
    expect((await state('t_down')).analysis_failure_reason).toBe('model_unavailable');
  });

  it('says the answer came back unreadable — after the spend was already made', async () => {
    behaviour = 'garbage';
    await transcript('t_junk', 'We talked about pricing.');
    await analyzeTranscript('t_junk');
    expect((await state('t_junk')).analysis_failure_reason).toBe('response_unparseable');
  });

  it('is distinguishable from a call nobody has read yet', async () => {
    await transcript('t_new', 'We talked about pricing.');
    const before = await state('t_new');
    expect(before.processed_at, 'not analysed yet').toBeFalsy();
    expect(before.analysis_failed_at, 'and not failed either — the two are now different states')
      .toBeFalsy();
  });
});

describe('a retry that works', () => {
  it('clears the earlier failure rather than leaving both true', async () => {
    behaviour = 'throw';
    await transcript('t_retry', 'We talked about pricing.');
    await analyzeTranscript('t_retry');
    expect((await state('t_retry')).analysis_failure_reason).toBe('model_unavailable');

    behaviour = 'ok';
    await analyzeTranscript('t_retry');
    const after = await state('t_retry');
    expect(after.processed_at).toBeTruthy();
    expect(after.analysis_failed_at, 'the row cannot be both').toBeFalsy();
    expect(after.analysis_failure_reason).toBeFalsy();
    expect(String(after.summary)).toContain('A call happened');
  });
});

describe('the database refuses an incoherent record', () => {
  it('will not hold a call that is both analysed and failed', async () => {
    await transcript('t_both', 'text');
    await query(`UPDATE call_transcripts SET processed_at = datetime('now') WHERE id = 't_both'`);
    await expect(query(
      `UPDATE call_transcripts SET analysis_failed_at = datetime('now'),
              analysis_failure_reason = 'model_unavailable' WHERE id = 't_both'`,
    )).rejects.toThrow(/analysed_and_failed/);
  });

  it('will not hold a failure with no reason', async () => {
    await transcript('t_bare', 'text');
    await expect(query(
      `UPDATE call_transcripts SET analysis_failed_at = datetime('now') WHERE id = 't_bare'`,
    )).rejects.toThrow(/failure_incomplete/);
  });

  it('will not hold a reason outside the closed set', async () => {
    // The reason is a SHAPE this system owns. A raw error string could quote
    // the transcript, which is a customer speaking.
    await transcript('t_free', 'text');
    await expect(query(
      `UPDATE call_transcripts SET analysis_failed_at = datetime('now'),
              analysis_failure_reason = 'Error: the customer said ...' WHERE id = 't_free'`,
    )).rejects.toThrow();
  });
});

describe('what the founder is told', () => {
  it('has a sentence for every reason the database accepts', () => {
    // A reason with no label renders as a bare enum on the page.
    for (const [reason, label] of Object.entries(ANALYSIS_FAILURE_LABELS)) {
      expect(label.length, `${reason} reads as English`).toBeGreaterThan(20);
      expect(label, 'and is not the enum').not.toBe(reason);
    }
  });
});
