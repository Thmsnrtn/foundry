process.env.TURSO_DATABASE_URL = 'file::memory:';
process.env.ENCRYPTION_KEY = '0'.repeat(64);
process.env.FOUNDRY_INSTANCE_POSTURE = 'private_owner';
process.env.FOUNDRY_OWNER_EMAIL = 'owner@example.com';

import { beforeAll, describe, expect, it } from 'vitest';
import { runMigrations } from '../../src/db/migrate.js';
import { query } from '../../src/db/client.js';
import { sparkline } from '../../src/lib/sparkline.js';
import { glanceFor, layersFor, ANCHOR_CENTS } from '../../src/services/founder/portfolio.js';
import { whatTheNumbersSay } from '../../src/services/founder/what-the-numbers-say.js';
import { establishReferenceCompany } from '../../src/services/reference/world.js';

// =============================================================================
// STRUCTURE FOR STATE, TREND AND COMPARISON - drawn honestly.
//
// The owner's product law: natural language for intent and explanation,
// designed structure for state, trend, comparison and consequence. A tile with
// a number and a trend is the structure; these are the rules that keep it from
// lying, and the reality boundary applied to the totals on the first screen.
// =============================================================================

const OWNER = 'tr_owner';

beforeAll(async () => {
  await runMigrations();
  await query('INSERT INTO founders (id,clerk_user_id,email,name) VALUES (?,?,?,?)',
    [OWNER, 'clerk_tr', 'owner@example.com', 'Owner']);
  await query(`INSERT INTO products (id, name, owner_id, status, ingest_token)
    VALUES ('tr_big', 'Big Co', ?, 'active', 'tok_tr1')`, [OWNER]);
  await query(`INSERT INTO products (id, name, owner_id, status, ingest_token)
    VALUES ('tr_small', 'Small Co', ?, 'active', 'tok_tr2')`, [OWNER]);
  await query(`INSERT INTO products (id, name, owner_id, status, ingest_token)
    VALUES ('tr_blind', 'Blind Co', ?, 'active', 'tok_tr3')`, [OWNER]);
  for (let d = 10; d >= 0; d -= 1) {
    await query(
      `INSERT INTO metric_snapshots (id, product_id, snapshot_date, mrr_cents, churn_rate)
       VALUES (?, 'tr_big', date('now', ?), ?, ?)`,
      [`tr_ms_${String(d)}`, `-${String(d)} day`, 250_000 + (10 - d) * 1000, 0.02 + d * 0.001]);
  }
  await query(
    `INSERT INTO metric_snapshots (id, product_id, snapshot_date, mrr_cents)
     VALUES ('tr_ms_small', 'tr_small', date('now'), 40000)`);
  await establishReferenceCompany({ scenarioKey: 'an_anchor_that_needs_him', ownerId: OWNER });
});

describe('a sparkline that will not lie', () => {
  it('draws nothing from fewer than three readings', () => {
    expect(sparkline([1, 2]).svg).toBe('');
    expect(sparkline([5]).svg).toBe('');
  });
  it('draws a flat series flat, not amplified into drama', () => {
    const flat = sparkline([10, 10, 10, 10]);
    expect(flat.svg).toContain('16.0');
    expect(flat.svg).toContain('var(--ink-3)');
  });
  it('colours only by direction, and only where a direction has a meaning', () => {
    expect(sparkline([1, 2, 3, 4], { meaning: 'up_is_good' }).svg).toContain('var(--good)');
    expect(sparkline([1, 2, 3, 4], { meaning: 'down_is_good' }).svg).toContain('var(--alert)');
    expect(sparkline([1, 2, 3, 4], { meaning: 'neutral' }).svg).toContain('var(--ink-3)');
  });
});

describe('the numbers, with their trends', () => {
  it('carries the last readings and which way is good', async () => {
    const numbers = await whatTheNumbersSay('tr_big');
    const mrr = numbers.numbers.find((n) => n.label === 'monthly revenue');
    expect(mrr?.series.length).toBe(11);
    expect(mrr?.meaning).toBe('up_is_good');
    const churn = numbers.numbers.find((n) => n.label.includes('leave'));
    expect(churn?.meaning).toBe('down_is_good');
  });
  it('gives no series when there are fewer than three readings', async () => {
    const numbers = await whatTheNumbersSay('tr_small');
    expect(numbers.numbers[0]?.series).toEqual([]);
  });
});

describe('the portfolio at a glance', () => {
  it('totals only what it can see, and says how many that covers', async () => {
    const glance = await glanceFor(OWNER);
    expect(glance.cashFlowCents).toBe(260_000 + 40_000);
    expect(glance.seen).toBe(2);
    expect(glance.companies).toBe(3);
  });
  it('never lets a reference company into the total', async () => {
    // The hungry anchor earns $3,000 a month in the rehearsal world. None of it
    // is his, and none of it reaches the first screen.
    const glance = await glanceFor(OWNER);
    expect(glance.cashFlowCents).toBeLessThan(300_000 + 260_000);
  });
});

describe('the river in its layers', () => {
  it('draws the line between anchor and tributary where it says it does', async () => {
    const river = await layersFor(OWNER);
    const anchors = river.layers.find((l) => l.name === 'anchors');
    const tributaries = river.layers.find((l) => l.name === 'tributaries');
    expect(ANCHOR_CENTS).toBe(100_000);
    expect(anchors?.companies.map((c) => c.name)).toEqual(['Big Co']);
    expect(tributaries?.companies.map((c) => c.name).sort()).toEqual(['Small Co']);
    expect(anchors?.cashFlowCents).toBe(260_000);
  });

  it('does not call a company a tributary when nothing has told it the number', () => {
    // A COMPANY THAT REPORTS NOTHING IS NOT A SMALL COMPANY. Blind Co has no MRR
    // reading at all, and the layers used to place it beside the ones earning
    // under the anchor line — which asserts a number nobody observed, in the one
    // view whose whole job is to say what the river is doing. It has its own
    // layer, and that layer contributes nothing to any total.
    return layersFor(OWNER).then((river) => {
      const unseen = river.layers.find((l) => l.name === 'unseen');
      expect(unseen?.companies.map((c) => c.name)).toEqual(['Blind Co']);
      expect(unseen?.cashFlowCents).toBe(0);
    });
  });
  it('counts the frontier from real searches only', async () => {
    const river = await layersFor(OWNER);
    // `testing` counts experimental assets: approved tests with something to
    // be, not yet earned by reality. None here.
    expect(river.frontier).toEqual({ looking: 0, awaiting: 0, buried: 0, testing: 0 });
  });
});
