process.env.TURSO_DATABASE_URL = 'file::memory:';
process.env.ENCRYPTION_KEY = '0'.repeat(64);

import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../src/services/scp/messages.js', async (orig) => ({
  ...(await orig<Record<string, unknown>>()),
  sendProactiveMessage: vi.fn(async () => undefined),
}));

const { runMigrations } = await import('../../src/db/migrate.js');
const { query } = await import('../../src/db/client.js');
const { ingestEvent, getActiveAnomalies } = await import('../../src/services/events/bus.js');

// =============================================================================
// A POINT IN ITS OWN BASELINE.
//
// `ingestEvent` writes the event to `event_stream` and then asks
// `detectAnomaly` how far it sits from the last hundred events of its type —
// a window that included the event itself. A value compared against a mean and
// a spread it is part of cannot depart from them freely: for n values where one
// differs from the rest, the largest deviation this arithmetic can report is
// √(n − 1). At the ten-observation floor that is 3.0σ, so a metric that went to
// infinity scored 3.0, and `deviation_sigma > 3` — the branch that escalates an
// event to critical — was unreachable.
//
// Two more things the same lines got wrong: the spread was divided by n rather
// than n − 1, though history is a sample and not a population; and history rows
// were never checked for being numbers, so one string under that key made every
// deviation `NaN` and switched detection off with no trace.
// =============================================================================

const P = 'p_anom';

beforeAll(async () => {
  await runMigrations();
  await query("INSERT INTO founders (id, clerk_user_id, email) VALUES ('f_an','c_an','an@example.com')");
  await query("INSERT INTO products (id, name, owner_id, status) VALUES (?,'Alpha','f_an','active')", [P]);
});

beforeEach(async () => {
  await query('DELETE FROM anomalies WHERE product_id = ?', [P]);
  await query('DELETE FROM event_stream WHERE product_id = ?', [P]);
});

async function seed(values: unknown[]): Promise<void> {
  for (let i = 0; i < values.length; i++) {
    await query(
      `INSERT INTO event_stream (id, product_id, source, event_type, severity, payload)
       VALUES (?, ?, 'seed', 'metric.tick', 'info', ?)`,
      [`ev_seed_${i}`, P, JSON.stringify({ value: values[i] })],
    );
  }
}

describe('an event is not part of the baseline it is measured against', () => {
  it('a departure is not capped at the square root of the sample size', async () => {
    // Ten prior observations sitting between 99 and 101 — a spread near zero.
    await seed([99, 100, 101, 100, 99, 101, 100, 100, 99, 101]);

    await ingestEvent(P, {
      source: 'test', event_type: 'metric.tick', severity: 'info',
      payload: { value: 1_000_000 },
    });

    const anomalies = await getActiveAnomalies(P);
    expect(anomalies).toHaveLength(1);
    const sigma = Number(anomalies[0]!.deviation_sigma);

    // Against a baseline that excludes it, this value is astronomically far out.
    // Against one that includes it, it could not have scored above √10 ≈ 3.16.
    expect(sigma).toBeGreaterThan(100);
  });

  it('what it says was expected is the history, not the history plus itself', async () => {
    await seed([10, 10, 10, 10, 10, 10, 10, 10, 10, 12]);

    await ingestEvent(P, {
      source: 'test', event_type: 'metric.tick', severity: 'info',
      payload: { value: 500 },
    });

    const anomalies = await getActiveAnomalies(P);
    expect(anomalies).toHaveLength(1);
    // Mean of the ten prior observations = 10.2. Including the new value would
    // have made it 54.7.
    expect(Number(anomalies[0]!.expected_value)).toBeCloseTo(10.2, 6);
    expect(Number(anomalies[0]!.actual_value)).toBe(500);
  });

  it('the escalation to critical is reachable', async () => {
    await seed([50, 51, 49, 50, 50, 51, 49, 50, 51, 49]);

    const result = await ingestEvent(P, {
      source: 'test', event_type: 'metric.tick', severity: 'info',
      payload: { value: 5_000 },
    });

    expect(result.cascades_triggered.some((c) => c.startsWith('anomaly:'))).toBe(true);
    expect(result.cascades_triggered).toContain('coo_notified');
  });

  it('ten observations means ten that are not this one', async () => {
    // Nine prior observations. The tenth row of this type is the event itself,
    // which no longer counts towards its own floor.
    await seed([1, 1, 1, 1, 1, 1, 1, 1, 1]);

    await ingestEvent(P, {
      source: 'test', event_type: 'metric.tick', severity: 'info',
      payload: { value: 9_999 },
    });

    expect(await getActiveAnomalies(P)).toHaveLength(0);
  });

  it('one non-numeric value in history does not switch detection off', async () => {
    await seed([100, 100, 'unknown', 100, 100, 101, 99, 100, 100, 101, 99]);

    await ingestEvent(P, {
      source: 'test', event_type: 'metric.tick', severity: 'info',
      payload: { value: 40_000 },
    });

    const anomalies = await getActiveAnomalies(P);
    expect(anomalies).toHaveLength(1);
    expect(Number.isFinite(Number(anomalies[0]!.deviation_sigma))).toBe(true);
  });

  it('the spread is estimated from a sample, so it divides by n minus one', async () => {
    const history = [2, 4, 4, 4, 5, 5, 7, 9, 4, 6];
    await seed(history);

    await ingestEvent(P, {
      source: 'test', event_type: 'metric.tick', severity: 'info',
      payload: { value: 100 },
    });

    const mean = history.reduce((a, b) => a + b, 0) / history.length;
    const sample = Math.sqrt(
      history.reduce((s, v) => s + (v - mean) ** 2, 0) / (history.length - 1),
    );
    const population = Math.sqrt(
      history.reduce((s, v) => s + (v - mean) ** 2, 0) / history.length,
    );
    expect(sample).not.toBeCloseTo(population, 3);

    const anomalies = await getActiveAnomalies(P);
    expect(Number(anomalies[0]!.deviation_sigma)).toBeCloseTo((100 - mean) / sample, 6);
  });
});
