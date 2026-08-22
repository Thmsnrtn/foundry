// =============================================================================
// FOUNDRY — MCP Server
// Model Context Protocol server that exposes Foundry's intelligence to
// any MCP-compatible coding tool (Claude Code, Cursor, etc.).
//
// The founder connects their coding tool to this server, and every AI
// coding session has access to: audit results, blocking issues, Product DNA,
// failure log, health score, stressors, decisions, and competitive context.
//
// This is the bridge between "Foundry knows your business" and
// "your coding tool writes better code because of it."
//
// Usage:
//   npx tsx src/mcp/server.ts
//
// Then in Claude Code settings, add:
//   { "mcpServers": { "foundry": { "command": "npx", "args": ["tsx", "src/mcp/server.ts"] } } }
//
// Or connect remotely via the HTTP endpoint:
//   GET /mcp/tools — list available tools
//   POST /mcp/call — execute a tool
// =============================================================================

import { query, getLatestAudit, getLatestMetrics, getActiveStressors, getPendingDecisions, getLifecycleState } from '../db/client.js';
import { getProductDNA, getDNACompletionStatus, buildWisdomContext } from '../services/wisdom/dna.js';
import { calculateHealthScore } from '../services/intelligence/health-score.js';
import { getMRRDecomposition, computeHealthRatio } from '../services/intelligence/revenue.js';
import { forecastRevenue, assessChurnRisk } from '../services/intelligence/predictions.js';
import { getPlaintextToken } from '../lib/crypto.js';
import type { RiskStateValue } from '../types/index.js';

// ─── Tool Definitions ───────────────────────────────────────────────────────

export interface MCPTool {
  name: string;
  description: string;
  inputSchema: {
    type: 'object';
    properties: Record<string, { type: string; description: string }>;
    required: string[];
  };
}

export interface MCPToolResult {
  content: Array<{ type: 'text'; text: string }>;
}

export const FOUNDRY_TOOLS: MCPTool[] = [
  {
    name: 'foundry_health_score',
    description: 'Get the overall product health score (0-100) with component breakdown: audit quality, revenue health, risk posture, and engagement. Use this to understand the current state of the product before making changes.',
    inputSchema: {
      type: 'object',
      properties: {
        product_id: { type: 'string', description: 'The Foundry product ID' },
      },
      required: ['product_id'],
    },
  },
  {
    name: 'foundry_audit_results',
    description: 'Get the latest codebase audit results: composite score, verdict (READY/NOT_READY/READY_WITH_CONDITIONS), per-dimension scores (D1-D10), findings, and blocking issues. Use this before fixing code quality issues.',
    inputSchema: {
      type: 'object',
      properties: {
        product_id: { type: 'string', description: 'The Foundry product ID' },
      },
      required: ['product_id'],
    },
  },
  {
    name: 'foundry_blocking_issues',
    description: 'Get all blocking issues from the latest audit with evidence and definition of done. These are the specific problems preventing launch readiness. Use this to know exactly what to fix.',
    inputSchema: {
      type: 'object',
      properties: {
        product_id: { type: 'string', description: 'The Foundry product ID' },
      },
      required: ['product_id'],
    },
  },
  {
    name: 'foundry_product_dna',
    description: 'Get the Product DNA: ICP description, pain points, positioning statement, voice principles, primary objection, retention hypothesis. Use this to write code and copy that aligns with the product strategy.',
    inputSchema: {
      type: 'object',
      properties: {
        product_id: { type: 'string', description: 'The Foundry product ID' },
      },
      required: ['product_id'],
    },
  },
  {
    name: 'foundry_failure_log',
    description: 'Get the failure log: things the founder has tried that did not work, with categories, outcomes, and hypotheses. Use this to avoid recommending or building things that have already been proven wrong.',
    inputSchema: {
      type: 'object',
      properties: {
        product_id: { type: 'string', description: 'The Foundry product ID' },
      },
      required: ['product_id'],
    },
  },
  {
    name: 'foundry_stressors',
    description: 'Get active business stressors: forward-looking risks identified by Foundry, with severity (watch/elevated/critical), signal description, timeframe, and neutralizing actions. Use this to prioritize what code changes would reduce business risk.',
    inputSchema: {
      type: 'object',
      properties: {
        product_id: { type: 'string', description: 'The Foundry product ID' },
      },
      required: ['product_id'],
    },
  },
  {
    name: 'foundry_decisions',
    description: 'Get pending decisions from the decision queue with context, options, trade-offs, and recommendations. Use this to understand strategic context for code changes.',
    inputSchema: {
      type: 'object',
      properties: {
        product_id: { type: 'string', description: 'The Foundry product ID' },
      },
      required: ['product_id'],
    },
  },
  {
    name: 'foundry_metrics',
    description: 'Get the latest business metrics: MRR, churn rate, activation rate, retention, signups, NPS, health ratio. Use this for data-driven decisions about what to build or fix.',
    inputSchema: {
      type: 'object',
      properties: {
        product_id: { type: 'string', description: 'The Foundry product ID' },
      },
      required: ['product_id'],
    },
  },
  {
    name: 'foundry_competitive_signals',
    description: 'Get recent competitive intelligence: competitor moves, pricing changes, feature launches, positioning shifts. Use this to inform competitive feature development.',
    inputSchema: {
      type: 'object',
      properties: {
        product_id: { type: 'string', description: 'The Foundry product ID' },
      },
      required: ['product_id'],
    },
  },
  {
    name: 'foundry_full_context',
    description: 'Get the complete Foundry context for this product in one call: health score, audit summary, blocking issues, DNA, stressors, metrics, and risk state. Use this at the start of a coding session to load full context.',
    inputSchema: {
      type: 'object',
      properties: {
        product_id: { type: 'string', description: 'The Foundry product ID' },
      },
      required: ['product_id'],
    },
  },
];

// ─── Tool Execution ─────────────────────────────────────────────────────────

export async function executeTool(name: string, args: Record<string, string>): Promise<MCPToolResult> {
  const productId = args.product_id;
  if (!productId) return textResult('Error: product_id is required');

  try {
    switch (name) {
      case 'foundry_health_score': return await getHealthScoreContext(productId);
      case 'foundry_audit_results': return await getAuditContext(productId);
      case 'foundry_blocking_issues': return await getBlockingIssuesContext(productId);
      case 'foundry_product_dna': return await getDNAContext(productId);
      case 'foundry_failure_log': return await getFailureLogContext(productId);
      case 'foundry_stressors': return await getStressorContext(productId);
      case 'foundry_decisions': return await getDecisionContext(productId);
      case 'foundry_metrics': return await getMetricsContext(productId);
      case 'foundry_competitive_signals': return await getCompetitiveContext(productId);
      case 'foundry_full_context': return await getFullContext(productId);
      default: return textResult(`Unknown tool: ${name}`);
    }
  } catch (err) {
    return textResult(`Error executing ${name}: ${err instanceof Error ? err.message : String(err)}`);
  }
}

function textResult(text: string): MCPToolResult {
  return { content: [{ type: 'text', text }] };
}

// ─── Tool Implementations ───────────────────────────────────────────────────

async function getHealthScoreContext(productId: string): Promise<MCPToolResult> {
  const health = await calculateHealthScore(productId);
  return textResult(`# Product Health Score: ${health.score}/100 (Grade ${health.grade})

${health.headline}
${health.summary}

## Components
- Audit: ${health.components.audit.score}/100 (${health.components.audit.label})
- Revenue: ${health.components.revenue.score}/100 (${health.components.revenue.label})
- Risk: ${health.components.risk.score}/100 (${health.components.risk.label})
- Engagement: ${health.components.engagement.score}/100 (${health.components.engagement.label})`);
}

async function getAuditContext(productId: string): Promise<MCPToolResult> {
  const audit = await getLatestAudit(productId);
  if (audit.rows.length === 0) return textResult('No audit has been run yet. Connect a GitHub repo and run an audit from the Foundry dashboard.');

  const a = audit.rows[0] as Record<string, unknown>;
  const dimensions = [1,2,3,4,5,6,7,8,9,10].map((d) => `D${d}: ${a[`d${d}_score`] ?? '?'}/10`).join('\n');

  return textResult(`# Latest Audit
Composite: ${a.composite}/10
Verdict: ${a.verdict}
Run type: ${a.run_type}
Date: ${a.created_at}

## Dimension Scores
${dimensions}

## Findings
${a.findings ? JSON.stringify(JSON.parse(a.findings as string), null, 2) : 'No findings recorded'}`);
}

async function getBlockingIssuesContext(productId: string): Promise<MCPToolResult> {
  const audit = await getLatestAudit(productId);
  if (audit.rows.length === 0) return textResult('No audit has been run yet.');

  const a = audit.rows[0] as Record<string, unknown>;
  let issues: Array<Record<string, unknown>> = [];
  try {
    issues = a.blocking_issues ? JSON.parse(a.blocking_issues as string) : [];
  } catch { issues = []; }

  if (issues.length === 0) return textResult('No blocking issues found. Product meets launch readiness across all dimensions.');

  const formatted = issues.map((issue, i) => `## Issue ${i + 1}: ${issue.dimension}
**Problem:** ${issue.issue}
**Evidence:** ${issue.evidence}
**Definition of Done:** ${issue.definition_of_done}
**Dependencies:** ${(issue.dependencies as string[])?.join(', ') || 'None'}`).join('\n\n');

  return textResult(`# Blocking Issues (${issues.length} total)\n\nThese must be resolved for launch readiness.\n\n${formatted}`);
}

async function getDNAContext(productId: string): Promise<MCPToolResult> {
  const dna = await getProductDNA(productId);
  if (!dna) return textResult('Product DNA not configured yet. Fill it out at /products/{id}/dna in the Foundry dashboard.');

  const { complete, empty } = getDNACompletionStatus(dna);

  return textResult(`# Product DNA (${dna.completion_pct}% complete)

## ICP (Ideal Customer Profile)
- Description: ${dna.icp_description ?? 'Not set'}
- Pain: ${dna.icp_pain ?? 'Not set'}
- Trigger: ${dna.icp_trigger ?? 'Not set'}

## Positioning
- Statement: ${dna.positioning_statement ?? 'Not set'}
- What we are NOT: ${dna.what_we_are_not ?? 'Not set'}

## Objection Handling
- Primary objection: ${dna.primary_objection ?? 'Not set'}
- Response: ${dna.objection_response ?? 'Not set'}

## Voice Principles
${dna.voice_principles?.map((v) => `- DO: ${v.do} / DON'T: ${v.dont}`).join('\n') ?? 'Not set'}

## Hypotheses
- Market insight: ${dna.market_insight ?? 'Not set'}
- Retention: ${dna.retention_hypothesis ?? 'Not set'}
- Growth: ${dna.growth_hypothesis ?? 'Not set'}

## Missing Sections: ${empty.join(', ') || 'None — fully complete'}`);
}

async function getFailureLogContext(productId: string): Promise<MCPToolResult> {
  const failures = await query(
    'SELECT * FROM failure_log WHERE product_id = ? ORDER BY created_at DESC LIMIT 20',
    [productId]
  );

  if (failures.rows.length === 0) return textResult('No failures logged yet. The founder can log failures at /products/{id}/failures.');

  const formatted = failures.rows.map((f) => {
    const r = f as Record<string, string>;
    return `- **${r.category}**: Tried "${r.what_was_tried}" → Outcome: ${r.outcome}${r.founder_hypothesis ? ` (Hypothesis: ${r.founder_hypothesis})` : ''}`;
  }).join('\n');

  return textResult(`# Failure Log (${failures.rows.length} entries)\n\nThings this founder tried that didn't work. Avoid recommending these approaches.\n\n${formatted}`);
}

async function getStressorContext(productId: string): Promise<MCPToolResult> {
  const stressors = await getActiveStressors(productId);
  if (stressors.rows.length === 0) return textResult('No active stressors. Product risk is clear.');

  const formatted = stressors.rows.map((s) => {
    const r = s as Record<string, string>;
    return `## ${r.stressor_name} [${r.severity.toUpperCase()}]
Signal: ${r.signal}
Timeframe: ${r.timeframe_days} days
Action: ${r.neutralizing_action}`;
  }).join('\n\n');

  return textResult(`# Active Stressors (${stressors.rows.length})\n\n${formatted}`);
}

async function getDecisionContext(productId: string): Promise<MCPToolResult> {
  const decisions = await getPendingDecisions(productId);
  if (decisions.rows.length === 0) return textResult('No pending decisions.');

  const formatted = decisions.rows.map((d) => {
    const r = d as Record<string, string>;
    return `## ${r.what} [${r.category}]
Why now: ${r.why_now}
Gate: ${r.gate}`;
  }).join('\n\n');

  return textResult(`# Pending Decisions (${decisions.rows.length})\n\n${formatted}`);
}

async function getMetricsContext(productId: string): Promise<MCPToolResult> {
  const metrics = await getLatestMetrics(productId);
  if (metrics.rows.length === 0) return textResult('No metrics recorded. Founder should enter metrics at /products/{id}/revenue.');

  const m = metrics.rows[0] as Record<string, unknown>;
  const mrr = await getMRRDecomposition(productId);
  const health = mrr ? computeHealthRatio(mrr) : null;

  return textResult(`# Latest Metrics (${m.snapshot_date})
- Active Users: ${m.active_users ?? '?'}
- Signups (7d): ${m.signups_7d ?? '?'}
- Activation Rate: ${m.activation_rate != null ? `${((m.activation_rate as number) * 100).toFixed(1)}%` : '?'}
- Day 30 Retention: ${m.day_30_retention != null ? `${((m.day_30_retention as number) * 100).toFixed(1)}%` : '?'}
- Churn Rate: ${m.churn_rate != null ? `${((m.churn_rate as number) * 100).toFixed(1)}%` : '?'}
- NPS: ${m.nps_score ?? '?'}

## Revenue
- MRR: ${mrr?.level_cents == null ? 'not reported' : `$${(mrr.level_cents / 100).toFixed(0)}`}
- Net new this period: $${((mrr?.net_new_cents ?? 0) / 100).toFixed(0)}
- New MRR: $${((mrr?.new_cents ?? 0) / 100).toFixed(0)}
- Churned MRR: $${((mrr?.churned_cents ?? 0) / 100).toFixed(0)}
- Health Ratio: ${health?.value == null ? 'unknown — no new MRR to divide by' : `${health.value.toFixed(2)} (${health.indicator})`}`);
}

async function getCompetitiveContext(productId: string): Promise<MCPToolResult> {
  const signals = await query(
    `SELECT * FROM competitive_signals WHERE product_id = ? AND significance IN ('medium', 'high') ORDER BY detected_at DESC LIMIT 10`,
    [productId]
  );

  if (signals.rows.length === 0) return textResult('No recent competitive signals.');

  const formatted = signals.rows.map((s) => {
    const r = s as Record<string, string>;
    return `- **${r.competitor_name}** [${r.significance}]: ${r.signal_summary} (${r.signal_type}, ${r.detected_at})`;
  }).join('\n');

  return textResult(`# Recent Competitive Signals\n\n${formatted}`);
}

async function getFullContext(productId: string): Promise<MCPToolResult> {
  const [healthResult, auditResult, blockingResult, dnaResult, stressorResult, metricsResult] = await Promise.all([
    getHealthScoreContext(productId),
    getAuditContext(productId),
    getBlockingIssuesContext(productId),
    getDNAContext(productId),
    getStressorContext(productId),
    getMetricsContext(productId),
  ]);

  const sections = [healthResult, auditResult, blockingResult, dnaResult, stressorResult, metricsResult]
    .map((r) => r.content[0].text)
    .join('\n\n---\n\n');

  return textResult(`# Foundry Full Context\n\nLoaded at: ${new Date().toISOString()}\n\n---\n\n${sections}`);
}
