// =============================================================================
// NO PUBLIC PAGE NAMES THE OWNER — EXPERIMENT 001'S INCLUDED (PENDING 19).
//
// Experiment 001's sealed public copy says "I'm <owner>, and Apex Micro is my
// workshop" under "Who I am". On 8 October 2026 the owner decided: take his
// name off the PUBLIC page, speak there as the Workshop, and leave the sealed
// record exactly as it is. So the name comes off at the projection — the one
// boundary rows cross on their way to the world — and never in the row.
//
// The population is EVERY page the site renders (`renderSite`), from the real
// rows of the production-shaped world, not a hand-picked page. The terms page
// is the one surface the doctrine lets carry his name; it is the only one
// excepted, and it is asserted to still carry it, so the exception cannot
// silently become the whole set.
// =============================================================================
process.env.TURSO_DATABASE_URL = 'file::memory:';
process.env.ENCRYPTION_KEY = '0'.repeat(64);
process.env.FOUNDRY_INSTANCE_POSTURE = 'private_owner';
process.env.FOUNDRY_OWNER_EMAIL = 'owner@example.com';

import { beforeAll, describe, expect, it } from 'vitest';
import { query } from '../../src/db/client.js';
import { OWNER, seedProductionShape } from '../helpers/world.js';
import { PROOF1_PUBLIC, PROOF1_SLUG, findProof1 } from '../../src/services/venture/proof-1.js';
import { APEX_MICRO, publicWorkshopOf } from '../../src/services/public-workshop/settings.js';

const NAME = APEX_MICRO.operatorName;
let X = '';

beforeAll(async () => {
  await seedProductionShape({ charter: true, searching: true, eyes: true, settledBy: 'the world', earsOpen: true });
  X = (await findProof1(OWNER))!;
}, 180_000);

describe('the sealed record is not rewritten', () => {
  it('still carries his name in the row and in the source, word for word', async () => {
    // The precondition that makes the rest meaningful: the name IS in the record.
    expect(PROOF1_PUBLIC.note).toContain(NAME);
    const row = (await query(`SELECT public_note FROM public_experiments WHERE slug = ?`, [PROOF1_SLUG])).rows[0] as Record<string, unknown>;
    expect(String(row.public_note)).toBe(PROOF1_PUBLIC.note);
  });
});

describe('the page the public reads', () => {
  it('Experiment 001 speaks as the Workshop under "Who I am", and the rest of the note is unchanged', async () => {
    const { projectExperiment, workshopFactsOfExperiment } = await import('../../src/services/public-workshop/projection.js');
    const x = (await projectExperiment(X))!;
    expect(x.note).not.toContain(NAME);
    expect(x.note.startsWith(`I'm ${APEX_MICRO.publicName}, a small workshop.`)).toBe(true);
    // Only the naming sentence changes; everything after it is the sealed text.
    expect(x.note).toContain(PROOF1_PUBLIC.note.slice(PROOF1_PUBLIC.note.indexOf('I build small')));
    const { renderExperiment } = await import('../../src/services/public-workshop/site.js');
    const html = renderExperiment((await workshopFactsOfExperiment(X))!, x);
    expect(html).toContain('Who I am');
    expect(html).not.toContain(NAME);
  });

  it('every page the site renders is free of his name, but the terms page', async () => {
    const { renderSite } = await import('../../src/services/public-workshop/site.js');
    const { projectRegistry, workshopFacts } = await import('../../src/services/public-workshop/projection.js');
    const site = renderSite(workshopFacts((await publicWorkshopOf(OWNER))!), await projectRegistry(OWNER));
    // Vacuity: the population includes Experiment 001's page, and the terms page.
    expect([...site.keys()]).toContain(`/experiments/${PROOF1_SLUG}`);
    expect(site.get('/terms')).toContain(NAME);
    const naming = [...site].filter(([path, html]) => path !== '/terms' && html.includes(NAME)).map(([p]) => p);
    expect(naming).toEqual([]);
  });
});

describe('the rule, as a function', () => {
  it('takes any spelling of the full name off, and leaves a text without it byte-identical', async () => {
    const { withoutTheOwner } = await import('../../src/services/public-workshop/projection.js');
    const w = { operatorName: NAME, publicName: APEX_MICRO.publicName };
    expect(withoutTheOwner(`Written by ${NAME.toUpperCase()}.`, w)).toBe(`Written by ${APEX_MICRO.publicName}.`);
    expect(withoutTheOwner(`I’m ${NAME}, and Apex Micro is my workshop. Hi.`, w)).toBe(`I'm ${APEX_MICRO.publicName}, a small workshop. Hi.`);
    const clean = 'A town called Norton is not a person.';
    expect(withoutTheOwner(clean, w)).toBe(clean);
    expect(withoutTheOwner(PROOF1_PUBLIC.summary, w)).toBe(PROOF1_PUBLIC.summary);
  });
});
