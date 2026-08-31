process.env.TURSO_DATABASE_URL = 'file::memory:';

import { beforeAll, describe, expect, it } from 'vitest';
import { runMigrations } from '../../src/db/migrate.js';
import { query } from '../../src/db/client.js';
import { reportCompanyObligation } from '../../src/services/founder/company-report.js';
import { recordReconstructionClaim } from '../../src/services/institution/reconstruction.js';
import { earnResponsibilityUnderstanding } from '../../src/services/institution/responsibility-understanding.js';
import {
  beginExternalMetricShadowing, getShadowableResponsibilities, resolveExternalMetricShadowing,
} from '../../src/services/institution/external-shadowing.js';
import {
  getObservationChannels, isAdmissibleObservationField, isWellFormedChannelKey,
  recordCompanyObservations, registerObservationChannel, revokeObservationChannel,
} from '../../src/services/institution/company-observation.js';
import { OBSERVABLE_FIELDS } from '../../src/services/institution/external-observation.js';

// =============================================================================
// A boatyard climbs the ladder.
//
// Independent observation was admissible only for twelve SaaS metrics, each a
// physical column in `metric_snapshots`. So a company whose reality is boats
// serviced could be Visible and Understood and then STOP: nothing it could
// report was admissible, Shadowing was unreachable, and Assisting could never
// be earned. That is a business-specific branch inside the constitution.
//
// The company here is deliberately nothing like a SaaS product, and no kernel
// code knows what a boat is.
// =============================================================================

const P = 'obs_boatyard';
const OWNER = 'obs_owner';
const CHANNEL = 'boats_serviced_weekly';

const UNDERSTANDING: Array<[string, unknown]> = [
  ['purpose', 'Every booked boat gets its service done in the week it was promised'],
  ['desired_outcome', 'No customer waits past the week they were given'],
  ['success_conditions', 'The week ends with the booked list complete'],
  ['operating_constraints', 'Two mechanics, one lift, weather closes the yard'],
  ['dependencies', 'Parts arriving, and the lift working'],
  ['risks', 'A missed week pushes every following week'],
  ['systems', 'The paper booking book and the yard whiteboard'],
  ['failure_modes', 'Parts do not arrive and the boat sits on the hard'],
  ['current_carrier', 'The yard manager works the booking book by hand each Monday'],
];

let responsibilityId: string;

beforeAll(async () => {
  await runMigrations();
  await query(`INSERT INTO founders (id,clerk_user_id,email) VALUES ('${OWNER}','obs_clerk','o@example.com')`, []);
  await query(`INSERT INTO products (id,name,owner_id) VALUES ('${P}','Harbourside Boatyard','${OWNER}')`, []);
});

describe('company-defined observation channels', () => {
  it('lets a company declare a quantity in its own words, with provenance', async () => {
    const channel = await registerObservationChannel({
      productId: P, founderId: OWNER, channelKey: CHANNEL,
      label: 'Boats serviced this week', unit: 'boats',
    });
    expect(channel).toMatchObject({ channelKey: CHANNEL, label: 'Boats serviced this week', unit: 'boats' });

    // Declaring is a founder assertion: canonical evidence plus a bounded claim,
    // never a configuration row nobody can account for.
    const evidence = (await query(
      `SELECT COUNT(*) n FROM signal_events WHERE product_id=?
        AND event_type='founder_declared_observation_channel'`, [P])).rows[0];
    expect(evidence).toMatchObject({ n: 1 });
    const claim = (await query(
      "SELECT COUNT(*) n FROM reconstruction_claims WHERE product_id=? AND predicate='observation_channel'", [P],
    )).rows[0];
    expect(claim).toMatchObject({ n: 1 });

    // Declaring grants nothing.
    expect((await query('SELECT COUNT(*) n FROM autonomy_consents WHERE product_id=?', [P])).rows[0])
      .toMatchObject({ n: 0 });
  });

  it('refuses a stranger, a malformed key, and a key that shadows a built-in metric', async () => {
    expect(await registerObservationChannel({
      productId: P, founderId: 'not-the-owner', channelKey: 'anything_here', label: 'x',
    })).toBeNull();

    for (const bad of ['ab', 'Boats', '../escape', 'boats-serviced', '9lives', 'x'.repeat(41), '']) {
      expect(isWellFormedChannelKey(bad), `${bad} must be malformed`).toBe(false);
      expect(await registerObservationChannel({
        productId: P, founderId: OWNER, channelKey: bad, label: 'Attempt',
      })).toBeNull();
    }

    // A company channel may not take a built-in name: the same identifier would
    // mean two different things depending on which source wrote it.
    for (const reserved of OBSERVABLE_FIELDS) {
      expect(isWellFormedChannelKey(reserved), `${reserved} is reserved`).toBe(false);
    }
    expect(await registerObservationChannel({
      productId: P, founderId: OWNER, channelKey: 'churn_rate', label: 'Ours',
    })).toBeNull();
  });

  it('mirrors the reserved list in the database guard, so the two cannot drift', async () => {
    // The guard in migration 135 repeats OBSERVABLE_FIELDS. If the TypeScript
    // list grew and the trigger did not, a company could claim a built-in name
    // through any path that bypassed the service.
    await query(`INSERT INTO signal_events (id,product_id,source,event_type,severity,payload_json,summary)
      VALUES ('obs_ev','${P}','founder_assertion_structured','x','low','{}','x')`, []);
    for (const reserved of OBSERVABLE_FIELDS) {
      await expect(query(
        `INSERT INTO company_observation_channels (id,product_id,channel_key,label,evidence_signal_id)
         VALUES (?,?,?,'Direct','obs_ev')`, [`direct_${reserved}`, P, reserved],
      ), `the guard must refuse ${reserved}`).rejects.toThrow(/reserved_key/);
    }
  });

  it('records movement only once there is something to compare against', async () => {
    // A single reading is not movement. Inventing a direction from one point
    // would be stating a fact nobody observed.
    expect(await recordCompanyObservations({
      productId: P, origin: 'test', readings: [{ channelKey: CHANNEL, observedValue: 9 }],
    })).toEqual([]);

    const rose = await recordCompanyObservations({
      productId: P, origin: 'test', readings: [{ channelKey: CHANNEL, observedValue: 14 }],
    });
    expect(rose).toMatchObject([{ channelKey: CHANNEL, direction: 'rose' }]);

    // Identity is derived from the reading, so a replayed webhook converges.
    expect(await recordCompanyObservations({
      productId: P, origin: 'test', readings: [{ channelKey: CHANNEL, observedValue: 14 }],
    })).toEqual([]);
  });

  it('refuses readings for a channel nobody declared', async () => {
    // A value nobody said they track is not evidence about a responsibility.
    expect(await recordCompanyObservations({
      productId: P, origin: 'test', readings: [{ channelKey: 'undeclared_thing', observedValue: 5 }],
    })).toEqual([]);
    expect(await isAdmissibleObservationField(P, 'undeclared_thing')).toBe(false);
  });

  it('carries a boatyard from an owner report to Shadowing — previously impossible', async () => {
    const reported = await reportCompanyObligation({
      productId: P, founderId: OWNER, obligationKind: 'recurring_work',
      what: 'Service every booked boat in the week it was promised',
    });
    responsibilityId = reported!.responsibility!.id;
    expect(reported!.responsibility).toMatchObject({ state: 'visible' });

    const signalId = String(((await query(
      'SELECT discovery_evidence_ref d FROM institutional_responsibilities WHERE id=?', [responsibilityId],
    )).rows[0] as Record<string, unknown>).d).replace('signal_event:', '');
    for (const [predicate, value] of UNDERSTANDING) {
      await recordReconstructionClaim({
        productId: P, subject: `responsibility:${responsibilityId}`, predicate, value,
        epistemicStatus: 'known', evidenceRefs: [{ kind: 'signal_event', id: signalId }],
        derivationMethod: 'the founder described how the yard works', observedAt: new Date(),
      });
    }
    expect(await earnResponsibilityUnderstanding(P, responsibilityId)).toMatchObject({ state: 'understood' });

    // The founder surface offers the company's own quantity, in its own words.
    const shadowable = await getShadowableResponsibilities(P);
    expect(shadowable).toHaveLength(1);
    expect(shadowable[0].channels).toEqual(
      expect.arrayContaining([{ field: CHANNEL, label: 'Boats serviced this week (boats)' }]));

    // ON THE PAGE, which is what "the founder surface offers" has to mean. This
    // line used to assert a claim about a surface by calling a function: the
    // route existed, `getShadowableResponsibilities` was written to populate
    // exactly this form, and NOTHING RENDERED ONE. So the path from Understood
    // to Shadowing existed for development checks and not for the company's own
    // numbers, and no test could tell.
    const { Hono } = await import('hono');
    const { letterRoutes } = await import('../../src/routes/dashboard/letter.js');
    const app = new Hono();
    app.use('*', async (c, next) => {
      c.set('founder' as never, { id: OWNER, email: 'o@example.com', preferences: {} } as never);
      c.set('csrfToken' as never, 't' as never);
      await next();
    });
    app.route('/', letterRoutes);

    const rendered = await (await app.request('/letter')).text();
    expect(rendered, 'the form must exist for a founder to submit')
      .toContain(`/letter/responsibilities/${responsibilityId}/watch"`);
    expect(rendered, "and offer the company's own words, not a field name")
      .toContain('Boats serviced this week (boats)');

    // And the rung is entered THROUGH IT, on a channel that has real readings.
    const posted = await app.request(`/letter/responsibilities/${responsibilityId}/watch`, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: `field=${CHANNEL}&direction=rose`,
    });
    expect(posted.status).toBe(302);

    const shadowing = (await query(
      'SELECT state,authority_ref FROM institutional_responsibilities WHERE id=?',
      [responsibilityId])).rows[0];
    expect(shadowing).toMatchObject({ state: 'shadowing' });
    // Watching is not permission.
    expect(shadowing).toMatchObject({ authority_ref: null });
  });

  it('resolves the expectation against real later readings, and never from silence', async () => {
    // Nothing new since the expectation: unresolved, not success.
    expect(await resolveExternalMetricShadowing(P, await openExpectationId()))
      .toMatchObject({ classification: 'unresolved' });

    await query(
      "UPDATE responsibility_shadow_expectations SET created_at=datetime(created_at,'-60 seconds') WHERE responsibility_id=?",
      [responsibilityId]);
    await recordCompanyObservations({
      productId: P, origin: 'test', readings: [{ channelKey: CHANNEL, observedValue: 21 }],
    });

    const resolved = await resolveExternalMetricShadowing(P, await openExpectationId());
    expect(resolved.classification).toBe('matched');
    expect(resolved.observationsConsidered).toBeGreaterThan(0);
    // Being right while watching is still not permission.
    expect((await query(
      'SELECT COUNT(*) n FROM autonomy_consents WHERE product_id=?', [P])).rows[0]).toMatchObject({ n: 0 });
  });

  it('stops admitting a revoked channel without erasing what it already observed', async () => {
    const observedBefore = (await query(
      `SELECT COUNT(*) n FROM signal_events WHERE product_id=? AND source='external_metric_ingest'`, [P],
    )).rows[0] as Record<string, unknown>;

    expect(await revokeObservationChannel({ productId: P, channelKey: CHANNEL, founderId: OWNER })).toBe(true);
    expect(await isAdmissibleObservationField(P, CHANNEL)).toBe(false);
    expect(await recordCompanyObservations({
      productId: P, origin: 'test', readings: [{ channelKey: CHANNEL, observedValue: 40 }],
    })).toEqual([]);

    // Revocation stops future admission; it is not a rewrite of history.
    expect((await query(
      `SELECT COUNT(*) n FROM signal_events WHERE product_id=? AND source='external_metric_ingest'`, [P],
    )).rows[0]).toEqual(observedBefore);
    expect((await getObservationChannels(P)).find((c) => c.channelKey === CHANNEL)?.revoked).toBe(true);

    // A stranger could not have done that.
    expect(await revokeObservationChannel({
      productId: P, channelKey: CHANNEL, founderId: 'someone-else' })).toBe(false);
  });

  it('gives the founder a door out, not just a function that could open one', async () => {
    // THE HALF THAT WAS MISSING. `revokeObservationChannel` existed, exported,
    // and had no route: a founder could tell Foundry what to watch and had no
    // way to tell it to stop, while the identical support-channel revoke had
    // been there from the start. A withdrawal only ever lowers what Foundry may
    // do, so it is never the half to leave unbuilt.
    //
    // Asserted through the ROUTE, because the function was never the problem.
    const { Hono } = await import('hono');
    const { letterRoutes } = await import('../../src/routes/dashboard/letter.js');
    const app = new Hono();
    app.use('*', async (c, next) => {
      c.set('founder' as never, { id: c.req.header('x-founder') ?? OWNER, email: 'o@example.com', preferences: {} } as never);
      c.set('csrfToken' as never, 't' as never);
      await next();
    });
    app.route('/', letterRoutes);

    const KEY = 'boats_hauled_out';
    expect(await registerObservationChannel({
      productId: P, founderId: OWNER, channelKey: KEY, label: 'Boats hauled out', unit: 'boats',
    })).toBeTruthy();
    // The page offers it, which is the part that did not exist.
    expect(await (await app.request('/letter')).text()).toContain('Stop watching this');

    const form = (founder: string) => app.request('/letter/company/observation-channel/revoke', {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded', 'x-founder': founder },
      body: `channel_key=${KEY}`,
    });

    // A founder of ANOTHER company — given one of their own, so this exercises
    // the tenancy refusal rather than the earlier "no company selected" branch.
    // They get the same answer as an unknown channel would: saying which would
    // tell them what this company counts.
    await query(`INSERT INTO founders (id,clerk_user_id,email) VALUES ('obs_stranger','obs_s','s@example.com')`, []);
    await query(`INSERT INTO products (id,name,owner_id) VALUES ('obs_stranger_co','Stranger Co','obs_stranger')`, []);
    expect((await form('obs_stranger')).status).toBe(403);
    expect(await isAdmissibleObservationField(P, KEY)).toBe(true);

    expect((await form(OWNER)).status).toBe(302);
    expect(await isAdmissibleObservationField(P, KEY)).toBe(false);
    expect((await getObservationChannels(P)).find((c) => c.channelKey === KEY)?.revoked).toBe(true);
  });

  it('keeps one company\'s channels out of another\'s', async () => {
    await query(`INSERT INTO founders (id,clerk_user_id,email) VALUES ('obs_other','obs_c2','x@example.com')`, []);
    await query(`INSERT INTO products (id,name,owner_id) VALUES ('obs_other_co','Other Co','obs_other')`, []);
    // The same key declared by a different company is a different channel, and
    // this company's declaration does not admit readings for that one.
    expect(await isAdmissibleObservationField('obs_other_co', 'boats_serviced_weekly')).toBe(false);
    expect(await recordCompanyObservations({
      productId: 'obs_other_co', origin: 'test',
      readings: [{ channelKey: 'boats_serviced_weekly', observedValue: 3 }],
    })).toEqual([]);

    // And the DATABASE refuses it too, not just the service. Asserting only
    // through the service left the guard's tenant binding untested — removing
    // it from the trigger passed every test until this existed, which is
    // precisely the shape of a leak nobody notices.
    //
    // The forged field must be a channel that is LIVE for the other company:
    // naming a revoked one proves nothing, because `revoked_at` would refuse it
    // whether or not the guard checked tenancy at all.
    await registerObservationChannel({
      productId: P, founderId: OWNER, channelKey: 'lift_hours_used', label: 'Lift hours used',
    });
    await expect(query(
      `INSERT INTO signal_events (id,product_id,source,event_type,severity,payload_json,summary)
       VALUES ('obs_leak','obs_other_co','external_metric_ingest','external_metric:lift_hours_used:rose','low',
               json_object('origin','forged','field','lift_hours_used','direction','rose',
                           'observed_value',9,'previous_value',3),'forged')`,
    )).rejects.toThrow(/field_invalid/);

    // The identical insert for the company that DID declare it is admitted, so
    // the guard discriminates on tenancy rather than refusing everything.
    await query(
      `INSERT INTO signal_events (id,product_id,source,event_type,severity,payload_json,summary)
       VALUES ('obs_ok','${P}','external_metric_ingest','external_metric:lift_hours_used:rose','low',
               json_object('origin','test','field','lift_hours_used','direction','rose',
                           'observed_value',9,'previous_value',3),'ok')`);
  });
});

async function openExpectationId(): Promise<string> {
  return String(((await query(
    'SELECT id FROM responsibility_shadow_expectations WHERE responsibility_id=? ORDER BY rowid DESC LIMIT 1',
    [responsibilityId],
  )).rows[0] as Record<string, unknown>).id);
}
