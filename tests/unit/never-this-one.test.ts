process.env.TURSO_DATABASE_URL = 'file::memory:';
process.env.ENCRYPTION_KEY = '0'.repeat(64);
process.env.FOUNDRY_INSTANCE_POSTURE = 'private_owner';
process.env.FOUNDRY_OWNER_EMAIL = 'owner@example.com';

import { beforeAll, describe, expect, it } from 'vitest';
import { runMigrations } from '../../src/db/migrate.js';
import { query } from '../../src/db/client.js';
import {
  excludeEntity, exclusionsFor, liftExclusion, whyExcluded,
} from '../../src/services/institution/owner-exclusions.js';

// =============================================================================
// NEVER THIS ONE.
//
// The owner is allowed to say "not that company" and mean the company. A
// suppression is an address that asked to stop hearing from us — the right
// shape for an opt-out and the wrong shape for an owner boundary, because a
// discovery pass that meets the same business through its website, a second
// published mailbox or a differently spelled name walks straight past it.
//
// So the planted defect here is not a bug in outreach. It is SUCCESS at
// everything else: the excluded business is rediscovered, scores well, is
// screened, qualified, approved, and would be written to — and the row still
// refuses, before any consequential action exists to be sent.
// =============================================================================

const OWNER = 'exclusion_owner';
const OTHER = 'exclusion_other';
/** A real undecided experiment, because the row guards rightly refuse a made-up one. */
let X = '';

beforeAll(async () => {
  await runMigrations();
  for (const [id, clerk] of [[OWNER, 'clerk_x1'], [OTHER, 'clerk_x2']]) {
    await query('INSERT INTO founders (id,clerk_user_id,email,name) VALUES (?,?,?,?)',
      [id, clerk, `${id}@example.com`, 'Owner']);
  }
  const { openMandate } = await import('../../src/services/venture/mandate.js');
  const { formClaim, observe } = await import('../../src/services/venture/market-evidence.js');
  const { promote, sow } = await import('../../src/services/venture/seeds.js');
  const { designExperiment } = await import('../../src/services/venture/validation.js');
  const opened = await openMandate({ founderId: OWNER, statement: 'Make the river stronger',
    shape: null, evidenceMode: 'real' });
  if ('refused' in opened) throw new Error(opened.refused);
  const pain = await formClaim({ founderId: OWNER, evidenceMode: 'real',
    claim: 'somebody wrote: "we fit out vans by hand every week"' });
  const obsId = await observe({ founderId: OWNER, claimId: pain, sourceType: 'community',
    source: 'https://forum.example/9', saw: 'we fit out vans by hand every week', bearing: 'supports',
    directness: 'direct', observedAt: new Date(Date.now() - 86_400_000), evidenceMode: 'real' });
  const seed = await sow({ founderId: OWNER, mandateId: opened.id, seed: 'maybe worth looking into',
    origin: 'signal', originSaid: 'we fit out vans by hand every week', originObservationId: obsId,
    evidenceMode: 'real' });
  if (typeof seed !== 'string') throw new Error('buried');
  await query('UPDATE market_claims SET seed_id = ? WHERE id = ?', [seed, pain]);
  const gap = await formClaim({ founderId: OWNER, seedId: seed, evidenceMode: 'real',
    claim: 'nothing maintained already does this' });
  await observe({ founderId: OWNER, claimId: gap, sourceType: 'directory',
    source: 'https://registry.example/search', saw: 'nothing relevant', bearing: 'supports',
    directness: 'inferred', observedAt: new Date(Date.now() - 3_600_000), evidenceMode: 'real',
    fromAbsence: true });
  await query(
    `INSERT INTO observation_interpretations
       (id, founder_id, observation_id, reading, motivated_by, misread_if, hypothesis,
        hypothesis_kind, who_it_may_be, interpreted_by, evidence_mode)
     VALUES ('int_x',?,?,?,?,?,?,'gap_exists','small shops','test','real')`,
    [OWNER, obsId, 'people resent doing this by hand', 'by hand every week',
      'they enjoy doing it', 'a tool might be wanted']);
  await query('UPDATE opportunity_seeds SET interpretation_id = ?, hypothesis_kind = ? WHERE id = ?',
    ['int_x', 'gap_exists', seed]);
  const made = await promote({ seedId: seed, headline: 'fitting out without doing it by hand',
    whoHasIt: 'small shops', theProblem: 'weekly manual work', whyItMight: 'two ways of knowing',
    killThesis: 'they enjoy doing it', unknowns: ['whether anybody would pay for it'],
    sources: ['https://forum.example/9'] });
  if ('refused' in made) throw new Error(made.refused);
  const unknown = (await query(
    'SELECT id FROM market_unknowns WHERE opportunity_id = ? AND blocking = 1', [made.opportunityId]))
    .rows[0] as Record<string, unknown>;
  X = await designExperiment({
    founderId: OWNER, opportunityId: made.opportunityId, unknownId: String(unknown.id),
    whatWeDo: 'write once to each approved business', whatWeExpect: 'at least one pays',
    wouldDisprove: 'nobody pays', costCents: 0, evidenceMode: 'real' });
});

async function aRecipient(over: Record<string, string | null> = {}): Promise<void> {
  const r = {
    id: `rcp_${Math.random().toString(36).slice(2, 10)}`, founder_id: OWNER, experiment_id: X,
    counterparty_ref: 'Nirvana Upfitters', email: 'info@nirvanaupfitters.com',
    channel: 'email', source_url: 'https://www.nirvanaupfitters.com/', ...over,
  };
  await query(
    `INSERT INTO experiment_recipients
       (id, founder_id, experiment_id, counterparty_ref, email, channel, source_url)
     VALUES (?,?,?,?,?,?,?)`,
    [r.id, r.founder_id, r.experiment_id, r.counterparty_ref, r.email, r.channel, r.source_url]);
}

describe('an owner exclusion is about the business, not one of its addresses', () => {
  it('is recorded with every public mark that can be resolved for it', async () => {
    const made = await excludeEntity({
      founderId: OWNER, entity: 'Nirvana Upfitters',
      because: 'the owner said never to contact this business; the reason is his',
      by: `founder:${OWNER}`,
      marks: [
        { kind: 'name', value: 'Nirvana Upfitters', source: 'the owner' },
        { kind: 'name', value: 'nirvana upfitters llc', source: 'public business listing' },
        { kind: 'domain', value: 'https://www.nirvanaupfitters.com/', source: 'the business site' },
        { kind: 'email', value: 'INFO@nirvanaupfitters.com', source: 'the business site' },
        { kind: 'phone', value: '(978) 798-3109', source: 'public business listing' },
        { kind: 'address', value: '106 Carter Street, Suite 303, Leominster, MA', source: 'public business listing' },
      ],
    });
    expect(made.marks).toBe(6);
    const live = await exclusionsFor(OWNER);
    expect(live).toHaveLength(1);
    // Normalised at the door: a URL becomes a domain, a number becomes digits.
    const by = Object.fromEntries(live[0]!.marks.map((m) => [`${m.kind}:${m.value}`, true]));
    expect(by['domain:nirvanaupfitters.com']).toBe(true);
    expect(by['email:info@nirvanaupfitters.com']).toBe(true);
    expect(by['phone:9787983109']).toBe(true);
  });

  it('THE PLANTED DEFECT: rediscovered, qualified and approved, it is still refused by the row', async () => {
    // Everything the institution could do right, done right — and the business
    // never becomes a participant at all.
    await expect(aRecipient()).rejects.toThrow(/owner_excluded/);
    // Another mailbox at the same domain.
    await expect(aRecipient({ email: 'sales@nirvanaupfitters.com' })).rejects.toThrow(/owner_excluded/);
    // A differently spelled name and an address nobody has seen before.
    await expect(aRecipient({ counterparty_ref: 'NIRVANA UPFITTERS LLC, Leominster', email: 'hello@somewhereelse.test' }))
      .rejects.toThrow(/owner_excluded/);
    // Found through its own website rather than through an address.
    await expect(aRecipient({ counterparty_ref: 'A Van Company', email: 'hi@vanco.test', source_url: 'https://nirvanaupfitters.com/about' }))
      .rejects.toThrow(/owner_excluded/);
    expect((await query('SELECT count(*) AS n FROM experiment_recipients WHERE experiment_id = ?',
      [X])).rows[0]).toMatchObject({ n: 0 });
  });

  it('and cannot be renamed into the cohort afterwards', async () => {
    await aRecipient({ counterparty_ref: 'Somebody Else', email: 'hi@elsewhere.test', source_url: 'https://elsewhere.test' });
    const row = (await query('SELECT id FROM experiment_recipients WHERE experiment_id = ?', [X]))
      .rows[0] as Record<string, unknown>;
    await expect(query('UPDATE experiment_recipients SET email = ? WHERE id = ?',
      ['info@nirvanaupfitters.com', String(row.id)])).rejects.toThrow(/owner_excluded/);
    await expect(query('UPDATE experiment_recipients SET counterparty_ref = ? WHERE id = ?',
      ['Nirvana Upfitters', String(row.id)])).rejects.toThrow(/owner_excluded/);
  });

  it('and the last door refuses it too, whatever the cohort says', async () => {
    await expect(query(
      `INSERT INTO outbound_actions (id, product_id, agent_name, integration_name, action_type,
         authority_level, status, parameters_json)
       VALUES ('ob_x','p','hand','resend','send_email',2,'pending_approval',
               '{"to":["info@nirvanaupfitters.com"]}')`, []))
      .rejects.toThrow(/owner_excluded/);
  });

  it('says why a cohort is one smaller, before a row is ever attempted', async () => {
    const no = await whyExcluded({ founderId: OWNER, name: 'Nirvana Upfitters LLC', email: 'anything@example.test' });
    expect(no.excluded).toBe(true);
    expect(no.entity).toBe('Nirvana Upfitters');
    expect(no.matched).toContain('name:');
    const yes = await whyExcluded({ founderId: OWNER, name: 'General Woodworking', email: 'info@genwood.com' });
    expect(yes.excluded).toBe(false);
  });

  it('is one owner\'s boundary, not a global blocklist', async () => {
    expect((await whyExcluded({ founderId: OTHER, name: 'Nirvana Upfitters' })).excluded).toBe(false);
  });

  it('outranks a lift by anybody who is not the owner, and needs words either way', async () => {
    const id = (await exclusionsFor(OWNER))[0]!.id;
    await expect(query(
      `UPDATE owner_exclusions SET lifted_at = datetime('now'), lifted_by = 'institution:hand',
              lifted_reason = 'it scored well' WHERE id = ?`, [id]))
      .rejects.toThrow(/lift_needs_the_owner_and_a_reason/);
    await expect(query(
      `UPDATE owner_exclusions SET lifted_at = datetime('now'), lifted_by = ?, lifted_reason = ''
        WHERE id = ?`, [`founder:${OWNER}`, id]))
      .rejects.toThrow(/lift_needs_the_owner_and_a_reason/);
    await expect(query('UPDATE owner_exclusions SET because = ? WHERE id = ?', ['something else', id]))
      .rejects.toThrow(/immutable/);
  });

  it('a name mark too short to mean anything is refused', async () => {
    const id = (await exclusionsFor(OWNER))[0]!.id;
    await expect(query(
      `INSERT INTO owner_exclusion_marks (id, exclusion_id, founder_id, kind, value, source)
       VALUES ('m_short', ?, ?, 'name', 'inc', 'somebody')`, [id, OWNER]))
      .rejects.toThrow(/name_too_broad/);
    await expect(query(
      `INSERT INTO owner_exclusion_marks (id, exclusion_id, founder_id, kind, value, source)
       VALUES ('m_case', ?, ?, 'email', 'MiXeD@Example.Test', 'somebody')`, [id, OWNER]))
      .rejects.toThrow(/not_normalised/);
  });

  it('a mark may not claim a founder its exclusion does not belong to', async () => {
    // THE DENORMALISED COLUMN CANNOT BE ALLOWED TO LIE. Founder-scoped erasure
    // deletes marks by founder_id; a mark carrying somebody else's id would
    // survive the erasure of the person whose boundary it actually is, and be
    // deleted by the erasure of a person it never belonged to.
    const id = (await exclusionsFor(OWNER))[0]!.id;
    await expect(query(
      `INSERT INTO owner_exclusion_marks (id, exclusion_id, founder_id, kind, value, source)
       VALUES ('m_wrong', ?, ?, 'name', 'somebody else entirely', 'somebody')`, [id, OTHER]))
      .rejects.toThrow(/founder_must_match_the_exclusion/);
    await expect(query(
      `INSERT INTO owner_exclusion_marks (id, exclusion_id, kind, value, source)
       VALUES ('m_none', ?, 'name', 'somebody else entirely', 'somebody')`, [id]))
      .rejects.toThrow(/founder_must_match_the_exclusion/);
  });

  it('and when the owner lifts it himself, in words, the business can be reached again', async () => {
    const id = (await exclusionsFor(OWNER))[0]!.id;
    const out = await liftExclusion({ founderId: OWNER, id, because: 'he asked us to get in touch' });
    expect(out.lifted).toBe(true);
    expect(await exclusionsFor(OWNER)).toHaveLength(0);
    expect((await whyExcluded({ founderId: OWNER, name: 'Nirvana Upfitters' })).excluded).toBe(false);
    await aRecipient({ id: 'rcp_after_lift' });
    expect((await query('SELECT count(*) AS n FROM experiment_recipients WHERE experiment_id = ?', [X]))
      .rows[0]).toMatchObject({ n: 2 });
  });
});
