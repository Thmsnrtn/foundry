process.env.TURSO_DATABASE_URL = 'file::memory:';
process.env.ENCRYPTION_KEY = '0'.repeat(64);

import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { nanoid } from 'nanoid';
import { stripComments } from '../../scripts/lib/strip-comments.mjs';
import { runMigrations } from '../../src/db/migrate.js';
import { query } from '../../src/db/client.js';
import { discoverCausalChains, getStoredCausalChains } from '../../src/services/graph/engine.js';

// The model is stubbed so the WRITE path can be exercised. Source-text
// assertions were not enough here: the first version of this file asserted the
// shape of the INSERT and both mutations survived it — restoring `null, null`
// for the labels, and making the route always recompute. A test that reads code
// rather than running it will believe anything the code says about itself.
let modelChains: unknown = [];
vi.mock('../../src/services/ai/client.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../src/services/ai/client.js')>()),
  callOpus: async () => ({
    content: JSON.stringify(modelChains),
    model: 'stub', usage: { input_tokens: 0, output_tokens: 0 }, stop_reason: null,
  }),
}));

// =============================================================================
// A CAUSAL CHAIN WITH NO CAUSE IN IT.
//
// `discoverCausalChains` asks Opus, with a 4096-token budget, to find multi-hop
// causes in a product's knowledge graph. The model returns `root_cause` and
// `effect` as ENTITY LABELS — the same labels the prompt handed it. The INSERT
// wrote both into `root_cause_entity_id` and `effect_entity_id` as literal
// NULL, and kept no other copy.
//
// So every stored chain lost the two things a causal chain is about. The prose
// description survived. The cause and the effect were dropped on the way to
// disk.
//
// It did not matter, because nothing read the table — and that is the other
// half. The weekly graph_rebuild job ran this for every active product and used
// the answer for a log line: "3 causal chains discovered." Meanwhile the one
// route that serves chains to a caller called Opus AGAIN on every request. The
// institution paid twice for the same question and delivered one of the answers
// to a log file.
//
// Now: the labels are stored, ids are resolved against `graph_entities` by exact
// label and left NULL when nothing matches — a model may name something that is
// not in the graph, and a chain that points at nothing should say so rather than
// point at whatever was nearest — and the route reads the stored batch,
// computing only when none has ever been stored.
// =============================================================================

const ENGINE = stripComments(readFileSync('src/services/graph/engine.ts', 'utf8'), { lineComments: true });
const ROUTE = stripComments(readFileSync('src/routes/api/platform.ts', 'utf8'), { lineComments: true });

beforeAll(async () => {
  await runMigrations();
  await query("INSERT INTO founders (id, clerk_user_id, email) VALUES ('f_cc','c_cc','cc@example.com')");
  await query("INSERT INTO products (id, name, owner_id, status) VALUES ('p_cc','Acme','f_cc','active')");
});
beforeEach(async () => {
  await query('DELETE FROM causal_chains');
  await query('DELETE FROM graph_relationships');
  await query('DELETE FROM graph_entities');
});

/** Three entities and three relationships — the minimum discoverCausalChains runs on. */
async function graph(labels: string[]): Promise<Record<string, string>> {
  const ids: Record<string, string> = {};
  for (const label of labels) {
    const id = nanoid();
    ids[label] = id;
    await query(
      `INSERT INTO graph_entities (id, product_id, entity_type, entity_id, label)
       VALUES (?, 'p_cc', 'metric', ?, ?)`, [id, id, label]);
  }
  for (let i = 0; i + 1 < labels.length; i++) {
    await query(
      `INSERT INTO graph_relationships
         (id, product_id, source_entity_id, target_entity_id, relationship_type, weight)
       VALUES (?, 'p_cc', ?, ?, 'causes', 0.8)`,
      [nanoid(), ids[labels[i]!]!, ids[labels[i + 1]!]!]);
  }
  await query(
    `INSERT INTO graph_relationships
       (id, product_id, source_entity_id, target_entity_id, relationship_type, weight)
     VALUES (?, 'p_cc', ?, ?, 'correlates', 0.5)`,
    [nanoid(), ids[labels[0]!]!, ids[labels[labels.length - 1]!]!]);
  return ids;
}

async function chain(o: {
  at: string; desc: string; root?: string | null; effect?: string | null;
  rootId?: string | null; confidence?: number;
}) {
  await query(
    `INSERT INTO causal_chains
       (id, product_id, chain_description, hops, root_cause_entity_id, effect_entity_id,
        root_cause_label, effect_label, confidence, actionable_insight, discovered_at)
     VALUES (?, 'p_cc', ?, ?, ?, NULL, ?, ?, ?, 'do the thing', ?)`,
    [nanoid(), o.desc, JSON.stringify([{ from: 'a', to: 'b', relationship: 'causes' }]),
     o.rootId ?? null, o.root ?? null, o.effect ?? null, o.confidence ?? 0.8, o.at]);
}

describe('the cause and the effect survive the write', () => {
  it('the columns exist', async () => {
    const cols = ((await query('PRAGMA table_info(causal_chains)')).rows as unknown as
      Array<Record<string, unknown>>).map((c) => String(c.name));
    expect(cols).toContain('root_cause_label');
    expect(cols).toContain('effect_label');
  });

  it('the writer stores them, having written literal NULL for both before', async () => {
    const ids = await graph(['onboarding step 3', 'activation', 'monthly churn']);
    modelChains = [{
      chain_description: 'churn follows onboarding drop-off',
      hops: [{ from: 'onboarding step 3', to: 'monthly churn', relationship: 'causes' }],
      root_cause: 'onboarding step 3', effect: 'monthly churn',
      confidence: 0.7, actionable_insight: 'fix step 3',
    }];

    await discoverCausalChains('p_cc');

    const row = (await query(
      `SELECT root_cause_label, effect_label, root_cause_entity_id, effect_entity_id
         FROM causal_chains WHERE product_id = 'p_cc'`)).rows[0] as Record<string, unknown>;
    expect(row.root_cause_label).toBe('onboarding step 3');
    expect(row.effect_label).toBe('monthly churn');
    expect(row.root_cause_entity_id, 'and resolved to the entity the prompt showed it')
      .toBe(ids['onboarding step 3']);
    expect(row.effect_entity_id).toBe(ids['monthly churn']);
  });

  it('leaves the id null when the model names something not in the graph', async () => {
    await graph(['activation', 'retention', 'expansion']);
    modelChains = [{
      chain_description: 'something outside the graph',
      hops: [], root_cause: 'a thing nobody recorded', effect: 'retention',
      confidence: 0.5, actionable_insight: 'look into it',
    }];

    await discoverCausalChains('p_cc');

    const row = (await query(
      `SELECT root_cause_label, root_cause_entity_id, effect_entity_id
         FROM causal_chains WHERE product_id = 'p_cc'`)).rows[0] as Record<string, unknown>;
    expect(row.root_cause_entity_id,
      'better to point at nothing than at whatever was nearest').toBeNull();
    expect(row.root_cause_label, 'but the name it gave is kept')
      .toBe('a thing nobody recorded');
    expect(row.effect_entity_id).not.toBeNull();
  });

  it('reads the labels back', async () => {
    await chain({ at: '2026-08-01 00:00:00', desc: 'churn follows onboarding drop-off',
                  root: 'onboarding step 3', effect: 'monthly churn' });
    const got = await getStoredCausalChains('p_cc');
    expect(got.chains[0]!.root_cause).toBe('onboarding step 3');
    expect(got.chains[0]!.effect).toBe('monthly churn');
    expect(got.chains[0]!.hops).toHaveLength(1);
  });
});

describe('the reader returns one batch, not a pile', () => {
  it('takes only the most recent discovery', async () => {
    await chain({ at: '2026-07-01 00:00:00', desc: 'old chain' });
    await chain({ at: '2026-08-01 00:00:00', desc: 'new chain A' });
    await chain({ at: '2026-08-01 00:00:00', desc: 'new chain B' });

    const got = await getStoredCausalChains('p_cc');
    expect(got.discovered_at).toBe('2026-08-01 00:00:00');
    expect(got.chains.map((c) => c.chain_description).sort())
      .toEqual(['new chain A', 'new chain B']);
  });

  it('orders by the confidence the model gave itself', async () => {
    await chain({ at: '2026-08-01 00:00:00', desc: 'less sure', confidence: 0.3 });
    await chain({ at: '2026-08-01 00:00:00', desc: 'more sure', confidence: 0.9 });
    const got = await getStoredCausalChains('p_cc');
    expect(got.chains[0]!.chain_description).toBe('more sure');
  });

  it('says nothing has been discovered rather than that nothing exists', async () => {
    const got = await getStoredCausalChains('p_cc');
    expect(got.discovered_at).toBeNull();
    expect(got.chains).toEqual([]);
  });
});

describe('the route stops paying twice', () => {
  async function get(): Promise<Record<string, unknown>> {
    const { Hono } = await import('hono');
    const { platformApiRoutes } = await import('../../src/routes/api/platform.js');
    const app = new Hono();
    app.use('*', async (c, next) => { c.set('founder', { id: 'f_cc' }); await next(); });
    app.route('/', platformApiRoutes);
    const res = await app.request('/api/products/p_cc/graph/causal-chains');
    return await res.json() as Record<string, unknown>;
  }

  it('serves the stored batch without calling the model', async () => {
    await chain({ at: '2026-08-01 00:00:00', desc: 'stored chain', root: 'a', effect: 'b' });
    modelChains = [{ chain_description: 'FRESHLY INVENTED', hops: [], root_cause: 'x',
                     effect: 'y', confidence: 1, actionable_insight: '' }];

    const body = await get();
    expect(body.computed_now).toBe(false);
    expect(body.discovered_at).toBe('2026-08-01 00:00:00');
    expect(JSON.stringify(body.causal_chains)).toContain('stored chain');
    expect(JSON.stringify(body.causal_chains),
      'the model must not have been consulted').not.toContain('FRESHLY INVENTED');
  });

  it('computes once when nothing has ever been stored', async () => {
    await graph(['a', 'b', 'c']);
    modelChains = [{ chain_description: 'first ever', hops: [], root_cause: 'a',
                     effect: 'c', confidence: 0.6, actionable_insight: 'go' }];

    const body = await get();
    expect(body.computed_now).toBe(true);
    expect(JSON.stringify(body.causal_chains)).toContain('first ever');
    expect(body.discovered_at, 'and the batch it just stored is dated')
      .not.toBeNull();

    // And the next request reads it rather than paying again.
    modelChains = [{ chain_description: 'SECOND CALL', hops: [], root_cause: 'a',
                     effect: 'c', confidence: 0.6, actionable_insight: '' }];
    const again = await get();
    expect(again.computed_now).toBe(false);
    expect(JSON.stringify(again.causal_chains)).not.toContain('SECOND CALL');
  });
});

describe('the ratchet moved', () => {
  it('causal_chains has left the unread baseline', () => {
    expect(readFileSync('docs/db/unread-tables-baseline.txt', 'utf8'))
      .not.toMatch(/causal_chains/);
  });
});
