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
//
// The executor and `integration/slack.ts` (the `post_slack` handler and the
// briefing formatter) were deleted in Roadmap 2027 R10, so the blocks that read
// their source went with them. What remains is the binding and the boundary,
// which still exist and still have to say what they say.
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
  it('is no longer claimed as governed-by-its-callers anywhere', () => {
    const audit = readFileSync('scripts/audit-consequential-effects.mjs', 'utf8');
    // "The callers check" is a claim about other files, and it is the claim
    // that hid this. The map that carried it is empty.
    expect(audit).toContain('const GUARD_IN_CALLERS = {}');
  });
});
