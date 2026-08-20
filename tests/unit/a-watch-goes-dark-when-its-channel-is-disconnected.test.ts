process.env.TURSO_DATABASE_URL = 'file::memory:';
process.env.ENCRYPTION_KEY = '0'.repeat(64);

import { beforeAll, describe, expect, it } from 'vitest';
import { Hono } from 'hono';
import { runMigrations } from '../../src/db/migrate.js';
import { query } from '../../src/db/client.js';
import {
  recordCompanyObservations, registerObservationChannel, revokeObservationChannel,
} from '../../src/services/institution/company-observation.js';
import { beginExternalMetricShadowing } from '../../src/services/institution/external-shadowing.js';
import { moveResponsibilityTo } from '../fixtures/responsibility-state.js';

// =============================================================================
// A FOUNDER WHO DISCONNECTS A CHANNEL HAS STOPPED A WATCH, AND SHOULD BE TOLD.
//
// Foundry watches a responsibility by comparing what the founder said they
// would expect against readings arriving on one company-declared channel.
// Revoking that channel is honoured where it matters — intake refuses every
// further reading for it, which is correct.
//
// What follows from that was silent. The expectation stays open and can never
// resolve, so the responsibility sits at Shadowing for good: it cannot be
// understood further, cannot reach Assisting, and nothing on any surface
// connects that to the button the founder pressed. The same silent foreclosure
// as a question set aside, reached from the other direction.
//
// Foundry does not undo the founder's decision, and does not re-ask. It says
// what stopped.
// =============================================================================

const P = 'dark_product';
const OWNER = 'dark_owner';
const RESP = 'dark_resp';
const CHANNEL = 'classes_taught';

let app: Hono;

beforeAll(async () => {
  await runMigrations();
  await query(`INSERT INTO founders (id,clerk_user_id,email) VALUES (?,'dark_c','o@example.com')`, [OWNER]);
  await query(`INSERT INTO products (id,name,owner_id) VALUES (?,'Fold Street Dance',?)`, [P, OWNER]);
  await query(
    `INSERT INTO signal_events (id,product_id,source,event_type,severity,payload_json,summary)
     VALUES ('dark_sig',?,'repository','development_need_observed','low','{}','seed')`, [P]);
  await query(
    `INSERT INTO institutional_responsibilities (id,product_id,title,capability,state,discovery_evidence_ref)
     VALUES (?,?,'Every timetabled class has a teacher','operations','visible','signal_event:dark_sig')`,
    [RESP, P]);
  await moveResponsibilityTo(RESP, 'understood', { productId: P });

  await registerObservationChannel({
    productId: P, founderId: OWNER, channelKey: CHANNEL,
    label: 'Classes taught', unit: 'classes',
  });
  // Two readings, so the channel has produced real outside evidence.
  await recordCompanyObservations({ productId: P, origin: 'rota_job', readings: [{ channelKey: CHANNEL, observedValue: 40 }] });
  await recordCompanyObservations({ productId: P, origin: 'rota_job', readings: [{ channelKey: CHANNEL, observedValue: 44 }] });

  const { letterRoutes } = await import('../../src/routes/dashboard/letter.js');
  app = new Hono();
  app.use('*', async (c, next) => {
    c.set('founder' as never, { id: OWNER, email: 'o@example.com', preferences: {} } as never);
    c.set('csrfToken' as never, 't' as never);
    await next();
  });
  app.route('/', letterRoutes);
});

describe('a watch whose channel the founder disconnected', () => {
  it('is named on the letter, and says the responsibility has stopped moving', async () => {
    const watching = await beginExternalMetricShadowing({
      productId: P, responsibilityId: RESP, founderId: OWNER,
      field: CHANNEL, direction: 'rose',
    });
    expect(watching?.state).toBe('shadowing');

    // Nothing to say while the channel is live.
    expect(await (await app.request('/letter')).text()).not.toContain('I have stopped watching');

    expect(await revokeObservationChannel({ productId: P, founderId: OWNER, channelKey: CHANNEL })).toBe(true);

    const page = await (await app.request('/letter')).text();
    expect(page).toContain('I have stopped watching');
    expect(page).toContain('Classes taught');
    expect(page).toContain('Every timetabled class has a teacher');
  });
});
