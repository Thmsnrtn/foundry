// =============================================================================
// FOUNDRY — Founder Wellbeing Service
// Journal entries, focus settings, and decision pacing for founders.
// Based on migration 036 (founder_journal_entries, founder_focus_settings,
// decision_snooze_log tables).
// =============================================================================

import { nanoid } from 'nanoid';
import { query } from '../../db/client.js';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface JournalEntry {
  id: string;
  product_id: string;
  founder_id: string;
  content: string;
  mood: number | null; // 1-5
  tags: string[];
  is_agent_visible: boolean;
  created_at: string;
  updated_at: string;
}

export interface FocusSettings {
  id: string;
  product_id: string;
  focus_area: string | null;
  focus_ends_at: string | null;
  vacation_mode_until: string | null;
  max_decisions_per_day: number;
  briefing_format: 'full' | 'compact' | 'critical_only';
  preferred_timezone: string;
}

export interface DecisionSnooze {
  decision_id: string;
  snoozed_until: string;
  reason: string | null;
}

// ─── Journal Entries ──────────────────────────────────────────────────────────

export async function createJournalEntry(
  productId: string,
  founderId: string,
  opts: {
    content: string;
    mood?: number;
    tags?: string[];
    is_agent_visible?: boolean;
  }
): Promise<string> {
  const id = nanoid();
  await query(
    `INSERT INTO founder_journal_entries (id, product_id, founder_id, content, mood, tags, is_agent_visible)
     VALUES (?,?,?,?,?,?,?)`,
    [
      id, productId, founderId,
      opts.content,
      opts.mood ?? null,
      JSON.stringify(opts.tags ?? []),
      opts.is_agent_visible !== false ? 1 : 0,
    ]
  );
  return id;
}

export async function getJournalEntries(
  productId: string,
  opts?: {
    founderId?: string;
    agentVisibleOnly?: boolean;
    since?: string;
    limit?: number;
  }
): Promise<JournalEntry[]> {
  let where = 'product_id=?';
  const params: unknown[] = [productId];

  if (opts?.founderId) { where += ' AND founder_id=?'; params.push(opts.founderId); }
  if (opts?.agentVisibleOnly) { where += ' AND is_agent_visible=1'; }
  if (opts?.since) { where += ' AND created_at >= ?'; params.push(opts.since); }

  params.push(opts?.limit ?? 20);

  const result = await query(
    `SELECT * FROM founder_journal_entries WHERE ${where} ORDER BY created_at DESC LIMIT ?`,
    params
  );

  return result.rows.map(r => {
    const row = r as Record<string, unknown>;
    return {
      id: row.id as string,
      product_id: row.product_id as string,
      founder_id: row.founder_id as string,
      content: row.content as string,
      mood: row.mood != null ? Number(row.mood) : null,
      tags: (() => { try { return JSON.parse(row.tags as string || '[]'); } catch { return []; } })(),
      is_agent_visible: row.is_agent_visible === 1 || row.is_agent_visible === true,
      created_at: row.created_at as string,
      updated_at: row.updated_at as string,
    };
  });
}

export async function updateJournalEntry(
  entryId: string,
  updates: { content?: string; mood?: number | null; tags?: string[]; is_agent_visible?: boolean }
): Promise<void> {
  const parts: string[] = ['updated_at=datetime(\'now\')'];
  const params: unknown[] = [];

  if (updates.content !== undefined) { parts.push('content=?'); params.push(updates.content); }
  if (updates.mood !== undefined) { parts.push('mood=?'); params.push(updates.mood); }
  if (updates.tags !== undefined) { parts.push('tags=?'); params.push(JSON.stringify(updates.tags)); }
  if (updates.is_agent_visible !== undefined) { parts.push('is_agent_visible=?'); params.push(updates.is_agent_visible ? 1 : 0); }

  if (parts.length <= 1) return;
  params.push(entryId);

  await query(`UPDATE founder_journal_entries SET ${parts.join(', ')} WHERE id=?`, params);
}

export async function deleteJournalEntry(entryId: string, founderId: string): Promise<void> {
  await query(`DELETE FROM founder_journal_entries WHERE id=? AND founder_id=?`, [entryId, founderId]);
}

// ─── Focus Settings ───────────────────────────────────────────────────────────

export async function getFocusSettings(productId: string): Promise<FocusSettings> {
  const result = await query(
    `SELECT * FROM founder_focus_settings WHERE product_id=?`,
    [productId]
  );

  if (result.rows.length === 0) {
    // Return defaults if no settings row exists yet
    return {
      id: '',
      product_id: productId,
      focus_area: null,
      focus_ends_at: null,
      vacation_mode_until: null,
      max_decisions_per_day: 20,
      briefing_format: 'full',
      preferred_timezone: 'UTC',
    };
  }

  const row = result.rows[0] as Record<string, unknown>;
  return {
    id: row.id as string,
    product_id: row.product_id as string,
    focus_area: (row.focus_area as string) ?? null,
    focus_ends_at: (row.focus_ends_at as string) ?? null,
    vacation_mode_until: (row.vacation_mode_until as string) ?? null,
    max_decisions_per_day: Number(row.max_decisions_per_day ?? 20),
    briefing_format: (row.briefing_format as FocusSettings['briefing_format']) ?? 'full',
    preferred_timezone: (row.preferred_timezone as string) ?? 'UTC',
  };
}

export async function upsertFocusSettings(
  productId: string,
  updates: Partial<Omit<FocusSettings, 'id' | 'product_id'>>
): Promise<void> {
  const existing = await query(`SELECT id FROM founder_focus_settings WHERE product_id=?`, [productId]);

  if (existing.rows.length === 0) {
    await query(
      `INSERT INTO founder_focus_settings (id, product_id, focus_area, focus_ends_at, vacation_mode_until, max_decisions_per_day, briefing_format, preferred_timezone)
       VALUES (?,?,?,?,?,?,?,?)`,
      [
        nanoid(), productId,
        updates.focus_area ?? null,
        updates.focus_ends_at ?? null,
        updates.vacation_mode_until ?? null,
        updates.max_decisions_per_day ?? 20,
        updates.briefing_format ?? 'full',
        updates.preferred_timezone ?? 'UTC',
      ]
    );
  } else {
    const parts: string[] = [];
    const params: unknown[] = [];

    if (updates.focus_area !== undefined) { parts.push('focus_area=?'); params.push(updates.focus_area); }
    if (updates.focus_ends_at !== undefined) { parts.push('focus_ends_at=?'); params.push(updates.focus_ends_at); }
    if (updates.vacation_mode_until !== undefined) { parts.push('vacation_mode_until=?'); params.push(updates.vacation_mode_until); }
    if (updates.max_decisions_per_day !== undefined) { parts.push('max_decisions_per_day=?'); params.push(updates.max_decisions_per_day); }
    if (updates.briefing_format !== undefined) { parts.push('briefing_format=?'); params.push(updates.briefing_format); }
    if (updates.preferred_timezone !== undefined) { parts.push('preferred_timezone=?'); params.push(updates.preferred_timezone); }

    if (parts.length === 0) return;
    params.push(productId);
    await query(`UPDATE founder_focus_settings SET ${parts.join(', ')} WHERE product_id=?`, params);
  }
}

export async function isVacationMode(productId: string): Promise<boolean> {
  const settings = await getFocusSettings(productId);
  if (!settings.vacation_mode_until) return false;
  return new Date(settings.vacation_mode_until) > new Date();
}

export async function setVacationMode(productId: string, until: string | null): Promise<void> {
  await upsertFocusSettings(productId, { vacation_mode_until: until });
}

export async function setFocusArea(
  productId: string,
  area: string | null,
  endsAt?: string
): Promise<void> {
  await upsertFocusSettings(productId, {
    focus_area: area,
    focus_ends_at: endsAt ?? null,
  });
}

// ─── Decision Snooze ──────────────────────────────────────────────────────────

export async function snoozeDecision(
  productId: string,
  decisionId: string,
  snoozedUntil: string,
  reason?: string
): Promise<void> {
  await query(
    `INSERT INTO decision_snooze_log (id, product_id, decision_id, snoozed_until, reason)
     VALUES (?,?,?,?,?)
     ON CONFLICT(product_id, decision_id) DO UPDATE SET snoozed_until=excluded.snoozed_until, reason=excluded.reason`,
    [nanoid(), productId, decisionId, snoozedUntil, reason ?? null]
  );
}

export async function unsnoozeDecision(productId: string, decisionId: string): Promise<void> {
  await query(
    `DELETE FROM decision_snooze_log WHERE product_id=? AND decision_id=?`,
    [productId, decisionId]
  );
}

export async function getSnoozedDecisions(productId: string): Promise<DecisionSnooze[]> {
  const result = await query(
    `SELECT decision_id, snoozed_until, reason FROM decision_snooze_log
     WHERE product_id=? AND snoozed_until > datetime('now')`,
    [productId]
  );
  return result.rows.map(r => {
    const row = r as Record<string, unknown>;
    return {
      decision_id: row.decision_id as string,
      snoozed_until: row.snoozed_until as string,
      reason: (row.reason as string) ?? null,
    };
  });
}

export async function isDecisionSnoozed(productId: string, decisionId: string): Promise<boolean> {
  const result = await query(
    `SELECT id FROM decision_snooze_log WHERE product_id=? AND decision_id=? AND snoozed_until > datetime('now')`,
    [productId, decisionId]
  );
  return result.rows.length > 0;
}

// ─── Agent Context Helper ─────────────────────────────────────────────────────

/**
 * Called by agents to get recent visible journal context and pacing settings.
 * Used to calibrate agent tone/volume.
 */
export async function getAgentContext(productId: string): Promise<{
  recentMood: number | null;
  recentJournalSummary: string | null;
  isVacationMode: boolean;
  focusArea: string | null;
  maxDecisionsPerDay: number;
  briefingFormat: string;
}> {
  const [settings, journalEntries] = await Promise.all([
    getFocusSettings(productId),
    getJournalEntries(productId, { agentVisibleOnly: true, since: new Date(Date.now() - 7 * 86400000).toISOString(), limit: 5 }),
  ]);

  const moodEntries = journalEntries.filter(e => e.mood != null);
  const avgMood = moodEntries.length > 0
    ? moodEntries.reduce((sum, e) => sum + (e.mood ?? 0), 0) / moodEntries.length
    : null;

  const vacMode = settings.vacation_mode_until ? new Date(settings.vacation_mode_until) > new Date() : false;
  const focusExpired = settings.focus_ends_at ? new Date(settings.focus_ends_at) < new Date() : false;

  const recentJournalSummary = journalEntries.length > 0
    ? journalEntries.slice(0, 2).map(e => e.content.slice(0, 150)).join(' | ')
    : null;

  return {
    recentMood: avgMood !== null ? Math.round(avgMood * 10) / 10 : null,
    recentJournalSummary,
    isVacationMode: vacMode,
    focusArea: focusExpired ? null : (settings.focus_area ?? null),
    maxDecisionsPerDay: settings.max_decisions_per_day,
    briefingFormat: settings.briefing_format,
  };
}
