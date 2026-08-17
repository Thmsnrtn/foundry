import { existsSync, readFileSync } from 'node:fs';
import { normalize, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

// =============================================================================
// CSRF protection is an allowlist, and an allowlist is a thing you can forget.
//
// `src/index.ts` applies `csrfMiddleware` to thirty-five path prefixes. The
// middleware itself is thoroughly tested — foreign Origin, foreign Referer,
// token mismatch, bearer skip, the proxy case. What nothing checked is whether
// every cookie-authenticated mutating route is actually ON the list.
//
// Auditing it found no hole: every uncovered route is deliberately not a cookie
// surface — signature-verified webhooks, token-authenticated ingest, the
// service-key internal routes, and the API-key transcript and voice webhooks.
// That is a result, not a fix, and it is exactly the state worth locking in:
// correct today, and maintained by memory. One new `app.route` on a new prefix
// silently opens every form under it.
//
// The exemptions are not a free pass. Each names the mechanism that
// authenticates it INSTEAD of a cookie, and the test checks the file actually
// contains that mechanism — so "it's a webhook" has to be true, not merely
// asserted here.
// =============================================================================

const ROOT = resolve(__dirname, '../..');
const INDEX = readFileSync(resolve(ROOT, 'src/index.ts'), 'utf8');

/**
 * Mutating routes that are deliberately outside CSRF, each with the mechanism
 * that authenticates it instead — and a substring that must appear in its
 * source, so the claim is checkable rather than declarative.
 *
 * CSRF defends a browser session against a foreign page acting as the user.
 * None of these has a browser session to borrow: the credential travels in the
 * request itself, and a foreign page cannot obtain one by making the request.
 */
const NON_COOKIE_SURFACES: Record<string, { why: string; proof: RegExp }> = {
  '/auth/webhook': {
    why: 'Clerk webhook, verified by svix signature headers',
    proof: /c\.req\.header\('svix-signature'\)/,
  },
  '/ingest/:token': {
    why: 'metrics token, or a credential scoped for metrics (migration 139)',
    proof: /authenticateIngest\(token, 'metrics'\)/,
  },
  '/ingest/company-report/:token': {
    why: 'ingest credential scoped for company_report',
    proof: /authenticateIngest\(token, 'company_report'\)/,
  },
  '/ingest/effect-outcome/:token': {
    why: 'ingest credential scoped for effect_outcome',
    proof: /authenticateIngest\(token, 'effect_outcome'\)/,
  },
  '/ingest/customer-message/:channelKey': {
    why: 'per-channel intake key bound to one responsibility',
    proof: /intakeKey: channelKey/,
  },
  '/internal/campaign/receive': {
    why: 'ecosystem service key, applied to /internal/* in the composition root',
    proof: /internalMiddleware\(c, next\)/,
  },
  '/internal/conversion-signal': {
    why: 'ecosystem service key, applied to /internal/* in the composition root',
    proof: /internalMiddleware\(c, next\)/,
  },
  '/webhooks/integrations/stripe': {
    why: 'Stripe webhook, verified against the per-product webhook secret',
    proof: /c\.req\.header\('stripe-signature'\)/,
  },
  '/webhooks/transcripts/fathom': {
    why: 'API key in the request, validated with revocation and expiry',
    proof: /validateApiKey\(apiKey\)/,
  },
  '/webhooks/transcripts/fireflies': {
    why: 'API key in the request, validated with revocation and expiry',
    proof: /validateApiKey\(apiKey\)/,
  },
  '/webhooks/voice-reply': {
    why: 'API key in the request body, validated with revocation and expiry',
    proof: /validateApiKey\(body\.api_key\)/,
  },
};

/** Comments stripped. A file that MENTIONS a credential check in prose has not
 * performed one — a mutation that replaced the real call with a stub sailed
 * past an earlier version of this gate, because the import line still matched.
 *
 * Block comments are only stripped when they OPEN A LINE. A naive
 * `/\*[\s\S]*?\*\//` also fires on `/*` inside a string literal, and this file
 * reads a composition root full of them: `app.use('/internal/*', …)` opened a
 * comment that ran until the next real `*​/`, swallowing the middleware line
 * this gate exists to find. The stripper was making the source it checks
 * smaller than the source that runs. */
function executable(file: string): string {
  return readFileSync(file, 'utf8')
    .replace(/^[ \t]*\/\*[\s\S]*?\*\//gm, ' ')
    .split('\n').map((l) => l.replace(/^\s*\/\/.*$/, '')).join('\n');
}

function csrfPrefixes(): string[] {
  return [...INDEX.matchAll(/app\.use\('([^']+)',\s*csrfMiddleware\)/g)]
    .map((m) => m[1].replace(/\*$/, '').replace(/\/$/, '') || '/');
}

/** Router variable → the file it is imported from. */
function routerFiles(): Record<string, string> {
  const map: Record<string, string> = {};
  for (const m of INDEX.matchAll(/import\s*\{([^}]+)\}\s*from\s*'(\.[^']+)'/g)) {
    const file = normalize(resolve(ROOT, 'src', m[2].replace(/\.js$/, '.ts')));
    for (const raw of m[1].split(',')) {
      const name = raw.trim().split(/\s+as\s+/).pop()?.trim();
      if (name) map[name] = file;
    }
  }
  return map;
}

/** Every mutating route, at the full path it is actually served on. */
function mutatingRoutes(): Array<{ path: string; file: string }> {
  const files = routerFiles();
  const out: Array<{ path: string; file: string }> = [];
  for (const m of INDEX.matchAll(/app\.route\('([^']*)',\s*(\w+)\)/g)) {
    const file = files[m[2]];
    if (!file || !existsSync(file)) continue;
    const source = readFileSync(file, 'utf8');
    for (const r of source.matchAll(/^\w+\.(post|put|patch|delete)\('([^']*)'/gm)) {
      out.push({ path: (m[1].replace(/\/$/, '') + r[2]) || '/', file });
    }
  }
  return out;
}

const covered = (path: string, prefixes: string[]): boolean =>
  prefixes.some((p) => path === p || path.startsWith(p.replace(/\/$/, '') + '/'));

describe('CSRF covers every cookie-authenticated write', () => {
  it('leaves no mutating route both uncovered and unexplained', () => {
    const prefixes = csrfPrefixes();
    expect(prefixes.length).toBeGreaterThan(20);

    const unexplained = mutatingRoutes()
      .filter(({ path }) => !covered(path, prefixes))
      .filter(({ path }) => !(path in NON_COOKIE_SURFACES))
      .map(({ path, file }) => `${path}  (${file.slice(ROOT.length + 1)})`);

    expect([...new Set(unexplained)],
      'A mutating route is outside CSRF and is not recorded as a non-cookie surface. '
      + 'Either add its prefix to csrfMiddleware in src/index.ts, or record here which '
      + 'credential authenticates it instead:\n' + unexplained.join('\n')).toEqual([]);
  });

  it('every exemption actually has the credential it claims', () => {
    // Otherwise the list becomes a way to silence this test. A surface exempt
    // because "it's a webhook" has to contain the signature check.
    const routes = mutatingRoutes();
    for (const [path, { why, proof }] of Object.entries(NON_COOKIE_SURFACES)) {
      const match = routes.find((r) => r.path === path);
      expect(match, `${path} is recorded as exempt but is not a mounted route`).toBeTruthy();
      // Checked against the route's own file AND the composition root, because
      // some of these are authenticated by middleware applied where they are
      // mounted rather than inside the handler.
      const source = executable(match!.file) + '\n' + executable(resolve(ROOT, 'src/index.ts'));
      expect(source, `${path} claims "${why}" — its source must show it`).toMatch(proof);
    }
  });

  it('records no exemption for a route that no longer exists', () => {
    const paths = new Set(mutatingRoutes().map((r) => r.path));
    const stale = Object.keys(NON_COOKIE_SURFACES).filter((p) => !paths.has(p));
    expect(stale, `Exemptions for routes that are gone:\n${stale.join('\n')}`).toEqual([]);
  });
});
