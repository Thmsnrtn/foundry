// =============================================================================
// FOUNDRY — Anthropic AI Client
// Wraps the Anthropic SDK for all Claude API calls.
// =============================================================================

import Anthropic from '@anthropic-ai/sdk';
import type { AIModel, AICallConfig, AIResponse } from '../../types/ai.js';

let _client: Anthropic | null = null;

export const MODELS = {
  OPUS: 'claude-opus-4-6' as AIModel,
  SONNET: 'claude-sonnet-4-5-20250929' as AIModel,
} as const;

function getClient(): Anthropic {
  if (!_client) {
    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) throw new Error('ANTHROPIC_API_KEY is required');
    _client = new Anthropic({ apiKey });
  }
  return _client;
}

/**
 * Make a Claude API call with the given configuration.
 */
export async function callClaude(config: AICallConfig): Promise<AIResponse> {
  const client = getClient();

  const response = await client.messages.create({
    model: config.model,
    max_tokens: config.maxTokens,
    temperature: config.temperature ?? 0.3,
    system: config.systemPrompt,
    messages: [{ role: 'user', content: config.userPrompt }],
  });

  const textContent = response.content
    .filter((block): block is Anthropic.TextBlock => block.type === 'text')
    .map((block) => block.text)
    .join('\n');

  return {
    content: textContent,
    model: config.model,
    usage: {
      input_tokens: response.usage.input_tokens,
      output_tokens: response.usage.output_tokens,
    },
    stop_reason: response.stop_reason,
  };
}

/**
 * Call Claude Opus for strategic/methodology execution.
 */
export async function callOpus(
  systemPrompt: string,
  userPrompt: string,
  maxTokens: number = 8192
): Promise<AIResponse> {
  return callClaude({
    model: MODELS.OPUS,
    maxTokens,
    systemPrompt,
    userPrompt,
  });
}

/**
 * Call Claude Sonnet for operational intelligence.
 */
export async function callSonnet(
  systemPrompt: string,
  userPrompt: string,
  maxTokens: number = 4096
): Promise<AIResponse> {
  return callClaude({
    model: MODELS.SONNET,
    maxTokens,
    systemPrompt,
    userPrompt,
  });
}

/**
 * Multi-turn Claude call with a full message history array.
 * Used by the conversational layer to maintain context across turns.
 */
export async function callClaudeMultiTurn(
  systemPrompt: string,
  messages: Array<{ role: 'user' | 'assistant'; content: string }>,
  maxTokens: number = 1024,
  useOpus: boolean = false,
): Promise<AIResponse> {
  const client = getClient();
  const model = useOpus ? MODELS.OPUS : MODELS.SONNET;

  const response = await client.messages.create({
    model,
    max_tokens: maxTokens,
    temperature: 0.3,
    system: systemPrompt,
    messages,
  });

  const textContent = response.content
    .filter((block): block is Anthropic.TextBlock => block.type === 'text')
    .map((block) => block.text)
    .join('\n');

  return {
    content: textContent,
    model,
    usage: {
      input_tokens: response.usage.input_tokens,
      output_tokens: response.usage.output_tokens,
    },
    stop_reason: response.stop_reason,
  };
}

/**
 * Parse a JSON response from Claude, handling markdown code fences.
 */
export function parseJSONResponse<T>(content: string): T {
  let cleaned = content.trim();
  // Remove markdown code fences if present
  if (cleaned.startsWith('```json')) {
    cleaned = cleaned.slice(7);
  } else if (cleaned.startsWith('```')) {
    cleaned = cleaned.slice(3);
  }
  if (cleaned.endsWith('```')) {
    cleaned = cleaned.slice(0, -3);
  }
  return JSON.parse(cleaned.trim()) as T;
}
