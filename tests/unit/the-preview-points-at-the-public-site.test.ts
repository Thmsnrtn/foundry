// =============================================================================
// THE PREVIEW POINTS AT THE PUBLIC SITE (remediation, 6 October 2026).
//
// `/foundry/public-workshop/preview/:id` serves the public page from Foundry's
// own origin, and the page's links are the public site's: `/privacy`,
// `/contact`, `/`. Served here they opened the owner's privacy settings, a
// 404 and the owner's own front door. The preview now carries the public site's base
// address, opens it in a new tab, and submits nothing.
// =============================================================================
process.env.TURSO_DATABASE_URL = 'file::memory:';
process.env.ENCRYPTION_KEY = '0'.repeat(64);
process.env.FOUNDRY_INSTANCE_POSTURE = 'private_owner';
process.env.FOUNDRY_OWNER_EMAIL = 'owner@example.com';

import { describe, expect, it } from 'vitest';
import { asPreview } from '../../src/routes/dashboard/workshop-place.js';

const PAGE = `<!DOCTYPE html><html lang="en"><head><title>x</title></head><body>
<a href="/privacy">privacy page</a><a href="/contact">Contact</a>
<form method="POST" action="/experiments/x/continue"><button type="submit">Continue</button><input type="submit" value="Go"></form>
</body></html>`;

describe('the Workshop preview', () => {
  it("resolves the page's own links against the public site, in a new tab", () => {
    const out = asPreview(PAGE, 'https://apexmicro.ai');
    expect(out).toContain('<base href="https://apexmicro.ai/" target="_blank">');
    // Before the first link, so every relative address resolves against it.
    expect(out.indexOf('<base')).toBeLessThan(out.indexOf('href="/privacy"'));
    expect(new URL('/privacy', 'https://apexmicro.ai/').href).toBe('https://apexmicro.ai/privacy');
  });

  it('submits nothing: every button and submit input is drawn disabled', () => {
    const out = asPreview(PAGE, 'https://apexmicro.ai');
    expect(out).toContain('<button disabled type="submit">Continue</button>');
    expect(out).toContain('<input disabled type="submit" value="Go">');
    expect(out).not.toMatch(/<button(?![^>]*disabled)/);
  });

  it('says it is a preview, and asks the public site for no icon', () => {
    const out = asPreview(PAGE, 'https://apexmicro.ai');
    expect(out).toContain('A preview, drawn now from the rows.');
    expect(out).toContain('<link rel="icon" href="data:,">');
  });

  it('an origin with a quote cannot leave the attribute', () => {
    expect(asPreview(PAGE, 'https://a.test/"><script>x</script>')).not.toContain('<script>x');
  });

  it('is what the route serves, for a real experiment', async () => {
    const { seedProductionShape, ownerApp } = await import('../helpers/world.js');
    const { experimentId } = await seedProductionShape({ undecided: true });
    const res = await (await ownerApp()).request(`/foundry/public-workshop/preview/${experimentId}`);
    expect(res.status).toBe(200);
    const body = await res.text();
    expect(body).toMatch(/<base href="https:\/\/[^"]+\/" target="_blank">/);
    expect(body).not.toMatch(/<button(?![^>]*disabled)/);
  });
});
