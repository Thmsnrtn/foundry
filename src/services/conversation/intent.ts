// =============================================================================
// FOUNDRY — Conversation Intent Classifier
// Classifies the founder's message to route to the right response strategy.
// Also detects actionable requests so the AI can take action, not just talk.
// =============================================================================

import { callSonnet, parseJSONResponse } from '../ai/client.js';
import type { ConversationIntent } from '../../types/index.js';

export interface ClassifiedIntent {
  intent: ConversationIntent;
  confidence: number;
  actionable: boolean;
  action_type?: 'create_decision' | 'resolve_stressor' | 'update_metric' | 'create_stressor' | 'save_note';
  entities: {
    metric_name?: string;
    metric_value?: number;
    stressor_name?: string;
    decision_what?: string;
    decision_category?: string;
  };
}

const INTENT_EXAMPLES: Record<ConversationIntent, string[]> = {
  explain: [
    'why did my signal drop?', 'what does health ratio mean?',
    'explain my churn stressor', 'what is causing this?', 'why now?',
  ],
  compare: [
    'compare this week to last week', 'how does my activation compare to average?',
    'is my churn rate good?', 'how am I doing vs similar products?',
  ],
  scenario: [
    'what happens if I raise prices 20%?', 'what if I lose my biggest customer?',
    'model the impact of improving activation by 10 points',
    'if churn drops to 3%, what does that do to MRR?',
  ],
  action: [
    'create a decision about pricing', 'my biggest customer churned',
    'mark the activation stressor as resolved', 'log that we shipped the onboarding redesign',
    'create a stressor for our support spike',
  ],
  search: [
    'show me all decisions I made about pricing', 'when did I last change pricing?',
    'find decisions where the outcome was negative', 'what stressors have I resolved?',
    'show my decision history', 'what happened in January?',
  ],
  general: [
    'what should I focus on today?', 'give me a briefing',
    'what is the most important thing right now?', 'how is the business?',
  ],
};

/**
 * Classify the intent of a founder's message using a fast Sonnet call.
 * Falls back to 'general' if classification fails.
 */
export async function classifyIntent(message: string): Promise<ClassifiedIntent> {
  const systemPrompt = `You are a business message intent classifier for a SaaS analytics platform.
Classify the message into exactly one intent category.
Also detect if the message implies an action the system should take.

Intent categories:
- explain: asking WHY something happened or what something means
- compare: asking how something compares (to averages, prior periods, benchmarks)
- scenario: asking "what if" or to model a hypothetical
- action: requesting the system to create, update, or record something
- search: looking for historical data, past decisions, or past events
- general: general business status, briefing, or priority questions

Respond with JSON only:
{
  "intent": "<category>",
  "confidence": 0.0-1.0,
  "actionable": true/false,
  "action_type": "<create_decision|resolve_stressor|update_metric|create_stressor|save_note|null>",
  "entities": {
    "metric_name": "<if action involves a metric>",
    "metric_value": <number or null>,
    "stressor_name": "<if action involves a stressor>",
    "decision_what": "<the decision topic if creating a decision>",
    "decision_category": "<urgent|strategic|product|marketing|informational>"
  }
}`;

  const userPrompt = `Message: "${message}"`;

  try {
    const response = await callSonnet(systemPrompt, userPrompt, 256);
    const result = parseJSONResponse<ClassifiedIntent>(response.content);
    return {
      intent: result.intent ?? 'general',
      confidence: result.confidence ?? 0.7,
      actionable: result.actionable ?? false,
      action_type: result.action_type,
      entities: result.entities ?? {},
    };
  } catch {
    return { intent: 'general', confidence: 0.5, actionable: false, entities: {} };
  }
}

/**
 * Build the system prompt for the AI based on the classified intent.
 */
export function buildSystemPromptForIntent(intent: ConversationIntent): string {
  const base = `You are the Foundry AI — an autonomous business intelligence partner for SaaS founders.
You have complete context of this founder's business: Signal score, stressors, decisions, revenue, cohorts, and product wisdom.
You speak as a co-founder who has studied this business deeply. Direct, honest, no hedging.
Never say "you might want to" or "consider". State facts and what they mean.
Never ask clarifying questions unless absolutely required. Make your best judgment with the data available.
Keep responses tight: 3-6 sentences for explanations, 2-3 for status updates.`;

  const intentInstructions: Record<ConversationIntent, string> = {
    explain: `\nFocus: trace the cause clearly. Cite specific data points. End with one concrete action.`,
    compare: `\nFocus: provide the comparison with actual numbers. State what the gap means for the business.`,
    scenario: `\nFocus: run the scenario with real numbers from the context. State best/base/stress outcomes.
Show your math. Be precise about timeframes.`,
    action: `\nFocus: confirm what action you're taking. State what you created/updated. Explain why it matters.`,
    search: `\nFocus: surface the historical data directly. Identify patterns if they exist.`,
    general: `\nFocus: give the most important truth about the business right now. What matters most, and why.`,
  };

  return base + (intentInstructions[intent] ?? '');
}
