import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { stripComments } from '../../scripts/lib/strip-comments.mjs';

// =============================================================================
// A RED BADGE THAT EXPLAINED NOTHING.
//
// When the executor refuses an action it writes the reason to `result_json` —
// "No executor registered for atlas: action architecture_proposal was not
// carried out". The actions page rendered the word "failed" and stopped there.
//
// It is not a rare row. `executeAction` dispatches on `integration_name`, and
// every agent-originated action carries the AGENT's name, so all of them reach
// the refusal. The page most needed to say why, and that was the one thing it
// withheld — which reads as a malfunction rather than as Foundry having no way
// to carry the action out.
//
// Whether these should be actions at all is a different question, recorded as
// OWNER_DECISIONS_PENDING §16 and deliberately not answered by showing a
// reason.
// =============================================================================

const view = () => stripComments(readFileSync(
  resolve(import.meta.dirname, '../../src/routes/dashboard/agents-integrations.ts'), 'utf8'));

describe('a failed action says why it failed', () => {
  it('reads the reason the executor stored', () => {
    const src = view();
    expect(/action\.status === 'failed'[\s\S]{0,200}action\.result/.test(src),
      'the reason exists in result_json; the row must read it').toBe(true);
  });

  it('renders it, not just the status word', () => {
    const src = view();
    // The badge alone was the whole cell before.
    expect(/\$\{reason \?/.test(src), 'the reason must reach the markup').toBe(true);
    expect(src).toContain('${action.status}');
  });

  it('shows nothing extra for actions that did not fail', () => {
    const src = view();
    // An executed or pending row must not carry an empty explanation box.
    expect(/const reason = action\.status === 'failed'/.test(src),
      'the reason is scoped to failures').toBe(true);
  });

  it('bounds what a stored reason can put on the page', () => {
    const src = view();
    expect(/\.slice\(0, *160\)/.test(src),
      'a stored error string is not a licence to render arbitrary length').toBe(true);
  });
});
