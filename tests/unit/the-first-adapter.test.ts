process.env.TURSO_DATABASE_URL = 'file::memory:';
process.env.ENCRYPTION_KEY = '0'.repeat(64);

import { readFileSync } from 'node:fs';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { runMigrations } from '../../src/db/migrate.js';
import { query } from '../../src/db/client.js';
import {
  SUPPORT_CHANNEL_FEEDS, getSupportChannels, registerSupportChannel, setChannelFeed,
} from '../../src/services/institution/customer-message-intake.js';
import { ingestIntercomMessages, plainText } from '../../src/services/integrations/intercom-messages.js';

// =============================================================================
// THE FIRST ADAPTER: WHAT A CUSTOMER ACTUALLY WROTE.
//
// The support responsibility chain has been complete from the door inwards and
// its first link was an empty box. `syncIntercomMetrics` has counted Intercom
// conversations since it existed and thrown the content away —
// `support_volume_7d` is how many people wrote — so no real customer's words
// could reach the institution without somebody hand-POSTing JSON, and the
// responsibility could be understood and shadowed and never assisted.
//
// The adapter is an ORDINARY CALLER of the existing door, which is what the
// design record always said it should be. It inherits the channel binding, the
// tenant scope, the dedup, the bounded fields and the refusal record.
//
// WHICH RESPONSIBILITY A MESSAGE BELONGS TO IS NOT SOMETHING FOUNDRY MAY GUESS.
// A product can hold several channels bound to different responsibilities, so
// the FOUNDER says which one a provider feeds. No statement, no ingestion.
// =============================================================================

const P = 'p_adapter';
const RESP_A = 'resp_adapter_a';
const RESP_B = 'resp_adapter_b';
let channelA = { id: '', intakeKey: '' };
let channelB = { id: '', intakeKey: '' };

const conversation = (id: string, over: Record<string, unknown> = {}) => ({
  id,
  created_at: Math.floor(Date.now() / 1000) - 3600,
  source: {
    subject: 'Where is my quote?',
    body: '<p>Hi — I ordered on Tuesday and heard nothing.</p>',
    author: { email: 'buyer@example.com' },
  },
  ...over,
});

function mockIntercom(pages: Array<{ data: unknown[]; next?: boolean }>): void {
  let call = 0;
  vi.stubGlobal('fetch', vi.fn(async () => {
    const page = pages[Math.min(call++, pages.length - 1)]!;
    return {
      ok: true,
      json: async () => ({ data: page.data, pages: page.next ? { next: 'x' } : {} }),
    } as unknown as Response;
  }));
}

beforeAll(async () => {
  await runMigrations();
  await query("INSERT INTO founders (id,clerk_user_id,email) VALUES ('f_ad','c_ad','ad@example.com')");
  await query("INSERT INTO products (id,name,owner_id,status) VALUES (?,'Acme','f_ad','active')", [P]);
  // ONE RESPONSIBILITY, ONE WITNESS. `discovery_evidence_ref` is unique per
  // product: a responsibility carries the single observation that discovered
  // it, so two responsibilities need two witnesses rather than one shared one.
  for (const [id, title, sig] of [
    [RESP_A, 'Answer people waiting on a quote', 'ad_sig_a'],
    [RESP_B, 'Answer billing questions', 'ad_sig_b'],
  ] as Array<[string, string, string]>) {
    await query(
      `INSERT INTO signal_events (id,product_id,source,event_type,severity,payload_json,summary)
       VALUES (?,?,'company_observation_baseline','company_observation_baseline:observed','low','{}','seed')`,
      [sig, P]);
    await query(
      `INSERT INTO institutional_responsibilities
         (id,product_id,title,capability,state,discovery_evidence_ref)
       VALUES (?,?,?,'customer_support','shadowing',?)`, [id, P, title, `signal_event:${sig}`]);
  }
  const a = await registerSupportChannel({
    productId: P, responsibilityId: RESP_A, founderId: 'f_ad', label: 'quotes@ inbox' });
  const b = await registerSupportChannel({
    productId: P, responsibilityId: RESP_B, founderId: 'f_ad', label: 'billing@ inbox' });
  channelA = { id: a!.id, intakeKey: a!.intakeKey };
  channelB = { id: b!.id, intakeKey: b!.intakeKey };
});

beforeEach(async () => {
  await query('DELETE FROM inbound_customer_messages WHERE product_id = ?', [P]);
  await query('UPDATE support_channels SET fed_by = NULL WHERE product_id = ?', [P]);
});
afterEach(() => { vi.unstubAllGlobals(); });

describe('the founder says what feeds a channel; Foundry does not guess', () => {
  it('ingests nothing, and says so, when no channel claims the provider', async () => {
    mockIntercom([{ data: [conversation('c1')] }]);
    const result = await ingestIntercomMessages(P, { access_token: 't' });
    expect(result.noChannel).toBe(true);
    expect(result.seen).toBe(0);
    expect((await query('SELECT COUNT(*) n FROM inbound_customer_messages WHERE product_id=?', [P]))
      .rows[0]).toMatchObject({ n: 0 });
  });

  it('refuses a second channel claiming the same provider, rather than choosing', async () => {
    expect(await setChannelFeed({ productId: P, channelId: channelA.id, provider: 'intercom' }))
      .toEqual({ ok: true });
    expect(await setChannelFeed({ productId: P, channelId: channelB.id, provider: 'intercom' }))
      .toEqual({ refused: 'provider_taken' });
  });

  it('refuses a provider with no adapter, and a channel from another company', async () => {
    expect(await setChannelFeed({ productId: P, channelId: channelA.id, provider: 'zendesk' }))
      .toEqual({ refused: 'unknown_provider' });
    expect(await setChannelFeed({ productId: 'p_someone_else', channelId: channelA.id, provider: 'intercom' }))
      .toEqual({ refused: 'unknown_channel' });
  });

  it('the vocabulary the code offers is the one the database holds', async () => {
    const rows = await query('SELECT provider FROM support_channel_feeds ORDER BY provider');
    expect((rows.rows as unknown as Array<{ provider: string }>).map((r) => r.provider))
      .toEqual([...SUPPORT_CHANNEL_FEEDS].sort());
  });
});

describe('the founder can actually say it, on the page that describes it', () => {
  // A CAPABILITY THE COPY DESCRIBES AND THE SURFACE DOES NOT OFFER is the same
  // defect as the sentence that sent founders at a JSON door — one level along.
  // The service function and its refusals existed before this route did, so
  // this closes the gap rather than assuming it was never open.
  async function post(channelId: string, provider: string): Promise<Response> {
    const { Hono } = await import('hono');
    const { letterRoutes } = await import('../../src/routes/dashboard/letter.js');
    const app = new Hono();
    app.use('*', async (c, next) => {
      c.set('founder' as never,
        { id: 'f_ad', email: 'ad@example.com', preferences: {} } as never);
      c.set('csrfToken' as never, 't' as never);
      await next();
    });
    app.route('/', letterRoutes as unknown as Hono);
    return app.request(`/letter/channels/${channelId}/feed`, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ provider }).toString(),
    });
  }

  it('sets the feed, and the channel reports it', async () => {
    const res = await post(channelA.id, 'intercom');
    expect([302, 303]).toContain(res.status);
    const channels = await getSupportChannels(P);
    expect(channels.find((c) => c.id === channelA.id)?.fedBy).toBe('intercom');
  });

  it('unsets it when the provider is blank', async () => {
    await post(channelA.id, 'intercom');
    await post(channelA.id, '');
    const channels = await getSupportChannels(P);
    expect(channels.find((c) => c.id === channelA.id)?.fedBy).toBeNull();
  });

  it('tells the founder WHY a second channel cannot claim the same provider', async () => {
    await post(channelA.id, 'intercom');
    const res = await post(channelB.id, 'intercom');
    expect(res.status).toBe(400);
    const said = await res.text();
    expect(said).toMatch(/already receives/i);
    // The reason matters more than the refusal: they are about to wonder why
    // nothing arrives on the second one.
    expect(said).toMatch(/will not guess/i);
  });
});

describe('what the customer wrote reaches the responsibility', () => {
  beforeEach(async () => {
    await setChannelFeed({ productId: P, channelId: channelA.id, provider: 'intercom' });
  });

  it('a conversation becomes a message on the channel the founder named', async () => {
    mockIntercom([{ data: [conversation('c1')] }]);
    const result = await ingestIntercomMessages(P, { access_token: 't' });
    expect(result).toMatchObject({ seen: 1, accepted: 1, duplicate: 0, noChannel: false });

    const row = (await query(
      `SELECT responsibility_id, contact_email, body, subject FROM inbound_customer_messages
        WHERE product_id = ?`, [P])).rows[0] as Record<string, unknown>;
    expect(String(row.responsibility_id)).toBe(RESP_A);
    expect(String(row.contact_email)).toBe('buyer@example.com');
    expect(String(row.body)).toBe('Hi — I ordered on Tuesday and heard nothing.');
  });

  it('the same conversation on the next sync converges instead of arriving twice', async () => {
    mockIntercom([{ data: [conversation('c1')] }]);
    await ingestIntercomMessages(P, { access_token: 't' });
    const second = await ingestIntercomMessages(P, { access_token: 't' });
    expect(second).toMatchObject({ seen: 1, accepted: 0, duplicate: 1 });
    expect((await query('SELECT COUNT(*) n FROM inbound_customer_messages WHERE product_id=?', [P]))
      .rows[0]).toMatchObject({ n: 1 });
  });

  it('a contact with no email is skipped, not stored — Foundry could never answer it', async () => {
    mockIntercom([{ data: [conversation('c2', { source: {
      subject: 'anonymous', body: '<p>hello</p>', author: { email: null } } })] }]);
    const result = await ingestIntercomMessages(P, { access_token: 't' });
    expect(result).toMatchObject({ seen: 1, accepted: 0, skippedNoContact: 1 });
  });
});

describe('absence is not zero', () => {
  beforeEach(async () => {
    await setChannelFeed({ productId: P, channelId: channelA.id, provider: 'intercom' });
  });

  it('"I could not look" is a different fact from "nobody wrote"', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('network'); }));
    const unreachable = await ingestIntercomMessages(P, { access_token: 't' });
    expect(unreachable).toMatchObject({ providerUnavailable: true, seen: 0 });

    mockIntercom([{ data: [] }]);
    const quiet = await ingestIntercomMessages(P, { access_token: 't' });
    expect(quiet).toMatchObject({ providerUnavailable: false, seen: 0 });
  });

  it('a refused message is counted by reason, so a failing feed is visible', async () => {
    // The intake refuses a source timestamp in the future (migration 217).
    mockIntercom([{ data: [conversation('c3', {
      created_at: Math.floor(Date.now() / 1000) + 86_400 })] }]);
    const result = await ingestIntercomMessages(P, { access_token: 't' });
    expect(result.refused).toEqual({ timestamp_in_future: 1 });
    expect(result.accepted).toBe(0);
  });
});

describe('the sense states its own limits', () => {
  it('strips the markup Intercom sends without losing the words', () => {
    expect(plainText('<p>Line one.</p><p>Line&nbsp;two &amp; three.</p>'))
      .toBe('Line one.\nLine two & three.');
  });

  it('says in its own file what it cannot observe', () => {
    // A sense that overstates its coverage is worse than no sense. These are
    // the four limits the module commits to naming.
    const src = readFileSync('src/services/integrations/intercom-messages.ts', 'utf8');
    for (const limit of ['does not see replies', 'ABSENCE IS NOT ZERO',
      'MAX_CONVERSATIONS', 'never reach a model']) {
      expect(src.toLowerCase()).toContain(limit.toLowerCase());
    }
  });

  it('the customer\'s words do not reach a model on this path', async () => {
    const src = readFileSync('src/services/integrations/intercom-messages.ts', 'utf8');
    expect(src).not.toMatch(/callSonnet|callOpus|callHaiku/);
  });
});
