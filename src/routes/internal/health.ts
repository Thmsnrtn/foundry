import { Hono } from 'hono';
import { query } from '../../db/client.js';

export const healthRoutes = new Hono();

healthRoutes.get('/internal/health', async (c) => {
  const checks: Record<string, 'ok' | 'error'> = {};
  let healthy = true;

  // Database check
  try {
    // A READ PROVES THE FILE IS THERE. IT DOES NOT PROVE THE INSTITUTION CAN
    // RECORD ANYTHING.
    //
    // `SELECT 1` does not even touch a table: it succeeds against a database
    // with no schema, a full disk, or a read-only volume. Every one of those is
    // a total outage of an institution whose entire job is to write down what
    // it learns, and the health check would have said ok through all three.
    await query('SELECT 1', []);
    const migrated = (await query(
      "SELECT COUNT(*) AS n FROM sqlite_master WHERE type = 'table'"))
      .rows[0] as Record<string, unknown> | undefined;
    if (Number(migrated?.n ?? 0) < 50) throw new Error('the schema is not applied');
    // A real write, on a table that exists for this, immediately undone.
    await query("CREATE TABLE IF NOT EXISTS health_write_probe (at TEXT NOT NULL)");
    await query("INSERT INTO health_write_probe (at) VALUES (datetime('now'))");
    await query('DELETE FROM health_write_probe');
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

  // WHETHER THE ROUTINES ARE ACTUALLY RUNNING.
  //
  // Ninety-six routines carry everything this institution does on its own, and
  // nothing anywhere reported whether a single one of them was scheduled. The
  // process could be answering requests perfectly with its whole inner life
  // stopped, and every probe would have said ok.
  const { schedulerStanding } = await import('../../lib/scheduler-standing.js');
  const scheduler = schedulerStanding();
  checks.scheduler = scheduler.running > 0 ? 'ok' : 'error';

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
      // WHICH COMMIT THIS ACTUALLY IS.
      //
      // A package version that never changes cannot tell anyone whether what
      // is running is what was written. The institution reported a feature as
      // live because the branch had it, while production was four commits and
      // ten hours behind — and no observation available to anybody could have
      // contradicted that, because the deployed process had no way to say
      // which commit it was. Stamped into the image at build time, so it
      // describes the artifact rather than the repository the question is
      // being asked from. 'unknown' means an image built outside the deploy
      // path, which is itself worth knowing.
      commit: process.env.FOUNDRY_COMMIT ?? 'unknown',
      checks,
      storage,
    },
    healthy ? 200 : 503,
  );
});
