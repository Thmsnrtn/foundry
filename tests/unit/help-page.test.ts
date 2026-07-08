// =============================================================================
// Tests: Help & support page (Phase 5.5)
// =============================================================================

import { describe, it, expect } from 'vitest';
import { helpRoutes } from '../../src/routes/public/landing.js';

describe('/help', () => {
  it('renders an HTML help page with FAQ and a support email', async () => {
    const res = await helpRoutes.request('/help');
    expect(res.status).toBe(200);
    const body = await res.text();
    expect(body).toContain('Help &amp; Support');
    expect(body).toContain('14-day trial');       // a real FAQ answer
    expect(body).toMatch(/mailto:[^"]+@/);          // support email link
  });
});
