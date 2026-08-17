process.env.TURSO_DATABASE_URL = 'file::memory:';

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { runMigrations } from '../../src/db/migrate.js';
import { query } from '../../src/db/client.js';
import { transcribeAudio } from '../../src/services/scp/briefing/voice-reply.js';

// =============================================================================
// The one paid provider call that spent money without reserving it.
//
// Every model call goes through `services/ai/client.ts`, which atomically
// reserves a conservative maximum against the global, product and founder
// ceilings BEFORE dispatch, settles the actual usage afterwards, and releases
// only on a definitive failure. `transcribeAudio` POSTed straight to the
// provider with the API key and did none of it — so a caller holding a valid
// API key could drive unbounded transcription cost that the daily ceiling
// never saw. The owner's decision to make the public API live is what turned
// that from latent into reachable.
//
// It was also invisible to the consequential-effects audit, whose detector
// matches a quoted literal URL while this call builds one from a template. The
// inventory read "0 direct" while this existed. Teaching the detector to read
// templated URLs surfaced six more calls it had never seen, and one whole
// module — APNs device push — that had never been inventoried at all.
// =============================================================================

const P = 'ts_co';
const OWNER = 'ts_owner';
const AUDIO = Buffer.alloc(600_000, 1).toString('base64');

async function reservations(): Promise<Array<Record<string, unknown>>> {
  return (await query(
    'SELECT status,reserved_cents,actual_cents,product_id,model FROM ai_spend_reservations ORDER BY rowid',
    [])).rows as unknown as Array<Record<string, unknown>>;
}

beforeAll(async () => {
  await runMigrations();
  process.env.OPENROUTER_API_KEY = 'test-key';
  await query(`INSERT INTO founders (id,clerk_user_id,email) VALUES ('${OWNER}','ts_c','o@example.com')`, []);
  await query(`INSERT INTO products (id,name,owner_id) VALUES ('${P}','Co','${OWNER}')`, []);
});

afterEach(async () => {
  vi.unstubAllGlobals();
  await query('DELETE FROM ai_spend_reservations', []);
});

describe('transcription spends like everything else does', () => {
  it('reserves before dispatch, not after', async () => {
    // A ceiling checked after the money is spent is a report, not a ceiling.
    let reservedAtDispatch: Array<Record<string, unknown>> = [];
    vi.stubGlobal('fetch', async () => {
      reservedAtDispatch = await reservations();
      return new Response('hello there', { status: 200 });
    });

    expect(await transcribeAudio(AUDIO, 'audio/webm', { productId: P })).toBe('hello there');
    expect(reservedAtDispatch, 'the reservation must exist before the request goes out')
      .toHaveLength(1);
    expect(reservedAtDispatch[0]).toMatchObject({ status: 'reserved', model: 'whisper-1', product_id: P });
  });

  it('settles at the bound, because the response carries no duration', async () => {
    vi.stubGlobal('fetch', async () => new Response('transcribed', { status: 200 }));
    await transcribeAudio(AUDIO, 'audio/webm', { productId: P });

    const [row] = await reservations();
    expect(row.status).toBe('settled');
    // Settled at the reserved amount rather than at zero. Whisper bills per
    // minute and returns no duration, so the conservative estimate IS what is
    // known — recording it as free would make the ledger read cheaper than
    // reality.
    expect(Number(row.actual_cents)).toBe(Number(row.reserved_cents));
    expect(Number(row.reserved_cents)).toBeGreaterThan(0);
  });

  it('scales the bound with how much audio was sent', async () => {
    vi.stubGlobal('fetch', async () => new Response('ok', { status: 200 }));
    await transcribeAudio(Buffer.alloc(100_000, 1).toString('base64'), 'audio/webm', { productId: P });
    const small = Number((await reservations())[0].reserved_cents);
    await query('DELETE FROM ai_spend_reservations', []);

    await transcribeAudio(Buffer.alloc(3_000_000, 1).toString('base64'), 'audio/webm', { productId: P });
    const large = Number((await reservations())[0].reserved_cents);
    expect(large).toBeGreaterThan(small);
  });

  it('releases on a definitive refusal', async () => {
    vi.stubGlobal('fetch', async () => new Response('nope', { status: 400 }));
    await expect(transcribeAudio(AUDIO, 'audio/webm', { productId: P })).rejects.toThrow(/Whisper API error/);

    const [row] = await reservations();
    expect(row.status, 'a refused request is a definitive non-event').toBe('released');
  });

  it('leaves a lost request ambiguous rather than free', async () => {
    // The provider may or may not have processed it. Ambiguous counts at the
    // full authorized amount when it expires, and is never released as if
    // nothing happened.
    vi.stubGlobal('fetch', async () => { throw new Error('socket hang up'); });
    await expect(transcribeAudio(AUDIO, 'audio/webm', { productId: P })).rejects.toThrow(/socket hang up/);

    const [row] = await reservations();
    expect(row.status).toBe('ambiguous');
    expect(row.actual_cents).toBeNull();
  });

  it('refuses once the ceiling is reached', async () => {
    // The property that was entirely absent: this call could not be stopped by
    // any budget, because no budget knew about it.
    process.env.AI_DAILY_COST_CEILING_CENTS = '1';
    vi.stubGlobal('fetch', async () => new Response('should not happen', { status: 200 }));
    try {
      await transcribeAudio(Buffer.alloc(5_000_000, 1).toString('base64'), 'audio/webm', { productId: P });
      // A tiny cap and a large payload must not both be satisfiable.
      const [row] = await reservations();
      expect(Number(row.reserved_cents)).toBeLessThanOrEqual(1);
    } catch (error) {
      expect(String(error)).toMatch(/ceiling/i);
    } finally {
      delete process.env.AI_DAILY_COST_CEILING_CENTS;
    }
  });

  it('is visible to the effects inventory it used to hide from', () => {
    const inventory = JSON.parse(readFileSync(
      resolve(__dirname, '../../docs/foundry-institution/CONSEQUENTIAL_EFFECTS.json'), 'utf8')) as {
        findings: Array<{ file: string; detector: string; status: string }>;
      };
    const found = inventory.findings.filter((f) => f.file.includes('briefing/voice-reply.ts'));
    expect(found.length, 'the templated POST must be inventoried').toBeGreaterThan(0);
    expect(found[0].detector).toBe('templated_post');
    expect(found[0].status).toBe('control_path');

    // And the detector must still be able to see a templated URL at all.
    const script = readFileSync(
      resolve(__dirname, '../../scripts/audit-consequential-effects.mjs'), 'utf8');
    expect(script).toContain('templated_post');
  });
});
