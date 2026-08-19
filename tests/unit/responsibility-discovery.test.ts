import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
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
  it('turns a real payment-failure intake into one Visible evidence-linked responsibility', async () => {
    const signalId = await emitSignalEvent('p1', { source:'stripe', event_type:'payment_failed', severity:'medium', payload:{ invoice:'in_1' }, summary:'Invoice in_1 failed' });
    const rows = await query('SELECT * FROM institutional_responsibilities WHERE product_id=?',['p1']);
    expect(rows.rows).toHaveLength(1);
    expect(rows.rows[0]).toMatchObject({ state:'visible', capability:'billing_recovery', discovery_evidence_ref:`signal_event:${signalId}` });
    const history = await query('SELECT evidence_ref,actor_ref FROM responsibility_transitions');
    expect(history.rows[0]).toMatchObject({ evidence_ref:`signal_event:${signalId}`, actor_ref:`intake:signal_event:${signalId}` });
  });

  it('preserves unsupported evidence without manufacturing a responsibility', async () => {
    await emitSignalEvent('p1', { source:'market', event_type:'competitor_signal', severity:'medium', payload:{}, summary:'Competitor changed pricing' });
    expect((await query('SELECT id FROM signal_events WHERE product_id=?',['p1'])).rows).toHaveLength(1);
    expect((await query('SELECT id FROM institutional_responsibilities WHERE product_id=?',['p1'])).rows).toHaveLength(0);
  });

  it('is idempotent under repeated and concurrent discovery', async () => {
    const signalId = await emitSignalEvent('p1', { source:'support', event_type:'support_spike', severity:'medium', payload:{}, summary:'Support volume spiked' });
    await Promise.all([discoverResponsibilityFromSignal('p1',signalId), discoverResponsibilityFromSignal('p1',signalId)]);
    expect((await query('SELECT id FROM institutional_responsibilities WHERE discovery_evidence_ref=?',[`signal_event:${signalId}`])).rows).toHaveLength(1);
  });

  it('cannot discover from another product signal even when its id is known', async () => {
    const signalId = await emitSignalEvent('p2', { source:'stripe', event_type:'payment_failed', severity:'medium', payload:{}, summary:'Other tenant failure' });
    await expect(discoverResponsibilityFromSignal('p1',signalId)).resolves.toBeNull();
    expect((await query('SELECT id FROM institutional_responsibilities WHERE product_id=?',['p1'])).rows).toHaveLength(0);
  });
});
