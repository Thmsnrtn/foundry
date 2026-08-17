// =============================================================================
// FOUNDRY — GitHub through V3.1 Tool Gateway (Wave 4, action 32)
// Third adapter migration after Resend and Stripe. Per
// src/services/outbound/README.md: lowest customer-facing risk; covered
// separately by webhook_idempotency for inbound events. The migration
// concerns OUTBOUND PR creation / comments specifically.
//
// Handler tools registered here:
//   - github_create_pr
//   - github_post_comment
//
// THE CALLER NAMES THE TARGET; THE SERVER PICKS THE CREDENTIAL AND THE REPO.
// Both handlers used to take `access_token` and `repo` out of the request
// payload. That is the confused-deputy shape: a caller supplying both halves
// can pair any credential with any repository, and nothing downstream can tell
// a mistake from an attack. The company is established by `req.productId`, and
// the company's repository and token are facts the server holds — so it reads
// them, and ignores whatever the payload said.
// =============================================================================

import { query } from '../../db/client.js';
import { getPlaintextToken } from '../../lib/crypto.js';
import { registerToolHandler, invoke, type GatewayRequest } from '../outbound/gateway.js';
import { pathSegment, repoSlug } from '../outbound/path-segment.js';
import { withRetry } from '../resilience.js';
import { log } from '../../lib/logger.js';

const GITHUB_TIMEOUT_MS = 12_000;
const GITHUB_API = 'https://api.github.com';

interface CreatePRParams {
  title: string;
  head: string;                     // branch with the changes
  base: string;                     // target branch (typically 'main' or 'master')
  body: string;
}

interface PostCommentParams {
  /** PR number or issue number */
  issue_number: number;
  body: string;
}

// ─── Handlers ─────────────────────────────────────────────────────────────────

async function createPRHandler(req: GatewayRequest): Promise<{ url: string; number: number }> {
  const params = req.params as unknown as CreatePRParams;
  const repository = await resolveRepository(req.productId);
  if (!repository) {
    log.warn('github.create_pr.no_repository', { productId: req.productId });
    return { url: 'log_only', number: 0 };
  }
  const { repo, accessToken } = repository;

  const response = await withRetry(
    () =>
      fetch(`${GITHUB_API}/repos/${repoSlug(repo)}/pulls`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Accept': 'application/vnd.github+json',
          'X-GitHub-Api-Version': '2022-11-28',
          'Content-Type': 'application/json',
          'User-Agent': 'foundry-tool-gateway',
        },
        body: JSON.stringify({
          title: params.title,
          head: params.head,
          base: params.base,
          body: params.body,
        }),
      }),
    { timeoutMs: GITHUB_TIMEOUT_MS, maxRetries: 2 }
  );

  if (!response.ok) {
    const text = await response.text().catch(() => '');
    throw new Error(`GitHub PR ${response.status}: ${text.slice(0, 300)}`);
  }
  const data = (await response.json()) as { html_url: string; number: number };
  log.info('github.create_pr.ok', {
    productId: req.productId,
    repo,
    number: data.number,
  });
  return { url: data.html_url, number: data.number };
}

async function postCommentHandler(req: GatewayRequest): Promise<{ id: number; url: string }> {
  const params = req.params as unknown as PostCommentParams;
  const repository = await resolveRepository(req.productId);
  if (!repository) {
    log.warn('github.post_comment.no_repository', { productId: req.productId });
    return { id: 0, url: 'log_only' };
  }
  const { repo, accessToken } = repository;

  const response = await withRetry(
    () =>
      fetch(
        `${GITHUB_API}/repos/${repoSlug(repo)}/issues/${pathSegment(String(params.issue_number), 'issue_number')}/comments`,
        {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${accessToken}`,
            'Accept': 'application/vnd.github+json',
            'X-GitHub-Api-Version': '2022-11-28',
            'Content-Type': 'application/json',
            'User-Agent': 'foundry-tool-gateway',
          },
          body: JSON.stringify({ body: params.body }),
        }
      ),
    { timeoutMs: GITHUB_TIMEOUT_MS, maxRetries: 2 }
  );

  if (!response.ok) {
    const text = await response.text().catch(() => '');
    throw new Error(`GitHub comment ${response.status}: ${text.slice(0, 300)}`);
  }
  const data = (await response.json()) as { id: number; html_url: string };
  return { id: data.id, url: data.html_url };
}

// Side-effects: register handlers at module load.
const GITHUB_POLICY = {
  actor: 'development_control', surface: 'github_outbound', dataClass: 'general',
  requireDedupKey: true, requireCustomerExternalId: false,
} as const;
registerToolHandler('github_create_pr', createPRHandler, GITHUB_POLICY);
registerToolHandler('github_post_comment', postCommentHandler, GITHUB_POLICY);

export { createPRHandler, postCommentHandler };

/**
 * The repository and credential this company owns.
 *
 * Read from the product row, never from the request. A caller that could
 * supply both would be able to pair any token with any repository, and the
 * adapter — holding a credential more privileged than the caller — would carry
 * out whatever pairing it was handed.
 *
 * Returns null when the company has not connected GitHub, which the handlers
 * treat exactly as they treated a missing token: log and do nothing.
 */
async function resolveRepository(
  productId: string,
): Promise<{ repo: string; accessToken: string } | null> {
  const res = await query(
    `SELECT github_repo_owner, github_repo_name, github_access_token
       FROM products WHERE id = ?`, [productId]);
  const row = res.rows[0] as Record<string, string | null> | undefined;
  if (!row) return null;
  const owner = row.github_repo_owner ?? '';
  const name = row.github_repo_name ?? '';
  const accessToken = getPlaintextToken(row.github_access_token ?? null) ?? '';
  if (!owner || !name || !accessToken) return null;
  return { repo: `${owner}/${name}`, accessToken };
}

// ─── Convenience callers ──────────────────────────────────────────────────────

export async function gatewayCreatePR(opts: {
  productId: string;
  title: string;
  head: string;
  base: string;
  body: string;
  dedupKey: string;
}): Promise<ReturnType<typeof invoke>> {
  return invoke({
    productId: opts.productId,
    tool: 'github_create_pr',
    action: `create PR: ${opts.title}`,
    params: {
      title: opts.title,
      head: opts.head,
      base: opts.base,
      body: opts.body,
    },
    dedupKey: opts.dedupKey,
    surface: 'github_outbound',
    dataClass: 'general',
  });
}

export async function gatewayPostComment(opts: {
  productId: string;
  issueNumber: number;
  body: string;
  dedupKey: string;
}): Promise<ReturnType<typeof invoke>> {
  return invoke({
    productId: opts.productId,
    tool: 'github_post_comment',
    action: `post comment on #${opts.issueNumber}`,
    params: {
      issue_number: opts.issueNumber,
      body: opts.body,
    },
    dedupKey: opts.dedupKey,
    surface: 'github_outbound',
    dataClass: 'general',
  });
}
