// =============================================================================
// A TEST HE STOPPED STAYS STOPPED.
//
// Stopping a running test withdrew the offer and revoked the acts but wrote
// nothing on the test, so the attention queue read the withdrawn exposure as
// "approved and not yet listed" and asked him to list the test he had just
// stopped. The stop is on the row now, with his reason; the page still says
// "Stopped by you"; the queue, Now and History agree.
// =============================================================================
process.env.TURSO_DATABASE_URL = 'file::memory:';
process.env.NODE_ENV = 'test';
process.env.FOUNDRY_INSTANCE_POSTURE = 'private_owner';
process.env.FOUNDRY_OWNER_EMAIL = 'owner@example.com';
process.env.ENCRYPTION_KEY = process.env.ENCRYPTION_KEY ?? '0'.repeat(64);

import { beforeAll, describe, expect, it } from 'vitest';
import { query } from '../../src/db/client.js';
import { OWNER, asText, owner, ownerApp, seedProductionShape } from '../helpers/world.js';

let app: Awaited<ReturnType<typeof ownerApp>>;
let me: ReturnType<typeof owner>;
let experimentId = '';

beforeAll(async () => {
  ({ experimentId } = await seedProductionShape({ unsettled: true }));
  app = await ownerApp();
  me = owner(app);
});

describe('stopping a running test from its page', () => {
  it('writes the stop on the test with his reason, and the page says "Stopped by you"', async () => {
    const r = await me.post(`/foundry/experiments/${experimentId}/stop`, { reason: 'the shops are not the right population' });
    expect(r.status).toBe(302);
    const row = (await query(`SELECT retired_at, retired_because FROM venture_experiments WHERE id = ?`, [experimentId])).rows[0] as Record<string, unknown>;
    expect(row.retired_at).not.toBeNull();
    expect(String(row.retired_because)).toContain('you stopped it: the shops are not the right population');
    const { getExperimentView } = await import('../../src/services/founder/experiment-view.js');
    const v = await getExperimentView(OWNER, experimentId);
    expect(v?.state).toBe('stopped');
    expect(v?.stateLabel).toBe('Stopped by you');
    expect(asText(await me.page(`/foundry/experiments/${experimentId}`))).toContain('Stopped by you');
  });

  it('leaves the attention queue and Now, and is filed under Recently finished and History with its retired asset', async () => {
    const { waitingOn: whatNeedsHim } = await import("../../src/services/founder/attention.js");
    expect((await whatNeedsHim(OWNER)).map((a) => a.id)).not.toContain(experimentId);
    const home = asText(await me.page('/foundry'));
    expect(home).not.toContain('paste the listing address');
    const experiments = asText(await me.page('/foundry/experiments'));
    expect(experiments).toContain('Nothing is being tested now');
    expect(experiments).toContain('Recently finished');
    const history = asText(await me.page('/foundry/experiments/history'));
    expect(history).toContain('Stopped');
    expect(history).toContain('Nothing more is sent');
    expect(history).toContain('is retired: you stopped it');
  });
});
