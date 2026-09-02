process.env.TURSO_DATABASE_URL = 'file::memory:';
process.env.ENCRYPTION_KEY = '0'.repeat(64);
process.env.FOUNDRY_INSTANCE_POSTURE = 'private_owner';
process.env.FOUNDRY_OWNER_EMAIL = 'owner@example.com';

import { beforeAll, describe, expect, it } from 'vitest';
import { runMigrations } from '../../src/db/migrate.js';
import { query } from '../../src/db/client.js';
import { candidatesFor, openMandate, currentMandate, readVentureParagraph, absorbParagraph }
  from '../../src/services/venture/mandate.js';
import { legalPictureOf, legalSurfaceOf, noteLegalSurface, answerLighter }
  from '../../src/services/venture/legal-surface.js';
import { concentrationsFor } from '../../src/services/founder/resilience.js';
import { whatStandsInTheWay } from '../../src/services/venture/validation.js';
import { establishReferenceCompany } from '../../src/services/reference/world.js';

// =============================================================================
// THE EASIEST LEGAL PROBLEM IS THE ONE NEVER CREATED.
//
// Legal, regulatory and liability exposure is a first-class portfolio
// constraint. Not "avoid every business containing risk": prefer the
// structurally lighter way of producing the same value, see the heavy ones
// early, never let several assets share one legal failure, and know when a
// question has left what Foundry can responsibly answer.
//
// FOUNDRY IS NOT A LAWYER BECAUSE A MODEL CAN DISCUSS LAW. Nothing here is an
// opinion and there is no score. Categories, evidence, uncertainty, severity
// and freshness - and a stop, where a qualified person has to look.
// =============================================================================

const OWNER = 'lgl_owner';

beforeAll(async () => {
  await runMigrations();
  await query('INSERT INTO founders (id,clerk_user_id,email,name) VALUES (?,?,?,?)',
    [OWNER, 'clerk_lgl', 'owner@example.com', 'Owner']);
  for (const key of ['revenue_quietly_falling', 'steady_and_unremarkable',
    'growth_that_is_not_converting', 'customers_leaving_faster']) {
    await establishReferenceCompany({ scenarioKey: key, ownerId: OWNER });
  }
  const opened = await openMandate({
    founderId: OWNER, statement: 'Make the river stronger', shape: null,
    evidenceMode: 'reference' });
  if ('refused' in opened) throw new Error(opened.refused);
});

async function candidate(word: string) {
  const open = await currentMandate(OWNER);
  if (!open) throw new Error('expected a mandate');
  const found = (await candidatesFor(open.id)).find((c) => c.headline.includes(word));
  if (!found) throw new Error(`expected the ${word} candidate`);
  return found;
}

describe('recognising what a candidate creates', () => {
  it('names the exposure, worst first, and whether somebody qualified must look', async () => {
    const vet = await candidate('veterinary');
    const surfaces = await legalSurfaceOf('opportunity', vet.id);
    expect(surfaces[0]?.cls).toBe('professional_reliance');
    expect(surfaces[0]?.severity).toBe('serious');
    // THE STOP. This has left what Foundry should answer, and it says so
    // rather than producing a confident paragraph about veterinary liability.
    expect(surfaces[0]?.needsProfessional).toBe(true);
    expect(vet.inTheWay.join(' ')).toContain('somebody qualified to look');
  });

  it('refuses a serious exposure recorded as if the question were closed', async () => {
    const vet = await candidate('veterinary');
    await expect(noteLegalSurface({
      founderId: OWNER, subjectKind: 'opportunity', subjectId: vet.id,
      cls: 'regulation', severity: 'serious', needsProfessional: false,
      whatItCreates: 'something regulated', evidenceMode: 'reference' }))
      .rejects.toThrow(/serious_needs_a_professional_or_a_reason/);
  });

  it('keeps the lighter architecture as an answer, and blocks until it is asked', async () => {
    const arbitrage = await candidate('arbitrage');
    // Nobody has asked yet.
    await query('UPDATE venture_opportunities SET lighter_architecture = NULL WHERE id = ?',
      [arbitrage.id]);
    const before = await whatStandsInTheWay(arbitrage.id);
    expect(before.join(' ')).toContain('less legal surface');
    await answerLighter({ opportunityId: arbitrage.id,
      answer: 'sell the leads on a flat fee per area, never on a claim about their quality' });
    const after = await whatStandsInTheWay(arbitrage.id);
    expect(after.join(' ')).not.toContain('less legal surface');
  });
});

describe('a shared legal failure', () => {
  it('counts as a concentration by the same arithmetic as a shared channel', async () => {
    const shared = await concentrationsFor(OWNER, 'reference');
    const privacy = shared.find((c) => c.dimension === 'legal_exposure' && c.value === 'privacy_data');
    expect(privacy?.carriedBy.length).toBeGreaterThanOrEqual(4);
    expect(privacy?.ifItFails).toContain('reaches all of them');
  });

  it('tells him a candidate would be one more thing the same rule change reaches', async () => {
    const vet = await candidate('veterinary');
    const picture = await legalPictureOf({ founderId: OWNER, opportunityId: vet.id, world: 'reference' });
    expect(picture.sharedWithPortfolio.some((s) => s.cls === 'privacy_data')).toBe(true);
    expect(picture.profile).toContain('already carry privacy data');
  });

  it('does not count a minor exposure toward anything', async () => {
    const dataset = await candidate('dataset');
    const rows = (await query(
      `SELECT value FROM portfolio_exposures
        WHERE subject_id = ? AND dimension = 'legal_exposure'`, [dataset.id]))
      .rows as unknown as Array<Record<string, unknown>>;
    expect(rows.map((r) => String(r.value))).not.toContain('intellectual_property');
    expect(rows.map((r) => String(r.value))).toContain('licensing');
  });
});

describe('"keep legal risk low" as steering', () => {
  it('lands as a preference on the legal axis and marks what does not meet it', async () => {
    const readings = readVentureParagraph('Keep legal risk low.');
    expect(readings[0]?.kind).toBe('guidance');
    await absorbParagraph({ founderId: OWNER, readings });
    const vet = await candidate('veterinary');
    expect(vet.against.join(' ')).toContain('low legal exposure');
    // A preference, not a prohibition: the candidate is still shown.
    expect(vet.survivesGuidance).toBe(true);
  });
});

describe('freshness', () => {
  it('says when what it knows is over six months old', async () => {
    const dataset = await candidate('dataset');
    await noteLegalSurface({
      founderId: OWNER, subjectKind: 'opportunity', subjectId: dataset.id,
      cls: 'tax_geography', severity: 'material', whatItCreates: 'selling downloads abroad',
      known: 'a merchant of record would carry it',
      observedAt: new Date(Date.now() - 400 * 86_400_000), evidenceMode: 'reference' });
    const picture = await legalPictureOf({ founderId: OWNER, opportunityId: dataset.id, world: 'reference' });
    expect(picture.inTheWay.join(' ')).toContain('over six months old');
  });
});
