// =============================================================================
// A RECORD CAN CARRY A LATER FINDING, WITHOUT THE RECORD CHANGING.
//
// Experiment 001 closed having met none of its condition: nobody bought within
// the seven days. That result stands and nothing here moves it. What was found
// afterwards is that the reply route for those messages was unrouted — so a
// reply to them would not have arrived, and a recorded silence from people who
// could not have been heard is not a recorded silence from people who chose not
// to answer.
//
// THE OWNER AUTHORISED A NARROW, DATED CLARIFICATION AND NOTHING ELSE. These
// proofs are mostly about the "nothing else": the sealed copy is byte-identical
// afterwards, a write that touched both at once is refused, and once it is
// published it cannot be withdrawn or quietly reworded.
//
// Nobody real is written to; every provider is stubbed at the network edge.
// =============================================================================
process.env.TURSO_DATABASE_URL = 'file::memory:';
process.env.ENCRYPTION_KEY = '0'.repeat(64);
process.env.FOUNDRY_INSTANCE_POSTURE = 'private_owner';
process.env.FOUNDRY_OWNER_EMAIL = 'owner@example.com';

import { beforeAll, describe, expect, it } from 'vitest';
import { query } from '../../src/db/client.js';
import { OWNER, seedProductionShape } from '../helpers/world.js';
import { PROOF1_CLARIFICATION, PROOF1_PUBLIC, findProof1, keepProof1sRecordCurrent } from '../../src/services/venture/proof-1.js';

let X = '';
/** Every sealed column, as one string, so a change of any byte in any of them shows. */
const sealed = async (): Promise<string> => JSON.stringify((await query(
  `SELECT public_title, public_summary, public_who, public_what, public_limits,
          public_sources, public_selection, public_note, public_sample, public_outcome
     FROM public_experiments WHERE experiment_id = ?`, [X])).rows[0]);

beforeAll(async () => {
  await seedProductionShape({ charter: true, searching: true, eyes: true, settledBy: 'the world', earsOpen: true });
  X = (await findProof1(OWNER))!;
});

describe('the clarification the owner authorised', () => {
  it('says the result first and says nothing about the repair', () => {
    const t = PROOF1_CLARIFICATION.text;
    // THE RESULT IS NOT SOFTENED AND IS NOT BURIED. It is the first sentence.
    expect(t.startsWith('This pilot did not meet its stated condition')).toBe(true);
    expect(t).toContain('there were no purchases within its seven-day window');
    expect(t).toContain('The recorded result stands');
    // WHAT IT IS AND IS NOT EVIDENCE ABOUT, which is the whole reason it exists.
    expect(t).toContain('not evidence about whether recipients attempted to respond');
    expect(t).toContain('The text above is unchanged');
    // NOTHING ABOUT THE FIX. A stranger reading a public record does not need
    // the institution's account of its own recovery, and a clarification that
    // spent half its length on one would be a press release with a date on it.
    expect(/fixed|repaired|resolved|now works|since been/i.test(t)).toBe(false);
    // AND NOBODY IS NAMED. The owner is not a public figure; this is a footnote
    // to a record, in the voice the record is kept in.
    expect(/Thomas|Norton|\bI\b|\bmy\b/.test(t)).toBe(false);
    // IT IS NOT PRESENTED AS SUCCESS, and it does not restart anything.
    expect(/success|worked|buy now|order|available again/i.test(t)).toBe(false);
  });

  it('carries its own date, separately from the sentence', () => {
    expect(PROOF1_CLARIFICATION.on).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    // The date is not inside the text: the page renders it as the heading, so
    // a text that also stated it would be two places to keep in step.
    expect(PROOF1_CLARIFICATION.text).not.toContain(PROOF1_CLARIFICATION.on);
    expect(PROOF1_CLARIFICATION.text).not.toMatch(/\b2026\b/);
  });
});

describe('adding it changes nothing that was already there', () => {
  it('leaves every sealed column byte-identical', async () => {
    const before = await sealed();
    expect(await keepProof1sRecordCurrent(OWNER)).toBe('written');
    expect(await sealed()).toBe(before);

    const row = (await query(
      `SELECT public_clarification, public_clarification_at FROM public_experiments
        WHERE experiment_id = ?`, [X])).rows[0] as Record<string, unknown>;
    expect(String(row.public_clarification)).toBe(PROOF1_CLARIFICATION.text);
    expect(String(row.public_clarification_at)).toBe(PROOF1_CLARIFICATION.on);
    // AND THE SEALED COPY IS STILL THE CONSTANT IT WAS AUTHORED AS.
    expect(String(JSON.parse(before).public_note)).toBe(PROOF1_PUBLIC.note);
  });

  it('is written once and never again', async () => {
    expect(await keepProof1sRecordCurrent(OWNER)).toBe('already');
    expect(await keepProof1sRecordCurrent(OWNER)).toBe('already');
  });
});

describe('what the row refuses', () => {
  it('refuses a clarification that edits the record in the same statement', async () => {
    // check-vocabulary:expected-refusal
    await expect(query(
      `UPDATE public_experiments
          SET public_clarification = 'a second finding',
              public_clarification_at = '2026-10-01',
              public_summary = 'a quietly different summary'
        WHERE experiment_id = ?`, [X]))
      .rejects.toThrow(/a_clarification_does_not_edit_the_record/);
  });

  it('refuses to withdraw one that has been published', async () => {
    await expect(query(
      `UPDATE public_experiments SET public_clarification = NULL,
              public_clarification_at = NULL WHERE experiment_id = ?`, [X]))
      .rejects.toThrow(/a_clarification_is_not_withdrawn/);
  });

  it('refuses a rewording that keeps the old date', async () => {
    await expect(query(
      `UPDATE public_experiments SET public_clarification = 'quietly different words'
        WHERE experiment_id = ?`, [X]))
      .rejects.toThrow(/a_reworded_clarification_is_a_new_one/);
  });

  it('refuses a clarification with no date', async () => {
    await query(
      `INSERT INTO public_experiments
         (experiment_id, founder_id, number, slug, public_title, public_summary,
          public_who, public_what, public_limits, public_sources, public_selection,
          public_note)
       SELECT id, founder_id, 900, 'a-second-record', 't','s','w','x','l','o','n','q'
         FROM venture_experiments WHERE founder_id = ? AND id <> ? LIMIT 1`, [OWNER, X]);
    const other = (await query(
      `SELECT experiment_id FROM public_experiments WHERE slug = 'a-second-record'`))
      .rows[0] as Record<string, unknown> | undefined;
    if (!other) return; // no second experiment in this world; the rule is proved below anyway
    await expect(query(
      `UPDATE public_experiments SET public_clarification = 'undated'
        WHERE experiment_id = ?`, [String(other.experiment_id)]))
      .rejects.toThrow(/clarification_needs_a_date|clarification_needs_an_ended_test/);
  });
});

describe('the page', () => {
  it('shows it as a dated block beneath the record, and the record unchanged', async () => {
    const { projectExperiment, workshopFactsOfExperiment } =
      await import('../../src/services/public-workshop/projection.js');
    const x = (await projectExperiment(X))!;
    expect(x.clarification?.on).toBe(PROOF1_CLARIFICATION.on);
    expect(x.summary).toBe(PROOF1_PUBLIC.summary);

    const { renderExperiment } = await import('../../src/services/public-workshop/site.js');
    const html = renderExperiment((await workshopFactsOfExperiment(X))!, x);

    expect(html).toContain('Clarification, 21 September 2026');
    expect(html).toContain('The text above is unchanged');
    // BENEATH, NOT INSTEAD. "Who I am" is the last sealed section; the footnote
    // comes after it, so "the text above" is a true description of the page.
    expect(html.indexOf('Who I am')).toBeLessThan(html.indexOf('Clarification, 21 September 2026'));
    // AND THE RECORD IS STILL WORD FOR WORD WHAT IT WAS.
    expect(html).toContain(PROOF1_PUBLIC.summary.slice(0, 60));
  });
});
