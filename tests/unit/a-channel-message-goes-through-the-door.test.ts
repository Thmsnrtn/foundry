process.env.TURSO_DATABASE_URL = 'file::memory:';
process.env.ENCRYPTION_KEY = '7'.repeat(64);

import { beforeAll, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { runMigrations } from '../../src/db/migrate.js';
import { query } from '../../src/db/client.js';

// =============================================================================
// A CHANNEL MESSAGE GOES THROUGH THE DOOR LIKE EVERY OTHER MESSAGE.
//
// A reconstruction of every external effect in the institution found exactly
// one outbound-mutating integration that did not pass the outbound door:
// `sendSlackNotification` posted to `chat.postMessage` with a bare `fetch`,
// and the action executor called it directly. The EMAIL path twenty lines
// above it in the same file — same approval, same table, same founder — went
// through `invoke`.
//
// What that bypassed was not decoration: the kill switch (a paused company, a
// disabled tool, and the owner's standing "never" and "ask me first"
// boundaries), the consequence rung, the surface and data-class assertions,
// dedup, the communication budget, and the audit row. `post_slack` is already
// named in `REACHES_A_PERSON`, so the owner's contact boundary was written to
// cover it and had no way to see it.
//
// These are structural proofs on purpose. The behaviour they protect is a
// message NOT being sent, and the honest way to hold that is to show the call
// goes through the door and that the door would refuse it — not to assert on a
// stub that never gets reached.
// =============================================================================

beforeAll(async () => { await runMigrations(); });

describe('the tool is bound to a capability, because an unbound tool is refused', () => {
  it('has a provider row binding post_slack to post_to_channel', async () => {
    const r = (await query(
      `SELECT p.capability_key, p.how, p.maturity, c.rung
         FROM capability_providers p JOIN capabilities c ON c.capability_key = p.capability_key
        WHERE p.tool = 'post_slack'`)).rows[0] as Record<string, unknown> | undefined;
    expect(r).toBeTruthy();
    expect(String(r!.capability_key)).toBe('post_to_channel');
    // A MESSAGE TO A PERSON IS A PUBLIC ACT, and the rung is what makes the
    // door treat it as one.
    expect(String(r!.rung)).toBe('public');
    expect(String(r!.how)).toBe('api');
    // Nothing arrives proven.
    expect(String(r!.maturity)).toBe('available');
  });

  it('is the rung the owner\'s contact boundary was already written for', async () => {
    const intent = readFileSync('src/services/institution/standing-intent.ts', 'utf8');
    expect(intent).toContain("'post_slack'");
    expect(intent).toContain('REACHES_A_PERSON');
  });
});

describe('the executor no longer reaches the sender directly', () => {
  const executor = readFileSync('src/services/scp/actions/executor.ts', 'utf8');
  const slack = executor.slice(executor.indexOf('async function executeSlack'));
  const body = slack.slice(0, slack.indexOf('\n}\n'));

  it('goes through invoke, with the tool named', () => {
    expect(body).toContain('invoke({');
    expect(body).toContain("tool: 'post_slack'");
  });

  it('does not call the bare sender any more', () => {
    expect(body).not.toContain('sendSlackNotification(');
  });

  it('carries a dedup key, so a retried execution cannot post twice', () => {
    expect(body).toContain('dedupKey');
    expect(body).toContain('action_execution:');
  });

  it('keeps the one distinction that matters when a send is interrupted', () => {
    // 'execution' is the only phase where something may have reached the
    // outside world. Everything else is definitively nothing sent, and
    // booking a reconciliation for it would invent doubt.
    expect(body).toContain("res.phase === 'execution'");
    expect(body).toContain("'ambiguous'");
    expect(body).toContain("'not_attempted'");
  });
});

describe('the handler is registered, and says what it did not do', () => {
  const src = readFileSync('src/services/integration/slack.ts', 'utf8');

  it('registers post_slack with a policy that requires a dedup key', () => {
    expect(src).toContain("registerToolHandler('post_slack'");
    expect(src).toContain('requireDedupKey: true');
  });

  it('raises a definitive refusal as notAttempted, so the door releases its holds', () => {
    expect(src).toContain('notAttempted');
    // Only the genuinely uncertain case is left uncertain.
    expect(src).toContain("receipt.certainty !== 'ambiguous'");
  });
});

describe('the ungoverned browser is gone', () => {
  it('has no scraper at the repository root', async () => {
    const { existsSync } = await import('node:fs');
    // It launched chromium over a domain list and harvested mailto: addresses
    // into a scratch file, importing nothing from `src/`, passing no gateway
    // and consulting no capability row — an ungoverned browser collecting
    // personal data, in a repository whose thesis is that ability is not
    // authority.
    expect(existsSync('pw-contacts.mjs')).toBe(false);
  });

  it('keeps playwright where it belongs, in test and measurement tooling only', () => {
    const pkg = JSON.parse(readFileSync('package.json', 'utf8')) as {
      dependencies?: Record<string, string>; devDependencies?: Record<string, string>;
    };
    expect(pkg.dependencies?.['playwright-core']).toBeUndefined();
    expect(pkg.devDependencies?.['playwright-core']).toBeTruthy();
  });
});

// ─── what the first pass at this missed ──────────────────────────────────────
//
// An independent adversarial cell read the commit that closed the executor's
// Slack path and found it had closed one door of two. Both findings are pinned
// here, in the suite that claimed the door was shut, because a correction is
// code and gets the same reading.

describe('the second door: the daily briefing', () => {
  const slack = readFileSync('src/services/integration/slack.ts', 'utf8');
  const sched = readFileSync('src/services/scp/scheduler.ts', 'utf8');

  it('leaves no function here that both builds a briefing and sends it', () => {
    // `sendAgentBriefing` formatted and then called the transport, so the
    // hourly scheduler reached real people in a real workspace with a
    // kill-switch check and nothing else: no rung, no budget, no dedup key, no
    // audit row. Splitting them is what makes the caller unable to send.
    // The name survives in the header, which explains what was wrong with it;
    // what must be gone is the function.
    expect(slack).not.toMatch(/export async function sendAgentBriefing/);
    expect(slack).toContain('export function briefingMessage');
  });

  it('sends the briefing through invoke, not through the transport', () => {
    expect(sched).toContain('briefingMessage');
    expect(sched).toContain("tool: 'post_slack'");
    // And the private kill-switch check it used to stand on is gone, because
    // the door runs it — a second copy is how the two drift apart.
    expect(sched).not.toContain("checkKillSwitch(productId, 'post_slack')");
  });

  it('carries a dedup key, so a retried tick cannot post the briefing twice', () => {
    // There was no dedup key at all on this path. An hourly tick that retried
    // after a lost response posted the same briefing into the room again.
    expect(sched).toContain('dedupKey: `slack_briefing:');
  });

  it('is no longer claimed as governed-by-its-callers anywhere', () => {
    const audit = readFileSync('scripts/audit-consequential-effects.mjs', 'utf8');
    // "The callers check" is a claim about other files, and it is the claim
    // that hid this. The map that carried it is empty.
    expect(audit).toContain('const GUARD_IN_CALLERS = {}');
  });
});

describe('a message that may have arrived is not reported as never sent', () => {
  const slack = readFileSync('src/services/integration/slack.ts', 'utf8');

  it('treats a 5xx as ambiguous rather than as a rejection', () => {
    // `!resp.ok` covered every non-2xx and returned `provider_rejected`, which
    // the door reads as `notAttempted` and the executor writes as
    // `not_attempted` with `reconcile_after = null` — so nothing ever checked.
    // A 500 or a 502 is the classic post-processing failure: accepted, posted,
    // response lost.
    expect(slack).toContain('resp.status >= 500');
    expect(slack).toContain("certainty: 'ambiguous'");
  });

  it('keeps a 4xx definitive, because saying "it might have gone" is its own lie', () => {
    expect(slack).toContain("if (!resp.ok) return { certainty: 'provider_rejected'");
  });
});
