// =============================================================================
// THE WORKSHOP HAS ONE PUBLIC FACE, AND THE HUNDREDTH TEST COSTS NO NEW ONE.
//
//   the Workshop's rows → stood up at Cloudflare through the door, with
//   receipts → Proof 1 reframed as Experiment 001 with a page → sending as
//   the Workshop → Allow publishes the page and reads it back → offers point
//   at the page, carry the footer, go out as the Workshop → a no on the page
//   is a no to every test → a pause stops offers and not refunds → the
//   record follows the test → Experiment 002 rehearsed end to end → every
//   boundary the doctrine names, pushed on.
//
// Providers and the public site are stubbed at the network edge, so every
// handler, guard and row runs. Nobody real is contacted and nothing moves.
// =============================================================================

process.env.TURSO_DATABASE_URL = 'file::memory:';
process.env.ENCRYPTION_KEY = '2'.repeat(64);
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
import { Hono } from 'hono';
import Stripe from 'stripe';
import { runMigrations } from '../../src/db/migrate.js';
import { query } from '../../src/db/client.js';
import '../../src/services/integration/resend.js';
import '../../src/services/integration/stripe-gateway.js';
import '../../src/services/integration/cloudflare-gateway.js';
import { handleWebhook } from '../../src/services/billing/stripe.js';
import { providerStubs } from '../helpers/provider-stubs.js';
import { PROOF1_SLUG, PROOF1_TITLE, findProof1, reframeProof1UnderTheWorkshop, seedProof1 } from '../../src/services/venture/proof-1.js';
import { addRecipients, approveRemaining, campaignActOf, materialOf, planOffer, prepareExposure, recipientsOf, reviewRecipient, runHand, stopExperiment } from '../../src/services/venture/hand.js';
import { getExperimentView } from '../../src/services/founder/experiment-view.js';
import { waitingOn } from '../../src/services/founder/attention.js';
import { exposureOf } from '../../src/services/venture/outcome.js';
import { invoke } from '../../src/services/outbound/gateway.js';
import { contactIsRefused } from '../../src/services/institution/contact-constraint.js';
import { APEX_MICRO, establishPublicWorkshop, pauseNewEconomicActivity, publicWorkshopOf, resumeEconomicActivity, setPostalAddress } from '../../src/services/public-workshop/settings.js';
import { connectReplyInbox, connectWorkshopSending, standUpWorkshop, workshopHealth } from '../../src/services/public-workshop/infrastructure.js';
import { experimentPublication, livePublications, publicationGate, publishPage, publishSite, verifyPublication } from '../../src/services/public-workshop/publication.js';
import { PUBLIC_EXPERIMENT_FIELDS, leakIn, privateStringsOf, projectExperiment, projectRegistry } from '../../src/services/public-workshop/projection.js';
import { updatePublicCopy } from '../../src/services/public-workshop/identity.js';
import { isSuppressed, suppress, syncOptOutsFromStore } from '../../src/services/public-workshop/suppression.js';
import { rehearseWorkshop } from '../../src/services/public-workshop/rehearsal.js';
import { WORKER_SOURCE } from '../../src/services/public-workshop/worker-source.js';
import { JOB_REGISTRY } from '../../src/jobs/index.js';

vi.setConfig({ testTimeout: 180_000 });
const OWNER = 'w_owner'; const OTHER = 'w_other'; const FOUNDRY = 'w_foundry';
const stripe = new Stripe('sk_test_fake', { apiVersion: '2023-10-16' });
const SECRET = process.env.STRIPE_WEBHOOK_SECRET as string;
const NOW = new Date('2026-09-08T00:00:00Z');
const { state, fetch: fetchStub } = providerStubs();
let seq = 500;
function signedEvent(type: string, object: Record<string, unknown>): [string, string] {
  const payload = JSON.stringify({ id: `evt_w_${++seq}`, object: 'event', type, created: Math.floor(Date.now() / 1000), data: { object } });
  return [payload, stripe.webhooks.generateTestHeaderString({ payload, secret: SECRET })];
}
let app: Hono;
let currentFounder: Record<string, unknown> = { id: OWNER, email: 'thomas@example.com', preferences: {} };
let ORIGINAL = ''; let X = ''; // Proof 1 as first seeded, and Experiment 001
const page = async (path: string) => { const r = await app.request(path); return { status: r.status, text: await r.text() }; };
const post = (path: string, fields: Record<string, string> = {}) => app.request(path, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams(fields) });
const redirectedTo = (r: Response) => r.headers.get('location') ?? '';
const publicGet = async (path: string) => { const r = await fetchStub(`https://apexmicro.ai${path}`); return { status: r.status, text: await r.text() }; };
const pastDue = () => query(`UPDATE outbound_actions SET reconcile_after = '2026-01-01T00:00:00.000Z' WHERE status = 'executed' AND outcome_status = 'unresolved'`, []);
const one = async (sql: string, params: unknown[] = []) => (await query(sql, params)).rows[0] as Record<string, unknown>;

beforeAll(async () => {
  vi.stubGlobal('fetch', fetchStub);
  await runMigrations();
  await query(`INSERT INTO founders (id,clerk_user_id,email,name) VALUES (?,?,?,?),(?,?,?,?)`,
    [OWNER, 'w_clk', 'thomas@example.com', 'Thomas Norton', OTHER, 'w_clk2', 'other@example.com', 'Other']);
  await query(`INSERT INTO products (id,name,owner_id,status,operating_budget_monthly_usd) VALUES (?,'Foundry',?,'active',50)`, [FOUNDRY, OWNER]);
  await query(`INSERT INTO system_identities (identity_key,product_id,established_reason) VALUES ('foundry',?,'rehearsal')`, [FOUNDRY]);
  const { letterRoutes } = await import('../../src/routes/dashboard/letter.js');
  const { shareRoutes } = await import('../../src/routes/share/index.js');
  app = new Hono();
  app.use('*', async (c, next) => { c.set('founder' as never, currentFounder as never); c.set('csrfToken' as never, 't' as never); await next(); });
  app.route('/', letterRoutes);
  app.route('/', shareRoutes);
  // A rehearsal search once ran and was closed by the real one; its candidates remain for Experiment 002.
  const { openMandate } = await import('../../src/services/venture/mandate.js');
  const rehearsal = await openMandate({ founderId: OWNER, statement: 'Find another small digital income stream', shape: null, evidenceMode: 'reference' });
  if ('refused' in rehearsal) throw new Error(rehearsal.refused);
  ORIGINAL = (await seedProof1(OWNER)).experimentId;
});
afterAll(() => { vi.unstubAllGlobals(); });

describe('the Workshop exists as rows before it exists in the world', () => {
  it('is established once, from the approved voice, as the owner\'s one earned company; its rows refuse what would make it untrue', async () => {
    const w = await establishPublicWorkshop({ founderId: OWNER });
    expect(w).toMatchObject({ publicName: 'Apex Micro', operatorName: 'Thomas Norton', origin: 'https://apexmicro.ai', zoneName: 'apexmicro.ai', contactEmail: 'thomas@apexmicro.ai', productId: FOUNDRY, economicPause: null, kvNamespaceId: null });
    expect(w.statement).toBe(APEX_MICRO.statement);
    expect((await establishPublicWorkshop({ founderId: OWNER })).founderId).toBe(OWNER);
    await expect(query(`INSERT INTO public_workshop (founder_id, product_id, public_name, operator_name, origin, zone_name, contact_email, statement) VALUES (?,?,'X','Y','http://apexmicro.ai','apexmicro.ai','a@apexmicro.ai','s')`, [OTHER, FOUNDRY])).rejects.toThrow(/origin_must_be_https_on_its_zone/);
    await expect(query(`INSERT INTO public_workshop (founder_id, product_id, public_name, operator_name, origin, zone_name, contact_email, statement) VALUES (?,?,'X','Y','https://apexmicro.ai','apexmicro.ai','a@elsewhere.com','s')`, [OTHER, FOUNDRY])).rejects.toThrow(/contact_must_be_on_its_zone/);
    await expect(query(`INSERT INTO public_workshop (founder_id, product_id, public_name, operator_name, origin, zone_name, contact_email, statement) VALUES (?,?,'X','Y','https://apexmicro.ai','apexmicro.ai','a@apexmicro.ai','s')`, [OTHER, FOUNDRY])).rejects.toThrow(/acts_as_an_earned_real_company/);
    await expect(query(`UPDATE public_workshop SET zone_name = 'other.ai' WHERE founder_id = ?`, [OWNER])).rejects.toThrow(/identity_is_durable/);
    await expect(query(`UPDATE public_workshop SET economic_pause_at = datetime('now') WHERE founder_id = ?`, [OWNER])).rejects.toThrow(/pause_needs_reason_and_witness/);
    await expect(query(`UPDATE public_workshop SET economic_pause_at = datetime('now'), economic_pause_reason = 'r', economic_pause_by = 'institution:hand' WHERE founder_id = ?`, [OWNER])).rejects.toThrow(/pause_is_the_owners/);
    // The capabilities exist, each with its consequence, and nothing that could transfer or delete.
    const caps = (await query(`SELECT capability_key, rung FROM capabilities WHERE family = 'public_workshop' ORDER BY sort_order`)).rows as unknown as Array<Record<string, unknown>>;
    expect(caps.map((c) => `${String(c.capability_key)}:${String(c.rung)}`)).toEqual(['prepare_public_store:prepare', 'publish_public_page:public', 'sweep_public_store:reversible', 'operate_public_dns:reversible', 'retire_public_dns:reversible', 'deploy_public_workshop:public', 'attach_public_domain:public', 'route_public_mail:reversible']);
    expect((await query(`SELECT tool FROM capability_providers WHERE provider = 'cloudflare' ORDER BY tool`)).rows.map((r) => String((r as Record<string, unknown>).tool)))
      .toEqual(['cloudflare_dns_delete', 'cloudflare_dns_upsert', 'cloudflare_domain_attach', 'cloudflare_email_route_upsert', 'cloudflare_kv_delete', 'cloudflare_kv_namespace_create', 'cloudflare_kv_put', 'cloudflare_worker_deploy']);
    expect(Object.keys(JOB_REGISTRY)).toContain('public_workshop_tick');
  });

  it('the owner page offers to establish it and then to stand it up; another founder is refused', async () => {
    currentFounder = { id: OTHER, email: 'other@example.com', preferences: {} };
    expect((await post('/foundry/public-workshop/pause', { reason: 'x' })).status).toBe(403);
    currentFounder = { id: OWNER, email: 'thomas@example.com', preferences: {} };
    const shown = await page('/foundry/public-workshop');
    expect(shown.status).toBe(200);
    expect(shown.text).toContain('Stand it up');
    expect(shown.text).toContain('none recorded');
    expect((await page('/foundry')).text).toContain('/foundry/public-workshop');
    expect((await page('/foundry/controls')).text).toContain('cannot transfer the domain');
  });
});

describe('the Workshop stands up through the door, and the world is read back', () => {
  it('store, program, hostnames (stale root records retired with receipts), pages published and seen; run again and nothing moves', async () => {
    const before = state.cf.dns.filter((r) => ['A', 'AAAA'].includes(r.type)).length;
    expect(before).toBe(3);
    const r = await standUpWorkshop(OWNER);
    expect(r.program).toBe('deployed');
    expect(r.hostnames).toEqual(['apexmicro.ai', 'www.apexmicro.ai']);
    expect(r.retiredRecords).toHaveLength(3);
    expect(r.site.failed).toEqual([]);
    expect(r.site.unverified).toEqual([]);
    expect(r.site.verified).toBe(14);
    // The world: the site answers, www redirects, the trust surface is there, the private institution is not.
    expect((await publicGet('/')).text).toContain('a digital workshop by Thomas Norton');
    expect((await publicGet('/about')).text).toContain('I\'m Thomas Norton');
    expect((await publicGet('/privacy')).text).toContain('no tracking pixels');
    expect((await publicGet('/email')).text).toContain('Do not contact me');
    expect((await publicGet('/refunds')).text).toContain('you get your money back');
    expect((await publicGet('/terms')).text).toContain('operated by Thomas Norton');
    expect((await fetchStub('https://www.apexmicro.ai/about')).status).toBe(301);
    for (const p of ['/foundry', '/foundry/controls', '/foundry/experiments', '/letter', '/api/products', '/admin', '/foundry/public-workshop', '/share/refund/x/y']) expect((await publicGet(p)).status, p).toBe(404);
    // Receipts: what was there, what was asked, what came back, what was seen, how to put it back.
    const receipts = (await query(`SELECT tool, resource, outcome, previous_json, requested_json, verification_json, rollback_json FROM cloudflare_mutations WHERE founder_id = ? ORDER BY rowid`, [OWNER])).rows as unknown as Array<Record<string, unknown>>;
    expect(receipts.filter((x) => x.tool === 'cloudflare_dns_delete')).toHaveLength(3);
    const retired = receipts.find((x) => x.tool === 'cloudflare_dns_delete')!;
    expect(JSON.parse(String(retired.previous_json))).toMatchObject({ type: 'A', name: 'apexmicro.ai', content: '66.241.124.62' });
    expect(JSON.parse(String(retired.rollback_json))).toMatchObject({ create: { type: 'A', content: '66.241.124.62' } });
    expect(JSON.parse(String(retired.verification_json))).toMatchObject({ gone: true });
    expect(receipts.filter((x) => x.tool === 'cloudflare_worker_deploy')).toHaveLength(1);
    expect(receipts.filter((x) => x.tool === 'cloudflare_domain_attach')).toHaveLength(2);
    expect(receipts.filter((x) => x.tool === 'cloudflare_kv_put')).toHaveLength(14);
    expect(receipts.filter((x) => x.tool === 'cloudflare_kv_namespace_create')).toHaveLength(1);
    expect(receipts.every((x) => x.outcome === 'applied')).toBe(true);
    await expect(query(`UPDATE cloudflare_mutations SET previous_json = '{}' WHERE rowid = 1`)).rejects.toThrow(/only_verification_may_follow/);
    await expect(query(`DELETE FROM cloudflare_mutations WHERE rowid = 1`)).rejects.toThrow(/never_deleted/);
    // The google verification TXT was not touched: nothing unrelated is.
    expect(state.cf.dns.some((x) => x.type === 'TXT' && x.content.startsWith('google-site-verification'))).toBe(true);
    const again = await standUpWorkshop(OWNER);
    expect(again).toMatchObject({ program: 'unchanged', retiredRecords: [] });
    expect(again.site.published).toEqual([]);
    expect((await query(`SELECT COUNT(*) AS n FROM public_publications`)).rows[0]).toMatchObject({ n: 14 });
    const health = await workshopHealth(OWNER);
    expect(health.site).toMatchObject({ status: 'healthy' });
    // HEALTHY EVEN THOUGH `/user/tokens/verify` REFUSES THE TOKEN. An
    // account-owned Cloudflare token answers that endpoint with a flat 401 and
    // works everywhere it is actually used; trusting it once told the owner a
    // working credential was invalid. Health asks what the token can reach.
    expect(health.cloudflare).toMatchObject({ status: 'healthy' });
    expect(health.cloudflare.detail).toContain('apexmicro.ai active');
    const { verifyToken } = await import('../../src/services/integration/cloudflare-gateway.js');
    expect(await verifyToken()).toMatchObject({ ok: true, status: 'active' });
    expect(health.sending.status).toBe('needs_attention');
    expect((await page('/foundry/public-workshop')).text).toContain('14 pages served as published');
  });

  it('the envelope: another zone, an NS record, a wildcard, a page key deleted, another program, another hostname are refused and the refusal is a receipt', async () => {
    const w = (await publicWorkshopOf(OWNER))!;
    const call = (tool: string, params: Record<string, unknown>) => invoke({ productId: FOUNDRY, tool, action: 't', params: { purpose: 'test', ...params }, dedupKey: `env:${tool}:${JSON.stringify(params)}`, surface: 'public_workshop', dataClass: 'general' });
    const refused = async (tool: string, params: Record<string, unknown>, code: RegExp) => { const r = await call(tool, params); expect(r.ok).toBe(false); if (!r.ok) expect(r.reason).toMatch(code); };
    await refused('cloudflare_dns_upsert', { zone_name: 'other.ai', type: 'A', name: 'other.ai', content: '1.1.1.1' }, /outside_the_workshop_zone/);
    await refused('cloudflare_dns_upsert', { zone_name: 'apexmicro.ai', type: 'NS', name: 'apexmicro.ai', content: 'ns.evil.example' }, /record_type_outside_envelope/);
    await refused('cloudflare_dns_upsert', { zone_name: 'apexmicro.ai', type: 'A', name: '*.apexmicro.ai', content: '1.1.1.1' }, /no_wildcards/);
    await refused('cloudflare_dns_upsert', { zone_name: 'apexmicro.ai', type: 'A', name: 'apexmicro.ai.evil.example', content: '1.1.1.1' }, /outside_the_workshop_zone/);
    await refused('cloudflare_kv_delete', { namespace_id: w.kvNamespaceId, key: 'page:/about' }, /pages_are_never_deleted/);
    await refused('cloudflare_worker_deploy', { script_name: 'evil', source: 'export default {}', kv_namespace_id: w.kvNamespaceId }, /not_the_workshop_program/);
    await refused('cloudflare_domain_attach', { zone_name: 'apexmicro.ai', hostname: 'api.apexmicro.ai', service: 'apexmicro' }, /hostname_outside_envelope/);
    await refused('cloudflare_email_route_upsert', { zone_name: 'apexmicro.ai', to: 'x@other.ai', forward_to: 'a@b.co' }, /address_outside_envelope/);
    await refused('cloudflare_kv_put', { namespace_id: w.kvNamespaceId, key: 'page:/x', value: 'y', purpose: '' }, /purpose_required/);
    expect((await query(`SELECT COUNT(*) AS n FROM cloudflare_mutations WHERE outcome = 'refused'`)).rows[0]).toMatchObject({ n: 9 });
    // No tool exists for the things the envelope excludes.
    for (const tool of ['cloudflare_zone_delete', 'cloudflare_nameservers_set', 'cloudflare_domain_transfer', 'cloudflare_account_delete']) {
      const r = await call(tool, {}); expect(r.ok).toBe(false); if (!r.ok) expect(r.reason).toMatch(/no trusted policy/);
    }
    // And with the token dead, nothing is claimed.
    state.cf.token = 'invalid';
    const h = await workshopHealth(OWNER);
    expect(h.cloudflare).toMatchObject({ status: 'needs_attention' });
    expect(h.cloudflare.detail).toMatch(/not accepted/);
    state.cf.token = 'active';
  });
});

describe('Proof 1 is reframed under the Workshop without rewriting its history', () => {
  it('the original is declined as superseded; Experiment 001 carries the same question, brief and businesses, with a public identity and no launch', async () => {
    const r = await reframeProof1UnderTheWorkshop(OWNER);
    expect(r).toMatchObject({ original: ORIGINAL, number: 1, slug: PROOF1_SLUG, alreadyReframed: false });
    X = r.successor;
    expect(X).not.toBe(ORIGINAL);
    expect(await findProof1(OWNER)).toBe(X);
    expect(await one('SELECT decision, decided_by FROM venture_experiments WHERE id = ?', [ORIGINAL])).toMatchObject({ decision: 'declined', decided_by: 'institution:workshop_keeper' });
    const s = await one('SELECT decision, what_we_do, settles_when, needs_workshop FROM venture_experiments WHERE id = ?', [X]);
    expect(s.decision).toBeNull();
    expect(String(s.what_we_do)).toContain(`Supersedes ${ORIGINAL}`);
    expect(JSON.parse(String(s.settles_when))).toMatchObject({ event: 'delivery', at_least: 1, out_of: 'offer_delivered', at_most: 25, within_days: 7 });
    expect(await one('SELECT number, slug, supersedes_experiment_id, listed FROM public_experiments WHERE experiment_id = ?', [X])).toMatchObject({ number: 1, slug: PROOF1_SLUG, supersedes_experiment_id: ORIGINAL, listed: 1 });
    expect((await recipientsOf(X)).filter((x) => x.reviewStatus === 'pending')).toHaveLength(23);
    expect((await materialOf(X, 'offer_template'))!.body).toContain('[APEX MICRO EXPERIMENT PAGE]');
    expect((await reframeProof1UnderTheWorkshop(OWNER))).toMatchObject({ successor: X, alreadyReframed: true });
    // The identity is durable; the copy is not sealed.
    await expect(query(`UPDATE public_experiments SET slug = 'other' WHERE experiment_id = ?`, [X])).rejects.toThrow(/identity_is_durable/);
    await expect(query(`UPDATE public_experiments SET number = 9 WHERE experiment_id = ?`, [X])).rejects.toThrow(/identity_is_durable/);
    await expect(query(`UPDATE public_experiments SET public_outcome = 'Closed' WHERE experiment_id = ?`, [X])).rejects.toThrow(/outcome_needs_an_ended_test/);
    await expect(query(`INSERT INTO public_experiments (experiment_id, founder_id, number, slug, public_title, public_summary, public_who, public_what, public_limits, public_sources, public_selection, public_note) VALUES (?,?,7,'Bad Slug!','t','s','w','w','l','s','s','n')`, [ORIGINAL, OWNER])).rejects.toThrow(/slug_invalid/);
    // Not published before the owner decides: the row refuses, and the site does not carry it.
    await expect(query(`INSERT INTO public_publications (id, founder_id, path, kind, experiment_id, version, digest, bytes, published_by) VALUES ('sneak', ?, ?, 'experiment', ?, 1, 'd', 10, 'test')`, [OWNER, `/experiments/${PROOF1_SLUG}`, X])).rejects.toThrow(/experiment_not_approved/);
    const beforeAllow = await publishSite(OWNER, 'test');
    expect(beforeAllow.failed).toEqual([]); // an undecided experiment is skipped, never attempted and refused
    expect((await publicGet(`/experiments/${PROOF1_SLUG}`)).status).toBe(404);
    expect((await publicGet('/experiments')).text).not.toContain('Millwork');
    // The projection carries exactly the public fields and none of the private strings.
    const p = (await projectExperiment(X))!;
    expect(Object.keys(p).sort()).toEqual([...PUBLIC_EXPERIMENT_FIELDS].sort());
    expect(p).toMatchObject({ number: 1, status: 'preparing', recurring: false, payUrl: null, price: { amountCents: 2900, currency: 'USD', label: '$29, one time' } });
    const priv = await privateStringsOf(X);
    expect(priv).toEqual(expect.arrayContaining([X, OWNER, 'info@genwood.com', 'thomas@example.com']));
    expect(leakIn(JSON.stringify(p), priv)).toBeNull();
    const view = (await getExperimentView(OWNER, X, NOW))!;
    expect(view.publicPage).toMatchObject({ url: `https://apexmicro.ai/experiments/${PROOF1_SLUG}`, status: 'published when you allow it' });
    expect((await page(`/foundry/experiments/${X}`)).text).toContain('Public page');
    expect((await page(`/foundry/public-workshop/preview/${X}`)).text).toContain('Experiment 001');
    currentFounder = { id: OTHER, email: 'other@example.com', preferences: {} };
    expect((await page(`/foundry/public-workshop/preview/${X}`)).status).toBe(403);
    currentFounder = { id: OWNER, email: 'thomas@example.com', preferences: {} };
  });

  it('the owner\'s prerequisites now include the Workshop\'s: a postal address, and sending as the Workshop', async () => {
    await approveRemaining({ founderId: OWNER, experimentId: X });
    const v = (await getExperimentView(OWNER, X, NOW))!;
    expect(v.state).toBe('needs_you');
    expect(v.stateDetail).toContain('email sending is not connected');
    expect(v.stateDetail).toContain('no postal address');
    expect((await waitingOn(OWNER)).some((i) => i.summary.includes('The Workshop needs you: a postal address'))).toBe(true);
    // A sending identity that is not the Workshop's is not enough under a Workshop.
    const { setSendingIdentity } = await import('../../src/services/outbound/sending-identity.js');
    state.domains.push({ id: 'dom_ti', name: 'thomas-inc.com', status: 'verified', records: [] });
    await setSendingIdentity({ productId: FOUNDRY, provider: 'resend', credential: 're_key', fromEmail: 'thomas@thomas-inc.com', fromName: 'Thomas Norton' });
    expect((await getExperimentView(OWNER, X, NOW))!.readiness.sending).toMatchObject({ status: 'not_connected' });
    // Sending as the Workshop: the provider's records written on the zone through the door, then verified.
    state.nextDomainStatus = 'pending';
    const first = await connectWorkshopSending(OWNER);
    expect(first).toMatchObject({ domain: 'apexmicro.ai', status: 'pending', verified: false, identity: null });
    expect(first.records).toEqual(['MX send.apexmicro.ai', 'TXT send.apexmicro.ai', 'TXT resend._domainkey.apexmicro.ai', 'TXT _dmarc.apexmicro.ai']);
    expect(state.cf.dns.find((r) => r.type === 'TXT' && r.name === '_dmarc.apexmicro.ai')!.content).toBe('v=DMARC1; p=none; rua=mailto:thomas@apexmicro.ai');
    expect(redirectedTo(await post('/foundry/public-workshop/sending'))).toMatch(/error=.*pending/);
    state.nextDomainStatus = 'verified';
    const second = await connectWorkshopSending(OWNER);
    expect(second).toMatchObject({ status: 'verified', verified: true, identity: 'Thomas Norton — Apex Micro <thomas@apexmicro.ai>' });
    // Written once: the same records asked for again change nothing.
    expect(state.cf.dns.filter((r) => r.name === 'send.apexmicro.ai')).toHaveLength(2);
    expect((await getExperimentView(OWNER, X, NOW))!.readiness.sending).toMatchObject({ status: 'ready', fromLine: 'Thomas Norton — Apex Micro <thomas@apexmicro.ai>' });
    // The reply inbox: forwarded, awaiting his one click at the provider.
    const inbox = await connectReplyInbox(OWNER);
    expect(inbox).toMatchObject({ to: 'thomas@apexmicro.ai', forwardTo: 'thomas@example.com', destinationVerified: false });
    expect((await workshopHealth(OWNER)).replyInbox.detail).toContain('not yet confirmed');
    state.cf.routing.destinations[0].verified = '2026-09-09';
    expect((await workshopHealth(OWNER)).replyInbox).toMatchObject({ status: 'healthy' });
    // The postal address is his to supply; never invented.
    expect((await getExperimentView(OWNER, X, NOW))!.state).toBe('needs_you');
    expect(redirectedTo(await post('/foundry/public-workshop/postal', { address: 'PO Box 123, Example, MA 01000' }))).toContain('done=saved');
    expect((await getExperimentView(OWNER, X, NOW))!.state).toBe('ready');
    expect((await page('/foundry')).text).toContain(`/foundry/experiments/${X}/allow`);
  });
});

describe('Allow publishes the page; offers point at it and go out as the Workshop', () => {
  it('Allow: the link is placed, the page is published and read back, the offer text carries the page and no raw link', async () => {
    // The thinking comes before the decision: nothing is allowed until the
    // deliberation behind it exists, so Proof 1's is recorded here first.
    const { reconsiderProof1 } = await import('../../src/services/venture/proof-1-deliberation.js');
    await reconsiderProof1(OWNER);
    expect(redirectedTo(await post(`/foundry/experiments/${X}/allow`))).toContain('done=allowed');
    await query(`UPDATE venture_experiments SET decided_at = '2026-09-07 13:00:00' WHERE id = ?`, [X]);
    const pub = (await experimentPublication(X))!;
    expect(pub).toMatchObject({ version: 1, verifiedStatus: 'verified', kind: 'experiment', path: `/experiments/${PROOF1_SLUG}` });
    const shown = await publicGet(`/experiments/${PROOF1_SLUG}`);
    expect(shown.status).toBe(200);
    expect(shown.text).toContain('Experiment 001');
    expect(shown.text).toContain('Is this recurring? <strong>No.</strong>');
    expect(shown.text).toContain('Buy for $29');
    expect(shown.text).toContain('https://buy.stripe.com/');
    expect(shown.text).toContain('Hi, I\'m Thomas Norton');
    expect(shown.text).toContain('PO Box 123');
    expect(leakIn(shown.text, await privateStringsOf(X))).toBeNull();
    expect((await publicGet('/experiments')).text).toContain('Massachusetts Millwork Bid Brief');
    const offer = (await materialOf(X, 'offer'))!;
    expect(offer.body).toContain(`https://apexmicro.ai/experiments/${PROOF1_SLUG}`);
    expect(offer.body).not.toContain('buy.stripe.com');
    expect(offer.body).not.toContain('[APEX MICRO EXPERIMENT PAGE]');
    const gate = await publicationGate(X, { now: NOW });
    expect(gate).toMatchObject({ ok: true, failures: [] });
    expect((await getExperimentView(OWNER, X, NOW))!.publicPage!.status).toMatch(/^published · seen/);
  });

  it('the hand writes as Thomas Norton — Apex Micro, pointing at the page, with the Workshop\'s footer; the contact is on the Workshop\'s record', async () => {
    const reports = await runHand({ now: NOW, offersPerTick: 3 });
    expect(reports[0]).toMatchObject({ experimentId: X, offersSent: 3, exceptions: [] });
    for (const s of state.sends) {
      expect(s.from).toBe('Thomas Norton — Apex Micro <thomas@apexmicro.ai>');
      expect(s.reply_to).toBe('thomas@apexmicro.ai');
      expect(s.text).toContain(`https://apexmicro.ai/experiments/${PROOF1_SLUG}`);
      expect(s.text).not.toContain('buy.stripe.com');
      expect(s.text).toContain('Apex Micro is an independent digital workshop operated by Thomas Norton. PO Box 123, Example, MA 01000.');
      expect(s.text).toContain('To not hear from Apex Micro again: https://apexmicro.ai/email');
      expect(s.text).not.toMatch(/\[[A-Z ]+\]|\{Business name\}/);
    }
    expect((await query(`SELECT COUNT(*) AS n FROM public_contacts WHERE founder_id = ?`, [OWNER])).rows[0]).toMatchObject({ n: 3 });
  });

  it('a no on the public page is a no to every test: synced from the store, swept, refused by the plan guard and by the door', async () => {
    const victim = (await recipientsOf(X)).find((r) => r.reviewStatus === 'approved' && r.email && !state.sends.some((s) => s.to[0] === r.email))!;
    const r = await fetchStub('https://apexmicro.ai/email/opt-out', { method: 'POST', body: new URLSearchParams({ email: victim.email! }).toString(), headers: { 'content-type': 'application/x-www-form-urlencoded' } });
    expect(r.status).toBe(200);
    expect(await r.text()).toContain('on the do-not-contact list');
    const sync = await syncOptOutsFromStore(OWNER);
    expect(sync).toMatchObject({ recorded: 1, swept: 1, failed: [] });
    expect(await isSuppressed(OWNER, victim.email!)).toMatchObject({ suppressed: true, reason: 'they_asked' });
    expect(state.cf.kv.get((await publicWorkshopOf(OWNER))!.kvNamespaceId!)!.size).toBe(15); // 15 pages, the opt-out swept
    await expect(planOffer({ experimentId: X, recipientId: victim.id, now: NOW })).rejects.toThrow(/recipient_suppressed/);
    expect(await contactIsRefused(FOUNDRY, victim.email!)).toMatchObject({ refused: true, reason: 'workshop:they_asked' });
    // The row refuses on its own, and the list is append-only.
    const asset = await one('SELECT id FROM products WHERE from_experiment_id = ?', [X]);
    const act = (await campaignActOf(X))!;
    await expect(query(
      `INSERT INTO outbound_actions (id, product_id, agent_name, integration_name, action_type, authority_level, status, parameters_json, preview_text, rationale, confidence, expires_at, effect_id, outcome_status, experiment_id, experiment_act, recipient_id, proposed_act_id)
       VALUES ('sneak_s', ?, 'institution:hand', 'resend', 'send_email', 0, 'pending_approval', ?, 'p', 'r', 1, '2030-01-01', 'sneak_s', 'unresolved', ?, 'offer', ?, ?)`,
      [String(asset.id), JSON.stringify({ to: [victim.email], subject: 's', html: 'h' }), X, victim.id, act.id])).rejects.toThrow(/recipient_suppressed/);
    await expect(query(`DELETE FROM public_suppressions WHERE email = ?`, [victim.email])).rejects.toThrow(/append_only/);
    // A second test may not write to somebody the first wrote to this season.
    const written = state.sends[0].to[0];
    const { contactFrequencyRefusal } = await import('../../src/services/public-workshop/suppression.js');
    expect(await contactFrequencyRefusal({ founderId: OWNER, email: written, experimentId: 'another', now: NOW })).toMatch(/waits 90 days/);
    expect(await contactFrequencyRefusal({ founderId: OWNER, email: written, experimentId: X, now: NOW })).toBeNull();
    // A bounce at the provider lands on the list too.
    state.deliveryState.set(state.sends[1].id, 'bounced');
    await pastDue();
    await runHand({ now: NOW, offersPerTick: 0 });
    expect(await isSuppressed(OWNER, state.sends[1].to[0])).toMatchObject({ suppressed: true, reason: 'bounced' });
    const before = state.sends.length;
    await runHand({ now: NOW, offersPerTick: 25 });
    expect(state.sends.length).toBe(before + 7); // 11 approved, 3 written to, 1 opted out
    expect((await page('/foundry/public-workshop')).text).toContain(victim.email!);
  });

  it('the gate refuses outbound for a stale page, a page the world does not carry, a wrong price, a recurring link, an unhealthy sender', async () => {
    // Stale: the words changed and the page was not republished.
    await updatePublicCopy(X, { limits: 'It is not complete. Updated limits.' });
    let gate = await publicationGate(X, { now: NOW });
    expect(gate.ok).toBe(false); expect(gate.failures.join(' ')).toMatch(/stale/);
    // Everyone approved has been written to by now, so the gate is put to a
    // business the owner adds and approves here: never contacted, not suppressed.
    await addRecipients({ founderId: OWNER, experimentId: X, recipients: [{ counterpartyRef: 'Late Millwork, Lowell', email: 'late@millwork.example', channel: 'email', sourceUrl: 'https://late.example' }] });
    const untouched = (await recipientsOf(X)).find((r) => r.email === 'late@millwork.example')!;
    await reviewRecipient({ founderId: OWNER, experimentId: X, recipientId: untouched.id, decision: 'approved' });
    await expect(planOffer({ experimentId: X, recipientId: untouched.id, now: NOW })).rejects.toThrow(/publication_gate.*stale/);
    const rep = await publishSite(OWNER, 'test');
    expect(rep.published).toEqual(expect.arrayContaining([`/experiments/${PROOF1_SLUG}`]));
    expect((await experimentPublication(X))!.version).toBe(2);
    expect((await publicationGate(X, { now: NOW })).ok).toBe(true);
    // Provider said yes; the world does not carry it.
    state.cf.siteDown = true;
    gate = await publicationGate(X, { now: NOW });
    expect(gate.failures.join(' ')).toMatch(/could not be seen.*HTTP 503/);
    const hand = await runHand({ now: NOW, offersPerTick: 5 });
    expect(hand[0].exceptions.join(' ')).toMatch(/page not published|could not be seen/);
    state.cf.siteDown = false;
    expect((await publicationGate(X, { now: NOW })).ok).toBe(true);
    // Wrong price at the provider, and a link that recurs.
    const x = (await exposureOf(X))!;
    const link = state.paymentLinks.find((l) => l.id === x.exposureRef)!;
    const price = state.prices.find((p) => p.id === link.line_items[0].price)!;
    price.unit_amount = 1900;
    gate = await publicationGate(X, { now: NOW });
    expect(gate.failures.join(' ')).toMatch(/price on the page \(\$29, one time\) is not the price at the provider \(1900/);
    price.unit_amount = 2900;
    (price as { recurring: unknown }).recurring = { interval: 'month' };
    expect((await publicationGate(X, { now: NOW })).failures.join(' ')).toMatch(/provider link recurs/);
    (price as { recurring: unknown }).recurring = null;
    // Sender authentication gone unhealthy at the provider.
    state.domains.find((d) => d.name === 'apexmicro.ai')!.status = 'temporary_failure';
    expect((await publicationGate(X, { now: NOW })).failures.join(' ')).toMatch(/sender authentication is not healthy/);
    state.domains.find((d) => d.name === 'apexmicro.ai')!.status = 'verified';
    expect((await publicationGate(X, { now: NOW })).ok).toBe(true);
    // Duplicate publication: the same digest is one row.
    const w = (await publicWorkshopOf(OWNER))!;
    const html = state.cf.kv.get(w.kvNamespaceId!)!.get('page:/about')!;
    const a = await publishPage({ founderId: OWNER, path: '/about', html, kind: 'page', by: 'test' });
    const b = await publishPage({ founderId: OWNER, path: '/about', html, kind: 'page', by: 'test' });
    expect(a.id).toBe(b.id);
    await expect(query(`INSERT INTO public_publications (id, founder_id, path, kind, version, digest, bytes, published_by) VALUES ('v9', ?, '/about', 'page', 9, 'd', 1, 't')`, [OWNER])).rejects.toThrow(/version_must_follow/);
    await expect(query(`INSERT INTO public_publications (id, founder_id, path, kind, version, digest, bytes, published_by) VALUES ('bad', ?, '/foundry/../x', 'page', 1, 'd', 1, 't')`, [OWNER])).rejects.toThrow(/path_invalid/);
    await expect(query(`DELETE FROM public_publications WHERE id = ?`, [a.id])).rejects.toThrow(/never_deleted/);
    // A private value cannot be published as a page of an experiment.
    await updatePublicCopy(X, { note: `Hi. Ask ${OWNER} for details.` });
    const leaked = await publishSite(OWNER, 'test');
    expect(leaked.failed.map((f) => f.reason).join(' ')).toMatch(/private value/);
    await updatePublicCopy(X, { note: 'Hi, I\'m Thomas Norton. This is a pilot.' });
    expect((await publishSite(OWNER, 'test')).failed).toEqual([]);
  });

  it('a pause stops new offers and placements, not deliveries or refunds; Allow refuses while paused', async () => {
    const buyer = 'sales@rgcmillwork.com';
    state.buyers.set('pi_w_1', buyer);
    const [p, s] = signedEvent('payment_intent.succeeded', { id: 'pi_w_1', object: 'payment_intent', amount_received: 2900, currency: 'usd', receipt_email: buyer, latest_charge: 'ch_w_1', metadata: { app: 'foundry', experiment_id: X, primitive: 'sale' } });
    await handleWebhook(p, s);
    expect(redirectedTo(await post('/foundry/public-workshop/pause', { reason: 'thinking it over' }))).toContain('done=paused');
    expect((await publicWorkshopOf(OWNER))!.economicPause).toMatchObject({ reason: 'thinking it over' });
    const before = state.sends.length;
    const r = await runHand({ now: NOW, offersPerTick: 5 });
    expect(r[0].exceptions.join(' ')).toMatch(/paused: thinking it over/);
    expect(r[0]).toMatchObject({ offersSent: 0, deliveriesSent: 1 });
    expect(state.sends[state.sends.length - 1]).toMatchObject({ to: [buyer], subject: PROOF1_TITLE });
    expect(state.sends.length).toBe(before + 1);
    expect(r[0].settled).toBeNull(); // nothing has been confirmed delivered yet
    // The row refuses an offer on its own while paused; a delivery it lets through.
    const asset = await one('SELECT id FROM products WHERE from_experiment_id = ?', [X]);
    const act = (await campaignActOf(X))!;
    const target = (await recipientsOf(X)).find((x) => x.reviewStatus === 'approved' && x.email && !state.sends.some((m) => m.to[0] === x.email))!;
    await expect(query(
      `INSERT INTO outbound_actions (id, product_id, agent_name, integration_name, action_type, authority_level, status, parameters_json, preview_text, rationale, confidence, expires_at, effect_id, outcome_status, experiment_id, experiment_act, recipient_id, proposed_act_id)
       VALUES ('sneak_p', ?, 'institution:hand', 'resend', 'send_email', 0, 'pending_approval', ?, 'p', 'r', 1, '2030-01-01', 'sneak_p', 'unresolved', ?, 'offer', ?, ?)`,
      [String(asset.id), JSON.stringify({ to: [target.email], subject: 's', html: 'h' }), X, target.id, act.id])).rejects.toThrow(/workshop_paused/);
    // A refund asked for during the pause goes through the governed door.
    const delivery = state.sends[state.sends.length - 1];
    const link = /\((http:\/\/localhost:8080\/share\/refund\/[^)]+)\)/.exec(delivery.text ?? '')![1];
    expect(await (await app.request(link.replace('http://localhost:8080', ''), { method: 'POST' })).text()).toContain('on its way back');
    expect(state.refunds).toHaveLength(1);
    // A BUYER WHO OPTED OUT IS STILL OWED WHAT THEY BOUGHT. The Workshop's list
    // governs being approached, never being answered.
    await suppress({ founderId: OWNER, email: buyer, reason: 'they_asked', source: 'page_opt_out' });
    expect(await isSuppressed(OWNER, buyer)).toMatchObject({ suppressed: true });
    expect(await contactIsRefused(FOUNDRY, buyer)).toMatchObject({ refused: true, reason: 'workshop:they_asked' });
    const owedAction = await one(`SELECT effect_id FROM outbound_actions WHERE experiment_id = ? AND experiment_act = 'delivery' ORDER BY rowid DESC LIMIT 1`, [X]);
    expect(await contactIsRefused(FOUNDRY, buyer, String(owedAction.effect_id))).toMatchObject({ refused: false });
    // And an offer to that same address is still refused, effect id or not.
    const offerAction = await one(`SELECT effect_id FROM outbound_actions WHERE experiment_id = ? AND experiment_act = 'offer' ORDER BY rowid LIMIT 1`, [X]);
    expect(await contactIsRefused(FOUNDRY, buyer, String(offerAction.effect_id))).toMatchObject({ refused: true });

    // The public site is still up throughout, and says nothing about the pause.
    expect((await publicGet(`/experiments/${PROOF1_SLUG}`)).status).toBe(200);
    expect((await publicGet('/refunds')).status).toBe(200);
    expect((await page('/foundry/public-workshop')).text).toContain('New economic activity is paused');
    await pauseNewEconomicActivity({ founderId: OWNER, reason: 'again' }); // idempotent: the first reason stands
    expect((await publicWorkshopOf(OWNER))!.economicPause!.reason).toBe('thinking it over');

    // THE WORLD'S VERDICT IS STILL READ WHILE PAUSED. Concluding a test is
    // reading what already happened, not starting something new, and a test
    // left running because nobody was watching is the opposite of a pause.
    await pastDue();
    const reading = await runHand({ now: NOW, offersPerTick: 5 });
    expect(reading[0].reconciled).toBeGreaterThan(0);
    expect(reading[0].settled).toBe('as_predicted');
    expect(reading[0].offersSent).toBe(0);
    await resumeEconomicActivity(OWNER);
    expect((await publicWorkshopOf(OWNER))!.economicPause).toBeNull();
  });

  it('the record follows the test: settled, the page says Closed at the same address, the way to pay is gone, the registry keeps it', async () => {
    expect(await one('SELECT verdict FROM venture_experiments WHERE id = ?', [X])).toMatchObject({ verdict: 'as_predicted' });
    // The offer came down with the settlement, so the page no longer offers a
    // way to pay — and therefore does not describe itself as Operating.
    const shown = await publicGet(`/experiments/${PROOF1_SLUG}`);
    expect(shown.status).toBe(200);
    expect(shown.text).toContain('Closed');
    expect(shown.text).toContain('the thesis held');
    expect(shown.text).not.toContain('Buy for');
    expect((await publicGet('/closed')).text).toContain('Massachusetts Millwork Bid Brief');
    expect((await publicGet('/experiments')).text).toContain('Massachusetts Millwork Bid Brief');
    expect((await publicGet('/operating')).text).not.toContain('Massachusetts Millwork Bid Brief');
    expect((await projectExperiment(X))!.status).toBe('closed');
    expect((await page('/foundry/public-workshop')).text).toContain('Nothing outstanding');
    // A public outcome can now be written, and the page carries it.
    const { recordPublicOutcome } = await import('../../src/services/public-workshop/identity.js');
    await recordPublicOutcome(X, 'Closed — reframed before it settled; the workshop learned more about its own setup than about the market.');
    await publishSite(OWNER, 'test');
    expect((await publicGet(`/experiments/${PROOF1_SLUG}`)).text).toContain('reframed before it settled');
  });
});

describe('Experiment 002: the machinery rehearsed end to end', () => {
  it('assigns 002, publishes, verifies, updates, concludes, marks Closed, keeps the page, unlisted, without any manual act at the provider', async () => {
    const calls = state.calls.length;
    const r = await rehearseWorkshop(OWNER);
    expect(r.ok, JSON.stringify(r.steps)).toBe(true);
    expect(r.number).toBe(2);
    expect(r.url).toBe('https://apexmicro.ai/experiments/workshop-rehearsal');
    expect(r.steps.map((s) => s.step)).toEqual(['identity', 'publish', 'update', 'displayed', 'closed', 'preserved']);
    const shown = await publicGet('/experiments/workshop-rehearsal');
    expect(shown.status).toBe(200);
    expect(shown.text).toContain('Experiment 002');
    expect(shown.text).toContain('Closed — a rehearsal');
    expect(shown.text).toContain('Nothing is for sale here');
    expect((await publicGet('/experiments')).text).not.toContain('Workshop rehearsal');
    expect((await publicGet('/closed')).text).not.toContain('Workshop rehearsal');
    expect(await one('SELECT evidence_mode, decision, decided_by, ran_at, verdict FROM venture_experiments WHERE id = ?', [r.experimentId])).toMatchObject({ evidence_mode: 'reference', decision: 'approved', decided_by: 'institution:workshop_keeper', verdict: 'as_predicted' });
    // Nothing reached anyone; the reference asset could not have crossed the door.
    expect(state.calls.slice(calls).filter((c) => c.includes('api.resend.com/emails') || c.includes('payment_links'))).toEqual([]);
    // Run again: nothing changes.
    const again = await rehearseWorkshop(OWNER);
    expect(again.ok).toBe(true);
    expect(again.experimentId).toBe(r.experimentId);
    expect((await projectRegistry(OWNER)).map((x) => `${x.number}:${x.status}:${x.listed}`)).toEqual(['1:closed:true', '2:closed:false']);
  });
});

describe('the public program serves only the store, and the private institution is unreachable through it', () => {
  it('private routes fail closed, www redirects, the opt-out form writes the store, and nothing else is answered', async () => {
    const dataUrl = `data:text/javascript;base64,${Buffer.from(WORKER_SOURCE).toString('base64')}`;
    const mod = (await import(dataUrl)) as { default: { fetch: (r: Request, env: unknown) => Promise<Response> } };
    const kv = new Map<string, string>([['page:/', '<html>home</html>'], ['page:/experiments/x', '<html>x</html>'], ['page:/404', '<html>nope</html>'], ['page:/email/done', '<html>done</html>']]);
    const env = { PAGES: { get: async (k: string) => kv.get(k) ?? null, put: async (k: string, v: string) => { kv.set(k, v); } } };
    const get = (u: string, init?: RequestInit) => mod.default.fetch(new Request(u, init), env);
    expect((await get('https://apexmicro.ai/')).status).toBe(200);
    expect(await (await get('https://apexmicro.ai/experiments/x')).text()).toBe('<html>x</html>');
    for (const p of ['/foundry', '/foundry/controls', '/foundry/experiments/x/recipients', '/letter', '/api/products', '/admin', '/.env', '/foundry/public-workshop', '/share/refund/a/b', '/experiments/x/../../foundry', '/Experiments/X']) {
      const r = await get(`https://apexmicro.ai${p}`);
      expect(r.status, p).toBe(404);
      expect(await r.text()).toBe('<html>nope</html>');
    }
    expect((await get('https://www.apexmicro.ai/about')).status).toBe(301);
    expect((await get('https://www.apexmicro.ai/about')).headers.get('location')).toBe('https://apexmicro.ai/about');
    expect((await get('https://apexmicro.workers.dev/')).status).toBe(404);
    expect((await get('https://evil.example/')).status).toBe(404);
    expect((await get('https://apexmicro.ai/experiments/x', { method: 'DELETE' })).status).toBe(405);
    const bad = await get('https://apexmicro.ai/email/opt-out', { method: 'POST', body: new URLSearchParams({ email: 'nope' }), headers: { 'content-type': 'application/x-www-form-urlencoded' } });
    expect(bad.status).toBe(400);
    const ok = await get('https://apexmicro.ai/email/opt-out', { method: 'POST', body: new URLSearchParams({ email: 'Someone@Example.com' }), headers: { 'content-type': 'application/x-www-form-urlencoded' } });
    expect(ok.status).toBe(200);
    expect(await ok.text()).toBe('<html>done</html>');
    const stored = [...kv.entries()].find(([k]) => k.startsWith('optout:'))!;
    expect(JSON.parse(stored[1])).toMatchObject({ email: 'someone@example.com' });
    const h = (await get('https://apexmicro.ai/')).headers;
    expect(h.get('content-security-policy')).toContain("default-src 'none'");
    expect(h.get('x-frame-options')).toBe('DENY');
    expect(h.get('referrer-policy')).toBe('no-referrer');
    // The program holds no credential and no address of the private institution.
    expect(WORKER_SOURCE).not.toMatch(/cfat_|fly\.dev|foundry-intel|localhost|CLOUDFLARE|RESEND|STRIPE/);
    expect(livePublications).toBeDefined();
    expect(await verifyPublication(OWNER, '/nope')).toBeNull();
    await suppress({ founderId: OWNER, email: 'x@y.example', reason: 'founder', source: 'owner' });
    await expect(query(`UPDATE public_suppressions SET reason = 'bounced' WHERE email = 'x@y.example'`)).rejects.toThrow(/append_only/);
    await expect(query(`INSERT INTO public_suppressions (id, founder_id, email, reason, source) VALUES ('s_bad', ?, 'Not An Email', 'founder', 'owner')`, [OWNER])).rejects.toThrow(/email_invalid/);
    void stopExperiment; void prepareExposure;
  });
});
