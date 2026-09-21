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
    expect(t).toContain('The recorded result is unchanged');
    // NOT "STANDS". Whether the null stands or is void is PENDING 21, which is
    // open and is the owner's. A footnote authorised for something else may not
    // settle it in public on his behalf.
    expect(t).not.toContain('result stands');
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
      // Either rule is the right answer: by this point a footnote exists, so
      // the stronger freeze catches it first. Both refuse the same statement.
      .rejects.toThrow(/a_clarification_does_not_edit_the_record|the_text_above_is_unchanged/);
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

// =============================================================================
// WHAT AN ADVERSARIAL READING GOT THROUGH, AND NO LONGER CAN.
//
// A review cell executed SQL against migration 333's three rules and defeated
// all of them, four ways. Each is a test now. The shape of the mistake is the
// reusable part: two of the four were an ENUMERATION that missed a column, one
// was a rule keyed on the wrong event, and one was a write nobody had counted
// as a write.
// =============================================================================

describe('the holes a review cell found, closed', () => {
  it('refuses a statement that publishes a correction and graduates the test', async () => {
    // THE WORST OF THEM. `graduated_to_url` was not in the "nothing sealed
    // moves" list, and setting it flips the public status line to "Graduated —
    // this experiment now operates independently". One legal statement could
    // publish the correction AND present the failed test as a success, inside
    // the rule written to stop exactly that.
    await expect(query(
      `UPDATE public_experiments
          SET public_clarification = 'a second finding', public_clarification_at = '2026-10-01',
              graduated_to_url = 'https://example.com'
        WHERE experiment_id = ?`, [X]))
      .rejects.toThrow(/a_clarification_does_not_edit_the_record|the_text_above_is_unchanged/);
  });

  it('refuses a later statement that rewrites the record beneath the footnote', async () => {
    // The rule fired only when the clarification column changed, so the copy
    // was frozen for one statement and free afterwards — and `updatePublicCopy`
    // and `recordPublicOutcome` both do exactly that in the ordinary course of
    // business. "The text above is unchanged" was enforced by nothing.
    await expect(query(
      `UPDATE public_experiments SET public_summary = 'REWRITTEN' WHERE experiment_id = ?`,
      [X])).rejects.toThrow(/the_text_above_is_unchanged/);
    await expect(query(
      `UPDATE public_experiments SET public_outcome = 'REWRITTEN' WHERE experiment_id = ?`,
      [X])).rejects.toThrow(/the_text_above_is_unchanged/);
    await expect(query(
      `UPDATE public_experiments SET public_sample = 'A DIFFERENT SPECIMEN' WHERE experiment_id = ?`,
      [X])).rejects.toThrow(/the_text_above_is_unchanged/);
    await expect(query(
      `UPDATE public_experiments SET listed = 0 WHERE experiment_id = ?`,
      [X])).rejects.toThrow(/the_text_above_is_unchanged/);
    // And the exported writers that issue those statements are refused too,
    // rather than only the raw SQL.
    const { updatePublicCopy, recordPublicOutcome } =
      await import('../../src/services/public-workshop/identity.js');
    await expect(updatePublicCopy(X, { summary: 'quietly different' }))
      .rejects.toThrow(/the_text_above_is_unchanged/);
    await expect(recordPublicOutcome(X, 'Closed — a different account of it'))
      .rejects.toThrow(/the_text_above_is_unchanged/);
  });

  it('refuses to delete a published record, so DELETE-then-INSERT cannot launder it', async () => {
    // There was no BEFORE DELETE trigger at all. Delete the row and insert it
    // again and the correction is gone with no trace: `public_publications`
    // keeps a digest of the rendered page, not its words.
    await expect(query(
      `DELETE FROM public_experiments WHERE experiment_id = ?`, [X]))
      .rejects.toThrow(/a_published_record_is_not_deleted/);
  });

  it('refuses a clarification that arrives on a brand new row', async () => {
    // The other half of the same laundering: if the row cannot be deleted, the
    // next attempt is to insert a fresh one already corrected.
    await expect(query(
      `INSERT INTO public_experiments
         (experiment_id, founder_id, number, slug, public_title, public_summary,
          public_who, public_what, public_limits, public_sources, public_selection,
          public_note, public_clarification, public_clarification_at)
       VALUES (?,?,901,'laundered','t','s','w','x','l','o','n','q','arrived corrected','2026-09-01')`,
      [X, OWNER])).rejects.toThrow(/cannot_arrive_clarified|UNIQUE/);
  });

  it('refuses to move the date on its own', async () => {
    // Rule three said, in its own comment, that changing the words requires the
    // date to move with it "so a reader can always tell that it did". The date
    // moved alone, silently — a footnote published on the 21st redated to the
    // 8th, so a defect disclosed after settlement appears disclosed before it.
    await expect(query(
      `UPDATE public_experiments SET public_clarification_at = '2026-09-08'
        WHERE experiment_id = ?`, [X]))
      .rejects.toThrow(/a_date_does_not_move_on_its_own/);
  });

  it('allows a correction to supersede itself, with new words and a new date together', async () => {
    // The one thing that may still move. Without it, a finding that is later
    // found wrong could never be corrected, which is the opposite of the point.
    await query(
      `UPDATE public_experiments SET public_clarification = ?, public_clarification_at = ?
        WHERE experiment_id = ?`,
      ['A later finding supersedes the one above.', '2026-10-01', X]);
    const row = (await query(
      `SELECT public_clarification_at FROM public_experiments WHERE experiment_id = ?`, [X]))
      .rows[0] as Record<string, unknown>;
    expect(String(row.public_clarification_at)).toBe('2026-10-01');
  });
});

describe('the footnote goes on the record it was authorised for', () => {
  it('refuses to publish it on a record that is not the authorised one', async () => {
    // `findProof1` resolves by a deliverable's TITLE, and the hourly tick runs
    // the keeper for every founder with a Workshop. A second founder seeded
    // with the same proof — which the CLI, the measurement script and the
    // screenshot script all do — would have had a dated statement published on
    // THEIR page asserting that nobody bought and the reply route was unrouted,
    // about a test whose route was fine. And the row refuses to withdraw it.
    const { keepProof1sRecordCurrent } = await import('../../src/services/venture/proof-1.js');
    await query(
      `UPDATE public_experiments SET slug = slug WHERE experiment_id = ?`, [X]);
    // A founder with no Workshop record of that slug gets nothing at all.
    expect(await keepProof1sRecordCurrent('nobody_at_all')).toBe('no_record');
  });
});

// =============================================================================
// WHAT THE THIRD CELL FOUND IN THE REPAIR.
//
// A wave of corrections is not safer than the code it corrects. Migration 334
// made a published record permanent and permanent was too strong by exactly one
// case, and it watched the door nobody was using.
// =============================================================================

describe('permanent against its keeper, not against the person', () => {
  it('lets an erasure through, because forgetting somebody is not bookkeeping', async () => {
    // WITHOUT THIS, ASKING TO BE FORGOTTEN ABORTS HALF-WAY. The erasure sweep
    // issues a plain DELETE with no try/catch, so the founders row is never
    // redacted and every table after this one in the order is never cleared —
    // and retrying is futile, because the refusal is permanent by design.
    const id = 'clar_erasable';
    await query(
      `INSERT INTO founders (id,clerk_user_id,email,name) VALUES (?,?,?,?)`,
      [id, 'clerk_clar_e', 'gone@example.com', 'Leaving']);
    await query(
      `INSERT INTO venture_mandates (id, founder_id, statement, evidence_mode)
       VALUES ('clar_m', ?, 'a search', 'real')`, [id]);
    await query(
      `INSERT INTO venture_opportunities
         (id, mandate_id, founder_id, headline, who_has_it, the_problem, why_it_might,
          kill_thesis, sources_json, evidence_mode)
       VALUES ('clar_o','clar_m',?,'h','w','p','y','k','[]','real')`, [id]);
    await query(
      `INSERT INTO market_unknowns (id, founder_id, opportunity_id, question)
       VALUES ('clar_u',?,'clar_o','q')`, [id]);
    await query(
      `INSERT INTO venture_experiments
         (id, founder_id, opportunity_id, unknown_id, what_we_do, what_we_expect,
          would_disprove, evidence_mode, ran_at)
       VALUES ('clar_x',?,'clar_o','clar_u','d','e','w','real',NULL)`, [id]);
    // A test cannot arrive run, and cannot run unapproved. It ends by going
    // through the states, which is the rule and not an inconvenience.
    await query(
      `UPDATE venture_experiments SET decision = 'approved', decided_at = datetime('now'),
              decided_by = ? WHERE id = 'clar_x'`, [id]);
    await query(
      `UPDATE venture_experiments SET ran_at = datetime('now'), what_happened = 'nobody bought', verdict = 'surprised' WHERE id = 'clar_x'`);
    await query(
      `INSERT INTO public_experiments
         (experiment_id, founder_id, number, slug, public_title, public_summary,
          public_who, public_what, public_limits, public_sources, public_selection, public_note)
       VALUES ('clar_x',?,1,'a-leaving-record','t','s','w','x','l','o','n','q')`, [id]);
    await query(
      `UPDATE public_experiments SET public_clarification = 'a later finding',
              public_clarification_at = '2026-09-21' WHERE experiment_id = 'clar_x'`);

    // Refused while nobody has asked to be forgotten.
    await expect(query(`DELETE FROM public_experiments WHERE founder_id = ?`, [id]))
      .rejects.toThrow(/a_published_record_is_not_deleted/);

    // And allowed once an erasure is actually scheduled on one of his products.
    await query(
      `INSERT INTO products (id,name,owner_id,status,erasure_scheduled_at)
       VALUES ('clar_p','Leaving Co',?,'active',datetime('now'))`, [id]);
    await query(`DELETE FROM public_experiments WHERE founder_id = ?`, [id]);
    expect((await query(
      `SELECT COUNT(*) AS n FROM public_experiments WHERE founder_id = ?`, [id]))
      .rows[0]).toMatchObject({ n: 0 });
  });

  it('refuses the door a BEFORE DELETE trigger cannot see', async () => {
    // SQLite resolves INSERT OR REPLACE by deleting the conflicting row WITHOUT
    // firing BEFORE DELETE triggers unless `recursive_triggers` is on, which
    // nothing here sets. A reviewer executed it: DELETE blocked, REPLACE
    // succeeded, the footnote gone and every sealed column rewritten. It is an
    // ordinary idiom in this repository, not a statement somebody has to go
    // looking for.
    await expect(query(
      `INSERT OR REPLACE INTO public_experiments
         (experiment_id, founder_id, number, slug, listed, public_title, public_summary,
          public_who, public_what, public_limits, public_sources, public_selection, public_note)
       VALUES (?,?,1,'ma-millwork-bid-brief',1,'Any words at all','rewritten',
               'w','x','l','o','n','q')`, [X, OWNER]))
      .rejects.toThrow(/cannot_replace_a_clarified_record/);

    // And the record is exactly as it was.
    const row = (await query(
      `SELECT public_summary, public_clarification FROM public_experiments
        WHERE experiment_id = ?`, [X])).rows[0] as Record<string, unknown>;
    expect(String(row.public_summary)).toBe(PROOF1_PUBLIC.summary);
    expect(row.public_clarification).not.toBeNull();
  });

  it('keeps the recorded result on the page when the asset is marked earned', async () => {
    // The status line is computed from the asset's standing, which the freeze
    // does not cover — so a clarified, failed test could render "Operating —
    // this remains a small Apex Micro product" with the recorded outcome not
    // moved but DISCARDED, because only the closed branch ever read it. The
    // transition stays the owner's; losing the result off the page does not.
    const { projectExperiment } = await import('../../src/services/public-workshop/projection.js');
    const { recordPublicOutcome, recordPublicClarification } =
      await import('../../src/services/public-workshop/identity.js');

    await query(
      `INSERT INTO market_unknowns (id, founder_id, opportunity_id, question)
       SELECT 'clar_u2', founder_id, opportunity_id, 'another question'
         FROM venture_experiments WHERE id = ?`, [X]);
    await query(
      `INSERT INTO venture_experiments
         (id, founder_id, opportunity_id, unknown_id, what_we_do, what_we_expect,
          would_disprove, evidence_mode)
       SELECT 'clar_y', founder_id, opportunity_id, 'clar_u2', 'd', 'e', 'w', 'real'
         FROM venture_experiments WHERE id = ?`, [X]);
    await query(
      `UPDATE venture_experiments SET decision = 'approved', decided_at = datetime('now'),
              decided_by = ? WHERE id = 'clar_y'`, [OWNER]);
    await query(`UPDATE venture_experiments SET ran_at = datetime('now'), what_happened = 'nobody bought', verdict = 'surprised' WHERE id = 'clar_y'`);
    await query(
      `INSERT INTO public_experiments
         (experiment_id, founder_id, number, slug, public_title, public_summary,
          public_who, public_what, public_limits, public_sources, public_selection, public_note)
       VALUES ('clar_y',?,77,'a-second-public-record','t','s','w','x','l','o','n','q')`, [OWNER]);

    // Recorded in the right order: the outcome at conclusion, the correction
    // afterwards. Once the correction exists the outcome can no longer move.
    await recordPublicOutcome('clar_y', 'Closed — nobody bought inside the window.');
    await recordPublicClarification('clar_y', 'a later finding about it', '2026-09-21');

    // And now the asset earns its standing, which is the owner's to say.
    await query(
      `INSERT INTO products (id,name,owner_id,status,standing,reality,from_experiment_id)
       VALUES ('clar_asset','Second asset',?,'active','experimental','real','clar_y')`, [OWNER]);
    await query(
      `UPDATE products SET standing = 'earned', earned_at = datetime('now'),
              earned_by = ?, earned_because = 'the owner says so'
        WHERE id = 'clar_asset'`, [`founder:${OWNER}`]);

    const x = await projectExperiment('clar_y');
    expect(x?.statusLine).toContain('nobody bought');
    expect(x?.clarification?.text).toBe('a later finding about it');
  });
});
