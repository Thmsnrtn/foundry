process.env.TURSO_DATABASE_URL = 'file::memory:';
process.env.ENCRYPTION_KEY = '0'.repeat(64);

import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { nanoid } from 'nanoid';
import { stripComments } from '../../scripts/lib/strip-comments.mjs';
import { runMigrations } from '../../src/db/migrate.js';
import { query } from '../../src/db/client.js';
import { evaluateInstitutionalJudgment } from '../../src/services/institution/institutional-judgment-evaluation.js';

// =============================================================================
// AN ECONOMIC RESULT NOBODY SUPPLIES.
//
// `institutional_judgment_evaluations.economic_result_json` is NOT NULL and
// read by nothing. It is filled from `economic_result` in the payload of a
// judgment observation — and the only producer of those observations,
// `runJudgmentObservationPass`, never writes that key. Its payload carries
// `judgment_id`, `evidence_claim_ids`, `resolved`, and an overdue reference.
//
// The single supply anywhere in the repository is a hand-written
// `source:'independent'` signal event inside a test. That is the shape this
// campaign already has a name for: a fixture proving the rails while nothing
// production-facing reaches them.
//
// So every row this system will ever write says `{status:'unknown'}`. The
// reason that matters is the stored shape distinguishes UNKNOWN from OBSERVED —
// a reader finding `unknown` could conclude Foundry looked and found no
// economic effect. It did not look. Nothing can.
//
// The mechanism is KEPT rather than dropped. `source:'independent'` is what an
// externally supplied observation looks like: when a company reports what a
// judgment cost or saved, this is where it lands. This test holds the premise
// the comment rests on, so the comment fails when a producer appears — and at
// that point the column becomes worth reading.
// =============================================================================

beforeAll(async () => { await runMigrations(); });
beforeEach(async () => {
  await query('DELETE FROM institutional_judgment_evaluations');
  await query('DELETE FROM signal_events');
  await query('DELETE FROM strategic_decisions_log');
  await query('DELETE FROM products');
  await query('DELETE FROM founders');
});

async function judgment(): Promise<{ productId: string; judgmentId: string }> {
  const owner = `f_${nanoid(8)}`;
  await query('INSERT INTO founders (id, clerk_user_id, email) VALUES (?,?,?)',
    [owner, `c_${owner}`, `${owner}@example.com`]);
  const productId = `p_${nanoid(8)}`;
  await query("INSERT INTO products (id, name, owner_id) VALUES (?,?,?)", [productId, 'C', owner]);
  const judgmentId = `j_${nanoid(8)}`;
  await query(
    `INSERT INTO strategic_decisions_log
       (id, product_id, decision_title, decision_description, decision_category,
        made_by, status, agent_context_json)
     VALUES (?,?, 'Capacity', 'snapshot', 'operations', 'agent_recommendation', 'active', '{}')`,
    [judgmentId, productId]);
  return { productId, judgmentId };
}

describe('what the column can say', () => {
  it('says unknown, not zero, when nobody supplied one', async () => {
    const { productId, judgmentId } = await judgment();
    // `source:'independent'` rather than `institutional_judgment_observation`:
    // the latter carries a trigger requiring non-empty `evidence_claim_ids`,
    // and the source is not what this test is about. An observation without an
    // economic result is an observation without an economic result either way.
    await query(
      `INSERT INTO signal_events (id, product_id, source, event_type, severity, payload_json, summary)
       VALUES (?,?, 'independent', 'judgment_expected_supported', 'low', ?, 'x')`,
      [nanoid(), productId, JSON.stringify({ judgment_id: judgmentId, resolved: true })]);

    await evaluateInstitutionalJudgment(productId, judgmentId);
    const [row] = (await query(
      'SELECT economic_result_json FROM institutional_judgment_evaluations WHERE judgment_id = ?',
      [judgmentId])).rows as unknown as Array<Record<string, string>>;
    const stored = JSON.parse(row!.economic_result_json) as Record<string, unknown>;
    expect(stored.status, 'not "observed: nothing" — nobody looked').toBe('unknown');
    expect(stored.value).toBeNull();
  });

  it('carries one when an external observation does supply it', async () => {
    const { productId, judgmentId } = await judgment();
    await query(
      `INSERT INTO signal_events (id, product_id, source, event_type, severity, payload_json, summary)
       VALUES (?,?, 'independent', 'judgment_expected_supported', 'low', ?, 'x')`,
      [nanoid(), productId, JSON.stringify({
        judgment_id: judgmentId, economic_result: { amount: 1200, currency: 'USD' },
      })]);

    await evaluateInstitutionalJudgment(productId, judgmentId);
    const [row] = (await query(
      'SELECT economic_result_json FROM institutional_judgment_evaluations WHERE judgment_id = ?',
      [judgmentId])).rows as unknown as Array<Record<string, string>>;
    const stored = JSON.parse(row!.economic_result_json) as Record<string, unknown>;
    expect(stored.status, 'the mechanism works; the supply is what is missing').toBe('observed');
    expect(stored.values).toEqual([{ amount: 1200, currency: 'USD' }]);
  });
});

describe('the premise the comment rests on', () => {
  it('has no production producer of an economic result', () => {
    const files: string[] = [];
    const walk = (d: string) => {
      for (const e of readdirSync(d, { withFileTypes: true })) {
        const p = join(d, e.name);
        if (e.isDirectory()) walk(p);
        else if (p.endsWith('.ts')) files.push(p);
      }
    };
    walk('src');

    // The reader is not a producer. Anything else naming the key is one.
    const producers = files.filter((f) =>
      f !== 'src/services/institution/institutional-judgment-evaluation.ts'
      && /economic_result/.test(stripComments(readFileSync(f, 'utf8'), { lineComments: true })));
    expect(producers,
      'a producer means the column stops being a permanent unknown and starts being worth reading')
      .toEqual([]);
  });

  it("the observation pass's own payload does not carry it", () => {
    const src = stripComments(
      readFileSync('src/services/institution/institutional-judgment-evaluation.ts', 'utf8'),
      { lineComments: true });
    const pass = src.slice(src.indexOf('runJudgmentObservationPass'));
    const insert = pass.slice(pass.indexOf('INSERT INTO signal_events'));
    expect(insert.slice(0, 800), 'judgment_id, evidence_claim_ids, resolved, overdue — no economics')
      .not.toMatch(/economic_result/);
  });

  it('says so where the value is read', () => {
    const src = readFileSync(
      'src/services/institution/institutional-judgment-evaluation.ts', 'utf8');
    expect(src).toMatch(/NO PRODUCTION PATH SUPPLIES AN ECONOMIC RESULT/);
    expect(src, 'and why keeping the mechanism is right').toMatch(/externally supplied observation/);
  });
});
