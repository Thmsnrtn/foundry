// =============================================================================
// FOUNDRY — the model door: does it answer, and how long will the credit last
// (Roadmap 2027 R33).
//
// Every thinking routine reaches the model through one paid account. When the
// credit ran out the first sign was the forge and discovery going quiet, read
// by the owner as "nothing found". So the remaining credit is read from the
// provider once a day, with the key the client already uses, and kept; and the
// door's own record (calls answered, calls that failed) is read beside it.
//
// A READER. It sends nothing but two authenticated reads to the provider's own
// account endpoints, and writes one row a day. No key value is ever stored or
// shown; a failed read is recorded as a failure, never as a balance of zero.
// =============================================================================

import { nanoid } from 'nanoid';
import { query } from '../../db/client.js';

const OPENROUTER = 'https://openrouter.ai/api/v1';

export interface CreditsReading { ok: boolean; remainingUsd: number | null; source: 'account' | 'key' | null; detail: string | null }

const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);

/**
 * WHAT CREDIT IS LEFT. The account's credits when the key may read them;
 * otherwise the key's own spending limit, which is null when the key has none
 * (then the reading is true and says nothing about a balance).
 */
export async function readModelCredits(fetchImpl: typeof fetch = fetch, env: NodeJS.ProcessEnv = process.env): Promise<CreditsReading> {
  const key = env.OPENROUTER_API_KEY ?? env.ANTHROPIC_API_KEY;
  if (!key) return { ok: false, remainingUsd: null, source: null, detail: 'no model key is configured' };
  const headers = { Authorization: `Bearer ${key}` };
  try {
    const account = await fetchImpl(`${OPENROUTER}/credits`, { headers });
    if (account.ok) {
      const d = ((await account.json()) as { data?: { total_credits?: unknown; total_usage?: unknown } }).data ?? {};
      const total = num(d.total_credits); const used = num(d.total_usage);
      if (total !== null && used !== null) return { ok: true, remainingUsd: Math.round((total - used) * 100) / 100, source: 'account', detail: null };
    }
    const own = await fetchImpl(`${OPENROUTER}/key`, { headers });
    if (!own.ok) return { ok: false, remainingUsd: null, source: null, detail: `the provider answered ${String(own.status)} when asked about this key` };
    const k = ((await own.json()) as { data?: { limit_remaining?: unknown } }).data ?? {};
    const left = num(k.limit_remaining);
    return { ok: true, remainingUsd: left === null ? null : Math.round(left * 100) / 100, source: 'key', detail: null };
  } catch (e) {
    return { ok: false, remainingUsd: null, source: null, detail: e instanceof Error ? e.message : String(e) };
  }
}

/** Read and record the credit, at most once a UTC day. */
export async function readModelCreditsOnceADay(fetchImpl: typeof fetch = fetch, now: Date = new Date()): Promise<'read' | 'read_failed' | 'already_read_today'> {
  const day = now.toISOString().slice(0, 10);
  if ((await query('SELECT 1 FROM model_door_readings WHERE read_on = ?', [day])).rows.length > 0) return 'already_read_today';
  const r = await readModelCredits(fetchImpl);
  await query(`INSERT OR IGNORE INTO model_door_readings (id, read_on, ok, remaining_usd, source, detail) VALUES (?,?,?,?,?,?)`,
    [nanoid(), day, r.ok ? 1 : 0, r.ok ? r.remainingUsd : null, r.source, r.detail]);
  return r.ok ? 'read' : 'read_failed';
}

export interface ModelDoorFacts {
  /** Calls today that ended without an answer, and calls answered. */
  failedToday: number; answeredToday: number;
  /** The last successful reading of the credit left, in dollars, or null. */
  remainingUsd: number | null; readOn: string | null;
  /** Whole days the credit lasts at the last week's settled spend, or null when unknown or unbounded. */
  daysLeft: number | null;
  /** The last reading, when it failed, and why. */
  lastReadFailed: string | null;
}

export async function modelDoorFacts(): Promise<ModelDoorFacts> {
  const { modelDoorToday, settledCentsPerDay } = await import('./spend-ledger.js');
  const today = await modelDoorToday();
  const last = (await query(`SELECT read_on, ok, remaining_usd, detail FROM model_door_readings ORDER BY read_on DESC LIMIT 1`, [])).rows[0] as Record<string, unknown> | undefined;
  const good = (await query(`SELECT read_on, remaining_usd FROM model_door_readings WHERE ok = 1 ORDER BY read_on DESC LIMIT 1`, [])).rows[0] as Record<string, unknown> | undefined;
  const remainingUsd = good?.remaining_usd == null ? null : Number(good.remaining_usd);
  const perDay = await settledCentsPerDay(7);
  const daysLeft = remainingUsd === null || perDay <= 0 ? null : Math.floor((remainingUsd * 100) / perDay + 1e-9);
  return {
    failedToday: today.failed, answeredToday: today.settled,
    remainingUsd, readOn: good ? String(good.read_on) : null, daysLeft,
    lastReadFailed: last && Number(last.ok) === 0 ? String(last.detail ?? 'the reading failed') : null,
  };
}

/**
 * IS THE DOOR DOWN, IN ONE SENTENCE — or null when it is not. The one reading
 * every owner surface uses: Controls' "can it sell", Home's pulse and health,
 * and the absence page all render this, so a down door is named the same way
 * wherever he looks and never blamed on "a routine" (F-DOOR-2). Down means it
 * failed today and answered nothing today; one answer since is not down.
 */
export function modelDoorDownSentence(m: Pick<ModelDoorFacts, 'failedToday' | 'answeredToday'>): string | null {
  if (!(m.failedToday > 0 && m.answeredToday === 0)) return null;
  return `the model door failed ${String(m.failedToday)} time${m.failedToday === 1 ? '' : 's'} today and answered nothing, so nothing new can be found or designed: check the OpenRouter credit and key`;
}

/** The same, read from the ledger now. */
export async function modelDoorDown(): Promise<string | null> {
  return modelDoorDownSentence(await modelDoorFacts());
}
