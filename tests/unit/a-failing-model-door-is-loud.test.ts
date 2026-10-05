// =============================================================================
// LAW (Roadmap 2027 R33): A FAILING MODEL DOOR IS LOUD, AND ITS CREDITS ARE
// READ EVERY DAY.
//
// Every thinking routine reaches the model through one client. When the door
// failed (no credits, a revoked key, an outage), discovery and the legal pass
// caught the error and filed it as "could not read it" beside the ordinary
// refusals, and their routines recorded a successful run: the forge then had
// nothing to design, and the owner read "Foundry is working; nothing found so
// far has earned a candidate". A 200 that carried an error and no completion
// was settled as an empty answer. Nothing read how much credit was left.
//
// Now the door's failure has a name (ModelDoorError, carrying the status), a
// 200 with no completion is a failure, discovery and the legal pass let it
// through so their routines record a failure the institution already watches,
// the remaining credit is read once a day from the provider with the same key,
// and Control says whether the door works and how many days of credit remain.
// =============================================================================
process.env.TURSO_DATABASE_URL = 'file::memory:';
process.env.ENCRYPTION_KEY = '4'.repeat(64);
process.env.OPENROUTER_API_KEY = 'sk-or-test';

import { readFileSync } from 'fs';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { runMigrations } from '../../src/db/migrate.js';
import { query } from '../../src/db/client.js';

beforeAll(async () => { await runMigrations(); });
afterEach(() => { vi.unstubAllGlobals(); });

const ok = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

describe('the door\'s failure has a name', () => {
  it('no credits (402) is a ModelDoorError carrying the status, not tried again', async () => {
    const calls: string[] = [];
    vi.stubGlobal('fetch', vi.fn(async (u: string) => { calls.push(String(u)); return new Response('{"error":{"message":"Insufficient credits"}}', { status: 402 }); }));
    const { callSonnet, ModelDoorError } = await import('../../src/services/ai/client.js');
    const err = await callSonnet('s', 'u', 50).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ModelDoorError);
    expect((err as InstanceType<typeof ModelDoorError>).status).toBe(402);
    expect((err as Error).name).toBe('ModelDoorError');
    expect(calls.filter((c) => c.endsWith('/chat/completions'))).toHaveLength(1);
  });

  it('a 200 with an error and no completion is a failure, not an empty answer', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ok({ error: { message: 'upstream provider error', code: 502 } })));
    const { callSonnet, ModelDoorError } = await import('../../src/services/ai/client.js');
    const err = await callSonnet('s', 'u', 50).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ModelDoorError);
    expect((err as Error).message).toMatch(/no completion/);
  }, 20_000);
});

describe('discovery and the legal pass let it through', () => {
  it('neither files a door failure as "could not read it"', () => {
    for (const file of ['src/services/venture/interpretation.ts', 'src/services/venture/legal-pass.ts']) {
      const src = readFileSync(file, 'utf8');
      expect(src, file).toMatch(/catch \(err\) \{\s*\n\s*if \(err instanceof ModelDoorError\) throw err;\s*\n\s*return \{ refused: `could not read it/);
    }
  });
  it('the legal routine records a failure when the door failed', () => {
    const src = readFileSync('src/jobs/index.ts', 'utf8');
    const tick = /legal_surface_tick: \{[\s\S]*?schedule:/.exec(src)?.[0] ?? '';
    expect(tick).toMatch(/if \(err instanceof ModelDoorError\) throw err;/);
  });
});

describe('the credit left is read from the provider, once a day', () => {
  it('reads the account\'s credits, or the key\'s own limit where the account cannot be read', async () => {
    const { readModelCredits } = await import('../../src/services/ai/model-door.js');
    const seen: Array<{ u: string; auth: string }> = [];
    const account = vi.fn(async (u: string, init?: RequestInit) => {
      seen.push({ u: String(u), auth: String((init?.headers as Record<string, string>).Authorization) });
      return ok({ data: { total_credits: 25, total_usage: 21.5 } });
    });
    expect(await readModelCredits(account as unknown as typeof fetch)).toEqual({ ok: true, remainingUsd: 3.5, source: 'account', detail: null });
    expect(seen[0]).toEqual({ u: 'https://openrouter.ai/api/v1/credits', auth: 'Bearer sk-or-test' });
    const keyOnly = vi.fn(async (u: string) => String(u).endsWith('/credits') ? ok({ error: 'forbidden' }, 403)
      : ok({ data: { limit: 10, limit_remaining: 6.25, usage: 3.75 } }));
    expect(await readModelCredits(keyOnly as unknown as typeof fetch)).toEqual({ ok: true, remainingUsd: 6.25, source: 'key', detail: null });
    const unlimited = vi.fn(async (u: string) => String(u).endsWith('/credits') ? ok({}, 403) : ok({ data: { limit: null, limit_remaining: null } }));
    const r = await readModelCredits(unlimited as unknown as typeof fetch);
    expect(r.ok).toBe(true); expect(r.remainingUsd).toBeNull();
    const down = vi.fn(async () => { throw new Error('connect ECONNREFUSED'); });
    const d = await readModelCredits(down as unknown as typeof fetch);
    expect(d.ok).toBe(false); expect(d.detail).toMatch(/ECONNREFUSED/);
  });

  it('is recorded once a day, and a second read the same day is not taken', async () => {
    const { readModelCreditsOnceADay } = await import('../../src/services/ai/model-door.js');
    const f = vi.fn(async () => ok({ data: { total_credits: 10, total_usage: 9 } }));
    expect(await readModelCreditsOnceADay(f as unknown as typeof fetch)).toBe('read');
    expect(await readModelCreditsOnceADay(f as unknown as typeof fetch)).toBe('already_read_today');
    expect(f).toHaveBeenCalledTimes(1);
    const row = (await query('SELECT ok, remaining_usd, source FROM model_door_readings ORDER BY read_at DESC LIMIT 1', [])).rows[0] as Record<string, unknown>;
    expect(Number(row.remaining_usd)).toBe(1);
  });

  it('the hourly pulse, which is itself watched, takes the day\'s reading', () => {
    const src = readFileSync('src/jobs/index.ts', 'utf8');
    const pulse = /institution_pulse_tick: \{[\s\S]*?schedule:/.exec(src)?.[0] ?? '';
    expect(pulse).toContain('readModelCreditsOnceADay(');
  });
});

describe('Control says whether the door works and how long the credit lasts', () => {
  const base = async () => {
    const { productionFacts } = await import('../../src/services/control/production-facts.js');
    return productionFacts('nobody', { STRIPE_SECRET_KEY: 'x', OPENROUTER_API_KEY: 'k' } as NodeJS.ProcessEnv);
  };
  it('days of credit left come from the reading and the last week\'s settled spend', async () => {
    const today = new Date().toISOString().slice(0, 10);
    for (const [i, cents] of [[1, 50], [2, 50]] as const) {
      const d = new Date(Date.now() - i * 86_400_000).toISOString().slice(0, 10);
      await query(`INSERT INTO ai_spend_reservations (id, date, model, reserved_cents, global_cap_cents, actual_cents, status, created_at, updated_at, expires_at)
        VALUES (?,?,'m',?,1000,?,'settled',datetime('now'),datetime('now'),datetime('now'))`, [`s${String(i)}`, d, cents, cents]);
    }
    const f = await base();
    expect(f.modelDoor.remainingUsd).toBe(1);
    // $1.00 left at about 14 cents a day over the last seven days.
    expect(f.modelDoor.daysLeft).toBe(7);
    expect(f.modelDoor.readOn).toBe(today);
  });
  it('a door that failed today with nothing settled is a blocker, and so is credit for fewer than three days', async () => {
    const { canSellOnItsOwn } = await import('../../src/services/control/production-facts.js');
    const f = await base();
    const before = f.modelDoor.failedToday;
    const today = new Date().toISOString().slice(0, 10);
    await query(`INSERT INTO ai_spend_reservations (id, date, model, reserved_cents, global_cap_cents, status, created_at, updated_at, expires_at)
      VALUES ('r1',?,'m',5,1000,'released',datetime('now'),datetime('now'),datetime('now'))`, [today]);
    const failing = await base();
    expect(failing.modelDoor.failedToday).toBe(before + 1);
    expect(canSellOnItsOwn({ ...failing, modelDoor: { ...failing.modelDoor, failedToday: 1 } }).blockers.join(' ')).toMatch(/the model door failed 1 time today and answered nothing/);
    expect(canSellOnItsOwn({ ...f, modelDoor: { ...f.modelDoor, failedToday: 0, daysLeft: 2 } }).blockers.join(' ')).toMatch(/2 days of model credit left/);
    expect(canSellOnItsOwn({ ...f, modelDoor: { ...f.modelDoor, failedToday: 0, daysLeft: 20 } }).blockers.join(' ')).not.toMatch(/model/);
    expect(canSellOnItsOwn({ ...f, modelDoor: { ...f.modelDoor, failedToday: 0, remainingUsd: null, daysLeft: null, readOn: null } }).costs.join(' ')).toMatch(/model credit has not been read/);
  });
});
