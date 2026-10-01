process.env.TURSO_DATABASE_URL = 'file::memory:';
process.env.ENCRYPTION_KEY = '0'.repeat(64);

import { Hono } from 'hono';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { runMigrations } from '../../src/db/migrate.js';
import { query } from '../../src/db/client.js';
import { issueApiKey } from '../../src/services/api/api-key-issuance.js';
import { WEBHOOK_EVENTS } from '../../src/lib/webhooks.js';

// =============================================================================
// A SUBSCRIPTION NOTHING WOULD EVER MATCH, ANSWERED 201.
//
// `POST /v1/webhooks` accepted any strings at all in `events`, and the type it
// advertised listed TEN event names of which THREE are ever dispatched. An
// integrator subscribing to `audit.completed`, `stressor.identified`,
// `digest.generated` or `remediation.pr_merged` got a 201 and silence for as
// long as they waited — the dispatcher only matches names it is called with.
//
// And `POST /v1/agents/:name/run` queued an initiative for any name at all.
// `_processInitiatives` selects by `agent_name` when that agent runs, so a row
// naming something that is not one of this product's agents sits pending
// forever; the route answered 201 "Agent run queued" for it. The briefings
// route beside it already refused an unknown name.
// =============================================================================

const P = 'p_hook';
const OWNER = 'f_hook';
let app: Hono;
let key: string;

beforeAll(async () => {
  await runMigrations();
  await query('INSERT INTO founders (id,clerk_user_id,email) VALUES (?,?,?)',
    [OWNER, 'c_hook', 'hook@example.com']);
  await query('INSERT INTO products (id,name,owner_id,status) VALUES (?,?,?,?)',
    [P, 'Acme', OWNER, 'active']);

  key = (await issueApiKey({
    productId: P, founderId: OWNER, label: 'k',
    scopes: ['agents:read', 'agents:write'],
  }) as { key: string }).key;

  const { apiV1 } = await import('../../src/api/v1/index.js');
  app = new Hono();
  app.route('/api/v1', apiV1 as unknown as Hono);
});

beforeEach(async () => {
  await query('DELETE FROM webhooks');
});

const post = (path: string, body: unknown) =>
  app.request(`/api/v1${path}`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });

describe('subscribing to a webhook event', () => {
  it('accepts an event Foundry actually sends', async () => {
    const res = await post('/webhooks', {
      url: 'https://example.com/hook', events: ['decision.resolved'],
    });
    expect(res.status, await res.text()).toBe(201);
  });

  it('accepts the wildcard, which is true by construction', async () => {
    const res = await post('/webhooks', { url: 'https://example.com/hook', events: ['*'] });
    expect(res.status).toBe(201);
  });

  it('refuses an event nothing dispatches, and says what there is', async () => {
    const res = await post('/webhooks', {
      url: 'https://example.com/hook', events: ['audit.completed'],
    });
    expect(res.status).toBe(400);
    const body = await res.json() as { error: string; supported_events: string[] };
    expect(body.error).toContain('audit.completed');
    expect(body.supported_events).toContain('decision.resolved');
    expect(body.supported_events).toContain('*');
    // And nothing was stored for it.
    const rows = (await query('SELECT COUNT(*) AS c FROM webhooks')).rows[0] as unknown as Record<string, unknown>;
    expect(Number(rows.c)).toBe(0);
  });

  it('refuses a mixed list rather than silently keeping the good half', async () => {
    const res = await post('/webhooks', {
      url: 'https://example.com/hook', events: ['decision.resolved', 'digest.generated'],
    });
    expect(res.status).toBe(400);
  });
});

describe('the event vocabulary', () => {
  it('is exactly what the dispatcher is called with', () => {
    // Three names, and the seven the type used to advertise are gone. When one
    // comes back it comes back with the `dispatchWebhook` call that sends it.
    expect([...WEBHOOK_EVENTS].sort()).toEqual(
      ['decision.resolved', 'metric.recorded', 'risk_state.changed']);
  });
});

// The 'queuing an agent run' cases went with `api/v1/agents.ts` and
// `agent_initiative_queue` in Roadmap 2027 R9.
