import { Hono } from 'hono';
import { query } from '../../db/client.js';

export const healthRoutes = new Hono();

healthRoutes.get('/internal/health', async (c) => {
  const checks: Record<string, { status: string; latencyMs?: number; error?: string }> = {};

  // Database check
  const dbStart = Date.now();
  try {
    await query('SELECT 1', []);
    checks.database = { status: 'ok', latencyMs: Date.now() - dbStart };
  } catch (err) {
    checks.database = {
      status: 'error',
      latencyMs: Date.now() - dbStart,
      error: err instanceof Error ? err.message : 'Unknown error',
    };
  }

  // Required environment variables presence (don't leak values)
  const requiredEnvs = ['TURSO_DATABASE_URL', 'CLERK_SECRET_KEY', 'ANTHROPIC_API_KEY', 'STRIPE_SECRET_KEY'];
  const missingEnvs = requiredEnvs.filter((key) => !process.env[key]);
  checks.config = {
    status: missingEnvs.length === 0 ? 'ok' : 'error',
    ...(missingEnvs.length > 0 ? { error: `Missing: ${missingEnvs.join(', ')}` } : {}),
  };

  // Memory usage
  const mem = process.memoryUsage();
  checks.memory = {
    status: mem.heapUsed / mem.heapTotal < 0.9 ? 'ok' : 'warning',
    latencyMs: Math.round(mem.heapUsed / 1024 / 1024),
  };

  const overallStatus = Object.values(checks).every((c) => c.status === 'ok') ? 'ok' : 'degraded';

  return c.json({
    status: overallStatus,
    timestamp: new Date().toISOString(),
    version: '0.1.0',
    uptime: Math.round(process.uptime()),
    checks,
  }, overallStatus === 'ok' ? 200 : 503);
});
