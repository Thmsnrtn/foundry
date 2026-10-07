// =============================================================================
// THE SMALLER TRUTHS OF STAGE ONE (F1.7).
//
// Three defects, each small and each a lie told to someone:
//
//  1. Every forge-made offer said the Workshop was "a small digital workshop in
//     Massachusetts" — a literal in code, whatever the Workshop's own address
//     said. The place is now the one on the Workshop's postal address, or none.
//  2. A search that came back with nothing on the subject was filed `supports`
//     (with `from_absence`) and then counted, shown and handed to the forge's
//     lenses as support. It now reads as `found_nothing`.
//  3. `real_market_evidence_tick` failed the whole pass every morning for one
//     claim the registry could not be asked about, and the failed claim was
//     first in line again the next day. Its failure is now recorded against
//     the claim: every other claim is still looked at, it backs off 1, 2, 4
//     days, and after CLAIM_LOOK_GIVES_UP_AFTER it is left (and Controls
//     names it). A pass in which a claim failed still says it failed (G3).
//     (Reconciled onto remediation 1.6's `claim_look_failures`, which kept
//     G3's rule that a failure this pass fails the pass; Stage 1's version
//     passed whenever any claim was read.)
// =============================================================================
process.env.TURSO_DATABASE_URL = 'file::memory:';
process.env.ENCRYPTION_KEY = '1'.repeat(64);

import { readFileSync } from 'node:fs';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { stripComments } from '../../scripts/lib/strip-comments.mjs';

/** Claims whose words contain this are the ones the registry cannot be asked about. */
let unreadable = 'invoices';
const asked: string[] = [];

vi.mock('../../src/services/venture/research-sources.js', async (orig) => ({
  ...(await orig<Record<string, unknown>>()),
  waysOfLooking: vi.fn(async () => [{ sourceType: 'directory' }]),
}));
vi.mock('../../src/services/venture/sources/index.js', async (orig) => ({
  ...(await orig<Record<string, unknown>>()),
  askWhatAlreadyExists: vi.fn(async (i: { claimId: string; query: string }) => {
    asked.push(i.claimId);
    if (i.query.includes(unreadable)) throw new Error('the registry did not answer');
    return {};
  }),
}));

const { runMigrations } = await import('../../src/db/migrate.js');
const { query } = await import('../../src/db/client.js');
const { JOB_REGISTRY } = await import('../../src/jobs/index.js');
const { renderOfferTemplate } = await import('../../src/services/venture/products/registry.js');
const { workshopRegion } = await import('../../src/services/public-workshop/settings.js');
const { bearingAsRead, standingOf, observe, formClaim, claimMayBeLookedAt, CLAIM_LOOK_GIVES_UP_AFTER } =
  await import('../../src/services/venture/market-evidence.js');

const OWNER = 'st_owner';
const plan = {
  shape: { sells: 'a short brief of open bids.' },
  price: { amountCents: 2900, recurring: false },
} as unknown as Parameters<typeof renderOfferTemplate>[0];

beforeAll(async () => {
  await runMigrations();
  await query('INSERT INTO founders (id,clerk_user_id,email,name) VALUES (?,?,?,?)', [OWNER, 'clerk_st', 'st@example.com', 'Owner']);
});

describe('an offer names the place on record, or none', () => {
  it('reads the state from the Workshop\'s own postal address', () => {
    expect(workshopRegion({ postalAddress: 'Apex Micro\n1 Example Drive\nAlbany, NY 12207' })).toBe('New York');
    expect(workshopRegion({ postalAddress: 'Apex Micro\n1 Example Drive\nSalem, MA 01970-1234' })).toBe('Massachusetts');
  });

  it('names no place when the address does not say one', () => {
    expect(workshopRegion({ postalAddress: null })).toBeNull();
    expect(workshopRegion({ postalAddress: 'Apex Micro\n1 Example Drive' })).toBeNull();
    expect(workshopRegion({ postalAddress: 'Apex Micro\n10 Downing St\nLondon SW1A 2AA' })).toBeNull();
    const offer = renderOfferTemplate(plan, 'Apex Micro', null);
    expect(offer).toContain('Apex Micro is a small digital workshop. It has put together');
    expect(offer).not.toMatch(/workshop in /);
  });

  it('says the place it was given', () => {
    expect(renderOfferTemplate(plan, 'Apex Micro', 'New York')).toContain('a small digital workshop in New York.');
  });

  it('the brief maker takes the place from the Workshop, not from a literal', () => {
    const src = stripComments(readFileSync('src/services/venture/products/registry.ts', 'utf8'));
    expect(src).toMatch(/renderOfferTemplate\([^)]*workshopRegion\(w\)\)/);
    // No US state name may stand in for the Workshop's place in the brief maker.
    expect(src).not.toMatch(/'(Massachusetts|New York|California|Texas)'/);
  });
});

describe('a search that found nothing is not support', () => {
  it('reads as found_nothing, whatever it was filed as', () => {
    expect(bearingAsRead('supports', 1)).toBe('found_nothing');
    expect(bearingAsRead('supports', 0)).toBe('supports');
    expect(bearingAsRead('contradicts', 1)).toBe('contradicts');
  });

  it('is counted and said as what it is', async () => {
    const claimId = await formClaim({ founderId: OWNER, claim: 'nothing maintained exists for bid tracking', evidenceMode: 'real' });
    await observe({ founderId: OWNER, claimId, sourceType: 'directory', source: 'https://example.test/search?q=bid',
      saw: 'the search returned nothing on bid tracking', bearing: 'supports', directness: 'inferred',
      observedAt: new Date(), evidenceMode: 'real', fromAbsence: true });
    const s = await standingOf(claimId);
    expect(s?.supports).toBe(0);
    expect(s?.foundNothing).toBe(1);
    expect(s?.howItStands).toMatch(/found nothing/);
    expect(s?.howItStands).toMatch(/not support/);
    expect(s?.howItStands).not.toMatch(/supports? this/);
  });
});

describe('one claim that cannot be looked at waits, and does not stop the others', () => {
  let bad = '';
  let good = '';

  beforeAll(async () => {
    const { openMandate } = await import('../../src/services/venture/mandate.js');
    await query("INSERT INTO products (id, name, owner_id, status, reality) VALUES ('st_co','Apex Micro',?,'active','real')", [OWNER]);
    const m = await openMandate({ founderId: OWNER, statement: 'Small things for trades businesses', shape: null, evidenceMode: 'real' });
    if ('refused' in m) throw new Error(m.refused);
    bad = await formClaim({ founderId: OWNER, claim: 'contractors reconcile invoices by hand', evidenceMode: 'real' });
    good = await formClaim({ founderId: OWNER, claim: 'contractors track their bids by hand', evidenceMode: 'real' });
    // The fixture from the absence block above already has an observation; it is not in line.
  });

  it('looks at every other claim, records the failure against the claim, and the pass says it failed (G3)', async () => {
    asked.length = 0;
    await expect(JOB_REGISTRY.real_market_evidence_tick.fn()).rejects.toThrow(/could not be looked at/);
    expect(asked).toContain(bad);
    expect(asked).toContain(good);
    const f = await claimMayBeLookedAt(bad, new Date());
    expect(f.failed).toBe(1);
    expect(f.may).toBe(false);
  });

  it('the failed claim waits a day, then two, and after the last failure is not asked again', async () => {
    const DAY = 86_400_000;
    const at = (d: number) => new Date(Date.now() + d * DAY);
    expect((await claimMayBeLookedAt(bad, at(0.5))).may).toBe(false);
    expect((await claimMayBeLookedAt(bad, at(1.01))).may).toBe(true);
    // Age the failures so the pass reaches the claim again, as the days would.
    for (let n = 2; n <= CLAIM_LOOK_GIVES_UP_AFTER; n += 1) {
      await query(`UPDATE claim_look_failures SET failed_at = ? WHERE claim_id = ?`, [new Date(Date.now() - 10 * DAY).toISOString(), bad]);
      asked.length = 0;
      await JOB_REGISTRY.real_market_evidence_tick.fn().catch(() => undefined);
      expect(asked, `pass ${String(n)} should look at the failed claim again`).toContain(bad);
    }
    const f = await claimMayBeLookedAt(bad, at(100));
    expect(f.failed).toBe(CLAIM_LOOK_GIVES_UP_AFTER);
    expect(f.may).toBe(false);
    // Left, it is not asked again however long it waits, and the pass passes.
    await query(`UPDATE claim_look_failures SET failed_at = ? WHERE claim_id = ?`, [new Date(Date.now() - 100 * DAY).toISOString(), bad]);
    asked.length = 0;
    await expect(JOB_REGISTRY.real_market_evidence_tick.fn()).resolves.toBeUndefined();
    expect(asked).not.toContain(bad);
  });
});
