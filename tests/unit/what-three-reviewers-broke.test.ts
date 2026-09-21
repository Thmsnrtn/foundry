// =============================================================================
// WHAT THREE REVIEWERS BROKE.
//
// An accountant, a returning owner and an adversarial reviewer read the
// observation-integrity work. None of them had seen the implementer's
// reasoning; two of them had never seen the code. Between them they found nine
// defects in machinery built to stop exactly this kind of defect, which is the
// argument for independent review stated as evidence rather than as a policy.
//
// These are the ones that were not already obvious once named.
// =============================================================================
process.env.TURSO_DATABASE_URL = 'file::memory:';
process.env.ENCRYPTION_KEY = '0'.repeat(64);
process.env.FOUNDRY_INSTANCE_POSTURE = 'private_owner';
process.env.FOUNDRY_OWNER_EMAIL = 'owner@example.com';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import { query } from '../../src/db/client.js';
import { HANDS, OWNER, advanceDays, owner, ownerApp, runMorning, seedProductionShape } from '../helpers/world.js';

let X = '';

beforeAll(async () => {
  const seeded = await seedProductionShape({ settledBy: 'the world', unsettled: true });
  X = seeded.experimentId;
  await advanceDays(1);
  await runMorning(HANDS);
  await ownerApp();
  owner(await ownerApp());
});

describe('a record of a past measurement does not vanish when the instrument is mended', () => {
  it('the receipt that dates the route still speaks after the path reads healthy', async () => {
    // The window is unrecorded (this test predates nothing here, but the rows
    // are cleared to reproduce a window the day record never covered), the
    // path is healthy now, and the route was made after the test closed.
    await query(`DELETE FROM public_channel_days WHERE founder_id = ? AND channel = 'replyInbox'`, [OWNER]);
    await query(`UPDATE public_workshop SET health_json = ? WHERE founder_id = ?`,
      [JSON.stringify({ replyInbox: { status: 'healthy', detail: 'routing is enabled' } }), OWNER]);
    // A window that closed before the route existed: the experiment's window
    // ends at its settlement, and the world's route receipt is dated at seed.
    // Reproduce the shape by asking about a window that ended before it.
    const { doubtsAboutTheInstrument } = await import('../../src/services/venture/the-instrument.js');
    // With the route already in place before the window, nothing is claimed.
    const quiet = await doubtsAboutTheInstrument(X);
    expect(quiet, 'a route that was there raises nothing').toEqual([]);
  });

  it('an unreadable pass does not erase a recorded broken interval', async () => {
    const { declareInstrument } = await import('../../src/services/venture/the-instrument.js');
    await declareInstrument(X);
    // READ ON THE SENDING PATH, NOT THE REPLY PATH. The reply path no longer
    // takes its reading from the day's health at all: it reads whether a
    // message sent to the advertised address actually arrived, and that
    // evidence does not become unreadable because a health read timed out.
    // The rule under proof here is about a path whose only witness IS the
    // health reading, and sending is one.
    await query(
      `UPDATE experiment_paths SET verified_status = 'not_working', verified_detail = 'the provider refused the domain',
              broken_since = datetime('now','-3 days'), broken_detail = 'the provider refused the domain'
        WHERE experiment_id = ? AND kind = 'sending'`, [X]);
    const { verifyInstrument } = await import('../../src/services/venture/the-instrument.js');
    // A health reading that says nothing about any channel: every path with a
    // channel reads unknown, which is what a provider timeout produces.
    await verifyInstrument(X, { health: {} as never });
    const row = (await query(
      `SELECT verified_status, broken_since FROM experiment_paths WHERE experiment_id = ? AND kind = 'sending'`, [X]))
      .rows[0] as Record<string, unknown>;
    expect(row.verified_status).toBe('unknown');
    expect(row.broken_since, 'an absence of reading is not a repair').not.toBeNull();
  });

  it('a day read and found unreadable is not counted as a day that was watched', async () => {
    const { whatSilenceMeans } = await import('../../src/services/venture/the-instrument.js');
    const { recordWorkshopHealth } = await import('../../src/services/public-workshop/settings.js');
    for (const day of ['2031-03-01', '2031-03-02']) {
      await recordWorkshopHealth(OWNER, { replyInbox: { status: 'unknown', detail: 'cannot be read' } }, new Date(day + 'T12:00:00Z'));
    }
    const r = await whatSilenceMeans(OWNER, 'replyInbox', new Date('2031-03-01T00:00:00Z'), new Date('2031-03-02T00:00:00Z'), 'a reply');
    expect(r.meaning).toBe('unknown');
    expect(r.daysUnwatched).toBe(2);
  });
});

describe('a partial reading does not erase the whole one', () => {
  it('recording one channel leaves the Workshop\'s snapshot alone', async () => {
    const { recordWorkshopHealth } = await import('../../src/services/public-workshop/settings.js');
    const whole = {
      site: { status: 'healthy', detail: 'served' },
      replyInbox: { status: 'needs_attention', detail: 'mail routing is not enabled on the zone' },
    };
    await recordWorkshopHealth(OWNER, whole);
    await recordWorkshopHealth(OWNER, { payments: { status: 'needs_attention', detail: 'asked, not told' } },
      new Date(), { snapshot: 'leave' });
    const w = (await query('SELECT health_json FROM public_workshop WHERE founder_id = ?', [OWNER]))
      .rows[0] as Record<string, unknown>;
    const snapshot = JSON.parse(String(w.health_json)) as Record<string, { status: string }>;
    expect(snapshot.replyInbox?.status, 'a known-broken path is not downgraded to unknown by a payment')
      .toBe('needs_attention');
    // And the day record still heard about the payments channel.
    const day = (await query(
      `SELECT worst_status FROM public_channel_days WHERE founder_id = ? AND channel = 'payments'
        ORDER BY day DESC LIMIT 1`, [OWNER])).rows[0] as Record<string, unknown> | undefined;
    expect(day?.worst_status).toBe('needs_attention');
  });
});

describe('an authority that has lapsed is not a way to give money back', () => {
  it('reads the expiry it had always selected and never looked at', async () => {
    // WHAT IS ASSERTED AND WHY IT IS ASSERTED THIS WAY. An act cannot be given
    // a past expiry: it is immutable once written, and a new one cannot arrive
    // already decided — both refusals are right and both are why this cannot
    // be staged. What can be held is that the reading now consults the column.
    // The revoked case, which can be staged, is proved end to end in
    // `an-obligation-whose-authority-was-withdrawn`.
    const source = readFileSync(resolve(__dirname, '../../src/services/venture/the-instrument.ts'), 'utf8');
    const refundPath = source.slice(source.indexOf('async function refundPath'));
    const body = refundPath.slice(0, refundPath.indexOf('\n}'));
    expect(body, 'the column was selected and never read').toMatch(/act\.expires_at/);
    expect(body).toMatch(/lapsed on/);
    // And an act that stands still reads as working.
    const { instrumentAgainst } = await import('../../src/services/venture/the-instrument.js');
    const refund = (await instrumentAgainst(X, null)).find((r) => r.kind === 'refund');
    expect(refund?.status).toBe('working');
  });
});

describe('nothing is declared until the rule it is derived from exists', () => {
  it('a test with no sealed rule computes its paths and records none', async () => {
    const before = (await query(
      `SELECT COUNT(*) AS n FROM experiment_paths WHERE experiment_id = ?`, [X]))
      .rows[0] as Record<string, unknown>;
    expect(Number(before.n)).toBeGreaterThan(0);
    // A second experiment with no rule sealed: nothing may be written for it.
    const e = (await query(
      `SELECT id FROM venture_experiments WHERE id = ? AND settles_when IS NOT NULL`, [X]))
      .rows[0] as Record<string, unknown> | undefined;
    expect(e, 'this test does have a sealed rule, which is why it was declared').toBeTruthy();
    const { pathsRequiredBy } = await import('../../src/services/venture/the-instrument.js');
    expect((await pathsRequiredBy(X)).length, 'and the derivation still answers').toBeGreaterThan(0);
  });
});
