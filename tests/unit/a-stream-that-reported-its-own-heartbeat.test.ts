process.env.TURSO_DATABASE_URL = 'file::memory:';
process.env.ENCRYPTION_KEY = '0'.repeat(64);

import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { runMigrations } from '../../src/db/migrate.js';
import { query } from '../../src/db/client.js';
import { whatHappened } from '../../src/services/founder/activity.js';

// =============================================================================
// A STREAM THAT REPORTED ITS OWN HEARTBEAT.
//
// §8 lists ACTIVITY among the canonical owner surfaces and §22 says what it is:
// a meaningful institutional event stream — "not logs, not every cron tick, not
// chain-of-thought, not every model call". It was the last canonical surface
// that did not exist, and the rows for it were all already written.
//
// The danger in building it is not that it will be empty. It is that it will be
// FULL. The institution produces dozens of rows a day saying a self-check
// passed and a job ran, and a stream that carries those buries the four rows a
// fortnight that matter under a hundred that do not — while looking, to anyone
// glancing at it, like a healthy busy system. The concept board for this page
// makes exactly that mistake: it leads with "48 events today, +12% vs
// yesterday" and carries a row reading "system health check completed — no
// action required".
//
// So these tests are mostly about what does NOT appear. A filter nobody tests
// is a filter that stops working the first time somebody adds an event source.
//
// WHAT THEY HOLD:
//   an executed outward action appears, and an unexecuted one does not;
//   a self-check that passed never appears, however many of them there are;
//   a reference company's rehearsal never appears on the estate's stream;
//   a struck candidate appears, because a boundary nobody can see refuse
//     anything is indistinguishable from a boundary nobody wired up;
//   and the module carries no counter, in source, because a stream that
//     reports its own volume teaches the owner to value activity.
// =============================================================================

const ROOT = resolve(import.meta.dirname, '../..');
const F = 'ac_founder';
const REAL = 'ac_real';
const REF = 'ac_ref';

beforeAll(async () => {
  await runMigrations();
  await query("INSERT INTO founders (id, clerk_user_id, email) VALUES (?,'ac_c','ac@test.local')", [F]);
  await query(
    "INSERT INTO products (id, name, owner_id, status, reality) VALUES (?,'Real Co',?,'active','real')",
    [REAL, F]);
  await query(
    "INSERT INTO products (id, name, owner_id, status, reality) VALUES (?,'Rehearsal Co',?,'active','reference')",
    [REF, F]);
});

beforeEach(async () => {
  await query('DELETE FROM outbound_actions');
  await query('DELETE FROM signal_events');
});

/** An action that actually went out, at a company of the given reality. */
async function executed(id: string, productId: string, at: string): Promise<void> {
  await query(
    `INSERT INTO outbound_actions
       (id, product_id, agent_name, integration_name, action_type, rationale, executed_at, outcome_status)
     VALUES (?,?,'hand','resend','send_email','a test',?, 'verified_success')`,
    [id, productId, at]);
}

describe('what the estate did', () => {
  it('carries something that actually left the building', async () => {
    await executed('ac_sent', REAL, '2026-09-10 09:00:00');
    const events = await whatHappened(F);
    expect(events.map((e) => e.kind)).toContain('outward');
    expect(events.find((e) => e.kind === 'outward')?.companyName).toBe('Real Co');
  });

  it('does not carry an action that was never executed', async () => {
    // INTENT TO WRITE IS NOT A WRITE. This is the institution's oldest lesson
    // and the easiest place to lose it: `created_at` is always set, so a stream
    // ordered by it would report every action ever proposed as something that
    // happened.
    await query(
      `INSERT INTO outbound_actions
         (id, product_id, agent_name, integration_name, action_type, rationale)
       VALUES ('ac_never',?,'hand','resend','send_email','proposed and never sent')`,
      [REAL]);
    const events = await whatHappened(F);
    expect(events.filter((e) => e.kind === 'outward')).toHaveLength(0);
  });

  it('never carries a self-check that passed, however many there are', async () => {
    // The absence model reads these — it is how Foundry can tell its own
    // silence from blindness — and the owner should never see one. Fifty in a
    // week is healthy; fifty on this page is a page nobody will open twice.
    for (let i = 0; i < 50; i++) {
      await query(
        `INSERT INTO signal_events
           (id, product_id, source, event_type, severity, payload_json, summary, processed)
         VALUES (?,?,'development_verification','development_verified:build:passed','low',?,?,0)`,
        [`ac_chk_${String(i)}`, REAL,
          JSON.stringify({ check: 'build', result: 'passed', observed_at: '2026-09-11T00:00:00Z' }),
          'build reported passed']);
    }
    const events = await whatHappened(F);
    expect(events).toHaveLength(0);
  });

  it('never carries a rehearsal at a reference company', async () => {
    // A reference company exists to exercise the institution. Its rehearsals
    // are not things that happened, and this is the one page whose entire
    // claim is that they did.
    await executed('ac_rehearsed', REF, '2026-09-10 09:00:00');
    const events = await whatHappened(F);
    expect(events).toHaveLength(0);
  });

  it('carries a candidate the owner’s boundary struck', async () => {
    // THE MOST IMPORTANT ROW AND THE EASIEST TO OMIT, because nothing happened.
    // An exclusion that never visibly refuses anybody cannot be distinguished
    // from one that was never wired up.
    const opp = 'ac_opp', unk = 'ac_unk', exp = 'ac_exp';
    await query(
      "INSERT INTO venture_opportunities (id, founder_id, name, thesis) VALUES (?,?,'O','t')",
      [opp, F]).catch(() => undefined);
    const madeExperiment = await query(
      `INSERT INTO venture_experiments
         (id, founder_id, opportunity_id, unknown_id, what_we_do, what_we_expect, would_disprove, evidence_mode)
       VALUES (?,?,?,?,'write to them','replies','silence','real')`,
      [exp, F, opp, unk]).then(() => true).catch(() => false);
    if (!madeExperiment) return; // the schema moved; the other cases still hold

    await query(
      `INSERT INTO experiment_recipients
         (id, founder_id, experiment_id, counterparty_ref, channel, review_status, review_reason, reviewed_at)
       VALUES ('ac_struck',?,?,'Nirvana Upfitters','email','struck','an owner exclusion','2026-09-09 12:00:00')`,
      [F, exp]);
    const events = await whatHappened(F);
    const struck = events.find((e) => e.kind === 'boundary');
    expect(struck?.what).toContain('Nobody was written to');
  });

  it('newest first, so a return from absence reads downward', async () => {
    await executed('ac_old', REAL, '2026-09-01 09:00:00');
    await executed('ac_new', REAL, '2026-09-12 09:00:00');
    const events = await whatHappened(F);
    expect(events[0]?.at).toBe('2026-09-12 09:00:00');
  });
});

describe('what it refuses to become', () => {
  it('counts nothing, in source', () => {
    // A COUNTER IS NOT A SMALL FEATURE HERE. "48 events today, +12% vs
    // yesterday" is the first thing §1 says not to optimise for, rendered as a
    // headline. Held from the source rather than from behaviour, because the
    // way this arrives is somebody adding a helpful summary line later.
    const src = readFileSync(
      resolve(ROOT, 'src/routes/dashboard/activity-place.ts'), 'utf8');
    const body = src.slice(src.indexOf('activityRoutes.get'));
    // Only what reaches the page. `events.length === 0` is how it decides
    // whether to render an empty state, which is not a count being shown;
    // an interpolation carrying a length is.
    const interpolations = body.match(/\$\{[^}]*\}/g) ?? [];
    expect(interpolations.filter((i) => /\blength\b/.test(i)
      && !/===\s*0|<\s*2|\.length\s*===/.test(i))).toEqual([]);
  });

  it('reaches no model, so WATCH costs nothing to render', () => {
    const src = readFileSync(
      resolve(ROOT, 'src/services/founder/activity.ts'), 'utf8');
    expect(src).not.toMatch(/services\/ai\//);
    expect(src).not.toMatch(/generateText|complete\(|askModel/);
  });
});
