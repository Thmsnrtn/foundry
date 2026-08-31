process.env.TURSO_DATABASE_URL = 'file::memory:';
process.env.ENCRYPTION_KEY = '0'.repeat(64);

import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { Hono } from 'hono';
import { nanoid } from 'nanoid';
import { runMigrations } from '../../src/db/migrate.js';
import { query } from '../../src/db/client.js';

// =============================================================================
// WHO MOVED THIS NUMBER.
//
// `okr_progress_updates` records every change to a key result — from what, to
// what, by whom, and why. Nothing read it. The OKR page showed a current value
// and a progress bar, so "78%" was a fact with no history and no author.
//
// TWO OKR SERVICES, AND THE ONE WITH THE RULES IS THE ONE NOTHING CAN CALL.
// `src/services/scp/okr.ts` held the doctrine — status mapping, progress
// recalculation, archiving — and nothing imported it. It sat on the
// unreachable-modules baseline. The OKR feature people use is
// `routes/dashboard/agents-okr.ts`, which derives progress in SQL.
//
// The consequence was concrete. `company_okrs.progress_pct` is a stored column
// whose ONLY writer was `updateKeyResult` in that unreachable module — and that
// function had no caller either. The column was never written after insert, so
// `getOKRProgress` returned zero progress for every objective of every company,
// forever, while the page showed the real derived number. Two answers to one
// question, and the stored one was permanently wrong.
//
// The module goes, the column goes with it, and the page gains the history.
//
// One consequence stated rather than hidden: `source` admits 'agent_session',
// and the only code that would have written it was in the retired module. Every
// row today says 'founder_manual'. The distinction is still rendered — if an
// agent path comes back, the founder sees it the day it arrives, not the day
// somebody remembers to add a label.
// =============================================================================

const PAGE = readFileSync('src/routes/dashboard/agents-okr.ts', 'utf8');

beforeAll(async () => {
  await runMigrations();
  await query("INSERT INTO founders (id, clerk_user_id, email) VALUES ('f_ok','c_ok','o@example.com')");
  await query("INSERT INTO products (id, name, owner_id, status) VALUES ('p_ok','Acme','f_ok','active')");
});
beforeEach(async () => {
  await query('DELETE FROM okr_progress_updates');
  await query('DELETE FROM key_results');
  await query('DELETE FROM company_okrs');
});

async function okrWithKr(): Promise<string> {
  await query(
    `INSERT INTO company_okrs (id, product_id, period, objective_text, objective_owner, status)
     VALUES ('o1','p_ok','2026-Q3','Reach 100 paying teams','founder','on_track')`);
  const krId = nanoid();
  await query(
    `INSERT INTO key_results
       (id, okr_id, description, metric_name, start_value, target_value, current_value, unit, owner_agent)
     VALUES (?, 'o1', 'Paying teams', 'paying_teams', 20, 100, 55, 'teams', 'founder')`, [krId]);
  return krId;
}

async function update(krId: string, prev: number, next: number, source: string, note: string | null, at: string) {
  await query(
    `INSERT INTO okr_progress_updates
       (id, key_result_id, previous_value, new_value, source, note, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [nanoid(), krId, prev, next, source, note, at]);
}

async function render(): Promise<string> {
  const { agentsOkr } = await import('../../src/routes/dashboard/agents-okr.js');
  const app = new Hono();
  app.use('*', async (c, next) => { c.set('founder', { id: 'f_ok' }); await next(); });
  app.route('/', agentsOkr);
  const res = await app.request('/agents/okr');
  return await res.text();
}

describe('the page says who moved the number', () => {
  it('names the change, the author and the note', async () => {
    const krId = await okrWithKr();
    await update(krId, 20, 55, 'founder_manual', 'signed two enterprise deals', '2026-08-12 09:00:00');

    const body = await render();
    expect(body).toContain('2026-08-12');
    expect(body).toContain('20');
    expect(body).toContain('55');
    expect(body).toContain('by you');
    expect(body).toContain('signed two enterprise deals');
  });

  it('tells a founder change from an agent change', async () => {
    const krId = await okrWithKr();
    await update(krId, 20, 40, 'agent_session', null, '2026-08-10 09:00:00');

    const body = await render();
    expect(body, 'the distinction is the whole reason the column exists')
      .toContain('by an agent');
  });

  it('says the value has never moved rather than showing nothing', async () => {
    await okrWithKr();
    const body = await render();
    expect(body).toContain('has not been changed since the key result was created');
  });

  it('caps the list and says how many more there are', async () => {
    const krId = await okrWithKr();
    for (let i = 0; i < 8; i++) {
      await update(krId, 20 + i, 21 + i, 'founder_manual', null, `2026-08-0${i + 1} 09:00:00`);
    }
    const body = await render();
    expect(body).toMatch(/and 3 earlier changes/);
  });
});

describe('an objective can be created at all', () => {
  async function post(form: Record<string, string>): Promise<Response> {
    const { agentsOkr } = await import('../../src/routes/dashboard/agents-okr.js');
    const app = new Hono();
    app.use('*', async (c, next) => { c.set('founder', { id: 'f_ok' }); await next(); });
    app.route('/', agentsOkr);
    return await app.request('/agents/okr/create', {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams(form).toString(),
    });
  }

  it('creates the objective and its key results', async () => {
    await post({
      objective: 'Reach 100 paying teams', period: '2026-Q4',
      kr_description_0: 'Paying teams', kr_start_0: '20', kr_target_0: '100', kr_unit_0: 'teams',
    });

    const okr = (await query(
      "SELECT * FROM company_okrs WHERE product_id='p_ok'")).rows[0] as Record<string, unknown>;
    expect(okr.objective_text).toBe('Reach 100 paying teams');
    expect(okr.period).toBe('2026-Q4');

    const kr = (await query(
      'SELECT * FROM key_results WHERE okr_id = ?', [String(okr.id)])).rows[0] as Record<string, unknown>;
    expect(Number(kr.start_value)).toBe(20);
    expect(Number(kr.target_value)).toBe(100);
    expect(Number(kr.current_value), 'a new key result starts where it starts').toBe(20);
    expect(kr.owner_agent,
      "the column means 'agent name, or NULL for founder-owned'").toBeNull();
  });

  it('refuses an objective with nothing to measure', async () => {
    await post({ objective: 'Be excellent', period: '2026-Q4' });
    expect((await query("SELECT id FROM company_okrs WHERE product_id='p_ok'")).rows.length,
      'an objective with no key result is a wish').toBe(0);
  });

  it('drops a key result with no target rather than storing a zero one', async () => {
    await post({
      objective: 'Reach 100 paying teams', period: '2026-Q4',
      kr_description_0: 'Paying teams', kr_start_0: '20', kr_target_0: '100',
      kr_description_1: 'Something with no target', kr_start_1: '3',
    });
    const okr = (await query("SELECT id FROM company_okrs WHERE product_id='p_ok'"))
      .rows[0] as Record<string, unknown>;
    const krs = (await query('SELECT * FROM key_results WHERE okr_id = ?', [String(okr.id)])).rows;
    expect(krs.length, 'a target of 0 is met the moment it is set').toBe(1);
  });

  it('does not let a non-owner set what the company is aiming at', async () => {
    const { agentsOkr } = await import('../../src/routes/dashboard/agents-okr.js');
    const app = new Hono();
    app.use('*', async (c, next) => { c.set('founder', { id: 'f_stranger' }); await next(); });
    app.route('/', agentsOkr);
    const res = await app.request('/agents/okr/create', {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        objective: 'Sneak', period: '2026-Q4',
        kr_description_0: 'x', kr_start_0: '0', kr_target_0: '1',
      }).toString(),
    });
    expect(res.status).not.toBe(302);
    expect((await query("SELECT id FROM company_okrs WHERE product_id='p_ok'")).rows.length).toBe(0);
  });
});

describe('one answer to "how far along is this"', () => {
  it('the unreachable service is gone', () => {
    expect(existsSync('src/services/scp/okr.ts')).toBe(false);
    expect(readFileSync('docs/db/unreachable-modules-baseline.txt', 'utf8'))
      .not.toMatch(/scp\/okr\.ts/);
  });

  it('the stored copy of a derived number is gone', async () => {
    const cols = ((await query('PRAGMA table_info(company_okrs)')).rows as unknown as
      Array<Record<string, unknown>>).map((c) => String(c.name));
    expect(cols, 'its only writer was in the unreachable module, so it read 0 forever')
      .not.toContain('progress_pct');
  });

  it('progress is still derived where it is shown', () => {
    expect(PAGE).toMatch(/\(kr\.current_value - kr\.start_value\) \* 100\.0 \/ \(kr\.target_value - kr\.start_value\)/);
  });
});

describe('the history is read in one query, not one per row', () => {
  it('joins through to the product rather than looping', () => {
    expect(PAGE).toMatch(/FROM okr_progress_updates u\s*\n\s*JOIN key_results kr ON kr\.id = u\.key_result_id\s*\n\s*JOIN company_okrs co ON co\.id = kr\.okr_id/);
  });

  it('and the table has left the unread baseline', () => {
    expect(readFileSync('docs/db/unread-tables-baseline.txt', 'utf8'))
      .not.toMatch(/okr_progress_updates/);
  });
});
