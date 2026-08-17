#!/usr/bin/env node
import { readFileSync, writeFileSync } from 'node:fs';
import { relative, resolve } from 'node:path';
import { globSync } from 'glob';

const root = resolve(import.meta.dirname, '..');
const files = globSync('src/**/*.ts', { cwd: root, absolute: true }).sort();
const rules = [
  { id: 'external_post', re: /fetch\(\s*(['"`])https:\/\/(?!api\.openrouter\.ai)([^'"`]+)\1\s*,\s*\{[\s\S]{0,500}?method:\s*['"](POST|PUT|PATCH|DELETE)['"]/g },
  // A URL assembled from a template was invisible to the detector above, which
  // requires the host to appear inside the quotes. `fetch(`${baseUrl}/audio/
  // transcriptions`, {method:'POST'})` is exactly as consequential as a literal
  // one — it was the codebase's only unreserved paid provider call, and the
  // inventory reported zero direct effects while it existed.
  { id: 'templated_post', re: /fetch\(\s*`\$\{[^`]*`\s*,\s*\{[\s\S]{0,500}?method:\s*['"](POST|PUT|PATCH|DELETE)['"]/g },
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
  // Traced, not assumed. Both files POST to a GraphQL endpoint, which is what
  // the detector sees; every remaining operation is a QUERY. `read_only` is a
  // real classification and deliberately not `governed` — a read does not need
  // the gateway, and calling it governed would overstate what holds.
  //
  // The one genuine mutation these files contained — an `issueCreate` into a
  // customer's workspace, outside the gateway and with no callers — was
  // deleted. See the header of services/integrations/linear.ts.
  'src/services/integrations/linear.ts|external_post': ['read_only', 'GraphQL query: completed issues for ship-cadence metrics'],
  'src/services/integration/linear.ts|external_post': ['read_only', 'GraphQL queries: in-progress, completed and velocity issue counts'],
  'src/services/scp/briefing/voice-reply.ts|templated_post': ['control_path', 'Whisper transcription — reserves against the AI ceilings before dispatch, settles at a conservative bound, releases only on a definitive refusal'],
  // Surfaced the moment the detector learned to read templated URLs. Six were
  // already-known handlers reached by a URL it could not see; the seventh had
  // never been inventoried at all.
  'src/services/ai/client.ts|templated_post': ['control_path', 'the central AI client — atomic reservation before dispatch, settlement or release after'],
  'src/services/integration/github-gateway.ts|templated_post': ['governed', 'GitHub capability handlers'],
  'src/services/integration/stripe-gateway.ts|templated_post': ['governed', 'Stripe capability handlers'],
  'src/services/notifications/push.ts|templated_post': ['governed', 'APNs/FCM device push, registered as the send_push gateway capability. It was classified unreachable — registration routes live, no sender anywhere — and the owner chose to wire it rather than remove the surface. Wiring it was the deliberate act this line asked for: it now inherits the kill-switch, the entitlement pause, dedup and audit from the same door as email, and the live caller is the risk-state transition'],
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
  // An untraced consequential effect is the state this audit exists to surface.
  const unresolvedCount = findings.filter((f) => f.status === 'unresolved').length;

  // `unreachable` is a claim about the rest of the repository, so it is checked
  // rather than believed: a module classified that way must have no importer in
  // src/. The day somebody wires one up, the audit says so instead of letting a
  // stale reassurance stand.
  const wronglyUnreachable = [];
  for (const finding of findings.filter((f) => f.status === 'unreachable')) {
    const base = finding.file.replace(/^src\//, '').replace(/\.ts$/, '');
    const importers = files.filter((abs) => {
      const rel = relative(root, abs).replaceAll('\\', '/');
      if (rel === finding.file) return false;
      return new RegExp(`${base.split('/').pop()}\\.js`).test(readFileSync(abs, 'utf8'));
    });
    if (importers.length) wronglyUnreachable.push(`${finding.file} is imported by ${importers.length} module(s)`);
  }
  if (wronglyUnreachable.length) {
    console.error(`Classified unreachable but reachable:\n${wronglyUnreachable.join('\n')}`);
    process.exit(1);
  }
  if (unclassified.length) {
    console.error(`Unclassified consequential effects: ${unclassified.length}`);
    process.exit(1);
  }
  // Ratcheted to zero once the last four were traced. `unresolved` meant "a
  // consequential effect nobody has determined the consequence of", which is
  // precisely the state this audit exists to surface — it sat at four for a
  // long time, and tracing them found an ungoverned write into a customer's
  // Linear workspace with no callers. Leaving the door open would let the next
  // one sit just as long. Trace it, then classify it.
  if (unresolvedCount) {
    console.error(
      `Untraced consequential effects: ${unresolvedCount}. Determine whether each one reads or `
      + `writes, then classify it (governed / control_path / read_only / direct).`);
    process.exit(1);
  }
  const readOnly = findings.filter((f) => f.status === 'read_only').length;
  const direct = findings.filter((f) => f.status === 'direct').length;
  const unreachable = findings.filter((f) => f.status === 'unreachable').length;
  console.log(`✓ consequential-effect inventory holds (${findings.length} findings; ${direct} direct, ${readOnly} read-only, ${unreachable} unreachable, ${unresolvedCount} untraced)`);
}
