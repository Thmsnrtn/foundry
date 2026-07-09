// =============================================================================
// Eval: system-prompt assembly invariants (Roadmap 2.7 — prompt net in CI)
//
// buildSystemPrompt() is the shared scaffold every one of the 12+ SCP agents
// runs through. It is pure and deterministic, and it carries two invariants a
// prompt edit can silently break — the kind of regression that "drifts silently"
// until a founder notices (Karpathy, elite review):
//
//   1. COST (2.2): nothing volatile (date, messages, integration events) may
//      appear BEFORE the CACHE_BREAKPOINT. The stable prefix is what Anthropic
//      prompt-caching keys on; a single volatile byte in the prefix makes the
//      cache miss on every run and inflates input cost 60–90%. This is money.
//   2. CONTRACT: the C-suite output standard (POSITION/CONFIDENCE/STAKES/
//      ACTION/SIGNAL) must remain in the prompt. Delete it and every agent
//      quietly reverts to generic prose — the exact "generic MBA advice"
//      failure the product exists to avoid.
//
// These assert behavior a unit test wouldn't think to check, and fail loudly in
// CI the moment a prompt edit moves them. No LLM call — fully deterministic.
// =============================================================================

import { describe, it, expect } from 'vitest';
import { BaseAgent } from '../../src/services/scp/agents/base.js';
import { CACHE_BREAKPOINT } from '../../src/services/ai/client.js';
import type {
  AgentName,
  AgentRunContext,
  AgentAnalysisResult,
  AgentInstance,
} from '../../src/services/scp/types.js';
import type { query } from '../../src/db/client.js';

// Minimal concrete agent that only exposes the protected assembler.
class ProbeAgent extends BaseAgent {
  getName(): AgentName {
    return 'atlas';
  }
  getRole(): string {
    return 'probe';
  }
  getActivationCadenceHours(): number {
    return 24;
  }
  protected async analyzeAndAct(): Promise<AgentAnalysisResult> {
    throw new Error('not used in this eval');
  }
  // Expose the protected method for assertion.
  public assemble(context: AgentRunContext, domain: string): string {
    return this.buildSystemPrompt(context, domain);
  }
}

const AGENT_INSTANCE = { id: 'a1', agent_name: 'atlas', display_name: 'Atlas' } as unknown as AgentInstance;
const DOMAIN_PROMPT = 'You are ATLAS, the strategy chief. Advise the CEO.';

// A stable context plus the two volatile knobs the caller varies run-to-run.
function ctx(overrides: Partial<AgentRunContext>): AgentRunContext {
  return {
    productId: 'p1',
    companyName: 'Acme',
    agentInstance: AGENT_INSTANCE,
    goldenLessons: [],
    constitution: null,
    runDate: '2026-01-01',
    ...overrides,
  };
}

const probe = new ProbeAgent();
const before = (prompt: string): string => prompt.slice(0, prompt.indexOf(CACHE_BREAKPOINT));
const after = (prompt: string): string => prompt.slice(prompt.indexOf(CACHE_BREAKPOINT) + CACHE_BREAKPOINT.length);

describe('system-prompt assembly invariants', () => {
  it('places exactly one cache breakpoint', () => {
    const prompt = probe.assemble(ctx({}), DOMAIN_PROMPT);
    const count = prompt.split(CACHE_BREAKPOINT).length - 1;
    expect(count, 'prompt must contain exactly one CACHE_BREAKPOINT').toBe(1);
  });

  it('keeps the cached prefix byte-identical when only volatile inputs change (2.2 cost)', () => {
    // Same stable context, different volatile inputs (date, messages, events).
    const runA = probe.assemble(
      ctx({
        runDate: '2026-01-01',
        unreadMessages: [{ from_agent: 'compass', priority: 'high', subject: 'S-A', body: 'body-a', sent_at: 'x' }],
        integrationEvents: [{ source: 'stripe', event_type: 'churn', summary: 'sum-a', created_at: 'x' }],
      }),
      DOMAIN_PROMPT,
    );
    const runB = probe.assemble(
      ctx({
        runDate: '2026-12-31',
        unreadMessages: [{ from_agent: 'harbor', priority: 'low', subject: 'S-B', body: 'body-b', sent_at: 'y' }],
        integrationEvents: [{ source: 'posthog', event_type: 'signup', summary: 'sum-b', created_at: 'y' }],
      }),
      DOMAIN_PROMPT,
    );
    // The cached (pre-breakpoint) region must not depend on any volatile input.
    expect(before(runA)).toBe(before(runB));
  });

  it('emits volatile data only AFTER the breakpoint (cache safety)', () => {
    const prompt = probe.assemble(
      ctx({
        runDate: '2026-07-04',
        unreadMessages: [{ from_agent: 'compass', priority: 'high', subject: 'UNIQUE_SUBJECT_XYZ', body: 'b', sent_at: 'x' }],
        integrationEvents: [{ source: 'stripe', event_type: 'churn', summary: 'UNIQUE_EVENT_XYZ', created_at: 'x' }],
      }),
      DOMAIN_PROMPT,
    );
    const prefix = before(prompt);
    for (const volatile of ['2026-07-04', 'UNIQUE_SUBJECT_XYZ', 'UNIQUE_EVENT_XYZ']) {
      expect(prefix.includes(volatile), `volatile "${volatile}" leaked into the cached prefix`).toBe(false);
      expect(after(prompt).includes(volatile), `volatile "${volatile}" missing after breakpoint`).toBe(true);
    }
  });

  it('preserves the C-suite output contract in the cached prefix', () => {
    const prompt = probe.assemble(ctx({}), DOMAIN_PROMPT);
    const prefix = before(prompt);
    for (const marker of ['POSITION:', 'CONFIDENCE:', 'STAKES:', 'ACTION:', 'SIGNAL:']) {
      expect(prefix.includes(marker), `output-contract marker "${marker}" missing from prompt`).toBe(true);
    }
    // The domain persona must lead the prompt (cache-stable, agent-identifying).
    expect(prefix.startsWith(DOMAIN_PROMPT)).toBe(true);
  });

  it('injects golden lessons and operating principles into the cached prefix', () => {
    const prompt = probe.assemble(
      ctx({
        goldenLessons: [{ lesson: 'GOLDEN_LESSON_MARKER' } as never],
        constitution: { operating_principles: ['PRINCIPLE_MARKER'] } as never,
      }),
      DOMAIN_PROMPT,
    );
    const prefix = before(prompt);
    expect(prefix.includes('GOLDEN_LESSON_MARKER')).toBe(true);
    expect(prefix.includes('PRINCIPLE_MARKER')).toBe(true);
  });
});
