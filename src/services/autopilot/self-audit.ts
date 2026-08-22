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
//
// FLEET-WIDE, AND THE NAME SAYS SO. This samples assistant output and
// notifications across every company on the install, with no tenant filter, and
// that is correct: it measures the machine, not a company, and its one caller
// is the operator pack, which `letter/fleet.ts` reaches only for the operator
// of Foundry-the-business. The scope is in the name because a scope that lives
// only in a comment is one refactor away from being a cross-tenant read — the
// same reason a rate carries its unit in its name.
//
// `findings` carry a 160-character excerpt of a real assistant message, which
// is customer content. Nothing renders them today; `deferenceLine` emits counts
// only. DO NOT put an excerpt on a founder-facing surface: the count is about
// the fleet, and one company must never read another's words out of it.
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
  /** 0..1 — share of sampled system utterances that over-defer. Null when
   *  nothing was sampled: no output to read is not the same as output that
   *  never over-defers, and only one of those two is good news. */
  deferenceRate: number | null;
}

function detect(text: string): DeferenceFinding['kind'] | null {
  if (PERMISSION_SEEKING.some((re) => re.test(text))) return 'permission_seeking';
  if (MENU_HANDING.some((re) => re.test(text))) return 'menu_handing';
  return null;
}

function excerpt(text: string): string {
  return text.length > 160 ? text.slice(0, 157) + '…' : text;
}

/** Sample recent system output ACROSS THE FLEET and score deference drift.
 *  `sampleSize` is per source, so the ceiling is twice it. */
export async function runFleetSelfAudit(sampleSize = 100): Promise<SelfAuditResult> {
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
    deferenceRate: sampled > 0 ? findings.length / sampled : null,
  };
}

/** One-line summary for the operator letter, or null when drift is negligible. */
export async function deferenceLine(): Promise<string | null> {
  const audit = await runFleetSelfAudit();
  if (audit.findings.length === 0 || audit.deferenceRate === null) return null;
  const pct = Math.round(audit.deferenceRate * 100);
  return `Self-audit: ${audit.findings.length} of ${audit.sampled} recent messages asked your permission instead of acting or recommending (${pct}%). The autopilot is drifting toward over-deference — the opposite of its job.`;
}
