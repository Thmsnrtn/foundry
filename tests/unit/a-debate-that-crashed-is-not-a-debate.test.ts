process.env.TURSO_DATABASE_URL = 'file::memory:';
process.env.ENCRYPTION_KEY = '0'.repeat(64);

import { beforeAll, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { query } from '../../src/db/client.js';
import { runMigrations } from '../../src/db/migrate.js';

// =============================================================================
// A DEBATE THAT CRASHED IS NOT A DEBATE.
//
// Two defects in the agent debate, one structural and one a single word.
//
// THE WORD. When runDebateForProduct threw, its catch block wrote
// `status = 'complete'`. The debate dashboard paints 'complete' as a green
// "Complete" badge, and the list view puts it beside a conflict count that a
// crashed run leaves at zero. So these two rows were identical on screen:
//
//   2026-08-21  [Complete]  —          the agents debated and agreed
//   2026-08-21  [Complete]  —          the debate threw before synthesis
//
// The failure text did exist — "Debate synthesis failed." — but it was rendered
// as the executive summary, inside the card headed "Unified Synthesis", in the
// green success styling, at the largest body size on the page.
//
// The synthesizer had a second route to the same place: on a JSON parse failure
// it returned a well-formed SynthesisOutput with an apologetic sentence and zero
// conflicts, and never threw at all — so the catch block was not even involved,
// and the orchestrator went on to paste that sentence into the founder's daily
// briefing under "[AGENT SYNTHESIS]".
//
// `failure_reason` now travels with the synthesis, the session ends 'failed',
// and a failed run does not touch the briefing.
//
// THE STRUCTURE. `agent_positions` held a second copy of every assertion and
// every challenge; `debate_sessions.positions_json` and `conflicts_json` hold
// the copy that is read. The shadow was also malformed — the challenger inserted
// a NEW row carrying the challenged assertion rather than marking the original,
// so a challenged assertion appeared twice, once reading as unchallenged, and
// the `challenged_by` / `challenge_response` columns the schema was built around
// were never populated on the row they described. A copy nobody reads cannot be
// found to be wrong; this one was wrong the whole time.
// =============================================================================

beforeAll(async () => { await runMigrations(); });

const ORCH = readFileSync('src/services/scp/debate/orchestrator.ts', 'utf8');
const SYNTH = readFileSync('src/services/scp/agents/synthesizer.ts', 'utf8');
const PAGE = readFileSync('src/routes/dashboard/agents-debate.ts', 'utf8');

describe('a crashed debate is not marked complete', () => {
  it('the catch block records failure', () => {
    const cat = ORCH.slice(ORCH.indexOf('} catch (err) {'));
    expect(cat).toMatch(/SET status = 'failed'/);
    expect(cat, 'the old value must not survive anywhere in the failure path')
      .not.toMatch(/status = 'complete'/);
  });

  it('a synthesis that failed to parse ends the session failed too', () => {
    expect(ORCH).toMatch(/synthesis\.failure_reason \? 'failed' : 'complete'/);
  });

  it('a failed run does not reach the daily briefing', () => {
    expect(ORCH).toMatch(/if \(synthesis\.failure_reason === null\) \{\s*await _upsertSynthesisIntoBriefing/);
  });

  it("'failed' is a status the type admits", () => {
    expect(ORCH).toMatch(/'pending' \| 'running' \| 'complete' \| 'failed'/);
  });
});

describe('the synthesizer says when it did not synthesize', () => {
  it('reports a parse failure instead of returning a sentence as the summary', () => {
    expect(SYNTH).toMatch(/could not be parsed, so no synthesis was produced/);
    expect(SYNTH, 'the apologetic summary was the defect')
      .not.toMatch(/encountered a parsing error/);
  });

  it('treats an empty executive summary as a failure, not a synthesis', () => {
    expect(SYNTH).toMatch(/returned no executive summary/);
    expect(SYNTH, 'the empty string used to become an empty green card')
      .not.toMatch(/executiveSummary: parsed\.executive_summary/);
  });

  it('a real synthesis carries failure_reason: null', () => {
    expect(SYNTH).toMatch(/failure_reason: null,/);
  });
});

describe('the page shows the difference', () => {
  it('has a Failed badge', () => {
    expect(PAGE).toMatch(/status === 'failed'/);
    expect(PAGE).toMatch(/>Failed</);
  });

  it('does not render a failure inside the green synthesis card', () => {
    const idx = PAGE.indexOf('const synthesisSection');
    expect(PAGE.slice(idx, idx + 900)).toMatch(/synthesis\?\.failure_reason \? html/);
    expect(PAGE).toMatch(/This Debate Did Not Finish/);
  });

  it('does not show a failed run as having zero conflicts', () => {
    // "—" and "0 conflicts" both read as "they agreed". A run that never got
    // there says so.
    expect(PAGE).toMatch(/not reached/);
  });
});

describe('one copy of the positions', () => {
  it('has retired the shadow table', async () => {
    const rows = await query(
      "SELECT name FROM sqlite_master WHERE type='table' AND name='agent_positions'");
    expect(rows.rows.length).toBe(0);
  });

  it('has no writer left', () => {
    const chal = readFileSync('src/services/scp/agents/challenger.ts', 'utf8');
    expect(ORCH).not.toMatch(/INSERT INTO agent_positions/);
    expect(chal).not.toMatch(/INSERT INTO agent_positions/);
  });

  it('kept the copy the dashboard reads', () => {
    expect(ORCH).toMatch(/SET positions_json = \?, confidence_weights_json = \?/);
    expect(ORCH).toMatch(/SET conflicts_json = \?/);
  });

  it('left the baseline shorter', () => {
    expect(readFileSync('docs/db/unread-tables-baseline.txt', 'utf8'))
      .not.toMatch(/agent_positions/);
  });
});

describe('the migration backfills the sessions already mislabelled', () => {
  it('turns a stored crash into a failure', async () => {
    // A row exactly as the old catch block wrote it.
    await query(
      `INSERT INTO debate_sessions (id, product_id, briefing_date, status, synthesis_json)
       VALUES ('ds_old', 'p_old', '2026-01-01', 'complete', ?)`,
      [JSON.stringify({
        error: 'boom', executiveSummary: 'Debate synthesis failed.',
        keyConflicts: [], confidenceWeightedRecommendations: [], dissenting_view: null,
      })]);

    const mig = readFileSync(
      'src/db/migrations/186_a_debate_that_crashed_is_not_a_debate.sql', 'utf8');
    const update = mig.slice(mig.indexOf('UPDATE debate_sessions'));
    await query(update.replace(/;[\s\S]*$/, ''));

    const row = (await query("SELECT status FROM debate_sessions WHERE id='ds_old'"))
      .rows[0] as Record<string, unknown>;
    expect(row.status).toBe('failed');
    await query("DELETE FROM debate_sessions WHERE id='ds_old'");
  });

  it('leaves a genuine debate alone', async () => {
    await query(
      `INSERT INTO debate_sessions (id, product_id, briefing_date, status, synthesis_json)
       VALUES ('ds_good', 'p_old', '2026-01-02', 'complete', ?)`,
      [JSON.stringify({
        executiveSummary: 'Pricing and retention agree; ship the change.',
        keyConflicts: [], confidenceWeightedRecommendations: [], dissenting_view: null,
        failure_reason: null,
      })]);

    const mig = readFileSync(
      'src/db/migrations/186_a_debate_that_crashed_is_not_a_debate.sql', 'utf8');
    const update = mig.slice(mig.indexOf('UPDATE debate_sessions'));
    await query(update.replace(/;[\s\S]*$/, ''));

    const row = (await query("SELECT status FROM debate_sessions WHERE id='ds_good'"))
      .rows[0] as Record<string, unknown>;
    expect(row.status).toBe('complete');
    await query("DELETE FROM debate_sessions WHERE id='ds_good'");
  });
});
