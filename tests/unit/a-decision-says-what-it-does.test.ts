process.env.TURSO_DATABASE_URL = 'file::memory:';
process.env.ENCRYPTION_KEY = '0'.repeat(64);
process.env.FOUNDRY_INSTANCE_POSTURE = 'private_owner';
process.env.FOUNDRY_OWNER_EMAIL = 'owner@example.com';

import { execFileSync } from 'child_process';
import { mkdirSync, mkdtempSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { beforeAll, describe, expect, it } from 'vitest';
import { runMigrations } from '../../src/db/migrate.js';
import { query } from '../../src/db/client.js';
import { openMandate } from '../../src/services/venture/mandate.js';
import { formClaim, observe, raiseUnknown } from '../../src/services/venture/market-evidence.js';
import { promote, sow } from '../../src/services/venture/seeds.js';
import {
  decideExperiment, designExperiment, retireExperiment, reversalsOfDecisions,
  withdrawExperimentDecision,
} from '../../src/services/venture/validation.js';
import { beginExperimentalAsset } from '../../src/services/venture/asset.js';
import {
  consequenceOfApproving, isCannotSay, labelFor,
} from '../../src/services/founder/what-it-would-do.js';
import { renderExperiment } from '../../src/services/public-workshop/site.js';
import type { PublicExperiment, PublicWorkshopFacts } from '../../src/services/public-workshop/projection.js';

// =============================================================================
// A DECISION SAYS WHAT IT DOES — the 10 September session as a regression.
//
// The owner opened Foundry to authorise one thing and pressed nine buttons in
// one hundred and thirty-seven seconds. Every one read "Go ahead — nothing" or
// "Go ahead — $100.00". Eight were internal tests. The ninth was an experiment
// whose text begins "Write once to each approved Massachusetts millwork
// business as Thomas Norton", and approving it through that control created a
// $100 allowance with no end date, started a fourteen-day settlement clock, and
// moved the test into a state where its own publication gate refused it.
//
// NOTHING REACHED ANYBODY. The outbound path requires an approved,
// measurement-critical act and none was created; the boundary held and this
// file proves it still does. What failed was legibility, and every test below
// is one sentence of that failure turned into something that cannot recur.
// =============================================================================

const OWNER = 'legibility_owner';
let mandateId = '';
let opportunityId = '';
let internalExperiment = '';
let peopleExperiment = '';

async function aCandidate(word: string): Promise<string> {
  const pain = await formClaim({ founderId: OWNER, evidenceMode: 'real',
    claim: `somebody wrote: "we ${word} by hand every week"` });
  const obsId = await observe({ founderId: OWNER, claimId: pain, sourceType: 'community',
    source: 'https://forum.example/2', saw: `we ${word} by hand every week`, bearing: 'supports',
    directness: 'direct', observedAt: new Date(Date.now() - 86_400_000), evidenceMode: 'real' });
  const seed = await sow({ founderId: OWNER, mandateId, seed: `maybe worth looking into: ${word}`,
    origin: 'signal', originSaid: `we ${word} by hand every week`, originObservationId: obsId,
    evidenceMode: 'real' });
  if (typeof seed !== 'string') throw new Error('buried');
  await query('UPDATE market_claims SET seed_id = ? WHERE id = ?', [seed, pain]);
  const gap = await formClaim({ founderId: OWNER, seedId: seed, evidenceMode: 'real',
    claim: `nothing maintained already does this: ${word}` });
  await observe({ founderId: OWNER, claimId: gap, sourceType: 'directory',
    source: 'https://registry.example/search', saw: 'nothing relevant', bearing: 'supports',
    directness: 'inferred', observedAt: new Date(Date.now() - 3_600_000), evidenceMode: 'real',
    fromAbsence: true });
  const interp = `int_${word.replace(/\W/g, '')}`;
  await query(
    `INSERT INTO observation_interpretations
       (id, founder_id, observation_id, reading, motivated_by, misread_if, hypothesis,
        hypothesis_kind, who_it_may_be, interpreted_by, evidence_mode)
     VALUES (?,?,?,?,?,?,?,?,?,?,'real')`,
    [interp, OWNER, obsId, 'people resent doing this by hand', `${word} by hand every week`,
      'they enjoy doing it', `a tool that does ${word} might be wanted`, 'gap_exists',
      'small teams', 'test']);
  await query('UPDATE opportunity_seeds SET interpretation_id = ?, hypothesis_kind = ? WHERE id = ?',
    [interp, 'gap_exists', seed]);
  const made = await promote({ seedId: seed, headline: `${word} without doing it by hand`,
    whoHasIt: 'small teams', theProblem: 'weekly manual work', whyItMight: 'two ways of knowing',
    killThesis: 'they enjoy doing it', unknowns: ['whether anybody would pay for it'],
    sources: ['https://forum.example/2'] });
  if ('refused' in made) throw new Error(made.refused);
  return made.opportunityId;
}

async function anUnknownOn(opportunity: string, question: string): Promise<string> {
  return raiseUnknown({ founderId: OWNER, question, blocking: false,
    opportunityId: opportunity });
}

beforeAll(async () => {
  await runMigrations();
  await query('INSERT INTO founders (id,clerk_user_id,email,name) VALUES (?,?,?,?)',
    [OWNER, 'clerk_legibility', 'owner@example.com', 'Owner']);
  const opened = await openMandate({ founderId: OWNER, statement: 'Make the river stronger',
    shape: null, evidenceMode: 'real' });
  if ('refused' in opened) throw new Error(opened.refused);
  mandateId = opened.id;
  opportunityId = await aCandidate('reconcile invoices');
  const blocking = (await query(
    'SELECT id FROM market_unknowns WHERE opportunity_id = ? AND blocking = 1', [opportunityId]))
    .rows[0] as Record<string, unknown>;
  internalExperiment = await designExperiment({
    founderId: OWNER, opportunityId, unknownId: String(blocking.id),
    whatWeDo: 'showing a price to somebody who has the problem and seeing what they do',
    whatWeExpect: 'at least one person hands over money at the price offered',
    wouldDisprove: 'nobody pays, or everybody asks for it free',
    costCents: 900, evidenceMode: 'real' });
  peopleExperiment = await designExperiment({
    founderId: OWNER, opportunityId,
    unknownId: await anUnknownOn(opportunityId, 'whether a named shop would pay'),
    whatWeDo: 'write once to each approved business in the owner\'s name',
    whatWeExpect: 'at least one pays', wouldDisprove: 'nobody pays',
    costCents: 0, evidenceMode: 'real' });
  // The thing that makes it person-facing is naming a person, not its price.
  await query(
    `INSERT INTO experiment_recipients
       (id, founder_id, experiment_id, counterparty_ref, email, channel, source_url)
     VALUES (?,?,?,?,?,'email',?)`,
    ['rcp_legibility', OWNER, peopleExperiment, 'A Millwork Shop',
      'shop@example.test', 'https://shop.example.test/projects']);
});

// ── The classification itself ────────────────────────────────────────────────

describe('what approving would do, read from the test rather than its price', () => {
  it('an internal test is internal, touches nobody, and says what it does not authorise', async () => {
    const c = await consequenceOfApproving(internalExperiment);
    if (isCannotSay(c)) throw new Error(c.cannotSay);
    expect(c.effect).toBe('internal');
    expect(c.touches).toBe('nobody');
    expect(c.dedicated).toBeNull();
    expect(c.doesNotAuthorise).toContain('contacting anybody');
    expect(c.doesNotAuthorise).toContain('acting as you');
    // The budget he approves is bounded, and the sentence says so.
    expect(c.maxCents).toBe(900);
    expect(c.expires).toBe('14 days after you approve');
  });

  it('$0 IS NEVER INTERNAL: a free test that ends at a real person is person-facing', async () => {
    const c = await consequenceOfApproving(peopleExperiment);
    if (isCannotSay(c)) throw new Error(c.cannotSay);
    expect(c.maxCents).toBe(0);
    expect(c.effect).toBe('person');
    expect(c.touches).toContain('business');
    expect(c.reversibility).toBe('irreversible');
  });

  it('a test that cannot be classified is not offered as a decision', async () => {
    const c = await consequenceOfApproving('no_such_experiment_at_all');
    expect(isCannotSay(c)).toBe(true);
  });

  it('the two labels cannot be mistaken for one another', async () => {
    const internal = await consequenceOfApproving(internalExperiment);
    const people = await consequenceOfApproving(peopleExperiment);
    if (isCannotSay(internal) || isCannotSay(people)) throw new Error('unclassifiable');
    const a = labelFor(internal);
    const b = labelFor(people);
    expect(a).toContain('nobody contacted');
    expect(a).toContain('$9.00');
    expect(b).toContain('person-facing');
    expect(b).not.toContain('nobody');
    expect(a).not.toBe(b);
    // Neither label is only a price, which is the whole finding.
    expect(a.replace(/[$\d.]/g, '').trim().length).toBeGreaterThan(10);
    expect(b.replace(/[$\d.]/g, '').trim().length).toBeGreaterThan(10);
  });
});

// ── One experiment, one authorisation path ───────────────────────────────────

describe('a dedicated authorisation cannot be bypassed by a general control', () => {
  it('the general control refuses a test that names real businesses, and points at its own page', async () => {
    const c = await consequenceOfApproving(peopleExperiment);
    if (isCannotSay(c)) throw new Error(c.cannotSay);
    expect(c.dedicated?.path).toBe(`/foundry/experiments/${peopleExperiment}`);
    const tried = await decideExperiment({
      experimentId: peopleExperiment, decision: 'approved', by: `founder:${OWNER}` });
    expect(tried.refused).toBeTruthy();
    const row = (await query('SELECT decision FROM venture_experiments WHERE id = ?',
      [peopleExperiment])).rows[0] as Record<string, unknown>;
    expect(row.decision).toBeNull();
  });

  it('and its own surface still decides it', async () => {
    const ok = await decideExperiment({ experimentId: peopleExperiment, decision: 'declined',
      by: `founder:${OWNER}`, via: 'its own authorisation' });
    expect(ok.refused).toBeUndefined();
    const row = (await query('SELECT decision FROM venture_experiments WHERE id = ?',
      [peopleExperiment])).rows[0] as Record<string, unknown>;
    expect(row.decision).toBe('declined');
  });
});

// ── The allowance has a horizon ──────────────────────────────────────────────

describe('an allowance ends, or says in words why it does not', () => {
  it('approving an internal test writes a bounded allowance', async () => {
    await decideExperiment({ experimentId: internalExperiment, decision: 'approved',
      by: `founder:${OWNER}` });
    const made = await beginExperimentalAsset({ experimentId: internalExperiment,
      by: `founder:${OWNER}` });
    if ('refused' in made) throw new Error(made.refused);
    const a = (await query('SELECT amount_cents, until, unbounded_because FROM owner_allowances WHERE product_id = ?',
      [made.productId])).rows[0] as Record<string, unknown>;
    expect(Number(a.amount_cents)).toBe(900);
    expect(a.until).not.toBeNull();
    expect(a.unbounded_because).toBeNull();
  });

  it('an allowance with neither an end date nor a reason is refused by the database', async () => {
    await expect(query(
      `INSERT INTO owner_allowances (id, product_id, purpose, statement, amount_cents)
       VALUES ('al_forever','no_such_product','testing','somebody approved this',1000)`, []))
      .rejects.toThrow(/needs_a_horizon/);
  });

  it('and one that says why it does not end is allowed', async () => {
    await query('INSERT INTO products (id,name,owner_id,status) VALUES (?,?,?,?)',
      ['prod_forever', 'a standing thing', OWNER, 'active']);
    await query(
      `INSERT INTO owner_allowances (id, product_id, purpose, statement, amount_cents, unbounded_because)
       VALUES ('al_stated','prod_forever','keeping the lights on','the owner approved this at $10.00',1000,
               'the hosting bill does not stop, so neither does its ceiling')`, []);
    const a = (await query('SELECT unbounded_because FROM owner_allowances WHERE id = ?',
      ['al_stated'])).rows[0] as Record<string, unknown>;
    expect(String(a.unbounded_because)).toContain('does not stop');
  });
});

// ── A decision he did not mean to make ───────────────────────────────────────

describe('a decision can be withdrawn by the person who made it, on the record', () => {
  it('the record is written first, and the stamp and the clock go with the decision', async () => {
    const before = (await query('SELECT decision, due_at FROM venture_experiments WHERE id = ?',
      [internalExperiment])).rows[0] as Record<string, unknown>;
    expect(before.decision).toBe('approved');
    expect(before.due_at).not.toBeNull();

    const back = await withdrawExperimentDecision({
      experimentId: internalExperiment, by: `founder:${OWNER}`,
      theControlSaid: 'Go ahead — nothing',
      because: 'pressed through a control that did not say what it would do' });
    expect(back.withdrawn).toBe(true);

    const after = (await query(
      'SELECT decision, decided_at, decided_by, due_at FROM venture_experiments WHERE id = ?',
      [internalExperiment])).rows[0] as Record<string, unknown>;
    expect(after.decision).toBeNull();
    expect(after.decided_at).toBeNull();
    expect(after.decided_by).toBeNull();
    expect(after.due_at).toBeNull();

    // AND THE INSTITUTION CAN STILL SAY WHAT HAPPENED. This is the difference
    // between withdrawing a decision and pretending it was never made.
    const record = await reversalsOfDecisions(internalExperiment);
    expect(record).toHaveLength(1);
    expect(record[0]?.originalDecision).toBe('approved');
    expect(record[0]?.theControlSaid).toBe('Go ahead — nothing');
    expect(record[0]?.originallyDecidedAt).toBe(String(before.decision && after.decision === null
      ? (before as Record<string, unknown>).decided_at ?? record[0]?.originallyDecidedAt
      : record[0]?.originallyDecidedAt));
  });

  it('the asset the withdrawal archived comes back on re-approval, rather than a second one', async () => {
    const was = (await query('SELECT id FROM products WHERE from_experiment_id = ?',
      [internalExperiment])).rows[0] as Record<string, unknown>;
    const { retireExperimentalAsset } = await import('../../src/services/venture/asset.js');
    await retireExperimentalAsset({ productId: String(was.id),
      because: 'its approval was withdrawn' });
    await decideExperiment({ experimentId: internalExperiment, decision: 'approved',
      by: `founder:${OWNER}` });
    const again = await beginExperimentalAsset({ experimentId: internalExperiment,
      by: `founder:${OWNER}` });
    if ('refused' in again) throw new Error(again.refused);
    expect(again.productId).toBe(String(was.id));
    expect(again.created).toBe(false);
    const rows = await query('SELECT id, status FROM products WHERE from_experiment_id = ?',
      [internalExperiment]);
    expect(rows.rows).toHaveLength(1);
    expect((rows.rows[0] as Record<string, unknown>).status).toBe('active');
  });

  it('nobody but the decider may undecide', async () => {
    const nope = await withdrawExperimentDecision({
      experimentId: internalExperiment, by: 'institution:workshop_keeper',
      theControlSaid: 'Go ahead', because: 'tidying up' });
    expect(nope.withdrawn).toBe(false);
    expect(nope.because).toContain('only the person who decided');
  });

  it('and the database refuses it once something has happened under the decision', async () => {
    // Something has happened under the decision: an act the owner approved.
    await query(
      `INSERT INTO owner_boundaries (id, product_id, subject, statement, mode)
       VALUES ('bd_contact', NULL, 'contact_people', 'ask me before writing to anybody', 'ask_first')`);
    await query(
      `INSERT INTO proposed_acts (id, product_id, subject, action_type, params_fingerprint,
         summary, why, expected_effect, risk, consequence, proposed_by, expires_at,
         experiment_id, measurement_critical)
       VALUES ('act_under','prod_forever','contact_people','send_email','fp',
               'write once to each approved business','to learn whether anybody pays',
               'messages leave','somebody is written to','high', 'institution:hand',
               datetime('now','+2 days'), ?, 1)`, [internalExperiment]);
    await query(
      `UPDATE proposed_acts SET decision = 'approved', decided_at = datetime('now'),
              decided_by = ? WHERE id = 'act_under'`, [`founder:${OWNER}`]);
    const e = (await query('SELECT decided_at, decided_by, decision FROM venture_experiments WHERE id = ?',
      [internalExperiment])).rows[0] as Record<string, unknown>;
    await query(
      `INSERT INTO owner_decision_reversals
         (id, founder_id, subject_kind, subject_id, original_decision,
          originally_decided_at, originally_decided_by, the_control_said, because, reversed_by)
       VALUES ('rev_blocked',?,'venture_experiment',?,?,?,?,'Go ahead','trying it anyway',?)`,
      [OWNER, internalExperiment, String(e.decision), String(e.decided_at),
        String(e.decided_by), String(e.decided_by)]);
    await expect(query(
      `UPDATE venture_experiments SET decision = NULL, decided_at = NULL, decided_by = NULL,
              due_at = NULL WHERE id = ?`, [internalExperiment]))
      .rejects.toThrow(/reversal_after_consequence/);
    await query("UPDATE proposed_acts SET revoked_at = datetime('now'), revoke_reason = 'test fixture' WHERE id = 'act_under'");
  });
});

// ── Two tests that are one test ──────────────────────────────────────────────

describe('a redundant test is retired in favour of the one it duplicates', () => {
  it('retirement keeps the lineage and the reason', async () => {
    const dup = await designExperiment({
      founderId: OWNER, opportunityId,
      unknownId: await anUnknownOn(opportunityId, 'whether it is a one-off gripe'),
      whatWeDo: 'showing a price to somebody who has the problem and seeing what they do',
      whatWeExpect: 'at least one person hands over money at the price offered',
      wouldDisprove: 'nobody pays, or everybody asks for it free',
      costCents: 0, evidenceMode: 'real' });
    const out = await retireExperiment({ experimentId: dup, by: `founder:${OWNER}`,
      because: 'the same test on the same population as its survivor',
      supersededBy: internalExperiment });
    expect(out.retired).toBe(true);
    const row = (await query(
      'SELECT retired_at, retired_because, superseded_by FROM venture_experiments WHERE id = ?',
      [dup])).rows[0] as Record<string, unknown>;
    expect(row.retired_at).not.toBeNull();
    expect(String(row.retired_because)).toContain('same population');
    expect(row.superseded_by).toBe(internalExperiment);
    // A retired test is not offered as a decision at all.
    expect(isCannotSay(await consequenceOfApproving(dup))).toBe(true);
  });

  it('a retirement with no reason is refused', async () => {
    const dup2 = await designExperiment({
      founderId: OWNER, opportunityId,
      unknownId: await anUnknownOn(opportunityId, 'whether anybody would say so twice'),
      whatWeDo: 'ask again', whatWeExpect: 'the same answer', wouldDisprove: 'a different one',
      costCents: 0, evidenceMode: 'real' });
    await expect(query(
      "UPDATE venture_experiments SET retired_at = datetime('now') WHERE id = ?", [dup2]))
      .rejects.toThrow(/retirement_needs_a_reason/);
  });
});

// ── A lifecycle state cannot delete a material term ──────────────────────────

const FACTS: PublicWorkshopFacts = {
  name: 'Apex Micro', operator: 'Thomas Norton', origin: 'a workshop',
  tagline: 'a small digital workshop run by Thomas Norton', statement: 'statement',
  about: 'about', contactEmail: 'thomas@example.test', postalAddress: null,
  region: 'Massachusetts',
};

function aPage(over: Partial<PublicExperiment>): PublicExperiment {
  return {
    number: 1, slug: 'a-thing', path: '/experiments/a-thing', listed: true,
    title: 'A thing', summary: 'a summary', who: 'somebody', what: 'one brief',
    limits: 'a shortlist, not a database', sources: 'a public source',
    selection: 'how they were chosen', note: '', sample: null,
    status: 'preparing', statusLabel: 'Not open yet', statusLine: 'not open yet',
    outcome: null, price: { amountCents: 2900, currency: 'USD', label: '$29, one time' },
    recurring: false, payUrl: null, openedOn: null, closedOn: null,
    updatedOn: '2026-09-10', supersedes: null, successor: null, graduatedTo: null,
    ...over,
  };
}

describe('a material offer term does not vanish because an internal state changed', () => {
  it('every lifecycle state with a price states the price and that nothing renews', () => {
    for (const status of ['preparing', 'testing', 'operating', 'graduated', 'closed'] as const) {
      for (const payUrl of [null, 'https://pay.example.test/x']) {
        const html = renderExperiment(FACTS, aPage({ status, payUrl }));
        expect(html, `${status} / ${payUrl ? 'payable' : 'no link'}`).toMatch(/\$29/);
        expect(html, `${status} / ${payUrl ? 'payable' : 'no link'}`)
          .toMatch(/no subscription/i);
      }
    }
  });

  it('being closed is said in addition to the terms, never instead of them', () => {
    const html = renderExperiment(FACTS, aPage({ status: 'testing', payUrl: null }));
    expect(html).toMatch(/offer is not open at the moment/i);
    expect(html).toMatch(/no subscription/i);
  });
});

// ── The gate goes red when it should ─────────────────────────────────────────

function plant(files: Record<string, string>): string {
  const root = mkdtempSync(join(tmpdir(), 'legibility-'));
  mkdirSync(join(root, 'dashboard'), { recursive: true });
  writeFileSync(join(root, 'dashboard', 'decision-control.ts'), 'export const ok = 1;\n');
  for (const [name, body] of Object.entries(files)) {
    writeFileSync(join(root, 'dashboard', name), body);
  }
  return root;
}

function runGate(root: string): { code: number; out: string } {
  try {
    const out = execFileSync('node', ['scripts/check-decision-legibility.mjs', root],
      { encoding: 'utf8' });
    return { code: 0, out };
  } catch (e) {
    const err = e as { status?: number; stderr?: string; stdout?: string };
    return { code: err.status ?? 1, out: `${err.stdout ?? ''}${err.stderr ?? ''}` };
  }
}

describe('check-decision-legibility.mjs fails when it should', () => {
  it('passes a tree with nothing wrong in it', () => {
    expect(runGate(plant({ 'fine.ts': 'export const x = 1;\n' })).code).toBe(0);
  });

  it('catches a whole-test decision form written by hand', () => {
    const r = runGate(plant({ 'bad.ts': `export const f = \`
      <form method="POST" action="/foundry/venture/experiment">
        <input type="hidden" name="experimentId" value="x" />
        <input type="hidden" name="decision" value="approved" />
        <button type="submit">Approve</button>
      </form>\`;
` }));
    expect(r.code).toBe(1);
    expect(r.out).toMatch(/by hand/);
  });

  it('catches the label that started this', () => {
    const r = runGate(plant({ 'bad.ts': 'export const b = "Go ahead — nothing";\n' }));
    expect(r.code).toBe(1);
    expect(r.out).toMatch(/Go ahead/);
  });

  it('catches a control rendered without a consequence', () => {
    const r = runGate(plant({
      'bad.ts': 'export const c = renderDecision({ action: "/x", hidden: {} });\n' }));
    expect(r.code).toBe(1);
    expect(r.out).toMatch(/without a consequence/);
  });

  it('catches a route that decides an experiment without classifying it', () => {
    const r = runGate(plant({
      'bad.ts': 'export async function go() { await decideExperiment({ id: "x" }); }\n' }));
    expect(r.code).toBe(1);
    expect(r.out).toMatch(/without classifying/);
  });
});
