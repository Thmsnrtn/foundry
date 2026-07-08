// =============================================================================
// Tests: Error page content negotiation (Phase 1.5)
// Browsers get branded HTML; API paths always get JSON.
// =============================================================================

import { describe, it, expect } from 'vitest';
import { wantsHtml, errorPage } from '../../src/views/error-page.js';

describe('wantsHtml content negotiation', () => {
  it('returns true for a browser navigation to a page route', () => {
    expect(wantsHtml('text/html,application/xhtml+xml', '/dashboard')).toBe(true);
    expect(wantsHtml('text/html', '/nonexistent')).toBe(true);
  });

  it('returns false for API paths even when the browser sends text/html', () => {
    expect(wantsHtml('text/html', '/api/v1/metrics')).toBe(false);
    expect(wantsHtml('text/html', '/api')).toBe(false);
  });

  it('returns false when the client does not accept HTML (JSON/api clients)', () => {
    expect(wantsHtml('application/json', '/dashboard')).toBe(false);
    expect(wantsHtml(undefined, '/dashboard')).toBe(false);
  });

  it('does not treat /apiary-style paths as API', () => {
    expect(wantsHtml('text/html', '/apiary')).toBe(true);
  });
});

describe('errorPage', () => {
  it('renders a branded HTML document containing the status and heading', async () => {
    const out = await errorPage(404, 'Page not found', 'This page does not exist.');
    const str = String(out);
    expect(str).toContain('404');
    expect(str).toContain('Page not found');
    expect(str).toContain('<'); // is HTML, not JSON
  });
});
