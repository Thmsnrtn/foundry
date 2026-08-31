process.env.TURSO_DATABASE_URL = 'file::memory:';
process.env.ENCRYPTION_KEY = '0'.repeat(64);

import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { runMigrations } from '../../src/db/migrate.js';
import { query } from '../../src/db/client.js';
import {
  CHANNEL_REFUSAL_LABELS, ingestCustomerMessage, registerSupportChannel,
} from '../../src/services/institution/customer-message-intake.js';

// =============================================================================
// A MESSAGE THAT HAD NOT BEEN SENT YET, AT THE TOP OF THE QUEUE.
//
// `source_observed_at` is the source's own clock, kept separately from
// `received_at` because a delayed delivery is late, not recent. It is ALSO the
// order of the founder's queue: `getMessagesForResponsibility` reads
// `ORDER BY datetime(m.source_observed_at) DESC ... LIMIT ?`, so a number
// supplied by a machine Foundry does not run decides which messages a founder
// sees and which fall off the end.
//
// The intake refused a value that was not a time at all. It accepted any time,
// including times that have not happened — so one message stamped 2099 sits at
// the top of that queue forever and pushes a real customer out of the LIMIT,
// with nothing on the founder's screen to say why.
//
// Migration 201 is the same defect against `outbound_actions.approved_at`. The
// difference is whose clock it is: 201 allows five minutes for Foundry's own
// processes, this allows fifteen for somebody else's server — a skew allowance,
// not a grace period, and deliberately short of a timezone mistake.
// =============================================================================

const P = 'p_future_msg';
const OWNER = 'f_future';
const RESP = 'resp_future';
let intakeKey: string;

beforeAll(async () => {
  await runMigrations();
  await query("INSERT INTO founders (id, clerk_user_id, email) VALUES (?,'c_fut','fut@example.com')", [OWNER]);
  await query("INSERT INTO products (id, name, owner_id, status) VALUES (?,'Acme',?,'active')", [P, OWNER]);
  await query(
    `INSERT INTO signal_events (id,product_id,source,event_type,severity,payload_json,summary)
     VALUES ('fut_sig',?,'company_observation_baseline','company_observation_baseline:observed','low','{}','seed')`,
    [P]);
  await query(
    `INSERT INTO institutional_responsibilities (id,product_id,title,capability,state,discovery_evidence_ref)
     VALUES (?,?,'Answer people waiting on a quote','customer_support','shadowing','signal_event:fut_sig')`,
    [RESP, P]);
  const channel = await registerSupportChannel({
    productId: P, responsibilityId: RESP, founderId: OWNER, label: 'quotes@ inbox' });
  intakeKey = channel!.intakeKey;
});

beforeEach(async () => {
  await query('DELETE FROM inbound_customer_messages WHERE product_id = ?', [P]);
});

const send = (id: string, at?: string) => ingestCustomerMessage({
  intakeKey, externalMessageId: id, contactEmail: 'buyer@example.com',
  body: 'Where is my quote?', sourceObservedAt: at,
});

describe('a message cannot have been observed later than now', () => {
  it('refuses a source timestamp years ahead, with a reason of its own', async () => {
    const result = await send('m_2099', '2099-01-01T00:00:00Z');
    expect(result).toEqual({ refused: 'timestamp_in_future' });
    expect(CHANNEL_REFUSAL_LABELS.timestamp_in_future).toBeTruthy();
  });

  it('a refused message is not stored, so the queue order is untouched', async () => {
    await send('m_2099', '2099-01-01T00:00:00Z');
    const rows = await query(
      'SELECT COUNT(*) AS n FROM inbound_customer_messages WHERE product_id = ?', [P]);
    expect(Number((rows.rows[0] as unknown as { n: number }).n)).toBe(0);
  });

  it('ordinary clock drift on somebody else\'s server is still accepted', async () => {
    const fiveMinutesAhead = new Date(Date.now() + 5 * 60_000).toISOString();
    const result = await send('m_drift', fiveMinutesAhead);
    expect('refused' in result).toBe(false);
  });

  it('a timezone mistake is not absorbed — it is refused so somebody fixes it', async () => {
    const fiveHoursAhead = new Date(Date.now() + 5 * 3_600_000).toISOString();
    expect(await send('m_tz', fiveHoursAhead)).toEqual({ refused: 'timestamp_in_future' });
  });

  it('a past timestamp is what this is for, and is untouched', async () => {
    const yesterday = new Date(Date.now() - 86_400_000).toISOString();
    const result = await send('m_late', yesterday);
    expect('refused' in result).toBe(false);
    if (!('refused' in result)) {
      expect(new Date(result.message.sourceObservedAt).getTime())
        .toBeLessThan(Date.now());
    }
  });

  it('a value that is not a time at all is still its own refusal', async () => {
    expect(await send('m_junk', 'tomorrow-ish')).toEqual({ refused: 'timestamp_invalid' });
  });
});

describe('the database states the same rule, whatever the writer', () => {
  it('refuses a direct insert dated in the future', async () => {
    await expect(query(
      `INSERT INTO inbound_customer_messages
         (id, product_id, channel_id, responsibility_id, external_message_id,
          contact_email, body, source_observed_at)
       VALUES ('m_direct', ?, 'chan_x', ?, 'ext_direct', 'b@example.com', 'hi', '2099-01-01 00:00:00')`,
      [P, RESP],
    )).rejects.toThrow(/observed_in_the_future/);
  });

  it('refuses an update that moves one into the future', async () => {
    await send('m_movable');
    await expect(query(
      `UPDATE inbound_customer_messages SET source_observed_at = '2099-01-01 00:00:00'
        WHERE product_id = ?`, [P],
    )).rejects.toThrow(/observed_in_the_future/);
  });
});
