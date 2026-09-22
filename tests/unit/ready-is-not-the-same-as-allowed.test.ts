// =============================================================================
// READY IS NOT THE SAME AS ALLOWED.
//
// The owner's principle: Foundry "must not begin consequential real-world
// economic experiments until the capabilities, operational responsibilities,
// safeguards, and observation paths required by those particular experiments
// have been adequately qualified" — and a readiness assessment "must not be
// merely a checklist displayed in the owner interface. The actual action must
// be refused when a required condition is missing."
//
// Two things are held here, and they are different things.
//
// FIRST, that readiness is a reading over rows that already exist rather than
// a second ledger: the sealed design, the owner's decision, the allowance, the
// boundary, the capability's witnessed maturity, the exposure. The
// Workshop-carried mechanism defers wholesale to the two instruments that
// already answer for it — `publicationGate` and `hand.readiness` — because
// restating their conditions would be the duplicate register he asked for none
// of.
//
// SECOND, and this is the one that would have cost a customer: readiness gates
// what BEGINS exposure and never what DISCHARGES an obligation. An experiment's
// approved act also covers deliveries and refunds of purchases taken on while
// it stood. A rule that fired on every act bound to an experiment would refuse
// a refund the moment a venue credential expired — the owner's instruction
// exactly inverted. Somebody who has already paid is owed their thing whatever
// has since gone wrong with the machinery.
// =============================================================================
process.env.TURSO_DATABASE_URL = 'file::memory:';
process.env.ENCRYPTION_KEY = '8'.repeat(64);
process.env.FOUNDRY_INSTANCE_POSTURE = 'private_owner';
process.env.FOUNDRY_OWNER_EMAIL = 'thomas@example.com';

import { beforeAll, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { runMigrations } from '../../src/db/migrate.js';
import { query } from '../../src/db/client.js';
import { qualificationOf, qualificationStandsInTheWay } from '../../src/services/venture/qualification.js';
import { approveListing, seedProof2 } from '../../src/services/venture/proof-2.js';

const OWNER = 'rd_owner';
let X = '';

beforeAll(async () => {
  await runMigrations();
  await query('INSERT INTO founders (id,clerk_user_id,email,name) VALUES (?,?,?,?)',
    [OWNER, 'clerk_rd', 'thomas@example.com', 'Owner']);
  const seeded = await seedProof2(OWNER);
  X = seeded.experimentId;
  await approveListing({ founderId: OWNER, experimentId: X });
});

describe('it asks each mechanism only what its own economics require', () => {
  it('reads the workbook as a listing and asks about the venue', async () => {
    const r = await qualificationOf(X);
    expect(r.mechanism).toBe('listing');
    const names = r.conditions.map((c) => c.name).join(' | ');
    expect(names).toContain('Etsy can be operated');
    expect(names).toContain('the listing is live and its address is recorded');
    expect(names).toContain('what the venue reports can be read');
    // AND NOT ONE WORD ABOUT A PAYMENT LINK OR A REPLY ROUTE. Asking a
    // marketplace listing for the Workshop's own checkout is how a judgement
    // becomes a ritual.
    expect(names).not.toContain('page a buyer arrives at');
    expect(names).not.toContain('identity to write as');
  });

  it('names the row that decided each condition, never an adjective alone', async () => {
    const r = await qualificationOf(X);
    for (const c of r.conditions) {
      expect(c.because.length, c.name).toBeGreaterThan(10);
    }
  });
});

describe('what the Etsy workbook is actually waiting for, said plainly', () => {
  it('is not ready, and the reasons are the true ones', async () => {
    const r = await qualificationOf(X);
    expect(r.blocking.length).toBeGreaterThan(0);

    const by = new Map(r.conditions.map((c) => [c.name, c]));
    // No account has ever been connected, so every step of the venue is his.
    expect(by.get('Etsy can be operated')!.verdict).not.toBe('met');
    // The listing is not live. He said so; nothing here pretends otherwise.
    expect(by.get('the listing is live and its address is recorded')!.verdict).toBe('waits_for_you');
    // AND THE SILENCE WOULD MEAN NOTHING. This is the condition that stops an
    // experiment accidentally testing whether Foundry can see, rather than
    // whether anybody wants the thing.
    expect(by.get('what the venue reports can be read')!.because)
      .toContain('would not be evidence of no sales');
    // The promise the site already makes, which nothing here can keep.
    expect(by.get('a refund can be carried out')!.verdict).toBe('waits_for_you');
  });

  it('gives him one word for it rather than a checklist', async () => {
    const r = await qualificationOf(X);
    expect(['needs_external_account', 'testing_capability', 'needs_owner_authorisation'])
      .toContain(r.state);
  });

  it('counts the things it already has, so the state is not pessimism', async () => {
    const r = await qualificationOf(X);
    const metNames = r.conditions.filter((c) => c.verdict === 'met').map((c) => c.name);
    expect(metNames).toContain('there is something to deliver');
    expect(metNames).toContain('the prediction is sealed');
    expect(metNames).toContain('you approved it');
    expect(metNames).toContain('what it must not do is recorded');
  });
});

describe('it refuses the act, not merely the screen', () => {
  it('stands in the way of putting something in front of people', async () => {
    const stopped = await qualificationStandsInTheWay({ experimentId: X, tool: 'stripe_create_payment_link' });
    // `stripe_create_payment_link` is bound to `publish_offer`-shaped work in
    // the distribution family; if the binding ever moves, this assertion is
    // how we find out rather than discovering it in production.
    const fam = (await query(
      `SELECT c.family FROM capability_providers p JOIN capabilities c ON c.capability_key = p.capability_key
        WHERE p.tool = 'stripe_create_payment_link'`)).rows[0] as Record<string, unknown> | undefined;
    if (String(fam?.family) === 'distribution') {
      expect(stopped).not.toBeNull();
      expect(stopped!.refusal).toContain('not ready');
    } else {
      expect(stopped).toBeNull();
    }
  });

  it('NEVER stands in the way of a refund, whatever has since broken', async () => {
    // THE TRAP. An experiment's act covers refunds of purchases taken on while
    // it stood. If readiness fired on those, a venue credential expiring would
    // refuse somebody their money back — "preserve existing customer
    // obligations even when new spending, outreach, publication, or experiment
    // authority is withdrawn", exactly inverted.
    expect(await qualificationStandsInTheWay({
      experimentId: X, tool: 'stripe_create_refund', kind: 'refund',
    })).toBeNull();
  });

  it('never stands in the way of delivering what somebody already paid for', async () => {
    expect(await qualificationStandsInTheWay({
      experimentId: X, tool: 'send_email', kind: 'delivery',
    })).toBeNull();
  });

  // ── THE HOLE THIS SUITE USED TO CERTIFY ───────────────────────────────────
  //
  // The assertion above once read `{ tool: 'send_email' }` with no act, under
  // this same title, and passed — because the gate was keyed on the
  // capability's family and `send_email` is family `communication`. An
  // independent review pointed out what that title was quietly covering: an
  // OFFER goes out through the same tool. So an experiment blocked on an
  // unsealed prediction or a missing allowance mailed strangers, and the gate
  // was structurally unable to see it while a green test said obligations were
  // safe.
  //
  // Both facts are now asserted next to each other, which is the only honest
  // way to hold them: the same tool, the same experiment, opposite answers,
  // decided by what the act says it is doing.
  it('DOES stand in the way of an offer through that very same tool', async () => {
    const stopped = await qualificationStandsInTheWay({
      experimentId: X, tool: 'send_email', kind: 'offer',
    });
    expect(stopped, 'an unready test must not be able to offer').not.toBeNull();
    expect(stopped!.refusal).toContain('not ready');
  });

  it('never refuses taking an exposure back down', async () => {
    // Refusing a withdrawal because the test is not ready would strand a live
    // payment link for exactly as long as the unreadiness lasted.
    expect(await qualificationStandsInTheWay({
      experimentId: X, tool: 'stripe_deactivate_payment_link', kind: 'withdrawal',
    })).toBeNull();
  });

  it('is keyed on rows rather than a hand-written list of tool names', () => {
    const src = readFileSync('src/services/venture/qualification.ts', 'utf8');
    // Two rows, and both of them facts: the act the hand wrote and migration
    // 284 froze, and the capability's family where no act names the crossing.
    expect(src).toContain("String(fam.family) !== 'distribution'");
    expect(src).toContain("kind === 'delivery'");
    expect(src).toContain("kind !== 'offer'");
    // No allow-list of tools anywhere.
    expect(src).not.toMatch(/new Set\(\[\s*'stripe_create/);
  });

  it('reads the act off the row, so a caller cannot declare its own', async () => {
    const src = readFileSync('src/services/institution/standing-intent.ts', 'utf8');
    // `experiment_act` comes back from the hand's own claimed outbound row.
    expect(src).toContain('o.experiment_act');
    expect(src).toContain("message.experiment_act === 'offer'");
  });
});

describe('the door refuses it, so no entry point can go round it', () => {
  const gateway = readFileSync('src/services/outbound/gateway.ts', 'utf8');

  it('asks readiness inside invoke, where Ask, a screen, a routine and an agent all meet', () => {
    expect(gateway).toContain('qualificationStandsInTheWay');
    expect(gateway).toContain('experimentAct.experimentId');
  });

  it('keeps readiness a separate refusal from authority and from the rung', () => {
    // A test can be authorised and not ready, or ready and unauthorised. The
    // owner is never told "no" for a reason that is not the reason.
    expect(gateway).toContain('readiness:');
    expect(gateway).toContain('consequence:');
    expect(gateway).toContain('kill_switch:');
  });

  it('takes the experiment from the rows, never from the caller', () => {
    // `experimentAct` is resolved by the door from `experimentActFor`; nothing
    // a caller supplies can name a different test to be judged against.
    expect(gateway).toContain('const experimentAct = await experimentActFor(');
  });
});

describe('it is a reading, not a register', () => {
  const src = readFileSync('src/services/venture/qualification.ts', 'utf8');

  it('writes nothing at all', () => {
    expect(src).not.toMatch(/INSERT INTO|UPDATE .* SET|DELETE FROM/);
  });

  it('defers to the instruments that already answer for the Workshop', () => {
    expect(src).toContain('publicationGate');
    expect(src).toContain("readiness: sendingReadiness");
  });
});
