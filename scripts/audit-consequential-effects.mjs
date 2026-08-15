#!/usr/bin/env node
import { readFileSync, writeFileSync } from 'node:fs';
import { relative, resolve } from 'node:path';
import { globSync } from 'glob';

const root = resolve(import.meta.dirname, '..');
const files = globSync('src/**/*.ts', { cwd: root, absolute: true }).sort();
const rules = [
  { id: 'external_post', re: /fetch\(\s*(['"`])https:\/\/(?!api\.openrouter\.ai)([^'"`]+)\1\s*,\s*\{[\s\S]{0,500}?method:\s*['"](POST|PUT|PATCH|DELETE)['"]/g },
  { id: 'dynamic_webhook_post', re: /fetch\(\s*(url|payload\.webhook_url|config\.url|webhook\.url)\s*,\s*\{[\s\S]{0,300}?method:\s*['"]POST['"]/g },
  { id: 'stripe_sdk_mutation', re: /stripe\.(customers\.create|subscriptions\.(?:create|update|cancel)|checkout\.sessions\.create|billingPortal\.sessions\.create|oauth\.token)\s*\(/g },
  { id: 'resend_sdk_send', re: /resend\.emails\.send\s*\(/g },
];

const classifications = new Map(Object.entries({
  'src/lib/webhooks.ts|dynamic_webhook_post': ['control_path', 'product-scoped customer webhook credential and receipt owner'],
  'src/routes/dashboard/onboarding.ts|external_post': ['control_path', 'GitHub OAuth credential exchange'],
  'src/services/distribution/outbound-webhooks.ts|dynamic_webhook_post': ['governed', 'post_webhook capability handler'],
  'src/services/integration/resend.ts|external_post': ['governed', 'send_email capability handler'],
  'src/services/integration/stripe-gateway.ts|external_post': ['governed', 'Stripe capability handlers'],
  'src/services/integration/github-gateway.ts|external_post': ['governed', 'GitHub capability handlers'],
  'src/services/integration/mcp-client.ts|dynamic_webhook_post': ['governed', 'MCP capability handler'],
  'src/services/integration/slack.ts|external_post': ['control_path', 'Slack credential owner with effect receipts'],
  'src/services/integrations/linear.ts|external_post': ['unresolved', 'GraphQL read/write operation requires operation tracing'],
  'src/services/integration/linear.ts|external_post': ['unresolved', 'GraphQL operation requires operation tracing'],
  'src/services/scp/briefing/email-digest.ts|external_post': ['direct', 'Resend/SendGrid weekly digest delivery'],
  'src/services/scp/actions/executor.ts|external_post': ['control_path', 'approved Linear action with durable receipt'],
  'src/services/scp/actions/executor.ts|dynamic_webhook_post': ['control_path', 'approved custom webhook with SSRF guard and durable receipt'],
  'src/services/billing/stripe.ts|stripe_sdk_mutation': ['control_path', 'Foundry SaaS billing credential owner'],
  'src/services/integrations/stripe-sync.ts|stripe_sdk_mutation': ['control_path', 'Stripe OAuth credential exchange'],
}));

const findings = [];
for (const abs of files) {
  const file = relative(root, abs).replaceAll('\\', '/');
  const source = readFileSync(abs, 'utf8');
  for (const rule of rules) {
    for (const match of source.matchAll(rule.re)) {
      const key = `${file}|${rule.id}`;
      const classified = classifications.get(key);
      findings.push({
        file, line: source.slice(0, match.index).split('\n').length,
        detector: rule.id,
        status: classified?.[0] ?? 'unclassified',
        capability: classified?.[1] ?? 'unknown',
      });
    }
  }
}
findings.sort((a, b) => a.file.localeCompare(b.file) || a.line - b.line || a.detector.localeCompare(b.detector));
const unclassified = findings.filter((f) => f.status === 'unclassified');
const out = `${JSON.stringify({ generated_by: 'scripts/audit-consequential-effects.mjs', findings }, null, 2)}\n`;
if (process.argv.includes('--write')) {
  writeFileSync(resolve(root, 'docs/foundry-institution/CONSEQUENTIAL_EFFECTS.json'), out);
  console.log(`wrote ${findings.length} effect findings`);
} else {
  const expected = readFileSync(resolve(root, 'docs/foundry-institution/CONSEQUENTIAL_EFFECTS.json'), 'utf8');
  if (expected !== out) {
    console.error('Consequential-effect inventory drift. Run: node scripts/audit-consequential-effects.mjs --write');
    process.exit(1);
  }
  if (unclassified.length) {
    console.error(`Unclassified consequential effects: ${unclassified.length}`);
    process.exit(1);
  }
  const direct = findings.filter((f) => f.status === 'direct').length;
  console.log(`✓ consequential-effect inventory holds (${findings.length} findings; ${direct} direct)`);
}
