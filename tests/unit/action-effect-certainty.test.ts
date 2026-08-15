import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const source = readFileSync(resolve(__dirname, '../../src/services/scp/actions/executor.ts'), 'utf8');

describe('approved action effect certainty', () => {
  it('guards custom webhook targets before the only transport attempt', () => {
    const start = source.indexOf('async function executeWebhook');
    const body = source.slice(start);
    expect(body.indexOf('assertUrlSafe')).toBeGreaterThan(0);
    expect(body.indexOf('assertUrlSafe')).toBeLessThan(body.indexOf('await fetch'));
    expect(body).toContain("effect_certainty: 'not_attempted'");
  });

  it('does not collapse provider rejection, acknowledgment, and transport ambiguity', () => {
    expect(source).toContain("effect_certainty: 'provider_rejected'");
    expect(source).toContain("effect_certainty: 'provider_acknowledged'");
    expect(source).toContain("effect_certainty: 'ambiguous'");
    expect(source).toContain('reconcile_after: new Date');
  });
});
