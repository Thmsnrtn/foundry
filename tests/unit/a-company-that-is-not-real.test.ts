process.env.TURSO_DATABASE_URL = 'file::memory:';
process.env.ENCRYPTION_KEY = '0'.repeat(64);

import { beforeAll, describe, expect, it } from 'vitest';
import { runMigrations } from '../../src/db/migrate.js';
import { query, realCompany, referenceCompany } from '../../src/db/client.js';
import {
  externalObservationEventType, observationChannel, recordExternalMetricObservations,
} from '../../src/services/institution/external-observation.js';

// =============================================================================
// A COMPANY THAT IS NOT REAL.
//
// THE DEADLOCK. Private Foundry cannot be completed without company data to
// exercise it, and no owner should entrust a real company to it until it is
// complete. A reference company breaks that: synthetic, rich enough to run the
// actual institution through, and structurally incapable of becoming owner
// truth.
//
// "Structurally" is the load-bearing word. Six readers were asked what would
// break if a synthetic company existed and found roughly thirty paths by which
// its data reaches the owner or the world. These are the ones where a mistake
// would be worst — money, sending, and what he reads as his — and each is
// asserted against the REAL code path, not against a mock of it.
//
// BUILT, CONTROLLED-PROVEN, REALITY-PROVEN are three different things. This
// file is controlled proof: it demonstrates the boundary holds against the
// paths we know about. It cannot prove there is no thirty-first path, which is
// what `scripts/check-reality-scope.mjs` exists to keep asking.
// =============================================================================

const OWNER = 'rb_owner';
const REAL = 'rb_real';
const REFERENCE = 'rb_reference';

beforeAll(async () => {
  await runMigrations();
  await query('INSERT INTO founders (id,clerk_user_id,email,name) VALUES (?,?,?,?)',
    [OWNER, 'clerk_rb', 'owner@example.com', 'Owner']);
  await query(
    "INSERT INTO products (id,name,owner_id,status) VALUES (?,'Real Co',?,'active')",
    [REAL, OWNER]);
  await query(
    `INSERT INTO products (id,name,owner_id,status,reality)
     VALUES (?,'Reference Co',?,'active','reference')`, [REFERENCE, OWNER]);
  await query(
    `INSERT INTO reference_companies (product_id, scenario, purpose)
     VALUES (?,?,?)`,
    [REFERENCE, 'a subscription business whose revenue is falling',
      'exercise the institution end to end without touching a real company']);
});

describe('what a company is', () => {
  it('answers the question by default, and answers it safely', async () => {
    // NOT NULL with a safe default: every company created by a path that
    // predates the boundary is real, which is what those paths meant.
    const real = (await query('SELECT reality FROM products WHERE id=?', [REAL]))
      .rows[0] as Record<string, unknown>;
    expect(String(real.reality)).toBe('real');
  });

  it('cannot be promoted into reality, or demoted out of it', async () => {
    // The entire guarantee is that synthetic evidence never becomes real
    // evidence. If this were editable, every outcome, comparison and track
    // record a reference company accumulated would become real the moment
    // somebody ran one UPDATE — and nothing downstream would know.
    await expect(query('UPDATE products SET reality=? WHERE id=?', ['real', REFERENCE]))
      .rejects.toThrow(/reality_immutable/);
    await expect(query('UPDATE products SET reality=? WHERE id=?', ['reference', REAL]))
      .rejects.toThrow(/reality_immutable/);
  });

  it('refuses a third kind of reality', async () => {
    // check-vocabulary:expected-refusal
    await expect(query(
      `INSERT INTO products (id,name,owner_id,status,reality)
       VALUES ('rb_x','X',?,'active','sort-of')`, [OWNER])).rejects.toThrow();
  });

  it('says why it exists, and cannot quietly stop saying so', async () => {
    const row = (await query('SELECT scenario, purpose FROM reference_companies WHERE product_id=?',
      [REFERENCE])).rows[0] as Record<string, unknown>;
    expect(String(row.scenario)).toContain('revenue is falling');
    // Deleting the explanation would leave a synthetic company that nothing
    // identifies as one — while the company is still here. Migration 224 makes
    // the one exception migration 162 established for append-only history: a
    // company on its way out takes its explanation with it, because immutable
    // does not mean a row outlives the company it describes.
    await expect(query('DELETE FROM reference_companies WHERE product_id=?', [REFERENCE]))
      .rejects.toThrow(/immutable/);
  });

  it('refuses an explanation attached to a real company', async () => {
    await expect(query(
      'INSERT INTO reference_companies (product_id,scenario,purpose) VALUES (?,?,?)',
      [REAL, 'anything', 'anything'])).rejects.toThrow(/not_a_reference/);
  });
});

describe('the world', () => {
  it('refuses to let a reference company reach a provider', async () => {
    // THE SINGLE DOOR. Every consequential effect passes through the kill
    // switch, and the handlers below it use the COMPANY's credential falling
    // back to the deployment's own — so a rehearsal that got this far would
    // send a real message from a real account, and the audit log would record
    // it as allowed because every other check passed.
    const { checkKillSwitch } = await import('../../src/services/outbound/kill-switch.js');

    const refused = await checkKillSwitch(REFERENCE, 'send_email');
    expect(refused.blocked).toBe(true);
    expect(refused.reason).toContain('reference company');

    const allowed = await checkKillSwitch(REAL, 'send_email');
    expect(allowed.blocked).toBe(false);
  });

  it('refuses even for effects that are exempt from every other pause', async () => {
    // Account mail is deliverable while paused, because a founder whose card
    // was declined still needs to hear it. Nobody needs to hear anything about
    // a company that does not exist.
    const { checkKillSwitch } = await import('../../src/services/outbound/kill-switch.js');
    const refused = await checkKillSwitch(REFERENCE, 'send_email', null,
      { deliverableWhilePaused: true });
    expect(refused.blocked).toBe(true);
  });
});

describe('the money', () => {
  it('will not spend the real companies\' shared ceiling', async () => {
    // The founder and global ceilings are pools shared across everything. A
    // rehearsal loop that exhausted them would make genuine work fail — the one
    // failure mode where a fake company damages a real one without touching it.
    const { companyMayIncurCost } = await import('../../src/services/ai/client.js');

    // The reason is the refusal: every model call passes through this, and a
    // non-null answer is what `refuseIfNotEntitled` turns into NotEntitledError.
    expect(await companyMayIncurCost(REFERENCE)).toBe('a reference company');
    // And the real company is unaffected.
    expect(await companyMayIncurCost(REAL)).toBeNull();
  });
});

describe('what the owner reads as his', () => {
  it('lists only real companies', async () => {
    const { getProductsByOwner, getVisibleProducts } = await import('../../src/db/client.js');
    for (const rows of [(await getProductsByOwner(OWNER)).rows, (await getVisibleProducts(OWNER)).rows]) {
      const ids = (rows as unknown as Array<Record<string, unknown>>).map((r) => String(r.id));
      expect(ids).toContain(REAL);
      expect(ids).not.toContain(REFERENCE);
    }
  });

  it('still resolves his one company when a reference company exists', async () => {
    // THE QUIET BREAKAGE. `selectedProductId` returns a company only when the
    // founder has EXACTLY ONE non-archived product — "one is an unambiguous
    // choice". Seeding the reference world pushes that count above one and the
    // function silently returns null, so every route depending on it stops
    // resolving a company for an owner who still has exactly one.
    // Through a real Hono context, because `getCookie` reads the raw request —
    // a hand-made stub proves nothing about the function production calls.
    const { Hono } = await import('hono');
    const { selectedProductId } = await import('../../src/routes/dashboard/_shared.js');
    let resolved: string | null = 'unset';
    const app = new Hono();
    app.get('/x', async (c) => {
      resolved = await selectedProductId(c, OWNER);
      return c.text('ok');
    });
    await app.request('/x');
    expect(resolved).toBe(REAL);
  });

  it('keeps synthetic revenue out of what he is told he earned', async () => {
    for (const [id, mrr] of [[REAL, 500_00], [REFERENCE, 999_00]] as const) {
      await query(
        `INSERT INTO metric_snapshots (id, product_id, snapshot_date, new_mrr_cents)
         VALUES (?,?,date('now'),?)`, [`ms_${id}`, id, mrr]);
    }
    const { getPulse } = await import('../../src/services/founder/intelligence.js');
    const pulse = await getPulse();
    // The reference company's $999 must be nowhere in this number.
    expect(JSON.stringify(pulse)).not.toContain('99900');
  });

  it('does not count a fabricated contributor toward the cross-company floor', async () => {
    // The minimum sample exists so no single company speaks for many. A
    // reference company counted here would let a rehearsal manufacture the
    // quorum that makes cross-company wisdom publishable.
    const both = await query(
      `SELECT COUNT(*) AS n FROM products p JOIN founders f ON p.owner_id = f.id
        WHERE f.wisdom_network_opted_in = 1 AND p.status = 'active' AND ${realCompany('p')}`, []);
    const all = await query(
      `SELECT COUNT(*) AS n FROM products p JOIN founders f ON p.owner_id = f.id
        WHERE f.wisdom_network_opted_in = 1 AND p.status = 'active'`, []);
    expect(Number((both.rows[0] as Record<string, unknown>).n))
      .toBeLessThan(Number((all.rows[0] as Record<string, unknown>).n));
  });
});

describe('the predicate', () => {
  it('is one definition, usable under an alias', async () => {
    const rows = (await query(
      `SELECT id FROM products p WHERE ${realCompany('p')} AND p.owner_id = ?`, [OWNER]))
      .rows as unknown as Array<Record<string, unknown>>;
    expect(rows.map((r) => String(r.id))).toEqual([REAL]);

    const refs = (await query(
      `SELECT id FROM products p WHERE ${referenceCompany('p')}`, []))
      .rows as unknown as Array<Record<string, unknown>>;
    expect(refs.map((r) => String(r.id))).toEqual([REFERENCE]);
  });
});

describe('evidence the world produced', () => {
  // MIGRATION 223. Migration 222 stops synthetic data being SHOWN as real.
  // This stops it being COUNTED as real, which is the more dangerous half:
  // every claim the institution makes about what it has earned — leaving
  // Shadowing, admission to Assisting, asking the owner for authority — is
  // decided by counting observations of a particular `source`. A reference
  // company will produce those in volume, on demand, because that is what it
  // is for.

  it('refuses the world\'s channel to a company that is not in the world', async () => {
    await expect(query(
      `INSERT INTO signal_events (id,product_id,source,event_type,severity,payload_json,summary)
       VALUES ('rb_world',?,'external_metric_ingest','external_metric:active_users:rose',
               'low',?,'x')`,
      [REFERENCE, JSON.stringify({
        origin: 'stripe', field: 'active_users', direction: 'rose',
        observed_value: 2, previous_value: 1 })]))
      .rejects.toThrow(/world_evidence_refused/);
  });

  it('refuses the reference channel to a real company', async () => {
    // NOT SYMMETRY FOR ITS OWN SAKE. This is the same corruption read
    // backwards: the owner's company carrying a number nothing in the world
    // ever reported, counting toward everything a real reading counts toward.
    // One wrong id in a seeding script is the whole distance.
    await expect(query(
      `INSERT INTO signal_events (id,product_id,source,event_type,severity,payload_json,summary)
       VALUES ('rb_backwards',?,'reference_metric_ingest','reference_metric:active_users:rose',
               'low',?,'x')`,
      [REAL, JSON.stringify({
        origin: 'reference_world', field: 'active_users', direction: 'rose',
        observed_value: 2, previous_value: 1 })]))
      .rejects.toThrow(/reference_evidence_refused/);
  });

  it('refuses an outcome report about an effect that could never have happened', async () => {
    // A reference company cannot reach a provider (above), so it can have no
    // executed effect and therefore no outcome. Refusing the source states
    // that structurally rather than leaving it true by accident.
    await expect(query(
      `INSERT INTO signal_events (id,product_id,source,event_type,severity,payload_json,summary)
       VALUES ('rb_outcome',?,'effect_outcome_report','effect_outcome:e1:achieved','low',?,'x')`,
      [REFERENCE, JSON.stringify(
        { effect_id: 'e1', reporter: 'customer:someone', verdict: 'achieved' })]))
      .rejects.toThrow(/world_evidence_refused/);
  });

  it('sends a reference reading down the real writer, onto the reference channel', async () => {
    // ONE CODE PATH. The rehearsal is worth nothing if it travels different
    // code than the thing it rehearses, so the production writer is called
    // here and the only difference is which channel it chooses — from a column
    // the caller cannot set.
    expect(await observationChannel(REFERENCE))
      .toEqual({ reality: 'reference', source: 'reference_metric_ingest' });
    expect(await observationChannel(REAL))
      .toEqual({ reality: 'real', source: 'external_metric_ingest' });

    await query(
      `INSERT INTO metric_snapshots (id, product_id, snapshot_date, active_users)
       VALUES ('ms_ref_prior',?,date('now','-2 day'),10)`, [REFERENCE]);
    const written = await recordExternalMetricObservations({
      productId: REFERENCE, origin: 'reference_world',
      readings: [{ field: 'active_users', observedValue: 25 }],
    });
    expect(written).toHaveLength(1);

    const row = (await query('SELECT source, event_type FROM signal_events WHERE id=?',
      [written[0].id])).rows[0] as Record<string, unknown>;
    expect(String(row.source)).toBe('reference_metric_ingest');
    expect(String(row.event_type)).toBe('reference_metric:active_users:rose');
    expect(String(row.event_type))
      .toBe(externalObservationEventType('active_users', 'rose', 'reference'));
  });

  it('holds the reference channel to the identical contract', async () => {
    // ONE GUARD, WIDENED — not a second, laxer one. A reference reading that
    // names what it will be compared against is as inadmissible as a real one.
    const base = {
      origin: 'reference_world', field: 'active_users', direction: 'rose',
      observed_value: 2, previous_value: 1,
    };
    const insert = async (id: string, payload: Record<string, unknown>, eventType?: string) =>
      query(
        `INSERT INTO signal_events (id,product_id,source,event_type,severity,payload_json,summary)
         VALUES (?,?,'reference_metric_ingest',?,'low',?,'x')`,
        [id, REFERENCE, eventType ?? 'reference_metric:active_users:rose',
          JSON.stringify(payload)]);

    await expect(insert('rb_echo', { ...base, expectation_id: 'anything' }))
      .rejects.toThrow(/circular_grounding/);
    await expect(insert('rb_field', { ...base, field: 'vibes' }))
      .rejects.toThrow(/field_invalid/);
    await expect(insert('rb_dir', { ...base, direction: 'improved' }))
      .rejects.toThrow(/direction_invalid/);
    await expect(insert('rb_origin', { ...base, origin: '' }))
      .rejects.toThrow(/payload_invalid/);
    // And a reference reading may not wear the world's event type: the prefix
    // is what the prefix-keyed independence guards key on.
    await expect(insert('rb_prefix', base, 'external_metric:active_users:rose'))
      .rejects.toThrow(/event_type_mismatch/);
  });

  it('makes controlled proof and reality proof a question SQL can answer', async () => {
    // THE POINT OF ALL OF IT. Not that a person remembers to qualify a claim —
    // that the claim is decidable. Every existing query counting
    // `external_metric_ingest` became reference-safe when 223 ran, with no
    // change to it and no reliance on anyone adding a join.
    const world = await query(
      `SELECT COUNT(*) AS n FROM signal_events WHERE source='external_metric_ingest'`, []);
    const reference = await query(
      `SELECT COUNT(*) AS n FROM signal_events WHERE source='reference_metric_ingest'`, []);
    expect(Number((reference.rows[0] as Record<string, unknown>).n)).toBeGreaterThan(0);
    // No real-world reading exists in this fixture, and none could have come
    // from the reference company even if one did.
    expect(Number((world.rows[0] as Record<string, unknown>).n)).toBe(0);
  });
});
