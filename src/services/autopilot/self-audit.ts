// =============================================================================
// FOUNDRY — Autopilot Self-Audit (ported from AcreOS selfAudit.ts)
//
// The system audits its OWN tendency to over-defer. The Prime Objective is
// minimum founder-minutes; a Jarvis that keeps asking "want me to…?" for
// things inside its earned authority is failing that objective even when
// every individual answer is polite. This detector reads Foundry's recent
// founder-facing output and scores permission-seeking / menu-handing drift.
//
// Detection-only (never edits behavior); results surface in the operator
// letter so the drift is visible and fixable. Deterministic — no model.
// =============================================================================

import { query } from '../../db/client.js';

// Phrases that hand a decision back to the founder. Flagged ONLY on system
// output (assistant/notification text), never on the founder's own words.
const PERMISSION_SEEKING = [
  /\bwant me to\b/i,
  /\bshould i\b/i,
  /\bdo you want (me )?to\b/i,
  /\bwould you like me to\b/i,
  /\bshall i\b/i,
  /\blet me know if you(?:'d| would)? like\b/i,
  /\bjust say the word\b/i,
];

// Menu-handing: offering a list of options instead of a recommendation.
const MENU_HANDING = [
  /\byou (?:could|can|might) (?:either|choose|pick|decide)\b/i,
  /\bhere are (?:a few|some|your) options\b/i,
  /\bwhich (?:one )?would you (?:like|prefer)\b/i,
];

export interface DeferenceFinding {
  source: 'chat' | 'notification';
  ref: string;
  excerpt: string;
  kind: 'permission_seeking' | 'menu_handing';
}

export interface SelfAuditResult {
  sampled: number;
  findings: DeferenceFinding[];
  /** 0..1 — share of sampled system utterances that over-defer. */
  deferenceRate: number;
}

function detect(text: string): DeferenceFinding['kind'] | null {
  if (PERMISSION_SEEKING.some((re) => re.test(text))) return 'permission_seeking';
  if (MENU_HANDING.some((re) => re.test(text))) return 'menu_handing';
  return null;
}

function excerpt(text: string): string {
  return text.length > 160 ? text.slice(0, 157) + '…' : text;
}

/** Sample recent founder-facing system output and score deference drift. */
export async function runSelfAudit(sampleSize = 100): Promise<SelfAuditResult> {
  const findings: DeferenceFinding[] = [];
  let sampled = 0;

  // Assistant chat turns (the institution speaking).
  const chat = await query(
    `SELECT id, content FROM conversation_messages
      WHERE role = 'assistant' AND created_at >= datetime('now', '-7 days')
      ORDER BY created_at DESC LIMIT ?`,
    [sampleSize],
  );
  for (const row of chat.rows as unknown as Array<Record<string, string>>) {
    sampled++;
    const kind = detect(row.content ?? '');
    if (kind) findings.push({ source: 'chat', ref: String(row.id), excerpt: excerpt(row.content), kind });
  }

  // Notifications the system generated.
  const notes = await query(
    `SELECT id, body FROM notifications
      WHERE created_at >= datetime('now', '-7 days')
      ORDER BY created_at DESC LIMIT ?`,
    [sampleSize],
  ).catch(() => ({ rows: [] as unknown[] }));
  for (const row of notes.rows as unknown as Array<Record<string, string>>) {
    sampled++;
    const kind = detect(row.body ?? '');
    if (kind) findings.push({ source: 'notification', ref: String(row.id), excerpt: excerpt(row.body), kind });
  }

  return {
    sampled,
    findings,
    deferenceRate: sampled > 0 ? findings.length / sampled : 0,
  };
}

/** One-line summary for the operator letter, or null when drift is negligible. */
export async function deferenceLine(): Promise<string | null> {
  const audit = await runSelfAudit();
  if (audit.findings.length === 0) return null;
  const pct = Math.round(audit.deferenceRate * 100);
  return `Self-audit: ${audit.findings.length} of ${audit.sampled} recent messages asked your permission instead of acting or recommending (${pct}%). The autopilot is drifting toward over-deference — the opposite of its job.`;
}
