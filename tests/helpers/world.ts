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

import { providerStubs, type ProviderState } from './provider-stubs.js';

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
  /** Leave Experiment 001 undecided: deliberated, its people approved, waiting for the owner's tap. */
  undecided?: boolean;
  /**
   * HOW EXPERIMENT 001 COMES TO BE SETTLED. 'the ledger' (the default, and the
   * fast one) writes the result directly, as a proof of the surfaces would. 'the
   * world' runs it as production did: the cohort of 21 with their recorded
   * grounds, the Workshop stood up on stubbed providers, the owner's one act,
   * the hand's mornings — offers placed and sent in stages, 19 delivered and 2
   * bounced, the window closing, the sealed rule settling it surprised. Nothing
   * reaches the internet: the provider stubs are installed on `globalThis.fetch`
   * before any provider module is imported, and handed back for the proof.
   */
  settledBy?: 'the ledger' | 'the world';
  /**
   * Whether the Workshop can hear before the hand writes to anyone. True by
   * default, which is the institution as it must now be; false reproduces the
   * conditions Experiment 001 actually ran under, where nothing could answer.
   */
  earsOpen?: boolean;
  /** The provider stubs to run 'the world' against, when the proof holds its own. */
  providers?: { state: ProviderState; fetch: (url: string | URL, init?: RequestInit) => Promise<Response> };
}

/** What production's Experiment 001 came to: written to, delivered, bounced. */
export const EXPERIMENT_001_IN_THE_WORLD = { written: 21, delivered: 19, bounced: 2 } as const;

/**
 * AND WHAT THE SAME MORNING PRODUCES NOW, which is not the same number.
 *
 * One of production's twenty-one sat at an email address that appears twice on
 * the owner's own list — once under the name a public listing gives it and
 * once under the name the cohort gives it — and one of those two rows was
 * struck. The message went anyway. That is the breach two independent
 * reviewers found, and the door now refuses it, so the world writes to twenty.
 *
 * The historical number above is not edited to match. What happened is what
 * happened; this is what the institution does with the same list today, and
 * the difference between the two is the repair.
 */
export const EXPERIMENT_001_AS_IT_WOULD_RUN_NOW = { written: 20, delivered: 18, bounced: 2 } as const;

export const FIRST_DIRECTION = 'Find low-maintenance digital income opportunities.';

/**
 * PRODUCTION'S SHAPE TODAY: one owner, the Foundry company, the Workshop
 * stood up, Experiment 001 seeded, approved and settled by the world
 * (surprised), every routine having run, the public sources proven. No search
 * of the owner's, no charter, unless asked for.
 */
export async function seedProductionShape(opts: WorldOptions = {}): Promise<{ experimentId: string; providers: WorldOptions['providers'] | null }> {
  const byTheWorld = opts.settledBy === 'the world';
  // THE STUBS GO IN BEFORE ANY PROVIDER MODULE IS IMPORTED, and the env a
  // provider module reads at import is set here too, if it is not already.
  const providers = byTheWorld ? (opts.providers ?? providerStubs()) : null;
  if (providers) {
    globalThis.fetch = providers.fetch as typeof fetch;
    process.env.CLOUDFLARE_API_TOKEN ??= 'cfat_world';
    process.env.CLOUDFLARE_ACCOUNT_ID = 'acct_test'; // the stub answers for this account and no other
    process.env.STRIPE_SECRET_KEY ??= 'sk_test_world';
    process.env.STRIPE_WEBHOOK_SECRET ??= 'whsec_world';
  }
  await runMigrations();
  await query('INSERT INTO founders (id,clerk_user_id,email,name) VALUES (?,?,?,?)',
    [OWNER, 'clerk_wd', 'owner@example.com', 'Thomas Norton']);
  await query(`INSERT INTO products (id,name,owner_id,status,operating_budget_monthly_usd)
    VALUES (?,'Foundry',?,'active',50)`, [COMPANY, OWNER]);
  await query(`INSERT INTO system_identities (identity_key,product_id,established_reason)
    VALUES ('foundry',?,'the world')`, [COMPANY]);

  const { seedProof1 } = await import('../../src/services/venture/proof-1.js');
  const seeded = await seedProof1(OWNER);
  // The Workshop first: tests write as it, from its own address.
  const { establishPublicWorkshop, setPostalAddress } = await import('../../src/services/public-workshop/settings.js');
  const workshop = await establishPublicWorkshop({ founderId: OWNER });
  await setPostalAddress(OWNER, 'Thomas Norton\n11 Apex Drive Suite 300A #361\nMarlborough, MA 01752');
  const { setSendingIdentity } = await import('../../src/services/outbound/sending-identity.js');
  await setSendingIdentity({ productId: COMPANY, provider: 'resend', credential: 're_world', fromEmail: workshop.contactEmail, fromName: workshop.publicName });
  // Its public page, as production carries it: /experiments/ma-millwork-bid-brief.
  const { givePublicIdentity } = await import('../../src/services/public-workshop/identity.js');
  const { PROOF1_PUBLIC, PROOF1_SLUG } = await import('../../src/services/venture/proof-1.js');
  await givePublicIdentity({ experimentId: seeded.experimentId, founderId: OWNER, slug: PROOF1_SLUG, copy: PROOF1_PUBLIC });
  const { approveRemaining } = await import('../../src/services/venture/hand.js');
  await approveRemaining({ founderId: OWNER, experimentId: seeded.experimentId });

  // The thinking behind the test is recorded before the decision, as it was
  // in production: a decision on an unrecorded deliberation is refused.
  const { reconsiderProof1 } = await import('../../src/services/venture/proof-1-deliberation.js');
  await reconsiderProof1(OWNER);
  const { decideExperiment, recordResult } = await import('../../src/services/venture/validation.js');
  if (byTheWorld && providers) {
    await settledByTheWorld(seeded.experimentId, providers, opts);
  } else {
    if (!opts.undecided) {
      await decideExperiment({ experimentId: seeded.experimentId, decision: 'approved', by: `founder:${OWNER}`, via: 'its own authorisation' });
    }
    if (!opts.unsettled && !opts.undecided) {
      await new Promise((r) => { setTimeout(r, 1100); }); // a resolution is after its prediction, by the clock
      await recordResult({ experimentId: seeded.experimentId, asPredicted: false,
        whatHappened: 'nobody bought within the seven days the test allowed.' });
    }
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
  return { experimentId: seeded.experimentId, providers };
}

/**
 * GIVE THE WORKSHOP EARS, for a scenario that writes to people.
 *
 * The hand refuses to write through a path that cannot carry the answer, so a
 * laboratory scenario in which strangers are written to has to stand up an
 * institution that can hear — which is the whole point of the refusal, and the
 * reason this helper exists rather than each scenario reaching around it.
 *
 * The institution will only route mail to an https address; the suite's own
 * APP_URL is a local http one, so it is lent an https address for the length
 * of the call and given back exactly what it had. Nothing is reached: the edge
 * is a stub, and the address is only what the stub is told to hand mail to.
 */
export async function giveTheWorkshopEars(founderId: string = OWNER): Promise<void> {
  const held = process.env.APP_URL;
  if (!(held ?? '').startsWith('https://')) process.env.APP_URL = 'https://foundry.test';
  try {
    const { standUpTheEars } = await import('../../src/services/public-workshop/infrastructure.js');
    await standUpTheEars(founderId);
    // AND THE ROUND TRIP, because a route that is set up is not a route that
    // carries anything — which is the whole of what this campaign learned.
    // The institution refuses to write to strangers until a message sent to
    // its own advertised address has actually arrived, so a world where
    // anybody is written to has to complete that trip. The probe goes out
    // through the real door and comes back through the real intake: the
    // provider stub carries it, and `hearMail` recognises its nonce exactly as
    // it would in production.
    await completeTheReplyRoundTrip(founderId);
  } finally {
    if (held === undefined) delete process.env.APP_URL; else process.env.APP_URL = held;
  }
}

/**
 * SEND THE REPLY-ROUTE CHECK AND DELIVER IT, as the world would.
 *
 * The stub accepts the send; nothing in a laboratory actually routes mail, so
 * the message is handed to the same intake the edge program hands a real one
 * to. What is being exercised here is the institution's half — the send
 * through the governed door, the nonce, the matcher in `hearMail`, the record
 * and the grade — which is the half a test can honestly exercise.
 */
export async function completeTheReplyRoundTrip(founderId: string = OWNER): Promise<void> {
  const { sendReplyProbe, PROBE_SUBJECT } = await import('../../src/services/public-workshop/reply-probe.js');
  const sent = await sendReplyProbe(founderId);
  if (!('sent' in sent)) throw new Error(`the world could not send the reply-route check: ${sent.refused}`);
  const { publicWorkshopOf } = await import('../../src/services/public-workshop/settings.js');
  const w = (await publicWorkshopOf(founderId))!;
  const { hearMail } = await import('../../src/services/public-workshop/mail.js');
  await hearMail({
    founderId, to: w.contactEmail, from: w.contactEmail, subject: PROBE_SUBJECT(sent.nonce),
    body: 'This is an automated check that replies to this address arrive.',
    rfcMessageId: `<probe-${sent.nonce}@apexmicro.ai>`,
  });
}

/**
 * WHAT WENT TO A STRANGER — the provider's log without the Workshop's own
 * reply-route check.
 *
 * The Workshop sends itself one message a day to find out whether a reply to
 * its advertised address arrives. It is an instrument reading, not an offer,
 * and the owner's condition on it was that it stay out of conversations,
 * outreach counts and experiment results. A proof that counts what left the
 * provider and calls the number outreach would quietly break that, so every
 * proof that means outreach says so by reading through here.
 */
export function outreachOnly<T extends { subject: string }>(sends: readonly T[]): T[] {
  return sends.filter((m) => !m.subject.startsWith('[Foundry reply-route check '));
}

/**
 * THE REPLY ROUTE, PROVEN, FOR A FIXTURE THAT ASSEMBLES ITS WORKSHOP BY HAND.
 *
 * `completeTheReplyRoundTrip` is the faithful one: it sends through the
 * governed door and hears the answer through the intake. A suite with no
 * provider stub cannot send, and standing one up to prove a route it is not
 * testing would be a larger fiction than this is. So the attempt is recorded
 * and the arrival goes through the real matcher — the half that decides what
 * the institution believes.
 */
export async function theReplyRouteHasBeenProven(founderId: string = OWNER, route: 'self' | 'external' = 'self'): Promise<void> {
  const { publicWorkshopOf } = await import('../../src/services/public-workshop/settings.js');
  const w = (await publicWorkshopOf(founderId));
  if (!w?.contactEmail) throw new Error('there is no Workshop, so there is no address to prove');
  const { matchProbeArrival, PROBE_SUBJECT } = await import('../../src/services/public-workshop/reply-probe.js');
  const nonce = `fixture${Math.random().toString(36).slice(2, 10)}`;
  await query(
    `INSERT INTO reply_route_probes (id, founder_id, nonce, route, advertised, sent_at) VALUES (?,?,?,?,?,?)`,
    [`rrp_fixture_${nonce}`, founderId, nonce, route, w.contactEmail, new Date().toISOString()]);
  const m = await matchProbeArrival(founderId, PROBE_SUBJECT(nonce));
  if (!m.matched) throw new Error('the matcher did not recognise the check it was given');
}

/** The three routines that carry a test through the world, in the order the morning runs them. */
export const HANDS = ['public_workshop_tick', 'experiment_hand_tick', 'business_outcome_tick'] as const;

/**
 * EXPERIMENT 001 AS PRODUCTION RAN IT, on stubbed providers. The cohort with
 * its grounds (the CLI's own path), the Workshop on the edge, the domain
 * verified, the brief pulled yesterday, the owner's one act, then mornings
 * until the sealed rule settles it: 21 written to, 19 delivered, 2 bounced,
 * nobody paid. Replay fixtures are not touched; this is the hand's own path.
 */
async function settledByTheWorld(experimentId: string, providers: NonNullable<WorldOptions['providers']>, opts: WorldOptions): Promise<void> {
  const { state, fetch } = providers;
  state.domains.push({ id: 'dom_world', name: 'apexmicro.ai', status: 'verified', records: [] });
  const { applyProof1Cohort, amendProof1ForTheCohort } = await import('../../src/services/venture/proof-1-cohort.js');
  const cohort = await applyProof1Cohort(OWNER);
  const { approveRemaining, recordMaterial, materialOf, recipientsOf, reviewRecipient } = await import('../../src/services/venture/hand.js');
  // A COHORT MEMBER AN OLDER, ADDRESSLESS ROW STANDS IN FOR is never silently
  // re-addressed by the cohort; the owner supplied those addresses by hand,
  // which is how production came to write to all twenty-one.
  for (const sh of cohort.shadowed.filter((x) => x.instead === null)) {
    const row = (await recipientsOf(experimentId)).find((r) => r.counterpartyRef === sh.who);
    if (row) await reviewRecipient({ founderId: OWNER, experimentId, recipientId: row.id, decision: 'approved', email: sh.has, reason: 'the address the cohort chose, supplied by hand' });
  }
  await amendProof1ForTheCohort(OWNER);
  await approveRemaining({ founderId: OWNER, experimentId });
  // WHO IS WRITTEN TO IS WHO THE SCREENING COVERS. The seeded candidates the
  // cohort's grounds do not reach are struck, as the owner struck them, so the
  // population is the cohort and nothing else: 21, as production's was.
  for (const r of (await recipientsOf(experimentId)).filter((x) => x.reviewStatus === 'approved' && !x.qualifiedAt)) {
    await reviewRecipient({ founderId: OWNER, experimentId, recipientId: r.id, decision: 'struck', reason: 'no recorded grounds put it in this population' });
  }
  // The goods are fresh at seed: an edition pulled yesterday. The freshness
  // gate exists to bite later, on the world's clock, not at birth.
  const brief = (await materialOf(experimentId, 'deliverable'))!;
  await recordMaterial({ founderId: OWNER, experimentId, kind: 'deliverable', title: brief.title, body: brief.body,
    pulledAt: new Date(Date.now() - 86_400_000), by: 'the world' });
  const { standUpWorkshop } = await import('../../src/services/public-workshop/infrastructure.js');
  await standUpWorkshop(OWNER, fetch as unknown as typeof fetch);
  // AND THE EARS, WHICH PRODUCTION'S EXPERIMENT 001 RAN WITHOUT.
  //
  // This is the one place the world deliberately differs from what happened.
  // Production wrote to nineteen people while the Workshop's reply route was
  // not up, and the institution now refuses to write through a path that
  // cannot carry the answer — so a faithful reproduction of that morning would
  // send nothing at all, and every proof that reads a settled test would have
  // nothing to read.
  //
  // The world therefore models the institution AS IT MUST NOW BE: ears open
  // before anybody is written to. What happened instead is not lost — it is
  // what `the-instrument-is-declared-before-the-world-is-asked` sets up on
  // purpose, by taking the route down, and what a reply path that fails
  // mid-window proves in `was-the-instrument-working`.
  if (opts.earsOpen !== false) await giveTheWorkshopEars(OWNER);
  if (opts.undecided) return;
  const { allowExperiment } = await import('../../src/services/venture/hand.js');
  await allowExperiment({ founderId: OWNER, experimentId });
  if (opts.unsettled) return;
  // Mornings until the world settles it. Deliveries are the provider's word,
  // given as the stub gives it (delivered unless told otherwise before the
  // send): the last two of the cohort bounce, as two of production's did.
  const { PROOF1_COHORT } = await import('../../src/services/venture/proof-1-cohort.js');
  for (const m of PROOF1_COHORT.slice(-EXPERIMENT_001_IN_THE_WORLD.bounced)) state.deliveryState.set(`next:${m.email}`, 'bounced');
  for (let day = 0; day < 14; day++) {
    await advanceDays(1);
    const ran = await runMorning(HANDS);
    const failed = ran.filter((r) => !r.ok);
    if (failed.length) throw new Error(`the world could not run Experiment 001: ${failed.map((f) => `${f.job}: ${f.error ?? ''}`).join('; ')}`);
    const e = (await query('SELECT ran_at FROM venture_experiments WHERE id = ?', [experimentId])).rows[0] as Record<string, unknown>;
    if (e.ran_at != null) break;
  }
  const e = (await query('SELECT ran_at, verdict FROM venture_experiments WHERE id = ?', [experimentId])).rows[0] as Record<string, unknown>;
  if (e.ran_at == null) throw new Error('the world did not settle Experiment 001 within fourteen mornings');
  // WHAT WENT TO A STRANGER, not what left the provider: the Workshop also
  // sends itself a reply-route check every morning, and counting those as
  // businesses written to would make this number a fiction.
  const written = outreachOnly(state.sends).length;
  if (written !== EXPERIMENT_001_AS_IT_WOULD_RUN_NOW.written) {
    const held = (await query(
      `SELECT counterparty_ref, review_status, email FROM experiment_recipients
        WHERE experiment_id = ? AND review_status = 'approved'
          AND id NOT IN (SELECT recipient_id FROM outbound_actions WHERE experiment_id = ? AND recipient_id IS NOT NULL)`,
      [experimentId, experimentId])).rows as unknown as Array<Record<string, unknown>>;
    throw new Error(`the world wrote to ${String(written)} businesses, not ${String(EXPERIMENT_001_AS_IT_WOULD_RUN_NOW.written)}`
      + ` (held back: ${held.map((h) => `${String(h.counterparty_ref)} <${String(h.email)}>`).join(', ') || 'nobody'})`);
  }
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
      // `reconcile_after` is a clock too: the hand polls a receipt only after
      // it, and a day that moved every `_at` but not it left the receipts
      // forever in the future — found by the test that ran a month.
      if (/(_at|_on|_date|_until|_since|_day|_deadline|_expires|_after|_before)$|^(date|until|since|deadline|day|expires_at|when)$/.test(c.name)) {
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
    if (job === 'public_workshop_tick') await theWorldCarriesTheReplyCheck();
  }
  return out;
}

/**
 * THE WORLD CARRIES THE MAIL IT ACCEPTED, unless a test says it does not.
 *
 * The morning's tick sends the reply-route check; in the world outside, the
 * provider then delivers it, the zone routes it and the edge program hands it
 * to the intake. A stub accepts the send and stops there, so without this the
 * laboratory models a route that is permanently broken — and every test that
 * writes to people would be blocked for a reason that is an artefact of the
 * laboratory rather than a fact about the institution.
 *
 * `theWorldStopsCarryingMail()` is how a test models the real failure.
 */
let worldCarriesMail = true;
export function theWorldStopsCarryingMail(): void { worldCarriesMail = false; }
export function theWorldCarriesMailAgain(): void { worldCarriesMail = true; }

async function theWorldCarriesTheReplyCheck(): Promise<void> {
  if (!worldCarriesMail) return;
  const { query } = await import('../../src/db/client.js');
  const waiting = (await query(
    `SELECT founder_id, nonce FROM reply_route_probes
      WHERE arrived_at IS NULL AND refused IS NULL ORDER BY sent_at`)).rows as unknown as Array<Record<string, unknown>>;
  if (waiting.length === 0) return;
  const { PROBE_SUBJECT } = await import('../../src/services/public-workshop/reply-probe.js');
  const { publicWorkshopOf } = await import('../../src/services/public-workshop/settings.js');
  const { hearMail } = await import('../../src/services/public-workshop/mail.js');
  for (const p of waiting) {
    const w = await publicWorkshopOf(String(p.founder_id));
    if (!w?.contactEmail) continue;
    await hearMail({
      founderId: String(p.founder_id), to: w.contactEmail, from: w.contactEmail,
      subject: PROBE_SUBJECT(String(p.nonce)),
      body: 'This is an automated check that replies to this address arrive.',
      rfcMessageId: `<probe-${String(p.nonce)}@${w.zoneName}>`,
    });
  }
}

/**
 * A BUYER WHO PAID, WHOSE DELIVERY FAILED, AND WHOSE REFUND HAS NOT GONE BACK.
 *
 * The obligation the ownership-protection lens looks for, and the only state
 * in which the buyer's own refund link is a page rather than a 404. It lived
 * in the review harness as thirty lines of hand-written rows — a second
 * reading of what a purchase is, in a file no proof ran — so the harness and
 * the proofs could disagree about the shape of a sale and nothing would say
 * so. One fixture, used by both.
 *
 * Needs a world seeded `settledBy: 'the world'`: the purchase is reported at
 * that world's own exposure, through the door a provider's event uses.
 */
export async function aBuyerIsOwedARefund(founderId: string = OWNER): Promise<{ fulfilmentId: string; paymentRef: string }> {
  const { exposureOf, recordBusinessOutcome } = await import('../../src/services/venture/outcome.js');
  const { findProof1 } = await import('../../src/services/venture/proof-1.js');
  const experimentId = (await findProof1(founderId))!;
  const x = (await exposureOf(experimentId))!;
  const ev = await recordBusinessOutcome({ exposureId: x.id, kind: 'payment', amountCents: 2900, currency: 'usd',
    observedAt: new Date(), provider: 'stripe', providerRef: 'pi_harness_1',
    payerReference: 'buyer@example.com', arrivedVia: 'payment_link' });
  if ('refused' in ev) throw new Error(ev.refused);
  await query(`INSERT INTO experiment_fulfilments (id, founder_id, experiment_id, exposure_id, payment_event_id, provider, payment_ref, charge_ref, amount_cents, currency)
               VALUES ('ful_harness_1', ?, ?, ?, ?, 'stripe', 'pi_harness_1', 'ch_harness_1', 2900, 'usd')`,
  [founderId, experimentId, x.id, ev.id]);
  const { record } = await import('../../src/services/economy/ledger.js');
  await record({ founderId, kind: 'charge', amountCents: 2900, currency: 'usd', occurredAt: new Date(),
    provider: 'stripe', providerRef: 'ch_harness_1', sourceEventId: ev.id, fulfilmentId: 'ful_harness_1',
    claimQuality: 'measured', evidenceMode: 'real', because: 'A buyer was charged this, and Stripe said so.' });
  await query(`UPDATE experiment_fulfilments SET status = 'failed', updated_at = datetime('now', '-2 days') WHERE id = 'ful_harness_1'`, []);
  return { fulfilmentId: 'ful_harness_1', paymentRef: 'pi_harness_1' };
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
  // The stylesheet, exactly as the application serves it, so a reviewer sees the product.
  const { resolve } = await import('node:path');
  const { staticAssetHandler } = await import('../../src/routes/public/static-assets.js');
  app.get('/static/:file', staticAssetHandler(resolve(process.cwd(), 'src')) as never);
  // THE SAME SURFACE THE APPLICATION MOUNTS, from the same place it mounts it.
  //
  // This used to list the owner's routers one by one, rebuilding by hand what
  // `src/index.ts` assembles — and it had drifted. Three addresses the product
  // links to from the footer of every page and from Controls (`/letter`,
  // `/settings`, `/privacy`, the last of which is where taking a copy of the
  // data and deleting it live) simply answered 404 in the laboratory. Two
  // independent reviewers reported the exit doors as broken; they are not
  // broken, the laboratory was smaller than the institution it was reviewing.
  //
  // A review instrument that is missing parts of the thing it reviews produces
  // findings that are not true and hides findings that are, which is this
  // campaign's own subject wearing a different coat. `letterRoutes` carries
  // the whole owner surface (it mounts the shell, the places, the experiments,
  // the charter, the Workshop, the Inbox, Economics, the Roadmap, the absence
  // test and Activity, in that order, exactly as production does), so mounting
  // it is one fact rather than ten copies of one.
  app.route('/', (await import('../../src/routes/dashboard/letter.js')).letterRoutes as never);
  app.route('/', (await import('../../src/routes/dashboard/settings.js')).settingsRoutes as never);
  app.route('/', (await import('../../src/routes/dashboard/privacy.js')).privacySettings as never);
  // AND THE BUYER'S DOOR. A customer who paid follows a signed link to ask for
  // their money back; that is a supported journey of this institution and it
  // was not reachable in the laboratory at all, so no review has ever walked
  // it. It is mounted here rather than in a separate app because a reviewer
  // walks one surface, as a person does.
  app.route('/', (await import('../../src/routes/share/index.js')).shareRoutes as never);
  return app as unknown as Hono;
}

/**
 * WHAT PRODUCTION MOUNTS THAT THE LABORATORY DOES NOT, AND WHY.
 *
 * Every entry is a deliberate absence with a reason a person can check. The
 * gate `check-the-laboratory-is-the-institution.mjs` fails when `src/index.ts`
 * mounts a router that is neither mounted above nor named here, so the
 * laboratory cannot quietly shrink again: it already had, and two independent
 * reviewers reported the owner's own exit doors as broken when they were
 * merely absent from the copy they were reviewing.
 *
 * A reason here is a claim about the product, not an excuse. "It is hard to
 * mount" is not one of them.
 */
export const NOT_MOUNTED_IN_THE_LABORATORY: Readonly<Record<string, string>> = Object.freeze({
  landingRoutes: 'the door for somebody who is not signed in; the laboratory is always signed in as the owner, '
    + 'which is the harness\'s one deliberate untruth and is stated here rather than discovered',
  authRoutes: 'signing in and out, which the laboratory does not do for the same reason',
  onboardingRoutes: 'the first-run walk-through for an account that has nothing; the world seeds an owner who is past it',
  ingestRoutes: 'provider webhooks, which arrive as HTTP in production and are driven directly in the '
    + 'laboratory so a proof can say exactly which event it sent',
  healthRoutes: 'what a machine asks about the deployment, not a journey anybody walks',
  ecosystemRoutes: 'the same, for the estate',
  apiV1: 'the programmatic surface; every journey it serves has a page, and the pages are what a review reads',
});

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

/**
 * COMPANIES HE NAMED, THROUGH THE SAME DOOR HE WOULD USE: the Portfolio's
 * "Add it" form. Real companies, nothing connected, nothing acting.
 */
export async function addCompanies(app: Hono, names: string[]): Promise<string[]> {
  const me = owner(app);
  const ids: string[] = [];
  for (const name of names) {
    const r = await me.post('/foundry/companies', { name });
    if (r.status !== 302) throw new Error(`adding "${name}" was not accepted (HTTP ${String(r.status)})`);
    const row = (await query(`SELECT id FROM products WHERE owner_id = ? AND name = ? AND deleted_at IS NULL ORDER BY rowid DESC LIMIT 1`, [OWNER, name])).rows[0] as Record<string, unknown> | undefined;
    if (!row) throw new Error(`"${name}" was not recorded`);
    ids.push(String(row.id));
  }
  return ids;
}

/** A provider outage, as a state of the world the stubs answer from. */
export function outage(state: { resendDown: boolean; stripeDown: boolean; cf: { siteDown: boolean } }, provider: 'resend' | 'stripe' | 'workshop', down: boolean): void {
  if (provider === 'resend') state.resendDown = down;
  else if (provider === 'stripe') state.stripeDown = down;
  else state.cf.siteDown = down;
}
