// =============================================================================
// FOUNDRY — Cron load / concurrency harness (Roadmap 3.1 / go-live step 6)
//
// The 68 in-process cron jobs moved onto a dedicated `worker` process behind
// Fly process groups. The safety of that split rests entirely on the DB-backed
// job lock (services/job-lock.ts): during a rolling deploy two workers overlap,
// and every job must run AT MOST ONCE. This harness stress-tests that invariant
// and measures whether one worker can churn through the whole registry fast
// enough to keep up with the tightest cron cadence.
//
// It asserts, under load:
//   1. Double-run prevention — N instances race the same job, exactly 1 wins.
//   2. Job independence — locking job A never blocks job B.
//   3. Crash recovery — an expired lease is reclaimed; a never-released lock
//      (crashed worker) does not deadlock the job forever.
//   4. Throughput — a full acquire+release sweep of all 68 jobs is far faster
//      than the tightest schedule (every-minute jobs), with headroom.
//
// Run:  TURSO_DATABASE_URL=file::memory: tsx tests/load/cron-load.ts
// Exits non-zero on any violation, so it doubles as a CI gate.
// =============================================================================

process.env.NODE_ENV = 'test';
process.env.TURSO_DATABASE_URL = 'file::memory:';
process.env.CLERK_SECRET_KEY = 'sk_test_fake';
process.env.CLERK_PUBLISHABLE_KEY = 'pk_test_fake';
process.env.ANTHROPIC_API_KEY = 'sk-ant-test';
process.env.ENCRYPTION_KEY = '0'.repeat(64);

const { runMigrations } = await import('../../src/db/migrate.js');
const { query } = await import('../../src/db/client.js');
const { JOB_REGISTRY } = await import('../../src/jobs/index.js');

const failures: string[] = [];
function check(ok: boolean, note: string): void {
  if (!ok) failures.push(note);
}

// Mirror of acquireJobLock's exact SQL, but parameterized by instanceId so we
// can simulate DISTINCT worker instances in a single process (the production
// helper hard-codes one INSTANCE_ID per process). Semantics are identical:
// atomic INSERT-or-steal-if-expired, then confirm ownership.
async function acquireAs(instanceId: string, jobName: string, ttlSeconds = 300): Promise<boolean> {
  try {
    await query(
      `INSERT INTO job_locks (job_name, locked_at, locked_by, expires_at)
       VALUES (?, datetime('now'), ?, datetime('now', ?))
       ON CONFLICT(job_name) DO UPDATE SET
         locked_at = datetime('now'),
         locked_by = excluded.locked_by,
         expires_at = excluded.expires_at
       WHERE job_locks.expires_at < datetime('now')`,
      [jobName, instanceId, `+${ttlSeconds} seconds`],
    );
    const r = await query('SELECT locked_by FROM job_locks WHERE job_name = ?', [jobName]);
    return (r.rows[0] as Record<string, unknown>)?.locked_by === instanceId;
  } catch {
    return false;
  }
}

async function releaseAs(instanceId: string, jobName: string): Promise<void> {
  await query('DELETE FROM job_locks WHERE job_name = ? AND locked_by = ?', [jobName, instanceId]);
}

async function main(): Promise<void> {
  await runMigrations();

  const jobNames = Object.keys(JOB_REGISTRY);
  console.log(`\nRegistered jobs: ${jobNames.length}`);

  // ── 1. Double-run prevention: 20 instances race the same job ───────────────
  {
    const job = jobNames[0];
    const instances = Array.from({ length: 20 }, (_, i) => `inst-${i}`);
    const results = await Promise.all(instances.map((id) => acquireAs(id, job)));
    const winners = results.filter(Boolean).length;
    check(winners === 1, `double-run: expected exactly 1 winner racing '${job}', got ${winners}`);
    console.log(`  [1] 20 instances raced '${job}' → ${winners} winner (expect 1)`);
    // Losers must stay locked out until the winner releases.
    const secondWave = await Promise.all(instances.map((id) => acquireAs(id, job)));
    check(secondWave.filter(Boolean).length <= 1,
      `double-run: a held lock was acquired by >1 instance on retry`);
    await query('DELETE FROM job_locks', []);
  }

  // ── 2. Job independence: distinct jobs never contend ───────────────────────
  {
    const sweep = await Promise.all(jobNames.map((j) => acquireAs('worker-A', j)));
    const acquired = sweep.filter(Boolean).length;
    check(acquired === jobNames.length,
      `independence: worker-A should hold all ${jobNames.length} distinct locks, got ${acquired}`);
    console.log(`  [2] one worker acquired all ${acquired}/${jobNames.length} distinct job locks`);
    // A second worker must be blocked on every one of them.
    const contested = await Promise.all(jobNames.map((j) => acquireAs('worker-B', j)));
    check(contested.filter(Boolean).length === 0,
      `independence: worker-B stole ${contested.filter(Boolean).length} locks worker-A holds`);
    for (const j of jobNames) await releaseAs('worker-A', j);
  }

  // ── 3. Crash recovery: expired lease is reclaimed ──────────────────────────
  {
    const job = jobNames[1];
    // worker-X takes the lock, then crashes without releasing. Force its lease
    // to have already elapsed (what the TTL guarantees after `ttlSeconds`).
    const got = await acquireAs('worker-X', job);
    check(got, `crash-recovery: initial acquire should succeed`);
    await query(
      `UPDATE job_locks SET expires_at = datetime('now', '-1 seconds') WHERE job_name = ?`,
      [job],
    );
    const reclaimed = await acquireAs('worker-Y', job);
    check(reclaimed, `crash-recovery: worker-Y must reclaim the expired lease of a crashed worker`);
    console.log(`  [3] expired lease of a crashed worker was reclaimed: ${reclaimed}`);
    await query('DELETE FROM job_locks', []);
  }

  // ── 4. Throughput: full acquire+release sweep of every job ─────────────────
  {
    const ROUNDS = 20;
    const start = process.hrtime.bigint();
    for (let r = 0; r < ROUNDS; r++) {
      for (const j of jobNames) {
        await acquireAs('worker-A', j);
        await releaseAs('worker-A', j);
      }
    }
    const elapsedMs = Number(process.hrtime.bigint() - start) / 1e6;
    const ops = ROUNDS * jobNames.length;
    const perSweepMs = elapsedMs / ROUNDS;
    console.log(`  [4] ${ops} acquire+release ops in ${elapsedMs.toFixed(0)}ms ` +
      `(${(ops / (elapsedMs / 1000)).toFixed(0)} ops/s, ${perSweepMs.toFixed(1)}ms per full sweep)`);
    // The tightest cron cadence is every-minute (60_000ms). A full sweep of the
    // whole registry must finish with wide headroom — flag if it eats >10% of
    // the minute budget, which would mean the worker can't keep up under load.
    check(perSweepMs < 6_000,
      `throughput: a full ${jobNames.length}-job lock sweep took ${perSweepMs.toFixed(0)}ms ` +
      `(>10% of the 60s minute budget) — worker may fall behind`);
  }

  // ── Report ─────────────────────────────────────────────────────────────────
  console.log('\n================ CRON LOAD REPORT ================');
  if (failures.length === 0) {
    console.log('Lock invariants held under contention; worker keeps up. ✅');
  } else {
    console.log(`Violations: ${failures.length}`);
    for (const f of failures) console.log(`  ✗ ${f}`);
  }
  console.log('==================================================\n');
  process.exit(failures.length > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error('cron-load harness crashed:', err);
  process.exit(1);
});
