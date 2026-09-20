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
//   npx tsx scripts/owner-review-harness.mts [--port 4320] [--charter] [--searching] [--eyes] [--day N] [--world]
//
// `--charter` signs a live charter first (the owner's next act in production).
// `--searching` opens a search on the owner's first direction, so the steering
// and "find it later" journeys have something to find. `--eyes` opens the proven
// public sources for the owner, as the morning sense check does. `--day N`
// moves the world N days on, so the reviewer returns to it rather than
// meeting it new. The seed itself lives in tests/helpers/world.ts, shared
// with every proof that drives the real entrance.
// =============================================================================
process.env.TURSO_DATABASE_URL = 'file::memory:';
process.env.NODE_ENV = process.env.NODE_ENV ?? 'test';
process.env.FOUNDRY_INSTANCE_POSTURE = 'private_owner';
process.env.FOUNDRY_OWNER_EMAIL = 'owner@example.com';
process.env.ENCRYPTION_KEY = process.env.ENCRYPTION_KEY ?? '0'.repeat(64);

import { serve } from '@hono/node-server';
import { advanceDays, ownerApp, routinesRanThisMorning, seedProductionShape } from '../tests/helpers/world.js';

const args = process.argv.slice(2);
const flag = (name: string): boolean => args.includes(`--${name}`);
const port = Number(args[args.indexOf('--port') + 1] || 4320);
const day = args.includes('--day') ? Number(args[args.indexOf('--day') + 1] || 0) : 0;

async function main(): Promise<void> {
  // NEVER THE REAL INTERNET. In `--world` mode the provider stubs are installed
  // before any provider module is imported (the seed does it); without it the
  // harness runs no provider path at all, and refuses to start if a provider
  // credential is in the environment, since nothing here may reach one.
  const world = flag('world');
  const live = ['CLOUDFLARE_API_TOKEN', 'STRIPE_SECRET_KEY', 'RESEND_API_KEY'].filter((k) => process.env[k]);
  if (!world && live.length) { console.error(`owner-review-harness: ${live.join(', ')} set in the environment; run with --world (stubbed providers) or unset them`); process.exit(2); }
  // THE SAME WORLD THE PROOFS USE (tests/helpers/world.ts): production's
  // shape, moved `--day N` days on so a reviewer can return to it later.
  await seedProductionShape({ charter: flag('charter'), searching: flag('searching'), eyes: flag('eyes'), settledBy: world ? 'the world' : 'the ledger' });
  // He looked before he left: the days that pass are his absence, and the
  // answer to "what happened while I was away" covers them, not seven by default.
  const { markVisit } = await import('../src/services/founder/what-changed.js');
  const { OWNER } = await import('../tests/helpers/world.js');
  await markVisit(OWNER);
  if (day > 0) {
    const moved = await advanceDays(day);
    if (moved.refused.length > 0) console.error(`advanceDays: ${String(moved.refused.length)} constitutional column(s) stayed where they were (expected)`);
    // Foundry kept running while the days passed; what it could not do
    // without providers (look, send, settle) it did not do.
    await routinesRanThisMorning();
  }
  const app = await ownerApp();
  serve({ fetch: app.fetch, port });
  console.log(`owner-review-harness: http://127.0.0.1:${String(port)}/foundry  (owner signed in; day ${String(day)}; Ctrl-C to stop)`);
}

main().catch((e: unknown) => { console.error(e); process.exit(1); });
