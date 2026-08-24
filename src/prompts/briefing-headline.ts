// =============================================================================
// FOUNDRY — Briefing Headline Prompt (Wave 3, action 24)
// Centralized typed builder for the daily-briefing headline. Extracted from
// src/services/scp/briefing.ts. The caller dispatches via callSonnet.
// =============================================================================

export interface BriefingHeadlineInput {
  companyName: string;
  observations: Array<{ display_name: string; contribution: string | null }>;
  destinationBlock: string;       // empty string when no North Star
}

export interface BriefingPromptPair {
  system: string;
  user: string;
  maxTokens: number;
}

// ─── Builder ──────────────────────────────────────────────────────────────────

export function buildBriefingHeadlinePrompt(
  input: BriefingHeadlineInput
): BriefingPromptPair {
  const observationsList = input.observations
    .filter((o) => o.contribution)
    .map((o) => `${o.display_name}: ${o.contribution}`)
    .join('\n');

  const destinationFrame = input.destinationBlock
    ? `\nNorth Star context:\n${input.destinationBlock}\n`
    : '';

  const system =
    'You write precise, specific one-line business summaries. No generic statements.';

  const user =
    `In max 120 characters, summarize the key development for ${input.companyName} today based on these agent observations:\n` +
    `${observationsList}\n${destinationFrame}\n` +
    `Be specific and concrete, not generic. When North Star context is provided, prefer phrasings that reference progress or pace toward it. Return only the headline text.`;

  return { system, user, maxTokens: 150 };
}

// ─── Golden cases, mounted by tests/evals/prompt-golden-cases.eval.test.ts ───

export const GOLDEN_CASES: Array<{
  name: string;
  input: BriefingHeadlineInput;
  expected: { contains_company: boolean; max_chars: number; mentions_destination_when_present: boolean };
}> = [
  {
    name: 'no-observations',
    input: {
      companyName: 'TestCo',
      observations: [],
      destinationBlock: '',
    },
    expected: { contains_company: true, max_chars: 120, mentions_destination_when_present: false },
  },
  {
    name: 'observations-no-destination',
    input: {
      companyName: 'TestCo',
      observations: [
        { display_name: 'Beacon', contribution: 'Trial conversion up 18%' },
        { display_name: 'Harbor', contribution: 'Two churn risks flagged' },
      ],
      destinationBlock: '',
    },
    expected: { contains_company: true, max_chars: 120, mentions_destination_when_present: false },
  },
  {
    name: 'with-destination',
    input: {
      companyName: 'TestCo',
      observations: [{ display_name: 'Forge', contribution: 'Pricing test +18%' }],
      destinationBlock: 'North Star: Hit $50K MRR by end of 2026.\nProgress: $5K / $50K MRR (10%)',
    },
    expected: { contains_company: true, max_chars: 120, mentions_destination_when_present: true },
  },
];
