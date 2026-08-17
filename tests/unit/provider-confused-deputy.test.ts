// =============================================================================
// Tests: a privileged credential is not a general provider proxy
//
// THE CLASS: a less-privileged caller must not be able to steer a
// more-privileged provider credential toward an arbitrary provider operation.
// The Stripe path-traversal defect was one instance; these are the others in
// the same family.
//
// Three gateway handlers took the DESTINATION and the CREDENTIAL out of the
// request payload:
//
//   github_create_pr / github_post_comment   repo + access_token
//   mcp_tool                                 server_url + bearer
//
// Nothing was exploitable through a route today — the callers pass the right
// company's own values. But an adapter that accepts both halves will carry out
// whatever pairing it is handed, and nothing downstream can tell a mistake from
// an attack. It also carried a live bearer token through the gateway inside
// `params`, one parameter-logging change away from being written down.
//
// The rule: the caller names the SEMANTIC TARGET (which issue, which tool,
// which arguments); the server picks the provider, the endpoint, the
// credential and the scope, from facts it holds about the company that
// `req.productId` already established.
// =============================================================================

import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'fs';
import { join, relative, resolve } from 'path';

const SRC = resolve(__dirname, '../../src');

function tsFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((e) => {
    const p = join(dir, e);
    return statSync(p).isDirectory() ? tsFiles(p) : p.endsWith('.ts') ? [p] : [];
  });
}

function code(file: string): string {
  return readFileSync(file, 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .split('\n').map((l) => l.replace(/^\s*\/\/.*$/, '')).join('\n')
    // Casts and the parentheses around them are noise between the payload and
    // the field being read: `(req.params as Record<string, string>).access_token`
    // is the same defect as `params.access_token`, and a mutant written the
    // first way survived a gate that only understood the second.
    .replace(/\s+as\s+(?:unknown\s+as\s+)?[A-Za-z_$][A-Za-z0-9_$<>,.\[\]{}:|\s]*?(?=[),;=])/g, '')
    .replace(/\(\s*(req\.params|params|p)\s*\)/g, '$1');
}

/** Files that register a gateway tool handler — the privileged adapters. */
function adapters(): string[] {
  return tsFiles(SRC).filter((f) => /registerToolHandler\s*\(/.test(code(f)));
}

describe('no adapter takes its credential from the request', () => {
  it('reads no secret out of req.params', () => {
    // A credential in the payload is a credential the caller chose. The
    // company is established by req.productId; its credentials are a fact the
    // server holds.
    const SECRET_PARAM =
      /\b(access_token|bearer|api_key|apiKey|secret|password|credentials|token)\s*[:,)]/;
    const offenders: string[] = [];
    for (const file of adapters()) {
      const source = code(file);
      // Only the shapes that read the request: `params.x`, `p.x`, `req.params.x`.
      for (const m of source.matchAll(
        /\b(?:req\.params|params|p)\.([a-zA-Z_][a-zA-Z0-9_]*)/g)) {
        const field = m[1]!;
        if (!SECRET_PARAM.test(`${field}:`)) continue;
        offenders.push(`${relative(SRC, file)} → ${field}`);
      }
    }
    expect([...new Set(offenders)],
      'the caller chose this credential; resolve it from the company instead')
      .toEqual([]);
  });

  it('reads no destination host out of req.params', () => {
    const offenders: string[] = [];
    for (const file of adapters()) {
      const source = code(file);
      for (const m of source.matchAll(
        /\b(?:req\.params|params|p)\.([a-zA-Z_][a-zA-Z0-9_]*)/g)) {
        const field = m[1]!;
        if (!/(server_url|base_url|host|endpoint|webhook_url)/i.test(field)) continue;
        offenders.push(`${relative(SRC, file)} → ${field}`);
      }
    }
    // `post_webhook` is the deliberate exception and is named, not inferred:
    // its whole purpose is delivering to a target the founder registered, and
    // it screens that target with the SSRF guard at call time.
    const allowed = new Set(['services/distribution/outbound-webhooks.ts → config']);
    expect([...new Set(offenders)].filter((o) => !allowed.has(o))).toEqual([]);
  });
});

describe('the GitHub adapter picks its own repository and token', () => {
  const source = code(resolve(SRC, 'services/integration/github-gateway.ts'));

  it('resolves both from the product row', () => {
    expect(source).toMatch(/async function resolveRepository\(/);
    expect(source).toMatch(/FROM products WHERE id = \?/);
  });

  it('does not accept a repo slug from the caller', () => {
    expect(source, 'a caller supplying both repo and token can pair any two')
      .not.toMatch(/params\.repo/);
    expect(source).not.toMatch(/params\.access_token/);
  });

  it('still validates the slug it built', () => {
    // Server-owned does not mean unvalidated: the owner and name come from a
    // row a founder can edit.
    expect(source).toMatch(/repoSlug\(repo\)/);
  });
});

describe('the MCP adapter picks its own endpoint and bearer', () => {
  const source = code(resolve(SRC, 'services/integration/mcp-client.ts'));

  it('takes a server NAME, not a URL', () => {
    expect(source).toMatch(/server_name/);
    expect(source, 'a handler given a URL and a bearer is a proxy, not a capability')
      .not.toMatch(/p\.server_url/);
    expect(source).not.toMatch(/p\.bearer/);
  });

  it('resolves the endpoint from the company\'s connected integrations', () => {
    expect(source).toMatch(/async function resolveServer\(/);
    expect(source).toMatch(/provider = 'mcp' AND name = \?/);
  });

  it('screens the resolved URL at call time and follows no redirect blindly', () => {
    expect(source).toMatch(/safeFetch\(/);
  });

  it('resolves the server exactly once, not twice', () => {
    // The wrapper pre-checks so an unconnected server does not consume an
    // envelope unit. Two resolutions of one fact is how halves of a rule drift.
    const matches = source.match(/FROM integrations/g) ?? [];
    expect(matches.length).toBe(1);
  });
});
