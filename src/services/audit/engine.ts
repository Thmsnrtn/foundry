// =============================================================================
// FOUNDRY — Audit Engine: Eight-Step Analysis Pipeline
// =============================================================================

import { getRepoTree, getKeyFiles } from './github.js';
import { scoreAudit } from './scorer.js';
import { classifyRemediability, generateFix } from './remediation.js';
import { buildWisdomContext } from '../wisdom/dna.js';
import { query } from '../../db/client.js';
import { nanoid } from 'nanoid';
import type { AuditScore, Product } from '../../types/index.js';
import type { AnalysisPipelineOutput, PriorAuditContext } from '../../types/ai.js';

export async function runAudit(
  product: Product,
  runType: 'initial' | 'post_remediation' | 'periodic' = 'initial'
): Promise<AuditScore> {
  if (!product.github_repo_owner || !product.github_repo_name || !product.github_access_token) {
    throw new Error('Product must have GitHub repository connected');
  }

  const { github_repo_owner: owner, github_repo_name: repo, github_access_token: token } = product;
  const tree = await getRepoTree(owner, repo, token);
  const keyFiles = await getKeyFiles(owner, repo, token, tree);

  // Run all 8 analysis steps
  const pipelineOutput: AnalysisPipelineOutput = {
    discovery: analyzeDiscovery(tree, keyFiles),
    configuration: analyzeConfiguration(tree, keyFiles),
    routes: analyzeRoutes(tree, keyFiles),
    billing: analyzeBilling(keyFiles),
    trust_signals: analyzeTrustSignals(keyFiles),
    error_handling: analyzeErrorHandling(keyFiles),
    analytics: analyzeAnalytics(keyFiles),
    dependencies: analyzeDependencies(keyFiles),
  };

  // Load prior audit for comparison context
  const priorResult = await query(
    'SELECT * FROM audit_scores WHERE product_id = ? ORDER BY created_at DESC LIMIT 1',
    [product.id]
  );

  let priorAudit: PriorAuditContext | null = null;
  if (priorResult.rows.length > 0) {
    const p = priorResult.rows[0] as Record<string, unknown>;
    priorAudit = {
      scores: {
        d1: p.d1_score as number, d2: p.d2_score as number, d3: p.d3_score as number,
        d4: p.d4_score as number, d5: p.d5_score as number, d6: p.d6_score as number,
        d7: p.d7_score as number, d8: p.d8_score as number, d9: p.d9_score as number,
        d10: p.d10_score as number,
      },
      composite: p.composite as number,
      verdict: p.verdict as string,
      blocking_issues_open: p.blocking_issues
        ? (JSON.parse(p.blocking_issues as string) as Array<{ id: string; status: string }>)
            .filter((b) => b.status === 'open').map((b) => b.id)
        : [],
    };
  }

  // Build wisdom context for scoring
  const wisdomContext = await buildWisdomContext(product.id);

  // Score with Claude Opus (wisdom-aware)
  const scoringOutput = await scoreAudit({
    product_name: product.name,
    analysis_results: pipelineOutput,
    prior_audit: priorAudit,
  }, wisdomContext);

  // Persist
  const auditId = nanoid();
  const dims = scoringOutput.dimensions;
  await query(
    `INSERT INTO audit_scores (id, product_id, run_type, d1_score, d2_score, d3_score, d4_score, d5_score, d6_score, d7_score, d8_score, d9_score, d10_score, composite, verdict, findings, blocking_issues)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      auditId, product.id, runType,
      dims.find((d) => d.dimension_number === 1)?.score ?? null,
      dims.find((d) => d.dimension_number === 2)?.score ?? null,
      dims.find((d) => d.dimension_number === 3)?.score ?? null,
      dims.find((d) => d.dimension_number === 4)?.score ?? null,
      dims.find((d) => d.dimension_number === 5)?.score ?? null,
      dims.find((d) => d.dimension_number === 6)?.score ?? null,
      dims.find((d) => d.dimension_number === 7)?.score ?? null,
      dims.find((d) => d.dimension_number === 8)?.score ?? null,
      dims.find((d) => d.dimension_number === 9)?.score ?? null,
      dims.find((d) => d.dimension_number === 10)?.score ?? null,
      scoringOutput.composite, scoringOutput.verdict,
      JSON.stringify(scoringOutput.findings),
      JSON.stringify(scoringOutput.blocking_issues),
    ]
  );

  // Update lifecycle
  await query(
    `UPDATE lifecycle_state SET prompt_1_status = 'completed', prompt_1_completed_at = ?, prompt_1_verdict = ?, prompt_1_composite = ?, updated_at = ? WHERE product_id = ?`,
    [new Date().toISOString(), scoringOutput.verdict, scoringOutput.composite, new Date().toISOString(), product.id]
  );

  // Post-audit: classify blocking issues for remediability and queue fixes
  if (scoringOutput.blocking_issues && scoringOutput.blocking_issues.length > 0 && product.github_access_token) {
    for (const issue of scoringOutput.blocking_issues) {
      // Adapt BlockingIssueOutput to BlockingIssue for the remediation engine
      const blockingIssue = { ...issue, status: 'open' as const };
      const classification = classifyRemediability(blockingIssue, wisdomContext.wisdom_active);

      // Log classification to audit_log
      await query(
        `INSERT INTO audit_log (id, product_id, action, details, created_at) VALUES (?, ?, 'remediation_classified', ?, ?)`,
        [nanoid(), product.id, JSON.stringify({ issue_id: issue.id, classification: classification.classification }), new Date().toISOString()]
      );

      // For AUTO or WISDOM_REQUIRED issues, generate fix asynchronously
      if (classification.classification === 'AUTO' || classification.classification === 'WISDOM_REQUIRED') {
        // Build relevant file context from pipeline output
        const relevantFiles = new Map<string, string>();
        generateFix(product.id, product.owner_id, auditId, blockingIssue, relevantFiles, wisdomContext).then(async (remId) => {
          await query(
            `INSERT INTO audit_log (id, product_id, action, details, created_at) VALUES (?, ?, 'remediation_fix_queued', ?, ?)`,
            [nanoid(), product.id, JSON.stringify({ issue_id: issue.id, remediation_pr_id: remId }), new Date().toISOString()]
          );
        }).catch((err) => {
          console.error(`[engine] remediation fix failed for issue ${issue.id}:`, err);
        });
      }
    }
  }

  const result = await query('SELECT * FROM audit_scores WHERE id = ?', [auditId]);
  const row = result.rows[0] as Record<string, unknown>;
  return {
    id: row.id as string, product_id: row.product_id as string,
    run_type: row.run_type as AuditScore['run_type'],
    d1_score: row.d1_score as number | null, d2_score: row.d2_score as number | null,
    d3_score: row.d3_score as number | null, d4_score: row.d4_score as number | null,
    d5_score: row.d5_score as number | null, d6_score: row.d6_score as number | null,
    d7_score: row.d7_score as number | null, d8_score: row.d8_score as number | null,
    d9_score: row.d9_score as number | null, d10_score: row.d10_score as number | null,
    composite: row.composite as number | null,
    verdict: row.verdict as AuditScore['verdict'],
    findings: row.findings ? JSON.parse(row.findings as string) : null,
    blocking_issues: row.blocking_issues ? JSON.parse(row.blocking_issues as string) : null,
    created_at: row.created_at as string, notes: row.notes as string | null,
  };
}

// ─── Analysis Steps ──────────────────────────────────────────────────────────

type TreeEntry = { path: string; type: string };

function analyzeDiscovery(tree: TreeEntry[], files: Map<string, string>) {
  const allPaths = tree.filter((e) => e.type === 'blob').map((e) => e.path);
  const packageJson = files.get('package.json');
  const stack: string[] = [];
  let framework: string | null = null;
  let language: string | null = null;

  if (packageJson) {
    try {
      const pkg = JSON.parse(packageJson) as Record<string, Record<string, string>>;
      const allDeps = { ...pkg.dependencies, ...pkg.devDependencies };
      if (allDeps['typescript']) { language = 'TypeScript'; stack.push('TypeScript'); }
      if (allDeps['hono']) { framework = 'Hono'; stack.push('Hono'); }
      if (allDeps['next']) { framework = 'Next.js'; stack.push('Next.js'); }
      if (allDeps['react']) stack.push('React');
      if (allDeps['stripe']) stack.push('Stripe');
    } catch { /* ignore */ }
  }
  if (!language && allPaths.some((p) => p.endsWith('.ts'))) language = 'TypeScript';

  return { project_structure: allPaths.slice(0, 200), stack, framework, language, file_count: allPaths.length };
}

function analyzeConfiguration(tree: TreeEntry[], files: Map<string, string>) {
  const envVars = [...files.entries()]
    .filter(([p]) => p.includes('.env'))
    .flatMap(([, c]) => c.split('\n').filter((l) => l.includes('=') && !l.startsWith('#')).map((l) => l.split('=')[0]?.trim() ?? ''));
  const configFiles = [...files.entries()].filter(([p]) => p.includes('config') || p.endsWith('.toml')).map(([p]) => p);
  const deployFiles = [...files.entries()].filter(([p]) => p.includes('fly.toml') || p.includes('Dockerfile')).map(([p]) => p);
  return { env_vars: envVars, config_files: configFiles, deployment_manifests: deployFiles, has_production_config: deployFiles.length > 0 };
}

function analyzeRoutes(tree: TreeEntry[], files: Map<string, string>) {
  const apiRoutes: string[] = [];
  const pageRoutes: string[] = [];
  for (const [, content] of [...files.entries()].filter(([p]) => p.includes('route'))) {
    const matches = content.match(/\.(get|post|put|delete)\s*\(\s*['"`]([^'"`]+)/g) ?? [];
    for (const m of matches) {
      const route = m.match(/['"`]([^'"`]+)/)?.[1];
      if (route?.startsWith('/api')) apiRoutes.push(route); else if (route) pageRoutes.push(route);
    }
  }
  const middleware = [...files.entries()].filter(([p]) => p.includes('middleware')).map(([p]) => p);
  return { api_routes: apiRoutes, page_routes: pageRoutes, middleware, auth_protected: middleware.some(([, c]) => c.includes('auth')) };
}

function analyzeBilling(files: Map<string, string>) {
  let stripe = false; let pricing: string | null = null; const plans: string[] = []; let webhooks = false;
  for (const [p, c] of files) {
    if (c.includes('stripe') || c.includes('Stripe')) stripe = true;
    if (p.includes('pricing') || c.includes('price_')) { pricing = p; plans.push(...(c.match(/price_[a-zA-Z0-9]+/g) ?? [])); }
    if (c.includes('webhook') && c.includes('stripe')) webhooks = true;
  }
  return { stripe_integration: stripe, pricing_config: pricing, plan_definitions: [...new Set(plans)], webhook_handlers: webhooks };
}

function analyzeTrustSignals(files: Map<string, string>) {
  const landing: string[] = []; const social: string[] = [];
  for (const [p, c] of files) {
    if (p.includes('landing') || p.includes('home')) { landing.push(p); if (c.includes('testimonial')) social.push(p); }
  }
  return { landing_pages: landing, verifiable_claims: [] as string[], unverifiable_claims: [] as string[], social_proof: social };
}

function analyzeErrorHandling(files: Map<string, string>) {
  const boundaries: string[] = []; const fallbacks: string[] = []; const silent: string[] = []; let logging = false;
  for (const [p, c] of files) {
    if (c.includes('ErrorBoundary')) boundaries.push(p);
    if (c.includes('fallback')) fallbacks.push(p);
    if (c.match(/catch\s*\(\s*\)\s*\{?\s*\}/)) silent.push(p);
    if (c.includes('console.error') || c.includes('logger')) logging = true;
  }
  return { error_boundaries: boundaries, fallbacks, silent_failures: silent, logging_present: logging };
}

function analyzeAnalytics(files: Map<string, string>) {
  let telemetry = false; const tracking: string[] = []; let persistence = false;
  for (const [p, c] of files) {
    if (c.includes('analytics') || c.includes('telemetry')) telemetry = true;
    if (c.includes('track(')) tracking.push(p);
    if (c.includes('database') || c.includes('sqlite') || c.includes('turso')) persistence = true;
  }
  return { telemetry, event_tracking: tracking, data_persistence: persistence };
}

function analyzeDependencies(files: Map<string, string>) {
  const services: string[] = []; let fallback = false;
  const pkg = files.get('package.json');
  if (pkg) {
    try {
      const deps = Object.keys((JSON.parse(pkg) as Record<string, Record<string, string>>).dependencies ?? {});
      const map: Record<string, string> = { stripe: 'Stripe', resend: 'Resend', '@clerk/backend': 'Clerk', '@libsql/client': 'Turso', '@anthropic-ai/sdk': 'Anthropic' };
      for (const d of deps) if (map[d]) services.push(map[d]);
    } catch { /* ignore */ }
  }
  for (const [, c] of files) if (c.includes('retry') || c.includes('fallback')) fallback = true;
  return { external_services: services, failure_modes: [] as string[], fallback_defined: fallback };
}
