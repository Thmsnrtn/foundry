// =============================================================================
// Tests: having no observation of a thing is not an observation that it is
// absent.
//
// The morning audio brief is spoken to the founder in Foundry's own first
// person. Its fallback segments — the ones used when the model call did not
// return — said:
//
//   "No significant signals detected in the last 24 hours."
//   "Your agents are running and monitoring your business."
//   "No immediate action items require your attention right now."
//
// and the catch that produced them swallowed the error without a word. So the
// single case in which Foundry had observed NOTHING was the case in which it
// told the founder, out loud, that there was nothing to see — and told them
// their agents were working while it did so. The stated window made it worse:
// "in the last 24 hours" is the sound of a search that happened.
//
// Three situations were being described with one set of words. This proves
// each now gets its own, and in particular that the unknown case makes no
// claim about whether anything is there.
// =============================================================================

process.env.TURSO_DATABASE_URL = 'file::memory:';
process.env.ENCRYPTION_KEY = '0'.repeat(64);

import { readFileSync } from 'node:fs';

import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../src/services/ai/client.js', () => ({
  callSonnet: vi.fn(async () => { throw new Error('provider unavailable'); }),
  parseJSONResponse: (t: string) => JSON.parse(t),
}));

import { runMigrations } from '../../src/db/migrate.js';
import { query } from '../../src/db/client.js';
import { generateAudioBriefScript } from '../../src/services/scp/briefing/audio.js';

const OWNER = 'ab_owner';
const P = 'ab_product';

/** Words that assert absence, quiet, or that things are running. Each of these
 *  is a claim about the world that a failed brief has no standing to make. */
const CLAIMS_QUIET = [
  /no significant signals/i,
  /no immediate action items/i,
  /agents are running/i,
  /nothing (?:to report|needs|requires)/i,
  /all (?:clear|good|quiet)/i,
];

/** A company that IS instrumented — so a failure to brief is a failure to
 *  brief, not an absence of anything to say. */
async function seedBriefing(): Promise<void> {
  await query(
    `INSERT INTO scp_briefings (id, product_id, briefing_date, headline, full_briefing,
        signal_score, risk_state, health_score)
     VALUES ('ab_brief', ?, date('now'), 'MRR fell 20% overnight',
        'Revenue dropped sharply against the prior week.', 80, 'red', 40)`, [P]);
}

beforeAll(async () => {
  await runMigrations();
  await query(`INSERT INTO founders (id, clerk_user_id, email) VALUES (?,?,?)`,
    [OWNER, 'clerk_ab', 'ab@test.local']);
});

beforeEach(async () => {
  await query(`DELETE FROM scp_briefings WHERE product_id = ?`, [P]);
  await query(`DELETE FROM products WHERE id = ?`, [P]);
  await query(
    `INSERT INTO products (id, name, owner_id, status, scp_status)
     VALUES (?, 'Brief Co', ?, 'active', 'active')`, [P, OWNER]);
});

describe('a brief that could not be written says so', () => {
  it('claims nothing about signals or action items when the model call failed', async () => {
    // There IS something to brief on — the company is instrumented — and the
    // writing of the brief is what failed. This is the case the old defaults
    // got exactly backwards.
    await seedBriefing();

    const script = await generateAudioBriefScript(P);

    for (const claim of CLAIMS_QUIET) {
      expect(script.full_script,
        `a brief that failed to generate asserted ${String(claim)} to the founder`)
        .not.toMatch(claim);
    }
  });

  it('says plainly that it did not look, rather than that it found nothing', async () => {
    await seedBriefing();

    const script = await generateAudioBriefScript(P);

    expect(script.full_script.toLowerCase())
      .toMatch(/not able to prepare|have not checked|do not know/);
    // And it points somewhere that IS current, rather than leaving the founder
    // with a brief they cannot tell apart from a quiet day.
    expect(script.full_script.toLowerCase()).toContain('dashboard');
  });

  it('distinguishes nothing-connected from nothing-found', async () => {
    // No briefing and no compressed brief: the pipe is empty rather than quiet,
    // and "no signals detected" would describe the wrong thing.
    const script = await generateAudioBriefScript(P);

    expect(script.full_script.toLowerCase())
      .toMatch(/nothing is (?:reporting|connected)|nothing is connected/);
    for (const claim of CLAIMS_QUIET) {
      expect(script.full_script, `an uninstrumented company was told ${String(claim)}`)
        .not.toMatch(claim);
    }
  });

  it('does not spend on a model call when there is nothing to brief on', async () => {
    // §12: the cheap local precondition comes before the paid call, not after
    // it. An empty context block cannot produce a brief, so it must not buy
    // the attempt.
    const { callSonnet } = await import('../../src/services/ai/client.js');
    (callSonnet as unknown as { mockClear: () => void }).mockClear();
    await generateAudioBriefScript(P);
    expect(callSonnet, 'a brief with no inputs bought a model call to say so')
      .not.toHaveBeenCalled();
  });

  it('still returns a playable brief rather than throwing', async () => {
    // The founder gets something honest, not an error page: the segments are
    // all present and the duration is computed from real words.
    const script = await generateAudioBriefScript(P);
    for (const seg of ['intro', 'metrics_segment', 'top_signal_segment',
      'agent_highlight_segment', 'action_items_segment', 'closing'] as const) {
      expect(script[seg].length, `${seg} is empty`).toBeGreaterThan(10);
    }
    expect(script.estimated_duration_seconds).toBeGreaterThan(0);
  });
});

// ── the same collapse, in the documents that leave the building ────────────

describe('an investor is not told "none" by a read that failed', () => {
  it('never initialises an investor-facing section to its own negative claim', () => {
    // These sections were each initialised to "None active." / "No experiments
    // this month." and then wrapped in `catch { /* ok */ }`. A query that threw
    // produced the confident sentence, and the confident sentence went to an
    // investor or a board. The fix is structural — the variable is not
    // pre-loaded with the answer it exists to go and find out — so this reads
    // the initialisers rather than simulating every way a query can fail.
    const NEGATIVE = [
      /let \w+ = '(?:None active\.|No experiments this (?:month|quarter)\.)'/,
      /let \w+ = 'No briefings available[^']*'/,
    ];
    for (const file of [
      'src/services/scp/investor/investor-update.ts',
      'src/services/scp/investor/board-packet.ts',
    ]) {
      const src = readFileSync(file, 'utf8');
      for (const pattern of NEGATIVE) {
        expect(src, `${file} still starts a section at a claim it has not checked`)
          .not.toMatch(pattern);
      }
      // And the claim is still REACHABLE — the point is not to stop saying
      // "none", it is to say it only after looking. A packet that can never
      // report a quiet quarter is as useless as one that always does.
      expect(src, `${file} must still be able to report a genuinely empty period`)
        .toMatch(/= 'None active\.'|= 'No experiments this (?:month|quarter)\.'/);
    }
  });

  it('says a read failed rather than that there was nothing to read', () => {
    for (const file of [
      'src/services/scp/investor/investor-update.ts',
      'src/services/scp/investor/board-packet.ts',
    ]) {
      const src = readFileSync(file, 'utf8');
      expect(src, `${file} has no wording for an unreadable source`)
        .toMatch(/could not be read/);
    }
  });
});
