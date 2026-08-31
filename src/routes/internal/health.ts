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

  // AI gateway configured (OpenRouter preferred, Anthropic fallback)
  const aiConfigured = process.env.OPENROUTER_API_KEY || process.env.ANTHROPIC_API_KEY;
  checks.ai_configured = aiConfigured ? 'ok' : 'error';
  if (!aiConfigured) healthy = false;

  // Clerk configured
  checks.clerk_configured = process.env.CLERK_SECRET_KEY ? 'ok' : 'error';

  // WHICH DATABASE IS ACTUALLY IN USE, WHICH IS NOT THE SAME AS WHICH ONE WAS
  // CONFIGURED.
  //
  // The private deployment puts institutional memory on a mounted volume by
  // setting TURSO_DATABASE_URL in fly.private.toml's [env]. A Fly SECRET of the
  // same name overrides that file, and the previous operator runbook told the
  // operator to set exactly that secret for a hosted database. So an app can be
  // deployed with a volume attached, a green health check, and every
  // observation it will ever make going somewhere else — with nothing visibly
  // wrong.
  //
  // Reported as a shape, never as the value: a URL would put a database
  // hostname on a public endpoint. 'volume' means a local file, 'remote' means
  // a network database, and the difference is the whole point of the private
  // deployment.
  const dbUrl = process.env.TURSO_DATABASE_URL ?? '';
  const storage = dbUrl.startsWith('file:')
    ? (dbUrl.includes(':memory:') ? 'memory' : 'volume')
    : dbUrl ? 'remote' : 'unset';

  return c.json(
    {
      status: healthy ? 'ok' : 'degraded',
      timestamp: new Date().toISOString(),
      version: '0.1.0',
      checks,
      storage,
    },
    healthy ? 200 : 503,
  );
});
