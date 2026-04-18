// =============================================================================
// FOUNDRY — MCP CLI
// Quick context dump for founders who want to paste into any AI chat.
//
// Usage:
//   npx tsx src/mcp/cli.ts context <product_id>     — full context dump
//   npx tsx src/mcp/cli.ts fix <product_id> <issue>  — blocking issue context
//   npx tsx src/mcp/cli.ts audit <product_id>        — audit results only
//   npx tsx src/mcp/cli.ts dna <product_id>          — product DNA only
// =============================================================================

import { executeTool } from './server.js';

async function main() {
  const [,, command, productId, ...rest] = process.argv;

  if (!command || !productId) {
    console.log(`
Foundry Context CLI — Export Foundry intelligence for your coding tool.

Usage:
  npx tsx src/mcp/cli.ts context <product_id>     Full context (health, audit, DNA, stressors, metrics)
  npx tsx src/mcp/cli.ts audit <product_id>        Audit results with dimension scores
  npx tsx src/mcp/cli.ts issues <product_id>       Blocking issues with evidence
  npx tsx src/mcp/cli.ts dna <product_id>          Product DNA (ICP, positioning, voice)
  npx tsx src/mcp/cli.ts failures <product_id>     Failure log (what didn't work)
  npx tsx src/mcp/cli.ts stressors <product_id>    Active business stressors
  npx tsx src/mcp/cli.ts metrics <product_id>      Latest business metrics

The output is markdown. Pipe to clipboard:
  npx tsx src/mcp/cli.ts context abc123 | pbcopy
    `);
    process.exit(0);
  }

  const toolMap: Record<string, string> = {
    context: 'foundry_full_context',
    audit: 'foundry_audit_results',
    issues: 'foundry_blocking_issues',
    fix: 'foundry_blocking_issues',
    dna: 'foundry_product_dna',
    failures: 'foundry_failure_log',
    stressors: 'foundry_stressors',
    metrics: 'foundry_metrics',
    health: 'foundry_health_score',
    decisions: 'foundry_decisions',
    competitive: 'foundry_competitive_signals',
  };

  const toolName = toolMap[command];
  if (!toolName) {
    console.error(`Unknown command: ${command}. Use 'context', 'audit', 'issues', 'dna', 'failures', 'stressors', or 'metrics'.`);
    process.exit(1);
  }

  const result = await executeTool(toolName, { product_id: productId });
  console.log(result.content[0].text);
}

main().catch((err) => {
  console.error('Error:', err.message);
  process.exit(1);
});
