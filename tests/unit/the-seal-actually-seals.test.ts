process.env.TURSO_DATABASE_URL = 'file::memory:';
process.env.ENCRYPTION_KEY = '0'.repeat(64);
process.env.FOUNDRY_INSTANCE_POSTURE = 'private_owner';
process.env.FOUNDRY_OWNER_EMAIL = 'owner@example.com';

import { beforeAll, describe, expect, it } from 'vitest';
import { runMigrations } from '../../src/db/migrate.js';
import { query } from '../../src/db/client.js';

// =============================================================================
// THE SEAL ACTUALLY SEALS.
//
// Twenty-one businesses were sealed into production carrying no stratum at all,
// and every gate said the build was clean. Three things had to line up for that:
// the wiring was lost to an edit that died before it wrote the file, the call
// sat inside a try/catch that swallowed its own failure, and NOTHING ANYWHERE
// TESTED THE SEAL — only the list it seals from.
//
// A green chain that cannot tell you the seal did nothing is the failure this
// file exists to prevent. So these tests run the writers against a real database
// and then read the rows back, because "it did not throw" is not evidence that
// anything was written.
// =============================================================================

const OWNER = 'seal_owner';
let X = '';

beforeAll(async () => {
  await runMigrations();
  await query('INSERT INTO founders (id,clerk_user_id,email,name) VALUES (?,?,?,?)',
    [OWNER, 'clerk_s1', 'seal@example.com', 'Owner']);
  const { openMandate } = await import('../../src/services/venture/mandate.js');
  const { designExperiment } = await import('../../src/services/venture/validation.js');
  const opened = await openMandate({ founderId: OWNER, statement: 'Make the river stronger', shape: null, evidenceMode: 'real' });
  if ('refused' in opened) throw new Error(opened.refused);
  const oppId = 'opp_seal';
  await query(
    `INSERT INTO venture_opportunities (id, mandate_id, founder_id, headline, who_has_it, the_problem, why_it_might, kill_thesis, sources_json, evidence_mode)
     VALUES (?,?,?,?,?,?,?,?,?,'real')`,
    [oppId, opened.id, OWNER, 'a brief', 'MA millwork shops', 'notices are scattered', 'somebody sells it', 'nobody pays', '[]']);
  await query(
    `INSERT INTO market_unknowns (id, founder_id, opportunity_id, question, blocking, cheapest_test)
     VALUES ('unk_seal',?,?,'will anyone pay',1,'write once')`, [OWNER, oppId]);
  X = await designExperiment({
    founderId: OWNER, opportunityId: oppId, unknownId: 'unk_seal', evidenceMode: 'real',
    whatWeDo: 'write once to each approved business', whatWeExpect: 'at least one pays',
    wouldDisprove: 'nobody pays', costCents: 0,
  });
});

describe('a business is only sealed when the row says so', () => {
  it('records the stratum, and a swallowed failure cannot hide that it did not', async () => {
    const { addRecipients, qualifyRecipient, recordStratum, recipientsOf } = await import('../../src/services/venture/hand.js');
    await addRecipients({ founderId: OWNER, experimentId: X,
      recipients: [{ counterpartyRef: 'A Shop, Lowell', email: 'estimating@example.com', channel: 'email', sourceUrl: 'https://example.com/' }] });
    const r = (await recipientsOf(X)).find((x) => x.counterpartyRef === 'A Shop, Lowell')!;
    expect(r.evidenceStratum, 'a recipient is not born in a stratum').toBeNull();

    await qualifyRecipient({ founderId: OWNER, experimentId: X, recipientId: r.id,
      because: 'its own site names a public school project', source: 'https://example.com/' });
    await recordStratum({ founderId: OWNER, experimentId: X, recipientId: r.id, stratum: 'public_work_observed' });

    // READ IT BACK. The bug that produced this file did not throw.
    const after = (await recipientsOf(X)).find((x) => x.id === r.id)!;
    expect(after.evidenceStratum).toBe('public_work_observed');
  });

  it('refuses a stratum on a business with no recorded reason to be in the population', async () => {
    const { addRecipients, recordStratum, recipientsOf } = await import('../../src/services/venture/hand.js');
    await addRecipients({ founderId: OWNER, experimentId: X,
      recipients: [{ counterpartyRef: 'B Shop, Canton', email: 'bids@example.com', channel: 'email', sourceUrl: 'https://b.example/' }] });
    const r = (await recipientsOf(X)).find((x) => x.counterpartyRef === 'B Shop, Canton')!;
    await expect(recordStratum({ founderId: OWNER, experimentId: X, recipientId: r.id, stratum: 'commercial_institutional_capable' }))
      .rejects.toThrow(/stratum_needs_a_qualification/);
  });

  it('will not let a stratum be rewritten once the cohort is sealed', async () => {
    // THE GUARD THAT COST A PRODUCTION ROW. A stratum written by mistake cannot
    // be corrected in place, which is deliberate: if it could, whichever group
    // paid could be relabelled afterwards as the one always expected to. The
    // price is that a wrong write is permanent, and this test states that price
    // rather than discovering it again on a live database.
    const { qualifyRecipient, recordStratum, recipientsOf, addRecipients } = await import('../../src/services/venture/hand.js');
    await addRecipients({ founderId: OWNER, experimentId: X,
      recipients: [{ counterpartyRef: 'C Shop, Norton', email: 'sales@example.com', channel: 'email', sourceUrl: 'https://c.example/' }] });
    const r = (await recipientsOf(X)).find((x) => x.counterpartyRef === 'C Shop, Norton')!;
    await qualifyRecipient({ founderId: OWNER, experimentId: X, recipientId: r.id,
      because: 'its own site shows commercial millwork', source: 'https://c.example/' });
    await recordStratum({ founderId: OWNER, experimentId: X, recipientId: r.id, stratum: 'commercial_institutional_capable' });

    await expect(query('UPDATE experiment_recipients SET evidence_stratum = ? WHERE id = ?',
      ['public_work_observed', r.id])).rejects.toThrow(/stratum_stands/);
    await expect(query('UPDATE experiment_recipients SET evidence_stratum = NULL WHERE id = ?', [r.id]))
      .rejects.toThrow(/stratum_stands/);
  });

  it('turns a write that changed nothing into a failure, not a silent success', async () => {
    // THE SHAPE OF THE ORIGINAL BUG. recordStratum updates WHERE the stratum is
    // still null; if it matches nothing it must say so. A writer that returns
    // quietly on zero rows is indistinguishable from one that worked, and that
    // is precisely how twenty-one businesses were sealed with no stratum while
    // every gate reported clean.
    const { recordStratum, recordContactChoice } = await import('../../src/services/venture/hand.js');
    await expect(recordStratum({ founderId: OWNER, experimentId: X,
      recipientId: 'rcpt_does_not_exist', stratum: 'public_work_observed' }))
      .rejects.toThrow(/recipient_not_found/);
    await expect(recordContactChoice({ founderId: OWNER, experimentId: X,
      recipientId: 'rcpt_does_not_exist', kind: 'role', source: 'somewhere' }))
      .rejects.toThrow(/recipient_not_found/);
  });

  it('does not swallow the stratum write inside the seal', async () => {
    // The call was once wrapped in `try { ... } catch {}`, so even a refusal
    // read as success. This asserts the source, because the behaviour it guards
    // only shows up on a database that refuses -- which is the case nobody
    // remembers to build a fixture for.
    const { readFileSync } = await import('node:fs');
    const src = readFileSync('src/services/venture/proof-1-cohort.ts', 'utf8');
    const call = src.indexOf('await recordStratum(');
    expect(call, 'the seal no longer records a stratum at all').toBeGreaterThan(-1);
    const before = src.slice(Math.max(0, call - 400), call);
    const swallowed = /try\s*\{[^}]*$/.test(before);
    expect(swallowed, 'the stratum write is inside a try block that can swallow its failure').toBe(false);
  });

  it('leaves an existing address alone rather than writing one the owner did not choose', async () => {
    // WHAT MADE A COHORT OF TWENTY-ONE BEHAVE LIKE NINETEEN. An older pass had
    // created rows from a shallower read that found no address, channel
    // web_form. addRecipients leaves an existing row alone, so the cohort's
    // address never reached the row and the business was qualified and
    // unreachable at the same time.
    const { addRecipients, recipientsOf } = await import('../../src/services/venture/hand.js');
    await addRecipients({ founderId: OWNER, experimentId: X,
      recipients: [{ counterpartyRef: 'D Shop, Webster', email: null, channel: 'web_form', sourceUrl: 'https://d.example/' }] });
    await addRecipients({ founderId: OWNER, experimentId: X,
      recipients: [{ counterpartyRef: 'D Shop, Webster', email: 'contact@d.example', channel: 'email', sourceUrl: 'https://d.example/' }] });
    const all = (await recipientsOf(X)).filter((x) => x.counterpartyRef === 'D Shop, Webster');
    expect(all, 'one business, one row').toHaveLength(1);
    expect(all[0].email, 'the institution wrote an address onto an existing recipient').toBeNull();
    expect(all[0].channel).toBe('web_form');
  });
});
