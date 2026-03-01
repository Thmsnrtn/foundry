// =============================================================================
// FOUNDRY — Remediation Engine
// Generates precise code fixes for blocking issues identified in audits.
// =============================================================================

import { query, insertAuditLog } from '../../db/client.js';
import { callOpus, parseJSONResponse } from '../ai/client.js';
import { getDefaultBranchSha, createBranch, commitFiles, createPullRequest } from './github.js';
import { scoreAudit } from './scorer.js';
import { captureArtifact } from '../story/engine.js';
import { nanoid } from 'nanoid';
import type { RemediabilityResult, RemediabilityClassification, RemediationStats, WisdomContext, BlockingIssue } from '../../types/index.js';

// Dimensions that require wisdom context for remediation
const WISDOM_DIMENSIONS = new Set(['D2', 'D3', 'D4']);

// AUTO-remediable issue patterns (deterministic, unambiguous fixes)
const AUTO_PATTERNS = [
  /missing error handling/i,
  /missing environment variable validation/i,
  /absent logging/i,
  /missing rate limit/i,
  /incomplete typescript types/i,
  /missing health check/i,
  /missing.*configuration/i,
  /undocumented environment/i,
  /missing.*middleware/i,
];

interface FixGenerationOutput {
  fix_summary: string;
  fix_approach: string;
  files: Array<{ path: string; full_content: string; change_summary: string }>;
  confidence: number;
  caveats: string[];
}

/**
 * Classify a blocking issue as AUTO, WISDOM_REQUIRED, or HUMAN_ONLY.
 */
export function classifyRemediability(
  blockingIssue: BlockingIssue,
  wisdomActive: boolean,
): RemediabilityResult {
  const dim = blockingIssue.dimension.toUpperCase().replace(/\s.*/, '');

  // D2/D3/D4 issues need wisdom
  if (WISDOM_DIMENSIONS.has(dim)) {
    if (!wisdomActive) {
      return {
        classification: 'HUMAN_ONLY',
        reason: `${dim} issues require Product Wisdom context. Complete DNA to 60% to unlock automated fixes.`,
        wisdom_sections_needed: getNeededSections(dim),
      };
    }
    return {
      classification: 'WISDOM_REQUIRED',
      reason: `${dim} issue remediable with Product Wisdom context.`,
    };
  }

  // Check for auto-remediable patterns
  const issueText = `${blockingIssue.issue} ${blockingIssue.evidence}`.toLowerCase();
  for (const pattern of AUTO_PATTERNS) {
    if (pattern.test(issueText)) {
      return {
        classification: 'AUTO',
        reason: 'Deterministic fix — pattern-based, unambiguous resolution.',
      };
    }
  }

  // Core business logic, architecture, pricing = always human
  if (/business logic|architectural|pricing|data model/i.test(issueText)) {
    return {
      classification: 'HUMAN_ONLY',
      reason: 'Requires founder judgment — core business logic or architectural decision.',
    };
  }

  // Default: AUTO for D5/D6/D7/D9 operational issues, HUMAN_ONLY for everything else
  const autoDimensions = new Set(['D5', 'D6', 'D7', 'D9']);
  if (autoDimensions.has(dim)) {
    return {
      classification: 'AUTO',
      reason: `${dim} operational issue — deterministic fix likely.`,
    };
  }

  return {
    classification: 'HUMAN_ONLY',
    reason: 'Requires founder judgment.',
  };
}

/**
 * Generate a fix for a blocking issue. Creates remediation_pr record.
 * Skips if WISDOM_REQUIRED + wisdom inactive, or if confidence < 0.7.
 */
export async function generateFix(
  productId: string,
  ownerId: string,
  auditScoreId: string,
  blockingIssue: BlockingIssue,
  relevantFileContents: Map<string, string>,
  wisdomContext: WisdomContext,
): Promise<string> {
  const remId = nanoid();
  const dim = blockingIssue.dimension.toUpperCase().replace(/\s.*/, '');
  const classification = classifyRemediability(blockingIssue, wisdomContext.wisdom_active);

  // Create initial record
  await query(
    `INSERT INTO remediation_prs (id, product_id, owner_id, audit_score_id, blocking_issue_id, blocking_issue_dimension, blocking_issue_summary, wisdom_context_pct, wisdom_patterns_used, wisdom_failures_used, status)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'generating')`,
    [remId, productId, ownerId, auditScoreId, blockingIssue.id, dim, blockingIssue.issue, wisdomContext.dna_completion_pct, wisdomContext.meta.patterns_injected, wisdomContext.meta.failures_injected],
  );

  // Skip WISDOM_REQUIRED when wisdom is inactive
  if (classification.classification === 'WISDOM_REQUIRED' && !wisdomContext.wisdom_active) {
    await query(
      `UPDATE remediation_prs SET status = 'skipped', skipped_reason = ? WHERE id = ?`,
      [`Wisdom layer not active (${wisdomContext.dna_completion_pct}% DNA). Complete DNA to unlock.`, remId],
    );
    return remId;
  }

  // Skip HUMAN_ONLY
  if (classification.classification === 'HUMAN_ONLY') {
    await query(
      `UPDATE remediation_prs SET status = 'skipped', skipped_reason = ? WHERE id = ?`,
      [classification.reason, remId],
    );
    return remId;
  }

  // Build file context for Opus
  const fileContextParts: string[] = [];
  for (const [path, content] of relevantFileContents) {
    fileContextParts.push(`--- ${path} ---\n${content}\n`);
  }
  const fileContext = fileContextParts.join('\n');

  const systemPrompt = `You are the Foundry Remediation Engine. You generate precise, minimal code fixes for specific blocking issues identified in product audits.

RULES:
- Fix only what the blocking issue specifies. Do not refactor, improve, or change anything beyond the exact scope of the issue.
- The fix must satisfy the definition_of_done exactly as stated.
- Prefer the smallest change that fully resolves the issue.
- Never change business logic, data models, or architectural patterns.
- For D2/D3/D4 issues: the Product Wisdom is authoritative. A fix that is wrong generically may be right for this specific product. Always defer to the ICP description, voice principles, and positioning when making content or UX decisions.
- Output only valid, production-ready code. No TODOs, no placeholders.

${wisdomContext.dna_context}

Respond in JSON:
{
  "fix_summary": "human readable description of what this fix does",
  "fix_approach": "which approach category",
  "files": [{"path": "src/example.ts", "full_content": "complete file content after fix", "change_summary": "what changed and why"}],
  "confidence": 0.0-1.0,
  "caveats": ["any edge cases or assumptions"]
}`;

  const userPrompt = `BLOCKING ISSUE: ${blockingIssue.id}
Dimension: ${blockingIssue.dimension}
Issue: ${blockingIssue.issue}
Evidence: ${blockingIssue.evidence}
Definition of done: ${blockingIssue.definition_of_done}

RELEVANT FILES:
${fileContext}`;

  try {
    const response = await callOpus(systemPrompt, userPrompt, 16384);
    const fix = parseJSONResponse<FixGenerationOutput>(response.content);

    // Confidence check — non-negotiable
    if (fix.confidence < 0.7) {
      await query(
        `UPDATE remediation_prs SET status = 'skipped', skipped_reason = ?, fix_summary = ?, fix_approach = ? WHERE id = ?`,
        [`Low confidence (${fix.confidence.toFixed(2)}). Caveats: ${fix.caveats.join('; ')}`, fix.fix_summary, fix.fix_approach, remId],
      );
      await insertAuditLog({
        id: nanoid(),
        product_id: productId,
        action_type: 'remediation_skipped_low_confidence',
        gate: 2,
        trigger: 'remediation_engine',
        reasoning: `Fix for ${blockingIssue.id} skipped: confidence ${fix.confidence.toFixed(2)} < 0.7. Caveats: ${fix.caveats.join('; ')}`,
      });
      return remId;
    }

    // Update record with fix details
    const filesModified = fix.files.map((f) => ({ path: f.path, change_summary: f.change_summary }));
    await query(
      `UPDATE remediation_prs SET fix_summary = ?, fix_approach = ?, files_modified = ? WHERE id = ?`,
      [fix.fix_summary, fix.fix_approach, JSON.stringify(filesModified), remId],
    );

    return remId;
  } catch (err) {
    await query(
      `UPDATE remediation_prs SET status = 'failed', failure_reason = ? WHERE id = ?`,
      [String(err), remId],
    );
    return remId;
  }
}

/**
 * Open a GitHub PR for a remediation fix.
 */
export async function openRemediationPR(
  remediationPrId: string,
  owner: string,
  repo: string,
  accessToken: string,
  files: Array<{ path: string; full_content: string; change_summary: string }>,
  fixSummary: string,
  blockingIssue: BlockingIssue,
  auditScoreId: string,
  baseBranch: string = 'main',
  wisdomContext: WisdomContext,
): Promise<void> {
  const timestamp = Date.now();
  const branchName = `foundry/fix-${blockingIssue.id.toLowerCase()}-${timestamp}`;

  try {
    // Create branch
    const baseSha = await getDefaultBranchSha(owner, repo, accessToken, baseBranch);
    await createBranch(owner, repo, branchName, baseSha, accessToken);

    // Commit files
    const commitMessage = `[Foundry] Fix ${blockingIssue.id}: ${fixSummary}`;
    await commitFiles(
      owner, repo, branchName,
      files.map((f) => ({ path: f.path, content: f.full_content })),
      commitMessage, accessToken,
    );

    // Build PR body
    const prBody = buildPRBody(blockingIssue, fixSummary, files, wisdomContext);

    // Open PR
    const pr = await createPullRequest(
      owner, repo,
      `[Foundry] Fix ${blockingIssue.id}: ${fixSummary}`,
      prBody, branchName, baseBranch, accessToken,
    );

    // Update record
    await query(
      `UPDATE remediation_prs SET github_branch = ?, github_pr_number = ?, github_pr_url = ?, github_base_branch = ?, status = 'pr_open' WHERE id = ?`,
      [branchName, pr.number, pr.url, baseBranch, remediationPrId],
    );

    // Check if this is the first PR for this product
    const priorPRs = await query(
      `SELECT COUNT(*) as c FROM remediation_prs WHERE product_id = (SELECT product_id FROM remediation_prs WHERE id = ?) AND status = 'pr_open' AND id != ?`,
      [remediationPrId, remediationPrId],
    );
    const count = (priorPRs.rows[0] as Record<string, number>)?.c ?? 0;
    if (count === 0) {
      const remRow = await query('SELECT product_id FROM remediation_prs WHERE id = ?', [remediationPrId]);
      const prodId = (remRow.rows[0] as Record<string, string>)?.product_id;
      if (prodId) {
        await captureArtifact({
          productId: prodId,
          phase: 'operational',
          artifactType: 'remediation',
          title: `First automated fix PR opened: ${blockingIssue.id}`,
          content: `Foundry opened its first automated fix PR for this product.\n\nIssue: ${blockingIssue.issue}\nFix: ${fixSummary}\nPR: ${pr.url}`,
          evidenceLinks: [pr.url],
        });
      }
    }
  } catch (err) {
    await query(
      `UPDATE remediation_prs SET status = 'failed', failure_reason = ? WHERE id = ?`,
      [String(err), remediationPrId],
    );
  }
}

/**
 * Triggered when a remediation PR is merged. Re-audits the affected dimension.
 */
export async function triggerDimensionReAudit(
  productId: string,
  auditScoreId: string,
  dimension: string,
  remediationPrId: string,
): Promise<void> {
  await query(
    `UPDATE remediation_prs SET re_audit_triggered_at = ? WHERE id = ?`,
    [new Date().toISOString(), remediationPrId],
  );

  // Get the current audit score for this dimension
  const auditResult = await query('SELECT * FROM audit_scores WHERE id = ?', [auditScoreId]);
  if (auditResult.rows.length === 0) return;
  const audit = auditResult.rows[0] as Record<string, unknown>;
  const dimKey = `d${dimension.replace(/\D/g, '')}_score`;
  const preFix = audit[dimKey] as number | null;

  await query(
    `UPDATE remediation_prs SET pre_fix_dimension_score = ? WHERE id = ?`,
    [preFix, remediationPrId],
  );

  // Note: A full re-audit would call runAudit with run_type 'post_remediation'.
  // For targeted dimension re-audit, we log and let the next periodic audit capture it.
  await insertAuditLog({
    id: nanoid(),
    product_id: productId,
    action_type: 'remediation_pr_merged',
    gate: 2,
    trigger: 'remediation_outcome_check',
    reasoning: `Remediation PR merged for ${dimension}. Pre-fix score: ${preFix}. Next audit will measure impact.`,
  });

  await query(
    `UPDATE remediation_prs SET re_audit_completed_at = ? WHERE id = ?`,
    [new Date().toISOString(), remediationPrId],
  );
}

/**
 * Get remediation stats for a product.
 */
export async function getRemediationStats(productId: string): Promise<RemediationStats> {
  const result = await query(
    'SELECT status, COUNT(*) as c FROM remediation_prs WHERE product_id = ? GROUP BY status',
    [productId],
  );

  const counts: Record<string, number> = {};
  for (const row of result.rows) {
    const r = row as Record<string, unknown>;
    counts[r.status as string] = r.c as number;
  }

  const total = Object.values(counts).reduce((a, b) => a + b, 0);

  return {
    total_issues: total,
    auto_count: 0,
    wisdom_required_count: 0,
    human_only_count: 0,
    prs_generating: counts.generating ?? 0,
    prs_open: counts.pr_open ?? 0,
    prs_merged: counts.merged ?? 0,
    prs_skipped: counts.skipped ?? 0,
    prs_failed: counts.failed ?? 0,
    composite_before: null,
    composite_after: null,
  };
}

// ─── Internal ────────────────────────────────────────────────────────────────

function getNeededSections(dimension: string): string[] {
  switch (dimension) {
    case 'D2': return ['voice_principles', 'icp_description'];
    case 'D3': return ['primary_objection', 'objection_response', 'icp_description'];
    case 'D4': return ['positioning_statement', 'icp_pain', 'icp_description'];
    default: return [];
  }
}

function buildPRBody(
  issue: BlockingIssue,
  fixSummary: string,
  files: Array<{ path: string; change_summary: string }>,
  wisdomContext: WisdomContext,
): string {
  const parts = [
    '## Foundry Automated Fix',
    '',
    `**Blocking Issue:** ${issue.id} — ${issue.issue}`,
    `**Audit Dimension:** ${issue.dimension}`,
    '',
    '### What this fixes',
    fixSummary,
    '',
    '### Definition of done',
    issue.definition_of_done,
    '',
    '### Files changed',
    ...files.map((f) => `- \`${f.path}\`: ${f.change_summary}`),
  ];

  if (wisdomContext.wisdom_active) {
    parts.push(
      '',
      '### Context used',
      `This fix was generated with Product Wisdom context (${wisdomContext.dna_completion_pct}% DNA complete, ${wisdomContext.meta.patterns_injected} judgment patterns, ${wisdomContext.meta.failures_injected} failure log entries).`,
    );
  }

  parts.push(
    '',
    '---',
    '*Generated by Foundry · Review carefully before merging.*',
    '*Foundry fixes only what it is confident in.*',
  );

  return parts.join('\n');
}
