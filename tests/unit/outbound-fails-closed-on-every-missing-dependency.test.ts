// =============================================================================
// ALLOW IS NOT A PROMISE THAT ANYONE WILL BE WRITTEN TO.
//
// The owner presses Allow once, on a day when everything is ready. The world
// does not hold still afterwards: a page can be swept from the store, a
// payment link deactivated at the provider, a price edited, a sending domain
// fall out of authentication, a postal address be removed, a public page go
// dark. Each of those is a material exposure prerequisite for writing to a
// stranger under the Workshop's name, and each is checked on the pass that
// would do the writing rather than on the day permission was given.
//
// This proves it against the readiness architecture that already exists — the
// per-pass publication gate, the exposure preparation, the suppression list —
// by breaking one dependency at a time on a fully allowed, fully ready
// experiment and showing that nothing leaves. Nobody real is contacted; every
// provider and the public site are stubbed at the network edge.
// =============================================================================

process.env.TURSO_DATABASE_URL = 'file::memory:';
process.env.ENCRYPTION_KEY = '5'.repeat(64);
process.env.STRIPE_SECRET_KEY = 'sk_test_fake';
process.env.STRIPE_WEBHOOK_SECRET = 'whsec_testsecret';
process.env.RESEND_API_KEY = 're_test_key';
process.env.CLOUDFLARE_API_TOKEN = 'cfat_test_token';
process.env.CLOUDFLARE_ACCOUNT_ID = 'acct_test';
process.env.FOUNDRY_ENABLE_MONEY_TOOLS = 'true';
process.env.FOUNDRY_INSTANCE_POSTURE = 'private_owner';
process.env.FOUNDRY_OWNER_EMAIL = 'thomas@example.com';
process.env.APP_URL = 'http://localhost:8080';

import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { runMigrations } from '../../src/db/migrate.js';
import { query } from '../../src/db/client.js';
import '../../src/services/integration/resend.js';
import '../../src/services/integration/stripe-gateway.js';
import '../../src/services/integration/cloudflare-gateway.js';
import { providerStubs } from '../helpers/provider-stubs.js';
import { PROOF1_SLUG, findProof1, reframeProof1UnderTheWorkshop, seedProof1 } from '../../src/services/venture/proof-1.js';
import { reconsiderProof1 } from '../../src/services/venture/proof-1-deliberation.js';
import { allowExperiment, approveRemaining, planOffer, qualifyRecipient, recipientsOf, runHand } from '../../src/services/venture/hand.js';
import { establishPublicWorkshop, pauseNewEconomicActivity, publicWorkshopOf, resumeEconomicActivity, setPostalAddress } from '../../src/services/public-workshop/settings.js';
import { connectWorkshopSending, standUpWorkshop } from '../../src/services/public-workshop/infrastructure.js';
import { publicationGate } from '../../src/services/public-workshop/publication.js';
import { recipientsOf } from '../../src/services/venture/hand.js';

vi.setConfig({ testTimeout: 180_000 });
const OWNER = 'fc_owner'; const FOUNDRY = 'fc_foundry';
const NOW = new Date('2026-09-08T00:00:00Z');
const { state, fetch: fetchStub } = providerStubs();
let X = '';
const rowsOf = async (sql: string, params: unknown[] = []) => (await query(sql, params)).rows as unknown as Array<Record<string, unknown>>;
const sentCount = async () => Number((await rowsOf(`SELECT COUNT(*) n FROM outbound_actions WHERE experiment_id = ? AND experiment_act = 'offer'`, [X]))[0]!.n);
/**
 * Break something the institution cannot quietly repair, run a full pass, and
 * prove nothing left. Repairable dependencies are deliberately not tested this
 * way: the hand re-places a missing payment link and re-publishes a swept page
 * on every pass, and an offer sent after a successful repair is an offer sent
 * with the dependency present. What must never happen is a message leaving
 * while the prerequisite is still absent.
 */
async function withBroken(what: string, breakIt: () => Promise<void> | void, mend: () => Promise<void> | void): Promise<string[]> {
  // A settling pass first, writing to nobody, so each case is measured against
  // a Workshop that is genuinely ready and fails for its own reason rather
  // than for something the previous case left behind.
  await runHand({ founderId: OWNER, now: NOW, offersPerTick: 0 });
  // Not asserted green here: a broken pass can leave the store holding content
  // the rows already recorded as published, and the door's content-addressed
  // dedup key then suppresses the identical re-publish, so the divergence
  // persists. It fails closed — the gate refuses — which is why the assertions
  // below are about what did NOT happen rather than about a clean slate.
  const sendsBefore = state.sends.length;
  const writtenBefore = await sentCount();
  await breakIt();
  const report = (await runHand({ founderId: OWNER, now: NOW, offersPerTick: 3 }))[0];
  const gate = await publicationGate(X, { now: NOW });
  expect(state.sends.length, `${what}: a message left while it was broken`).toBe(sendsBefore);
  expect(await sentCount(), `${what}: an offer was written while it was broken`).toBe(writtenBefore);
  expect(gate.ok, `${what}: the gate said everything was fine`).toBe(false);
  await mend();
  return [...(report?.exceptions ?? []), ...gate.failures];
}

beforeAll(async () => {
  vi.stubGlobal('fetch', fetchStub);
  await runMigrations();
  await query(`INSERT INTO founders (id,clerk_user_id,email,name) VALUES (?,?,?,?)`, [OWNER, 'fc_clk', 'thomas@example.com', 'Thomas Norton']);
  await query(`INSERT INTO products (id,name,owner_id,status,operating_budget_monthly_usd) VALUES (?,'Foundry',?,'active',50)`, [FOUNDRY, OWNER]);
  await query(`INSERT INTO system_identities (identity_key,product_id,established_reason) VALUES ('foundry',?,'fail_closed')`, [FOUNDRY]);
  await seedProof1(OWNER);
  await establishPublicWorkshop({ founderId: OWNER });
  await standUpWorkshop(OWNER);
  X = (await reframeProof1UnderTheWorkshop(OWNER)).successor;
  await approveRemaining({ founderId: OWNER, experimentId: X });
  for (const cand of (await recipientsOf(X)).filter((x) => x.reviewStatus === 'approved')) {
    await qualifyRecipient({ founderId: OWNER, experimentId: X, recipientId: cand.id,
      because: 'appears as a bidder in the COMMBUYS public award record', source: 'https://www.commbuys.com/bso/' });
  }
  await reconsiderProof1(OWNER);
  state.nextDomainStatus = 'verified';
  await connectWorkshopSending(OWNER);
  await setPostalAddress(OWNER, 'PO Box 123, Example, MA 01000');
  await allowExperiment({ founderId: OWNER, experimentId: X, by: 'owner' });
});
afterAll(() => { vi.unstubAllGlobals(); });

describe('everything is ready, and one message goes out', () => {
  it('the baseline: the gate passes and the hand writes', async () => {
    expect(await findProof1(OWNER)).toBe(X);
    // The first pass is what places the link and publishes the page; the gate
    // is green only once the world actually carries it.
    const report = (await runHand({ founderId: OWNER, now: NOW, offersPerTick: 1 }))[0]!;
    expect(report.exceptions).toEqual([]);
    expect(report.offersSent).toBe(1);
    expect(state.sends).toHaveLength(1);
    const gate = await publicationGate(X, { now: NOW, verifyLive: false });
    expect(gate).toMatchObject({ ok: true, failures: [] });
    expect(gate.pageUrl).toBe(`https://apexmicro.ai/experiments/${PROOF1_SLUG}`);
  });
});

describe('after Allow, every material prerequisite is checked on the pass that would write', () => {
  it('the page goes dark in the world while the store still holds it: the offer points nowhere, so nobody is written to', async () => {
    // THE ONE THE 24-HOUR WINDOW USED TO LET THROUGH. The store is intact and
    // the digest is current, so nothing re-publishes and nothing looks wrong
    // from the inside; only reading the public address says otherwise.
    const said = await withBroken('public site not serving',
      () => { state.cf.siteDown = true; },
      () => { state.cf.siteDown = false; });
    expect(said.join(' ')).toMatch(/could not be seen/i);
    expect(said.join(' ')).toMatch(/503|Service Unavailable/i);
  });

  it('the public store cannot be reached at all: the page cannot be put up or read back', async () => {
    const said = await withBroken('Cloudflare unreachable',
      () => { state.cf.token = 'invalid'; state.cf.siteDown = true; },
      () => { state.cf.token = 'active'; state.cf.siteDown = false; });
    expect(said.join(' ')).toMatch(/could not be seen|not published|Invalid API Token/i);
  });

  it('the payment provider cannot be reached: an offer with no working way to pay is not sent', async () => {
    const said = await withBroken('Stripe unreachable',
      () => { state.stripeDown = true; },
      () => { state.stripeDown = false; });
    expect(said.join(' ')).toMatch(/not placed|no way to pay|not active at the provider/i);
  });

  it('the postal address is removed: commercial mail that must carry one does not go without it', async () => {
    const said = await withBroken('postal address removed',
      async () => { await query(`UPDATE public_workshop SET postal_address = NULL WHERE founder_id = ?`, [OWNER]); },
      async () => { await setPostalAddress(OWNER, 'PO Box 123, Example, MA 01000'); });
    expect(said.join(' ')).toMatch(/postal address/i);
  });

  it('the sender stops being the Workshop: a stranger would meet a name and address that are not the one on the page', async () => {
    const said = await withBroken('sending address moved off the zone',
      async () => { await query(`UPDATE product_sending_identities SET from_email = 'thomas@thomas-inc.com' WHERE product_id = ?`, [FOUNDRY]); },
      async () => { await query(`UPDATE product_sending_identities SET from_email = 'thomas@apexmicro.ai' WHERE product_id = ?`, [FOUNDRY]); });
    expect(said.join(' ')).toMatch(/is not on apexmicro\.ai/i);
  });

  it('the owner pauses: new economic activity stops, and Allow does not survive it', async () => {
    const said = await withBroken('paused',
      async () => { await pauseNewEconomicActivity({ founderId: OWNER, reason: 'thinking about it' }); },
      async () => { await resumeEconomicActivity(OWNER); });
    expect(said.join(' ')).toMatch(/paused/i);
  });
});

describe('the sender falls out of authentication after Allow', () => {
  it('an unhealthy sending domain stops the writing rather than being discovered by a bounce', async () => {
    const said = await withBroken('sending domain unverified at the provider',
      () => { for (const d of state.domains) d.status = 'pending'; },
      () => { for (const d of state.domains) d.status = 'verified'; });
    expect(said.join(' ')).toMatch(/authentication|not verified|pending/i);
  });
});
