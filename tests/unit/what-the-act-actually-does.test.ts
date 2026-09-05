process.env.TURSO_DATABASE_URL = 'file::memory:';
process.env.ENCRYPTION_KEY = '0'.repeat(64);
process.env.FOUNDRY_INSTANCE_POSTURE = 'private_owner';
process.env.FOUNDRY_OWNER_EMAIL = 'owner@example.com';

import { beforeAll, describe, expect, it } from 'vitest';
import { runMigrations } from '../../src/db/migrate.js';
import { query } from '../../src/db/client.js';
import {
  adviceOnDelegating, authorityForAct, classifyAndRecord, noteCountedFact,
  rungOfAct, seedStartingPolicy, whatKeepsRecurring,
} from '../../src/services/institution/acting.js';

// =============================================================================
// WHAT THE ACT ACTUALLY DOES.
//
// Consequence used to belong to the CAPABILITY, so a browser click, an API call
// and a shell command producing the identical effect fell under three different
// rules — or the same wrong one. It belongs to what the act does: who it
// reaches, whether it can be undone, what it costs.
//
// And standing authority is the mechanism by which an institution carries
// responsibility instead of asking about every ordinary act. Which makes it
// exactly the mechanism by which governance would quietly stop meaning
// anything, so the bounds are enforced here rather than intended.
//
// THE LINE THAT MUST NOT MOVE: calibration informs authority and never creates
// it. Nothing in this file reads a record and widens what is permitted.
// =============================================================================

const OWNER = 'act_owner';
const CO = 'act_co';
let actorId = '';

beforeAll(async () => {
  await runMigrations();
  await query('INSERT INTO founders (id,clerk_user_id,email,name) VALUES (?,?,?,?)',
    [OWNER, 'clerk_act', 'owner@example.com', 'Owner']);
  await query(
    `INSERT INTO products (id, name, owner_id, status, reality)
     VALUES (?,'Ashford',?,'active','real')`, [CO, OWNER]);
  await seedStartingPolicy(OWNER);
  actorId = 'actor_support';
  await query(
    `INSERT INTO business_actors (id, founder_id, product_id, kind, display_name,
       external_ref, portable)
     VALUES (?,?,?,'support_channel','Ashford Support','help@ashford.example',1)`,
    [actorId, OWNER, CO]);
  // Two tools, same institutional effect, different interfaces.
  for (const [id, provider, tool, how] of [
    ['cp_a', 'test_api', 'send_via_api', 'api'],
    ['cp_b', 'test_browser', 'send_via_browser', 'browser'],
  ]) {
    await query(
      `INSERT INTO capability_providers
         (id, capability_key, provider, how, tool, cost_note, maturity, sort_order)
       VALUES (?,'reach_out',?,?,?,'none','declared',99)`, [id, provider, how, tool]);
  }
});

describe('the same effect meets the same rule, whatever performed it', () => {
  it('gives a browser and an API the same rung for the same act', async () => {
    const api = await rungOfAct({ founderId: OWNER, productId: CO, tool: 'send_via_api',
      externalEffect: 'emails a customer', reversibility: 'recoverable',
      audience: 'existing_customer' });
    const browser = await rungOfAct({ founderId: OWNER, productId: CO,
      tool: 'send_via_browser', externalEffect: 'emails a customer',
      reversibility: 'recoverable', audience: 'existing_customer' });
    expect('rung' in api && 'rung' in browser).toBe(true);
    if (!('rung' in api) || !('rung' in browser)) return;
    expect(api.rung).toBe(browser.rung);
  });

  it('raises the rung on what the act does, never lowers it', async () => {
    const quiet = await rungOfAct({ founderId: OWNER, productId: CO, tool: 'send_via_api',
      externalEffect: 'writes a draft nobody sees', reversibility: 'reversible',
      audience: 'none' });
    const loud = await rungOfAct({ founderId: OWNER, productId: CO, tool: 'send_via_api',
      externalEffect: 'signs up for an account under our name',
      reversibility: 'irreversible', audience: 'counterparty' });
    if (!('rung' in quiet) || !('rung' in loud)) throw new Error('refused');
    expect(loud.rung).toBe('destructive');
    expect(loud.because).toContain('cannot be undone');
    // The capability's own rung is the floor, so a quiet act never drops below it.
    expect(quiet.rung).not.toBe('observe');
  });

  it('makes an act that spends money financial, whatever the tool looks like', async () => {
    const paid = await rungOfAct({ founderId: OWNER, productId: CO, tool: 'send_via_api',
      externalEffect: 'promotes a post', reversibility: 'recoverable',
      audience: 'public', moneyCents: 2500 });
    if (!('rung' in paid)) throw new Error('refused');
    expect(paid.rung).toBe('financial');
    expect(paid.because).toContain('$25.00');
  });
});

describe('standing authority has bounds that are enforced, not intended', () => {
  const DELEG = 'del_support';

  it('refuses what no delegation covers', async () => {
    const v = await authorityForAct({ founderId: OWNER, productId: CO,
      tool: 'send_via_api', externalEffect: 'answers a customer question',
      reversibility: 'recoverable', audience: 'existing_customer' });
    expect(v.allowed).toBe(false);
    expect(v.refusal).toContain('nothing you have said covers this');
  });

  it('will not let any delegation reach a non-absorbable rung', async () => {
    await expect(query(
      `INSERT INTO delegations (id, founder_id, product_id, actor_id, responsibility,
         act_class, content_scope, class, purpose,
         audience, excludes, ceiling, expires_at, granted_by)
       VALUES ('bad',?,?,?,'signing things','sign','anything','signing things','because it is convenient',
               'counterparty','nothing','legal',datetime('now','+30 days'),'founder:x')`,
      [OWNER, CO, actorId])).rejects.toThrow(/ceiling_is_not_absorbable/);
  });

  it('will not accept a permission with no stated exclusions', async () => {
    await expect(query(
      `INSERT INTO delegations (id, founder_id, product_id, actor_id, responsibility,
         act_class, content_scope, class, purpose,
         audience, excludes, ceiling, expires_at, granted_by)
       VALUES ('bad2',?,?,?,'support','answer','anything','support','help people','existing_customer','  ',
               'public',datetime('now','+30 days'),'founder:x')`,
      [OWNER, CO, actorId])).rejects.toThrow(/needs_exclusions/);
  });

  it('will not accept authority that can never be reassessed', async () => {
    // DURABLE IS ALLOWED; UNREASSESSABLE IS NOT. Requiring an expiry on every
    // permission forces him to re-permission the same stable responsibility
    // forever, which at nine assets is a calendar of re-permissioning — the
    // organisational burden this institution exists to absorb. What may never
    // exist is a permission with neither an expiry nor a review.
    await expect(query(
      `INSERT INTO delegations (id, founder_id, product_id, actor_id, responsibility,
         act_class, content_scope, class, purpose,
         audience, excludes, ceiling, expires_at, granted_by)
       VALUES ('bad3',?,?,?,'support','answer','anything','support','help people','existing_customer','no refunds',
               'public',datetime('now','-1 day'),'founder:x')`,
      [OWNER, CO, actorId])).rejects.toThrow(/must_be_reassessable/);

    // Neither an expiry nor a cadence: refused.
    await expect(query(
      `INSERT INTO delegations (id, founder_id, product_id, actor_id, responsibility,
         act_class, content_scope, class, purpose, audience, excludes, ceiling,
         granted_by)
       VALUES ('bad3b',?,?,?,'support','answer','anything','support','help people',
               'existing_customer','no refunds','public','founder:x')`,
      [OWNER, CO, actorId])).rejects.toThrow(/must_be_reassessable/);

    // Durable with a review cadence: allowed, because Foundry carries the
    // review and involves him only when something materially changed.
    await query(
      `INSERT INTO delegations (id, founder_id, product_id, actor_id, responsibility,
         act_class, content_scope, class, purpose, audience, excludes, ceiling,
         review_every_days, granted_by)
       VALUES ('durable',?,?,?,'support','answer','anything','support','help people',
               'existing_customer','no refunds','public',90,'founder:act_owner')`,
      [OWNER, CO, actorId]);
    const kept = (await query(
      "SELECT expires_at, review_every_days FROM delegations WHERE id = 'durable'"))
      .rows[0] as Record<string, unknown>;
    expect(kept.expires_at).toBeNull();
    expect(Number(kept.review_every_days)).toBe(90);
  });

  it('will not accept one the institution granted itself', async () => {
    await expect(query(
      `INSERT INTO delegations (id, founder_id, product_id, actor_id, responsibility,
         act_class, content_scope, class, purpose,
         audience, excludes, ceiling, expires_at, granted_by)
       VALUES ('bad4',?,?,?,'support','answer','anything','support','help people','existing_customer','no refunds',
               'public',datetime('now','+30 days'),'institution:foundry')`,
      [OWNER, CO, actorId])).rejects.toThrow(/not_granted_by_a_person/);
  });

  it('covers the act once he has said so, and says which permission covered it', async () => {
    await query(
      `INSERT INTO delegations (id, founder_id, product_id, actor_id, responsibility,
         act_class, class, purpose, audience, content_scope, excludes, ceiling,
         max_acts_per_day, expires_at, granted_by)
       VALUES (?,?,?,?,'ordinary customer support','answer a question',
               'ordinary customer support','answer product questions',
               'existing_customer','what the product does and how to use it',
               'change prices; promise refunds; contact anyone who is not already a customer',
               'public',2,datetime('now','+30 days'),'founder:act_owner')`,
      [DELEG, OWNER, CO, actorId]);
    const v = await classifyAndRecord({ founderId: OWNER, productId: CO,
      actorId, tool: 'send_via_api',
      responsibility: 'ordinary customer support', actClass: 'answer a question',
      externalEffect: 'answers a customer question',
      reversibility: 'recoverable', audience: 'existing_customer' });
    expect(v.allowed).toBe(true);
    expect(v.delegationId).toBe(DELEG);
  });

  it('stops at the daily limit rather than at the limit plus one', async () => {
    const second = await classifyAndRecord({ founderId: OWNER, productId: CO,
      actorId, tool: 'send_via_api',
      responsibility: 'ordinary customer support', actClass: 'answer a question',
      externalEffect: 'answers another question',
      reversibility: 'recoverable', audience: 'existing_customer' });
    expect(second.allowed).toBe(true);
    const third = await classifyAndRecord({ founderId: OWNER, productId: CO,
      actorId, tool: 'send_via_api',
      responsibility: 'ordinary customer support', actClass: 'answer a question',
      externalEffect: 'answers a third question',
      reversibility: 'recoverable', audience: 'existing_customer' });
    expect(third.allowed).toBe(false);
  });

  it('does not stretch to a different audience than the one he named', async () => {
    const v = await authorityForAct({ founderId: OWNER, productId: CO,
      tool: 'send_via_api',
      responsibility: 'ordinary customer support', actClass: 'answer a question',
      externalEffect: 'emails somebody who never signed up',
      reversibility: 'recoverable', audience: 'prospect' });
    expect(v.allowed).toBe(false);
  });
});

describe('a breaker counts what the world did', () => {
  const DELEG2 = 'del_breaker';

  beforeAll(async () => {
    await query(
      `INSERT INTO delegations (id, founder_id, product_id, actor_id, responsibility,
         act_class, content_scope, class, purpose,
         audience, excludes, ceiling, expires_at, granted_by)
       VALUES (?,?,?,?,'support with a fuse','answer a question','anything',
               'support with a fuse','answer questions','existing_customer',
               'anything a person complained about','public',
               datetime('now','+30 days'),'founder:act_owner')`,
      [DELEG2, OWNER, CO, actorId]);
    await query(
      `INSERT INTO delegation_breakers (id, delegation_id, counted_fact,
         window_minutes, threshold)
       VALUES ('brk',?,'complaint',1440,2)`, [DELEG2]);
  });

  it('trips on counted facts, not on the model deciding to stop', async () => {
    expect((await noteCountedFact({ delegationId: DELEG2, fact: 'complaint',
      ref: 'inbox:1' })).tripped).toBe(false);
    expect((await noteCountedFact({ delegationId: DELEG2, fact: 'complaint',
      ref: 'inbox:2' })).tripped).toBe(true);
  });

  it('refuses to be reset by anything but a person', async () => {
    await expect(query(
      `UPDATE delegation_breakers SET cleared_at = datetime('now'),
         cleared_by = 'institution:foundry' WHERE id = 'brk'`))
      .rejects.toThrow(/cleared_only_by_a_person/);
  });
});

describe('calibration informs authority and never creates it', () => {
  it('says no amount of history makes a non-absorbable rung delegable', async () => {
    const advice = await adviceOnDelegating({ founderId: OWNER, ceiling: 'legal' });
    expect(advice.eligible).toBe(false);
    expect(advice.sentence).toContain('No amount of good history');
  });

  it('wants more evidence for a costlier class than a cheap one', async () => {
    const cheap = await adviceOnDelegating({ founderId: OWNER, ceiling: 'reversible' });
    const dear = await adviceOnDelegating({ founderId: OWNER, ceiling: 'financial' });
    // Both refuse today; what differs is the bar each names.
    expect(cheap.sentence).toContain('policy asks for 8');
    expect(dear.sentence).toContain('policy asks for 40');
  });

  it('has no path from a good record to a wider permission', async () => {
    // The guarantee is structural rather than behavioural: adviceOnDelegating
    // returns a sentence, and there is no code that turns one into a row.
    const before = await query('SELECT COUNT(*) AS n FROM delegations');
    await adviceOnDelegating({ founderId: OWNER, ceiling: 'public' });
    const after = await query('SELECT COUNT(*) AS n FROM delegations');
    expect((after.rows[0] as Record<string, unknown>).n)
      .toBe((before.rows[0] as Record<string, unknown>).n);
  });
});

describe('the company acts, not the owner', () => {
  it('keeps an asset identity portable, and his own never', async () => {
    const support = (await query(
      'SELECT portable FROM business_actors WHERE id = ?', [actorId]))
      .rows[0] as Record<string, unknown>;
    expect(Number(support.portable)).toBe(1);
    await expect(query(
      `INSERT INTO business_actors (id, founder_id, kind, display_name, portable)
       VALUES ('a_him',?,'owner','Thomas',1)`, [OWNER]))
      .rejects.toThrow(/owner_is_not_portable/);
  });

  it('refuses an asset identity that does not say whose asset it is', async () => {
    await expect(query(
      `INSERT INTO business_actors (id, founder_id, kind, display_name, portable)
       VALUES ('a_orphan',?,'support_channel','Nobody Support',1)`, [OWNER]))
      .rejects.toThrow(/needs_a_company/);
  });
});

describe('a responsibility is not a shape of act', () => {
  it('will not let a support permission cover promotion to the same person', async () => {
    // Same company, same audience, same rung — and not the same permission.
    // This is the grouping error that would have scaled worst: at nine assets,
    // a permission that generalised by shape would quietly authorise things
    // nobody meant.
    const promo = await authorityForAct({ founderId: OWNER, productId: CO,
      tool: 'send_via_api', responsibility: 'promotional outreach',
      actClass: 'send a campaign',
      externalEffect: 'emails a customer about a new plan',
      reversibility: 'recoverable', audience: 'existing_customer' });
    expect(promo.allowed).toBe(false);
    expect(promo.refusal).toContain('nothing you have said covers this');
  });
});

describe('learning that work recurs must not cost him anything', () => {
  it('counts a schedule and a prepared-but-unfinished job, not only interruptions', async () => {
    const { noteResponsibilitySignal } = await import(
      '../../src/services/institution/acting.js');
    for (let i = 0; i < 3; i += 1) {
      await noteResponsibilitySignal({
        founderId: OWNER, productId: CO,
        responsibility: 'keep the dependency list honest',
        kind: i === 2 ? 'prepared_not_finished' : 'scheduled',
        ref: `dependency_health_tick run ${String(i)}` });
    }
    const recurring = await whatKeepsRecurring(OWNER);
    const found = recurring.find((r) =>
      r.responsibility === 'keep the dependency list honest');
    expect(found?.times).toBe(3);
    // THE NUMBER THAT MATTERS: none of this reached him.
    expect(found?.interruptions).toBe(0);
    expect(found?.signals.map((s) => s.kind).sort())
      .toEqual(['prepared_not_finished', 'scheduled']);
  });

  it('stops proposing once he has said yes', async () => {
    const before = await whatKeepsRecurring(OWNER);
    expect(before.some((r) => r.responsibility === 'keep the dependency list honest'))
      .toBe(true);
    await query(
      `INSERT INTO delegations (id, founder_id, product_id, actor_id, responsibility,
         act_class, content_scope, class, purpose, audience, excludes, ceiling,
         review_every_days, granted_by)
       VALUES ('del_dep',?,?,?,'keep the dependency list honest','read a registry',
               'the packages this institution runs on','dependency health',
               'know whether what we run on is still maintained','none',
               'change any dependency; open a pull request','observe',90,
               'founder:act_owner')`, [OWNER, CO, actorId]);
    const after = await whatKeepsRecurring(OWNER);
    expect(after.some((r) => r.responsibility === 'keep the dependency list honest'))
      .toBe(false);
  });
});

describe('the evidence bar is policy he can change', () => {
  it('reads the bar from a table rather than from the code', async () => {
    await query(
      `UPDATE delegation_evidence_policy SET superseded_at = datetime('now')
        WHERE founder_id = ? AND ceiling = 'public'`, [OWNER]);
    await query(
      `INSERT INTO delegation_evidence_policy
         (id, founder_id, ceiling, min_graded, min_from_world, max_surprise_bp,
          why, set_by)
       VALUES ('evp_custom',?, 'public', 5, 3, 2000,
               'this class is cheap to undo and I want it moving sooner',
               'founder:act_owner')`, [OWNER]);
    const advice = await adviceOnDelegating({ founderId: OWNER, ceiling: 'public' });
    expect(advice.sentence).toContain('policy asks for 5');
  });
});
