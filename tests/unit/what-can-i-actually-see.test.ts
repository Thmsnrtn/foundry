process.env.TURSO_DATABASE_URL = 'file::memory:';
process.env.ENCRYPTION_KEY = '0'.repeat(64);
process.env.FOUNDRY_INSTANCE_POSTURE = 'private_owner';
process.env.FOUNDRY_OWNER_EMAIL = 'owner@example.com';

import { beforeAll, afterEach, describe, expect, it, vi } from 'vitest';
import { runMigrations } from '../../src/db/migrate.js';
import { query } from '../../src/db/client.js';
import { checkTheSenses, whatIsNotAnswering } from '../../src/services/institution/sense-check.js';
import { openTheEyesThatAreProven, waysOfLooking } from '../../src/services/venture/research-sources.js';

// =============================================================================
// WHAT CAN I ACTUALLY SEE?
//
// THE DEFECT THIS FIXES SHIPPED, AND IT WAS INVISIBLE. The community source had
// a working adapter and stayed at `declared` forever, because the only line
// that ever promoted it sat inside the branch that runs when one of Foundry's
// own dependencies has gone quiet. None had. So the eye never opened, and
// discovery refused every search with "nothing I can look through tells me what
// people say" — a capability blocked permanently behind an unrelated
// coincidence, in a way no test and no gate could see.
//
// Two rungs of one ladder, and they are not the same thing:
//   AVAILABLE       the instrument answers, in a shape we can use.
//   REALITY_PROVEN  it did real work and the result was checked.
// The second is still earned. The first is a fact about the instrument.
// =============================================================================

const OWNER = 'sense_owner';

function reply(body: unknown): () => Promise<Response> {
  return async () => new Response(JSON.stringify(body), {
    status: 200, headers: { 'content-type': 'application/json' } });
}

const ARCHIVE_ANSWERS = {
  nbHits: 2,
  hits: [
    { objectID: '1', created_at: '2026-05-01T00:00:00Z', comment_text: 'some software talk' },
    { objectID: '2', created_at: '2026-04-01T00:00:00Z', comment_text: 'more software talk' },
  ],
};
const REGISTRY_ANSWERS = {
  total: 2,
  objects: [
    { package: { name: 'a-logger', version: '1.0.0', date: '2026-08-01',
      description: 'a logger', links: { npm: 'https://npm/a' } } },
  ],
};

/** The archive and the registry are different URLs; answer each in kind. */
function bothAnswer(): (url: unknown) => Promise<Response> {
  return async (url: unknown) => {
    const u = String(url);
    const body = u.includes('algolia') ? ARCHIVE_ANSWERS : REGISTRY_ANSWERS;
    return new Response(JSON.stringify(body), {
      status: 200, headers: { 'content-type': 'application/json' } });
  };
}

beforeAll(async () => {
  await runMigrations();
  await query('INSERT INTO founders (id,clerk_user_id,email,name) VALUES (?,?,?,?)',
    [OWNER, 'clerk_sense', 'owner@example.com', 'Owner']);
});

afterEach(() => { vi.restoreAllMocks(); });

describe('the senses Foundry claims to have', () => {
  it('arrives with the community source declared and therefore unlookable', async () => {
    // The shipped state, asserted so the fix has something to be a fix OF.
    const before = await waysOfLooking(OWNER, 'real');
    expect(before.some((w) => w.sourceType === 'community')).toBe(false);
    const hn = (await query(
      "SELECT maturity FROM capability_providers WHERE provider = 'hn_algolia'"))
      .rows[0] as Record<string, unknown>;
    expect(String(hn.maturity)).toBe('declared');
  });

  it('promotes a declared sense that answers, and no further than available', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(bothAnswer() as never);
    const checked = await checkTheSenses();
    const community = checked.find((c) => c.sourceType === 'community');
    expect(community?.answered).toBe(true);
    expect(community?.movedTo).toBe('available');
    // NOT reality-proven. That is earned by doing real work whose result is
    // checked, and answering a dull question is not that.
    const hn = (await query(
      "SELECT maturity FROM capability_providers WHERE provider = 'hn_algolia'"))
      .rows[0] as Record<string, unknown>;
    expect(String(hn.maturity)).toBe('available');
  });

  it('files no market evidence, because the answer is about the instrument', async () => {
    // The probe must never end up quoted somewhere as though somebody had asked
    // a market question. The adapters it calls write nothing, and this is what
    // holds that separation in place.
    const obs = (await query('SELECT COUNT(*) AS n FROM market_observations'))
      .rows[0] as Record<string, unknown>;
    const ret = (await query('SELECT COUNT(*) AS n FROM market_retrievals'))
      .rows[0] as Record<string, unknown>;
    expect(Number(obs.n)).toBe(0);
    expect(Number(ret.n)).toBe(0);
  });

  it('lets the eye open, which is the whole point of the fix', async () => {
    const opened = await openTheEyesThatAreProven(OWNER);
    expect(opened).toContain('hn_algolia');
    const ways = await waysOfLooking(OWNER, 'real');
    expect(ways.some((w) => w.sourceType === 'community')).toBe(true);
  });

  it('degrades a working sense that stops answering', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(async () => {
      throw new Error('connection reset');
    });
    const checked = await checkTheSenses();
    const community = checked.find((c) => c.sourceType === 'community');
    expect(community?.answered).toBe(false);
    expect(community?.movedTo).toBe('degraded');
    expect(await whatIsNotAnswering()).toContain('read what people said');
  });

  it('brings a degraded sense back when it answers again', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(bothAnswer() as never);
    const checked = await checkTheSenses();
    expect(checked.find((c) => c.sourceType === 'community')?.movedTo).toBe('available');
    expect(await whatIsNotAnswering()).toBeNull();
  });

  it('treats an archive that knows nothing at all as not answering', async () => {
    // A 200 with an empty body is the failure mode that looks like success:
    // an archive of public discussion that has never heard of software is not
    // answering about the world it claims to index.
    vi.spyOn(globalThis, 'fetch').mockImplementation(
      reply({ nbHits: 0, hits: [] }) as never);
    const checked = await checkTheSenses();
    expect(checked.find((c) => c.sourceType === 'community')?.answered).toBe(false);
  });

  it('keeps every move on the record with what was witnessed', async () => {
    const moves = (await query(
      `SELECT from_maturity, to_maturity, evidence, witnessed_by
         FROM capability_maturity_changes WHERE witnessed_by = 'sense_check_tick'
        ORDER BY rowid`)).rows as unknown as Array<Record<string, unknown>>;
    expect(moves.length).toBeGreaterThan(1);
    expect(String(moves[0]?.evidence)).toContain('one dull question');
  });
});
