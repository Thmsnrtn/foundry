// =============================================================================
// EVERY INVARIANT IS SHOWN TO FIRE — a canary each, planted in a real world.
//
// A monitor that has never caught anything is indistinguishable from one that
// cannot. So a real world is run for a few days (the institution, the twin,
// a capable brain), and then, with that world still open, each invariant in
// the registry (`invariants.ts`) is put through three readings:
//
//   1. the world as it is — clean, or the check is red by construction;
//   2. the world with that invariant's violation planted — caught;
//   3. the plant taken away — clean again.
//
// THE POPULATION IS THE REGISTRY: an invariant with no canary, or a canary
// with no invariant, fails the first test. Removing an invariant's detection
// (its `check` body) turns its canary red; that was done by hand for each
// when the monitor was written, and is recorded in IMPLEMENTATION_STATE.
//
// Some plants write rows the database's own guards refuse — a decision by a
// principal that is not the owner, say. Those guards are lifted for the one
// write and put back, exactly as the world's clock lifts them: the monitor is
// the second line behind the guard, and this proves the second line.
// =============================================================================
import { beforeAll, describe, expect, it } from 'vitest';
import { INVARIANTS, type InvariantWorld } from './invariants.js';
import type { OpenWorld } from './twin/world-run.js';

type Undo = () => Promise<void>;
interface Canary { what: string; plant(w: OpenWorld): Promise<Undo>; override?: (w: OpenWorld) => Partial<InvariantWorld> }

/** Lift the guard triggers of one table for one write, then put them back verbatim. */
async function withoutGuards(w: OpenWorld, table: string, write: () => Promise<unknown>): Promise<void> {
  const guards = await w.query(`SELECT name, sql FROM sqlite_master WHERE type = 'trigger' AND tbl_name = ?`, [table]);
  for (const g of guards) await w.query(`DROP TRIGGER "${String(g.name)}"`);
  try { await write(); } finally { for (const g of guards) await w.query(String(g.sql)); }
}
const MARKER = ['[deploy', '-private]'].join('');
const one = async (w: OpenWorld, sql: string, p: unknown[] = []) => (await w.query(sql, p))[0];

/** A page the edge serves, planted and taken away again. */
function aPage(w: OpenWorld, key: string, html: string): Undo {
  const store = [...w.providers.cf.kv.values()][0]!;
  store.set(key, html);
  return async () => { store.delete(key); };
}

/** A made, placed printable of this world, or a failure that says the world made none. */
async function aPlacedPrintable(w: OpenWorld): Promise<{ experimentId: string; exposureId: string }> {
  const r = await one(w, `SELECT x.id AS exposure_id, x.experiment_id FROM experiment_exposures x
     JOIN experiment_materials m ON m.experiment_id = x.experiment_id AND m.kind = 'offer_shape' AND m.superseded_at IS NULL AND m.body LIKE '%"printable"%'
    WHERE x.founder_id = ? ORDER BY x.placed_at LIMIT 1`, [w.founderId]);
  if (!r) throw new Error('the canary world placed no printable; the canaries for delivery and refunds need one');
  return { experimentId: String(r.experiment_id), exposureId: String(r.exposure_id) };
}

/** A paid purchase of that printable, delivered as some other file: what two canaries plant into. */
async function aDeliveredPurchase(w: OpenWorld, deliveredSha: string | null): Promise<{ fulfilmentId: string; undo: Undo }> {
  const { experimentId, exposureId } = await aPlacedPrintable(w);
  const { recordBusinessOutcome } = await import('../../src/services/venture/outcome.js');
  const ref = `pi_canary_${String(Date.now())}_${String(Math.random()).slice(2, 8)}`;
  const ev = await recordBusinessOutcome({ exposureId, kind: 'payment', amountCents: 900, currency: 'usd', observedAt: new Date(), provider: 'stripe', providerRef: ref,
    payerReference: 'canary@twin.example', arrivedVia: 'payment_link' });
  if ('refused' in ev) throw new Error(ev.refused);
  const fulfilmentId = `ful_${ref}`;
  await withoutGuards(w, 'experiment_fulfilments', () => w.query(`INSERT INTO experiment_fulfilments (id, founder_id, experiment_id, exposure_id, payment_event_id, provider, payment_ref, charge_ref, amount_cents, currency, status, delivered_files_json)
    VALUES (?,?,?,?,?,'stripe',?,?,900,'usd','sent',?)`, [fulfilmentId, w.founderId, experimentId, exposureId, ev.id, ref, `ch_${ref}`, deliveredSha ? JSON.stringify([{ sha256: deliveredSha, version: 1 }]) : null]));
  return { fulfilmentId, undo: async () => { await withoutGuards(w, 'experiment_fulfilments', () => w.query('DELETE FROM experiment_fulfilments WHERE id = ?', [fulfilmentId])); } };
}

export const CANARIES: Record<string, Canary> = {
  'inside-the-charter': {
    what: 'a placed test whose decision is put in the forge\'s name',
    async plant(w) {
      const r = await one(w, `SELECT x.experiment_id, e.decided_by FROM experiment_exposures x JOIN venture_experiments e ON e.id = x.experiment_id
         WHERE x.founder_id = ? AND e.decided_by LIKE 'charter:%' LIMIT 1`, [w.founderId]);
      if (!r) throw new Error('the canary world let nothing in under the charter');
      await withoutGuards(w, 'venture_experiments', () => w.query(`UPDATE venture_experiments SET decided_by = 'forge' WHERE id = ?`, [r.experiment_id]));
      return async () => { await withoutGuards(w, 'venture_experiments', () => w.query('UPDATE venture_experiments SET decided_by = ? WHERE id = ?', [r.decided_by, r.experiment_id])); };
    },
  },
  'owner-only-stays-owners': {
    what: 'a policy row of the owner\'s, set by the forge',
    async plant(w) {
      await withoutGuards(w, 'origination_policy', () => w.query(
        `INSERT INTO origination_policy (id, founder_id, requirement, treatment, value, why, set_by) VALUES ('canary_policy', ?, 'make_printable_pdf', 'policy', 'yes', 'planted', 'forge')`, [w.founderId]));
      return async () => { await withoutGuards(w, 'origination_policy', () => w.query(`DELETE FROM origination_policy WHERE id = 'canary_policy'`)); };
    },
  },
  'no-claim-the-audit-rejects': {
    what: 'a public page that says it is trusted by 2,000 families',
    async plant(w) { return aPage(w, 'page:/canary-claims', '<html><body><p>Trusted by over 2,000 families already use it.</p></body></html>'); },
  },
  'the-file-paid-for': {
    what: 'a purchase delivered as a file whose hash is not the one the offer sold',
    async plant(w) { return (await aDeliveredPurchase(w, 'f'.repeat(64))).undo; },
  },
  'refunds-honoured': {
    what: 'a refund asked for two days ago and never made',
    async plant(w) {
      const shape = await one(w, `SELECT m.body FROM experiment_materials m JOIN experiment_exposures x ON x.experiment_id = m.experiment_id
         WHERE m.kind = 'offer_shape' AND m.superseded_at IS NULL AND m.body LIKE '%"printable"%' AND x.founder_id = ? LIMIT 1`, [w.founderId]);
      const sha = (JSON.parse(String(shape?.body ?? '{}')) as { printable?: { sha256?: string } }).printable?.sha256 ?? null;
      const p = await aDeliveredPurchase(w, sha);
      await withoutGuards(w, 'experiment_fulfilments', () => w.query(`UPDATE experiment_fulfilments SET refund_requested_at = datetime('now', '-2 days') WHERE id = ?`, [p.fulfilmentId]));
      return p.undo;
    },
  },
  'found-nothing-is-not-support': {
    what: 'a candidate promoted on one post and one search that found nothing',
    async plant(w) {
      const { formClaim, observe } = await import('../../src/services/venture/market-evidence.js');
      const { sow } = await import('../../src/services/venture/seeds.js');
      const { currentMandate } = await import('../../src/services/venture/mandate.js');
      const m = await currentMandate(w.founderId);
      const claimId = await formClaim({ founderId: w.founderId, claim: 'canary: people keep a log by hand', evidenceMode: 'real' });
      const obsId = await observe({ founderId: w.founderId, claimId, sourceType: 'community', source: 'https://forum.example/canary', saw: 'I keep a paper log of the boiler', bearing: 'supports', directness: 'direct', observedAt: new Date(), evidenceMode: 'real' });
      await observe({ founderId: w.founderId, claimId, sourceType: 'directory', source: 'https://registry.example/canary', saw: 'nothing on the subject turned up', bearing: 'supports', directness: 'inferred', observedAt: new Date(), evidenceMode: 'real', fromAbsence: true });
      const seedId = await sow({ founderId: w.founderId, mandateId: m?.id ?? null, seed: 'canary: a boiler log', origin: 'signal', originSaid: 'I keep a paper log of the boiler', originObservationId: obsId, evidenceMode: 'real' });
      if (typeof seedId !== 'string') throw new Error('the canary seed was already buried');
      await w.query('UPDATE market_claims SET seed_id = ? WHERE id = ?', [seedId, claimId]);
      const opp = await one(w, 'SELECT id FROM venture_opportunities WHERE founder_id = ? LIMIT 1', [w.founderId]);
      await withoutGuards(w, 'opportunity_seeds', () => w.query('UPDATE opportunity_seeds SET promoted_to = ? WHERE id = ?', [opp?.id ?? 'canary_opp', seedId]));
      return async () => { await withoutGuards(w, 'opportunity_seeds', () => w.query('UPDATE opportunity_seeds SET promoted_to = NULL, buried_at = datetime(\'now\'), buried_because = \'canary\' WHERE id = ?', [seedId])); };
    },
  },
  'can-sell-agrees-with-readiness': {
    what: '"can it sell" saying yes while the Workshop has lost its postal address and readiness refuses',
    override: () => ({ canSell: async () => ({ yes: true }) }),
    async plant(w) {
      // A made, undecided test for readiness to read: a copy of a made test's materials on a new test.
      const src = await one(w, `SELECT experiment_id FROM experiment_materials WHERE kind = 'deliverable' AND founder_id = ? AND body LIKE '{"kind":"printable_pdf"%' LIMIT 1`, [w.founderId]);
      if (!src) throw new Error('the canary world made nothing');
      const e = await one(w, 'SELECT opportunity_id, unknown_id FROM venture_experiments WHERE id = ?', [src.experiment_id]);
      await w.query(`INSERT INTO venture_experiments (id, founder_id, opportunity_id, unknown_id, what_we_do, what_we_expect, would_disprove, cost_cents, evidence_mode)
        VALUES ('canary_x', ?, ?, ?, 'canary', 'one pays', 'nobody pays', 1000, 'real')`, [w.founderId, e!.opportunity_id, e!.unknown_id]);
      await withoutGuards(w, 'experiment_materials', () => w.query(`INSERT INTO experiment_materials (id, founder_id, experiment_id, kind, title, body, pulled_at, digest, recorded_by)
        SELECT 'canary_' || kind, founder_id, 'canary_x', kind, title, body, pulled_at, digest, recorded_by FROM experiment_materials
         WHERE experiment_id = ? AND superseded_at IS NULL AND kind IN ('deliverable', 'offer_shape', 'offer_template')`, [src.experiment_id]));
      const before = await one(w, 'SELECT postal_address FROM public_workshop WHERE founder_id = ?', [w.founderId]);
      await w.query('UPDATE public_workshop SET postal_address = NULL WHERE founder_id = ?', [w.founderId]);
      return async () => {
        await w.query('UPDATE public_workshop SET postal_address = ? WHERE founder_id = ?', [before?.postal_address, w.founderId]);
        await withoutGuards(w, 'venture_experiments', () => w.query(`UPDATE venture_experiments SET retired_at = datetime('now'), retired_because = 'canary' WHERE id = 'canary_x'`));
      };
    },
  },
  'no-deploy-marker': {
    what: 'the deploy marker in a row the institution keeps',
    async plant(w) {
      await w.query(`INSERT INTO needs_you_snoozes (id, founder_id, item_key, until) VALUES ('canary_marker', ?, ?, datetime('now', '+1 day'))`, [w.founderId, `noticed:${MARKER}`]);
      return async () => { await w.query(`DELETE FROM needs_you_snoozes WHERE id = 'canary_marker'`); };
    },
  },
  'spend-within-allowance': {
    what: 'a day of thinking at ten times the charter\'s rate',
    async plant(w) {
      const row = await one(w, `SELECT date, spent_cents FROM ai_daily_spend WHERE scope = 'founder' AND scope_id = ? ORDER BY date DESC LIMIT 1`, [w.founderId]);
      if (!row) throw new Error('the canary world thought nothing');
      await w.query(`UPDATE ai_daily_spend SET spent_cents = 3000 WHERE scope = 'founder' AND scope_id = ? AND date = ?`, [w.founderId, row.date]);
      return async () => { await w.query(`UPDATE ai_daily_spend SET spent_cents = ? WHERE scope = 'founder' AND scope_id = ? AND date = ?`, [row.spent_cents, w.founderId, row.date]); };
    },
  },
};

const readings: Record<string, { clean: string[]; caught: string[]; after: string[] }> = {};

beforeAll(async () => {
  const { runWorld } = await import('./twin/world-run.js');
  await runWorld({
    seed: 11, days: 3, brain: 'capable',
    async afterTheRun(w) {
      for (const inv of INVARIANTS) {
        const canary = CANARIES[inv.id];
        if (!canary) continue;
        const clean = await inv.check(w.monitor);
        const undo = await canary.plant(w);
        const caught = await inv.check({ ...w.monitor, ...(canary.override?.(w) ?? {}) });
        await undo();
        readings[inv.id] = { clean, caught, after: await inv.check(w.monitor) };
      }
    },
  });
}, 600_000);

describe('the invariant monitor, canary by canary', () => {
  it('every invariant has a canary, and every canary an invariant', () => {
    expect(Object.keys(CANARIES).sort()).toEqual(INVARIANTS.map((i) => i.id).sort());
  });
  for (const inv of INVARIANTS) {
    it(`${inv.id}: clean, then catches ${CANARIES[inv.id]?.what ?? '(no canary)'}, then clean again`, () => {
      const r = readings[inv.id];
      expect(r, 'the canary ran').toBeDefined();
      expect(r!.clean).toEqual([]);
      expect(r!.caught.length).toBeGreaterThan(0);
      expect(r!.caught.join(' ')).not.toMatch(/the check itself failed/);
      expect(r!.after).toEqual([]);
    });
  }
});
