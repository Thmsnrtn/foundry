process.env.TURSO_DATABASE_URL = 'file::memory:';
process.env.ENCRYPTION_KEY = '0'.repeat(64);
process.env.FOUNDRY_INSTANCE_POSTURE = 'private_owner';
process.env.FOUNDRY_OWNER_EMAIL = 'owner@example.com';

import { beforeAll, describe, expect, it } from 'vitest';
import { Hono } from 'hono';
import { runMigrations } from '../../src/db/migrate.js';
import { query } from '../../src/db/client.js';
import {
  channelFor, connectSense, connectedSenses, disconnectSense,
  everySense, noteSenseObserved, whatItCannotSee,
} from '../../src/services/senses/index.js';

// =============================================================================
// A SENSE IS NOT A HAND.
//
// The owner's permanent rule: reading a repository never grants permission to
// modify it; seeing revenue never grants permission to move money. Until now a
// connection was an `integrations` row — a credential and a cadence — which
// says nothing about what Foundry is trying to learn or what connecting it does
// NOT allow, so the owner was asked "connect an integration" when the question
// he can answer is "may I see your revenue".
//
// THE OTHER HALF OF THIS FILE is the mandate's harder requirement: build and
// controlled-prove the whole architecture with reference and sandbox sources,
// so a real credential is the final replacement of a controlled source rather
// than the thing required to discover how the system works. Which means the
// business logic must NOT fork on whether a source is real — only the
// provenance may — and that is asserted here against the real writers.
// =============================================================================

const OWNER = 'sn_owner';
const REAL = 'sn_real';
let referenceId = '';

beforeAll(async () => {
  await runMigrations();
  await query('INSERT INTO founders (id,clerk_user_id,email,name) VALUES (?,?,?,?)',
    [OWNER, 'clerk_sn', 'owner@example.com', 'Owner']);
  await query("INSERT INTO products (id,name,owner_id,status) VALUES (?,'AcreOS',?,'active')",
    [REAL, OWNER]);
  const { establishReferenceCompany } = await import('../../src/services/reference/world.js');
  const ref = await establishReferenceCompany({
    scenarioKey: 'revenue_quietly_falling', ownerId: OWNER,
  });
  if (!ref) throw new Error('no reference company');
  referenceId = ref.productId;
});

describe('what a sense is', () => {
  it('says what it would never let Foundry do, constitutionally', async () => {
    const senses = await everySense();
    const revenue = senses.find((s) => s.key === 'revenue');
    // The owner's own example, and it has to be the schema saying it rather
    // than a page: a promise written in a template can be edited by anyone who
    // edits the template.
    expect(revenue?.neverGrants).toContain('move money');
    expect(revenue?.neverGrants).toContain('change prices');
    const software = senses.find((s) => s.key === 'software');
    expect(software?.neverGrants).toContain('change the code');
    for (const sense of senses) {
      expect(sense.neverGrants.length, sense.key).toBeGreaterThan(10);
    }
    // check-vocabulary:expected-refusal
    await expect(query(
      `INSERT INTO senses (sense_key,cannot_see,would_learn,never_grants,sort_order)
       VALUES ('x','x','x','',9)`)).rejects.toThrow(/constitutional/);
  });

  it('starts from what Foundry cannot know, not from a provider list', async () => {
    const blind = await whatItCannotSee(REAL);
    expect(blind.map((g) => g.key)).toContain('revenue');
    const revenue = blind.find((g) => g.key === 'revenue');
    expect(revenue?.offers.map((o) => o.provider)).toContain('stripe');
    // A REAL COMPANY IS NEVER OFFERED THE REFERENCE WORLD. He should not be
    // shown a door that would close in his face.
    expect(revenue?.offers.map((o) => o.mode)).not.toContain('reference');
    expect(revenue?.offers.map((o) => o.mode)).toContain('sandbox');
  });

  it('names a gap nothing can fill rather than hiding it', async () => {
    // "I cannot see what it costs to run, and nothing I can connect would tell
    // me" is true and useful. Hiding it would make the list look complete.
    const costs = (await whatItCannotSee(REAL)).find((g) => g.key === 'costs');
    expect(costs).toBeDefined();
    expect(costs?.offers).toEqual([]);
  });
});

describe('the source mode decides provenance and nothing else', () => {
  it('writes a real provider to the world\'s channel', async () => {
    await connectSense({ productId: REAL, companyName: 'AcreOS',
      senseKey: 'revenue', provider: 'stripe', mode: 'real' });
    const channel = await channelFor(REAL, { provider: 'stripe' });
    expect(channel.source).toBe('external_metric_ingest');
    expect(channel.prefix).toBe('external_metric:');
  });

  it('writes a provider\'s test mode to its own channel — the whole path, none of the world', async () => {
    await connectSense({ productId: REAL, companyName: 'AcreOS',
      senseKey: 'product_usage', provider: 'posthog', mode: 'real' });
    // A second company, so the sandbox case is not entangled with the real one.
    const SANDBOX = 'sn_sandbox';
    await query("INSERT INTO products (id,name,owner_id,status) VALUES (?,'Sandbox Co',?,'active')",
      [SANDBOX, OWNER]);
    await connectSense({ productId: SANDBOX, companyName: 'Sandbox Co',
      senseKey: 'revenue', provider: 'stripe', mode: 'sandbox' });

    const channel = await channelFor(SANDBOX, { provider: 'stripe' });
    expect(channel.source).toBe('sandbox_metric_ingest');

    // And the whole production writer takes it there.
    const { recordExternalMetricObservations } = await import(
      '../../src/services/institution/external-observation.js');
    for (const [id, back, users] of [
      ['sn_s1', '-2 day', 100], ['sn_s2', '-1 day', 100],
    ] as const) {
      await query(
        `INSERT INTO metric_snapshots (id,product_id,snapshot_date,active_users)
         VALUES (?,?,date('now',?),?)`, [id, SANDBOX, back, users]);
    }
    const written = await recordExternalMetricObservations({
      productId: SANDBOX, origin: 'stripe_test', provider: 'stripe',
      readings: [{ field: 'active_users', observedValue: 175 }],
    });
    expect(written).toHaveLength(1);
    const row = (await query('SELECT source, event_type FROM signal_events WHERE id=?',
      [written[0].id])).rows[0] as Record<string, unknown>;
    expect(String(row.source)).toBe('sandbox_metric_ingest');
    expect(String(row.event_type)).toBe('sandbox_metric:active_users:rose');

    // THE CONSEQUENCE THAT MATTERS, AND IT IS FREE. Every existing count of
    // evidence about the world names `external_metric_ingest`, so a sandbox
    // reading was excluded the moment migration 227 ran — with no change to
    // any of them and nobody remembering a join.
    const world = (await query(
      `SELECT COUNT(*) AS n FROM signal_events
        WHERE product_id = ? AND source = 'external_metric_ingest'`, [SANDBOX]))
      .rows[0] as Record<string, unknown>;
    expect(Number(world.n)).toBe(0);
  });

  it('refuses a real sense on a company that does not exist, and the reverse', async () => {
    await expect(connectSense({ productId: referenceId, companyName: 'Ref',
      senseKey: 'revenue', provider: 'stripe', mode: 'real' }))
      .rejects.toThrow(/reference_company_real_sense/);
    await expect(connectSense({ productId: REAL, companyName: 'AcreOS',
      senseKey: 'support', provider: 'reference_world', mode: 'reference' }))
      .rejects.toThrow(/real_company_reference_sense/);
  });

  it('refuses a provider being connected as a sense it cannot supply', async () => {
    // Without this a caller could connect Stripe as the 'software' sense and
    // the owner would be shown a disclosure about code for a payments key.
    expect(await connectSense({ productId: REAL, companyName: 'AcreOS',
      senseKey: 'software', provider: 'stripe', mode: 'real' })).toBeNull();
  });

  it('holds one source per question, because picking between two is his job', async () => {
    await expect(connectSense({ productId: REAL, companyName: 'AcreOS',
      senseKey: 'revenue', provider: 'stripe', mode: 'sandbox' })).rejects.toThrow();
  });
});

describe('the reference world is a provider like any other', () => {
  it('arrives connected through the same contract', async () => {
    const live = await connectedSenses(referenceId);
    expect(live.map((s) => s.senseKey).sort())
      .toEqual(['customers', 'product_usage', 'revenue', 'support']);
    for (const sense of live) {
      expect(sense.provider).toBe('reference_world');
      expect(sense.mode).toBe('reference');
    }
    // Which is the point: connecting a real source later replaces a row, not a
    // path. The company product does not have a branch for this company.
    expect(await channelFor(referenceId, { provider: 'reference_world' }))
      .toMatchObject({ source: 'reference_metric_ingest' });
  });

  it('records when it last spoke, so freshness is a fact', async () => {
    const { advanceReferenceWorld } = await import('../../src/services/reference/world.js');
    await advanceReferenceWorld(referenceId);
    const live = await connectedSenses(referenceId);
    expect(live.every((s) => s.lastObservedAt !== null)).toBe(true);
    expect(live.every((s) => s.lastError === null)).toBe(true);
  });

  it('carries a failure where the owner reads it', async () => {
    await noteSenseObserved(referenceId, 'reference_world', 'the intake refused it (422)');
    const live = await connectedSenses(referenceId);
    expect(live[0]?.lastError).toContain('422');
  });
});

describe('the owner experience', () => {
  const asOwner = async (path: string, body?: string): Promise<{
    status: number; text: string; location: string | null;
  }> => {
    const { foundryShellRoutes } = await import('../../src/routes/dashboard/foundry-shell.js');
    const app = new Hono();
    app.use('*', async (c, next) => {
      c.set('founder' as never,
        { id: OWNER, email: 'owner@example.com', name: 'Owner' } as never);
      c.set('csrfToken' as never, 'test' as never);
      await next();
    });
    app.route('/', foundryShellRoutes as never);
    const res = await app.request(path, body == null ? undefined : {
      method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body,
    });
    return { status: res.status, text: await res.text(), location: res.headers.get('location') };
  };

  it('never hands him to the old technical surface', async () => {
    const page = await asOwner(`/foundry/companies/${REAL}`);
    expect(page.status).toBe(200);
    // THE SEAM THAT HAD TO DISAPPEAR.
    expect(page.text).not.toContain('/agents/integrations');
    expect(page.text).toContain('I cannot see what customers are asking for');
    expect(page.text).toContain(`/foundry/companies/${REAL}/see/support`);
  });

  it('asks in the owner\'s question, and states both halves of the rule', async () => {
    const offer = await asOwner(`/foundry/companies/${REAL}/see/support`);
    expect(offer.status).toBe(200);
    expect(offer.text).toContain('Let me see what customers are asking for?');
    expect(offer.text).toContain('What it would still not let me do');
    expect(offer.text).toContain('reply to anyone');
    // And the uncomfortable half: what the credential could technically do.
    expect(offer.text).toContain('could reply to a customer');
  });

  it('says what became visible, not that an integration connected', async () => {
    const done = await asOwner(`/foundry/companies/${REAL}/see/support`,
      'provider=intercom&mode=real');
    expect(done.location).toBe(`/foundry/companies/${REAL}?done=seeing&sense=support`);

    const page = await asOwner(`/foundry/companies/${REAL}?done=seeing&sense=support`);
    expect(page.text).toContain('I can see it now');
    expect(page.text).toContain('what customers are writing in about');
    expect(page.text).toContain('I still cannot reply to anyone');
    // AND THE HONEST STATE UNDERNEATH: connected is not the same as reporting.
    expect(page.text).toContain('Nothing has reported yet');
  });

  it('stops the gap list contradicting what it just connected', async () => {
    const page = await asOwner(`/foundry/companies/${REAL}`);
    expect(page.text).toContain('What I can see');
    expect(page.text).not.toContain('I cannot see what customers are asking for');
  });

  it('disconnects, and says what that did and did not undo', async () => {
    const live = (await connectedSenses(REAL)).find((s) => s.senseKey === 'support');
    if (!live) throw new Error('expected a sense');
    const gone = await asOwner(
      `/foundry/companies/${REAL}/senses/${live.id}/disconnect`, '');
    expect(gone.location).toBe(`/foundry/companies/${REAL}?done=blind`);

    const page = await asOwner(`/foundry/companies/${REAL}?done=blind`);
    expect(page.text).toContain('What I already learned stays');
    // And it is offered again, because it is a gap again.
    expect(page.text).toContain(`/foundry/companies/${REAL}/see/support`);
  });

  it('refuses a company that is not his', async () => {
    await query('INSERT INTO founders (id,clerk_user_id,email) VALUES (?,?,?)',
      ['sn_str', 'c_str', 's@e.com']);
    await query("INSERT INTO products (id,name,owner_id,status) VALUES (?,?,?,'active')",
      ['sn_theirs', 'Theirs', 'sn_str']);
    expect((await asOwner('/foundry/companies/sn_theirs/see/revenue')).status).toBe(404);
  });
});

describe('a disconnected sense', () => {
  it('cannot be reconnected in place, so the record stays true', async () => {
    const id = (await query(
      `SELECT id FROM company_senses WHERE product_id = ? AND disconnected_at IS NOT NULL
        ORDER BY rowid DESC LIMIT 1`, [REAL])).rows[0] as Record<string, unknown>;
    await expect(query(
      "UPDATE company_senses SET disconnected_at = datetime('now') WHERE id = ?", [String(id.id)]))
      .rejects.toThrow(/already_disconnected/);
    // Reconnecting writes a new row, which is how the history stays honest
    // about when Foundry could and could not see something.
    const again = await connectSense({ productId: REAL, companyName: 'AcreOS',
      senseKey: 'support', provider: 'intercom', mode: 'real' });
    expect(again?.id).not.toBe(String(id.id));
    await disconnectSense(again?.id ?? '', 'tidying up');
  });
});
