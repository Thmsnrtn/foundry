import { describe, expect, it } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';

describe('weekly email digest wiring', () => {
  it('uses the governed semantic email capability and contains no direct provider transport', () => {
    const source = readFileSync(resolve(__dirname, '../../src/services/scp/briefing/email-digest.ts'), 'utf8');
    expect(source).toMatch(/invoke\(\{/);
    expect(source).toMatch(/tool:\s*'send_email'/);
    expect(source).toMatch(/dedupKey:\s*`weekly-email-digest:/);
    expect(source).toMatch(/customerExternalId:\s*toEmail/);
    expect(source).not.toMatch(/api\.resend\.com|api\.sendgrid\.com|sendViaResend|sendViaSendGrid/);
  });
});
