import { Hono } from 'hono';

export const healthRoutes = new Hono();

healthRoutes.get('/internal/health', (c) => {
  return c.json({ status: 'ok', timestamp: new Date().toISOString(), version: '0.1.0' });
});
