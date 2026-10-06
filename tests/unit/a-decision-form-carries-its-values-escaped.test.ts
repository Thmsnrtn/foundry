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

// AND THE CARD ON HOME, which had the same `raw()` in three places: its facts,
// its later notes and its hidden fields. A company's name is the owner's own
// typing and a spend's reason can be a model's; neither is markup.
describe('the one thing on Home', () => {
  const spend = {
    kind: 'spend' as const, actId: 'act_1', productId: 'p_1',
    companyName: '<img src=x onerror=alert(1)>Candles',
    summary: 'Buy a domain', why: 'Because the listing needs one',
    rung: null, rungMeans: null, puttingItBack: 'Refund within <i>5</i> days',
    costCents: 1200, expiresAt: '2026-10-20T00:00:00Z', absorbable: null,
  };

  it('says a company name and a stated reason as text, not markup', async () => {
    const { theOneThing } = await import('../../src/routes/dashboard/foundry-shell.js');
    const out = String(await theOneThing(spend as never, { consequence: consequence as never }));
    expect(out).not.toContain('<img src=x');
    expect(out).toContain('&lt;img src=x onerror=alert(1)&gt;Candles');
    expect(out).not.toContain('<i>5</i>');
    expect(out).toContain('Refund within &lt;i&gt;5&lt;/i&gt; days');
    expect(out).not.toContain('<b>anybody</b>');
    // The markup the card means to draw is still drawn: the company is a link.
    expect(out).toContain('<a href="/foundry/companies/p_1#decide">');
  });
});
