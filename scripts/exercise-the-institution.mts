// =============================================================================
// FOUNDRY — run the institution against a company that does not exist
//
// CONTROLLED PROOF, MADE VISIBLE. The constitution distinguishes BUILT from
// CONTROLLED-PROVEN from REALITY-PROVEN, and the middle one is the level this
// answers: put a reference company in front of the institution and report, in
// plain terms, what it actually did with it. Not whether the code compiles —
// what it NOTICED, what it PROPOSED, and where the chain stops.
//
// The value is in the stopping. Every rung that turns out to be unreachable is
// a thing the owner would have discovered by entrusting a real company to it,
// which is the expensive way to find out.
//
// WHAT THIS IS NOT. It is not evidence about any real company, it produces no
// claim about the world, and nothing it observes is admissible as owner truth —
// migrations 222 and 223 make that structural rather than a promise made here.
//
//   npx tsx scripts/exercise-the-institution.mts
// =============================================================================

process.env.TURSO_DATABASE_URL = 'file::memory:';
process.env.ENCRYPTION_KEY = '0'.repeat(64);
process.env.FOUNDRY_INSTANCE_POSTURE = 'private_owner';
process.env.FOUNDRY_OWNER_EMAIL = 'owner@example.com';

import { runMigrations } from '../src/db/migrate.js';
import { query } from '../src/db/client.js';
import { establishReferenceCompany, advanceReferenceWorld } from '../src/services/reference/world.js';

const OWNER = 'ex_owner';

async function count(sql: string, args: unknown[] = []): Promise<number> {
  return Number(((await query(sql, args)).rows[0] as Record<string, unknown>).n);
}

function say(step: string, detail: string): void {
  console.log(`  ${step.padEnd(46)} ${detail}`);
}

async function main(): Promise<void> {
  await runMigrations();
  await query('INSERT INTO founders (id,clerk_user_id,email,name) VALUES (?,?,?,?)',
    [OWNER, 'ex_clerk', 'owner@example.com', 'Owner']);

  console.log('\nESTABLISH');
  const company = await establishReferenceCompany({
    scenarioKey: 'revenue_quietly_falling', ownerId: OWNER,
  });
  if (!company) throw new Error('the scenario did not resolve');
  const P = company.productId;
  say('company', `${company.scenario.companyName} — ${company.scenario.situation}`);
  say('history', `${String(await count(
    'SELECT COUNT(*) AS n FROM metric_snapshots WHERE product_id=?', [P]))} days of snapshots`);
  say('observations of that history',
    `${String(await count("SELECT COUNT(*) AS n FROM signal_events WHERE product_id=?", [P]))}`
    + '  (nobody watched them happen)');

  console.log('\nONE DAY THROUGH THE FRONT DOOR');
  const advanced = await advanceReferenceWorld(P);
  say('POST /ingest/:token', `HTTP ${String(advanced?.status ?? 0)}, day ${String(advanced?.day ?? 0)}`);
  const observed = (await query(
    `SELECT source, event_type FROM signal_events WHERE product_id=? ORDER BY id`, [P]))
    .rows as unknown as Array<Record<string, unknown>>;
  say('independent observations recorded', String(observed.length));
  for (const o of observed.slice(0, 6)) say(`  ${String(o.source)}`, String(o.event_type));
  if (observed.length > 6) say('  …', `${String(observed.length - 6)} more`);

  console.log('\nWHAT THE INSTITUTION DOES WITH IT');
  const { noticeWhatTheNumbersAreDoing } = await import(
    '../src/services/institution/noticing.js');
  const noticed = await noticeWhatTheNumbersAreDoing(P);
  say('movements it thought worth asking about', String(noticed.length));
  for (const n of noticed) {
    say(`  ${n.channel}`,
      `"${n.responsibility}" (${n.movement > 0 ? '+' : ''}${String(Math.round(n.movement * 100))}%)`);
  }
  const pending = (await query(
    `SELECT proposed_responsibility, rationale, status FROM responsibility_candidates
      WHERE product_id=? ORDER BY rowid`, [P]))
    .rows as unknown as Array<Record<string, unknown>>;
  say('candidates awaiting the owner', String(pending.filter((r) => r.status === 'pending').length));

  const { runInstitutionalJudgmentPass } = await import(
    '../src/services/institution/institutional-judgment.js');
  const pass = await runInstitutionalJudgmentPass(P);
  say('judgment pass', pass.raised ? `raised: ${JSON.stringify(pass)}` : 'raised nothing');

  const { getShadowableResponsibilities, getUnwatchableResponsibilities } = await import(
    '../src/services/institution/external-shadowing.js');
  const shadowable = await getShadowableResponsibilities(P);
  const unwatchable = await getUnwatchableResponsibilities(P);
  say('responsibilities it could shadow', String(shadowable.length));
  say('responsibilities it cannot watch', String(unwatchable.length));

  const { availableObservationChannels } = await import(
    '../src/services/institution/external-observation.js');
  const channels = await availableObservationChannels(P);
  say('live observation channels', channels.length ? channels.join(', ') : 'none');

  const responsibilities = (await query(
    `SELECT title, state FROM institutional_responsibilities WHERE product_id=?`, [P]))
    .rows as unknown as Array<Record<string, unknown>>;
  say('responsibilities it holds', String(responsibilities.length));
  for (const r of responsibilities) say(`  ${String(r.title)}`, String(r.state));

  console.log('\nWHAT IT WOULD ASK HIM');
  for (const p of pending) say('', `${String(p.proposed_responsibility)} — ${String(p.rationale)}`);

  console.log('\nWHAT THE OWNER WOULD SEE');
  const { whatTheNumbersSay } = await import('../src/services/founder/what-the-numbers-say.js');
  const numbers = await whatTheNumbersSay(P);
  for (const n of numbers.numbers) say('', n.sentence);

  console.log('\nWHERE THE CHAIN STOPS');
  const stops: string[] = [];
  if (channels.length === 0) stops.push('no observation channel is live, so Shadowing cannot begin');
  if (responsibilities.length === 0 && noticed.length === 0) {
    stops.push('the institution holds no responsibility for this company and noticed '
      + 'nothing worth asking about, so there is nothing for a channel to test');
  }
  if (responsibilities.length === 0 && noticed.length > 0) {
    stops.push(`${String(noticed.length)} candidate(s) are waiting on the owner. That is `
      + 'the design: recognition is his act, and nothing climbs the ladder until he makes it');
  }
  if (shadowable.length === 0 && responsibilities.length > 0) {
    stops.push('no responsibility is both understood and watchable');
  }
  if (stops.length === 0) console.log('  nothing — the ladder is reachable from here');
  for (const s of stops) console.log(`  • ${s}`);
  console.log('');
  process.exit(0);
}

main().catch((err) => { console.error(err); process.exit(1); });
