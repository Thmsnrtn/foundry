import { Hono } from 'hono';
import { query } from '../../db/client.js';

export const healthRoutes = new Hono();

healthRoutes.get('/internal/health', async (c) => {
  const checks: Record<string, 'ok' | 'error'> = {};
  let healthy = true;

  // Database check
  try {
    await query('SELECT 1', []);
    checks.database = 'ok';
  } catch {
    checks.database = 'error';
    healthy = false;
  }

  // Anthropic API key present (not a live call — just config check)
  checks.anthropic_configured = process.env.ANTHROPIC_API_KEY ? 'ok' : 'error';
  if (!process.env.ANTHROPIC_API_KEY) healthy = false;

  // Clerk configured
  checks.clerk_configured = process.env.CLERK_SECRET_KEY ? 'ok' : 'error';

  return c.json(
    {
      status: healthy ? 'ok' : 'degraded',
      timestamp: new Date().toISOString(),
      version: '0.1.0',
      checks,
    },
    healthy ? 200 : 503,
  );
});
