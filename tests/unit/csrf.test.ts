// =============================================================================
// Tests: CSRF Protection — Pure Functions
// =============================================================================
// The csrfMiddleware is a Hono middleware that requires request context.
// We test the pure utility function csrfInput() and the token generation logic
// by exercising the middleware through a minimal Hono app.
// =============================================================================

import { describe, it, expect } from 'vitest';
import { csrfInput } from '../../src/middleware/csrf.js';

describe('csrfInput()', () => {
  it('generates a hidden input field with the token from context', () => {
    const mockContext = {
      get: (key: string) => {
        if (key === 'csrfToken') return 'test-token-abc123';
        return undefined;
      },
    };

    const html = csrfInput(mockContext);
    expect(html).toBe('<input type="hidden" name="_csrf" value="test-token-abc123" />');
  });

  it('uses correct field name (_csrf)', () => {
    const mockContext = {
      get: () => 'any-token',
    };

    const html = csrfInput(mockContext);
    expect(html).toContain('name="_csrf"');
  });

  it('handles missing token gracefully (empty value)', () => {
    const mockContext = {
      get: () => undefined,
    };

    const html = csrfInput(mockContext);
    // When token is undefined, it falls back to empty string
    expect(html).toContain('value=""');
  });

  it('renders a proper HTML input element', () => {
    const mockContext = {
      get: () => 'deadbeef',
    };

    const html = csrfInput(mockContext);
    expect(html).toContain('type="hidden"');
    expect(html).toMatch(/^<input .+\/>$/);
  });

  it('embeds the exact token value without escaping', () => {
    const token = 'a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2';
    const mockContext = {
      get: () => token,
    };

    const html = csrfInput(mockContext);
    expect(html).toContain(`value="${token}"`);
  });
});

describe('CSRF middleware integration', () => {
  // Test that the middleware works end-to-end with Hono
  // We create a mini Hono app to exercise the full middleware chain

  it('sets CSRF cookie on GET requests', async () => {
    const { Hono } = await import('hono');
    const { csrfMiddleware } = await import('../../src/middleware/csrf.js');

    const app = new Hono();
    app.use('*', csrfMiddleware);
    app.get('/test', (c) => c.text('ok'));

    const res = await app.request('/test', { method: 'GET' });
    expect(res.status).toBe(200);

    // Should have Set-Cookie header with CSRF token
    const setCookie = res.headers.get('Set-Cookie');
    expect(setCookie).toBeTruthy();
    expect(setCookie).toContain('foundry_csrf=');
    expect(setCookie).toContain('HttpOnly');
    expect(setCookie).toContain('SameSite=Lax');
  });

  it('generates a 64-character hex token', async () => {
    const { Hono } = await import('hono');
    const { csrfMiddleware } = await import('../../src/middleware/csrf.js');

    const app = new Hono();
    app.use('*', csrfMiddleware);
    app.get('/test', (c) => c.text('ok'));

    const res = await app.request('/test', { method: 'GET' });
    const setCookie = res.headers.get('Set-Cookie') ?? '';
    const match = setCookie.match(/foundry_csrf=([^;]+)/);
    expect(match).toBeTruthy();
    const token = match![1];
    // 32 random bytes = 64 hex chars
    expect(token).toMatch(/^[0-9a-f]{64}$/);
  });

  it('rejects a cross-site form POST (foreign Origin) with 403', async () => {
    const { Hono } = await import('hono');
    const { csrfMiddleware } = await import('../../src/middleware/csrf.js');

    const app = new Hono();
    app.use('*', csrfMiddleware);
    app.post('/submit', (c) => c.text('ok'));

    const res = await app.request('http://localhost/submit', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Origin': 'https://evil.example',
      },
      body: 'name=test',
    });
    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.error).toBe('CSRF token mismatch');
  });

  it('rejects a cross-site POST whose only signal is a foreign Referer', async () => {
    const { Hono } = await import('hono');
    const { csrfMiddleware } = await import('../../src/middleware/csrf.js');

    const app = new Hono();
    app.use('*', csrfMiddleware);
    app.post('/submit', (c) => c.text('ok'));

    const res = await app.request('http://localhost/submit', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Referer': 'https://evil.example/attack-page',
      },
      body: 'name=test',
    });
    expect(res.status).toBe(403);
  });

  it('allows a same-origin form POST with no token (the server-rendered forms)', async () => {
    const { Hono } = await import('hono');
    const { csrfMiddleware } = await import('../../src/middleware/csrf.js');

    const app = new Hono();
    app.use('*', csrfMiddleware);
    app.post('/submit', (c) => c.text('ok'));

    const res = await app.request('http://localhost/submit', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Origin': 'http://localhost',
      },
      body: 'name=test',
    });
    expect(res.status).toBe(200);
  });

  it('allows a POST whose Origin matches APP_URL (TLS-terminating proxy case)', async () => {
    const { Hono } = await import('hono');
    const { csrfMiddleware } = await import('../../src/middleware/csrf.js');

    const prev = process.env.APP_URL;
    process.env.APP_URL = 'https://app.foundry.example';
    try {
      const app = new Hono();
      app.use('*', csrfMiddleware);
      app.post('/submit', (c) => c.text('ok'));

      const res = await app.request('http://internal-host/submit', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          'Origin': 'https://app.foundry.example',
        },
        body: 'name=test',
      });
      expect(res.status).toBe(200);
    } finally {
      process.env.APP_URL = prev;
    }
  });

  it('allows POST with matching CSRF token in header', async () => {
    const { Hono } = await import('hono');
    const { csrfMiddleware } = await import('../../src/middleware/csrf.js');

    const app = new Hono();
    app.use('*', csrfMiddleware);
    app.post('/submit', (c) => c.text('ok'));

    // First, GET to obtain the token
    const getRes = await app.request('/test', { method: 'GET' });
    const setCookie = getRes.headers.get('Set-Cookie') ?? '';
    const match = setCookie.match(/foundry_csrf=([^;]+)/);
    const token = match![1];

    // Now POST with matching header and cookie
    const res = await app.request('/submit', {
      method: 'POST',
      headers: {
        'x-csrf-token': token,
        'Cookie': `foundry_csrf=${token}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: 'name=test',
    });
    expect(res.status).toBe(200);
  });

  it('skips CSRF for Bearer-authenticated JSON requests', async () => {
    const { Hono } = await import('hono');
    const { csrfMiddleware } = await import('../../src/middleware/csrf.js');

    const app = new Hono();
    app.use('*', csrfMiddleware);
    app.post('/api/data', (c) => c.json({ success: true }));

    // Bearer-auth JSON requests should bypass CSRF
    const res = await app.request('/api/data', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer test-token',
      },
      body: JSON.stringify({ test: true }),
    });
    expect(res.status).toBe(200);
  });

  it('rejects cross-origin JSON fetch() from a foreign page', async () => {
    const { Hono } = await import('hono');
    const { csrfMiddleware } = await import('../../src/middleware/csrf.js');

    const app = new Hono();
    app.use('*', csrfMiddleware);
    app.post('/api/data', (c) => c.json({ success: true }));

    // A browser fetch() from another origin always carries that Origin.
    const res = await app.request('http://localhost/api/data', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Origin': 'https://evil.example' },
      body: JSON.stringify({ test: true }),
    });
    expect(res.status).toBe(403);
  });

  it('allows a non-browser client with no Origin and no token (not a CSRF vector)', async () => {
    const { Hono } = await import('hono');
    const { csrfMiddleware } = await import('../../src/middleware/csrf.js');

    const app = new Hono();
    app.use('*', csrfMiddleware);
    app.post('/api/data', (c) => c.json({ success: true }));

    // curl-style: no Origin, no Referer, no token. Cross-site pages cannot
    // produce this shape — browsers always attach Origin to POSTs.
    const res = await app.request('/api/data', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ test: true }),
    });
    expect(res.status).toBe(200);
  });

  it('rejects POST with mismatched token', async () => {
    const { Hono } = await import('hono');
    const { csrfMiddleware } = await import('../../src/middleware/csrf.js');

    const app = new Hono();
    app.use('*', csrfMiddleware);
    app.post('/submit', (c) => c.text('ok'));

    const res = await app.request('/submit', {
      method: 'POST',
      headers: {
        'x-csrf-token': 'wrong-token',
        'Cookie': 'foundry_csrf=real-token',
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: 'name=test',
    });
    expect(res.status).toBe(403);
  });
});
