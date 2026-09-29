import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { principalRef } from '../../src/services/outbound/acting-principal.js';
import { executeRaw, query } from '../../src/db/client.js';
import { runMigrations } from '../../src/db/migrate.js';

const { integration, urlGuard } = vi.hoisted(() => ({ integration: vi.fn(), urlGuard: vi.fn() }));
vi.mock('../../src/services/integration/fabric.js', () => ({ getIntegration: integration }));
// The URL check is stubbed; the transport is the real safeFetch (every redirect
// hop re-screened) and the real capped reader, over the stubbed global fetch.
vi.mock('../../src/services/outbound/ssrf.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../src/services/outbound/ssrf.js')>()),
  assertUrlSafe: urlGuard,
}));

import { approveAndExecute, createExecution, type ActionPayload } from '../../src/services/scp/actions/executor.js';

beforeAll(async () => {
  // The migrations are the schema. Tables this file used to write by hand are
  // already here, in the shape the product actually has — including the NOT
  // NULL columns and foreign keys a hand-written stand-in leaves out.
  await runMigrations();
  // A real company. The kill switch refuses an id that names no product, and
  // this path now passes through it — which is the point: an outward effect
  // for a company that does not exist is not a thing Foundry should do.
  await query(
    `INSERT OR IGNORE INTO founders (id, clerk_user_id, email)
     VALUES ('f1','clerk_f1','f1@test.local')`);
  await query(
    `INSERT OR IGNORE INTO products (id, name, owner_id, status, scp_status)
     VALUES ('p1','Effect Co','f1','active','active')`);
});

beforeEach(async () => {
  await query('DELETE FROM action_executions');
  vi.restoreAllMocks();
  integration.mockReset();
  urlGuard.mockReset().mockResolvedValue(new URL('https://hooks.example.test/x'));
});

async function run(payload: ActionPayload) {
  const id = await createExecution('p1', null, payload);
  const result = await approveAndExecute(id, principalRef('founder', 'founder-1'));
  const row = (await query('SELECT * FROM action_executions WHERE id=?', [id])).rows[0] as Record<string, unknown>;
  return { id, result, row };
}

const linearPayload: ActionPayload = {
  action_type: 'create_ticket', integration: 'linear', ticket_title: 'Fix integrity', team_id: 'team-1',
};
const webhookPayload: ActionPayload = {
  action_type: 'custom_webhook', integration: 'custom', webhook_url: 'https://hooks.example.test/x', webhook_payload: { event: 'approved' },
};

describe('approved action runtime effect certainty', () => {
  it('persists Linear provider acknowledgment without claiming outcome', async () => {
    integration.mockResolvedValue({ status: 'active', config_json: { api_key: 'lin-secret' } });
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({ data: { issueCreate: { success: true, issue: { id: 'i1', identifier: 'F-1' } } } }), { status: 200 }));
    const { result, row } = await run(linearPayload);
    expect(result.effect_certainty).toBe('provider_acknowledged');
    expect(row.effect_certainty).toBe('provider_acknowledged');
    expect(row.provider_acknowledged_at).toBeTruthy();
  });

  it('persists adversarial HTTP-200 Linear rejection', async () => {
    integration.mockResolvedValue({ status: 'active', config_json: { api_key: 'lin-secret' } });
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({ errors: [{ message: 'forbidden' }] }), { status: 200 }));
    const { row } = await run(linearPayload);
    expect(row.effect_certainty).toBe('provider_rejected');
  });

  it('preserves Linear transport ambiguity and never retries the claimed execution', async () => {
    integration.mockResolvedValue({ status: 'active', config_json: { api_key: 'lin-secret' } });
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('timeout after write'));
    const { id, row } = await run(linearPayload);
    expect(row.effect_certainty).toBe('ambiguous');
    expect(row.reconcile_after).toBeTruthy();
    await expect(approveAndExecute(id, principalRef('founder', 'founder-1'))).resolves.toMatchObject({ success: false });
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it('persists custom-webhook acknowledgment and rejection distinctly', async () => {
    vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(new Response('{"accepted":true}', { status: 202 }))
      .mockResolvedValueOnce(new Response('denied', { status: 403 }));
    expect((await run(webhookPayload)).row.effect_certainty).toBe('provider_acknowledged');
    expect((await run(webhookPayload)).row.effect_certainty).toBe('provider_rejected');
  });

  it('blocks unsafe custom-webhook targets before attempting transport', async () => {
    urlGuard.mockRejectedValue(new Error('private address blocked'));
    const fetchMock = vi.spyOn(globalThis, 'fetch');
    const { row } = await run(webhookPayload);
    expect(row.effect_certainty).toBe('not_attempted');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('preserves custom-webhook transport ambiguity with reconciliation due', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('socket closed'));
    const { row } = await run(webhookPayload);
    expect(row.effect_certainty).toBe('ambiguous');
    expect(row.reconcile_after).toBeTruthy();
    expect(fetchMock).toHaveBeenCalledOnce();
  });
});

describe('a webhook is not followed where it points', () => {
  // FOUND BY THE EXECUTIVE REVIEW OF 29 SEPTEMBER 2026. The URL was screened,
  // then handed to a raw fetch that followed redirects: a public host could
  // answer 302 to the cloud metadata address and the POST went there.
  it('refuses a redirect to the metadata address, and says the first hop may have landed', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(null, { status: 307, headers: { location: 'https://169.254.169.254/latest/meta-data/' } }));
    const { row } = await run(webhookPayload);
    expect(fetchMock).toHaveBeenCalledOnce();
    expect(String((fetchMock.mock.calls[0] as unknown[])[0])).toBe('https://hooks.example.test/x');
    expect((fetchMock.mock.calls[0] as [string, RequestInit])[1].redirect).toBe('manual');
    // The first host received the POST before redirecting, so the effect is honestly unknown.
    expect(row.effect_certainty).toBe('ambiguous');
  });

  it('reads no more than a megabyte of whatever the far end sends back', async () => {
    const huge = 'x'.repeat(1_500_000);
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(huge, { status: 200 }));
    const { result } = await run(webhookPayload);
    expect(result.effect_certainty).toBe('provider_acknowledged');
    expect(String(result.integration_response).length).toBe(1_000_000);
  });
});

describe('the guard on the Linear executor', () => {
  // These fixtures used to mock `status: 'connected'`, which is the value
  // migration 074 retired: nothing writes it, nothing selects it, and every
  // other adapter guards on 'active'. The tests passed because the guard was
  // wrong in the same direction — a test written against the defect.
  //
  // In production the consequence was inverted: a correctly connected Linear
  // integration is 'active', so every ticket Foundry tried to file came back
  // "Linear integration not connected", and the only state that satisfied the
  // guard was the broken one that cannot sync.

  it('acts on an integration that is active', async () => {
    integration.mockResolvedValue({ status: 'active', config_json: { api_key: 'lin-secret' } });
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(
      JSON.stringify({ data: { issueCreate: { success: true, issue: { id: 'i9', identifier: 'F-9' } } } }),
      { status: 200 }));

    const { result } = await run(linearPayload);

    expect(result.success).toBe(true);
  });

  it('refuses one still carrying the retired status', async () => {
    integration.mockResolvedValue({ status: 'connected', config_json: { api_key: 'lin-secret' } });
    const fetchMock = vi.spyOn(globalThis, 'fetch');

    const { result } = await run(linearPayload);

    expect(result.success).toBe(false);
    expect(result.error).toContain('not connected');
    // And nothing was dispatched on the strength of a status nothing writes.
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
