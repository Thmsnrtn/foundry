// =============================================================================
// FOUNDRY — Test Setup
// Global setup for all test files. Sets test environment variables.
// =============================================================================

// Set test environment variables before any module imports
process.env.NODE_ENV = 'test';
process.env.TURSO_DATABASE_URL = 'file::memory:';
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
