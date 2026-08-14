import { afterEach, describe, expect, it } from 'vitest';
import { Hono } from 'hono';
import { sessionAuthForApiRoutes } from '../../src/middleware/auth.js';

const originalClerkSecret = process.env.CLERK_SECRET_KEY;

afterEach(() => {
  if (originalClerkSecret === undefined) delete process.env.CLERK_SECRET_KEY;
  else process.env.CLERK_SECRET_KEY = originalClerkSecret;
});

describe('API authentication boundary', () => {
  it('leaves the exact machine API namespace for API-key authentication', async () => {
    delete process.env.CLERK_SECRET_KEY;
    const app = new Hono();
    app.use('/api/*', sessionAuthForApiRoutes);
    app.get('/api/v1/health', (c) => c.json({ status: 'ok' }));
    app.get('/api/v1/metrics', (c) =>
      c.json({ authorization: c.req.header('Authorization') })
    );

    const health = await app.request('/api/v1/health');
    expect(health.status).toBe(200);

    const machine = await app.request('/api/v1/metrics', {
      headers: { Authorization: 'Bearer fnd_machine_key' },
    });
    expect(machine.status).toBe(200);
    expect(await machine.json()).toEqual({
      authorization: 'Bearer fnd_machine_key',
    });
  });

  it('keeps Clerk mandatory for other API namespaces and near-prefixes', async () => {
    delete process.env.CLERK_SECRET_KEY;
    const app = new Hono();
    app.use('/api/*', sessionAuthForApiRoutes);
    app.get('/api/metrics', (c) => c.json({ leaked: true }));
    app.get('/api/v10/metrics', (c) => c.json({ leaked: true }));

    const regularApi = await app.request('/api/metrics');
    const nearPrefix = await app.request('/api/v10/metrics', {
      headers: { Authorization: 'Bearer fnd_machine_key' },
    });

    expect(regularApi.status).toBe(500);
    expect(await regularApi.json()).toEqual({ error: 'Server configuration error' });
    expect(nearPrefix.status).toBe(500);
    expect(await nearPrefix.json()).toEqual({ error: 'Server configuration error' });
  });
});
