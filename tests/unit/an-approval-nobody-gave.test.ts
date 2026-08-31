process.env.TURSO_DATABASE_URL = 'file::memory:';
process.env.ENCRYPTION_KEY = '0'.repeat(64);

import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { stripComments } from '../../scripts/lib/strip-comments.mjs';
import { runMigrations } from '../../src/db/migrate.js';
import { query } from '../../src/db/client.js';
import { proposeAction } from '../../src/services/outbound/executor.js';
import { detectBehavioralSignals } from '../../src/services/scp/founder/decision-quality.js';

// =============================================================================
// AN APPROVAL NOBODY GAVE.
//
// `proposeAction` stamped `approved_by = 'auto'` and `approved_at` ONE HOUR IN
// THE FUTURE the moment an authority-level-1 action was proposed — while
// `status` stayed 'pending_approval' and no scheduler existed to execute it.
// Three untruths in four lines: an approval that had not happened, a timestamp
// for a moment that had not arrived, and a window nothing was counting down.
// The dashboard said the same thing in words, badging every level-1 action
// "1-hour window".
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
  // Harbor has to actually HOLD level 1 for a level-1 proposal to stay one.
  // `proposeAction` binds a proposed level to the founder-set level on
  // `agent_instances` and takes the stricter, because the level in a proposal
  // came from a language model and the one here came from the founder. With no
  // row at all there is no grant to bind to, and an ungranted proposal is
  // raised to 2 — so without this the two actions below would both be level 2
  // and the distinction under test would vanish for the wrong reason. 1 is
  // harbor's own default in DEFAULT_AUTHORITY_LEVELS.
  await query(
    `INSERT INTO agent_instances (id, product_id, agent_name, display_name, status, authority_level)
     VALUES ('ai_ap_harbor', ?, 'harbor', 'Harbor', 'active', 1)`, [P]);
});
beforeEach(async () => {
  await query('DELETE FROM outbound_actions');
  await query('DELETE FROM outbound_rate_limits');
  await query('DELETE FROM action_executions');
});

async function proposeLevelOne(): Promise<string> {
  const { action_id } = await proposeAction({
    productId: P,
    agentName: 'harbor',
    integrationName: 'harbor',
    actionType: 'send_note',
    authorityLevel: 1,
    parameters: { note: 'hello' },
    rationale: 'because',
    previewText: 'a note',
  });
  return action_id;
}

describe('an action that is waiting for a person', () => {
  it('records no approver', async () => {
    const id = await proposeLevelOne();
    const row = (await query('SELECT status, approved_by, approved_at FROM outbound_actions WHERE id = ?', [id]))
      .rows[0] as unknown as { status: string; approved_by: string | null; approved_at: string | null };

    expect(row.status).toBe('pending_approval');
    expect(row.approved_by).toBeNull();
    expect(row.approved_at).toBeNull();
  });

  it('is not distinguishable from a level-2 action by anything but its level', async () => {
    const one = await proposeLevelOne();
    const { action_id: two } = await proposeAction({
      productId: P, agentName: 'harbor', integrationName: 'harbor', actionType: 'send_note2',
      authorityLevel: 2, parameters: {}, rationale: 'because', previewText: 'a note',
    });

    const rows = await query(
      'SELECT authority_level, status, approved_by FROM outbound_actions WHERE id IN (?, ?) ORDER BY authority_level',
      [one, two]);
    const [a, b] = rows.rows as unknown as Array<{ authority_level: number; status: string; approved_by: string | null }>;
    expect(a.status).toBe(b.status);
    expect(a.approved_by).toBe(b.approved_by);
    expect(a.authority_level).not.toBe(b.authority_level);
  });
});

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

  it('is still rendered for the rows that already carry it, without claiming a window', async () => {
    const { __approverTextForTest } = await import('../../src/routes/dashboard/agents-integrations.js');
    const text = __approverTextForTest('auto', 'f_ap');
    expect(text).not.toContain('notice window');
    expect(text).toContain('no approver recorded');
  });
});

describe('what a machine approved', () => {
  it('is not counted as the founder approving without reading', async () => {
    // An autopilot sweep approves within milliseconds of proposing, by
    // construction. Before this, switching autopilot on produced evidence that
    // the founder was rubber-stamping decisions they had never seen.
    for (const n of [1, 2, 3, 4]) {
      await query(
        `INSERT INTO action_executions (id, product_id, integration, action_type, status, approved_by, created_at, approved_at)
         VALUES (?, ?, 'resend', 'send_email', 'approved', 'autopilot:growth', datetime('now'), datetime('now'))`,
        [`ae_auto_${n}`, P]);
    }

    const signals = await detectBehavioralSignals(P);
    expect(signals.find((s) => s.signal_type === 'approval_without_reading')).toBeUndefined();
  });

  it('while a person doing it in three seconds still is', async () => {
    for (const n of [1, 2, 3]) {
      await query(
        `INSERT INTO action_executions (id, product_id, integration, action_type, status, approved_by, created_at, approved_at)
         VALUES (?, ?, 'resend', 'send_email', 'approved', 'founder:f_ap', datetime('now','-3 seconds'), datetime('now'))`,
        [`ae_person_${n}`, P]);
    }

    const signals = await detectBehavioralSignals(P);
    expect(signals.find((s) => s.signal_type === 'approval_without_reading')).toBeDefined();
  });
});

describe('the badge a founder reads', () => {
  it('does not promise a window that nothing counts', () => {
    const src = stripComments(readFileSync('src/routes/dashboard/agents-integrations.ts', 'utf8'),
      { lineComments: true });
    expect(src).not.toContain('1-hour window');
  });
});
