process.env.TURSO_DATABASE_URL = 'file::memory:';
process.env.ENCRYPTION_KEY = '0'.repeat(64);

import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { stripComments } from '../../scripts/lib/strip-comments.mjs';
import { runMigrations } from '../../src/db/migrate.js';
import { query } from '../../src/db/client.js';

/** What the judge does when called. Set per test. */
const judge: { answer: () => Promise<{ content: string; tokensUsed: number; costUsd: number }> } = {
  answer: async () => ({ content: '{}', tokensUsed: 1, costUsd: 0 }),
};
vi.mock('../../src/services/ai/client.js', async (orig) => ({
  ...(await orig<Record<string, unknown>>()),
  callSonnet: vi.fn(async () => judge.answer()),
}));

const { scoreArtifactAgainstVoice } = await import('../../src/services/calibration/voice-fingerprint.js');
const { voiceGateDraft } = await import('../../src/services/calibration/voice-gate.js');

// =============================================================================
// A JUDGE THAT DID NOT ANSWER IS NOT A PASS.
//
// `scoreArtifactAgainstVoice` answered an unreachable judge with
// `score: threshold, in_voice: true` and all four dimension matches set to the
// threshold — a complete passing verdict, invented, with a rationale string as
// its only trace. The gate above it read that as 'pass', and 'pass' is what
// leaves `auto_executable` set on a customer-facing draft. So the outage of the
// judge shipped the artifact the judge exists to hold back.
//
// The neighbouring failure did the opposite: an unparseable answer became 50,
// which lands under the block band. Two failures of the same kind — no answer
// from the judge — treated oppositely, and the permissive one is the one that
// reaches a customer.
//
// Both now say what happened: a null score, a null breakdown, and a gate
// verdict of 'unscored' that withholds auto-execution rather than granting it
// on a judgment that never took place.
// =============================================================================

const P = 'p_voice';

beforeAll(async () => {
  await runMigrations();
  await query("INSERT INTO founders (id, clerk_user_id, email) VALUES ('f_v','c_v','v@example.com')");
  await query("INSERT INTO products (id, name, owner_id, status) VALUES (?,'Acme','f_v','active')", [P]);
});

beforeEach(async () => {
  await query('DELETE FROM product_voice_fingerprints');
  await query(
    `INSERT INTO product_voice_fingerprints
       (id, product_id, version, status, sentence_rhythm, lexical_preferences, banned_words,
        register, energy, pov, anti_exemplars, exemplar_sentences, source)
     VALUES ('vf_1', ?, 1, 'active', 'short_punchy', '[]', '[]',
             'plainspoken', 'measured', 'we', '[]', ?, 'founder')`,
    [P, JSON.stringify(['We shipped it.', 'It works now.', 'Here is what changed.',
                        'No surprises.', 'That is the whole update.'])]);
});

describe('when the judge cannot be reached', () => {
  it('reports no score rather than a passing one', async () => {
    judge.answer = async () => { throw new Error('upstream 503'); };

    const result = await scoreArtifactAgainstVoice(P, 'A clean draft.');
    expect(result).not.toBeNull();
    expect(result?.score).toBeNull();
    expect(result?.in_voice).toBeNull();
    expect(result?.breakdown).toBeNull();
    expect(result?.rationale).toContain('unavailable');
  });

  it('does not invent four dimension matches', async () => {
    judge.answer = async () => { throw new Error('upstream 503'); };

    const result = await scoreArtifactAgainstVoice(P, 'A clean draft.');
    // The old shape set every dimension to the threshold, which reads
    // downstream exactly like four numbers the judge actually gave.
    expect(result?.breakdown).toBeNull();
  });
});

describe('when the judge answers with something unreadable', () => {
  it('reports no score rather than 50', async () => {
    judge.answer = async () => ({ content: 'I am unable to assist with that.', tokensUsed: 1, costUsd: 0 });

    const result = await scoreArtifactAgainstVoice(P, 'A clean draft.');
    expect(result?.score).toBeNull();
    expect(result?.breakdown).toBeNull();
  });

  it('still reads a real answer', async () => {
    judge.answer = async () => ({
      content: '{"score":82,"register":80,"rhythm":84,"lexical":80,"energy":84,"rationale":"in voice"}',
      tokensUsed: 1, costUsd: 0,
    });

    const result = await scoreArtifactAgainstVoice(P, 'A clean draft.');
    expect(result?.score).toBe(82);
    expect(result?.in_voice).toBe(true);
    expect(result?.breakdown?.register_match).toBe(80);
  });
});

describe('the gate', () => {
  it('returns unscored, not pass, when nothing was measured', async () => {
    judge.answer = async () => { throw new Error('upstream 503'); };

    const verdict = await voiceGateDraft(P, {
      artifact_type: 'churn_rescue_email',
      draft_content: 'Hello there.',
    });
    expect(verdict.verdict).toBe('unscored');
    expect(verdict.score).toBeNull();
  });

  it('asks for review rather than telling the caller to ignore it', async () => {
    judge.answer = async () => { throw new Error('upstream 503'); };

    const verdict = await voiceGateDraft(P, {
      artifact_type: 'churn_rescue_email',
      draft_content: 'Hello there.',
    });
    expect(verdict.suggested_action).toBe('review');
  });

  it('still passes a draft the judge actually scored', async () => {
    judge.answer = async () => ({
      content: '{"score":90,"register":90,"rhythm":90,"lexical":90,"energy":90,"rationale":"yes"}',
      tokensUsed: 1, costUsd: 0,
    });

    const verdict = await voiceGateDraft(P, {
      artifact_type: 'churn_rescue_email',
      draft_content: 'Hello there.',
    });
    expect(verdict.verdict).toBe('pass');
  });
});

describe('the draft that would have shipped', () => {
  it('loses auto-execution when the voice check did not run', async () => {
    const src = stripComments(readFileSync('src/services/decisions/actions.ts', 'utf8'), { lineComments: true });
    // The permission was conditioned on a check; the check did not happen.
    expect(src).toMatch(/verdict\.verdict === 'unscored'/);
    const branch = src.slice(src.indexOf("verdict.verdict === 'unscored'"));
    expect(branch.slice(0, 200)).toContain('auto_executable = false');
  });
});
