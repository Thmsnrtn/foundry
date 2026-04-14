// =============================================================================
// FOUNDRY — CSRF Protection Tests
// =============================================================================

import { describe, it, expect } from 'vitest';
import { Hono } from 'hono';
import { csrfProtection, csrfField } from './csrf.js';

function createTestApp() {
  const app = new Hono();
  app.use('*', csrfProtection);
  app.get('/form', (c) => {
    const token = (c as any).get('csrfToken') ?? '';
    return c.html(`<form>${csrfField(token)}</form>`);
  });
  app.post('/submit', async (c) => {
    return c.json({ ok: true });
  });
  return app;
}

describe('csrfProtection', () => {
  it('sets CSRF cookie on GET requests', async () => {
    const app = createTestApp();
    const res = await app.request('/form');
    expect(res.status).toBe(200);
    const setCookie = res.headers.get('Set-Cookie');
    expect(setCookie).toContain('__csrf=');
    expect(setCookie).toContain('HttpOnly');
    expect(setCookie).toContain('SameSite=Strict');
  });

  it('renders CSRF token in form HTML', async () => {
    const app = createTestApp();
    const res = await app.request('/form');
    const html = await res.text();
    expect(html).toContain('name="_csrf"');
    expect(html).toContain('value="');
  });

  it('blocks POST without CSRF token', async () => {
    const app = createTestApp();
    const res = await app.request('/submit', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: 'data=test',
    });
    expect(res.status).toBe(403);
  });

  it('allows POST with JSON content type (exempt from CSRF)', async () => {
    const app = createTestApp();

    // First GET to establish cookie
    const getRes = await app.request('/form');
    const setCookie = getRes.headers.get('Set-Cookie') ?? '';
    const csrfCookie = setCookie.split(';')[0]; // __csrf=xxx

    // POST with JSON is exempt (SameSite + CORS protect JSON APIs)
    const res = await app.request('/submit', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Cookie: csrfCookie,
      },
      body: JSON.stringify({ data: 'test' }),
    });
    expect(res.status).toBe(200);
  });

  it('allows POST with valid X-CSRF-Token header', async () => {
    const app = createTestApp();

    // First GET to establish cookie
    const getRes = await app.request('/form');
    const setCookie = getRes.headers.get('Set-Cookie') ?? '';
    const csrfCookie = setCookie.split(';')[0]; // __csrf=xxx
    const token = csrfCookie.split('=')[1];

    // POST with header token
    const res = await app.request('/submit', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'X-CSRF-Token': token,
        Cookie: csrfCookie,
      },
      body: 'data=test',
    });
    expect(res.status).toBe(200);
  });
});

describe('csrfField', () => {
  it('generates a hidden input field', () => {
    const html = csrfField('abc123');
    expect(html).toBe('<input type="hidden" name="_csrf" value="abc123" />');
  });
});
