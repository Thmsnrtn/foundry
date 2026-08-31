import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

// =============================================================================
// A second, ungoverned writer for an effect that already had a governed one.
//
// The repo's own consequential-effects audit carried four findings marked
// `unresolved` — meaning nobody had determined whether those calls read or
// wrote. They had sat that way for a long time, which is what "unresolved"
// quietly becomes.
//
// Tracing them settled it. Three were GraphQL QUERIES. The fourth,
// `createLinearIssueFromBlockingIssue`, posted an `issueCreate` MUTATION
// straight to `api.linear.app` — an irreversible write into a customer's
// workspace, outside the outbound gateway, so with no kill-switch, no
// classification, no budget, no idempotency key, and no receipt. And it had no
// callers at all.
//
// The live path for creating a Linear issue is the approved action in
// `services/scp/actions/executor.ts`, which carries a durable receipt. So this
// was a duplicate writer with weaker governance — deleted rather than
// classified, and the audit ratcheted so the next untraced effect cannot sit
// for a year the way this one did.
// =============================================================================

const ROOT = resolve(__dirname, '../..');

const LINEAR_MODULES = [
  'src/services/integrations/linear.ts',
  'src/services/integration/linear.ts',
];

/** Comments stripped, and only where they open a line — a naive block-comment
 * regex also fires on `/*` inside a string literal. */
function executable(rel: string): string {
  return readFileSync(resolve(ROOT, rel), 'utf8')
    .replace(/^[ \t]*\/\*[\s\S]*?\*\//gm, ' ')
    .split('\n').map((l) => l.replace(/^\s*\/\/.*$/, '')).join('\n');
}

describe('the Linear integration', () => {
  it('sends no GraphQL mutation to a customer workspace', () => {
    for (const rel of LINEAR_MODULES) {
      const source = executable(rel);
      expect(source, `${rel} must not mutate a customer's Linear workspace`)
        .not.toMatch(/\bmutation\b/i);
      // The specific operations that were there, named, so a re-add is loud.
      for (const write of ['issueCreate', 'issueUpdate', 'issueDelete', 'commentCreate']) {
        expect(source, `${rel} must not call ${write}`).not.toContain(write);
      }
    }
  });

  it('keeps exactly one writer for the effect that does exist', () => {
    // Creating a Linear issue is a real capability and it is not being removed
    // — only the second, weaker copy of it. The governed one carries a receipt.
    const executor = executable('src/services/scp/actions/executor.ts');
    expect(executor, 'the approved-action path is the one that may write')
      .toContain('issueCreate');
    expect(executor, 'and it must record what the provider said')
      .toMatch(/effect_certainty/);
  });

  it('is classified as read-only in the effects inventory, not as governed', () => {
    // A read does not need the gateway. Calling it `governed` would overstate
    // what actually holds, and this audit is one of the places overstatement
    // would be believed.
    const inventory = JSON.parse(readFileSync(
      resolve(ROOT, 'docs/foundry-institution/CONSEQUENTIAL_EFFECTS.json'), 'utf8')) as {
        findings: Array<{ file: string; status: string; capability: string }>;
      };
    const linear = inventory.findings.filter((f) => f.file.includes('linear.ts'));
    expect(linear.length).toBeGreaterThan(0);
    for (const finding of linear) {
      expect(finding.status, `${finding.file} should be read_only`).toBe('read_only');
      expect(finding.capability.toLowerCase()).toContain('quer');
    }
  });

  it('leaves nothing in the inventory untraced', () => {
    // The ratchet. `unresolved` means "a consequential effect nobody has
    // determined the consequence of" — it sat at four, and tracing them found
    // an ungoverned write. Zero, now enforced by the audit script itself.
    const inventory = JSON.parse(readFileSync(
      resolve(ROOT, 'docs/foundry-institution/CONSEQUENTIAL_EFFECTS.json'), 'utf8')) as {
        findings: Array<{ status: string; file: string }>;
      };
    const untraced = inventory.findings.filter((f) => f.status === 'unresolved');
    expect(untraced.map((f) => f.file)).toEqual([]);

    const script = readFileSync(resolve(ROOT, 'scripts/audit-consequential-effects.mjs'), 'utf8');
    expect(script, 'the audit must fail on an untraced effect, not merely count it')
      .toMatch(/Untraced consequential effects/);
  });
});
