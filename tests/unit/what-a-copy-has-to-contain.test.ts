process.env.ENCRYPTION_KEY = '0'.repeat(64);
process.env.FOUNDRY_INSTANCE_POSTURE = 'private_owner';
process.env.FOUNDRY_OWNER_EMAIL = 'owner@example.com';

import { mkdtemp, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';

// =============================================================================
// WHAT A COPY HAS TO CONTAIN TO BE WORTH HAVING.
//
// The restore was already better than most: it gunzips the copy, opens it as a
// separate database, refuses to write over the live one, and counts what came
// back. But what it counted was TABLES and FOUNDERS — a claim about the schema
// and about whether anybody exists. Neither is the question somebody asks at
// four in the morning, which is: if I recovered from this, would I know who is
// owed something, what I hold of theirs, what this thing may still spend, and
// which of my assets is live?
//
// ONE STATEMENT, TWO CONNECTIONS, COMPARED. There is no second implementation
// to drift — each reading is written once and run against both databases — and
// the last test here is the one that matters most, because a check that cannot
// come back false is not a check.
// =============================================================================

let dir = '';
const OWNER = 'copy_owner';

beforeAll(async () => {
  dir = await mkdtemp(join(tmpdir(), 'foundry-copy-'));
  process.env.TURSO_DATABASE_URL = `file:${join(dir, 'foundry.db')}`;
  await mkdir(join(dir, 'backups'), { recursive: true });

  const { runMigrations } = await import('../../src/db/migrate.js');
  const { query } = await import('../../src/db/client.js');
  await runMigrations();

  await query('INSERT INTO founders (id,clerk_user_id,email,name) VALUES (?,?,?,?)',
    [OWNER, 'clerk_copy', 'owner@example.com', 'Owner']);
  await query(
    `INSERT INTO products (id,name,owner_id,status,standing,reality)
     VALUES ('copy_asset','Fieldnote',?,'active','earned','real')`, [OWNER]);
  // THE WHOLE CHAIN A PAYMENT HANGS FROM, because a charge that names no
  // outcome event is refused — correctly. Money has to walk back to somebody
  // having been reached, and a fixture that skipped that would be proving the
  // restore against rows the institution would never actually hold.
  await query(
    `INSERT INTO venture_mandates (id, founder_id, statement, evidence_mode)
     VALUES ('copy_mandate',?,'Find another small digital income stream','real')`, [OWNER]);
  await query(
    `INSERT INTO venture_opportunities
       (id, mandate_id, founder_id, headline, who_has_it, the_problem, why_it_might,
        kill_thesis, sources_json, evidence_mode)
     VALUES ('copy_opp','copy_mandate',?,'A dated shortlist','small operators',
             'the register goes stale','they check it by hand',
             'nobody pays for public data','[]','real')`, [OWNER]);
  await query(
    `INSERT INTO market_unknowns (id, founder_id, opportunity_id, question)
     VALUES ('copy_unknown',?,'copy_opp','whether anybody would pay for it')`, [OWNER]);
  // A test cannot ARRIVE approved — approval is an act, not a column somebody
  // sets on the way in. So it is proposed and then decided, which is the only
  // order the table allows.
  await query(
    `INSERT INTO venture_experiments
       (id, founder_id, opportunity_id, unknown_id, what_we_do, what_we_expect,
        would_disprove, evidence_mode)
     VALUES ('copy_exp',?,'copy_opp','copy_unknown','offer the brief','somebody buys',
             'nobody buys','real')`, [OWNER]);
  await query(
    `UPDATE venture_experiments SET decision = 'approved', decided_at = datetime('now'),
            decided_by = ? WHERE id = 'copy_exp'`, [OWNER]);
  // The asset the offer belongs to, which is the test's own asset and not the
  // earned company — the exposure guard is right to insist on that.
  await query(
    `INSERT INTO products (id,name,owner_id,status,standing,reality,from_experiment_id)
     VALUES ('copy_test_asset','The licence brief',?,'active','experimental','real','copy_exp')`,
    [OWNER]);
  await query(
    `INSERT INTO experiment_exposures
       (id, founder_id, experiment_id, product_id, provider, exposure_ref,
        evidence_mode, placed_by)
     VALUES ('copy_exposure',?,'copy_exp','copy_test_asset','stripe','plink_1','real','copy_act')`,
    [OWNER]);

  // Money taken, and some of it given back.
  for (const [id, kind, cents, ref] of [
    ['ce_1', 'charge', 2900, 'pi_one'], ['ce_2', 'charge', 1900, 'pi_two'],
    ['ce_3', 'refund', 1900, 're_two'],
  ] as Array<[string, string, number, string]>) {
    const source = kind === 'charge' ? `boe_${id}` : null;
    if (source !== null) {
      await query(
        `INSERT INTO business_outcome_events
           (id, founder_id, exposure_id, kind, amount_cents, observed_at, provider,
            provider_event_ref, evidence_mode, counterparty)
         VALUES (?,?,'copy_exposure','payment',?,datetime('now'),'stripe',?,'real',
                 'unmatched_external')`, [source, OWNER, cents, `evt_${ref}`]);
    }
    await query(
      `INSERT INTO economic_events
         (id, founder_id, kind, amount_cents, occurred_at, provider, provider_ref,
          source_event_id, claim_quality, evidence_mode, because)
       VALUES (?,?,?,?,datetime('now'),'stripe',?,?,'measured','real',?)`,
      [id, OWNER, kind, cents, ref, source, `a ${kind} the provider reported`]);
  }
  await query(
    `INSERT INTO owner_allowances (id, product_id, purpose, statement, amount_cents, until)
     VALUES ('copy_allow','copy_test_asset','testing this idea','up to $20 on this test',
             2000, datetime('now','+30 days'))`);
  await query(
    `INSERT INTO owner_boundaries (id, product_id, subject, statement)
     VALUES ('copy_bound','copy_test_asset','contact_people','never cold-email anybody')`);
});

describe('a copy that reconstructs the liabilities, not just the schema', () => {
  it('reads what is owed, held, authorised and live out of the restored file', async () => {
    const { copyTheInstitution, restoreTheInstitution } =
      await import('../../src/services/institution/keeping.js');
    const kept = await copyTheInstitution();
    expect(kept.skipped).toBeNull();

    const back = await restoreTheInstitution(kept.wrote, join(dir, 'liabilities.db'));
    expect(back.tables).toBeGreaterThan(100);

    const by = (what: string) => back.liabilities.find((l) => l.what === what);
    // EVERY ONE OF THEM AGREES, which is the claim the restore is making.
    expect(back.liabilities.every((l) => l.same)).toBe(true);
    // AND THE NUMBERS ARE NOT ALL ZERO, or agreement would mean nothing. A
    // comparison of two empty databases agrees perfectly and establishes
    // nothing at all.
    expect(by('money taken from buyers')?.inTheCopy).toBe(4800);
    expect(by('money returned to buyers')?.inTheCopy).toBe(1900);
    expect(by('what this institution may still spend')?.inTheCopy).toBe(2000);
    expect(by('assets that are live')?.inTheCopy).toBe(2);
    expect(by('standing instructions the owner gave')?.inTheCopy).toBe(1);
  }, 120_000);

  it('says so when the copy and the live database disagree', async () => {
    // THE TEST THAT MAKES THE OTHER ONE MEAN SOMETHING. A verification that can
    // only ever come back "same" is decoration. Here the copy is taken, the
    // live institution takes another payment, and the restore has to notice
    // that the copy predates it rather than reporting a clean recovery.
    const { query } = await import('../../src/db/client.js');
    const { copyTheInstitution, restoreTheInstitution } =
      await import('../../src/services/institution/keeping.js');
    const kept = await copyTheInstitution();

    await query(
      `INSERT INTO business_outcome_events
         (id, founder_id, exposure_id, kind, amount_cents, observed_at, provider,
          provider_event_ref, evidence_mode, counterparty)
       VALUES ('boe_late',?,'copy_exposure','payment',3900,datetime('now'),'stripe',
               'evt_late','real','unmatched_external')`, [OWNER]);
    await query(
      `INSERT INTO economic_events
         (id, founder_id, kind, amount_cents, occurred_at, provider, provider_ref,
          source_event_id, claim_quality, evidence_mode, because)
       VALUES ('ce_late',?,'charge',3900,datetime('now'),'stripe','pi_late','boe_late',
               'measured','real','a payment that arrived after the copy was taken')`, [OWNER]);

    const back = await restoreTheInstitution(kept.wrote, join(dir, 'stale.db'));
    const charged = back.liabilities.find((l) => l.what === 'money taken from buyers');
    expect(charged?.same).toBe(false);
    expect(charged?.live).toBe(8700);
    expect(charged?.inTheCopy).toBe(4800);
    // The readings that did not move still agree: a difference is reported
    // where it is, not smeared across everything.
    expect(back.liabilities.find((l) => l.what === 'assets that are live')?.same).toBe(true);
  }, 120_000);

  it('still refuses to restore over the live database', async () => {
    const { restoreTheInstitution } =
      await import('../../src/services/institution/keeping.js');
    await expect(restoreTheInstitution(
      join(dir, 'liabilities.db'), join(dir, 'foundry.db')))
      .rejects.toThrow(/will_not_restore_over_the_live_database/);
  });
});
