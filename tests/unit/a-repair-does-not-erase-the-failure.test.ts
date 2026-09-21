// =============================================================================
// A REPAIR DOES NOT ERASE THE HISTORY OF THE FAILURE.
//
// The machinery built to say "this test was measured through a broken
// instrument" kept that fact in one column — and cleared the column the
// morning the instrument was mended. So the institution could say what is
// wrong NOW and could not say what was wrong WHILE THE WORLD WAS ASKED, which
// is the only question that decides what a result establishes. It is the
// campaign's own failure, committed by the campaign's own repair.
//
//   a path found broken opens an interval → an unreadable pass neither opens
//   nor closes one → a working reading closes it and does not delete it →
//   what was found is never rewritten → an interval is never deleted → and a
//   settled test can still say which of its days were measured through what.
// =============================================================================

process.env.TURSO_DATABASE_URL = 'file::memory:';
process.env.ENCRYPTION_KEY = '3'.repeat(64);
process.env.FOUNDRY_INSTANCE_POSTURE = 'private_owner';
process.env.FOUNDRY_OWNER_EMAIL = 'owner@example.com';

import { beforeAll, describe, expect, it } from 'vitest';
import { query } from '../../src/db/client.js';
import { OWNER, seedProductionShape } from '../helpers/world.js';

let X = '';
const rowsOf = async (sql: string, p: unknown[] = []) => (await query(sql, p)).rows as unknown as Array<Record<string, unknown>>;
const pathRow = async () => (await rowsOf(
  `SELECT verified_status, broken_since FROM experiment_paths WHERE experiment_id = ? AND kind = 'sending'`, [X]))[0]!;

beforeAll(async () => {
  // THE WORLD AS IT RAN: offers actually sent, so the test has a window. A
  // doubt is about the days a test was asking, and a test that never asked has
  // no days to doubt.
  const seeded = await seedProductionShape({ settledBy: 'the world' });
  X = seeded.experimentId;
});

describe('an interval is opened, kept, and closed rather than deleted', () => {
  it('a path found not working opens one, and a second unreadable pass neither opens nor closes it', async () => {
    const { verifyInstrument, outagesAcross } = await import('../../src/services/venture/the-instrument.js');
    await verifyInstrument(X, { health: { sending: { status: 'needs_attention', detail: 'the provider refused the domain' } } as never });
    const opened = await outagesAcross(X);
    const sending = opened.filter((o) => o.kind === 'sending');
    expect(sending).toHaveLength(1);
    expect(sending[0]).toMatchObject({ brokeDetail: 'the provider refused the domain', mendedAt: null });
    expect((await pathRow()).broken_since).not.toBeNull();

    // A pass that could read nothing: not a repair, and not a second failure.
    await verifyInstrument(X, { health: {} as never });
    expect((await outagesAcross(X)).filter((o) => o.kind === 'sending')).toHaveLength(1);
    expect((await outagesAcross(X)).find((o) => o.kind === 'sending')!.mendedAt).toBeNull();
    expect((await pathRow()).verified_status).toBe('unknown');
    expect((await pathRow()).broken_since, 'an absence of reading is not a repair').not.toBeNull();
  });

  it('a working reading closes the interval and the interval survives the repair', async () => {
    const { verifyInstrument, outagesAcross } = await import('../../src/services/venture/the-instrument.js');
    await verifyInstrument(X, { health: { sending: { status: 'healthy', detail: 'the provider has accepted mail from it' } } as never });
    // The CURRENT reading says nothing is wrong, which is true...
    expect(await pathRow()).toMatchObject({ verified_status: 'working', broken_since: null });
    // ...and the record still says what was wrong, and for how long.
    const closed = (await outagesAcross(X)).filter((o) => o.kind === 'sending');
    expect(closed, 'the interval was closed, not deleted').toHaveLength(1);
    expect(closed[0].brokeDetail).toBe('the provider refused the domain');
    expect(closed[0].mendedAt).not.toBeNull();
    expect(closed[0].name, 'the owner reads a path by its name, not its key').not.toBe('sending');
  });

  it('a path that breaks again opens a second interval rather than reopening the first', async () => {
    const { verifyInstrument, outagesAcross } = await import('../../src/services/venture/the-instrument.js');
    await verifyInstrument(X, { health: { sending: { status: 'needs_attention', detail: 'the domain fell out of authentication' } } as never });
    const all = (await outagesAcross(X)).filter((o) => o.kind === 'sending');
    expect(all).toHaveLength(2);
    expect(all[0].mendedAt, 'the first is still closed').not.toBeNull();
    expect(all[1]).toMatchObject({ brokeDetail: 'the domain fell out of authentication', mendedAt: null });
    expect(all[0].brokeAt <= all[1].brokeAt, 'oldest first').toBe(true);
  });
});

describe('the record refuses to be improved', () => {
  it('what was found is never rewritten, a mending is never un-said, and nothing is ever deleted', async () => {
    const one = (await rowsOf(`SELECT id, broke_at FROM experiment_path_outages ORDER BY rowid LIMIT 1`))[0]!;
    await expect(query(`UPDATE experiment_path_outages SET broke_detail = 'it was fine really' WHERE id = ?`, [String(one.id)]))
      .rejects.toThrow(/path_outage:immutable/);
    await expect(query(`UPDATE experiment_path_outages SET broke_at = datetime('now') WHERE id = ?`, [String(one.id)]))
      .rejects.toThrow(/path_outage:immutable/);
    await expect(query(`UPDATE experiment_path_outages SET mended_at = NULL WHERE id = ?`, [String(one.id)]))
      .rejects.toThrow(/path_outage:mending_is_kept/);
    await expect(query(`DELETE FROM experiment_path_outages WHERE id = ?`, [String(one.id)]))
      .rejects.toThrow(/path_outage:never_deleted/);
  });

  it('an interval cannot be mended before it broke, and cannot be opened without saying what was wrong', async () => {
    await expect(query(
      `INSERT INTO experiment_path_outages (id, experiment_id, founder_id, kind, broke_at, broke_detail, mended_at)
       VALUES (?,?,?,?,?,?,?)`,
      ['epo_backwards', X, OWNER, 'sending', '2026-09-10T00:00:00.000Z', 'x', '2026-09-01T00:00:00.000Z']))
      .rejects.toThrow(/path_outage:mended_before_broken/);
    await expect(query(
      `INSERT INTO experiment_path_outages (id, experiment_id, founder_id, kind, broke_at, broke_detail)
       VALUES (?,?,?,?,?,?)`,
      ['epo_unsaid', X, OWNER, 'sending', '2026-09-10T00:00:00.000Z', '  ']))
      .rejects.toThrow(/path_outage:unsaid/);
  });
});

describe('and the owner reads it on the record, after the repair', () => {
  it('the experiment page names the path, the interval and what was wrong', async () => {
    const { asText, owner, ownerApp } = await import('../helpers/world.js');
    const me = owner(await ownerApp());
    const page = asText(await me.page(`/foundry/experiments/${X}`));
    expect(page).toContain('What was not working while it ran');
    expect(page).toContain('the provider refused the domain');
    // The closed one reads as an interval with two ends; the open one says so.
    expect(page).toMatch(/from \d{4}-\d{2}-\d{2} to \d{4}-\d{2}-\d{2}/);
    expect(page).toContain('and still is');
    expect(page).toContain('the domain fell out of authentication');
  });
});

describe('and a kept interval is what lets the result be qualified at all', () => {
  it('a path no day record covers raises a doubt from its interval, and the repair does not take it away', async () => {
    const { doubtsAboutTheInstrument } = await import('../../src/services/venture/the-instrument.js');
    // THE WAY TO PAY IS NOT A CHANNEL OF THE WORKSHOP, so `public_channel_days`
    // never watched it and the day-by-day reader cannot see it. Its only
    // record is the interval — which is why the interval had to stop being
    // erased before this question could be asked at all.
    const broke = new Date(Date.now() - 4 * 86_400_000).toISOString();
    const mended = new Date(Date.now() - 2 * 86_400_000).toISOString();
    await query(
      `INSERT INTO experiment_path_outages (id, experiment_id, founder_id, kind, broke_at, broke_detail, mended_at, mended_detail)
       VALUES (?,?,?,?,?,?,?,?)`,
      ['epo_pay', X, OWNER, 'payment', broke, 'the provider had deactivated the link', mended, 'the link answers again']);
    const doubts = await doubtsAboutTheInstrument(X);
    const pay = doubts.find((d) => d.sentence.includes('the provider had deactivated the link'));
    expect(pay, 'a way to pay that was down during the window qualifies the result').toBeTruthy();
    expect(pay!.sentence).toContain('was not working from');
    expect(pay!.doesNotEstablish).toContain('not there to be done');
  });

  it('an interval that closed before the test began raises nothing', async () => {
    const { doubtsAboutTheInstrument } = await import('../../src/services/venture/the-instrument.js');
    await query(
      `INSERT INTO experiment_path_outages (id, experiment_id, founder_id, kind, broke_at, broke_detail, mended_at, mended_detail)
       VALUES (?,?,?,?,?,?,?,?)`,
      ['epo_ancient', X, OWNER, 'refund', '2020-01-01T00:00:00.000Z', 'long ago and far away',
        '2020-01-05T00:00:00.000Z', 'mended long before this test existed']);
    const doubts = await doubtsAboutTheInstrument(X);
    expect(doubts.some((d) => d.sentence.includes('long ago and far away')),
      'a fault that ended before the question was asked says nothing about the answer').toBe(false);
  });
});
