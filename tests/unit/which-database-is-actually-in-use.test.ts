process.env.TURSO_DATABASE_URL = 'file::memory:';
process.env.ENCRYPTION_KEY = '0'.repeat(64);

import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { runMigrations } from '../../src/db/migrate.js';
import { healthRoutes } from '../../src/routes/internal/health.js';

// =============================================================================
// WHICH DATABASE IS ACTUALLY IN USE — NOT WHICH ONE WAS CONFIGURED.
//
// The private deployment puts institutional memory on a mounted volume by
// setting TURSO_DATABASE_URL in fly.private.toml's [env]. A Fly SECRET of the
// same name overrides that file, and the previous operator runbook told the
// operator to set exactly that secret for a hosted database.
//
// So the failure available here is: deploy with a volume attached, get a green
// health check, and have every observation Foundry will ever make go somewhere
// else. The volume sits empty, persistence quietly depends on an account the
// private design removed, and nothing looks wrong.
//
// The health endpoint now says which SHAPE of store is live. Never the value —
// a URL would put a database hostname on a public endpoint.
// =============================================================================

const original = process.env.TURSO_DATABASE_URL;
beforeAll(async () => { await runMigrations(); });
afterEach(() => { process.env.TURSO_DATABASE_URL = original; });

async function storage(url: string | undefined): Promise<string> {
  if (url === undefined) delete process.env.TURSO_DATABASE_URL;
  else process.env.TURSO_DATABASE_URL = url;
  const res = await healthRoutes.request('/internal/health');
  return String((await res.json() as Record<string, unknown>).storage);
}

describe('the health endpoint says where institutional memory lives', () => {
  it('calls a volume-backed file what it is', async () => {
    expect(await storage('file:/data/foundry.db')).toBe('volume');
  });

  it('distinguishes a network database, which the private design removed', async () => {
    expect(await storage('libsql://example-db.turso.io')).toBe('remote');
  });

  it('does not call an in-memory database persistent', async () => {
    // A test-shaped database in production would lose everything on restart
    // while reporting a file URL.
    expect(await storage('file::memory:')).toBe('memory');
  });

  it('reports an absent configuration as unset rather than guessing', async () => {
    expect(await storage(undefined)).toBe('unset');
  });

  it('never puts the database location on a public endpoint', async () => {
    process.env.TURSO_DATABASE_URL = 'libsql://secret-host-name.turso.io';
    const body = await (await healthRoutes.request('/internal/health')).text();
    expect(body).not.toContain('secret-host-name');
    expect(body).not.toContain('turso.io');
  });
});
