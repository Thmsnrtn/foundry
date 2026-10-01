process.env.TURSO_DATABASE_URL = 'file::memory:';
process.env.ENCRYPTION_KEY = '9'.repeat(64);
process.env.FOUNDRY_INSTANCE_POSTURE = 'private_owner';
process.env.FOUNDRY_OWNER_EMAIL = 'owner@example.com';

import { Hono } from 'hono';
import { beforeAll, describe, expect, it } from 'vitest';
import { runMigrations } from '../../src/db/migrate.js';
import { query } from '../../src/db/client.js';
import { ENOUGH_TO_HAVE_A_RATE, howOftenRight, resolvePrediction } from '../../src/services/institution/calibration.js';

// =============================================================================
// ONE OF ONE IS SHOWN (Roadmap 2027 R7, 30 September 2026; STRATEGY S24,
// "calibration on Home, as a share of graded predictions with its count, even
// at n = 1"; OBJECTIVE §6, more intelligent = calibration improving).
//
// Foundry's record was on a card only when a graded test was the one thing,
// and below eight grades it said "not enough to tell you a rate" without
// saying the count. Both rules were half right. The rate stays silent below
// the floor — three grades swing thirty points — but the count is a fact from
// the first grade, and Home now says it: "1 of 1 as I said", never a
// percentage, with how many the world settled rather than the owner.
// =============================================================================

const OWNER = 'f_rec';
let app: Hono;

beforeAll(async () => {
  await runMigrations();
  await query('INSERT INTO founders (id,clerk_user_id,email,name) VALUES (?,?,?,?)', [OWNER, 'clk_rec', 'owner@example.com', 'Owner']);
  const { letterRoutes } = await import('../../src/routes/dashboard/letter.js');
  app = new Hono();
  app.use('*', async (c, next) => { c.set('founder' as never, { id: OWNER, email: 'owner@example.com', name: 'Owner' } as never); c.set('csrfToken' as never, 't' as never); await next(); });
  app.route('/', letterRoutes);
});

const stands = async (): Promise<string> => {
  const html = await (await app.request('/foundry')).text();
  return /<section class="panel stands-panel" aria-label="Where everything stands">[\s\S]*?<\/section>/.exec(html)?.[0] ?? '';
};

describe('before anything is graded', () => {
  it('says so, on Home and on the card', async () => {
    const r = await howOftenRight(OWNER);
    expect(r.count).toBeNull();
    expect(await stands()).toContain('<b>My record</b><span>Not graded on anything yet.</span>');
  });
});

describe('from the first grade', () => {
  it('shows the count, never a rate below the floor', async () => {
    await resolvePrediction({ founderId: OWNER, kind: 'venture_experiment', predictionId: 'x1', resolvedBy: 'experiment_result',
      evidenceRef: 'run x1', verdict: 'as_predicted', because: 'the sealed rule', predictedAt: '2026-09-01 00:00:00' });
    const r = await howOftenRight(OWNER);
    expect(r.rate).toBeNull();
    expect(r.count).toBe('1 of 1 as I said');
    expect(r.sentence).toContain('1 as I said, 0 partly, 0 not');
    expect(r.sentence).toContain('not enough to tell you a rate');
    expect(await stands()).toContain('<b>My record</b><span>1 of 1 as I said</span>');
  });

  it('says how many the owner graded rather than the world', async () => {
    await resolvePrediction({ founderId: OWNER, kind: 'venture_experiment', predictionId: 'x2', resolvedBy: 'owner',
      evidenceRef: 'his word', verdict: 'surprised', because: 'he said so', predictedAt: '2026-09-02 00:00:00' });
    expect((await howOftenRight(OWNER)).count).toBe('1 of 2 as I said (1 settled by the world)');
  });

  it('keeps the floor where it was', () => {
    expect(ENOUGH_TO_HAVE_A_RATE).toBe(8);
  });
});
