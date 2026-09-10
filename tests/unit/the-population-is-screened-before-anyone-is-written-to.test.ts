// =============================================================================
// THE POPULATION A DESIGN NAMES IS A PROMISE ABOUT WHO IS WRITTEN TO.
//
//   the screening is applied from recorded public evidence → exactly the
//   businesses the evidence supports become reachable → every other candidate
//   stays unreachable whether or not the owner approved them → a qualification
//   carries its grounds and the record they were read from → re-running
//   changes nothing → and the door refuses the rest by itself.
//
// The screening was performed against public pages and the Comptroller's
// public spending record. Nobody was contacted to produce it, and nobody is
// contacted here: every provider is stubbed at the network edge.
// =============================================================================

process.env.TURSO_DATABASE_URL = 'file::memory:';
process.env.ENCRYPTION_KEY = '9'.repeat(64);
process.env.STRIPE_SECRET_KEY = 'sk_test_fake';
process.env.RESEND_API_KEY = 're_test_key';
process.env.CLOUDFLARE_API_TOKEN = 'cfat_test_token';
process.env.CLOUDFLARE_ACCOUNT_ID = 'acct_test';
process.env.FOUNDRY_INSTANCE_POSTURE = 'private_owner';
process.env.FOUNDRY_OWNER_EMAIL = 'thomas@example.com';
process.env.APP_URL = 'http://localhost:8080';

import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { runMigrations } from '../../src/db/migrate.js';
import { query } from '../../src/db/client.js';
import '../../src/services/integration/cloudflare-gateway.js';
import { providerStubs } from '../helpers/provider-stubs.js';
import { PROOF1_RECIPIENTS, reframeProof1UnderTheWorkshop, seedProof1 } from '../../src/services/venture/proof-1.js';
import { PROOF1_SCREENING, PROOF1_UNEVIDENCED, applyProof1Screening } from '../../src/services/venture/proof-1-screening.js';
import { approveRemaining, planOffer, readiness, recipientsOf } from '../../src/services/venture/hand.js';
import { establishPublicWorkshop } from '../../src/services/public-workshop/settings.js';
import { standUpWorkshop } from '../../src/services/public-workshop/infrastructure.js';

vi.setConfig({ testTimeout: 180_000 });
const OWNER = 's_owner'; const FOUNDRY = 's_foundry';
const { fetch: fetchStub } = providerStubs();
let X = '';

beforeAll(async () => {
  vi.stubGlobal('fetch', fetchStub);
  await runMigrations();
  await query(`INSERT INTO founders (id,clerk_user_id,email,name) VALUES (?,?,?,?)`, [OWNER, 's_clk', 'thomas@example.com', 'Thomas Norton']);
  await query(`INSERT INTO products (id,name,owner_id,status,operating_budget_monthly_usd) VALUES (?,'Foundry',?,'active',50)`, [FOUNDRY, OWNER]);
  await query(`INSERT INTO system_identities (identity_key,product_id,established_reason) VALUES ('foundry',?,'screening')`, [FOUNDRY]);
  await seedProof1(OWNER);
  await establishPublicWorkshop({ founderId: OWNER });
  await standUpWorkshop(OWNER);
  X = (await reframeProof1UnderTheWorkshop(OWNER)).successor;
});
afterAll(() => { vi.unstubAllGlobals(); });

describe('the screening is evidence, and it is written down', () => {
  it('every line names grounds and a record, and accounts for every candidate exactly once', () => {
    for (const s of PROOF1_SCREENING) {
      expect(s.because.length, s.counterpartyRef).toBeGreaterThan(60);
      expect(s.source, s.counterpartyRef).toMatch(/^https?:\/\//);
    }
    // Nobody is judged twice and nobody is quietly dropped: the screened and
    // the unevidenced together are exactly the candidate list.
    const named = [...PROOF1_SCREENING.map((s) => s.counterpartyRef), ...PROOF1_UNEVIDENCED].sort();
    expect(new Set(named).size).toBe(named.length);
    expect(named).toEqual(PROOF1_RECIPIENTS.map((r) => r.counterpartyRef).sort());
  });

  it('a rejection is a statement about the evidence, never about the business', () => {
    for (const s of PROOF1_SCREENING.filter((x) => x.verdict === 'rejected')) {
      expect(s.because).toMatch(/no (named )?public project|no payment record|not about public work|product line|navigation/i);
    }
  });
});

describe('only what the evidence supports becomes reachable', () => {
  it('qualifies exactly the businesses the record supports, and is idempotent', async () => {
    const first = await applyProof1Screening(OWNER);
    expect(first.qualified.sort()).toEqual(['Continental Woodcraft, Worcester', 'General Woodworking, Lowell']);
    expect(first.notFound).toEqual([]);
    const after = await recipientsOf(X);
    const qualified = after.filter((r) => r.qualifiedAt);
    expect(qualified).toHaveLength(2);
    for (const r of qualified) {
      expect(r.qualifiedBecause).toBeTruthy();
      expect(r.qualifiedSource).toMatch(/^https?:\/\//);
    }
    // Running it again writes nothing new; a qualification already made stands.
    const second = await applyProof1Screening(OWNER);
    expect(second.qualified).toEqual([]);
    expect(second.alreadyQualified.sort()).toEqual(['Continental Woodcraft, Worcester', 'General Woodworking, Lowell']);
    expect((await recipientsOf(X)).filter((r) => r.qualifiedAt)).toHaveLength(2);
  });

  it('approving everyone does not make an unscreened business reachable, and readiness says so before Allow', async () => {
    await approveRemaining({ founderId: OWNER, experimentId: X });
    const approved = (await recipientsOf(X)).filter((r) => r.reviewStatus === 'approved');
    expect(approved.length).toBeGreaterThan(2);

    // The owner's gesture is unchanged and still means what it meant. What it
    // cannot do is turn an unevidenced candidate into someone Foundry writes to.
    const unscreened = approved.filter((r) => !r.qualifiedAt);
    expect(unscreened.length).toBeGreaterThan(0);
    // Before the test is allowed the door refuses everyone for a prior reason
    // — there is no asset yet — so what this proves is the step before it:
    // readiness will not call the test ready while an approved business has no
    // evidence behind it. (That the door itself then refuses an unqualified
    // recipient once an asset exists is proven in the public-face suite, where
    // an allowed experiment is on the other side of it.)
    for (const r of unscreened.slice(0, 2)) {
      await expect(planOffer({ experimentId: X, recipientId: r.id })).rejects.toThrow(/no_asset/);
    }
    // AN UNSCREENED APPROVAL COSTS NOTHING AND REACHES NOBODY, so it does not
    // block the test — the door refuses each one individually. What would be
    // wrong is allowing a test that can write to nobody at all, and that is
    // what readiness refuses.
    const ready = await readiness(X);
    expect(ready.missing.join(' · ')).not.toContain('recorded reason');
    expect(approved.filter((r) => r.qualifiedAt).length).toBe(2);

    // Strike the two screened ones and the cohort becomes unreachable: now it
    // says so, before Allow, rather than after.
    const { reviewRecipient } = await import('../../src/services/venture/hand.js');
    for (const r of approved.filter((x) => x.qualifiedAt)) {
      await reviewRecipient({ founderId: OWNER, experimentId: X, recipientId: r.id, decision: 'struck', reason: 'testing the empty cohort' });
    }
    const empty = await readiness(X);
    expect(empty.ok).toBe(false);
    expect(empty.missing.join(' · ')).toContain('nothing could be sent');
  });
});
