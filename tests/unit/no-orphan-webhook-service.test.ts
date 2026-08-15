import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync } from 'fs';
import { resolve } from 'path';

describe('canonical webhook ownership', () => {
  it('does not restore the unused hash-signed retrying webhook service', () => {
    expect(existsSync(resolve(__dirname, '../../src/services/api/webhooks.ts'))).toBe(false);
    const effectsAudit = readFileSync(resolve(__dirname, '../../scripts/audit-consequential-effects.mjs'), 'utf8');
    expect(effectsAudit).not.toContain('src/services/api/webhooks.ts');
  });
});
