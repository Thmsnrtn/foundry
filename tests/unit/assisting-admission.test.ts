process.env.TURSO_DATABASE_URL = 'file::memory:';

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { resolve } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import { runMigrations } from '../../src/db/migrate.js';
import { query } from '../../src/db/client.js';
import { reportCompanyObligation } from '../../src/services/founder/company-report.js';
import {
  recordFounderEvidenceAnswer, selectFounderEvidenceQuestion,
} from '../../src/services/institution/founder-evidence.js';
import { earnResponsibilityUnderstanding } from '../../src/services/institution/responsibility-understanding.js';
import { recordExternalMetricObservations } from '../../src/services/institution/external-observation.js';
import {
  beginExternalMetricShadowing, resolveExternalMetricShadowing,
} from '../../src/services/institution/external-shadowing.js';
import {
  getAssistingCandidates, grantAssistingAuthority, revokeAssistingAuthority,
} from '../../src/services/institution/assisting-admission.js';

// =============================================================================
// Shadowing → Assisting, made reachable from production-facing paths.
//
// The audit found no missing architecture. It found two missing writers:
// `recordConsent` supported responsibility-bound authority with exact scope and
// expiry and had no caller anywhere in src/, and `enterResponsibilityAssisting`
// was reachable only from the development path, which is itself undriven.
//
// The vertical below runs through the real services with nothing seeded past
// the first founder report and the first outside reading.
// =============================================================================

const OWNER = 'aa_owner';
const STRANGER = 'aa_stranger';
const PRODUCT = 'aa_bakery';

async function countOf(sql: string, args: unknown[] = []): Promise<number> {
  return Number(((await query(sql, args)).rows[0] as Record<string, unknown>).n);
}

let responsibilityId: string;

beforeAll(async () => {
  await runMigrations();
  await query(`INSERT INTO founders (id,clerk_user_id,email) VALUES
    (?,'aa_clerk','owner@example.com'),(?,'aa_stranger_clerk','stranger@example.com')`, [OWNER, STRANGER]);
  await query('INSERT INTO products (id,name,owner_id) VALUES (?,?,?)', [PRODUCT, 'Halden Bread Supply', OWNER]);

  // 1. The founder reports something the company must handle.
  const reported = await reportCompanyObligation({
    productId: PRODUCT, founderId: OWNER, obligationKind: 'customer_commitment',
    what: 'Answer wholesale customers about their standing orders',
  });
  responsibilityId = reported!.responsibility!.id;

  // 2. The founder answers what Foundry cannot observe, until it is understood.
  for (let i = 0; i < 20; i++) {
    const question = await selectFounderEvidenceQuestion(PRODUCT);
    if (!question || question.answerShape === 'resource_amount') break;
    await recordFounderEvidenceAnswer({
      requestId: question.requestId, founderId: OWNER, statement: `How the bakery handles this (${i})`,
    });
  }
  await earnResponsibilityUnderstanding(PRODUCT, responsibilityId);

  // 3. An outside system reports a reading, twice — the second after the
  //    expectation, so the comparison window is honest.
  await query(
    `INSERT INTO metric_snapshots (id,product_id,snapshot_date,support_volume_7d)
     VALUES ('aa_snap',?,date('now','-1 day'),40)`, [PRODUCT]);
  await recordExternalMetricObservations({
    productId: PRODUCT, origin: 'ingest_endpoint', readings: [{ field: 'support_volume_7d', observedValue: 12 }],
  });
  await query(
    `UPDATE signal_events SET created_at=datetime('now','-1 day')
      WHERE product_id=? AND source='external_metric_ingest'`, [PRODUCT]);
});

describe('Shadowing to Assisting through production-facing paths', () => {
  it('does not ask for permission on something it has only been told about', async () => {
    // Understood is not enough. Foundry has not watched anything yet, so it has
    // nothing to show and nothing to ask for.
    expect(await getAssistingCandidates(PRODUCT)).toEqual([]);
    expect(await grantAssistingAuthority({
      productId: PRODUCT, responsibilityId, founderId: OWNER,
    })).toBeNull();
    expect(await countOf('SELECT COUNT(*) n FROM autonomy_consents WHERE product_id=?', [PRODUCT])).toBe(0);
  });

  it('asks only once it has watched, and says exactly what it may and may not do', async () => {
    await beginExternalMetricShadowing({
      productId: PRODUCT, responsibilityId, founderId: OWNER,
      field: 'support_volume_7d', direction: 'fell',
    });
    const expectationId = String(((await query(
      'SELECT id FROM responsibility_shadow_expectations WHERE product_id=?', [PRODUCT]))
      .rows[0] as Record<string, unknown>).id);
    await query("UPDATE responsibility_shadow_expectations SET created_at=datetime(created_at,'-60 seconds') WHERE id=?",
      [expectationId]);
    await recordExternalMetricObservations({
      productId: PRODUCT, origin: 'ingest_endpoint', readings: [{ field: 'support_volume_7d', observedValue: 5 }],
    });
    expect(await resolveExternalMetricShadowing(PRODUCT, expectationId))
      .toMatchObject({ classification: 'matched' });

    const candidates = await getAssistingCandidates(PRODUCT);
    expect(candidates).toHaveLength(1);
    expect(candidates[0]).toMatchObject({ responsibilityId, granted: false });
    expect(candidates[0].comparisons).toBeGreaterThan(0);
    // The permission is described as an effect, not as a mode.
    expect(candidates[0].may).toMatch(/reply to a customer/);
    expect(candidates[0].mayNot).toMatch(/anyone else|spend money/);
    expect(`${candidates[0].may} ${candidates[0].mayNot}`)
      .not.toMatch(/autonomy|autopilot|consent|scope|capability|assisting/i);
  });

  it('grants exact bounded authority and admits — without sending anything', async () => {
    const granted = await grantAssistingAuthority({
      productId: PRODUCT, responsibilityId, founderId: OWNER, durationDays: 30,
    });
    expect(granted).toMatchObject({ admitted: true });
    expect(granted!.responsibility).toMatchObject({ state: 'assisting' });

    // The grant is exactly one product, one responsibility, one capability, one
    // scope, low consequence, with an expiry.
    const consent = (await query(
      'SELECT * FROM autonomy_consents WHERE id=?', [granted!.consentId])).rows[0] as Record<string, unknown>;
    expect(consent).toMatchObject({
      product_id: PRODUCT, responsibility_id: responsibilityId,
      capability: 'customer_support', to_mode: 'act', consequence_boundary: 'low',
    });
    expect(JSON.parse(String(consent.allowed_scope_json))).toEqual(['send_email:support_reply']);
    expect(consent.expires_at).not.toBeNull();
    expect(consent.revoked_at).toBeNull();

    // Admission is not execution. Nothing was planned and nothing was sent.
    expect(await countOf('SELECT COUNT(*) n FROM outbound_actions WHERE product_id=?', [PRODUCT])).toBe(0);
    expect(await countOf('SELECT COUNT(*) n FROM action_executions WHERE product_id=?', [PRODUCT])).toBe(0);
  });

  it('lets the founder withdraw it immediately', async () => {
    expect(await revokeAssistingAuthority({ productId: PRODUCT, responsibilityId, founderId: OWNER })).toBe(true);
    expect(await countOf(
      'SELECT COUNT(*) n FROM autonomy_consents WHERE product_id=? AND revoked_at IS NULL', [PRODUCT])).toBe(0);

    // What Foundry learned while assisting stays true; what it may do does not.
    expect((await query('SELECT state FROM institutional_responsibilities WHERE id=?', [responsibilityId])).rows[0])
      .toMatchObject({ state: 'assisting' });
    const candidates = await getAssistingCandidates(PRODUCT);
    expect(candidates[0]).toMatchObject({ granted: false, grantExpiresAt: null });
  });

  it('refuses a stranger and another tenant', async () => {
    expect(await grantAssistingAuthority({
      productId: PRODUCT, responsibilityId, founderId: STRANGER,
    })).toBeNull();
    expect(await revokeAssistingAuthority({
      productId: PRODUCT, responsibilityId, founderId: STRANGER,
    })).toBe(false);
    expect(await countOf(
      'SELECT COUNT(*) n FROM autonomy_consents WHERE product_id=? AND revoked_at IS NULL', [PRODUCT])).toBe(0);
  });

  it('has real production callers for the authority writer and the admission', () => {
    // The gap was never missing architecture — it was missing writers. The
    // wiring is therefore part of the contract, and this fails if the last
    // caller is removed.
    const walk = (dir: string): string[] => readdirSync(dir).flatMap((entry) => {
      const path = resolve(dir, entry);
      return statSync(path).isDirectory() ? walk(path) : path.endsWith('.ts') ? [path] : [];
    });
    const src = walk(resolve(process.cwd(), 'src'));
    const callers = (symbol: string, definedIn: string): string[] => src
      .filter((f) => !f.endsWith(definedIn))
      .filter((f) => new RegExp(`\\b${symbol}\\b`).test(readFileSync(f, 'utf8')))
      .map((f) => f.replace(process.cwd() + '/', ''));

    expect(callers('recordConsent', 'services/autopilot/consent.ts'))
      .toContain('src/services/institution/assisting-admission.ts');
    expect(callers('enterResponsibilityAssisting', 'services/institution/responsibility-assisting.ts'))
      .toContain('src/services/institution/assisting-admission.ts');
    // And a founder-facing route reaches the grant and the withdrawal.
    const routes = readFileSync(resolve(process.cwd(), 'src/routes/dashboard/letter.ts'), 'utf8');
    expect(routes).toMatch(/grantAssistingAuthority/);
    expect(routes).toMatch(/revokeAssistingAuthority/);
  });
});
