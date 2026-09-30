// =============================================================================
// FOUNDRY — what the owner does to a Mission.
//
// Three acts, each a row that is never edited (migration 371):
//   - state a Mission no engine carries yet (a Build, a portfolio goal);
//   - put limits on any Mission — budget, end date, what counts as success,
//     what stops it, how loudly it may interrupt — superseding the last;
//   - pause, resume, stop, conclude or archive one he stated.
//
// NONE OF IT GRANTS ANYTHING. A limit here is a tripwire Foundry watches and
// brings to him (services/mission/read.ts derives the status that says so);
// what Foundry may actually do is still decided by the charter, allowances,
// boundaries and consents, which nothing in this file reads or writes.
// Every act checks the Mission is his before it writes; a caller cannot name
// someone else's work and have it recorded.
// =============================================================================

import { nanoid } from 'nanoid';
import { batch, query } from '../../db/client.js';
import type { MissionMode, MissionRealm } from './read.js';

type Row = Record<string, unknown>;

export class MissionRefused extends Error {}

const MODES: ReadonlySet<string> = new Set(['explore', 'validate', 'build', 'operate', 'optimize', 'monitor']);
const REALMS: ReadonlySet<string> = new Set(['real', 'paper', 'simulation']);
const INTERRUPTS: ReadonlySet<string> = new Set(['silent', 'today', 'needs_you', 'urgent']);
export type InterruptAt = 'silent' | 'today' | 'needs_you' | 'urgent';

export interface Terms {
  budgetCents: number | null;
  until: string | null;
  success: string | null;
  stopWhen: string | null;
  interruptAt: InterruptAt;
}

/** Whether a Mission key names work that is his. Unknown shapes are not. */
export async function isHis(founderId: string, key: string): Promise<boolean> {
  const at = key.indexOf(':');
  if (at < 1) return false;
  const [kind, id] = [key.slice(0, at), key.slice(at + 1)];
  const table: Record<string, string> = {
    mission: 'SELECT 1 FROM missions WHERE id = ? AND founder_id = ?',
    mandate: 'SELECT 1 FROM venture_mandates WHERE id = ? AND founder_id = ?',
    experiment: 'SELECT 1 FROM venture_experiments WHERE id = ? AND founder_id = ?',
    undertaking: 'SELECT 1 FROM undertakings WHERE id = ? AND founder_id = ?',
    thesis: 'SELECT 1 FROM capital_research_theses WHERE id = ? AND founder_id = ?',
  };
  const sql = table[kind];
  if (!sql || !id) return false;
  return (await query(sql, [id, founderId])).rows.length > 0;
}

/** Read and check one set of terms as the owner typed them. Throws with his words' problem, never a code. */
export function readTerms(input: { budget?: string; until?: string; success?: string; stopWhen?: string; interruptAt?: string }): Terms {
  const budgetRaw = String(input.budget ?? '').trim().replace(/^\$/, '').replace(/,/g, '');
  let budgetCents: number | null = null;
  if (budgetRaw) {
    const n = Number(budgetRaw);
    if (!Number.isFinite(n) || n < 0 || n > 1_000_000) throw new MissionRefused('The budget has to be an amount in dollars, like 50 or 49.99.');
    budgetCents = Math.round(n * 100);
  }
  const untilRaw = String(input.until ?? '').trim();
  let until: string | null = null;
  if (untilRaw) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(untilRaw) || Number.isNaN(Date.parse(untilRaw))) throw new MissionRefused('The end date has to be a date, like 2026-12-31.');
    until = untilRaw;
  }
  const interruptAt = String(input.interruptAt || 'needs_you');
  if (!INTERRUPTS.has(interruptAt)) throw new MissionRefused('That is not a way I know to reach you.');
  const text = (v: unknown): string | null => { const s = String(v ?? '').trim().slice(0, 300); return s || null; };
  return { budgetCents, until, success: text(input.success), stopWhen: text(input.stopWhen), interruptAt: interruptAt as InterruptAt };
}

/** Put limits on a Mission of his. The previous terms are superseded, never edited. */
export async function setTerms(founderId: string, key: string, terms: Terms): Promise<string> {
  if (!await isHis(founderId, key)) throw new MissionRefused('That is not one of your Missions.');
  const id = `mt_${nanoid(12)}`;
  const live = (await query(
    `SELECT id FROM mission_terms WHERE founder_id = ? AND mission_key = ? AND superseded_by IS NULL`, [founderId, key])).rows[0] as Row | undefined;
  const insert = {
    sql: `INSERT INTO mission_terms (id, founder_id, mission_key, budget_cents, until, success, stop_when, interrupt_at)
          VALUES (?,?,?,?,?,?,?,?)`,
    args: [id, founderId, key, terms.budgetCents, terms.until, terms.success, terms.stopWhen, terms.interruptAt],
  };
  const event = { sql: `INSERT INTO mission_events (id, founder_id, mission_key, kind, said) VALUES (?,?,?,?,?)`,
    args: [`me_${nanoid(12)}`, founderId, key, 'amended', 'You set its limits.'] };
  // The partial unique index allows one live row: supersede first, then insert.
  if (live) {
    await batch([
      { sql: `UPDATE mission_terms SET superseded_by = ? WHERE id = ?`, args: [id, String(live.id)] },
      insert, event,
    ]);
  } else {
    await batch([insert, event]);
  }
  return id;
}

/**
 * STATE A MISSION. For a goal no engine carries yet — "build a landing page",
 * "get the portfolio to $500 a month". Kept in his words; confirmed at once,
 * because this is only ever called from the page where he read it back.
 */
export async function openMission(input: {
  founderId: string; productId: string | null; asked: string; goal: string;
  mode: MissionMode; realm: MissionRealm; terms: Terms | null;
}): Promise<string> {
  const goal = input.goal.trim().slice(0, 300);
  if (!goal) throw new MissionRefused('A Mission needs a goal, in your words.');
  if (!MODES.has(input.mode)) throw new MissionRefused('That is not a kind of work I know.');
  if (!REALMS.has(input.realm)) throw new MissionRefused('That is not a world I know.');
  if (input.productId) {
    const mine = (await query(`SELECT 1 FROM products WHERE id = ? AND owner_id = ? AND deleted_at IS NULL`,
      [input.productId, input.founderId])).rows.length > 0;
    if (!mine) throw new MissionRefused('That is not one of your companies.');
  }
  const id = `mi_${nanoid(12)}`;
  await batch([
    { sql: `INSERT INTO missions (id, founder_id, product_id, asked, goal, mode, realm) VALUES (?,?,?,?,?,?,?)`,
      args: [id, input.founderId, input.productId, input.asked.trim().slice(0, 800), goal, input.mode, input.realm] },
    { sql: `INSERT INTO mission_events (id, founder_id, mission_key, kind, said) VALUES (?,?,?,?,?)`,
      args: [`me_${nanoid(12)}`, input.founderId, `mission:${id}`, 'confirmed', 'You started it.'] },
  ]);
  if (input.terms) await setTerms(input.founderId, `mission:${id}`, input.terms);
  return id;
}

const ACT_WORDS: Record<string, string> = {
  paused: 'You paused it.', resumed: 'You resumed it.', stopped: 'You stopped it.',
  concluded: 'You marked it done.', archived: 'You put it away.',
};

/**
 * WHAT HE DID TO A MISSION HE STATED. Work read from an engine is stopped
 * where it lives — a test's own Stop, the search's own Stop — so there is one
 * way to do each thing; only archiving is recorded against those.
 */
export async function actOnMission(founderId: string, key: string, kind: 'paused' | 'resumed' | 'stopped' | 'concluded' | 'archived', said = ''): Promise<void> {
  if (!await isHis(founderId, key)) throw new MissionRefused('That is not one of your Missions.');
  if (!key.startsWith('mission:') && kind !== 'archived') {
    throw new MissionRefused('Stop this where it lives: its own page has the Stop that actually stops it.');
  }
  await query(`INSERT INTO mission_events (id, founder_id, mission_key, kind, said) VALUES (?,?,?,?,?)`,
    [`me_${nanoid(12)}`, founderId, key, kind, (said.trim().slice(0, 300) || ACT_WORDS[kind]) ?? kind]);
}
