// =============================================================================
// TWO RETURNING VISITS THAT ARRIVE TOGETHER KEEP "WHAT CHANGED SINCE" (stage-1
// audit). markVisit moves the visit marker only if nobody moved it since it
// was read. Without that, the second of two returning visits (phone and laptop
// together) set `since` to the first one's "now", and everything that changed
// while the owner was away vanished from Home. The first-visit race test only
// races first visits; this races returning ones.
// =============================================================================
process.env.TURSO_DATABASE_URL = 'file::memory:';
process.env.ENCRYPTION_KEY = process.env.ENCRYPTION_KEY ?? '0'.repeat(64);
process.env.FOUNDRY_INSTANCE_POSTURE = 'private_owner';
process.env.FOUNDRY_OWNER_EMAIL = 'owner@example.com';

import { beforeAll, describe, expect, it } from 'vitest';
import { query } from '../../src/db/client.js';
import { OWNER, seedProductionShape } from '../helpers/world.js';

const AWAY_SINCE = '2026-01-01 08:00:00';

beforeAll(async () => {
  await seedProductionShape();
}, 180_000);

describe('two returning visits at once', () => {
  it('both measure from when he was last here, and the marker keeps it', async () => {
    await query('DELETE FROM owner_visits WHERE founder_id = ?', [OWNER]);
    await query('INSERT INTO owner_visits (founder_id, looked_at, since) VALUES (?, ?, ?)', [OWNER, AWAY_SINCE, '2025-12-01 08:00:00']);
    const { markVisit } = await import('../../src/services/founder/what-changed.js');
    const seen = await Promise.all([markVisit(OWNER), markVisit(OWNER), markVisit(OWNER)]);
    expect(seen).toEqual([AWAY_SINCE, AWAY_SINCE, AWAY_SINCE]);
    const row = (await query('SELECT since FROM owner_visits WHERE founder_id = ?', [OWNER])).rows[0] as Record<string, unknown>;
    expect(String(row.since)).toBe(AWAY_SINCE);
  });
});
