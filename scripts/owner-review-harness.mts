// =============================================================================
// FOUNDRY — The owner-review harness: the product, as a person meets it.
//
// The owner should not be Foundry's primary integration tester. This starts
// the owner surface against an in-memory database seeded in PRODUCTION'S SHAPE
// TODAY — one owner, the Foundry company, the Workshop stood up, Experiment
// 001 run and settled by the world, the routines all having run, no search
// open and no charter signed — and keeps it running so an independent reviewer
// can attempt an ordinary owner objective through the real pages, in a real
// browser, before reading any code.
//
// Deliberately NOT part of `npm run check`: it is a stage, not a gate. The
// regression proofs that come out of a review are the gate.
//
//   npx tsx scripts/owner-review-harness.mts [--port 4320] [--charter] [--searching] [--eyes]
//
// `--charter` signs a live charter first (the owner's next act in production).
// `--searching` opens a search on the owner's first direction, so the steering
// and "find it later" journeys have something to find. `--eyes` opens the proven
// public sources for the owner, as the morning sense check does.
// =============================================================================
process.env.TURSO_DATABASE_URL = 'file::memory:';
process.env.NODE_ENV = process.env.NODE_ENV ?? 'test';
process.env.FOUNDRY_INSTANCE_POSTURE = 'private_owner';
process.env.FOUNDRY_OWNER_EMAIL = 'owner@example.com';
process.env.ENCRYPTION_KEY = process.env.ENCRYPTION_KEY ?? '0'.repeat(64);

import { serve } from '@hono/node-server';
import { Hono } from 'hono';
import { resolve } from 'node:path';
import { runMigrations } from '../src/db/migrate.js';
import { query } from '../src/db/client.js';

const OWNER = 'rv_owner';
const COMPANY = 'rv_company';
const args = process.argv.slice(2);
const flag = (name: string): boolean => args.includes(`--${name}`);
const port = Number(args[args.indexOf('--port') + 1] || 4320);

async function seed(): Promise<void> {
  await runMigrations();
  await query('INSERT INTO founders (id,clerk_user_id,email,name) VALUES (?,?,?,?)',
    [OWNER, 'clerk_rv', 'owner@example.com', 'Thomas Norton']);
  await query(`INSERT INTO products (id,name,owner_id,status,operating_budget_monthly_usd)
    VALUES (?,'Foundry',?,'active',50)`, [COMPANY, OWNER]);
  await query(`INSERT INTO system_identities (identity_key,product_id,established_reason)
    VALUES ('foundry',?,'review harness')`, [COMPANY]);

  // Experiment 001, as production carries it: seeded, its recipients approved,
  // sent, and settled by the world — surprised.
  const { seedProof1 } = await import('../src/services/venture/proof-1.js');
  const seeded = await seedProof1(OWNER);
  const { setSendingIdentity } = await import('../src/services/outbound/sending-identity.js');
  await setSendingIdentity({ productId: COMPANY, provider: 'resend', credential: 're_review', fromEmail: 'thomas@apexmicro.example', fromName: 'Apex Micro' });
  const { approveRemaining } = await import('../src/services/venture/hand.js');
  await approveRemaining({ founderId: OWNER, experimentId: seeded.experimentId });
  const { establishPublicWorkshop, setPostalAddress } = await import('../src/services/public-workshop/settings.js');
  await establishPublicWorkshop({ founderId: OWNER });
  await setPostalAddress(OWNER, 'Thomas Norton\n11 Apex Drive Suite 300A #361\nMarlborough, MA 01752');
  const { decideExperiment, recordResult } = await import('../src/services/venture/validation.js');
  try {
    await decideExperiment({ experimentId: seeded.experimentId, decision: 'approved', by: `founder:${OWNER}`, via: 'its own authorisation' });
    await new Promise((r) => { setTimeout(r, 1100); }); // a resolution is after its prediction, by the clock
    await recordResult({ experimentId: seeded.experimentId, asPredicted: false,
      whatHappened: '21 businesses were written to, 19 were delivered, and none bought within the seven days the test allowed.' });
  } catch (e) {
    console.error('Experiment 001 could not be settled in the harness:', (e as Error).message);
  }
  try {
    await query(`UPDATE venture_experiments SET ran_at = datetime('now','-1 day') WHERE id = ?`, [seeded.experimentId]);
  } catch { /* a settled row may refuse a rewrite; the harness does not insist */ }

  // The routines all ran, so Home says the true thing about the loop.
  const { INSTITUTION_LOOPS, recordJobSuccess } = await import('../src/services/institution/loop-health.js');
  for (const job of Object.keys(INSTITUTION_LOOPS)) await recordJobSuccess(job);

  if (flag('charter')) {
    const { signCharter } = await import('../src/services/institution/charter.js');
    await signCharter({ founderId: OWNER, testsTotalCents: 10000, probesInFlight: 3, cognitionCentsPerDay: 300, days: 30,
      publicVoice: 'Apex Micro',
      statement: 'A river of nickels: dozens of small, sturdy things, each tested for real, none needing me.' });
  }
  // The public sources the morning sense check has proven, as production
  // carries them after a day: available, so a search has somewhere to look.
  const { recordMaturity } = await import('../src/services/institution/capabilities.js');
  const declared = (await query(`SELECT id FROM capability_providers
                                  WHERE supplies_source_type IS NOT NULL AND maturity = 'declared'`, [])).rows as unknown as Array<{ id: string }>;
  for (const { id } of declared) {
    await recordMaturity({ providerId: id, to: 'available', evidenceMode: 'real', witnessedBy: 'owner-review-harness',
      evidence: 'the public source answered the morning sense check (staged for review)' });
  }

  if (flag('searching')) {
    const { absorbParagraph, readVentureParagraph } = await import('../src/services/venture/mandate.js');
    await absorbParagraph({ founderId: OWNER, readings: readVentureParagraph('Find low-maintenance digital income opportunities.') });
  }
  if (flag('eyes')) {
    // What the 05:40 sense check would do for anyone searching: open the proven eyes.
    const { openTheEyesThatAreProven } = await import('../src/services/venture/research-sources.js');
    await openTheEyesThatAreProven(OWNER);
  }
}

async function main(): Promise<void> {
  await seed();
  const app = new Hono();
  app.use('*', async (c, next) => {
    c.set('founder' as never, { id: OWNER, email: 'owner@example.com', name: 'Thomas Norton' } as never);
    c.set('csrfToken' as never, 'review' as never);
    await next();
  });
  const { staticAssetHandler } = await import('../src/routes/public/static-assets.js');
  app.get('/static/:file', staticAssetHandler(resolve(import.meta.dirname, '../src')) as never);
  for (const [file, name] of [
    ['foundry-shell', 'foundryShellRoutes'], ['experiments-place', 'experimentRoutes'], ['charter-place', 'charterRoutes'],
    ['workshop-place', 'workshopRoutes'], ['places', 'placeRoutes'], ['inbox-place', 'inboxRoutes'], ['money-place', 'moneyRoutes'],
    ['roadmap-place', 'roadmapRoutes'], ['absence-place', 'absenceRoutes'], ['activity-place', 'activityRoutes'],
  ] as const) {
    const mod = await import(`../src/routes/dashboard/${file}.js`) as Record<string, unknown>;
    app.route('/', mod[name] as never);
  }
  serve({ fetch: app.fetch, port });
  console.log(`owner-review-harness: http://127.0.0.1:${String(port)}/foundry  (owner signed in; Ctrl-C to stop)`);
}

main().catch((e: unknown) => { console.error(e); process.exit(1); });
