process.env.TURSO_DATABASE_URL = 'file::memory:';
process.env.ENCRYPTION_KEY = '0'.repeat(64);

import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { stripComments } from '../../scripts/lib/strip-comments.mjs';
import { runMigrations } from '../../src/db/migrate.js';
import { query } from '../../src/db/client.js';

// =============================================================================
// AN APPROVAL NOBODY GAVE.
//
// `proposeAction` stamped `approved_by = 'auto'` and `approved_at` ONE HOUR IN
// THE FUTURE the moment an authority-level-1 action was proposed — while
// `status` stayed 'pending_approval' and no scheduler existed to execute it.
// Three untruths in four lines: an approval that had not happened, a timestamp
// for a moment that had not arrived, and a window nothing was counting down.
// The founder-facing page said the same thing in words, badging every level-1
// action "1-hour window". That page was part of the Commercial Foundry surface
// and has been removed; the writer that made the claim true-looking is what is
// held here, because it is the writer every other reader inherits from.
//
// `auto` has one meaning here — see `acting-principal.ts`: an action that
// reached its notice window without anybody objecting. Nothing tells a founder
// a level-1 action is pending, and nothing counts an hour. The email executor
// used the same value as its default for a level-0 action nobody was ever asked
// about, which is a standing authority rather than silence after a notice.
//
// Whether Foundry may send on a silent timer is with the owner
// (OWNER_DECISIONS_PENDING §14). It does not come back as a timestamp written
// in advance.
// =============================================================================

const P = 'p_appr';

beforeAll(async () => {
  await runMigrations();
  await query("INSERT INTO founders (id, clerk_user_id, email) VALUES ('f_ap','c_ap','ap@example.com')");
  await query("INSERT INTO products (id, name, owner_id, status) VALUES (?,'Acme','f_ap','active')", [P]);
});
beforeEach(async () => {
  await query('DELETE FROM outbound_actions');
  await query('DELETE FROM action_executions');
});

// `proposeAction` wrote these rows until `outbound/executor.ts` was deleted in
// Roadmap 2027 R9. The database guards below are what remain, so the row is
// written here in the shape it wrote: level 1, waiting for a person.
let seq = 0;
async function proposeLevelOne(): Promise<string> {
  const id = `oa_ap_${++seq}`;
  await query(
    `INSERT INTO outbound_actions (id, product_id, agent_name, integration_name, action_type,
       authority_level, status, parameters_json, rationale, preview_text)
     VALUES (?, ?, 'harbor', 'harbor', 'send_note', 1, 'pending_approval', '{"note":"hello"}', 'because', 'a note')`,
    [id, P]);
  return id;
}

describe('the database', () => {
  it('refuses an approval dated in the future', async () => {
    const id = await proposeLevelOne();
    const anHourOut = new Date(Date.now() + 60 * 60 * 1000).toISOString();

    await expect(
      query('UPDATE outbound_actions SET approved_by = ?, approved_at = ? WHERE id = ?',
        ['founder:f_ap', anHourOut, id]),
    ).rejects.toThrow(/approved_in_the_future/);
  });

  it('refuses one written that way at birth', async () => {
    const anHourOut = new Date(Date.now() + 60 * 60 * 1000).toISOString();
    await expect(
      query(
        `INSERT INTO outbound_actions (id, product_id, agent_name, integration_name, action_type,
           authority_level, status, parameters_json, rationale, approved_by, approved_at)
         VALUES ('oa_future', ?, 'harbor', 'harbor', 'send_note', 1, 'pending_approval', '{}', 'r', 'auto', ?)`,
        [P, anHourOut]),
    ).rejects.toThrow(/approved_in_the_future/);
  });

  it('still accepts an approval that has actually happened', async () => {
    const id = await proposeLevelOne();
    await query('UPDATE outbound_actions SET approved_by = ?, approved_at = datetime(\'now\') WHERE id = ?',
      ['founder:f_ap', id]);

    const row = (await query('SELECT approved_by FROM outbound_actions WHERE id = ?', [id]))
      .rows[0] as unknown as { approved_by: string };
    expect(row.approved_by).toBe('founder:f_ap');
  });
});

describe('the word `auto`', () => {
  it('is read but never written', () => {
    const files: string[] = [];
    const walk = (d: string): void => {
      for (const e of readdirSync(d, { withFileTypes: true })) {
        const p = join(d, e.name);
        if (e.isDirectory()) walk(p);
        else if (p.endsWith('.ts')) files.push(p);
      }
    };
    walk('src');
    // Comments stripped: this defect is explained in prose in four files, and a
    // scanner that reads its own explanation finds the thing it forbids.
    const writers = files.filter((f) => {
      const src = stripComments(readFileSync(f, 'utf8'), { lineComments: true });
      return /approved_by\s*=\s*'auto'|approved_by,\s*'auto'|COALESCE\(approved_by,\s*'auto'\)/.test(src);
    });
    expect(writers).toEqual([]);
  });
});
