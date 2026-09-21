// =============================================================================
// A POLITE QUESTION CAN BE AN INSTRUCTION.
//
// An independent reviewer put three sentences through the door and found that
// two of them were filed as idle curiosity:
//
//   "Could you stop this search?"        -> a question
//   "Please stop contacting people?"     -> a question
//   "What have you done this week?"      -> a question   (correctly)
//
// The first two are boundaries. The owner should not have to learn imperative
// syntax to stop his own institution from doing something, and a trailing
// question mark is not evidence about what a sentence is FOR.
//
// THE CAUSE, NOT THE TWO EXAMPLES. The door decided grammatical form before
// operational content: any sentence ending in "?" went to the question door
// before a single action reader was consulted, and the only exemption was a
// list of negative OPENINGS ("do not", "don't", "never", "no"). Every polite
// framing in English sits outside that list.
//
// The repair is ordering and one distinction, not a new parser: the readers
// that already recognise these acts are asked first, and a sentence that both
// asks and instructs is resolved by WHICH KIND of asking it is. "Could you",
// "please", "would you" frame an instruction. "What", "how", "why" open an
// enquiry — and where an enquiry also names a consequential act, the answer is
// one clarification rather than a confident guess in either direction.
//
// Interpretation is not authorisation. Nothing here decides whether an act may
// happen; it decides what the owner meant. The deterministic authority system
// still governs everything consequential.
// =============================================================================
process.env.TURSO_DATABASE_URL = 'file::memory:';
process.env.ENCRYPTION_KEY = '0'.repeat(64);
process.env.FOUNDRY_INSTANCE_POSTURE = 'private_owner';
process.env.FOUNDRY_OWNER_EMAIL = 'owner@example.com';

import { describe, expect, it } from 'vitest';
import { whichDoor } from '../../src/services/institution/the-door.js';

const searching = { searching: true };

describe('the two sentences a reviewer found, and the class they belong to', () => {
  it('"Could you stop this search?" is a boundary, not an enquiry', () => {
    const d = whichDoor('Could you stop this search?', searching);
    expect(d.destination, 'a polite frame around an instruction is an instruction').toBe('venture');
    expect(d.understoodAs).toContain('stop looking');
  });

  it('"Please stop contacting people?" holds the outreach', () => {
    const d = whichDoor('Please stop contacting people?', searching);
    expect(d.destination).toBe('authority');
    expect(d.understoodAs).toContain('hold off writing');
  });

  it('and "What have you done this week?" is still a question', () => {
    expect(whichDoor('What have you done this week?', searching).destination).toBe('question');
  });
});

describe('every polite frame, not the two that were reported', () => {
  const politely = [
    'Could you stop contacting people?',
    'Can you stop writing to anyone?',
    'Would you hold off sending for now?',
    'Please could you pause outreach?',
    'Will you stop emailing people?',
    'Do you mind holding off on sending anything?',
  ];
  for (const said of politely) {
    it(`"${said}" reaches the act, not the answer desk`, () => {
      const d = whichDoor(said, searching);
      expect(d.destination, `${said} — a boundary said politely is still a boundary`).toBe('authority');
    });
  }

  it('a polite frame with nothing to act on is still a question', () => {
    // POLITENESS IS NOT THE TRIGGER. "Could you" only changes the reading of a
    // sentence that carries an act; on its own it is how people ask things.
    const d = whichDoor('Could you tell me what happened this week?', searching);
    expect(d.destination).toBe('question');
  });
});

describe('an enquiry that names a consequential act asks him which he meant', () => {
  it('"Should I stop the search?" is not silently obeyed, and not silently ignored', () => {
    const d = whichDoor('Should I stop the search?', searching);
    expect(d.destination, 'a real ambiguity is worth one question').toBe('clarify');
    expect(d.needs, 'and it says what it would do if he meant it').toMatch(/stop looking|stop the search/i);
    expect(d.said, 'his words are kept exactly').toBe('Should I stop the search?');
  });

  it('"What happens if you stop contacting people?" is a question about an act, not the act', () => {
    const d = whichDoor('What happens if you stop contacting people?', searching);
    expect(d.destination).toBe('clarify');
    expect(d.needs).toMatch(/hold off writing/i);
  });
});

describe('the rest of the class the corpus has to cover', () => {
  it('a negation still overrides the question mark, as it always did', () => {
    expect(whichDoor("Don't contact anyone?", searching).destination).toBe('authority');
  });

  it('a compound constraint keeps both halves', () => {
    // "Hold off sending but keep looking" is one sentence with two acts, and
    // the hold is the consequential one.
    const d = whichDoor('Could you hold off sending but keep looking?', searching);
    expect(d.destination).toBe('authority');
    expect(d.understoodAs).toContain('hold off writing');
  });

  it('a correction of something just said is an instruction', () => {
    const d = whichDoor('Actually, please stop contacting people?', searching);
    expect(d.destination).toBe('authority');
  });

  it('and nothing here decides whether the act may happen', () => {
    // INTERPRETATION IS NOT AUTHORISATION. The door says what he meant. What
    // may follow from it is the authority system's, every time, and the door
    // hands off without deciding anything consequential itself.
    const d = whichDoor('Could you stop contacting people?', searching);
    expect(d.destination).toBe('authority');
    expect(d.handOffTo, 'the door does not act; it places').toBeNull();
  });
});

describe('and it reaches him through the route, not only the parser', () => {
  it('the clarification is a page with both readings on it, and nothing has happened', async () => {
    const { seedProductionShape, ownerApp, owner, asText } = await import('../helpers/world.js');
    await seedProductionShape({ searching: true });
    const me = owner(await ownerApp());
    const shown = asText(await (await me.ask('Should I stop the search?')).text());
    expect(shown).toContain('Are you asking me, or telling me?');
    expect(shown).toContain('Should I stop the search?');
    expect(shown).toContain('stop looking');
    expect(shown, 'and it says plainly that it has not acted').toContain('Nothing has happened either way');
  });

  it('a polite instruction goes straight to the act, with no extra question', async () => {
    const { ownerApp, owner, asText } = await import('../helpers/world.js');
    const me = owner(await ownerApp());
    const shown = asText(await (await me.ask('Please stop contacting people?')).text());
    expect(shown, 'he asked plainly enough; do not make him answer a second question')
      .not.toContain('Are you asking me, or telling me?');
    expect(shown).toMatch(/Hold all sending|Sending is already on hold/);
  });
});
