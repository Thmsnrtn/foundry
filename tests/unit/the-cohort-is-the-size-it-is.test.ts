process.env.TURSO_DATABASE_URL = 'file::memory:';
process.env.ENCRYPTION_KEY = '0'.repeat(64);
process.env.FOUNDRY_INSTANCE_POSTURE = 'private_owner';
process.env.FOUNDRY_OWNER_EMAIL = 'owner@example.com';

import { beforeAll, describe, expect, it } from 'vitest';
import { runMigrations } from '../../src/db/migrate.js';
import { query } from '../../src/db/client.js';
import {
  PROOF1_COHORT, PROOF1_NEARLY, cohortSummary,
} from '../../src/services/venture/proof-1-cohort.js';
import {
  STANDING_EXCLUSIONS, applyStandingExclusions, exclusionsFor, liftExclusion, whyExcluded,
} from '../../src/services/institution/owner-exclusions.js';

// =============================================================================
// THE COHORT IS THE SIZE IT IS.
//
// The amendment asked for thirty to fifty businesses and eight met the sealed
// standard. The temptation those two numbers create is the thing under test
// here: pad the list, guess an address for a shop that publishes none, or
// quietly promote the near-misses into the cohort because eight looks thin.
//
// So these are not tests that the code runs. They are tests that the list is
// honest, and each one fails loudly if somebody later closes the gap the easy
// way instead of the true way.
// =============================================================================

const OWNER = 'cohort_owner';

beforeAll(async () => {
  await runMigrations();
  await query('INSERT INTO founders (id,clerk_user_id,email,name) VALUES (?,?,?,?)',
    [OWNER, 'clerk_c1', 'cohort@example.com', 'Owner']);
});

describe('every business in the cohort earned its place and says how', () => {
  it('carries grounds, a source, and an account of how its address was chosen', () => {
    for (const m of PROOF1_COHORT) {
      expect(m.counterpartyRef.trim(), 'a business with no name').not.toBe('');
      expect(m.because.trim().length, `${m.counterpartyRef}: grounds too thin to be grounds`)
        .toBeGreaterThan(60);
      expect(m.source.trim(), `${m.counterpartyRef}: no source`).not.toBe('');
      expect(m.contactSource.trim().length, `${m.counterpartyRef}: no account of the address`)
        .toBeGreaterThan(20);
    }
  });

  it('writes to one address per business, and never the same address twice', () => {
    const seen = new Set<string>();
    for (const m of PROOF1_COHORT) {
      expect(m.email).toMatch(/^[^@\s]+@[^@\s]+\.[a-z]{2,}$/i);
      expect(seen.has(m.email), `${m.email} appears twice`).toBe(false);
      seen.add(m.email);
    }
    expect(seen.size).toBe(PROOF1_COHORT.length);
  });

  it('prefers a published bid mailbox over the general inbox wherever one exists', () => {
    // THE POINT OF THE CHANNEL COLUMN. If this ever reads zero, somebody has
    // replaced considered address selection with "write to info@", and the
    // experiment's answer about the channel stops meaning anything.
    const s = cohortSummary();
    expect(s.byContact.role, 'not one business is being written to at the mailbox it asked for')
      .toBeGreaterThan(0);
    expect(s.byContact.role + s.byContact.named + s.byContact.general).toBe(s.total);
    expect(s.nearly).toBe(PROOF1_NEARLY.length);
  });

  it('keeps the near-misses out of the cohort entirely', () => {
    // PROOF1_NEARLY is the cost of holding the standard, written down. The
    // moment a name appears in both lists, the standard has quietly moved and
    // the cohort's size has stopped meaning what it says.
    const inCohort = new Set(PROOF1_COHORT.map((m) => m.counterpartyRef.toLowerCase()));
    for (const n of PROOF1_NEARLY) {
      expect(inCohort.has(n.counterpartyRef.toLowerCase()),
        `${n.counterpartyRef} is in the cohort and on the list of businesses that did not qualify`)
        .toBe(false);
      expect(n.shortOf.trim().length, `${n.counterpartyRef}: no reason it fell short`)
        .toBeGreaterThan(30);
    }
  });

  it('never contains a business the owner has excluded', async () => {
    await applyStandingExclusions(OWNER);
    for (const m of PROOF1_COHORT) {
      const no = await whyExcluded({ founderId: OWNER, name: m.counterpartyRef, email: m.email, url: m.source });
      expect(no.excluded, `${m.counterpartyRef} is excluded and is in the cohort anyway`).toBe(false);
    }
    for (const n of PROOF1_NEARLY) {
      const no = await whyExcluded({ founderId: OWNER, name: n.counterpartyRef, email: n.email, url: '' });
      expect(no.excluded, `${n.counterpartyRef} is excluded and is offered as a near-miss anyway`).toBe(false);
    }
  });
});

describe('a standing exclusion survives a fresh machine without overriding the owner', () => {
  it('is applied before anything else and catches the business by name, domain and address', async () => {
    await applyStandingExclusions(OWNER);
    const standing = await exclusionsFor(OWNER);
    expect(standing.length).toBeGreaterThanOrEqual(STANDING_EXCLUSIONS.length);
    const byName = await whyExcluded({ founderId: OWNER, name: 'Nirvana Upfitters LLC', email: null, url: null });
    const byMail = await whyExcluded({ founderId: OWNER, name: null, email: 'sales@nirvanaupfitters.com', url: null });
    const bySite = await whyExcluded({ founderId: OWNER, name: null, email: null, url: 'https://www.nirvanaupfitters.com/about' });
    for (const [what, r] of [['name', byName], ['a second mailbox', byMail], ['its website', bySite]] as const) {
      expect(r.excluded, `the business walked through under ${what}`).toBe(true);
    }
  });

  it('does not record the private reason it was excluded', async () => {
    // He gave a reason and asked that it not be exposed. A reason on the row
    // travels with every copy of the database and every page that renders it.
    await applyStandingExclusions(OWNER);
    for (const x of await exclusionsFor(OWNER)) {
      expect(x.because.toLowerCase()).not.toMatch(/because he|fell out|dispute|complain|refus(ed|al)|angry|bad experience/);
    }
  });

  it('is idempotent, and re-running it never reinstates one the owner lifted', async () => {
    const founder = 'cohort_lifter';
    await query('INSERT INTO founders (id,clerk_user_id,email,name) VALUES (?,?,?,?)',
      [founder, 'clerk_c2', 'lifter@example.com', 'Owner']);
    await applyStandingExclusions(founder);
    const first = await exclusionsFor(founder);
    await applyStandingExclusions(founder);
    expect((await exclusionsFor(founder)).length, 'a second run duplicated the boundary')
      .toBe(first.length);

    const lifted = await liftExclusion({ founderId: founder, id: first[0].id, because: 'he changed his mind, in writing' });
    expect(lifted.lifted).toBe(true);
    expect(await exclusionsFor(founder)).toHaveLength(first.length - 1);

    // THE PLANTED DEFECT: a boot that re-applies standing exclusions must not
    // undo the owner's own reversal. If this fails, the institution overrides
    // him every time the process restarts.
    await applyStandingExclusions(founder);
    const after = await exclusionsFor(founder);
    expect(after.some((x) => x.id === first[0].id),
      'the institution reinstated a boundary the owner had lifted').toBe(false);
  });
});
