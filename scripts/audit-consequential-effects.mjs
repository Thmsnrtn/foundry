#!/usr/bin/env node
import { readFileSync, writeFileSync } from 'node:fs';
import { relative, resolve } from 'node:path';
import { globSync } from 'glob';
import { stripComments } from './lib/strip-comments.mjs';

const root = resolve(import.meta.dirname, '..');
const files = globSync('src/**/*.ts', { cwd: root, absolute: true }).sort();

/** Comments describe effects; they are not effects. Blanked rather than removed
 *  so reported line numbers still point at the real line. */
const strip = (s) => stripComments(s, { lineComments: false })
  .split('\n').map((l) => l.replace(/^(\s*)\/\/.*$/, '$1')).join('\n');
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
  // RUNNING A PROGRAM ON THE HOST IS AN EFFECT CLASS OF ITS OWN, and until a
  // workshop substrate existed there was nothing in this codebase that did it.
  // A shell is an interface, not a lesser kind of consequence: a spawn can
  // reach a network, a filesystem and a credential, so every one of them has to
  // be named here and classified rather than arriving unnoticed with the next
  // convenience.
  // Matched at the IMPORT, not the call. A first attempt matched any `exec(`
  // and swept up every `RegExp.prototype.exec` in the codebase — sixteen
  // findings that run no program at all, which would have made the inventory
  // useless by making it noisy. The fact worth inventorying is per file and it
  // is this: THIS FILE CAN RUN PROGRAMS.
  { id: 'process_spawn', re: /from\s+['"]node:child_process['"]|require\(\s*['"]child_process['"]/g },
];

const classifications = new Map(Object.entries({
  // The customer-facing webhook fan-out. Classified control_path on the
  // strength of owning its credential and receipts — which it does — while
  // reaching none of the checks that decide whether Foundry may act for the
  // company at all. There are two webhook paths in this system and only the
  // other one went through the gateway. Now kill-switch checked before
  // dispatch, which is what governed means.
  'src/lib/webhooks.ts|dynamic_webhook_post': ['governed', 'customer webhook fan-out — kill-switch checked before dispatch, per-delivery receipt after'],
  'src/routes/dashboard/onboarding.ts|external_post': ['control_path', 'GitHub OAuth credential exchange'],
  'src/services/distribution/outbound-webhooks.ts|dynamic_webhook_post': ['governed', 'post_webhook capability handler'],
  'src/services/integration/resend.ts|external_post': ['governed', 'send_email capability handler'],
  'src/services/integration/stripe-gateway.ts|external_post': ['governed', 'Stripe capability handlers'],
  'src/services/integration/github-gateway.ts|external_post': ['governed', 'GitHub capability handlers'],
  'src/services/integration/mcp-client.ts|dynamic_webhook_post': ['governed', 'MCP capability handler'],
  // Both callers now check the kill switch before reaching this sender: the
  // approved-action executor and the daily-briefing push. The sender itself
  // stays the single place transport and receipt semantics live.
  'src/services/integration/slack.ts|external_post': ['governed', 'Slack sender — every caller kill-switch checked before dispatch, effect receipts after'],
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
  // These two used to be classified `control_path` on the strength of owning
  // their credential and writing a receipt. What they did not do was ask
  // whether the company may act at all: `checkKillSwitch` had exactly one
  // caller in the system, the outbound gateway, so this second outward door
  // dispatched for companies that were paused, unentitled or erased. It now
  // passes the same check before dispatch — which is what `governed` means.
  'src/services/scp/actions/executor.ts|external_post': ['governed', 'approved Linear action — kill-switch checked before dispatch, durable receipt after'],
  'src/services/scp/actions/executor.ts|dynamic_webhook_post': ['governed', 'approved custom webhook — kill-switch checked before dispatch, SSRF guard and durable receipt'],
  'src/services/billing/stripe.ts|stripe_sdk_mutation': ['control_path', 'Foundry SaaS billing credential owner'],
  'src/services/integrations/stripe-sync.ts|stripe_sdk_mutation': ['control_path', 'Stripe OAuth credential exchange'],
  // THE SENSE'S OWN CREDENTIAL, and nothing else. Three calls: exchanging a
  // code the OWNER just authorised, deauthorising when he disconnects, and
  // asking whether the key is still alive. None carries company data outward,
  // none changes anything in the world except Foundry's own access, and the
  // scope requested is read-only and comes from a constitutional table that
  // cannot be widened at runtime (migration 231). Same class as the OAuth
  // exchanges above it, for the same reason.
  'src/services/senses/providers/stripe.ts|dynamic_webhook_post': ['control_path', 'sense credential lifecycle — owner-authorised exchange, revocation and liveness probe, read-only scope'],
  // The one substrate that runs programs. Governed by the workshop rather than
  // the outbound door, and deliberately: nothing here reaches the world, so
  // there is no kill switch to consult. What holds instead is narrower and
  // enforced in the same file — an allow-list with no network program on it, an
  // environment built from nothing rather than filtered, paths that cannot
  // leave the workshop directory, a wall-clock timeout, and a database rule
  // that refuses to put code Foundry did not write on Foundry's own host.
  'src/services/workshop/local-process.ts|process_spawn': ['workshop', 'a workshop step — allow-listed program, no network, stripped environment, contained path, timed out'],
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
  // GOVERNED MEANS A GUARD RAN, NOT THAT ONE EXISTS SOMEWHERE.
  //
  // `src/services/scp/actions/executor.ts` and `src/lib/webhooks.ts` were both
  // classified `control_path` on the strength of owning their credential and
  // writing a receipt — true, and beside the point. Neither asked whether
  // Foundry may act for the company at all: `checkKillSwitch` had exactly ONE
  // caller in the system, the outbound gateway. Two doors, one rule, one door
  // checking it.
  //
  // So `governed` now has to be demonstrable. The guard is either in the file
  // or in every caller of it, and when it is in the callers they are named
  // here — because "the callers check" is a claim about other files, and a
  // claim about other files is the kind that stops being true quietly.
  const GUARD_IN_CALLERS = {
    // One sender, transport and receipt semantics in one place; both callers
    // check before they reach it.
    'src/services/integration/slack.ts': [
      'src/services/scp/actions/executor.ts',
      'src/services/scp/scheduler.ts',
    ],
  };
  // Two ways a file proves it: it CALLS the kill switch itself, or it registers
  // a capability handler with the outbound gateway, which runs the kill switch
  // before dispatching to any handler.
  //
  // A CALL, not a mention. The first version of this matched the string
  // `outbound/gateway.js`, and mutation testing walked straight through it:
  // delete the guard, add `import type { GatewayRequest } from
  // '../../outbound/gateway.js'`, and the file still "proved" it was governed
  // while checking nothing. A type import is erased at compile time — it
  // cannot be evidence that anything runs.
  //
  // CALLED BY ITS OWN NAME. Aliasing the import — `{ checkKillSwitch: gate }`
  // — fails this, which is deliberate: a name match cannot follow an alias
  // without real analysis, and a gate that guesses is worse than one with a
  // stated house rule. The rule is that a guard on a consequential effect is
  // called by the name it has, so that reading the file tells you.
  const GUARD = /\bcheckKillSwitch\s*\(|\bregisterToolHandler\s*\(/;
  const ungoverned = [];
  for (const file of new Set(findings.filter((f) => f.status === 'governed').map((f) => f.file))) {
    const holders = GUARD_IN_CALLERS[file] ?? [file];
    for (const holder of holders) {
      let src = '';
      try {
        // Comments explaining the guard are not the guard. This audit found
        // its own version of that: the first attempt matched the sentence
        // describing why the check is there.
        src = stripComments(readFileSync(resolve(root, holder), 'utf8'), { lineComments: false })
          .split('\n')
          .map((l) => l.replace(/^\s*\/\/.*$/, ''))
          // `import type` is erased at compile time. Whatever it names, it
          // does not run.
          .filter((l) => !/^\s*import\s+type\b/.test(l))
          .join('\n');
      } catch { /* reported below */ }
      if (!GUARD.test(src)) ungoverned.push(`${file} → guard expected in ${holder}`);
    }
  }
  if (ungoverned.length) {
    console.error(
      'Classified `governed`, but nothing in the file or its named callers CALLS '
      + 'checkKillSwitch() or registerToolHandler():\n' + ungoverned.join('\n')
      + '\n\nA mention is not a call: an `import type` is erased at compile time, and'
      + '\nan aliased import cannot be followed by a name match. Call the guard by its'
      + '\nown name, or correct the classification.');
    process.exit(1);
  }

  // THE DETECTOR'S OWN BLIND SPOT, MADE LOUD.
  //
  // Every rule above reads a bounded window after `fetch(` looking for a
  // mutating method. A fetch whose options object is longer than that window,
  // or whose URL takes a shape no rule anticipated, is not reported as
  // uncovered — it is simply absent, and an inventory with a silent hole reads
  // exactly like a complete one. That is the failure mode this whole campaign
  // is about, and an instrument is not exempt from it.
  //
  // So: find every fetch that carries a mutating method by ANY route, and
  // require each one to be either matched by a rule or plainly a call to
  // Foundry's own relative paths (the browser-side fetches embedded in
  // dashboard HTML, which leave nothing).
  const uncovered = [];
  for (const file of files) {
    const src = strip(readFileSync(file, 'utf8'));
    const rel = relative(root, file);
    const covered = new Set();
    for (const { re } of rules) for (const m of src.matchAll(new RegExp(re.source, re.flags))) covered.add(m.index);
    for (const m of src.matchAll(/fetch\(/g)) {
      const tail = src.slice(m.index, m.index + 2000);
      if (!/method:\s*['"](POST|PUT|PATCH|DELETE)['"]/.test(tail)) continue;
      if (covered.has(m.index)) continue;
      // A relative path is this application talking to itself.
      if (/^fetch\(\s*['"`]\//.test(tail)) continue;
      uncovered.push(`${rel}:${src.slice(0, m.index).split('\n').length}  ${tail.slice(0, 80).replace(/\s+/g, ' ')}`);
    }
  }
  if (uncovered.length) {
    console.error('Outward calls the inventory rules cannot see:\n');
    for (const u of uncovered) console.error('  ' + u);
    console.error('\nAdd a rule that matches it, or the effect is uninventoried.');
    process.exit(1);
  }

  const readOnly = findings.filter((f) => f.status === 'read_only').length;
  const direct = findings.filter((f) => f.status === 'direct').length;
  const unreachable = findings.filter((f) => f.status === 'unreachable').length;
  console.log(`✓ consequential-effect inventory holds (${findings.length} findings; ${direct} direct, ${readOnly} read-only, ${unreachable} unreachable, ${unresolvedCount} untraced)`);
}
