import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { nanoid } from 'nanoid';
import { query } from '../../src/db/client.js';
import { runMigrations } from '../../src/db/migrate.js';
import { emitSignalEvent } from '../../src/services/scp/events/dispatcher.js';
import { discoverResponsibilityFromSignal } from '../../src/services/institution/discovery.js';

beforeAll(async () => {
  // THE REAL SCHEMA, not four migrations chosen by hand. This applied 102–105
  // and fabricated `products`, `signal_events`, `autonomy_consents` and
  // `action_executions` around them, so it was testing discovery against a
  // schema that stopped resembling the live one the moment anything else
  // changed — which is exactly what happened when migration 166 added a due
  // date and this file could not see it.
  await runMigrations();
});

beforeEach(async () => {
  for (const table of ['responsibility_dispositions','responsibility_transitions','institutional_responsibilities','signal_events']) await query(`DELETE FROM ${table}`);
  await query(`DELETE FROM products WHERE id LIKE 'p%'`);
  await query(`DELETE FROM founders WHERE id = 'rd_owner'`);
  await query(`INSERT INTO founders (id, clerk_user_id, email) VALUES ('rd_owner','clerk_rd','rd@test.local')`);
  for (const id of ['p1','p2']) {
    await query(`INSERT INTO products (id, name, owner_id, status) VALUES (?, 'Co', 'rd_owner', 'active')`, [id]);
  }
});

describe('company evidence responsibility discovery', () => {
  it('turns a reported obligation into one Visible evidence-linked responsibility', async () => {
    // This used to emit `stripe`/`payment_failed`, one of four SaaS event types
    // discovery mapped onto responsibilities and nothing in production ever
    // emitted. That map is deleted; the company stating its own obligation is
    // the whole of the intake now.
    const signalId = await emitSignalEvent('p1', { source:'founder_report',
      event_type:'founder_reported:revenue_collection', severity:'medium',
      payload:{ obligation_kind:'revenue_collection', what:'Collect the invoice that went unpaid', founder_id:'rd_owner' },
      summary:'Invoice in_1 failed' });
    const rows = await query('SELECT * FROM institutional_responsibilities WHERE product_id=?',['p1']);
    expect(rows.rows).toHaveLength(1);
    expect(rows.rows[0]).toMatchObject({ state:'visible', capability:'billing_recovery',
      title:'Collect the invoice that went unpaid', discovery_evidence_ref:`signal_event:${signalId}` });
    const history = await query('SELECT evidence_ref,actor_ref FROM responsibility_transitions');
    expect(history.rows[0]).toMatchObject({ evidence_ref:`signal_event:${signalId}`, actor_ref:`intake:signal_event:${signalId}` });
  });

  it('records the evidence and abstains when a SaaS-shaped event arrives', async () => {
    // The deleted map's four event types are now ordinary unadmitted evidence.
    // If one ever produces a responsibility again, something re-introduced a
    // door production does not have.
    for (const eventType of ['payment_failed','churn_detected','support_spike','activation_failure']) {
      await emitSignalEvent('p1', { source:'stripe', event_type:eventType, severity:'medium',
        payload:{}, summary:`A ${eventType} arrived` });
    }
    expect((await query('SELECT id FROM signal_events WHERE product_id=?',['p1'])).rows).toHaveLength(4);
    expect((await query('SELECT id FROM institutional_responsibilities WHERE product_id=?',['p1'])).rows).toHaveLength(0);
  });

  it('preserves unsupported evidence without manufacturing a responsibility', async () => {
    await emitSignalEvent('p1', { source:'market', event_type:'competitor_signal', severity:'medium', payload:{}, summary:'Competitor changed pricing' });
    expect((await query('SELECT id FROM signal_events WHERE product_id=?',['p1'])).rows).toHaveLength(1);
    expect((await query('SELECT id FROM institutional_responsibilities WHERE product_id=?',['p1'])).rows).toHaveLength(0);
  });

  it('is idempotent under repeated and concurrent discovery', async () => {
    const signalId = await emitSignalEvent('p1', { source:'founder_report',
      event_type:'founder_reported:customer_commitment', severity:'medium',
      payload:{ obligation_kind:'customer_commitment', what:'Answer the people who are waiting', founder_id:'rd_owner' },
      summary:'Support volume spiked' });
    await Promise.all([discoverResponsibilityFromSignal('p1',signalId), discoverResponsibilityFromSignal('p1',signalId)]);
    expect((await query('SELECT id FROM institutional_responsibilities WHERE discovery_evidence_ref=?',[`signal_event:${signalId}`])).rows).toHaveLength(1);
  });

  it('refuses an obligation payload arriving under a source that is not a report', async () => {
    // PROVENANCE IS THE WHOLE OF THE CHECK, and it was untested until a mutation
    // deleted it and the suite stayed green.
    //
    // Migration 126's guard — which verifies the stated founder against
    // `products.owner_id` and refuses a report that smuggles authority — fires
    // only on `source='founder_report'`. Sixteen places insert into
    // `signal_events` directly, under sources of their own. If discovery read
    // the payload without checking where it came from, any of them could write a
    // well-formed obligation and get a responsibility with nothing having
    // verified who was speaking for the company.
    //
    // The payload below is exactly what the report path sends. The only thing
    // wrong with it is where it arrived from, and that has to be enough.
    const signalId = nanoid();
    await query(
      `INSERT INTO signal_events (id,product_id,source,event_type,severity,payload_json,summary)
       VALUES (?,'p1','stripe','payment_failed','medium',?,'Looks like a report')`,
      [signalId, JSON.stringify({ obligation_kind:'revenue_collection',
        what:'Collect what is owed', founder_id:'rd_owner' })]);
    await expect(discoverResponsibilityFromSignal('p1', signalId)).resolves.toBeNull();
    expect((await query('SELECT id FROM institutional_responsibilities WHERE product_id=?',['p1'])).rows)
      .toHaveLength(0);
  });

  it('cannot discover from another product signal even when its id is known', async () => {
    const signalId = await emitSignalEvent('p2', { source:'founder_report',
      event_type:'founder_reported:revenue_collection', severity:'medium',
      payload:{ obligation_kind:'revenue_collection', what:'Collect what the other company is owed', founder_id:'rd_owner' },
      summary:'Other tenant failure' });
    await expect(discoverResponsibilityFromSignal('p1',signalId)).resolves.toBeNull();
    expect((await query('SELECT id FROM institutional_responsibilities WHERE product_id=?',['p1'])).rows).toHaveLength(0);
  });
});
