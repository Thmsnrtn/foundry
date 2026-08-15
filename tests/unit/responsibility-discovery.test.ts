import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { query } from '../../src/db/client.js';
import { splitSqlStatements } from '../../src/db/migrate.js';
import { emitSignalEvent } from '../../src/services/scp/events/dispatcher.js';
import { discoverResponsibilityFromSignal } from '../../src/services/institution/discovery.js';

beforeAll(async () => {
  await query('CREATE TABLE IF NOT EXISTS products (id TEXT PRIMARY KEY, name TEXT, owner_id TEXT NOT NULL)');
  await query(`CREATE TABLE IF NOT EXISTS signal_events (id TEXT PRIMARY KEY,product_id TEXT NOT NULL,source TEXT,event_type TEXT,severity TEXT,payload_json TEXT,summary TEXT,relevant_agents_json TEXT,processed INTEGER DEFAULT 0,created_at TEXT DEFAULT CURRENT_TIMESTAMP,processed_at TEXT,processing_session_id TEXT)`);
  await query('CREATE TABLE IF NOT EXISTS autonomy_consents (id TEXT PRIMARY KEY,product_id TEXT,capability TEXT,to_mode TEXT,revoked_at TEXT)');
  await query('CREATE TABLE IF NOT EXISTS action_executions (id TEXT PRIMARY KEY,product_id TEXT,status TEXT,verify_status TEXT)');
  for (const file of ['102_responsibility_transfer.sql','103_responsibility_disposition.sql','104_responsibility_reference_provenance.sql','105_responsibility_discovery.sql'])
    for (const sql of splitSqlStatements(readFileSync(resolve(__dirname, `../../src/db/migrations/${file}`),'utf8'))) await query(sql);
});
beforeEach(async () => {
  for (const table of ['responsibility_dispositions','responsibility_transitions','institutional_responsibilities','signal_events']) await query(`DELETE FROM ${table}`);
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
