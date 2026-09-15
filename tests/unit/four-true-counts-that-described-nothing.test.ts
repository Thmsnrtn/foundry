process.env.TURSO_DATABASE_URL = 'file::memory:';
process.env.ENCRYPTION_KEY = '0'.repeat(64);

import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { nanoid } from 'nanoid';
import { runMigrations } from '../../src/db/migrate.js';
import { query } from '../../src/db/client.js';
import { reconcileExperiment } from '../../src/services/venture/reconcile.js';

// =============================================================================
// FOUR TRUE COUNTS THAT TOGETHER DESCRIBED AN EXPERIMENT THAT DID NOT EXIST.
//
// A tranche report said Experiment 001 was "21 of 25 written to, 4 questions
// back, 1 opt-out", and separately "11 pending". Every number was a real count
// of a real table. Together they were fiction:
//
//   the four "questions" were rehearsal traffic — addresses at `.test`, the SES
//     simulator, a DMARC report, and the owner's own mailbox;
//   the "opt-out" was a `.test` address suppressed two days BEFORE the send;
//   the "11 pending" were internal agent proposals belonging to no experiment;
//   and "of 25" was a figure from the design, not a cohort that ever existed.
//
// Prose is where counts from different tables go to be added together. These
// tests are the shape of that mistake, written down so the reading cannot make
// it again.
// =============================================================================

let OWNER = '';
let PRODUCT = '';
let EXPERIMENT = '';

/** AN ACT, MADE THE WAY THE PRODUCT MAKES ONE: proposed against a standing
 *  ask-first, then decided by the owner of the company it names. It cannot
 *  arrive decided, and it cannot be decided by anybody else. */
async function act(name: string, opts: { consumed?: boolean; revoked?: boolean } = {}): Promise<void> {
  await query(
    `INSERT OR IGNORE INTO owner_boundaries (id, product_id, subject, statement, mode)
     VALUES (?,?,'contact_people','Ask me before writing to anyone','ask_first')`,
    [`b_${PRODUCT}`, PRODUCT]);
  await query(
    `INSERT INTO proposed_acts
       (id, product_id, subject, action_type, params_fingerprint, summary, why,
        expected_effect, risk, consequence, proposed_by, expires_at, experiment_id,
        measurement_critical)
     VALUES (?,?,'contact_people','send_email','fp','Write once to each approved business',
             'because the question is blocking','somebody replies','nobody replies',
             'medium','institution:hand', datetime('now','+21 days'), ?, 1)`,
    [`${name}_${EXPERIMENT}`, PRODUCT, EXPERIMENT]);
  await query(
    `UPDATE proposed_acts SET decision = 'approved', decided_at = datetime('now'),
            decided_by = ?, consumed_at = ?, consumed_by = ?, revoked_at = ?, revoke_reason = ?
      WHERE id = ?`,
    [`founder:${OWNER}`,
      opts.consumed === true ? new Date().toISOString() : null,
      opts.consumed === true ? 'outbound_door:experiment' : null,
      opts.revoked === true ? new Date().toISOString() : null,
      opts.revoked === true ? 'the owner changed his mind' : null,
      `${name}_${EXPERIMENT}`]);
}

/** A RECIPIENT IS NEVER BORN APPROVED: approval is the owner's act, and the
 *  schema refuses a row that arrives already reviewed. So the fixture does what
 *  the product does — proposes, then records the decision. */
async function recipient(email: string, status: string, act: string | null): Promise<void> {
  const id = nanoid();
  await query(
    `INSERT INTO experiment_recipients
       (id, founder_id, experiment_id, counterparty_ref, email, channel, review_status)
     VALUES (?,?,?,?,?,'email','pending')`,
    [id, OWNER, EXPERIMENT, `ref_${email}`, email]);
  if (status !== 'pending') {
    await query(
      `UPDATE experiment_recipients
          SET review_status = ?, authorised_act_id = ?, reviewed_by = ?, reviewed_at = datetime('now'),
              review_reason = 'recorded by the fixture'
        WHERE id = ?`, [status, act, `founder:${OWNER}`, id]);
  }
}

async function mail(from: string): Promise<void> {
  await query(
    `INSERT INTO workshop_mail
       (id, founder_id, subject, body, rfc_message_id, thread_key, from_email, to_email)
     VALUES (?,?,'re: your note','a body',?,?,?,'hello@apexmicro.ai')`,
    [nanoid(), OWNER, `<${nanoid()}@mail.example>`, nanoid(), from]);
}

beforeAll(async () => { await runMigrations(); });

beforeEach(async () => {
  OWNER = nanoid();
  PRODUCT = nanoid();
  EXPERIMENT = nanoid();
  await query('INSERT INTO founders (id, clerk_user_id, email, name) VALUES (?,?,?,?)',
    [OWNER, `clerk_${OWNER}`, `${OWNER}@example.test`, 'Owner']);
  await query(
    `INSERT INTO products (id, owner_id, name, status, standing, reality)
     VALUES (?,?,'An asset','active','earned','real')`, [PRODUCT, OWNER]);
  // A recipient row insists its experiment exists, and an experiment insists on
  // the question it answers and where that question came from. Written out
  // rather than reached through the services, which refuse a second open search
  // per founder — a real rule, and not the one under test here.
  const mandate = `m_${OWNER}`;
  const opp = `o_${OWNER}`;
  const unknown = `u_${OWNER}`;
  await query(
    `INSERT INTO venture_mandates (id, founder_id, statement, shape, evidence_mode)
     VALUES (?,?,'A search for another income stream',NULL,'real')`, [mandate, OWNER]);
  await query(
    `INSERT INTO venture_opportunities
       (id, mandate_id, founder_id, headline, who_has_it, the_problem, why_it_might,
        kill_thesis, sources_json, evidence_mode)
     VALUES (?,?,?,'Shops with a scattered notice problem','shops','scattered notices',
             'somebody pays','nobody pays','[]','real')`, [opp, mandate, OWNER]);
  await query(
    `INSERT INTO market_unknowns (id, founder_id, opportunity_id, question)
     VALUES (?,?,?,'whether anybody would pay for it')`, [unknown, OWNER, opp]);
  await query(
    `INSERT INTO venture_experiments
       (id, founder_id, opportunity_id, unknown_id, what_we_do, what_we_expect,
        would_disprove, evidence_mode)
     VALUES (?,?,?,?,'write once to each approved business','somebody pays',
             'nobody pays','real')`, [EXPERIMENT, OWNER, opp, unknown]);
  // The Workshop's mailbox only accepts mail addressed to the Workshop's own
  // domain — a message to anywhere else is not something it heard.
  await query(
    `INSERT INTO public_workshop
       (founder_id, product_id, public_name, operator_name, origin, zone_name,
        contact_email, statement)
     VALUES (?,?,'Apex Micro','Owner','https://apexmicro.ai','apexmicro.ai',
             'hello@apexmicro.ai','what this is for')`, [OWNER, PRODUCT]);
});

const n = (list: Array<{ what: string; n: number }>, what: string): number => {
  const found = list.find((x) => x.what === what);
  if (!found) throw new Error(`no count for ${what}`);
  return found.n;
};

describe('a reply is only a reply if the person written to sent it', () => {
  it('does not count rehearsal traffic, delivery reports or the owner as replies', async () => {
    await act('act_1');
    await recipient('sales@arealbusiness.com', 'approved', `act_1_${EXPERIMENT}`);
    await mail('a@millwork.example.test');          // rehearsal
    await mail('success@simulator.amazonses.com');  // a provider simulator
    await mail('noreply-dmarc-support@google.com'); // infrastructure
    await mail('owner@example.test');               // the owner writing in

    const r = await reconcileExperiment(EXPERIMENT);
    expect(n(r.cameBack, 'replies from people written to')).toBe(0);
    // And it is not silent about them: four real messages exist and are named
    // as what they are, rather than deleted from the account of what happened.
    expect(n(r.notEvidence, 'other mail in the Workshop mailbox')).toBe(4);
  });

  it('counts a reply from somebody actually written to', async () => {
    await act('act_1');
    await recipient('sales@arealbusiness.com', 'approved', `act_1_${EXPERIMENT}`);
    await mail('sales@arealbusiness.com');
    expect(n((await reconcileExperiment(EXPERIMENT)).cameBack,
      'replies from people written to')).toBe(1);
  });

  it('matches regardless of case, because mailboxes do', async () => {
    await act('act_1');
    await recipient('Sales@ARealBusiness.com', 'approved', `act_1_${EXPERIMENT}`);
    await mail('sales@arealbusiness.com');
    expect(n((await reconcileExperiment(EXPERIMENT)).cameBack,
      'replies from people written to')).toBe(1);
  });
});

describe('an opt-out belongs to the test that caused it', () => {
  it('does not count a suppression recorded against no experiment', async () => {
    // The live one was a `.test` address suppressed two days before the send.
    await act('act_1');
    await recipient('sales@arealbusiness.com', 'approved', `act_1_${EXPERIMENT}`);
    await query(
      `INSERT INTO public_suppressions (id, founder_id, email, reason, source, note)
       VALUES (?,?,'b@millwork.example.test','they_asked','reply','rehearsal')`,
      [nanoid(), OWNER]);
    const r = await reconcileExperiment(EXPERIMENT);
    expect(n(r.cameBack, 'asked not to be written to')).toBe(0);
  });

  it('counts one recorded against this test, and separates it from a bounce', async () => {
    await query(
      `INSERT INTO public_suppressions (id, founder_id, email, reason, source, experiment_id, note)
       VALUES (?,?,'someone@real.com','they_asked','reply',?,'said so')`,
      [nanoid(), OWNER, EXPERIMENT]);
    await query(
      `INSERT INTO public_suppressions (id, founder_id, email, reason, source, experiment_id, note)
       VALUES (?,?,'gone@real.com','bounced','provider',?,'undeliverable')`,
      [nanoid(), OWNER, EXPERIMENT]);
    const r = await reconcileExperiment(EXPERIMENT);
    expect(n(r.cameBack, 'asked not to be written to')).toBe(1);
    expect(n(r.cameBack, 'on the suppression list because of this test')).toBe(2);
  });
});

describe('pending means candidate, and never means queued to send', () => {
  it('keeps approved, pending and struck apart', async () => {
    await act('act_1');
    await recipient('a@real.com', 'approved', `act_1_${EXPERIMENT}`);
    await recipient('b@real.com', 'approved', `act_1_${EXPERIMENT}`);
    await recipient('c@real.com', 'pending', null);
    await recipient('d@real.com', 'struck', null);
    const r = await reconcileExperiment(EXPERIMENT);
    expect(n(r.cohort, 'approved to be written to')).toBe(2);
    expect(n(r.cohort, 'proposed but never approved')).toBe(1);
    expect(n(r.cohort, 'struck from the population')).toBe(1);
    expect(r.cohort.find((x) => x.what === 'proposed but never approved')?.because)
      .toContain('nothing may be');
  });

  it('does not attribute internal proposals belonging to no experiment', async () => {
    // These were reported as "11 pending" recipients. They are agent proposals
    // about the institution itself and reach nobody outside it.
    for (let i = 0; i < 3; i++) {
      await query(
        `INSERT INTO outbound_actions
           (id, product_id, agent_name, integration_name, action_type, authority_level,
            status, parameters_json, rationale, created_at)
         VALUES (?,?,'compass','none','strategic_proposal',2,'pending_approval','{}',
                 'the agent proposed it', datetime('now'))`,
        [nanoid(), PRODUCT]);
    }
    const r = await reconcileExperiment(EXPERIMENT);
    expect(n(r.reached, 'messages sent')).toBe(0);
    expect(n(r.notEvidence, 'internal proposals waiting, belonging to no experiment')).toBe(3);
  });
});

describe('the act is what says anybody could be written to', () => {
  it('says plainly when nothing has ever authorised contact', async () => {
    await recipient('a@real.com', 'pending', null);
    const r = await reconcileExperiment(EXPERIMENT);
    expect(r.acts).toHaveLength(0);
    expect(r.remainingAuthority).toContain('No act has ever authorised');
  });

  it('flags an approved recipient carrying no act as the failure the act prevents', async () => {
    await act('act_1');
    await recipient('a@real.com', 'approved', `act_1_${EXPERIMENT}`);
    await recipient('b@real.com', 'approved', null);
    const r = await reconcileExperiment(EXPERIMENT);
    expect(n(r.cohort, 'approved to be written to')).toBe(2);
    expect(n(r.cohort, 'carrying an authorising act')).toBe(1);
    expect(r.cohort.find((x) => x.what === 'carrying an authorising act')?.because)
      .toContain('THIS SHOULD EQUAL THE APPROVED COUNT');
  });

  it('notices when more than one act reached the same cohort', async () => {
    await act('act_1');
    await act('act_2');
    await recipient('a@real.com', 'approved', `act_1_${EXPERIMENT}`);
    await recipient('b@real.com', 'approved', `act_2_${EXPERIMENT}`);
    const r = await reconcileExperiment(EXPERIMENT);
    expect(n(r.cohort, 'distinct acts covering them')).toBe(2);
    expect(r.cohort.find((x) => x.what === 'distinct acts covering them')?.because)
      .toContain('each needs its own reading');
  });
});

describe('sent, accepted and delivered are three different things', () => {
  // WHY THESE ARE NOT EXERCISED WITH ROWS HERE. An experiment-bound outbound
  // action cannot be written without the whole apparatus that makes it lawful:
  // an experimental asset bound to this experiment, an approved
  // measurement-critical act naming it, an approved recipient, and a recorded
  // effect. That is the schema doing its job, and a fixture that assembled a
  // convincing imitation of all four would be testing the imitation.
  //
  // The distinction these counts exist to hold — acceptance is not delivery —
  // is asserted here on the reading itself, and was verified against the live
  // estate, where it separated 21 sent and accepted into 19 delivered and 2
  // bounced.
  it('never lets acceptance be read as delivery', async () => {
    const r = await reconcileExperiment(EXPERIMENT);
    expect(n(r.reached, 'messages sent')).toBe(0);
    expect(n(r.reached, 'accepted by the provider')).toBe(0);
    expect(n(r.reached, 'delivered')).toBe(0);
    expect(r.reached.find((x) => x.what === 'accepted by the provider')?.because)
      .toContain('acceptance is not delivery');
    expect(r.reached.find((x) => x.what === 'still unresolved')?.because)
      .toContain('has not yet said');
  });

  it('reports no payment as no payment', async () => {
    expect(n((await reconcileExperiment(EXPERIMENT)).cameBack, 'paid')).toBe(0);
  });
});

describe('a declined test keeps its review and gets none of the authority', () => {
  // PRODUCTION HAS A REAL INSTANCE OF THIS, WHICH IS WHY IT IS WRITTEN DOWN.
  //
  // `SkQeFRIbU9SR6oMNC3MSX` was declined on 9 September and superseded, because
  // its design pointed a raw payment link from a fresh domain and carried more
  // identity and reputation cost than it counted. It still holds twenty-two
  // approved recipients: twenty-two real businesses the owner looked at and said
  // yes to.
  //
  // Zero of them carry an act, and no act names that experiment at all. So
  // nothing can be sent to any of them, and the reason is structural rather than
  // anybody having remembered: APPROVING A RECIPIENT IS A REVIEW OF THE
  // POPULATION, NEVER AUTHORITY TO WRITE TO IT. The outbound door reads the act
  // stamped on the row; the review is what makes a row eligible to be covered by
  // one, and the two are different events with different actors.
  //
  // A report that counted "22 approved" as "22 people we may write to" would be
  // the same class of mistake as the four true counts above.
  it('can hold a full approved cohort that no act covers', async () => {
    for (let i = 0; i < 22; i++) await recipient(`declined${String(i)}@example.test`, 'approved', null);

    const r = await reconcileExperiment(EXPERIMENT);
    const approved = r.cohort.find((c) => c.what === 'approved to be written to');
    const covered = r.cohort.find((c) => c.what === 'carrying an authorising act');
    expect(approved?.n).toBe(22);
    expect(covered?.n).toBe(0);
  });

  it('says plainly that nothing ever authorised writing to anybody', async () => {
    for (let i = 0; i < 22; i++) await recipient(`declined${String(i)}@example.test`, 'approved', null);
    const r = await reconcileExperiment(EXPERIMENT);
    expect(r.acts).toEqual([]);
    expect(r.remainingAuthority).toContain('No act has ever authorised');
  });

  it('counts nothing reached, nothing back, and nothing paid', async () => {
    for (let i = 0; i < 22; i++) await recipient(`declined${String(i)}@example.test`, 'approved', null);
    const r = await reconcileExperiment(EXPERIMENT);
    expect(r.reached.every((c) => c.n === 0)).toBe(true);
    expect(r.cameBack.every((c) => c.n === 0)).toBe(true);
  });

  it('marks the mismatch as the failure the act exists to prevent', async () => {
    // The reading does not merely report 22 and 0 side by side and leave the
    // reader to notice. When the two disagree it says which disagreement it is.
    for (let i = 0; i < 22; i++) await recipient(`declined${String(i)}@example.test`, 'approved', null);
    const covered = (await reconcileExperiment(EXPERIMENT)).cohort
      .find((c) => c.what === 'carrying an authorising act');
    expect(covered?.because).toContain('THIS SHOULD EQUAL THE APPROVED COUNT');
  });
});
