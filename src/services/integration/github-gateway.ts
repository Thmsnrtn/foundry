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
// =============================================================================

import { registerToolHandler, invoke, type GatewayRequest } from '../outbound/gateway.js';
import { withRetry } from '../resilience.js';
import { log } from '../../lib/logger.js';

const GITHUB_TIMEOUT_MS = 12_000;
const GITHUB_API = 'https://api.github.com';

interface CreatePRParams {
  /** repo slug "owner/name" */
  repo: string;
  title: string;
  head: string;                     // branch with the changes
  base: string;                     // target branch (typically 'main' or 'master')
  body: string;
  /** PAT for this product's GitHub integration */
  access_token: string;
}

interface PostCommentParams {
  /** repo slug "owner/name" */
  repo: string;
  /** PR number or issue number */
  issue_number: number;
  body: string;
  access_token: string;
}

// ─── Handlers ─────────────────────────────────────────────────────────────────

async function createPRHandler(req: GatewayRequest): Promise<{ url: string; number: number }> {
  const params = req.params as unknown as CreatePRParams;
  if (!params.access_token) {
    log.warn('github.create_pr.no_token', { productId: req.productId });
    return { url: 'log_only', number: 0 };
  }

  const response = await withRetry(
    () =>
      fetch(`${GITHUB_API}/repos/${params.repo}/pulls`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${params.access_token}`,
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
    repo: params.repo,
    number: data.number,
  });
  return { url: data.html_url, number: data.number };
}

async function postCommentHandler(req: GatewayRequest): Promise<{ id: number; url: string }> {
  const params = req.params as unknown as PostCommentParams;
  if (!params.access_token) {
    log.warn('github.post_comment.no_token', { productId: req.productId });
    return { id: 0, url: 'log_only' };
  }

  const response = await withRetry(
    () =>
      fetch(
        `${GITHUB_API}/repos/${params.repo}/issues/${params.issue_number}/comments`,
        {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${params.access_token}`,
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

// ─── Convenience callers ──────────────────────────────────────────────────────

export async function gatewayCreatePR(opts: {
  productId: string;
  repo: string;
  title: string;
  head: string;
  base: string;
  body: string;
  accessToken: string;
  dedupKey: string;
}): Promise<ReturnType<typeof invoke>> {
  return invoke({
    productId: opts.productId,
    tool: 'github_create_pr',
    action: `create PR on ${opts.repo}: ${opts.title}`,
    params: {
      repo: opts.repo,
      title: opts.title,
      head: opts.head,
      base: opts.base,
      body: opts.body,
      access_token: opts.accessToken,
    },
    dedupKey: opts.dedupKey,
    surface: 'github_outbound',
    dataClass: 'general',
  });
}

export async function gatewayPostComment(opts: {
  productId: string;
  repo: string;
  issueNumber: number;
  body: string;
  accessToken: string;
  dedupKey: string;
}): Promise<ReturnType<typeof invoke>> {
  return invoke({
    productId: opts.productId,
    tool: 'github_post_comment',
    action: `post comment on ${opts.repo}#${opts.issueNumber}`,
    params: {
      repo: opts.repo,
      issue_number: opts.issueNumber,
      body: opts.body,
      access_token: opts.accessToken,
    },
    dedupKey: opts.dedupKey,
    surface: 'github_outbound',
    dataClass: 'general',
  });
}
