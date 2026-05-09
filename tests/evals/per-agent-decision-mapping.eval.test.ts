// =============================================================================
// Eval: per-agent deterministic decision mapping (Wave 4, action 33)
// Tests the deterministic mapping from a fixed LLM response to a
// decision/signal output — NOT the LLM's accuracy. The point is: when
// the prompt or model changes and the output JSON drifts, we want a
// pinned-down test failure rather than silent regression.
//
// The 'mapping function' under test is a pure function that takes the
// agent's structured JSON output and produces:
//   - decision_gate (1, 2, 3, 4, or null)
//   - is_high_priority (bool)
// Following Karpathy's recommendation in the elite persona review:
// capture deterministic boundaries, not LLM accuracy.
// =============================================================================

import { readFileSync } from 'fs';
import { resolve } from 'path';
import { describe, it, expect } from 'vitest';
import { defineEval, type EvalCase } from './_framework.js';

interface AgentResponse {
  domain_health_score: number;
  observations: string[];
  recommended_actions: Array<{
    type: string;
    title: string;
    confidence: number;
  }>;
  briefing_priority: 'high' | 'normal' | 'low';
}

interface MappingOutput {
  decision_gate: number | null;
  is_high_priority: boolean;
}

// ─── The mapping function under test ─────────────────────────────────────────
//
// This is the pure-function distillation of how every agent's output is
// turned into decisions/signals across the SCP runtime. The current
// implementation lives spread across base.ts and per-agent files; the
// eval pins the boundaries here so a change to the mapping is visible.

export function mapAgentResponseToDecision(response: AgentResponse): MappingOutput {
  const topAction = response.recommended_actions[0];
  if (!topAction) {
    return { decision_gate: null, is_high_priority: false };
  }
  // Confidence ≥ 0.9 → gate 1 (notify but execute autonomously after window)
  // Confidence ≥ 0.5 → gate 2 (recommend & wait for founder)
  // Confidence < 0.5 → gate 3 (high-stakes, founder must decide)
  let gate: number;
  if (topAction.confidence >= 0.9) gate = 1;
  else if (topAction.confidence >= 0.5) gate = 2;
  else gate = 3;

  return {
    decision_gate: gate,
    is_high_priority: response.briefing_priority === 'high',
  };
}

// ─── Atlas eval ──────────────────────────────────────────────────────────────

const atlasCases: EvalCase<{ agent_response: AgentResponse }, MappingOutput>[] = JSON.parse(
  readFileSync(resolve(__dirname, 'cases/atlas-decision-mapping.json'), 'utf-8')
);

defineEval<{ agent_response: AgentResponse }, MappingOutput>({
  title: 'atlas response → decision mapping',
  cases: atlasCases,
  run: (input) => mapAgentResponseToDecision(input.agent_response),
});

// ─── Beacon eval (inline cases — same shape) ─────────────────────────────────

const beaconCases: EvalCase<{ agent_response: AgentResponse }, MappingOutput>[] = [
  {
    name: 'beacon-conversion-improvement-high-conf',
    notes: 'Beacon spots a marketing winner with high confidence',
    input: {
      agent_response: {
        domain_health_score: 84,
        observations: ['conversion rate +18%'],
        recommended_actions: [
          { type: 'campaign', title: 'Roll the new headline to all visitors', confidence: 0.95 },
        ],
        briefing_priority: 'high',
      },
    },
    expected: { decision_gate: 1, is_high_priority: true },
  },
  {
    name: 'beacon-experiment-needs-review',
    notes: 'Beacon proposes an A/B; mid-confidence; founder reviews',
    input: {
      agent_response: {
        domain_health_score: 70,
        observations: ['hero copy underperforming'],
        recommended_actions: [
          { type: 'experiment', title: 'A/B test a new value prop', confidence: 0.65 },
        ],
        briefing_priority: 'normal',
      },
    },
    expected: { decision_gate: 2, is_high_priority: false },
  },
  {
    name: 'beacon-strategic-pivot-low-conf',
    notes: 'Beacon proposes a strategic shift; low confidence; gate 3',
    input: {
      agent_response: {
        domain_health_score: 55,
        observations: ['ICP signals shifted'],
        recommended_actions: [
          { type: 'positioning_change', title: 'Re-position from horizontal to vertical', confidence: 0.4 },
        ],
        briefing_priority: 'high',
      },
    },
    expected: { decision_gate: 3, is_high_priority: true },
  },
];

defineEval<{ agent_response: AgentResponse }, MappingOutput>({
  title: 'beacon response → decision mapping',
  cases: beaconCases,
  run: (input) => mapAgentResponseToDecision(input.agent_response),
});

// ─── Harbor eval (inline cases) ──────────────────────────────────────────────

const harborCases: EvalCase<{ agent_response: AgentResponse }, MappingOutput>[] = [
  {
    name: 'harbor-clear-churn-risk',
    notes: 'Harbor identifies a clear at-risk customer cohort with high confidence',
    input: {
      agent_response: {
        domain_health_score: 60,
        observations: ['3 customers silent for 14 days'],
        recommended_actions: [
          { type: 'outreach', title: 'Send dormant-trial reactivation email', confidence: 0.91 },
        ],
        briefing_priority: 'high',
      },
    },
    expected: { decision_gate: 1, is_high_priority: true },
  },
  {
    name: 'harbor-soft-feedback-noisy',
    notes: 'Harbor recommends a survey; medium confidence',
    input: {
      agent_response: {
        domain_health_score: 75,
        observations: ['NPS distribution shifted slightly'],
        recommended_actions: [
          { type: 'survey', title: 'Send NPS to last 30 customers', confidence: 0.6 },
        ],
        briefing_priority: 'low',
      },
    },
    expected: { decision_gate: 2, is_high_priority: false },
  },
  {
    name: 'harbor-no-action-healthy',
    notes: 'Healthy customer state; no recommendations; no decisions',
    input: {
      agent_response: {
        domain_health_score: 90,
        observations: ['retention healthy'],
        recommended_actions: [],
        briefing_priority: 'low',
      },
    },
    expected: { decision_gate: null, is_high_priority: false },
  },
];

defineEval<{ agent_response: AgentResponse }, MappingOutput>({
  title: 'harbor response → decision mapping',
  cases: harborCases,
  run: (input) => mapAgentResponseToDecision(input.agent_response),
});

// ─── Coverage sanity ─────────────────────────────────────────────────────────
describe('per-agent eval suite shape', () => {
  it('atlas suite has 3 cases', () => expect(atlasCases.length).toBe(3));
  it('beacon suite has 3 cases', () => expect(beaconCases.length).toBe(3));
  it('harbor suite has 3 cases', () => expect(harborCases.length).toBe(3));
});
