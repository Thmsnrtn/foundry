process.env.TURSO_DATABASE_URL = 'file::memory:';
process.env.ENCRYPTION_KEY = '0'.repeat(64);

import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { runMigrations } from '../../src/db/migrate.js';
import { query } from '../../src/db/client.js';
import {
  FUNNEL_STEPS, SERVICE_STEPS, TELEMETRY_STEPS, getFunnelReadout, recordFunnelStep, stepKind,
} from '../../src/services/telemetry/funnel.js';
import { recordConsent } from '../../src/services/privacy/consent.js';
import { contributorHash } from '../../src/services/wisdom/network.js';

// =============================================================================
// OWNER DECISION §14, ANSWERED: SPLIT ANALYTICS.
//
// The privacy page offered "Help Improve Foundry" — *"Allow Foundry to use your
// anonymized usage patterns to improve the product for everyone"* — and nothing
// read it. Every funnel step was recorded against a NAMED founder whether the
// toggle was on or off, so a person who declined was told their usage patterns
// were not being used while their whole progression was.
//
// The answer is not to gate the lot. Foundry cannot run or bill an account
// without knowing it signed up, connected a repo, started a trial and paid, and
// a switch over that would be a choice that cannot be honoured. So:
//
//   SERVICE state stays ungated and is DISCLOSED in those words.
//   TELEMETRY is recorded only with consent, and then without a name.
//
// MINIMISATION FIRST. No consent means no row — not a row filtered out at read
// time, which would make the toggle a display preference rather than a control.
// =============================================================================

const F = 'ssa_founder';
const P = 'ssa_product';

beforeAll(async () => {
  await runMigrations();
  await query(`INSERT INTO founders (id,clerk_user_id,email) VALUES (?,'ssa_c','f@example.com')`, [F]);
  await query(`INSERT INTO products (id,name,owner_id,status) VALUES (?,'Split Co',?,'active')`, [P, F]);
});

beforeEach(async () => {
  await query('DELETE FROM funnel_events');
  await query('DELETE FROM product_telemetry_events');
  await query('DELETE FROM privacy_consents');
});

const funnel = async () => (await query('SELECT step, founder_id FROM funnel_events'))
  .rows as unknown as Array<Record<string, unknown>>;
const telemetry = async () => (await query('SELECT step, contributor_hash FROM product_telemetry_events'))
  .rows as unknown as Array<Record<string, unknown>>;

describe('the split itself', () => {
  it('classifies every step, with none left over', () => {
    const classified = [...SERVICE_STEPS, ...TELEMETRY_STEPS].sort();
    expect(classified).toEqual([...FUNNEL_STEPS].sort());
    expect(new Set(classified).size, 'and none in both').toBe(FUNNEL_STEPS.length);
  });

  it('treats an unclassified step as telemetry, not as service', () => {
    // Fails closed. The mistake that costs somebody something is recording
    // without consent, so a step nobody classified goes to the gated side.
    expect(stepKind('something_new' as never)).toBe('telemetry');
  });
});

describe('service state', () => {
  it('is recorded whether or not the founder consented, because it must be', async () => {
    for (const step of SERVICE_STEPS) {
      await recordFunnelStep(step, { founderId: F, productId: P });
    }
    expect((await funnel()).map((r) => r.step).sort()).toEqual([...SERVICE_STEPS].sort());
    expect(await telemetry(), 'and none of it leaks into the analytics table').toEqual([]);
  });

  it('still names the account, because running it requires that', async () => {
    await recordFunnelStep('paid', { founderId: F, productId: P });
    const [row] = await funnel();
    expect(row.founder_id).toBe(F);
  });
});

describe('product telemetry', () => {
  it('is not recorded at all without consent', async () => {
    for (const step of TELEMETRY_STEPS) {
      await recordFunnelStep(step, { founderId: F, productId: P });
    }
    expect(await telemetry(), 'off means not written, not written-and-ignored').toEqual([]);
    expect(await funnel(), 'and it does not fall back to the account').toEqual([]);
  });

  it('is recorded with consent, against a hash rather than a name', async () => {
    await recordConsent(P, F, 'product_improvement', true);
    await recordFunnelStep('briefing_viewed', { founderId: F, productId: P });

    const [row] = await telemetry();
    expect(row.step).toBe('briefing_viewed');
    expect(row.contributor_hash).toBe(contributorHash(F));
    expect(String(row.contributor_hash), 'the table does not carry a founder id').not.toBe(F);
    expect(await funnel(), 'and not in the named table either').toEqual([]);
  });

  it('stops again when the consent is withdrawn', async () => {
    await recordConsent(P, F, 'product_improvement', true);
    await recordFunnelStep('audit_done', { founderId: F, productId: P });
    expect(await telemetry()).toHaveLength(1);

    await recordConsent(P, F, 'product_improvement', false);
    await recordFunnelStep('decision_approved', { founderId: F, productId: P });
    expect((await telemetry()).map((r) => r.step), 'no new row after withdrawal')
      .toEqual(['audit_done']);
  });

  it('has nobody to ask when there is no company, so records nothing', async () => {
    await recordFunnelStep('briefing_viewed', { founderId: F, productId: null });
    expect(await telemetry()).toEqual([]);
  });
});

describe('the readout', () => {
  it('says which population each count is over', async () => {
    await recordConsent(P, F, 'product_improvement', true);
    await recordFunnelStep('signup', { founderId: F, productId: P });
    await recordFunnelStep('briefing_viewed', { founderId: F, productId: P });

    const rows = await getFunnelReadout();
    const signup = rows.find((r) => r.step === 'signup');
    const briefing = rows.find((r) => r.step === 'briefing_viewed');

    expect(signup?.count).toBe(1);
    expect(signup?.kind).toBe('service');
    expect(briefing?.count).toBe(1);
    expect(briefing?.kind, 'a smaller population by construction, and it says so')
      .toBe('telemetry');
  });
});

describe('an erased account takes its telemetry with it', () => {
  it('is reachable by the erasure, which a pseudonym does not exempt it from', async () => {
    const { ERASE_BY_NAMED_KEY_TABLES } = await import('../../src/services/privacy/consent.js');
    const entry = (ERASE_BY_NAMED_KEY_TABLES as Record<string, { column: string; subject: string }>)
      .product_telemetry_events;
    expect(entry, 'a table the erasure has never heard of survives forever').toBeDefined();
    expect(entry.column).toBe('contributor_hash');
    expect(entry.subject).toBe('contributor_hash');
  });
});
