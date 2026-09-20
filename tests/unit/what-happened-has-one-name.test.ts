// =============================================================================
// WHAT HAPPENED HAS ONE NAME.
//
// One settled test read "Stopped by its own rule" on its page, "Stopped" in
// History, "settled against its prediction" on Activity, "not what I expected"
// in the letter, "It did not hold" in the Ask answer and "The world said:
// surprised" — the raw column — on the next-test page. A reviewer sent
// through the pages as a person asked which was true. This proves one word,
// one reason, on every surface, from one reader; that the raw enum reaches no
// page; that a test he stopped and a test its search closed keep their own
// words; and that 'partly' — the grade the column cannot hold — reaches him.
// =============================================================================
process.env.TURSO_DATABASE_URL = 'file::memory:';
process.env.NODE_ENV = 'test';
process.env.FOUNDRY_INSTANCE_POSTURE = 'private_owner';
process.env.FOUNDRY_OWNER_EMAIL = 'owner@example.com';
process.env.ENCRYPTION_KEY = process.env.ENCRYPTION_KEY ?? '0'.repeat(64);

import { beforeAll, describe, expect, it } from 'vitest';
import { query } from '../../src/db/client.js';
import { OWNER, asText, owner, ownerApp, seedProductionShape } from '../helpers/world.js';
import { outcomeFromRow, outcomeOf } from '../../src/services/founder/what-happened.js';

let app: Awaited<ReturnType<typeof ownerApp>>;
let me: ReturnType<typeof owner>;
let X: string;
const RAW = /\b(as_predicted|The world said|settled against its prediction|Stopped by its own rule|not what I expected|It did not hold)\b/;

beforeAll(async () => {
  ({ experimentId: X } = await seedProductionShape({}));
  const { markVisit } = await import('../../src/services/founder/what-changed.js');
  await markVisit(OWNER);
  app = await ownerApp();
  me = owner(app);
});

describe('one settled test, one word, one reason', () => {
  it('the reader says surprised, with the settlement\'s own reason and what it does and does not establish', async () => {
    const o = (await outcomeOf(X))!;
    expect(o.word).toBe('surprised');
    expect(o.label).toBe('Surprised');
    expect(o.settled).toBe(true);
    expect(o.reason).toContain('nobody bought within the seven days');
    expect(o.establishes).toContain('did not sell');
    expect(o.doesNotEstablish).toContain('the category is worthless');
  });

  it('the experiment page carries the word, the reason and "What happened and why"', async () => {
    const t = asText(await me.page(`/foundry/experiments/${X}`));
    expect(t).toContain('Surprised');
    expect(t).toContain('What happened and why');
    expect(t).toContain('The prediction did not hold.');
    expect(t).toContain('nobody bought within the seven days');
    expect(t).toContain('What that establishes');
    expect(t).not.toMatch(RAW);
  });

  it('Experiments (Recently finished), History, Activity, the letter, Home and the next-test page say the same word', async () => {
    const index = asText(await me.page('/foundry/experiments'));
    expect(index).toContain('Surprised');
    expect(index).toContain('nobody bought within the seven days');
    const history = asText(await me.page('/foundry/experiments/history'));
    expect(history).toContain('Surprised');
    expect(history).toContain('nobody bought within the seven days');
    const activity = asText(await me.page('/foundry/activity?kind=experiment'));
    expect(activity).toContain('Experiment settled surprised');
    const { whileYouWereAway } = await import('../../src/services/founder/a-week-away.js');
    const letter = await whileYouWereAway(OWNER, 7);
    expect(letter.outcomes.some((o) => /settled surprised on \d{4}-\d{2}-\d{2}: nobody bought/.test(o))).toBe(true);
    expect(letter.learned.some((o) => /settled surprised: The prediction did not hold; it establishes that this offer/.test(o))).toBe(true);
    const home = asText(await me.page('/foundry'));
    expect(home).toContain('Last test');
    expect(home).toContain('Surprised');
    const next = asText(await me.page('/foundry/experiments/next'));
    expect(next).toContain('Settled surprised: The prediction did not hold.');
    for (const page of [index, history, activity, home, next]) expect(page).not.toMatch(RAW);
    for (const line of [...letter.outcomes, ...letter.learned]) expect(line).not.toMatch(RAW);
  });

  it('"why did it fail" answers with the same word and both halves of what it establishes', async () => {
    const t = asText(await me.answer('Why did the last test fail?'));
    expect(t).toContain('Surprised.');
    expect(t).toContain('The prediction did not hold.');
    expect(t).toContain('What that establishes');
    expect(t).toContain('What it does not');
    expect(t).not.toMatch(RAW);
  });

  it('the candidate\'s "why" page uses the word, not the column', async () => {
    const o = (await query('SELECT opportunity_id FROM venture_experiments WHERE id = ?', [X])).rows[0] as Record<string, unknown>;
    const t = asText(await me.page(`/foundry/why/candidate/${String(o.opportunity_id)}`));
    expect(t).toContain('settled surprised');
    expect(t).not.toMatch(RAW);
  });
});

describe('the words that are not the world\'s', () => {
  it('a test he stopped is "stopped by you", with his reason; one its search closed is "closed with its search"', () => {
    const his = outcomeFromRow({ decision: 'approved', validity: 'valid', retired_at: '2026-09-01 08:00:00', retired_because: 'you stopped it: wrong week for it' });
    expect(his.word).toBe('stopped by you');
    expect(his.reason).toBe('wrong week for it');
    expect(his.settled).toBe(false);
    const search = outcomeFromRow({ validity: 'valid', retired_at: '2026-09-01 08:00:00', retired_because: 'its search was closed before it was decided' });
    expect(search.word).toBe('closed with its search');
    expect(search.concluded).toBe(true);
    const declined = outcomeFromRow({ decision: 'declined', validity: 'valid', decided_at: '2026-09-01 08:00:00' });
    expect(declined.word).toBe('declined');
    const running = outcomeFromRow({ decision: 'approved', validity: 'valid' });
    expect(running.word).toBe('running');
    expect(running.concluded).toBe(false);
    const proposed = outcomeFromRow({ validity: 'valid' });
    expect(proposed.word).toBe('proposed');
  });

  it('"partly" — some paid, fewer than the rule asked — is read from the grade the column cannot hold', () => {
    const o = outcomeFromRow({ decision: 'approved', validity: 'valid', ran_at: '2026-09-10 06:35:00', verdict: 'surprised', grade: 'partly',
      what_happened: '1 payment that counted within 7 days; the rule asked for at least 2. Partly: some, fewer than predicted.', cannot_prove: 'that it sells without the founder\'s name' });
    expect(o.word).toBe('partly');
    expect(o.label).toBe('Partly');
    expect(o.meaning).toContain('fewer than the rule asked for');
    expect(o.establishes).toContain('some people paid');
    expect(o.doesNotEstablish).toContain('It could not establish: that it sells without the founder\'s name');
    // The column's own word stands when there is no grade.
    expect(outcomeFromRow({ decision: 'approved', validity: 'valid', ran_at: '2026-09-10', verdict: 'as_predicted' }).word).toBe('as predicted');
  });

  it('the grade the world writes beside a settled test is what the reader reads', async () => {
    const { resolvePrediction } = await import('../../src/services/institution/calibration.js');
    const e = (await query('SELECT decided_at FROM venture_experiments WHERE id = ?', [X])).rows[0] as Record<string, unknown>;
    const already = (await query(`SELECT verdict FROM prediction_resolutions WHERE kind = 'venture_experiment' AND prediction_id = ?`, [X])).rows[0] as Record<string, unknown> | undefined;
    if (!already) {
      const r = await resolvePrediction({ founderId: OWNER, kind: 'venture_experiment', predictionId: X, resolvedBy: 'business_outcome',
        evidenceRef: 'experiment_exposure:test', verdict: 'partly', because: 'one paid; the rule asked for two', predictedAt: String(e.decided_at) });
      expect('id' in r).toBe(true);
      expect((await outcomeOf(X))!.word).toBe('partly');
    } else {
      // The world graded it when it settled; the reader and the grade agree.
      const o = (await outcomeOf(X))!;
      expect(o.word).toBe(String(already.verdict) === 'partly' ? 'partly' : String(already.verdict) === 'as_predicted' ? 'as predicted' : 'surprised');
    }
  });
});
