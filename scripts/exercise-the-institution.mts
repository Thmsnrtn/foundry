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

  console.log('\nWHAT IT CAN AND CANNOT SEE');
  const senseSystem = await import('../src/services/senses/index.js');
  for (const sense of await senseSystem.connectedSenses(P)) {
    say(`  ${sense.wouldLearn}`,
      `${senseSystem.providerName(sense.provider)} (${sense.mode})`
      + `${sense.lastObservedAt ? ', reporting' : ', silent'}`);
  }
  for (const gap of await senseSystem.whatItCannotSee(P)) {
    say(`  cannot see ${gap.cannotSee}`,
      gap.offers.length
        ? `${[...new Set(gap.offers.map((o) => senseSystem.providerName(o.provider)))].join(' or ')} could`
        : 'nothing could');
  }

  console.log('\nWHAT SITUATION IT IS IN');
  const { whatSituation } = await import('../src/services/founder/what-situation.js');
  const situation = await whatSituation(P);
  say(situation.situation, situation.headline);
  for (const reason of situation.because) say('', reason);

  // THE ASSEMBLED INSTITUTION, END TO END. Each step is the production path,
  // and the point of running them in one place is that a chain nobody walks
  // whole is a chain with a break somewhere nobody has stood.
  //
  // ON A REAL COMPANY, DELIBERATELY. The reference company is refused at the
  // outbound door for a stronger reason than any boundary — it does not exist,
  // so nothing it does may reach a person — and walking the ask-first chain
  // there would prove the wrong thing. That refusal is shown first, because it
  // is the guarantee everything else rests on.
  console.log('\nTHE WHOLE CHAIN, WALKED');
  const intent = await import('../src/services/institution/standing-intent.js');
  const { checkKillSwitch: door } = await import('../src/services/outbound/kill-switch.js');
  const refusedForBeingUnreal = await door(P, 'send_email');
  say('the reference company tries to email',
    refusedForBeingUnreal.blocked ? refusedForBeingUnreal.reason : 'ALLOWED — a defect');

  const REAL = 'ex_real';
  await query("INSERT INTO products (id,name,owner_id,status) VALUES (?,'AcreOS',?,'active')",
    [REAL, OWNER]);
  say('a real company', 'AcreOS');

  const heSaid = 'Do not contact anyone without asking me first';
  const read = intent.interpret(heSaid);
  say('he says', `"${heSaid}"`);
  say('  understood as',
    read.kind === 'boundary' ? `a boundary — ${read.subject}, ${read.mode}` : read.kind);
  if (read.kind === 'boundary') {
    await intent.setBoundary({ productId: REAL, subject: read.subject, mode: read.mode,
      statement: heSaid });
  }

  const checkKillSwitch = door;
  const act = { to: 'a-customer@example.com', subject: 'your payment failed' };
  const before = await checkKillSwitch(REAL, 'send_email', null,
    { paramsFingerprint: intent.fingerprint(act) });
  say('  Foundry tries to email', before.blocked ? `refused — ${before.reason}` : 'allowed');

  const proposalId = await intent.proposeAct({
    productId: REAL, subject: 'contact_people', actionType: 'send_email', params: act,
    summary: 'Email one customer about a payment that failed',
    why: 'their card was declined and nothing has told them',
    expectedEffect: 'they update it and the subscription continues',
    risk: 'if the decline was their bank this is an unnecessary message',
    consequence: 'low', proposedBy: 'agent:support',
  });
  say('  Foundry proposes it', 'and still cannot act');
  const stillBlocked = await checkKillSwitch(REAL, 'send_email', null,
    { paramsFingerprint: intent.fingerprint(act) });
  say('  tries again', stillBlocked.blocked ? 'refused' : 'ALLOWED — that would be a defect');

  await intent.decideProposedAct({
    id: proposalId, decision: 'approved', decidedBy: `founder:${OWNER}` });
  const after = await checkKillSwitch(REAL, 'send_email', null,
    { paramsFingerprint: intent.fingerprint(act) });
  say('  he approves that one act', after.blocked ? 'STILL REFUSED — a defect' : 'allowed, once');
  const spentAlready = await checkKillSwitch(REAL, 'send_email', null,
    { paramsFingerprint: intent.fingerprint(act) });
  say('  and again', spentAlready.blocked ? 'refused — the approval was spent' : 'ALLOWED — a defect');
  const somethingElse = await checkKillSwitch(REAL, 'send_email', null,
    { paramsFingerprint: intent.fingerprint({ ...act, to: 'everyone@example.com' }) });
  say('  something he did not approve',
    somethingElse.blocked ? 'refused' : 'ALLOWED — a defect');

  // WHETHER A PORTFOLIO SHOULD GET WIDER, ASKED THE WAY HE ASKED IT.
  //
  // The canonical owner request is "find another small digital income stream
  // that would make my portfolio more resilient", and the institution passes
  // only if it can decline. So the walk ends by asking it, out loud, against
  // the rehearsal companies — which are deliberately concentrated.
  console.log('\nWHETHER TO ADD ANOTHER');
  const venture = await import('../src/services/venture/mandate.js');
  const resilience = await import('../src/services/founder/resilience.js');
  const PARAGRAPH = 'Make the river stronger. Find another small digital income '
    + 'stream that would make my portfolio more resilient. Keep legal risk low. '
    + 'Avoid increasing our biggest existing dependencies. Do not spend more than '
    + '$25 validating anything. Bring me only things that deserve my attention.';
  say('he says', `"${PARAGRAPH}"`);
  for (const heard of venture.readVentureParagraph(PARAGRAPH)) {
    say(`  "${heard.statement.slice(0, 40)}"`, heard.kind === 'mandate'
      ? 'a mandate to look, naming no shape'
      : heard.kind === 'guidance'
        ? `${heard.guidance}${heard.subject ? `: ${heard.subject}` : ''}`
          + `${heard.dimension ? ` on ${heard.dimension}` : ''}`
          + `${heard.resolve ? ` (resolved against the portfolio)` : ''}`
        : `NOT HEARD — ${heard.kind}`);
  }

  const research = await import('../src/services/venture/research-sources.js');
  const view = await resilience.shouldAddAnother(OWNER, 'reference');
  say('  its answer', view.recommend ? `yes — ${view.because}` : `no — ${view.because}`);
  for (const con of view.concentrations) {
    say('  what one failure could take out',
      `${String(con.carriedBy.length)} share ${con.value} — ${con.ifItFails}`);
  }

  const opened = await venture.openMandate({
    founderId: OWNER,
    statement: 'Find another small digital income stream that would make my portfolio more resilient',
    shape: null, evidenceMode: 'reference' });
  if (!('refused' in opened)) {
    for (const way of await research.waysOfLooking(OWNER, 'reference')) {
      say('  looking through', `${way.named} — ${way.whatItIs}`);
    }
    for (const dark of await research.whatIsStillDark(OWNER, 'reference')) {
      say('  still cannot see', dark);
    }
    for (const cand of await venture.candidatesFor(opened.id)) {
      say(`  ${cand.headline.slice(0, 44)}`, cand.fit?.verdict ?? 'no view');
    }
  }

  // AND THE STEP THAT MAKES RESEARCH CHANGE ANYBODY'S MIND: a prediction made
  // before the answer arrives, sealed when he approves it, and a result that
  // is allowed to disagree with it.
  console.log('\nSAYING WHAT IT EXPECTS, BEFORE IT LOOKS');
  const validation = await import('../src/services/venture/validation.js');
  const evidence = await import('../src/services/venture/market-evidence.js');
  if (!('refused' in opened)) {
    const subject = (await venture.candidatesFor(opened.id))
      .find((cand) => cand.headline.includes('veterinary'));
    if (subject) {
      const blocking = subject.unanswered.find((u) => u.blocking);
      say('what stands in the way', subject.inTheWay.join('; ') || 'nothing');
      // WHAT LIABILITY IT CREATES, and where the institution stops. A serious
      // exposure with nobody qualified having looked is the state this exists
      // to make visible, and the walk shows it saying so rather than
      // producing a confident paragraph about veterinary liability.
      say('  legal and risk', subject.legal.profile);
      for (const sf of subject.legal.surfaces) {
        say(`    ${sf.whatItIs.slice(0, 44)}`, `${sf.severity}`
          + `${sf.needsProfessional ? ' - needs somebody qualified; past what I should answer' : ''}`
          + ` - often avoided by ${sf.oftenAvoidedBy}`);
      }
      say('  could it be lighter', subject.legal.lighter ?? 'nobody has asked');
      if (blocking) {
        const experimentId = await validation.designExperiment({
          founderId: OWNER, opportunityId: subject.id, unknownId: blocking.id,
          // Attached to the claim it bears on, so the result enters evidence
          // through the ordinary door rather than sitting beside it.
          claimId: subject.standing[0]?.claimId ?? null,
          whatWeDo: blocking.cheapestTest ?? 'ask the people who have the problem',
          whatWeExpect: 'at least three of twenty ask how to buy it',
          wouldDisprove: 'fewer than three ask, or they all want it free',
          costCents: 1_500, evidenceMode: 'reference' });
        say('  it proposes', 'take a price to twenty practice managers, $15.00');
        const tooDear = await validation.overWhatHeSaid({
          mandateId: opened.id, costCents: 1_500 });
        say('  against what he said', tooDear ?? 'within anything he has said');

        const early = await validation.recordResult({
          experimentId, whatHappened: 'anything', asPredicted: true })
          .then(() => 'RAN WITHOUT HIM — a defect')
          .catch(() => 'refused — he has not decided');
        say('  it tries to run first', early);

        await validation.decideExperiment({
          experimentId, decision: 'approved', by: `founder:${OWNER}` });
        const sealed = await query(
          "UPDATE venture_experiments SET what_we_expect = 'whatever happens' WHERE id = ?",
          [experimentId]).then(() => 'EDITED — a defect')
          .catch(() => 'refused — the prediction is sealed');
        say('  he approves it', 'and the prediction can no longer be changed');
        say('  it tries to revise what it expected', sealed);

        await validation.recordResult({
          experimentId, whatHappened: 'one asked, and only about the free tier',
          asPredicted: false });
        say('  the result', 'one asked, and only about the free tier — a surprise');
        for (const how of subject.standing) {
          const now = await evidence.standingOf(how.claimId);
          say('  what that did to the claim', now?.howItStands ?? 'nothing');
        }
        const stillBlocked = await validation.advance({
          opportunityId: subject.id, by: `founder:${OWNER}` });
        say('  can it become a company', stillBlocked.advanced
          ? 'ADVANCED — a defect' : `no — ${stillBlocked.because}`);
      }
    }
  }

  // WHAT IT WOULD TAKE, AND WHAT IS YOURS. The institution names the
  // capabilities a piece of work needs and answers each from the fabric: I can
  // carry it; I could, once proven; I cannot yet, and here is the route; or
  // the act is yours each time whatever supplies it.
  console.log('\nWHAT IT WOULD TAKE');
  const fabric = await import('../src/services/institution/capabilities.js');
  if (!('refused' in opened)) {
    const subject = (await venture.candidatesFor(opened.id))
      .find((cand) => cand.headline.includes('dataset'));
    if (subject) {
      for (const need of await fabric.whatItWouldTake({
        subjectKind: 'opportunity', subjectId: subject.id })) {
        say(`  ${need.standing.padEnd(10)} ${need.capability.key}`, need.sentence);
      }
    }
  }
  const { consequenceAllows } = await import('../src/services/institution/consequence.js');
  const refund = await consequenceAllows({ productId: REAL, tool: 'stripe_create_refund',
    paramsFingerprint: intent.fingerprint({ charge: 'ch_1' }) });
  say('  a refund with no allowance', refund.allowed ? 'ALLOWED - a defect' : `refused - ${refund.reason}`);
  const unbound = await consequenceAllows({ productId: REAL, tool: 'a_tool_nobody_classified',
    paramsFingerprint: null });
  say('  a tool bound to no consequence', unbound.allowed ? 'ALLOWED - a defect' : 'refused - nothing says what it does');

  // A WORKSHOP UNDER A CEILING. Somewhere to do the work, and the rule it
  // lives under: no computer possesses more consequential authority than the
  // task that created it. Proven against something that actually tries.
  console.log('\nA WORKSHOP UNDER A CEILING');
  const shop = await import('../src/services/workshop/index.js');
  const ws = await shop.createWorkshop({
    founderId: OWNER, purpose: 'venture_development', ceiling: 'prepare', budgetCents: 25,
    substrate: 'reference_world', createdBy: 'foundry', evidenceMode: 'reference' });
  say('created', `${ws.purpose} on ${ws.substrate}, ceiling ${ws.ceiling}, budget 25c`);
  const within = await shop.grant({ workshopId: ws.id, capabilityKey: 'write_code_in_branch', grantedBy: 'foundry' });
  say('  granted write_code_in_branch', within.granted ? 'within the ceiling' : `REFUSED - a defect: ${within.because}`);
  const above = await shop.grant({ workshopId: ws.id, capabilityKey: 'send_email', grantedBy: `founder:${OWNER}` });
  say('  the owner grants send_email', above.granted ? 'GRANTED - a defect' : `refused - ${above.because}`);
  const sneak = await shop.run({ workshopId: ws.id, step: 'use:send_email write mail.txt hello' });
  say('  the code inside tries to send anyway', sneak.ok ? 'RAN - a defect' : sneak.output);
  const build = await shop.run({ workshopId: ws.id, step: 'use:write_code_in_branch write src/index.ts export {}' });
  say('  it builds', build.ok ? build.output : `REFUSED - a defect: ${build.output}`);
  await shop.destroy({ workshopId: ws.id, preserved: 'src/index.ts and the refusal on the record' });
  const spent = (await shop.read(ws.id)).spentCents;
  say('  destroyed', `kept what mattered; cost ${String(spent)}c; ${String((await shop.history(ws.id)).length)} events on the record`);

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
