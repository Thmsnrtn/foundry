// =============================================================================
// THE REPLY ROUTE PROVES ITSELF, AND WHAT IT PROVES IS GRADED.
//
//   a rule exists, a program is deployed, a store has an id → and none of that
//   is a reply arriving → so the Workshop sends one message to its own
//   advertised address and looks for it → what comes back is recognised before
//   anything stores it: never a conversation, never the Inbox, never outreach,
//   never a suppression → the grade says what the evidence covers and what it
//   does not → proof goes stale → and until there is proof, a test that
//   invites a reply may not write to anybody.
//
// Nobody real is written to. Every provider is stubbed at the network edge.
// =============================================================================

process.env.TURSO_DATABASE_URL = 'file::memory:';
process.env.ENCRYPTION_KEY = '7'.repeat(64);
process.env.STRIPE_SECRET_KEY = 'sk_test_fake';
process.env.RESEND_API_KEY = 're_test_key';
process.env.CLOUDFLARE_API_TOKEN = 'cfat_test_token';
process.env.CLOUDFLARE_ACCOUNT_ID = 'acct_test';
process.env.FOUNDRY_INSTANCE_POSTURE = 'private_owner';
process.env.FOUNDRY_OWNER_EMAIL = 'thomas@example.com';
process.env.APP_URL = 'https://foundry-intel.fly.dev';

import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { runMigrations } from '../../src/db/migrate.js';
import { query } from '../../src/db/client.js';
import '../../src/services/integration/cloudflare-gateway.js';
import { providerStubs } from '../helpers/provider-stubs.js';
import { establishPublicWorkshop, publicWorkshopOf, setPostalAddress } from '../../src/services/public-workshop/settings.js';
import { standUpWorkshop, standUpTheEars } from '../../src/services/public-workshop/infrastructure.js';
import { hearMail, needsTheOwner, theInbox } from '../../src/services/public-workshop/mail.js';
import { isSuppressed } from '../../src/services/public-workshop/suppression.js';
import {
  PROBE_ARRIVES_WITHIN_MINUTES, PROBE_EVERY_HOURS, PROBE_MOST_PER_DAY, PROBE_SUBJECT,
  probeIsDue, replyRouteEvidence, sendReplyProbe,
} from '../../src/services/public-workshop/reply-probe.js';

vi.setConfig({ testTimeout: 180_000 });
const OWNER = 'rp_owner'; const FOUNDRY = 'rp_foundry';
const { state, fetch: fetchStub } = providerStubs();
const rowsOf = async (sql: string, p: unknown[] = []) => (await query(sql, p)).rows as unknown as Array<Record<string, unknown>>;
let CONTACT = '';

/** The world outside: the provider carries it, the zone routes it, the program hands it on. */
const theWorldDelivers = async (nonce: string, from?: string) => hearMail({
  founderId: OWNER, to: CONTACT, from: from ?? CONTACT,
  subject: PROBE_SUBJECT(nonce),
  body: 'This is an automated check that replies to this address arrive.',
  rfcMessageId: `<probe-${nonce}@apexmicro.ai>`,
});

beforeAll(async () => {
  vi.stubGlobal('fetch', fetchStub);
  await runMigrations();
  await query(`INSERT INTO founders (id,clerk_user_id,email,name) VALUES (?,?,?,?)`, [OWNER, 'rp_clk', 'thomas@example.com', 'Thomas Norton']);
  await query(`INSERT INTO products (id,name,owner_id,status,operating_budget_monthly_usd) VALUES (?,'Foundry',?,'active',50)`, [FOUNDRY, OWNER]);
  await query(`INSERT INTO system_identities (identity_key,product_id,established_reason) VALUES ('foundry',?,'the reply route')`, [FOUNDRY]);
  const w = await establishPublicWorkshop({ founderId: OWNER });
  CONTACT = w.contactEmail;
  await setPostalAddress(OWNER, 'PO Box 1, Example, MA 01000');
  await standUpWorkshop(OWNER);
  const { setSendingIdentity } = await import('../../src/services/outbound/sending-identity.js');
  state.domains.push({ id: 'dom_rp', name: 'apexmicro.ai', status: 'verified', records: [] });
  await setSendingIdentity({ productId: FOUNDRY, provider: 'resend', credential: 're_key', fromEmail: w.contactEmail, fromName: w.publicName });
  await standUpTheEars(OWNER);
});
afterAll(() => { vi.unstubAllGlobals(); });

describe('nothing is known about the route until a message has come back', () => {
  it('says so, in those words, and says what the absence covers: everything', async () => {
    const e = await replyRouteEvidence(OWNER);
    expect(e.grade).toBe('never_sent');
    expect(e.at).toBeNull();
    expect(e.sentence).toContain('Nothing has ever been sent to this address');
    expect(e.doesNotCover).toContain('a routing rule that exists is not a message that arrived');
  });

  it('and a configuration that is entirely healthy does not change that', async () => {
    const { workshopHealth } = await import('../../src/services/public-workshop/infrastructure.js');
    // Everything the institution can READ about the setup is right: the rule,
    // the program, the store. This is the state the institution was in on the
    // morning nineteen people were invited to answer an address that went
    // nowhere, and it is not evidence.
    expect((await workshopHealth(OWNER, { fetchImpl: fetchStub })).replyInbox.status).toBe('healthy');
    expect((await replyRouteEvidence(OWNER)).grade).toBe('never_sent');
  });
});

describe('the check goes through the governed door and is not outreach', () => {
  let nonce = '';
  it('leaves a receipt at the door and no row in what the institution has written to people', async () => {
    const before = (await rowsOf(`SELECT id FROM outbound_actions`)).length;
    const sent = await sendReplyProbe(OWNER);
    if (!('sent' in sent)) throw new Error(sent.refused);
    nonce = sent.nonce;
    expect(sent.route).toBe('self');
    // One message, to the Workshop's own address, unmistakably a diagnostic.
    const m = state.sends[state.sends.length - 1];
    expect(m.to).toEqual([CONTACT]);
    expect(m.subject).toBe(PROBE_SUBJECT(nonce));
    // THE DOOR SAW IT. A consequential effect that leaves no receipt is the
    // thing the door exists to prevent, and a diagnostic is not exempt.
    const audited = await rowsOf(
      `SELECT action_type, outcome FROM audit_log WHERE action_type = 'gateway:workshop_reply_probe' ORDER BY rowid DESC LIMIT 1`);
    expect(audited[0], 'the governed door left a receipt').toMatchObject({ outcome: 'allowed' });
    // AND NOT ONE ROW IN WHAT THE INSTITUTION HAS WRITTEN TO PEOPLE. That
    // table is what every count of outreach is drawn from, and the owner's
    // condition on this check was that it stay out of them.
    expect((await rowsOf(`SELECT id FROM outbound_actions`)).length).toBe(before);
  });

  it('and what comes back never becomes a message the institution holds', async () => {
    const inboxBefore = (await theInbox(OWNER)).length;
    const heard = await theWorldDelivers(nonce);
    expect(heard.probe).toBe(true);
    expect(heard.handling).toBe('no_action');
    // Not a conversation, not the owner's attention, not a suppression, not a
    // business outcome, not a contact in anyone's history.
    expect((await theInbox(OWNER)).length).toBe(inboxBefore);
    expect((await needsTheOwner(OWNER)).length).toBe(0);
    expect(await rowsOf(`SELECT id FROM workshop_mail`)).toHaveLength(0);
    expect(await isSuppressed(OWNER, CONTACT)).toMatchObject({ suppressed: false });
    expect(await rowsOf(`SELECT id FROM business_outcome_events`)).toHaveLength(0);
  });

  it('a message that merely looks like a check is somebody\'s mail, and is kept', async () => {
    const heard = await hearMail({
      founderId: OWNER, to: CONTACT, from: 'stranger@example.com',
      subject: '[Foundry reply-route check notarealnonce]',
      body: 'I saw your page and wanted to ask a question.',
      rfcMessageId: '<pretender@example.com>',
    });
    expect(heard.probe).toBeUndefined();
    expect(await rowsOf(`SELECT id FROM workshop_mail`)).toHaveLength(1);
  });
});

describe('the grade says what the evidence covers, and never reduces it to a yes', () => {
  it('a message the Workshop sent to itself proves the inbound path and says what it does not prove', async () => {
    const e = await replyRouteEvidence(OWNER);
    expect(e.grade).toBe('proven_self');
    expect(e.sentence).toContain('crossed the routing rule and the program that hears');
    expect(e.doesNotCover).toContain('a sender who is not us');
  });

  it('a message from a separately controlled mailbox proves the part the first one cannot', async () => {
    // `force`, because the interval has not passed since the last check and
    // the bound is real. The world would simply wait a day.
    const sent = await sendReplyProbe(OWNER, { route: 'external', force: true });
    if (!('sent' in sent)) throw new Error(sent.refused);
    await theWorldDelivers(sent.nonce, 'probe@someone-elses-mailbox.example');
    const e = await replyRouteEvidence(OWNER);
    expect(e.grade).toBe('proven_external');
    expect(e.sentence).toContain('from outside this institution');
    expect(e.doesNotCover).toBeNull();
  });

  it('a check that never arrived is a failure, not a silence — and inside its window it is neither', async () => {
    // A DEPLOYMENT WITH ONE ATTEMPT AND NO ANSWER. The record of what was sent
    // is immutable by its own trigger, so the clock that moves here is the
    // observer's, which is the only one that ever moves in the world either.
    await query(`DELETE FROM reply_route_probes`);
    const sent = await sendReplyProbe(OWNER);
    if (!('sent' in sent)) throw new Error(sent.refused);
    const inside = await replyRouteEvidence(OWNER);
    expect(inside.grade).toBe('never_sent');
    expect(inside.sentence).toContain('inside the time one is allowed');
    const later = new Date(Date.now() + (PROBE_ARRIVES_WITHIN_MINUTES + 5) * 60_000);
    const after = await replyRouteEvidence(OWNER, later);
    expect(after.grade).toBe('sent_not_arrived');
    expect(after.doesNotCover).toContain('could reach this Workshop by replying');
  });
});

describe('a diagnostic that ran hourly would be a mailing list', () => {
  it('the bound is at the act, so a second caller cannot get around the first', async () => {
    await query(`DELETE FROM reply_route_probes`);
    const sent = await sendReplyProbe(OWNER);
    if (!('sent' in sent)) throw new Error(sent.refused);
    expect(await probeIsDue(OWNER)).toBe(false);
    // NOT MERELY "THE JOB ASKS FIRST". Anything that calls the sender gets the
    // same answer, which is the difference between a rule and a habit.
    const again = await sendReplyProbe(OWNER);
    expect(again).toMatchObject({ refused: expect.stringContaining('inside the interval') });
    expect((await query(`SELECT COUNT(*) AS n FROM reply_route_probes`)).rows[0]).toMatchObject({ n: 1 });
  });

  it('and a day has a hard ceiling under it, so a clock that jumps cannot make it a campaign', async () => {
    await query(`DELETE FROM reply_route_probes`);
    const midnight = `${new Date().toISOString().slice(0, 10)}T00:01:00.000Z`;
    for (let i = 0; i < PROBE_MOST_PER_DAY; i += 1) {
      await query(`INSERT INTO reply_route_probes (id, founder_id, nonce, route, advertised, sent_at) VALUES (?,?,?,?,?,?)`,
        [`rrp_ceiling_${i}`, OWNER, `ceiling${i}xx`, 'self', CONTACT, midnight]);
    }
    // Long past the interval, and still refused: the day's ceiling is the
    // second bound, and it is the one that holds when the first one is spent.
    const tomorrowish = new Date(new Date(midnight).getTime() + (PROBE_EVERY_HOURS + 1) * 3_600_000);
    expect(await probeIsDue(OWNER, new Date(new Date(midnight).getTime() + 3_600_000))).toBe(false);
    expect(tomorrowish.toISOString().slice(0, 10), 'the interval clears only by crossing into a new day')
      .not.toBe(midnight.slice(0, 10));
  });
});
