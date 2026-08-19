// =============================================================================
// FOUNDRY — Test Setup
// Global setup for all test files. Sets test environment variables.
// =============================================================================

// Set test environment variables before any module imports
process.env.NODE_ENV = 'test';
process.env.TURSO_DATABASE_URL = 'file::memory:';
// Twelve test files set this line themselves, and the thirteenth found out by
// failing: encryption sits on ordinary paths now (integration credentials, a
// company's own sending identity), so a test that never mentions encryption
// still reaches it. Set once here rather than remembered thirteen times.
// `encryption.test.ts` deletes it deliberately to prove the unset case, which
// is the one place that should be thinking about it.
process.env.ENCRYPTION_KEY ??= '0'.repeat(64);
process.env.CLERK_SECRET_KEY = 'sk_test_fake_key';
process.env.CLERK_PUBLISHABLE_KEY = 'pk_test_fake_key';
// Do not install a fake provider credential globally. Code paths that
// intentionally exercise AI must stub both the credential and transport in
// their own test. A fake key here made otherwise deterministic fallback tests
// perform real network retries and occasionally time out.
delete process.env.ANTHROPIC_API_KEY;
delete process.env.OPENROUTER_API_KEY;
process.env.STRIPE_SECRET_KEY = 'sk_test_fake_key';
process.env.STRIPE_WEBHOOK_SECRET = 'whsec_test_fake_secret';
process.env.APP_URL = 'http://localhost:8080';
process.env.ECOSYSTEM_SERVICE_KEY = 'test-ecosystem-key';

// ─── Failure forensics ────────────────────────────────────────────────────────
//
// An intermittent message-count failure in customer-message-intake was observed
// once and has never reproduced: nine full-suite runs, twenty-five isolated runs
// under CPU saturation, and six hypotheses eliminated by measurement (shared
// databases, query timeout, contention, detached signal processing, file
// parallelism). It remains open evidence debt.
//
// Chasing a non-reproducible event indefinitely is not a good use of anything.
// Being ready to learn from the NEXT occurrence is. This prints the state that
// investigation kept needing and could not recover after the fact — which worker
// and file it happened in, whether the database was the one that test built, and
// whether the connection settings were what the code assumes.
//
// Deliberately cheap: it runs only on failure, and it never fails a test itself.
import { afterEach, expect } from 'vitest';

afterEach(async (context) => {
  if (context.task.result?.state !== 'fail') return;
  try {
    const { query } = await import('../db/client.js');
    const [fk, tables] = await Promise.all([
      query('PRAGMA foreign_keys'),
      query("SELECT COUNT(*) n FROM sqlite_master WHERE type='table'"),
    ]);
    // Written straight to stderr rather than through the structured logger:
    // forensics must survive whatever logging configuration a suite installed,
    // and must not be buffered or redacted on its way out.
    const row = (r: { rows: unknown[] }) => r.rows[0] as Record<string, unknown>;
    process.stderr.write('[forensics] ' + JSON.stringify({
      test: context.task.name,
      file: context.task.file?.name,
      worker: process.env.VITEST_WORKER_ID ?? null,
      pool: process.env.VITEST_POOL_ID ?? null,
      db_url: process.env.TURSO_DATABASE_URL,
      query_timeout_ms: process.env.DB_QUERY_TIMEOUT_MS ?? 'default(10000)',
      foreign_keys: Number(row(fk).foreign_keys),
      tables_in_db: Number(row(tables).n),
      node: process.version,
    }) + '\n');
  } catch {
    // Forensics must never turn one failure into two, or mask the real one.
  }
});

// Referenced so the import is never treated as unused by a future sweep.
void expect;

// ─── Connections are closed, not abandoned ────────────────────────────────────
//
// Each test file gets its own module registry and therefore its own libsql
// client. Nothing closed them, so a full run created hundreds of native handles
// and left every one for the garbage collector to finalise whenever it chose —
// including in the middle of the next file's queries.
//
// The suite aborts intermittently with a Rust panic out of that binding at
// exactly that boundary. Whether this is the cause is not established; closing
// a connection you opened is right either way, and an abandoned handle is not
// something to leave lying around while investigating one.
const { afterAll } = await import('vitest');
afterAll(async () => {
  const { closeDb } = await import('../db/client.js');
  await closeDb();
});
