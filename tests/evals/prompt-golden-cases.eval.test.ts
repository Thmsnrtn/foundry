// =============================================================================
// Eval: the golden cases are mounted
//
// `src/prompts/README.md` states the contract for this directory: "every prompt
// that touches an LLM must have a typed builder + golden cases mounted in the
// eval framework", and "the eval framework imports the same builder used in
// production, so eval coverage is real".
//
// NEITHER HALF WAS TRUE. No file outside `src/prompts/` referenced
// `GOLDEN_CASES` — not here, not anywhere — so both modules' cases had never
// been run by anything. And `voice-judge.ts` was not the builder production
// used: `voice-fingerprint.ts` kept its own copy, the two had drifted, and the
// live one fenced the untrusted draft in triple quotes while the golden-case
// one interpolated it bare. Cases scoring a prompt the product does not send
// are not coverage.
//
// WHAT A NO-MODEL EVAL CAN HONESTLY ASSERT, and where it stops. It cannot say
// what the model will answer, so it does not touch `contains_company` as a
// property of a HEADLINE or `rationale_present` as a property of a REPLY. What
// it can say is that the builder carries every input the case supplies into the
// prompt, and that the constraint the case names is the constraint the prompt
// states — a case declaring `max_chars: 120` against a prompt that asks for 140
// is a case measuring nothing, and that is exactly the drift this directory
// exists to catch.
// =============================================================================

import { describe, expect, it } from 'vitest';
import {
  buildBriefingHeadlinePrompt,
  GOLDEN_CASES as HEADLINE_CASES,
} from '../../src/prompts/briefing-headline.js';
import {
  buildVoiceJudgePrompt,
  GOLDEN_CASES as VOICE_CASES,
} from '../../src/prompts/voice-judge.js';

describe('briefing-headline golden cases run against the production builder', () => {
  it('has cases', () => { expect(HEADLINE_CASES.length).toBeGreaterThan(0); });

  for (const c of HEADLINE_CASES) {
    describe(c.name, () => {
      const built = buildBriefingHeadlinePrompt(c.input);

      it('names the company the case says it should contain', () => {
        expect(c.expected.contains_company).toBe(true);
        expect(built.user).toContain(c.input.companyName);
      });

      it('states the character limit the case measures against', () => {
        expect(built.user).toContain(`max ${c.expected.max_chars} characters`);
      });

      it('carries the destination block if and only if the case supplies one', () => {
        expect(c.expected.mentions_destination_when_present)
          .toBe(c.input.destinationBlock.length > 0);
        // The FRAME, not the phrase: the prompt's closing sentence mentions
        // North Star context unconditionally ("when North Star context is
        // provided, prefer phrasings that reference progress toward it"), so
        // matching the bare phrase would pass on every case and measure
        // nothing. What the builder adds conditionally is the labelled block.
        if (c.input.destinationBlock) {
          expect(built.user).toContain(`North Star context:\n${c.input.destinationBlock}`);
        } else {
          expect(built.user).not.toContain('North Star context:');
        }
      });

      it('carries every observation that has something to say, and no empty one', () => {
        for (const o of c.input.observations) {
          if (o.contribution) expect(built.user).toContain(o.contribution);
          else expect(built.user).not.toContain(`${o.display_name}: `);
        }
      });
    });
  }
});

describe('voice-judge golden cases run against the production builder', () => {
  it('has cases', () => { expect(VOICE_CASES.length).toBeGreaterThan(0); });

  it('is the builder the live judge dispatches, not a second copy of it', async () => {
    const { readFileSync } = await import('node:fs');
    const { stripComments } = await import('../../scripts/lib/strip-comments.mjs');
    const live = stripComments(
      readFileSync('src/services/calibration/voice-fingerprint.ts', 'utf8'),
      { lineComments: true },
    );
    expect(live).toContain('buildVoiceJudgePrompt');
    // The copies that drifted. Their absence is the point of this eval.
    expect(live).not.toContain('buildJudgeSystemPrompt');
    expect(live).not.toContain('buildJudgeUserPrompt');
  });

  for (const c of VOICE_CASES) {
    describe(c.name, () => {
      const built = buildVoiceJudgePrompt(c.input);

      it('demands exactly the fields the case expects back', () => {
        for (const field of c.expected.contains_required_fields) {
          expect(built.system, `required field ${field}`).toContain(`"${field}"`);
        }
      });

      it('asks for a rationale when the case expects one', () => {
        expect(c.expected.rationale_present).toBe(true);
        expect(built.system).toContain('rationale');
      });

      it('carries the fingerprint the case describes', () => {
        for (const value of [c.input.fingerprint.register, c.input.fingerprint.energy,
          c.input.fingerprint.pov, c.input.fingerprint.sentence_rhythm]) {
          if (value) expect(built.user).toContain(value);
        }
        for (const s of c.input.fingerprint.exemplar_sentences) expect(built.user).toContain(s);
        for (const l of c.input.fingerprint.lexical_preferences) expect(built.user).toContain(l);
      });

      it('fences the draft, which is text Foundry did not write', () => {
        expect(built.user).toContain(c.input.draftText);
        const fenced = built.user.match(/"""\n([\s\S]*?)\n"""/);
        expect(fenced, 'the draft must be delimited').toBeTruthy();
        expect(fenced![1]).toBe(c.input.draftText);
      });
    });
  }
});
