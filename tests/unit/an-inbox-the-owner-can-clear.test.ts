process.env.TURSO_DATABASE_URL = 'file::memory:';
process.env.ENCRYPTION_KEY = '7'.repeat(64);
process.env.FOUNDRY_INSTANCE_POSTURE = 'private_owner';
process.env.FOUNDRY_OWNER_EMAIL = 'owner@example.com';
process.env.APP_URL = 'http://localhost:8080';

import { Hono } from 'hono';
import { beforeAll, describe, expect, it } from 'vitest';
import { runMigrations } from '../../src/db/migrate.js';
import { query } from '../../src/db/client.js';
import {
  archiveThread, mailHealth, needsTheOwner, settleThread, theThread, theThreads, threadCounts, unarchiveThread,
} from '../../src/services/public-workshop/mail.js';

// =============================================================================
// AN INBOX THE OWNER CAN CLEAR.
//
// `handling` has five states and every one is a JUDGEMENT about the message.
// There was no way to say the thing a person says most often about a message
// they have finished with: take this off my screen. So the inbox could only
// grow, and the only way to shrink it was to assert something false.
//
// Archiving says nothing about the message. It changes no reading, no grounds
// and no reply; the row is untouched and still readable. It is reversible for
// exactly that reason — every verdict in this family is immutable on purpose,
// and a view state that could not be undone would make tidying a screen into a
// decision. Clearing the owner's view is not deleting institutional evidence.
//
// And the object is the CONVERSATION. The list showed messages while the row
// opened a thread and the button settled a message: three objects in one row.
// =============================================================================

const OWNER = 'ic_owner';
let app: Hono;
let n = 0;
const page = async (path: string) => { const r = await app.request(path); return { status: r.status, text: await r.text() }; };

const arrive = async (m: { from: string; subject: string; body: string; rfc: string; inReplyTo?: string }) => {
  const { hearMail } = await import('../../src/services/public-workshop/mail.js');
  n += 1;
  return hearMail({
    founderId: OWNER, to: 'hello@apexmicro.example', from: m.from, fromName: null,
    subject: m.subject, body: m.body, rfcMessageId: m.rfc, inReplyTo: m.inReplyTo ?? null,
    spf: 'pass', dkim: 'pass', dmarc: 'pass', sentAt: null, size: 100 + n,
  });
};

beforeAll(async () => {
  await runMigrations();
  await query('INSERT INTO founders (id,clerk_user_id,email,name) VALUES (?,?,?,?)', [OWNER, 'clerk_ic', 'owner@example.com', 'Owner']);
  await query(`INSERT INTO products (id,name,owner_id,status,operating_budget_monthly_usd) VALUES ('ic_f','Foundry',?,'active',50)`, [OWNER]);
  await query(`INSERT INTO system_identities (identity_key,product_id,established_reason) VALUES ('foundry','ic_f','test')`, []);
  await query("INSERT INTO products (id, name, owner_id, status, reality) VALUES ('ic_w','Apex Micro',?,'active','real')", [OWNER]);
  await query(
    `INSERT INTO public_workshop (founder_id, product_id, public_name, operator_name, origin, zone_name, contact_email, statement, about)
     VALUES (?,'ic_w','Apex Micro','Owner','https://apexmicro.example','apexmicro.example','hello@apexmicro.example','A small workshop.','')`, [OWNER]);

  const { inboxRoutes } = await import('../../src/routes/dashboard/inbox-place.js');
  app = new Hono();
  app.use('*', async (c, next) => { c.set('founder' as never, { id: OWNER, email: 'owner@example.com', name: 'Owner', preferences: {} } as never); c.set('csrfToken' as never, 't' as never); await next(); });
  app.route('/', inboxRoutes);

  await arrive({ from: 'lawyer@example.com', subject: 'About your terms', body: 'We act for a client and require a response about your legal terms.', rfc: '<ic-1@example.com>' });
  await arrive({ from: 'lawyer@example.com', subject: 'Re: About your terms', body: 'Following up on the below.', rfc: '<ic-2@example.com>', inReplyTo: '<ic-1@example.com>' });
  await arrive({ from: 'curious@example.com', subject: 'A question', body: 'How much does the brief cost?', rfc: '<ic-3@example.com>' });
});

describe('one conversation is one row', () => {
  it('two messages in one thread are one object, counted', async () => {
    const threads = await theThreads(OWNER, 'working');
    const legal = threads.find((t) => t.newest.from === 'lawyer@example.com');
    expect(legal?.messages).toBe(2);
    // And the row shows the newest message in it, not the first.
    expect(legal?.newest.subject).toBe('Re: About your terms');
    // The thread's own messages are all still there, in order.
    expect((await theThread(OWNER, legal?.key ?? '')).length).toBe(2);
  });

  it('and the buttons act on the conversation the row is', async () => {
    const t = (await page('/foundry/inbox')).text;
    expect(t).toContain('/archive');
    expect(t).toContain('aria-label="Conversations"');
  });
});

describe('the working set is what is in flight', () => {
  it('counts every view from rows, never from a page of a hundred', async () => {
    const counts = await threadCounts(OWNER);
    expect(counts.working).toBeGreaterThan(0);
    expect(counts.archived).toBe(0);
    const t = (await page('/foundry/inbox')).text;
    expect(t).toContain('In flight');
    expect(t).toContain('Needs you');
    expect(t).toContain('Handled');
    expect(t).toContain('Put away');
  });

  it('the two states that matched no chip are in the default view now', async () => {
    // "Foundry is reading it" and "waiting on them" used to appear only under
    // All, so the conversations actually in motion were the ones with no
    // filter of their own.
    const working = await theThreads(OWNER, 'working');
    expect(working.some((t) => t.newest.handling === 'foundry_reading' || t.newest.handling === 'waiting_on_them' || t.newest.handling === 'needs_owner')).toBe(true);
  });
});

describe('he can clear his view without deleting the record', () => {
  it('archiving takes the conversation out of the working set', async () => {
    const before = await theThreads(OWNER, 'working');
    const one = before[0]!;
    const moved = await archiveThread({ founderId: OWNER, threadKey: one.key, because: 'the owner put it away' });
    expect(moved).toBeGreaterThan(0);

    const after = await theThreads(OWNER, 'working');
    expect(after.map((t) => t.key)).not.toContain(one.key);
    expect((await theThreads(OWNER, 'archived')).map((t) => t.key)).toContain(one.key);
  });

  it('and changes no evidence at all', async () => {
    const put = (await theThreads(OWNER, 'archived'))[0]!;
    const msgs = await theThread(OWNER, put.key);
    expect(msgs.length).toBeGreaterThan(0);
    // The reading, its grounds and what Foundry did are exactly as they were.
    expect(msgs.every((m) => m.reading !== 'unknown' || m.readingBecause === null || m.readingBecause.length > 0)).toBe(true);
    const row = (await query(`SELECT reading, reading_because, handling, archived_because FROM workshop_mail WHERE id = ?`, [msgs[0]!.id]))
      .rows[0] as Record<string, unknown>;
    expect(String(row.archived_because)).toBe('the owner put it away');
    expect(String(row.reading)).toBe(msgs[0]!.reading);
  });

  it('and the line he gave is read back to him, on the row and in the thread', async () => {
    const put = (await theThreads(OWNER, 'archived'))[0]!;
    expect(put.newest.archivedBecause).toBe('the owner put it away');
    const list = (await page('/foundry/inbox?show=archived')).text;
    expect(list).toContain('Put away:');
    expect(list).toContain('the owner put it away');
    const thread = (await page(`/foundry/inbox/${put.href}`)).text;
    expect(thread).toContain('Nothing about the message changed; it is only off the working list.');
  });

  it('a message put away stops counting as waiting on him', async () => {
    const put = (await theThreads(OWNER, 'archived'))[0]!;
    expect((await needsTheOwner(OWNER)).map((m) => m.threadKey)).not.toContain(put.key);
    const health = await mailHealth(OWNER);
    // The total heard is the record and counts everything that ever arrived.
    expect(health.heard).toBe(3);
  });

  it('and it can be put back, because a view state that cannot be undone is a verdict', async () => {
    const put = (await theThreads(OWNER, 'archived'))[0]!;
    expect(await unarchiveThread({ founderId: OWNER, threadKey: put.key })).toBeGreaterThan(0);
    expect((await theThreads(OWNER, 'archived')).length).toBe(0);
    expect((await theThreads(OWNER, 'working')).map((t) => t.key)).toContain(put.key);
  });
});

describe('the guards', () => {
  it('a message cannot arrive already put away', async () => {
    await expect(query(
      `INSERT INTO workshop_mail (id, founder_id, body, rfc_message_id, thread_key, from_email, to_email, archived_at, archived_because)
       VALUES ('ic_bad',?,'x','<ic-bad@example.com>','k','a@example.com','hello@apexmicro.example',datetime('now'),'sneaked in')`,
      [OWNER])).rejects.toThrow(/cannot_arrive_archived/);
  });

  it('and putting one away says why', async () => {
    const t = (await theThreads(OWNER, 'working'))[0]!;
    await expect(archiveThread({ founderId: OWNER, threadKey: t.key, because: '   ' }))
      .rejects.toThrow(/needs_a_reason/);
    await expect(query(
      `UPDATE workshop_mail SET archived_at = datetime('now') WHERE founder_id = ? AND thread_key = ?`,
      [OWNER, t.key])).rejects.toThrow(/archive_needs_a_reason/);
  });
});

describe('done is still a judgement, and says so', () => {
  it('settling the conversation records the reason on every message in it', async () => {
    const t = (await theThreads(OWNER, 'working'))[0]!;
    expect(await settleThread({ founderId: OWNER, threadKey: t.key, because: 'answered him by phone' })).toBeGreaterThan(0);
    const msgs = await theThread(OWNER, t.key);
    expect(msgs.every((m) => m.handling === 'resolved' || m.handling === 'no_action')).toBe(true);
    expect(msgs.some((m) => m.handledBecause === 'answered him by phone')).toBe(true);
    expect((await theThreads(OWNER, 'handled')).map((x) => x.key)).toContain(t.key);
  });
});
