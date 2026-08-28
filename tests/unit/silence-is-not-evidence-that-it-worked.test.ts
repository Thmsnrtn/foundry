process.env.TURSO_DATABASE_URL = 'file::memory:';
process.env.ENCRYPTION_KEY = '0'.repeat(64);

import { readFileSync } from 'node:fs';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { runMigrations } from '../../src/db/migrate.js';
import { query } from '../../src/db/client.js';
import { observeIntercomReplyOutcomes } from '../../src/services/integrations/intercom-messages.js';
import {
  ingestCustomerMessage, registerSupportChannel,
} from '../../src/services/institution/customer-message-intake.js';
import {
  getMessagesAwaitingReply, planProposedReply, proposeSupportReply,
} from '../../src/services/institution/support-reply.js';
import { recordConsent } from '../../src/services/autopilot/consent.js';
import { moveResponsibilityTo } from '../fixtures/responsibility-state.js';

// =============================================================================
// SILENCE IS NOT EVIDENCE THAT IT WORKED.
//
// The support chain has always ended "→ governed send_email → receipt →
// outcome UNRESOLVED", and unresolved is where it stopped. A provider
// acknowledgement is not an observed effect and an observed effect is not an
// outcome. The only producers of a support outcome were an external door
// nothing posts to, and two legacy event types nothing in production wrote.
//
// The conversation is an external witness Foundry does not control, and it
// answers exactly one question honestly: did the customer write again after we
// answered? That is a message, with a time on it, authored by the person the
// reply was sent to — not an inference about whether they were satisfied.
//
// THE ASYMMETRY IS THE DESIGN AND IT ONLY RUNS AGAINST FOUNDRY. A customer
// writing again is recorded as a failure witness. Silence records NOTHING,
// because silence is the state of a customer who gave up, one who was helped,
// and one on holiday. There is no code path that can write
// `support_reply_effective` — a success verdict has to come from somewhere
// Foundry is not.
// =============================================================================

const P = 'p_outcome';
const RESP = 'resp_outcome';
const EXECUTED_AT = '2026-08-20T10:00:00.000Z';
let intakeKey = '';
let actionId = '';

const part = (id: string, type: string, offsetHours: number) => ({
  id, author: { type },
  created_at: Math.floor(new Date(EXECUTED_AT).getTime() / 1000) + offsetHours * 3600,
});

function mockConversation(parts: unknown[], ok = true): void {
  vi.stubGlobal('fetch', vi.fn(async () => ({
    ok,
    json: async () => ({ conversation_parts: { conversation_parts: parts } }),
  } as unknown as Response)));
}

beforeAll(async () => {
  await runMigrations();
  await query("INSERT INTO founders (id,clerk_user_id,email) VALUES ('f_oc','c_oc','oc@example.com')");
  await query("INSERT INTO products (id,name,owner_id,status) VALUES (?,'Acme','f_oc','active')", [P]);
  await query(
    `INSERT INTO signal_events (id,product_id,source,event_type,severity,payload_json,summary)
     VALUES ('oc_sig',?,'company_observation_baseline','company_observation_baseline:observed','low','{}','seed')`, [P]);
  await query(
    `INSERT INTO institutional_responsibilities
       (id,product_id,title,capability,state,discovery_evidence_ref)
     VALUES (?,?,'Answer people waiting on a quote','customer_support','shadowing','signal_event:oc_sig')`,
    [RESP, P]);
  // Assisting is REACHED, not asserted: a responsibility gets there by an owner
  // grant and a recorded transition, and the reply plan's guards read that
  // state. It starts in Shadowing because the grant's own trigger requires it —
  // `responsibility_authority:invalid_binding` refuses a grant to a
  // responsibility that has not got that far, so the ladder cannot be skipped
  // even by a fixture.
  const consent = await recordConsent({
    founderId: 'f_oc', productId: P, capability: 'customer_support',
    fromMode: 'observe', toMode: 'act', responsibilityId: RESP,
    allowedScope: ['send_email:support_reply'], consequenceBoundary: 'low',
    expiresAt: new Date(Date.now() + 3_600_000),
  });
  await moveResponsibilityTo(RESP, 'assisting',
    { productId: P, authorityRef: `autonomy_consent:${consent}` });
  // A CUSTOMER MESSAGE BELONGS TO A REGISTERED CHANNEL, and the database says
  // so: `inbound_message:channel_invalid`. That binding is what lets a message
  // be attributed to a responsibility without guessing from its text, so the
  // fixture registers a real one rather than inventing an id.
  const channel = await registerSupportChannel({
    productId: P, responsibilityId: RESP, founderId: 'f_oc', label: 'quotes@ inbox' });
  intakeKey = channel!.intakeKey;
});

beforeEach(async () => {
  // Only the witnesses reset. The reply itself is built once, through the
  // production path, because rebuilding it per test would mean re-deriving a
  // grant and a transition each time for no added coverage.
  await query('DELETE FROM signal_events WHERE product_id=? AND source=?', [P, 'intercom_conversation']);
  await query("UPDATE outbound_actions SET outcome_status=NULL, status='executed' WHERE id=?", [actionId]);

  // THROUGH THE DOOR, not around it. A customer message must carry the evidence
  // row that observed it (`inbound_message:evidence_invalid`), and hand-writing
  // one would be a fixture asserting a state production cannot produce. The
  // adapter is an ordinary caller of this same function.
  const arrived = await ingestCustomerMessage({
    intakeKey, externalMessageId: 'intercom:c9', contactEmail: 'buyer@example.com',
    body: 'Where is my quote?', conversationRef: 'intercom:c9',
    sourceObservedAt: '2026-08-20T09:00:00.000Z',
  });
  if ('refused' in arrived) throw new Error(`fixture refused: ${arrived.refused}`);
  const messageId = (await getMessagesAwaitingReply(P))[0]!.messageId;

  // THE REPLY IS AUTHORED AND PLANNED THROUGH THE PRODUCTION PATH. An outbound
  // action carrying an inbound message must name the same responsibility that
  // owns the channel, and must carry a real proposal authored for that same
  // message — `assisted_reply:message_binding_invalid` and
  // `assisted_reply:proposal_invalid`. Those guards are the reason one
  // responsibility cannot claim another's customer, so the fixture goes
  // through them rather than around.
  const proposed = await proposeSupportReply({
    productId: P, founderId: 'f_oc', messageId,
    body: 'Thursday at nine, if that suits.' });
  if (!('proposal' in proposed)) throw new Error('fixture: proposal refused');
  const planned = await planProposedReply({
    productId: P, founderId: 'f_oc', proposalId: proposed.proposal.id });
  if (!('actionId' in planned)) throw new Error('fixture: plan refused');
  actionId = planned.actionId;

  // Executed is the state this observer is FOR: a reply that went out and whose
  // outcome nothing has settled.
  await query(
    `UPDATE outbound_actions SET status='executed', effect_id='eff_oc', executed_at=?
      WHERE id=?`, [EXECUTED_AT, actionId]);
});

afterEach(() => { vi.unstubAllGlobals(); });

async function witnesses(): Promise<Array<Record<string, unknown>>> {
  return (await query(
    "SELECT id,event_type,payload_json FROM signal_events WHERE product_id=? AND source='intercom_conversation'",
    [P])).rows as unknown as Array<Record<string, unknown>>;
}

describe('the customer writing again is the witness', () => {
  it('records a failure when they wrote after the reply went out', async () => {
    mockConversation([part('p1', 'user', -1), part('p2', 'admin', 0), part('p3', 'user', 2)]);
    const result = await observeIntercomReplyOutcomes(P, { access_token: 't' });
    expect(result).toMatchObject({ examined: 1, customerWroteAgain: 1, quiet: 0 });

    const found = await witnesses();
    expect(found).toHaveLength(1);
    expect(String(found[0]!.event_type)).toBe('support_reply_failed');
    expect(JSON.parse(String(found[0]!.payload_json))).toMatchObject({
      effect_id: 'eff_oc', customer_part_id: 'p3',
    });
  });

  it('reaches the reconciliation that was waiting for a witness', async () => {
    mockConversation([part('p3', 'user', 2)]);
    await observeIntercomReplyOutcomes(P, { access_token: 't' });

    const { reconcileAssistedSupportEmail } = await import(
      '../../src/services/institution/responsibility-assisted-email.js');
    await reconcileAssistedSupportEmail(P, actionId);

    const row = (await query(
      'SELECT outcome_status FROM outbound_actions WHERE id=?', [actionId])).rows[0] as
      Record<string, unknown>;
    expect(String(row.outcome_status)).toBe('verified_failure');
  });

  it('the founder is told WHO the witness was, not just that there was one', async () => {
    // "Somebody outside told me it did not work" reads as a third party
    // volunteering a verdict. What happened is that the person the reply was
    // sent to wrote again, which is a fact with a time on it rather than an
    // opinion — and a founder cannot weigh a verdict they cannot attribute.
    mockConversation([part('p3', 'user', 2)]);
    await observeIntercomReplyOutcomes(P, { access_token: 't' });

    const { reconcileAssistedSupportEmail, getFounderAssistingActivity } = await import(
      '../../src/services/institution/responsibility-assisted-email.js');
    await reconcileAssistedSupportEmail(P, actionId);

    const said = (await getFounderAssistingActivity(P)).map((a) => a.detail).join(' | ');
    expect(said).toMatch(/wrote again after you answered/i);
    expect(said).not.toMatch(/somebody outside/i);
  });

  it('the same reply seen twice converges instead of counting as two witnesses', async () => {
    mockConversation([part('p3', 'user', 2)]);
    await observeIntercomReplyOutcomes(P, { access_token: 't' });
    await observeIntercomReplyOutcomes(P, { access_token: 't' });
    expect(await witnesses()).toHaveLength(1);
  });
});

describe('silence records nothing at all', () => {
  it('a quiet conversation leaves the outcome unresolved', async () => {
    mockConversation([part('p1', 'user', -1), part('p2', 'admin', 0)]);
    const result = await observeIntercomReplyOutcomes(P, { access_token: 't' });
    expect(result).toMatchObject({ examined: 1, customerWroteAgain: 0, quiet: 1 });
    expect(await witnesses()).toHaveLength(0);
  });

  it('a teammate replying is not the customer answering', async () => {
    // Foundry may not find a witness in its own colleagues.
    mockConversation([part('p2', 'admin', 1), part('p4', 'bot', 3)]);
    const result = await observeIntercomReplyOutcomes(P, { access_token: 't' });
    expect(result).toMatchObject({ customerWroteAgain: 0, quiet: 1 });
    expect(await witnesses()).toHaveLength(0);
  });

  it('a customer message from BEFORE the reply is not an answer to it', async () => {
    mockConversation([part('p1', 'user', -2)]);
    const result = await observeIntercomReplyOutcomes(P, { access_token: 't' });
    expect(result).toMatchObject({ customerWroteAgain: 0, quiet: 1 });
  });

  it('a provider that cannot be reached is not a quiet customer', async () => {
    mockConversation([], false);
    const result = await observeIntercomReplyOutcomes(P, { access_token: 't' });
    expect(result).toMatchObject({ providerUnavailable: 1, examined: 0, quiet: 0 });
  });
});

describe('no path here can say it worked', () => {
  it('the module contains no success verdict', async () => {
    // COMMENTS STRIPPED, and my first version of this assertion did not — the
    // header says in prose that no code path here can write
    // `support_reply_effective`, and the bare grep read that sentence as the
    // thing it forbids. The same mistake `check-gates-are-tested` made about
    // itself, in a test written the day after fixing it.
    const { stripComments } = await import('../../scripts/lib/strip-comments.mjs');
    const raw = readFileSync('src/services/integrations/intercom-messages.ts', 'utf8');
    expect(stripComments(raw, { lineComments: true })).not.toContain('support_reply_effective');
    // The prose is asserted separately, because the reason must survive too:
    // a later reader must not add a success path for symmetry.
    expect(raw.toLowerCase()).toContain('only ever runs against foundry');
  });

  it('an already-settled reply is not re-examined', async () => {
    await query("UPDATE outbound_actions SET outcome_status='verified_success' WHERE id=?", [actionId]);
    mockConversation([part('p3', 'user', 2)]);
    const result = await observeIntercomReplyOutcomes(P, { access_token: 't' });
    expect(result.examined).toBe(0);
  });
});

describe('when the founder and the customer disagree', () => {
  // THE PATH THAT ONLY BECAME REACHABLE WHEN THE OBSERVER WAS BUILT. Before it,
  // a support outcome had one possible witness at a time. Now the founder can
  // report that a reply worked and the customer can write again saying
  // otherwise, which is a real disagreement between the two people best placed
  // to know — and the one Foundry must not settle.
  it('keeps both, settles nothing, and SHOWS both', async () => {
    const { reportEffectOutcome, getDisputedEffects } = await import(
      '../../src/services/institution/effect-outcome.js');
    const { reconcileAssistedSupportEmail } = await import(
      '../../src/services/institution/responsibility-assisted-email.js');

    await reportEffectOutcome({
      productId: P, effectId: 'eff_oc', verdict: 'achieved',
      reporter: 'founder:f_oc', detail: 'Rang them and it was sorted.' });
    mockConversation([part('p3', 'user', 2)]);
    await observeIntercomReplyOutcomes(P, { access_token: 't' });
    await reconcileAssistedSupportEmail(P, actionId);

    const row = (await query(
      'SELECT outcome_status FROM outbound_actions WHERE id=?', [actionId]))
      .rows[0] as Record<string, unknown>;
    expect(String(row.outcome_status)).toBe('conflicting');

    // A CARD THAT SAYS "PEOPLE DISAGREE" MUST SHOW WHAT DISAGREES. The reports
    // query used to read only the general shape while the reconciliation read a
    // wider set, so the customer's side was invisible and the founder saw a
    // disagreement with one side of it.
    const disputed = await getDisputedEffects(P);
    expect(disputed).toHaveLength(1);
    const verdicts = disputed[0]!.reports.map((r) => `${r.reporter}=${r.verdict}`).sort();
    expect(verdicts).toEqual(['customer:wrote_again=failed', 'founder:f_oc=achieved']);
  });

  it('the page names both sides in the founder\'s language', async () => {
    const { Hono } = await import('hono');
    const { reportEffectOutcome } = await import(
      '../../src/services/institution/effect-outcome.js');
    const { reconcileAssistedSupportEmail } = await import(
      '../../src/services/institution/responsibility-assisted-email.js');
    await reportEffectOutcome({
      productId: P, effectId: 'eff_oc', verdict: 'achieved', reporter: 'founder:f_oc' });
    mockConversation([part('p3', 'user', 2)]);
    await observeIntercomReplyOutcomes(P, { access_token: 't' });
    await reconcileAssistedSupportEmail(P, actionId);

    const { letterRoutes } = await import('../../src/routes/dashboard/letter.js');
    const app = new Hono();
    app.use('*', async (c, next) => {
      c.set('founder' as never, { id: 'f_oc', email: 'oc@example.com', preferences: {} } as never);
      c.set('csrfToken' as never, 't' as never);
      await next();
    });
    app.route('/', letterRoutes as unknown as Hono);
    const page = await (await app.request('/letter')).text();

    expect(page).toContain('People disagree about this');
    expect(page).toContain('the customer, by writing again');
    expect(page).toMatch(/not going to pick one/i);
    // And no internal identifier reaches the founder on the way.
    expect(page).not.toContain('founder:f_oc');
  });
});
