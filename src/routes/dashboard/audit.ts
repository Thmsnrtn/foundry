import { Hono } from 'hono';
import { html } from 'hono/html';
import type { AuthEnv } from '../../middleware/auth.js';
import { query, getProductByOwner, getLatestAudit, getPriorAudit } from '../../db/client.js';
import { runAudit } from '../../services/audit/engine.js';
import { compareAudits } from '../../services/audit/comparator.js';
import { getRemediationStats } from '../../services/audit/remediation.js';
import { dashboardLayout } from '../../views/layout.js';
import { auditScoreCard, auditComparison, blockingIssues, emptyState, remediationSummaryCard, wisdomContextBadge, dimensionRowWithHint, pageHintBanner, auditRunButton } from '../../views/components.js';
import { getLayoutContext } from './_shared.js';
import { getPageHints, getDimensionHints, generateDimensionHints } from '../../services/ux/hints.js';
import { checkAndAwardMilestones } from '../../services/ux/milestones.js';
import { log } from '../../lib/logger.js';
import type { AuditScore } from '../../types/index.js';

export const auditRoutes = new Hono<AuthEnv>();

auditRoutes.get('/products/:id/audit', async (c) => {
  const founder = c.get('founder');
  const productId = c.req.param('id');
  const prodResult = await getProductByOwner(productId, founder.id);
  if (prodResult.rows.length === 0) return c.json({ error: 'Not found' }, 404);

  const product = prodResult.rows[0] as Record<string, unknown>;
  const hasGitHub = !!(product.github_repo_owner && product.github_repo_name && product.github_access_token);
  const ctx = await getLayoutContext(founder, 'audit', 'Audit', productId);

  const current = await getLatestAudit(productId);
  if (current.rows.length === 0) {
    const hints = await getPageHints('audit', founder, productId, { is_first_audit: true, composite: 0, wisdom_required_count: 0, wisdom_active: false, verdict: null });
    const content = html`
      <h1>Product Audit</h1>
      ${pageHintBanner(hints)}
      <div class="card" style="text-align:center;padding:3rem 2rem;">
        <h2 style="margin-bottom:0.5rem;">No audit has been run yet</h2>
        <p style="color:#6b7280;max-width:500px;margin:0 auto 1.5rem;">
          Foundry will analyze your codebase across 10 dimensions — functional completeness, trust density,
          operational readiness, and more. This typically takes 2–4 minutes.
        </p>
        ${hasGitHub
          ? html`
            <form method="POST" action="/products/${productId}/audit/run" id="audit-form">
              <button type="submit" class="btn btn-primary" id="run-audit-btn" onclick="this.disabled=true;this.textContent='Running audit…';this.form.submit();">
                Run First Audit
              </button>
            </form>
            <p style="font-size:0.8rem;color:#9ca3af;margin-top:0.75rem;">
              Uses Claude Opus for analysis. Reads your repository (read-only).
            </p>`
          : html`
            <p style="color:#d97706;margin-bottom:1rem;">
              GitHub repository not connected. Connect your repo to run an audit.
            </p>
            <a href="/onboarding" class="btn btn-primary">Connect GitHub</a>`
        }
      </div>
    `;
    return c.html(dashboardLayout(ctx, content));
  }

  const currentAudit = current.rows[0] as unknown as AuditScore;
  const prior = await getPriorAudit(productId, currentAudit.id);
  const priorAudit = prior.rows.length > 0 ? prior.rows[0] as unknown as AuditScore : null;

  let remStats = { total_issues: 0, auto_count: 0, wisdom_required_count: 0, human_only_count: 0, prs_generating: 0, prs_open: 0, prs_merged: 0, prs_skipped: 0, prs_failed: 0, composite_before: null as number | null, composite_after: null as number | null };
  try {
    remStats = await getRemediationStats(productId);
  } catch {
    // Remediation stats may not be available yet
  }
  const dimHints = await getDimensionHints(currentAudit.id);

  const isFirstAudit = !priorAudit;
  const hints = await getPageHints('audit', founder, productId, {
    is_first_audit: isFirstAudit,
    composite: currentAudit.composite ?? 0,
    wisdom_required_count: remStats.wisdom_required_count,
    wisdom_active: ctx.wisdomLayerActive,
    verdict: currentAudit.verdict,
  });

  // Calculate data age
  const auditAge = currentAudit.created_at
    ? Math.floor((Date.now() - new Date(currentAudit.created_at).getTime()) / 86400000)
    : null;

  const content = html`
    ${pageHintBanner(hints)}
    <div class="section-header">
      <h1>Product Audit</h1>
      <div style="display:flex;gap:0.5rem;align-items:center;">
        ${auditAge !== null ? html`<span style="font-size:0.8rem;color:${auditAge > 14 ? '#d97706' : '#6b7280'};">${auditAge === 0 ? 'Today' : auditAge === 1 ? 'Yesterday' : `${auditAge} days ago`}</span>` : ''}
        ${wisdomContextBadge(ctx.wisdomLayerActive, ctx.dnaCompletionPct, 0, 0)}
        ${auditRunButton(productId)}
      </div>
    </div>
    <div class="card">
      ${auditScoreCard(currentAudit as unknown as Record<string, unknown>)}
    </div>
    ${blockingIssues((currentAudit as unknown as Record<string, unknown>).blocking_issues as string | null)}
    ${remStats.total_issues > 0 ? remediationSummaryCard(remStats) : ''}
    ${priorAudit ? auditComparison(
      currentAudit as unknown as Record<string, unknown>,
      priorAudit as unknown as Record<string, unknown>
    ) : ''}
  `;

  return c.html(dashboardLayout(ctx, content));
});

auditRoutes.post('/products/:id/audit/run', async (c) => {
  const founder = c.get('founder');
  const productId = c.req.param('id');
  const prodResult = await getProductByOwner(productId, founder.id);
  if (prodResult.rows.length === 0) return c.json({ error: 'Not found' }, 404);

  const product = prodResult.rows[0] as Record<string, unknown>;
  // Determine run type
  const priorAudit = await getLatestAudit(productId);
  const runType = priorAudit.rows.length > 0 ? 'post_remediation' as const : 'initial' as const;

  try {
    const audit = await runAudit({
      id: product.id as string, name: product.name as string, owner_id: product.owner_id as string,
      github_repo_url: product.github_repo_url as string | null,
      github_repo_owner: product.github_repo_owner as string | null,
      github_repo_name: product.github_repo_name as string | null,
      github_access_token: product.github_access_token as string | null,
      stack_description: null, market_category: null,
      created_at: product.created_at as string, updated_at: product.updated_at as string,
      status: 'active',
    }, runType);

    // UX Intelligence: milestones + dimension hints
    await checkAndAwardMilestones(productId, founder.id);
    generateDimensionHints(audit.id, productId).catch((err) => {
      log.error('Failed to generate dimension hints', err, { auditId: audit.id, productId });
    });

    // If browser request, redirect to audit page; else return JSON
    const accept = c.req.header('Accept') ?? '';
    if (accept.includes('text/html')) {
      return c.redirect(`/products/${productId}/audit`);
    }
    return c.json({ audit_id: audit.id, status: 'completed' });
  } catch (err) {
    log.error('Audit run failed', err, { productId, founderId: founder.id });
    const accept = c.req.header('Accept') ?? '';
    if (accept.includes('text/html')) {
      return c.redirect(`/products/${productId}/audit?error=audit_failed`);
    }
    return c.json({ error: 'Audit failed. Please check your GitHub connection.' }, 500);
  }
});
