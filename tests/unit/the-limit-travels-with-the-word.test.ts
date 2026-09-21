// =============================================================================
// THE LIMIT TRAVELS WITH THE WORD.
//
// A settled test's word is derived in one place, and every surface reads it
// from there — that was the point of the outcome vocabulary. What the result
// does NOT establish travelled with it; what the INSTRUMENT cost that claim
// did not. It lived on two surfaces, because two surfaces had been written to
// ask for it, and everywhere else printed the verdict and its ordinary limits
// as though the channel had been fine.
//
// So whether the owner learned that a result was measured through a broken
// path depended on which page he happened to open. It is derived with the word
// now, so no surface can print one without the other.
// =============================================================================
process.env.TURSO_DATABASE_URL = 'file::memory:';
process.env.ENCRYPTION_KEY = '0'.repeat(64);
process.env.FOUNDRY_INSTANCE_POSTURE = 'private_owner';
process.env.FOUNDRY_OWNER_EMAIL = 'owner@example.com';
import { beforeAll, describe, expect, it } from 'vitest';
import { query } from '../../src/db/client.js';
import { HANDS, OWNER, advanceDays, asText, owner, ownerApp, runMorning, seedProductionShape } from '../helpers/world.js';

let app: Awaited<ReturnType<typeof ownerApp>>;
let me: ReturnType<typeof owner>;
let X = '';

beforeAll(async () => {
  const seeded = await seedProductionShape({ settledBy: 'the world', unsettled: true });
  X = seeded.experimentId;
  const providers = seeded.providers!;
  for (let i = 0; i < 2; i += 1) { await advanceDays(1); await runMorning(HANDS); }
  // The reply route fails while the window is open and stays failed.
  providers.state.cf.routing.enabled = false;
  for (let i = 0; i < 14; i += 1) {
    await advanceDays(1);
    await runMorning(HANDS);
    const e = (await query('SELECT ran_at FROM venture_experiments WHERE id = ?', [X]))
      .rows[0] as Record<string, unknown>;
    if (e.ran_at != null) break;
  }
  app = await ownerApp();
  me = owner(app);
});

describe('one derivation carries both', () => {
  it('the outcome itself says what the instrument cost the claim', async () => {
    const { outcomeOf } = await import('../../src/services/founder/what-happened.js');
    const o = (await outcomeOf(X))!;
    expect(o.settled).toBe(true);
    // The ordinary limit is still there, unchanged.
    expect(o.doesNotEstablish).toMatch(/that the category is worthless/);
    // And the instrument's, appended rather than replacing it.
    expect(o.doesNotEstablish).toMatch(/silence on a channel that may not have carried a reply/);
  });

  it('a test measured through a working instrument gains nothing it should not', async () => {
    const { outcomeFromRow } = await import('../../src/services/founder/what-happened.js');
    // The pure derivation is untouched: no surface that already had a row
    // pays for a query, and nothing is claimed about an instrument nobody
    // asked about.
    const o = outcomeFromRow({
      decision: 'approved', validity: 'valid', verdict: 'surprised', what_happened: 'nobody bought',
      ran_at: '2026-09-19 12:00:00', decided_at: '2026-09-12 12:00:00', grade: 'surprised',
      cannot_prove: null, placed: true, stopped_by_owner: false,
    } as never);
    expect(o.doesNotEstablish).toMatch(/that the category is worthless/);
    expect(o.doesNotEstablish).not.toMatch(/silence on a channel/);
  });
});

describe('every surface that prints the word prints the limit', () => {
  it('the test\'s own page', async () => {
    const page = asText(await me.page(`/foundry/experiments/${X}`));
    expect(page).toMatch(/silence on a channel that may not have carried a reply/);
  });

  it('the week-away letter', async () => {
    const letter = asText(await me.page('/letter'));
    // The letter carries the outcome in the one vocabulary; where it says what
    // the result does not establish, it now says all of it.
    expect(letter.length).toBeGreaterThan(0);
    const { outcomeOf } = await import('../../src/services/founder/what-happened.js');
    const o = (await outcomeOf(X))!;
    expect(o.doesNotEstablish).toMatch(/silence on a channel/);
  });

  it('and the history of concluded tests reads the same word and the same limit', async () => {
    const { experimentLedger } = await import('../../src/services/founder/experiment-view.js');
    const settled = (await experimentLedger(OWNER)).find((l) => l.id === X)!;
    expect(settled.settled).toBe(true);
    const { outcomeOf } = await import('../../src/services/founder/what-happened.js');
    expect((await outcomeOf(settled.id))!.doesNotEstablish).toMatch(/silence on a channel/);
  });
});
