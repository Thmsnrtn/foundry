// =============================================================================
// A DECISION FORM CARRIES ITS VALUES ESCAPED (remediation 1.6, 6 October 2026).
//
// `renderDecision` built its hidden inputs, and the list of what an approval
// does not authorise, with `raw()` and unescaped values. Nothing from outside
// the institution reaches either today — the hidden values are Foundry's own
// ids and the word "approved", the list is constant text — so this was not an
// exploitable hole. It was one caller away from one: a value with a quote ends
// the attribute, and an angle bracket opens a tag. The form now escapes both,
// so the next caller cannot make it one.
// =============================================================================
import { describe, expect, it } from 'vitest';
import { renderDecision } from '../../src/routes/dashboard/decision-control.js';

const consequence = {
  what: 'let the test begin', effect: 'internal' as const, touches: 'nobody', expectedCents: 0, maxCents: 0,
  expires: null, reversibility: 'reversible' as const,
  doesNotAuthorise: ['contacting <b>anybody</b>', 'saying "yes" for you'], dedicated: null,
};

describe('the values a decision form carries', () => {
  it('a quote and an angle bracket in a hidden value cannot leave its attribute', async () => {
    const out = String(await renderDecision({
      consequence: consequence as never, action: '/foundry/x',
      hidden: { experimentId: 'abc"><script>alert(1)</script>', decision: 'approved' },
    }));
    expect(out).not.toContain('<script>');
    expect(out).not.toContain('abc">');
    expect(out).toContain('value="abc&quot;&gt;&lt;script&gt;alert(1)&lt;/script&gt;"');
    expect(out).toContain('name="decision" value="approved"');
  });

  it('what an approval does not authorise is text, not markup', async () => {
    const out = String(await renderDecision({ consequence: consequence as never, action: '/foundry/x', hidden: {} }));
    expect(out).not.toContain('<b>anybody</b>');
    expect(out).toContain('contacting &lt;b&gt;anybody&lt;/b&gt;');
    expect(out).toContain('saying &quot;yes&quot; for you');
  });
});
