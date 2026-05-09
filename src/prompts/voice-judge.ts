// =============================================================================
// FOUNDRY — Voice Judge Prompt (Wave 3, action 24)
// Typed builder for the voice-fingerprint judge. Extracted from
// src/services/calibration/voice-fingerprint.ts. Caller dispatches via
// callSonnet and parses the JSON response.
// =============================================================================

export interface VoiceJudgeInput {
  fingerprint: {
    register: string | null;
    energy: string | null;
    pov: string | null;
    sentence_rhythm: string | null;
    lexical_preferences: string[];
    exemplar_sentences: string[];
  };
  draftText: string;
}

export interface VoiceJudgePromptPair {
  system: string;
  user: string;
  maxTokens: number;
}

// ─── Builder ──────────────────────────────────────────────────────────────────

export function buildVoiceJudgePrompt(input: VoiceJudgeInput): VoiceJudgePromptPair {
  const fp = input.fingerprint;
  const exemplars = fp.exemplar_sentences
    .map((s, i) => `${i + 1}. ${s}`)
    .join('\n');
  const lexical = fp.lexical_preferences.join(', ') || '(none specified)';

  const system = [
    'You are a voice-and-tone judge. You score draft text against a defined product voice fingerprint.',
    'Return JSON only. No prose outside JSON.',
    'Required JSON shape: {"score":0-100,"register":0-100,"rhythm":0-100,"lexical":0-100,"energy":0-100,"rationale":"<one sentence>"}',
    'Be strict. Generic SaaS-median copy should score ≤55. In-voice copy should score ≥75.',
  ].join('\n');

  const user = [
    'Voice fingerprint:',
    `- register: ${fp.register ?? '(unspecified)'}`,
    `- energy: ${fp.energy ?? '(unspecified)'}`,
    `- pov: ${fp.pov ?? '(unspecified)'}`,
    `- sentence rhythm: ${fp.sentence_rhythm ?? '(unspecified)'}`,
    `- lexical preferences: ${lexical}`,
    '',
    'Exemplar sentences (the voice we want):',
    exemplars,
    '',
    'Draft text to score:',
    input.draftText,
    '',
    'Return JSON only.',
  ].join('\n');

  return { system, user, maxTokens: 600 };
}

// ─── Golden cases ────────────────────────────────────────────────────────────

export const GOLDEN_CASES: Array<{
  name: string;
  input: VoiceJudgeInput;
  expected: { contains_required_fields: string[]; rationale_present: boolean };
}> = [
  {
    name: 'plainspoken-fingerprint-on-voice',
    input: {
      fingerprint: {
        register: 'plainspoken',
        energy: 'measured',
        pov: 'second-person operator',
        sentence_rhythm: 'short and direct',
        lexical_preferences: ['specific over abstract', 'verbs over nouns'],
        exemplar_sentences: [
          'Foundry runs a small council of AI agents on your repo.',
          'You set the pace. They earn the trust.',
        ],
      },
      draftText: 'Foundry watches your business so you do not have to.',
    },
    expected: {
      contains_required_fields: ['score', 'register', 'rhythm', 'lexical', 'energy', 'rationale'],
      rationale_present: true,
    },
  },
  {
    name: 'plainspoken-fingerprint-off-voice',
    input: {
      fingerprint: {
        register: 'plainspoken',
        energy: 'measured',
        pov: 'second-person operator',
        sentence_rhythm: 'short and direct',
        lexical_preferences: ['specific over abstract'],
        exemplar_sentences: ['Foundry runs a small council of AI agents on your repo.'],
      },
      draftText: 'Leverage cutting-edge AI to transform your business operations and unleash next-generation synergy.',
    },
    expected: {
      contains_required_fields: ['score', 'register', 'rhythm', 'lexical', 'energy', 'rationale'],
      rationale_present: true,
    },
  },
];
