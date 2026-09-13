process.env.TURSO_DATABASE_URL = 'file::memory:';
process.env.ENCRYPTION_KEY = '0'.repeat(64);

import { beforeAll, describe, expect, it } from 'vitest';

import { runMigrations } from '../../src/db/migrate.js';
import { query } from '../../src/db/client.js';

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
// THE READER IS GONE; THE RECORD IS NOT. `integrations/transcripts.ts` was
// deleted as production-dead — its three callers had gone before it — so the
// cases that drove `analyzeTranscript` through each failure, and the one that
// held `ANALYSIS_FAILURE_LABELS` to a sentence per reason, went with it.
//
// What survives is the half of the fix that is in the DATABASE, and it is the
// half that matters if a reader is ever written again: `call_transcripts`
// refuses to hold a row that is both analysed and failed, refuses a failure
// with no reason, and refuses a reason outside the closed set. That last one is
// not tidiness — a raw error string could quote the transcript, which is a
// customer speaking. A new reader inherits those three refusals whether or not
// it remembers this file.
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

beforeAll(async () => {
  await runMigrations();
  await query('PRAGMA foreign_keys=OFF', []);
  await query(`INSERT INTO founders (id,clerk_user_id,email) VALUES (?,'tfa_c','o@example.com')`, [OWNER]);
  await query(`INSERT INTO products (id,name,owner_id,status) VALUES (?,'Callco',?,'active')`, [P, OWNER]);
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
