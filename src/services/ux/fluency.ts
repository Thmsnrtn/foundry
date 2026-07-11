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
  roster: {
    plain: 'These are the AI teammates working on your company — each with a job, like a growth lead or a finance head. They read your real numbers and report in every day.',
    balanced: 'Your agent team: each role reads live telemetry and contributes to briefings and decisions.',
  },
  debate: {
    plain: 'Before advice reaches you, your AI teammates argue it out among themselves. You can read the argument — including who disagreed and why.',
    balanced: 'Inter-agent debate transcripts: positions, dissents, and how the recommendation formed.',
  },
  accuracy: {
    plain: 'A public scorecard: every prediction your AI team made, and whether it came true. If they are often wrong about something, you will see it here first.',
    balanced: 'Prediction calibration per agent — claims vs outcomes, so trust is earned, not assumed.',
  },
  transparency: {
    plain: 'Exactly what your AI team did and why — every action, every data source, nothing hidden. If you ever wonder "why did it say that?", the answer is here.',
    balanced: 'Full audit of agent actions, inputs, and reasoning provenance.',
  },
  agent_intelligence: {
    plain: 'How your AI team is getting smarter over time — what it has learned about your business specifically.',
    balanced: 'Agent learning state: accumulated, product-specific knowledge and how it changed.',
  },
  actions: {
    plain: 'Things worth doing, drawn from your real numbers — each one says why it matters and what to do. Check one off and Foundry tracks whether it helped.',
    balanced: 'Telemetry-derived action queue; completion feeds back into outcome tracking.',
  },
  scenarios: {
    plain: 'Try out "what if" questions — what if growth slows, what if you raise prices — and see how your numbers would play out, using your real history as the starting point.',
    balanced: 'What-if projections seeded from your live metrics.',
  },
  board: {
    plain: 'Everything an investor would ask for, kept up to date automatically — so an investor meeting never costs you a weekend of slide-making.',
    balanced: 'Auto-maintained investor materials from live ledgers.',
  },
  exit: {
    plain: 'What your company might be worth to a buyer, and what would make it worth more. Updated from your real numbers — not a guess you type in.',
    balanced: 'Valuation and exit-readiness signals derived from live metrics.',
  },
  weekly_brief: {
    plain: 'The week in one page: what moved, what your AI team thinks it means, and the one or two things worth your attention next week.',
    balanced: 'Weekly synthesis: deltas, interpretation, and next-week focus.',
  },
  multimodal: {
    plain: 'Signals from beyond your dashboard — support messages, reviews, community chatter — read and summarized so patterns reach you before they become problems.',
    balanced: 'Non-metric signal ingestion (support, reviews, community) summarized into patterns.',
  },
  network: {
    plain: 'How companies like yours — same stage, same size — are doing, anonymously. Foundry uses this to warn you early when one of your numbers drifts into the danger zone.',
    balanced: 'Anonymous peer benchmarks (stage × MRR cell) powering early-warning radar.',
  },
  memory: {
    plain: 'Everything your company has learned, in one place: decisions made, beliefs recorded, which held up and which did not. This is why advice gets sharper the longer you are here.',
    balanced: 'The institutional memory: decisions, premises, and their outcomes over time.',
  },
  competitive: {
    plain: 'Who you are up against and what they are doing — tracked so a competitor move never catches you flat-footed.',
    balanced: 'Competitor tracking and positioning deltas.',
  },
  standing_orders: {
    plain: 'Rules you set once and Foundry follows forever — like "if churn passes 8%, alert me and pause the ad spend." You write the policy; it does the watching.',
    balanced: 'Trigger→action policies executed automatically; you author, Foundry enforces.',
  },
  ambient: {
    plain: 'The work Foundry does in the background while you are away — quiet monitoring, small fixes, notes for your next visit.',
    balanced: 'Background operations log: monitoring, low-gate actions, accumulated notes.',
  },
  roi: {
    plain: 'What Foundry has actually been worth to you — time saved, problems caught early, decisions improved — measured honestly, including where it has not helped.',
    balanced: 'Measured value delivered (and not delivered) — honest accounting.',
  },
  benchmarks: {
    plain: 'Your key numbers next to companies at your stage — so "is 5% churn bad?" always has an answer with context.',
    balanced: 'Peer-cell metric comparisons (abstains below 5 peers).',
  },
  connections: {
    plain: 'Plug in the tools you already use, and decide exactly what Foundry may do with each one — like "send up to 25 emails a month." It can never do more than you allowed, everything it does is written down here, and you can take any permission back instantly.',
    balanced: 'Connect any MCP server; grants are tool-scoped, call-capped, expiring, revocable. Every call routes the gateway (idempotent, audited, kill-switchable).',
  },
};

export function explain(key: string, f: Fluency): string {
  if (f === 'technical') return '';
  return EXPLAINERS[key]?.[f] ?? '';
}

/** Sidebar nav key → explainer, for the strip the layout renders on every page.
 *  Pages that render their own strip in-page (dashboard, decisions, letter…)
 *  are deliberately absent so nothing shows twice. */
const NAV_EXPLAINER_KEYS: Record<string, string> = {
  'agents': 'roster',
  'agents-debate': 'debate',
  'agents-accuracy': 'accuracy',
  'agents-transparency': 'transparency',
  'agents-intelligence': 'agent_intelligence',
  'agents-actions': 'actions',
  'scenarios': 'scenarios',
  'board': 'board',
  'investors': 'board',
  'exit': 'exit',
  'brief': 'weekly_brief',
  'signals-multimodal': 'multimodal',
  'network': 'network',
  'memory': 'memory',
  'competitive': 'competitive',
  'playbooks-execution': 'standing_orders',
  'ambient': 'ambient',
  'roi': 'roi',
  'benchmarks': 'benchmarks',
};

export function navExplain(activeNav: string, f: Fluency): string {
  const key = NAV_EXPLAINER_KEYS[activeNav];
  return key ? explain(key, f) : '';
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
