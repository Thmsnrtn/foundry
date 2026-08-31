import { beforeEach, describe, expect, it, vi } from 'vitest';

// The bot token comes from the ENCRYPTED credential store, not from the
// plaintext config blob. This fixture used to put it in `config_json`, which
// modelled the defect rather than the design: every adapter read its secret
// from there, so the founder-facing form that encrypted credentials correctly
// produced integrations that could never find them. `channel_id` stays in
// config because it is an identifier, not a secret.
vi.mock('../../src/services/integration/fabric.js', () => ({
  getIntegration: vi.fn(async () => ({
    status: 'active',
    config_json: { channel_id: 'C1' },
  })),
  getIntegrationCredentials: vi.fn(async () => ({ bot_token: 'xoxb-secret' })),
  storeEvent: vi.fn(),
}));

import { sendSlackNotification } from '../../src/services/integration/slack.js';

const send = () => sendSlackNotification('p1', { text: 'approved message' });

describe('Slack effect certainty', () => {
  beforeEach(() => vi.restoreAllMocks());

  it('records provider acknowledgment without claiming business outcome', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ ok: true, ts: '123.456' }), { status: 200 }),
    );
    await expect(send()).resolves.toEqual({ certainty: 'provider_acknowledged', providerMessageTs: '123.456' });
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it('preserves a Slack rejection even when HTTP succeeded', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ ok: false, error: 'channel_not_found' }), { status: 200 }),
    );
    await expect(send()).resolves.toEqual({ certainty: 'provider_rejected', reason: 'channel_not_found' });
  });

  it('preserves HTTP rejection as definitely rejected', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('no', { status: 403 }));
    await expect(send()).resolves.toEqual({ certainty: 'provider_rejected', reason: 'Slack HTTP 403' });
  });

  it('makes one attempt and preserves transport timeout as ambiguous', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('timeout after request write'));
    await expect(send()).resolves.toEqual({ certainty: 'ambiguous', reason: 'timeout after request write' });
    expect(fetchMock).toHaveBeenCalledOnce();
  });
});
