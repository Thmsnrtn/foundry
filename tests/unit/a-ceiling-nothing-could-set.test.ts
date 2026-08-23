process.env.TURSO_DATABASE_URL = 'file::memory:';
process.env.ENCRYPTION_KEY = '0'.repeat(64);

import { readFileSync } from 'node:fs';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { stripComments } from '../../scripts/lib/strip-comments.mjs';
import { runMigrations } from '../../src/db/migrate.js';
import { query } from '../../src/db/client.js';
import { decideChannel, setMaxChannel } from '../../src/services/ux/interruption.js';
import { extractPremiseCondition } from '../../src/services/ux/fluency.js';

// =============================================================================
// A CEILING NOTHING COULD SET, AND A PREMISE READ OFF THE WRONG NUMBER.
//
// `decideChannel` has always honoured `preferences.max_channel`, the
// interruption module's header calls it the thing that "always wins", and two
// other modules cite it as the reason they check before reaching a founder's
// phone. NOTHING EVER WROTE IT. `fluency` was the only key any code path put
// into `founders.preferences`, so the ceiling branch was dead for every founder
// and everybody sat permanently at the top of the ladder. A control the product
// calls the person's own, which the person cannot exercise, is a claim about a
// control rather than a control.
//
// And `extractPremiseCondition` took the FIRST number anywhere in the founder's
// sentence: "we are doubling the team to 12 people, on the premise that churn
// stays under 5%" recorded a threshold of 12 — then, churn being a fraction
// metric and 12 > 1, divided it to 0.12. The belief the memory kernel later
// holds the decision accountable to was more than twice what the founder said.
// =============================================================================

const F = 'f_ceil';

beforeAll(async () => {
  await runMigrations();
});
beforeEach(async () => {
  await query('DELETE FROM founders WHERE id = ?', [F]);
  await query('INSERT INTO founders (id, clerk_user_id, email) VALUES (?,?,?)',
    [F, 'c_ceil', 'ceil@example.com']);
});

const prefsOf = async (): Promise<Record<string, unknown>> => {
  const row = (await query('SELECT preferences FROM founders WHERE id = ?', [F]))
    .rows[0] as unknown as { preferences: string | null };
  return row.preferences ? JSON.parse(row.preferences) as Record<string, unknown> : {};
};

describe('the interruption ceiling', () => {
  it('can be set at all', async () => {
    await setMaxChannel(F, 'letter');
    expect((await prefsOf()).max_channel).toBe('letter');
  });

  it('leaves the other preferences alone', async () => {
    const { setFluency } = await import('../../src/services/ux/fluency.js');
    await setFluency(F, 'plain');
    await setMaxChannel(F, 'notification');

    const prefs = await prefsOf();
    expect(prefs.fluency).toBe('plain');
    expect(prefs.max_channel).toBe('notification');
  });

  it('refuses a rung that is not on the ladder', async () => {
    await setMaxChannel(F, 'megaphone' as never);
    expect((await prefsOf()).max_channel).toBeUndefined();
  });

  it('holds a critical message down to the founder chosen rung', () => {
    // The one case the policy will not quiet on its own.
    expect(decideChannel('critical', 'steady', null)).toBe('push');
    expect(decideChannel('critical', 'steady', { max_channel: 'letter' })).toBe('letter');
  });

  it('does not make anything louder', () => {
    expect(decideChannel('info', 'steady', { max_channel: 'push' })).toBe('log');
  });

  it('is reachable from the settings page', () => {
    const src = stripComments(readFileSync('src/routes/dashboard/settings.ts', 'utf8'),
      { lineComments: true });
    expect(src).toContain('/settings/interruption-ceiling');
    expect(src).toContain('setMaxChannel');
  });
});

describe('the premise behind a decision', () => {
  it('reads the number the comparator governs', () => {
    expect(extractPremiseCondition(
      'we are doubling the team to 12 people, on the premise that churn stays under 5%'))
      .toEqual({ metricKey: 'churn_rate', comparator: '<', threshold: 0.05 });
  });

  it('still reads a plain sentence', () => {
    expect(extractPremiseCondition('churn stays under 5%'))
      .toEqual({ metricKey: 'churn_rate', comparator: '<', threshold: 0.05 });
    expect(extractPremiseCondition('NPS stays above 40'))
      .toEqual({ metricKey: 'nps_score', comparator: '>=', threshold: 40 });
  });

  it('says nothing when the comparator governs no number', () => {
    // A number appears after the comparator here too — "stays under control
    // with 12 people" — so "the first number after the comparator" is not
    // enough either. The number has to be the one the comparator is applied to.
    expect(extractPremiseCondition('churn stays under control with 12 people')).toBeNull();
  });

  it('reads a hedged number', () => {
    expect(extractPremiseCondition('churn stays under about 5%')?.threshold).toBe(0.05);
  });
});
