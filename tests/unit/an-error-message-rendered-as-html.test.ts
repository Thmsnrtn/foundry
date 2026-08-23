import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { stripComments } from '../../scripts/lib/strip-comments.mjs';

// =============================================================================
// AN ERROR MESSAGE RENDERED AS HTML, ON THE SIGN-IN PAGE.
//
// Both auth pages caught a failure to load Clerk and wrote it into the page as
// markup: `.innerHTML = '<p ...>' + e.message + '</p>'`. The error comes from a
// module fetched over the network from a third-party CDN, so any angle bracket
// in it — a crafted response, a proxy error page, a message that merely quotes
// some HTML — was parsed as HTML and rendered, on the one page whose whole job
// is to take a password.
//
// The text is set with `textContent` on nodes built for it now, which cannot
// parse markup by construction. This test reads the SOURCE, because the page is
// a string the server prints and there is no DOM here to assert against.
// =============================================================================

const SRC = readFileSync('src/routes/auth/clerk.ts', 'utf8');

describe('the auth pages', () => {
  it('never assign innerHTML', () => {
    // Comments stripped: the paragraph above names `.innerHTML` twice.
    const code = stripComments(SRC, { lineComments: true });
    expect(code).not.toMatch(/\.innerHTML\s*=/);
  });

  it('put the error text in as text', () => {
    const code = stripComments(SRC, { lineComments: true });
    const matches = code.match(/textContent = String\(e && e\.message \? e\.message : e\)/g) ?? [];
    expect(matches, 'one per page: sign-up and sign-in').toHaveLength(2);
  });

  it('still tell the person what to do', () => {
    expect(SRC).toContain('Failed to load authentication. Please refresh the page.');
  });
});
