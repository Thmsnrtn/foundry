import { describe, expect, it } from 'vitest';
import { inflectionTypeBadge } from '../../src/routes/dashboard/agents-temporal.js';

describe('raw HTML provenance', () => {
  it('escapes model-controlled inflection types instead of trusting generated markup', () => {
    const rendered = String(inflectionTypeBadge('signal_spike"><script>alert(1)</script>'));
    expect(rendered).not.toContain('<script>');
    expect(rendered).toContain('&lt;script&gt;');
  });
});
