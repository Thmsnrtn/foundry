// =============================================================================
// A RECIPE'S INTENTION IS NOT AN OBSERVED FACT.
//
// The premises that decide what an asset is ALLOWED to do were written by the
// recipe that proposes it, and the policy that consumes them never asked where
// they came from. "Sells to Massachusetts businesses only" satisfied "does not
// sell across a border" exactly as an observation would — and it is an
// intention: the way to pay is a public link that takes a card from anywhere.
//
// This is the observation-integrity campaign turned inward. Foundry spent the
// whole campaign learning not to treat a configuration row as proof that an
// external path works. The same discipline belongs on the facts that govern
// what it may do, and it was not there. Deterministic enforcement cannot
// compensate for a false premise handed to it.
//
//   a claim says how it is known → an assumption cannot satisfy a binding
//   requirement once an offer has a shape → a claim that says "enforced" must
//   name what enforces it → and what was already recorded is not re-judged.
//
// AND ONE CLAIM SURVIVED BEING CHECKED. A reviewer inferred that the order
// record must hold the buyer's email. That is sound about most institutions
// and wrong about this one, and the difference is only visible to somebody who
// looked: the address is read from the provider at delivery, and what remains
// is a keyed hash. The inference was not accepted; it was tested.
// =============================================================================
process.env.TURSO_DATABASE_URL = 'file::memory:';
process.env.ENCRYPTION_KEY = '0'.repeat(64);
process.env.FOUNDRY_INSTANCE_POSTURE = 'private_owner';
process.env.FOUNDRY_OWNER_EMAIL = 'owner@example.com';

import { beforeAll, describe, expect, it } from 'vitest';
import { runMigrations } from '../../src/db/migrate.js';
import { query } from '../../src/db/client.js';
import { PROOF1_PLAN } from '../../src/services/venture/proof-1.js';
import { briefFacts } from '../../src/services/venture/products/offer-composition.js';

const OWNER = 'rf_owner';

beforeAll(async () => {
  await runMigrations();
  await query(`INSERT INTO founders (id, clerk_user_id, email, name) VALUES (?,?,?,?)`,
    [OWNER, 'rf_clk', 'owner@example.com', 'Thomas Norton']);
});

describe('every premise says how it is known', () => {
  it("the institution's own first offer classifies all of its facts", () => {
    const facts = Object.entries(PROOF1_PLAN.facts);
    expect(facts.length).toBeGreaterThan(5);
    for (const [name, f] of facts) {
      expect(f.basis, `${name} must say what kind of claim it is`).toBeDefined();
      expect(['enforced', 'observed', 'assumed']).toContain(f.basis);
    }
  });

  it('and the one that was an intention says so, rather than passing as a finding', () => {
    // The offer is written for Massachusetts businesses and only they are
    // contacted. The way to pay takes a card from anywhere, and nothing in
    // this institution refuses one.
    expect(PROOF1_PLAN.facts.cross_border_selling.basis).toBe('assumed');
    expect(PROOF1_PLAN.facts.cross_border_selling.grounds)
      .toContain('not restricted by country');
  });

  it('an enforced claim names the control that would refuse', () => {
    for (const [name, f] of Object.entries({ ...PROOF1_PLAN.facts, ...briefFacts() })) {
      if (f.basis !== 'enforced') continue;
      expect(f.enforcedBy, `${name} claims enforcement and must name what enforces it`)
        .toBeTruthy();
    }
    expect(PROOF1_PLAN.facts.recurring_billing.enforcedBy).toContain('refuses a recurring link');
  });

  it('a claim that survives being checked keeps its answer, and says what IS kept', () => {
    // NOT THE INFERENCE — THE CHECK. `buyerAddressFor` reads the address from
    // the provider at delivery; the durable trace is a keyed hash.
    const f = PROOF1_PLAN.facts.persistent_personal_data;
    expect(f.present).toBe(0);
    expect(f.basis).toBe('observed');
    expect(f.grounds, 'and it describes the hash rather than implying nothing remains')
      .toContain('keyed hash');
  });
});

describe('the rows refuse a claim that cannot support itself', () => {
  const fact = async (basis: string, enforcedBy: string | null): Promise<void> => {
    await query(
      `INSERT INTO structural_facts (id, founder_id, subject_kind, subject_id, fact, present, basis, grounds, enforced_by, recognised_by, evidence_mode)
       VALUES (?,?,'company','rf_subject','recurring_billing',0,?,'because',?,'test','real')`,
      [`sf_${basis}_${String(Math.random()).slice(2, 8)}`, OWNER, basis, enforcedBy]);
  };

  it('"enforced" without a named control is refused outright', async () => {
    await expect(fact('enforced', null)).rejects.toThrow(/structural_fact:enforced_names_nothing/);
    await expect(fact('enforced', '   ')).rejects.toThrow(/structural_fact:enforced_names_nothing/);
  });

  it('and naming one is all it takes, because the naming is the discipline', async () => {
    await query(`DELETE FROM structural_facts WHERE subject_id = 'rf_subject'`);
    await expect(fact('enforced', 'the payment-link gate refuses a recurring price')).resolves.toBeUndefined();
  });

  it('an unclassified fact is an assumption, not a finding', async () => {
    // THE DEFAULT IS THE HONEST ONE. A fact nobody classified came from a
    // recipe; calling it anything better would let the next recipe satisfy a
    // binding requirement by asserting it, which is the defect itself.
    const { statedShapeAndFacts } = await import('../../src/services/venture/hand.js');
    expect(typeof statedShapeAndFacts).toBe('function');
    const src = (await import('node:fs')).readFileSync('src/services/venture/hand.ts', 'utf-8');
    expect(src).toContain("f.basis ?? 'assumed'");
  });
});

describe('what the policy does with each kind', () => {
  it('an assumption cannot satisfy a binding requirement once an offer has a shape', async () => {
    const src = (await import('node:fs')).readFileSync('src/services/venture/legal-surface.ts', 'utf-8');
    expect(src).toContain("fact.basis === 'assumed'");
    expect(src).toContain('is assumed rather than checked');
    expect(src, 'and it says what would settle it')
      .toContain('something that enforces it or somebody who has looked');
  });

  it('and what was recorded before the distinction existed is not re-judged', async () => {
    // A ROW WRITTEN `offer_shape` PREDATES THE QUESTION. Treating it as an
    // assumption now would block an institution on no new evidence about it,
    // and would be exactly the retroactive rewriting the migration refused.
    const src = (await import('node:fs')).readFileSync('src/services/venture/legal-surface.ts', 'utf-8');
    expect(src).not.toContain("fact.basis === 'offer_shape'");
    const kinds = (await query(
      `SELECT sql FROM sqlite_master WHERE name = 'structural_facts' AND type = 'table'`))
      .rows[0] as Record<string, unknown>;
    expect(String(kinds.sql), 'the old basis is still a value the column accepts').toContain("'offer_shape'");
  });
});
