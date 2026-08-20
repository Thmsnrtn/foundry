process.env.TURSO_DATABASE_URL = 'file::memory:';
process.env.ENCRYPTION_KEY = '0'.repeat(64);

import { beforeAll, describe, expect, it } from 'vitest';
import { runMigrations } from '../../src/db/migrate.js';
import { query } from '../../src/db/client.js';
import {
  ingestCustomerMessage, registerSupportChannel,
} from '../../src/services/institution/customer-message-intake.js';
import {
  getMessagesAwaitingReply, planProposedReply, proposeSupportReply,
} from '../../src/services/institution/support-reply.js';
import { recordConsent } from '../../src/services/autopilot/consent.js';
import { moveResponsibilityTo } from '../fixtures/responsibility-state.js';

// =============================================================================
// THE FOUNDER MUST BE READING THE WORDS THAT WILL ACTUALLY GO.
//
// A founder writes a reply, asks Foundry to carry it, then thinks better of it
// and writes a second version. Nothing refuses that, and nothing plans the
// second — planning is a separate act.
//
// The plan records exactly which proposal it bound to, in
// `outbound_actions.reply_proposal_id`. Nothing read it. The surface asked
// "what is the newest proposal for this message", so from that moment the
// founder read their NEW words above a Send button that would dispatch the OLD
// ones. On the outbound boundary, that is the founder approving a message they
// were not shown.
//
// The words on the page now come from the plan, because that is the record of
// what will be sent.
// =============================================================================

const OWNER = 'ww_owner';
const P = 'ww_co';
const RESP = 'ww_resp';

let messageId: string;

beforeAll(async () => {
  await runMigrations();
  await query(`INSERT INTO founders (id,clerk_user_id,email) VALUES (?,'ww_c','o@example.com')`, [OWNER]);
  await query(`INSERT INTO products (id,name,owner_id,status) VALUES (?,'Barrowfield Groundworks',?,'active')`, [P, OWNER]);
  await query(
    `INSERT INTO signal_events (id,product_id,source,event_type,severity,payload_json,summary)
     VALUES ('ww_sig',?,'company_observation_baseline','company_observation_baseline:observed','low','{}','seed')`, [P]);
  await query(
    `INSERT INTO institutional_responsibilities (id,product_id,title,capability,state,discovery_evidence_ref)
     VALUES (?,?,'Answer people waiting on a quote','customer_support','shadowing','signal_event:ww_sig')`,
    [RESP, P]);

  const consent = await recordConsent({
    founderId: OWNER, productId: P, capability: 'customer_support', fromMode: 'observe', toMode: 'act',
    responsibilityId: RESP, allowedScope: ['send_email:support_reply'], consequenceBoundary: 'low',
    expiresAt: new Date(Date.now() + 3_600_000),
  });
  await moveResponsibilityTo(RESP, 'assisting',
    { productId: P, authorityRef: `autonomy_consent:${consent}` });

  const channel = await registerSupportChannel({
    productId: P, responsibilityId: RESP, founderId: OWNER, label: 'quotes@ inbox' });
  await ingestCustomerMessage({
    intakeKey: channel!.intakeKey, externalMessageId: 'evt-1',
    contactEmail: 'jo@fieldstone.example', subject: 'Drive and drainage quote',
    body: 'Can you come and look at the drive?' });
  messageId = (await getMessagesAwaitingReply(P))[0].messageId;
});

describe('a founder who rewrote their reply after asking Foundry to carry it', () => {
  it('is shown the words the plan will actually send', async () => {
    const first = await proposeSupportReply({
      productId: P, founderId: OWNER, messageId,
      body: 'Thursday at nine, if that suits.' });
    expect('proposal' in first).toBe(true);

    const planned = await planProposedReply({
      productId: P, founderId: OWNER,
      proposalId: (first as { proposal: { id: string } }).proposal.id });
    expect('actionId' in planned).toBe(true);

    // Second thoughts, after the plan exists. Nothing refuses this, and nothing
    // re-plans it either.
    const second = await proposeSupportReply({
      productId: P, founderId: OWNER, messageId,
      body: 'Actually Friday would be better, around two.' });
    expect('proposal' in second).toBe(true);

    const shown = (await getMessagesAwaitingReply(P))[0];
    expect(shown.state).toBe('planned');
    expect(shown.proposal).toContain('Thursday at nine');
    expect(shown.proposal).not.toContain('Friday would be better');
  });

  it('shows the latest words while nothing is planned, because nothing is bound yet', async () => {
    await ingestCustomerMessage({
      intakeKey: (await registerSupportChannel({
        productId: P, responsibilityId: RESP, founderId: OWNER, label: 'second inbox' }))!.intakeKey,
      externalMessageId: 'evt-2', contactEmail: 'sam@fieldstone.example',
      body: 'And the side gate?' });
    const second = (await getMessagesAwaitingReply(P)).find((m) => m.contactEmail.startsWith('sam'))!;

    await proposeSupportReply({ productId: P, founderId: OWNER, messageId: second.messageId, body: 'One moment.' });
    await proposeSupportReply({ productId: P, founderId: OWNER, messageId: second.messageId, body: 'Yes, both together.' });

    const shown = (await getMessagesAwaitingReply(P)).find((m) => m.messageId === second.messageId)!;
    expect(shown.state).toBe('proposed');
    expect(shown.proposal).toContain('Yes, both together');
  });
});
