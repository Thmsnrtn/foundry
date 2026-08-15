import { describe, expect, it } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';

describe('outbound webhook ownership', () => {
  it('does not restore the unused notification-layer webhook transport', () => {
    const source = readFileSync(resolve(__dirname, '../../src/services/notifications/push.ts'), 'utf8');
    expect(source).not.toMatch(/deliverWebhookEvent|deliverToWebhook|FROM outbound_webhooks/);
  });

  it('does not restore the unused notification-layer Slack transport', () => {
    const source = readFileSync(resolve(__dirname, '../../src/services/notifications/push.ts'), 'utf8');
    expect(source).not.toMatch(/sendSlackNotification|chat\.postMessage|FROM slack_integrations/);
  });
});
