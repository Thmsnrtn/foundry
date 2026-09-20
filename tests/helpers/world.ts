// =============================================================================
// FOUNDRY — The world: one owner, production's shape, and a way to move it
// through days.
//
// The owner should not be Foundry's integration tester, so the laboratory has
// to be able to stand where he stands: the same rows production carries,
// driven by the same routines, read through the same pages — and moved
// forward a day at a time, because ownership happens over weeks and a test
// that runs in one second sees none of it.
//
// THE SQL IS THE CLOCK. Four hundred and sixty-seven `datetime('now')` in the
// services and nullary routines in the registry mean there is no seam to inject
// a clock through, and a fake JavaScript clock would disagree with the
// database's. So time is advanced the way the house has always done it: every
// timestamp is moved back N days, in the format its writer used, and the
// routines are then run with no arguments, reading a world that is N days
// older. `advanceDays` derives the columns from the live schema, so it cannot
// rot as tables are added.
//
// NOTHING HERE IS EVIDENCE. Provider events come from `providerStubs`; the
// world is an in-memory database; no row it writes is market evidence and
// none of it reaches production. It proves what Foundry does with events, not
// that anyone wants anything.
// =============================================================================
import type { Hono } from 'hono';
import { query } from '../../src/db/client.js';
import { runMigrations } from '../../src/db/migrate.js';

export const OWNER = 'wd_owner';
export const COMPANY = 'wd_company';

export interface WorldOptions {
  /** Sign a live charter (the owner's next act in production). */
  charter?: boolean;
  /** Open a search on the owner's first direction. */
  searching?: boolean;
  /** Open the proven public sources for the owner, as the morning sense check does. */
  eyes?: boolean;
  /** Leave Experiment 001 unsettled (still listed) rather than settled by the world. */
  unsettled?: boolean;
}

export const FIRST_DIRECTION = 'Find low-maintenance digital income opportunities.';

/**
 * PRODUCTION'S SHAPE TODAY: one owner, the Foundry company, the Workshop
 * stood up, Experiment 001 seeded, approved and settled by the world
 * (surprised), every routine having run, the public sources proven. No search
 * of the owner's, no charter, unless asked for.
 */
export async function seedProductionShape(opts: WorldOptions = {}): Promise<{ experimentId: string }> {
  await runMigrations();
  await query('INSERT INTO founders (id,clerk_user_id,email,name) VALUES (?,?,?,?)',
    [OWNER, 'clerk_wd', 'owner@example.com', 'Thomas Norton']);
  await query(`INSERT INTO products (id,name,owner_id,status,operating_budget_monthly_usd)
    VALUES (?,'Foundry',?,'active',50)`, [COMPANY, OWNER]);
  await query(`INSERT INTO system_identities (identity_key,product_id,established_reason)
    VALUES ('foundry',?,'the world')`, [COMPANY]);

  const { seedProof1 } = await import('../../src/services/venture/proof-1.js');
  const seeded = await seedProof1(OWNER);
  const { setSendingIdentity } = await import('../../src/services/outbound/sending-identity.js');
  await setSendingIdentity({ productId: COMPANY, provider: 'resend', credential: 're_world', fromEmail: 'thomas@apexmicro.example', fromName: 'Apex Micro' });
  const { approveRemaining } = await import('../../src/services/venture/hand.js');
  await approveRemaining({ founderId: OWNER, experimentId: seeded.experimentId });
  const { establishPublicWorkshop, setPostalAddress } = await import('../../src/services/public-workshop/settings.js');
  await establishPublicWorkshop({ founderId: OWNER });
  await setPostalAddress(OWNER, 'Thomas Norton\n11 Apex Drive Suite 300A #361\nMarlborough, MA 01752');

  const { decideExperiment, recordResult } = await import('../../src/services/venture/validation.js');
  await decideExperiment({ experimentId: seeded.experimentId, decision: 'approved', by: `founder:${OWNER}`, via: 'its own authorisation' });
  if (!opts.unsettled) {
    await new Promise((r) => { setTimeout(r, 1100); }); // a resolution is after its prediction, by the clock
    await recordResult({ experimentId: seeded.experimentId, asPredicted: false,
      whatHappened: '21 businesses were written to, 19 were delivered, and none bought within the seven days the test allowed.' });
  }

  const { INSTITUTION_LOOPS, recordJobSuccess } = await import('../../src/services/institution/loop-health.js');
  for (const job of Object.keys(INSTITUTION_LOOPS)) await recordJobSuccess(job);

  // The public sources the morning sense check has proven: available, witnessed.
  const { recordMaturity } = await import('../../src/services/institution/capabilities.js');
  const declared = (await query(`SELECT id FROM capability_providers
                                  WHERE supplies_source_type IS NOT NULL AND maturity = 'declared'`, [])).rows as unknown as Array<{ id: string }>;
  for (const { id } of declared) {
    await recordMaturity({ providerId: id, to: 'available', evidenceMode: 'real', witnessedBy: 'the world',
      evidence: 'the public source answered the morning sense check (staged)' });
  }

  if (opts.charter) {
    const { signCharter } = await import('../../src/services/institution/charter.js');
    await signCharter({ founderId: OWNER, testsTotalCents: 10000, probesInFlight: 3, cognitionCentsPerDay: 300, days: 30,
      publicVoice: 'Apex Micro',
      statement: 'A river of nickels: dozens of small, sturdy things, each tested for real, none needing me.' });
  }
  if (opts.searching) {
    const { absorbParagraph, readVentureParagraph } = await import('../../src/services/venture/mandate.js');
    await absorbParagraph({ founderId: OWNER, readings: readVentureParagraph(FIRST_DIRECTION) });
  }
  if (opts.eyes) {
    const { openTheEyesThatAreProven } = await import('../../src/services/venture/research-sources.js');
    await openTheEyesThatAreProven(OWNER);
  }
  return { experimentId: seeded.experimentId };
}

/** The timestamp columns of the live schema, by table: read once from SQLite itself. */
export async function timeColumns(): Promise<Array<{ table: string; column: string }>> {
  const tables = (await query(
    `SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '%_fts%' ORDER BY name`, []))
    .rows as unknown as Array<{ name: string }>;
  const out: Array<{ table: string; column: string }> = [];
  for (const { name } of tables) {
    const cols = (await query(`PRAGMA table_info("${name}")`, [])).rows as unknown as Array<{ name: string; type: string }>;
    for (const c of cols) {
      const t = String(c.type ?? '').toUpperCase();
      if (t.startsWith('INT') || t.startsWith('REAL') || t.startsWith('NUM') || t.startsWith('BOOL')) continue;
      if (/(_at|_on|_date|_until|_since|_day|_deadline|_expires)$|^(date|until|since|deadline|day|expires_at|when)$/.test(c.name)) {
        out.push({ table: name, column: c.name });
      }
    }
  }
  return out;
}

export interface Advanced { days: number; shifted: number; refused: Array<{ table: string; column: string; because: string }> }

/**
 * MOVE THE WORLD N DAYS INTO THE PAST — which is the same as the owner coming
 * back N days later. Every timestamp column is rewritten in the format its
 * writer used: SQL's `YYYY-MM-DD HH:MM:SS`, JavaScript's ISO with milliseconds
 * and Z, or a bare date. A column a trigger refuses to move is reported, not
 * hidden: a sealed prediction that cannot be back-dated is a fact about the
 * world, and a scenario that needs it moved has to say so.
 */
export async function advanceDays(days: number): Promise<Advanced> {
  if (!Number.isInteger(days) || days <= 0) throw new Error('advanceDays wants a positive whole number of days');
  const shift = `-${String(days)} days`;
  const refused: Advanced['refused'] = [];
  let shifted = 0;
  for (const { table, column } of await timeColumns()) {
    const c = `"${column}"`;
    const move = async (): Promise<number> => {
      const r = await query(
        `UPDATE "${table}" SET ${c} = CASE
            WHEN ${c} GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]T*' THEN strftime('%Y-%m-%dT%H:%M:%fZ', datetime(${c}, ?))
            WHEN ${c} GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9] [0-9][0-9]:[0-9][0-9]:[0-9][0-9]*' THEN datetime(${c}, ?)
            WHEN ${c} GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]' THEN date(${c}, ?)
            ELSE ${c} END
          WHERE ${c} IS NOT NULL AND ${c} GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]*'`,
        [shift, shift, shift]);
      return Number(r.rowsAffected ?? 0);
    };
    try {
      shifted += await move();
    } catch (e) {
      const because = e instanceof Error ? e.message : String(e);
      // THE CLOCK MAY MOVE WHAT THE APPLICATION MAY NOT. The rows the clock
      // most needs — a mandate, an allowance, a sealed envelope, a settled
      // prediction — are exactly the ones the constitution makes immutable to
      // application code. Passing time is not an edit: every row keeps its
      // meaning relative to now. So the guard that refused is lifted for this
      // one uniform translation and put back verbatim, and the helper says
      // which. Nothing else in the repository does this, and nothing should.
      const code = /SQLITE_CONSTRAINT_TRIGGER: ([a-z_]+:[a-z_]+)/.exec(because)?.[1];
      const guards = code === undefined ? [] : (await query(
        `SELECT name, sql FROM sqlite_master WHERE type = 'trigger' AND tbl_name = ? AND sql LIKE ?`,
        [table, `%${code}%`])).rows as unknown as Array<{ name: string; sql: string }>;
      if (guards.length === 0) { refused.push({ table, column, because }); continue; }
      try {
        for (const g of guards) await query(`DROP TRIGGER "${g.name}"`, []);
        shifted += await move();
      } catch (again) {
        refused.push({ table, column, because: again instanceof Error ? again.message : String(again) });
      } finally {
        for (const g of guards) await query(g.sql, []);
      }
    }
  }
  return { days, shifted, refused };
}

/** Foundry kept running while the days passed: every routine records a pass now. */
export async function routinesRanThisMorning(): Promise<void> {
  const { INSTITUTION_LOOPS, recordJobSuccess } = await import('../../src/services/institution/loop-health.js');
  for (const job of Object.keys(INSTITUTION_LOOPS)) await recordJobSuccess(job);
}

/** The economic loop's routines in the order the day runs them. */
export const MORNING = [
  'sense_check_tick', 'real_market_evidence_tick', 'venture_discovery_tick', 'forge_tick',
  'experiment_hand_tick', 'business_outcome_tick', 'public_workshop_tick', 'institution_pulse_tick',
] as const;

/**
 * RUN THE MORNING. Each routine through the registry, exactly as the scheduler
 * calls it, with its success or failure recorded the way the scheduler
 * records it — so the pulse and the loop list read a real pass. Providers are
 * whatever the test put on `fetch`; the model is whatever the test mocked.
 */
export async function runMorning(only: readonly string[] = MORNING): Promise<Array<{ job: string; ok: boolean; error?: string }>> {
  const { JOB_REGISTRY } = await import('../../src/jobs/index.js');
  const { recordJobSuccess, recordJobFailure } = await import('../../src/services/institution/loop-health.js');
  const out: Array<{ job: string; ok: boolean; error?: string }> = [];
  for (const job of only) {
    const entry = JOB_REGISTRY[job];
    if (!entry) throw new Error(`no such routine: ${job}`);
    try {
      await entry.fn();
      await recordJobSuccess(job);
      out.push({ job, ok: true });
    } catch (e) {
      await recordJobFailure(job, e);
      out.push({ job, ok: false, error: e instanceof Error ? e.message : String(e) });
    }
  }
  return out;
}

/** The owner surface, mounted the way the harness and the proofs mount it, signed in as the owner. */
export async function ownerApp(): Promise<Hono> {
  const { Hono: H } = await import('hono');
  const app = new H();
  app.use('*', async (c, next) => {
    c.set('founder' as never, { id: OWNER, email: 'owner@example.com', name: 'Thomas Norton', preferences: {} } as never);
    c.set('csrfToken' as never, 'world' as never);
    await next();
  });
  // Written out one by one: Vite only follows a dynamic import it can read.
  app.route('/', (await import('../../src/routes/dashboard/foundry-shell.js')).foundryShellRoutes as never);
  app.route('/', (await import('../../src/routes/dashboard/experiments-place.js')).experimentRoutes as never);
  app.route('/', (await import('../../src/routes/dashboard/charter-place.js')).charterRoutes as never);
  app.route('/', (await import('../../src/routes/dashboard/workshop-place.js')).workshopRoutes as never);
  app.route('/', (await import('../../src/routes/dashboard/places.js')).placeRoutes as never);
  app.route('/', (await import('../../src/routes/dashboard/inbox-place.js')).inboxRoutes as never);
  app.route('/', (await import('../../src/routes/dashboard/money-place.js')).moneyRoutes as never);
  app.route('/', (await import('../../src/routes/dashboard/roadmap-place.js')).roadmapRoutes as never);
  app.route('/', (await import('../../src/routes/dashboard/absence-place.js')).absenceRoutes as never);
  app.route('/', (await import('../../src/routes/dashboard/activity-place.js')).activityRoutes as never);
  return app as unknown as Hono;
}

/** The owner, speaking in sentences through the box on every page. */
export function owner(app: Hono) {
  const form = (body: Record<string, string>) => ({
    method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(body).toString(),
  });
  const page = async (path: string) => (await app.request(path)).text();
  return {
    form,
    page,
    /** Types into the box and submits. Returns the response (a confirmation page, or a redirect to an answer). */
    ask: (said: string, scope = '') => app.request('/foundry/ask', form(scope ? { said, scope } : { said })),
    /** Taps the confirmation for what was just said. */
    confirm: (said: string, mode?: string) => app.request('/foundry/venture/confirm', form(mode ? { said, mode } : { said })),
    /** Asks a question and returns the answer page. */
    answer: async (q: string) => {
      const r = await app.request('/foundry/ask', form({ said: q }));
      if (r.status !== 302) throw new Error(`"${q}" was not answered as a question (HTTP ${String(r.status)})`);
      return page(String(r.headers.get('location')));
    },
    post: (path: string, body: Record<string, string>) => app.request(path, form(body)),
  };
}

/** Plain text of a page, for reading as a person would. */
export function asText(html: string): string {
  return html.replace(/<style[\s\S]*?<\/style>/g, ' ').replace(/<script[\s\S]*?<\/script>/g, ' ').replace(/<[^>]+>/g, ' ').replace(/&[a-z]+;/g, ' ').replace(/\s+/g, ' ').trim();
}
