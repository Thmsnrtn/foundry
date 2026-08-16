process.env.TURSO_DATABASE_URL = 'file::memory:';

import { beforeAll, describe, expect, it } from 'vitest';
import { runMigrations } from '../../src/db/migrate.js';
import { query } from '../../src/db/client.js';
import { reportCompanyObligation } from '../../src/services/founder/company-report.js';
import {
  getMessagesForResponsibility, ingestCustomerMessage, registerSupportChannel,
  revokeSupportChannel,
} from '../../src/services/institution/customer-message-intake.js';

// =============================================================================
// Inbound customer communication as canonical external evidence.
//
// The hard part is not carrying a message — it is knowing which responsibility
// it belongs to without inferring it from prose. The founder registers a
// channel *against* a responsibility, and a message is attributed because it
// arrived on that responsibility's own channel. Structural, not semantic.
//
// This slice deliberately proves intake ALONE. No reply, no plan, no send.
// =============================================================================

const OWNER = 'cm_owner';
const STRANGER = 'cm_stranger';
const PRODUCT = 'cm_studio';
const OTHER = 'cm_other';

async function countOf(sql: string, args: unknown[] = []): Promise<number> {
  return Number(((await query(sql, args)).rows[0] as Record<string, unknown>).n);
}

let responsibilityId: string;
let intakeKey: string;
let channelId: string;
let otherKey: string;

beforeAll(async () => {
  await runMigrations();
  await query(`INSERT INTO founders (id,clerk_user_id,email) VALUES
    (?,'cm_clerk','owner@example.com'),(?,'cm_stranger_clerk','stranger@example.com')`, [OWNER, STRANGER]);
  await query(`INSERT INTO products (id,name,owner_id) VALUES
    (?,'Marlow Pottery Studio',?),(?,'Other Co',?)`, [PRODUCT, OWNER, OTHER, STRANGER]);

  responsibilityId = (await reportCompanyObligation({
    productId: PRODUCT, founderId: OWNER, obligationKind: 'customer_commitment',
    what: 'Answer customers asking where their order is',
  }))!.responsibility!.id;

  const otherResponsibility = (await reportCompanyObligation({
    productId: OTHER, founderId: STRANGER, obligationKind: 'customer_commitment',
    what: 'Answer their own customers',
  }))!.responsibility!.id;
  otherKey = (await registerSupportChannel({
    productId: OTHER, responsibilityId: otherResponsibility, founderId: STRANGER, label: 'Their inbox',
  }))!.intakeKey;
});

describe('inbound customer messages', () => {
  it('binds a channel to a responsibility, with provenance', async () => {
    const channel = await registerSupportChannel({
      productId: PRODUCT, responsibilityId, founderId: OWNER, label: 'orders@marlowpottery.example',
    });
    expect(channel).toMatchObject({ responsibilityId, label: 'orders@marlowpottery.example', revoked: false });
    intakeKey = channel!.intakeKey;
    channelId = channel!.id;
    // The key is credential-strength; a guessable one is refused by the database.
    expect(intakeKey.length).toBeGreaterThanOrEqual(24);

    // The association is a founder assertion with real provenance, not an
    // unaccountable configuration row.
    const claim = (await query(
      `SELECT subject,derivation_method,evidence_refs_json FROM reconstruction_claims
        WHERE product_id=? AND predicate='support_channel'`, [PRODUCT]))
      .rows[0] as Record<string, unknown>;
    expect(claim).toMatchObject({
      subject: `responsibility:${responsibilityId}`,
      derivation_method: 'authenticated founder channel registration',
    });
    expect(String(claim.evidence_refs_json)).toContain('signal_event');

    // A stranger cannot register a channel on this company.
    expect(await registerSupportChannel({
      productId: PRODUCT, responsibilityId, founderId: STRANGER, label: 'mine now',
    })).toBeNull();
  });

  it('carries a real message and attributes it structurally', async () => {
    const result = await ingestCustomerMessage({
      intakeKey, externalMessageId: 'provider-evt-1', contactEmail: 'ada@example.com',
      subject: 'Where is order 4471?', body: 'I ordered three mugs on the 2nd and they have not arrived.',
      conversationRef: 'ticket-88', sourceObservedAt: '2026-08-14T09:00:00Z',
    });
    expect('refused' in result).toBe(false);
    if ('refused' in result) return;
    expect(result).toMatchObject({ duplicate: false });
    expect(result.message).toMatchObject({
      responsibilityId, contactEmail: 'ada@example.com', conversationRef: 'ticket-88',
    });

    // The source's clock is kept apart from ours: a delayed delivery is late,
    // not recent.
    expect(result.message.sourceObservedAt).toBe('2026-08-14T09:00:00.000Z');
    expect(result.message.receivedAt).not.toBe(result.message.sourceObservedAt);

    // It entered as canonical evidence, like every other external observation.
    expect(await countOf(
      "SELECT COUNT(*) n FROM signal_events WHERE product_id=? AND source='customer_message_ingest'", [PRODUCT]))
      .toBe(1);
    expect(await getMessagesForResponsibility(PRODUCT, responsibilityId)).toHaveLength(1);
  });

  it('creates no responsibility, no authority, and no maturity', async () => {
    // A message is evidence that someone said something. It is not a
    // responsibility, not consent, and not permission to do anything.
    expect(await countOf('SELECT COUNT(*) n FROM institutional_responsibilities WHERE product_id=?', [PRODUCT]))
      .toBe(1);
    expect(await countOf('SELECT COUNT(*) n FROM autonomy_consents WHERE product_id=?', [PRODUCT])).toBe(0);
    expect(await countOf('SELECT COUNT(*) n FROM outbound_actions WHERE product_id=?', [PRODUCT])).toBe(0);
    expect((await query('SELECT state FROM institutional_responsibilities WHERE id=?', [responsibilityId])).rows[0])
      .toMatchObject({ state: 'visible' });
  });

  it('converges on redelivery of the same provider event', async () => {
    for (let i = 0; i < 3; i++) {
      const replay = await ingestCustomerMessage({
        intakeKey, externalMessageId: 'provider-evt-1', contactEmail: 'ada@example.com',
        body: 'I ordered three mugs on the 2nd and they have not arrived.',
      });
      expect(replay).toMatchObject({ duplicate: true });
    }
    expect(await countOf('SELECT COUNT(*) n FROM inbound_customer_messages WHERE product_id=?', [PRODUCT])).toBe(1);
    expect(await countOf(
      "SELECT COUNT(*) n FROM signal_events WHERE product_id=? AND source='customer_message_ingest'", [PRODUCT]))
      .toBe(1);
  });

  it('keeps the same external id in two companies apart', async () => {
    const theirs = await ingestCustomerMessage({
      intakeKey: otherKey, externalMessageId: 'provider-evt-1',
      contactEmail: 'someone@example.com', body: 'A different company, a coincidentally equal id.',
    });
    expect('refused' in theirs).toBe(false);
    expect(await countOf('SELECT COUNT(*) n FROM inbound_customer_messages WHERE product_id=?', [OTHER])).toBe(1);
    // Neither company can see the other's message.
    expect(await getMessagesForResponsibility(PRODUCT, responsibilityId)).toHaveLength(1);
    expect(JSON.stringify(await getMessagesForResponsibility(PRODUCT, responsibilityId)))
      .not.toContain('coincidentally equal');
  });

  it('refuses an unknown, forged, or revoked key identically', async () => {
    // The caller learns nothing about which channels exist.
    for (const key of ['a'.repeat(32), 'not-a-real-key-but-long-enough-x', intakeKey.slice(0, -1) + 'X']) {
      expect(await ingestCustomerMessage({
        intakeKey: key, externalMessageId: 'x', contactEmail: 'a@b.com', body: 'hello',
      })).toEqual({ refused: 'unknown_channel' });
    }
    // And a channel the founder withdraws stops accepting immediately.
    const disposable = await registerSupportChannel({
      productId: PRODUCT, responsibilityId, founderId: OWNER, label: 'old address',
    });
    expect(await revokeSupportChannel({
      productId: PRODUCT, channelId: disposable!.id, founderId: OWNER,
    })).toBe(true);
    expect(await ingestCustomerMessage({
      intakeKey: disposable!.intakeKey, externalMessageId: 'late', contactEmail: 'a@b.com', body: 'hello',
    })).toEqual({ refused: 'unknown_channel' });
    // A stranger cannot revoke this company's channel.
    expect(await revokeSupportChannel({
      productId: PRODUCT, channelId, founderId: STRANGER,
    })).toBe(false);
  });

  it('refuses missing routing identity, empty or oversized content, and a bad timestamp', async () => {
    const base = { intakeKey, externalMessageId: 'evt-2', contactEmail: 'ada@example.com', body: 'hi' };
    expect(await ingestCustomerMessage({ ...base, externalMessageId: '   ' }))
      .toEqual({ refused: 'identity_required' });
    expect(await ingestCustomerMessage({ ...base, contactEmail: 'not-an-address' }))
      .toEqual({ refused: 'contact_required' });
    expect(await ingestCustomerMessage({ ...base, body: '   ' }))
      .toEqual({ refused: 'content_required' });
    expect(await ingestCustomerMessage({ ...base, body: 'x'.repeat(9000) }))
      .toEqual({ refused: 'content_too_large' });
    expect(await ingestCustomerMessage({ ...base, sourceObservedAt: 'last Tuesday' }))
      .toEqual({ refused: 'timestamp_invalid' });
    expect(await countOf('SELECT COUNT(*) n FROM inbound_customer_messages WHERE product_id=?', [PRODUCT])).toBe(1);
  });

  it('stores script-like content as text and never as markup', async () => {
    // Customer content is untrusted input. It is kept exactly as sent, and the
    // surface escapes it — a message containing a script tag is a message
    // containing a script tag.
    const hostile = '<script>fetch("/admin")</script> please refund me';
    const stored = await ingestCustomerMessage({
      intakeKey, externalMessageId: 'evt-hostile', contactEmail: 'mallory@example.com', body: hostile,
    });
    expect('refused' in stored).toBe(false);
    if ('refused' in stored) return;
    expect(stored.message.body).toBe(hostile);
    // Nothing about it changed any institutional state.
    expect(await countOf('SELECT COUNT(*) n FROM autonomy_consents WHERE product_id=?', [PRODUCT])).toBe(0);
  });

  it('refuses an external sender that tries to tell Foundry what its message means', async () => {
    // The event reports reality. Which expectation it proves, which judgment it
    // settles, and what authority should follow are institutional conclusions.
    const base = {
      channel_id: channelId, external_message_id: 'evt-claim', contact_email: 'a@b.com',
    };
    for (const claim of [
      { expectation_id: 'x' }, { judgment_id: 'x' }, { expected_event_type: 'x' },
      { state: 'operating' }, { consent: true }, { capability: 'customer_support' },
      { authority: 'granted' }, { scope: 'everything' }, { to_mode: 'act' },
    ]) {
      await expect(query(
        `INSERT INTO signal_events (id,product_id,source,event_type,severity,payload_json,summary)
         VALUES (?,?,'customer_message_ingest','customer_message_received','medium',?,'Claim')`,
        [`cm_claim_${Object.keys(claim)[0]}`, PRODUCT, JSON.stringify({ ...base, ...claim })],
      )).rejects.toThrow(/institutional_claim/);
    }
  });

  it('refuses a message routed to a channel of another company', async () => {
    // The channel must belong to the tenant the intake authenticated as.
    await expect(query(
      `INSERT INTO signal_events (id,product_id,source,event_type,severity,payload_json,summary)
       VALUES ('cm_cross',?,'customer_message_ingest','customer_message_received','medium',?,'Cross')`,
      [OTHER, JSON.stringify({ channel_id: channelId, external_message_id: 'evt-cross' })],
    )).rejects.toThrow(/channel_foreign/);

    // And a message row cannot be attributed to a responsibility the channel
    // does not govern.
    const foreignResponsibility = String(((await query(
      'SELECT id FROM institutional_responsibilities WHERE product_id=?', [OTHER]))
      .rows[0] as Record<string, unknown>).id);
    const signalId = String(((await query(
      `SELECT id FROM signal_events WHERE product_id=? AND source='customer_message_ingest' LIMIT 1`, [PRODUCT]))
      .rows[0] as Record<string, unknown>).id);
    await expect(query(
      `INSERT INTO inbound_customer_messages
         (id,product_id,channel_id,responsibility_id,external_message_id,contact_email,body,
          source_observed_at,evidence_signal_id)
       VALUES ('cm_misattributed',?,?,?,'evt-mis','a@b.com','hello',datetime('now'),?)`,
      [PRODUCT, channelId, foreignResponsibility, signalId],
    )).rejects.toThrow(/channel_invalid/);
  });

  it('has a production caller — the intake route actually reaches it', async () => {
    const { readFileSync } = await import('node:fs');
    const { resolve } = await import('node:path');
    const route = readFileSync(resolve(process.cwd(), 'src/routes/ingest/index.ts'), 'utf8');
    expect(route).toMatch(/ingestCustomerMessage/);
    expect(route).toMatch(/ingest\/customer-message/);
    // And it does not put messages in the metric store.
    expect(route).not.toMatch(/metric_snapshots[\s\S]{0,200}body/);
  });
});
