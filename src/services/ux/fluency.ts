// =============================================================================
// FOUNDRY — Fluency (one product, many voices)
//
// The product NEVER forks: every user gets the same features, data, and power.
// What adapts is presentation — how much technical vocabulary is used and how
// much hand-holding is shown. Onboarding sets a default from the path the
// founder chose; the dial lives in Settings and can be changed anytime.
//
//   plain     — everyday words first, the technical term kept in parentheses
//               (never hidden — plain users are learning the vocabulary, not
//               being protected from it); full explainer strips.
//   balanced  — (default) technical terms with brief inline translations.
//   technical — terse, domain vocabulary, no hand-holding.
// =============================================================================

import { query } from '../../db/client.js';
import type { FounderPreferences } from '../../types/index.js';

export type Fluency = 'plain' | 'balanced' | 'technical';

const VALID: Fluency[] = ['plain', 'balanced', 'technical'];

/** Read the dial off the founder object the auth middleware already hydrates. */
export function getFluency(founder: { preferences?: FounderPreferences | null } | null | undefined): Fluency {
  const f = founder?.preferences?.fluency;
  return VALID.includes(f as Fluency) ? (f as Fluency) : 'balanced';
}

/** Set the dial (JSON-merge into founders.preferences — other prefs survive). */
export async function setFluency(founderId: string, fluency: Fluency): Promise<void> {
  if (!VALID.includes(fluency)) return;
  const r = await query('SELECT preferences FROM founders WHERE id = ?', [founderId]);
  const raw = (r.rows[0] as Record<string, string | null> | undefined)?.preferences;
  let prefs: Record<string, unknown> = {};
  try { prefs = raw ? JSON.parse(raw) : {}; } catch { /* replace corrupt prefs */ }
  prefs.fluency = fluency;
  await query('UPDATE founders SET preferences = ? WHERE id = ?', [JSON.stringify(prefs), founderId]);
}

/** Set the dial only if the founder hasn't chosen one (onboarding defaults). */
export async function setFluencyDefault(founderId: string, fluency: Fluency): Promise<void> {
  const r = await query('SELECT preferences FROM founders WHERE id = ?', [founderId]);
  const raw = (r.rows[0] as Record<string, string | null> | undefined)?.preferences;
  try {
    const prefs = raw ? JSON.parse(raw) as Record<string, unknown> : {};
    if (VALID.includes(prefs.fluency as Fluency)) return; // explicit choice wins
  } catch { /* corrupt → treat as unset */ }
  await setFluency(founderId, fluency);
}

// ── Vocabulary: every term renders at every fluency; nothing is ever hidden. ──

const TERMS: Record<string, { plain: string; balanced: string; technical: string }> = {
  premise: {
    plain: 'the belief behind it',
    balanced: 'premise (the belief behind it)',
    technical: 'premise',
  },
  falsified: {
    plain: 'no longer true',
    balanced: 'falsified (no longer true)',
    technical: 'falsified',
  },
  red_team: {
    plain: 'the devil\'s advocate',
    balanced: 'Red Team (devil\'s advocate)',
    technical: 'Red Team pre-mortem',
  },
  churn_rate: {
    plain: 'customers leaving each month',
    balanced: 'churn (customers leaving monthly)',
    technical: 'churn_rate',
  },
  shadow: {
    plain: 'watching how you decide',
    balanced: 'shadow mode (watching how you decide)',
    technical: 'shadow',
  },
};

export function term(key: string, f: Fluency): string {
  return TERMS[key]?.[f] ?? key;
}

/** Decision stakes: the gate number is the technical truth; plain speech leads
 *  with what it means and KEEPS the number. */
export function gateLabel(gate: number, f: Fluency): string {
  if (f === 'technical') return `Gate-${gate}`;
  const meaning = gate >= 3 ? 'Big decision' : gate === 2 ? 'Notable decision' : 'Routine decision';
  return f === 'plain' ? `${meaning} (gate ${gate})` : `Gate-${gate} — ${meaning.toLowerCase()}`;
}

/** Rates render as percentages outside technical fluency. */
export function rate(value: number, f: Fluency): string {
  return f === 'technical' ? String(value) : `${Math.round(value * 1000) / 10}%`;
}

// ── Hand-holding: explainer strips, sized by the dial. ────────────────────────

const EXPLAINERS: Record<string, { plain: string; balanced: string }> = {
  letter: {
    plain: 'This is your daily letter — everything your AI team did, learned, and needs from you, in one place. Most days you can read it and get back to your real work.',
    balanced: 'Your daily letter: handled / needs you / learned / trust.',
  },
  controls: {
    plain: 'This is where you decide how much Foundry does on its own. It starts by only watching. When its suggestions keep matching what you would have chosen, it earns the right to suggest — and only YOU can allow it to act. You can pull everything back with one button, any time.',
    balanced: 'Autonomy is earned per category — watch → suggest → act (your grant). One-button stop.',
  },
  decide: {
    plain: 'Your team looked at the data and framed this choice for you. Their recommendation is below. Nothing happens until you choose — and for big decisions, a devil\'s advocate argues the other side first.',
    balanced: 'Framed by the agents; the Red Team contests gate-3+ before you commit.',
  },
  expired_beliefs: {
    plain: 'When you made these decisions, you told Foundry what you believed. Your own numbers now say those beliefs are no longer true — worth a fresh look before you build on them.',
    balanced: 'Premises your telemetry has since falsified — revisit before relying on them.',
  },
};

export function explain(key: string, f: Fluency): string {
  if (f === 'technical') return '';
  return EXPLAINERS[key]?.[f] ?? '';
}
