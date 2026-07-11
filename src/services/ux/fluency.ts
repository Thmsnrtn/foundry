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
  dashboard: {
    plain: 'Your Signal is one number for how the company is doing, built from your real data. The dot next to it is the risk state. Everything on this page updates itself — you never have to fill anything in.',
    balanced: 'Signal (composite health) + risk state, computed from live telemetry.',
  },
  decisions_list: {
    plain: 'Choices your AI team has framed for you, biggest first. Open one to see the reasoning, hear the other side, and decide. Nothing happens without you on big decisions.',
    balanced: 'Agent-framed decisions by gate; open the chamber to contest and resolve.',
  },
  strategic_decisions: {
    plain: 'Your decision journal. Write down what you decided and the belief it rests on — in plain words, like "churn stays under 5%" — and Foundry will quietly watch your numbers and warn you if that belief stops being true.',
    balanced: 'The decision ledger; premises in plain words are auto-monitored against telemetry.',
  },
  briefings: {
    plain: 'Every morning your AI team writes up what changed and what matters. This is the archive — the Letter is the short version.',
    balanced: 'Daily agent briefings archive; the Letter is the digest.',
  },
  dna: {
    plain: 'What makes your product yours — who it is for, what they object to, how you win. The more of this you fill in, the more your AI team sounds like YOUR team instead of a generic advisor.',
    balanced: 'Product DNA grounds agent output in your specific ICP and positioning.',
  },
  talk: {
    plain: 'Just talk. Ask anything about your business, or say what you have decided — Foundry writes the important parts into the ledger for you and keeps watch on them.',
    balanced: 'Conversation is capture: stated decisions/beliefs land in the ledger, monitored.',
  },
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

// ── Risk states + metrics: translated, never hidden. ──────────────────────────

export function riskLabel(state: string, f: Fluency): string {
  if (f === 'technical') return state;
  const meanings: Record<string, string> = {
    green: 'healthy', yellow: 'needs attention', red: 'at risk',
  };
  const m = meanings[state] ?? state;
  return f === 'plain' ? `${m} (${state})` : `${state} — ${m}`;
}

const METRIC_LABELS: Record<string, { plain: string; technical: string }> = {
  churn_rate: { plain: 'customers leaving monthly', technical: 'churn_rate' },
  activation_rate: { plain: 'new users getting started', technical: 'activation_rate' },
  day_30_retention: { plain: 'users still active after 30 days', technical: 'day_30_retention' },
  nps_score: { plain: 'customer happiness score (NPS)', technical: 'nps_score' },
  mrr_health_ratio: { plain: 'revenue gained vs lost', technical: 'mrr_health_ratio' },
};

export function metricLabel(key: string, f: Fluency): string {
  const m = METRIC_LABELS[key];
  if (!m) return key;
  if (f === 'technical') return m.technical;
  return f === 'plain' ? m.plain : `${m.technical} (${m.plain})`;
}

/** Metrics stored as 0–1 fractions (rates) render as % outside technical. */
const FRACTION_METRICS = new Set(['churn_rate', 'activation_rate', 'day_30_retention', 'mrr_health_ratio']);
export function metricValue(key: string, value: number, f: Fluency): string {
  if (f === 'technical') return String(value);
  return FRACTION_METRICS.has(key) ? rate(value, f) : String(value);
}

// ── Plain-text premise extraction (kills the comparator dropdowns) ────────────
// "churn stays under 5%" → { metricKey: 'churn_rate', comparator: '<', threshold: 0.05 }
// Deterministic — no model call, no cost, no latency. Anything it can't parse
// simply becomes a qualitative premise (still recorded, still honored).

const METRIC_SYNONYMS: Array<{ re: RegExp; key: string }> = [
  { re: /\bchurn\b/i, key: 'churn_rate' },
  { re: /\bactivation\b/i, key: 'activation_rate' },
  { re: /\bretention\b/i, key: 'day_30_retention' },
  { re: /\bnps\b|\bhappiness\b/i, key: 'nps_score' },
  { re: /\bhealth ratio\b|\brevenue health\b/i, key: 'mrr_health_ratio' },
];

const COMPARATOR_PHRASES: Array<{ re: RegExp; comparator: '<' | '<=' | '>' | '>=' }> = [
  { re: /\bat most\b|\bno more than\b/i, comparator: '<=' },
  { re: /\bat least\b|\bno less than\b|\bstays? above\b|\bstays? over\b/i, comparator: '>=' },
  { re: /\b(?:stays?|keeps?|remains?)?\s*(?:under|below|less than)\b/i, comparator: '<' },
  { re: /\b(?:above|over|more than|exceeds?)\b/i, comparator: '>' },
];

export interface ExtractedPremise {
  metricKey: string;
  comparator: '<' | '<=' | '>' | '>=';
  threshold: number;
}

export function extractPremiseCondition(text: string): ExtractedPremise | null {
  const metric = METRIC_SYNONYMS.find((m) => m.re.test(text));
  if (!metric) return null;
  const comp = COMPARATOR_PHRASES.find((c) => c.re.test(text));
  if (!comp) return null;
  const num = text.match(/(\d+(?:\.\d+)?)\s*(%|percent)?/);
  if (!num) return null;
  let threshold = parseFloat(num[1]);
  const isPercent = !!num[2] || (FRACTION_METRICS.has(metric.key) && threshold > 1);
  if (isPercent && FRACTION_METRICS.has(metric.key)) threshold = threshold / 100;
  if (!Number.isFinite(threshold)) return null;
  return { metricKey: metric.key, comparator: comp.comparator, threshold };
}
