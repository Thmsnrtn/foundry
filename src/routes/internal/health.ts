import { Hono } from 'hono';
import { query } from '../../db/client.js';
import { WRITE_PROBE } from '../../db/runtime-objects.js';

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
    // NAMED FROM THE ONE LIST THAT KNOWS IT IS MADE AT RUNTIME, so the table
    // this creates and the table the schema comparison forgives can never drift
    // apart. They already had, in opposite directions, for eleven days.
    await query(`CREATE TABLE IF NOT EXISTS ${WRITE_PROBE} (at TEXT NOT NULL)`);
    await query(`INSERT INTO ${WRITE_PROBE} (at) VALUES (datetime('now'))`);
    await query(`DELETE FROM ${WRITE_PROBE}`);
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

  // AND WHETHER THE ROUTINES ACTUALLY COMPLETED, which "scheduled" cannot say.
  //
  // A routine can be registered on a cron and fail every hour, or never come
  // round, and the line above still reads ok. The economic loop's routines
  // each write their success and failure to `job_health`, and the loop list
  // knows each one's cadence; this reads the same reading the owner's Home
  // shows, so a probe from outside — Fly's own check, or the owner from his
  // phone — sees the institution's condition and not only the process's.
  //
  // It does not turn the response into a 503: a stalled loop is a logical
  // failure, and restarting the machine for it would be the wrong reflex. The
  // status word says degraded; the process stays up to be looked at.
  let loops: { stopped: string[]; lastCompletedPass: string | null } = { stopped: [], lastCompletedPass: null };
  try {
    const { ECONOMIC_LOOPS, INSTITUTION_LOOPS, getFailingInstitutionLoops } = await import('../../services/institution/loop-health.js');
    const failing = (await getFailingInstitutionLoops()).filter((l) => INSTITUTION_LOOPS[l.jobName]?.economic === true);
    const marks = ECONOMIC_LOOPS.map(() => '?').join(',');
    const last = (await query(
      `SELECT MAX(last_success_at) AS at FROM job_health WHERE job_name IN (${marks})`, [...ECONOMIC_LOOPS]))
      .rows[0] as Record<string, unknown> | undefined;
    loops = {
      stopped: failing.map((l) => `${l.jobName}: ${l.stoppedRunning ? 'has not run' : `failed ${String(l.consecutiveFailures)}x`}; last succeeded ${l.lastSuccessAt ?? 'never'}`),
      lastCompletedPass: last?.at == null ? null : String(last.at),
    };
    checks.loops = failing.length === 0 ? 'ok' : 'error';
  } catch {
    checks.loops = 'error';
  }
  const degradedLoops = checks.loops === 'error';

  // WHICH MIGRATIONS THIS DATABASE ACTUALLY HAS.
  //
  // The owner, 22 September 2026: "Verify the presence and expected structure
  // of migrations 346 and 347 directly through the appropriate migration
  // records or database metadata. Successful application boot is supporting
  // evidence, not a substitute for direct verification of schema state."
  //
  // He is right, and until now there was no way to answer him. The table count
  // above proves A schema is applied; it cannot say WHICH, and a boot that
  // succeeds proves only that nothing threw. A build shipping a migration that
  // silently did not apply — a volume restored from a snapshot, a deploy that
  // rolled back its image but not its data — would look exactly like a healthy
  // one from out here.
  //
  // `schema_migrations` is the record the migrator itself writes, so this is
  // that record read back rather than an inference from behaviour. Reported as
  // two numbers: how many rows it holds and the highest migration number among
  // them. A number is not a map — no filenames, no columns, no table names —
  // and the commit beside it already says which build this is, so the pair
  // together answers "does the data match the code" without publishing either.
  let schema: { applied: number; highest: number | null } = { applied: 0, highest: null };
  try {
    const row = (await query(
      `SELECT COUNT(*) AS n,
              MAX(CAST(substr(filename, 1, instr(filename, '_') - 1) AS INTEGER)) AS top
         FROM schema_migrations`)).rows[0] as Record<string, unknown> | undefined;
    schema = {
      applied: Number(row?.n ?? 0),
      highest: row?.top == null ? null : Number(row.top),
    };
  } catch {
    // A database with no migration record is a database this build has never
    // migrated. Said as an error rather than as a zero, which would read as
    // 'none yet' on a deployment that has been running for months.
    checks.schema = 'error';
    healthy = false;
  }
  if (checks.schema !== 'error') checks.schema = schema.applied > 0 ? 'ok' : 'error';
  if (checks.schema === 'error') healthy = false;

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
      status: healthy && !degradedLoops ? 'ok' : 'degraded',
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
      loops,
      storage,
      schema,
    },
    healthy ? 200 : 503,
  );
});
