process.env.TURSO_DATABASE_URL = 'file::memory:';
process.env.ENCRYPTION_KEY = '0'.repeat(64);
process.env.FOUNDRY_INSTANCE_POSTURE = 'private_owner';
process.env.FOUNDRY_OWNER_EMAIL = 'owner@example.com';

import { beforeAll, describe, expect, it } from 'vitest';
import { Hono } from 'hono';
import { runMigrations } from '../../src/db/migrate.js';
import { query } from '../../src/db/client.js';
import {
  allowanceFor, boundariesFor, boundaryStandingInTheWay, interpret, liftBoundary,
  objectiveFor, setAllowance, setBoundary, setObjective,
} from '../../src/services/institution/standing-intent.js';

// =============================================================================
// WHAT THE OWNER SAID.
//
// "Do not change pricing without asking" should become a real enforced standing
// boundary. The failure this file exists to prevent is the one that would be
// invisible: an institution that RECORDS a boundary and then politely consults
// it is worse than one that never offered, because he stops watching a thing he
// was told is held.
//
// So every boundary here is asserted against the REAL doors — the outbound
// gateway's kill switch and the model-spend gate — not against a mock of them.
// And the interpretation is asserted to REFUSE rather than guess, because a
// governance control that mishears is a governance control that lies.
// =============================================================================

const OWNER = 'os_owner';
const A = 'os_a';
const B = 'os_b';
const ALLOW = 'os_allow';
const EXCEPT = 'os_except';
const PREF = 'os_pref';

beforeAll(async () => {
  await runMigrations();
  await query('INSERT INTO founders (id,clerk_user_id,email,name) VALUES (?,?,?,?)',
    [OWNER, 'clerk_os', 'owner@example.com', 'Owner']);
  for (const [id, name] of [[A, 'Alpha'], [B, 'Beta'],
    [ALLOW, 'Allowance Co'], [EXCEPT, 'Exception Co'], [PREF, 'Preference Co']] as const) {
    await query("INSERT INTO products (id,name,owner_id,status) VALUES (?,?,?,'active')",
      [id, name, OWNER]);
  }
});

describe('reading a sentence', () => {
  it('recognises a prohibition and what it is about', () => {
    for (const [said, subject] of [
      ['Do not change pricing without asking', 'set_prices'],
      ["Don't contact anyone", 'contact_people'],
      ['Never spend anything', 'spend_money'],
      ['Do not publish anything', 'publish'],
      ['You must not commit to anything on my behalf', 'commit_on_my_behalf'],
      ["Don't issue refunds", 'move_money'],
      ["Don't touch the code", 'change_software'],
    ] as const) {
      const read = interpret(said);
      expect(read.kind, said).toBe('boundary');
      if (read.kind === 'boundary') expect(read.subject, said).toBe(subject);
    }
  });

  it('does not turn a wish into a prohibition', () => {
    // THE DANGEROUS DIRECTION IS THIS ONE. A subject word alone must never
    // bind: "I want you to handle pricing" contains 'pricing' and means the
    // opposite of a boundary.
    const read = interpret('I want you to look after pricing for me');
    expect(read.kind).toBe('objective');
  });

  it('refuses to guess at a prohibition it does not recognise', () => {
    // Silence would be the worst outcome: he would believe something is held.
    const read = interpret('Do not do anything weird');
    expect(read.kind).toBe('unclear');
    if (read.kind === 'unclear') expect(read.because).toContain('not what');
  });

  it('keeps his exact words, whatever it decides', () => {
    const said = "Don't  contact anyone, seriously";
    const read = interpret(said);
    expect(read.statement).toBe(said.trim());
  });

  it('finds what an objective points at, and admits when it cannot', () => {
    const focused = interpret('Retention matters more than acquisition right now');
    expect(focused.kind).toBe('objective');
    if (focused.kind === 'objective') {
      expect(focused.concerns).toContain('retention');
      expect(focused.channels).toContain('day_30_retention');
    }
    const vague = interpret('Make this the best thing I have ever owned');
    expect(vague.kind).toBe('objective');
    if (vague.kind === 'objective') expect(vague.channels).toEqual([]);
  });
});

describe('a boundary that is actually enforced', () => {
  it('stops the outbound door, in his own words', async () => {
    const { checkKillSwitch } = await import('../../src/services/outbound/kill-switch.js');
    expect((await checkKillSwitch(A, 'send_email')).blocked).toBe(false);

    await setBoundary({ productId: A, subject: 'contact_people',
      statement: 'Do not contact anyone at Alpha' });

    const refused = await checkKillSwitch(A, 'send_email');
    expect(refused.blocked).toBe(true);
    // HIS SENTENCE, NOT A SUBJECT KEY. Months later, this is what makes the
    // refusal legible.
    expect(refused.reason).toContain('Do not contact anyone at Alpha');

    // Ahead of every exemption below it: an instruction outranks a setting.
    expect((await checkKillSwitch(A, 'send_email', null, { deliverableWhilePaused: true })).blocked)
      .toBe(true);
    // And it is this company's, not the other's.
    expect((await checkKillSwitch(B, 'send_email')).blocked).toBe(false);
  });

  it('binds only the tools that reach a person', async () => {
    // `contact_people` is about reaching someone, not about every effect that
    // travels outward. A boundary that quietly stopped unrelated machinery
    // would be a boundary he did not agree to.
    const { checkKillSwitch } = await import('../../src/services/outbound/kill-switch.js');
    expect((await checkKillSwitch(A, 'post_slack')).blocked).toBe(true);
    expect((await checkKillSwitch(A, 'read_repository')).blocked).toBe(false);
  });

  it('stops the money door', async () => {
    const { companyMayIncurCost } = await import('../../src/services/ai/client.js');
    expect(await companyMayIncurCost(B)).toBeNull();
    await setBoundary({ productId: B, subject: 'spend_money',
      statement: 'Do not spend anything on Beta yet' });
    expect(await companyMayIncurCost(B)).toContain('Do not spend anything on Beta yet');
  });

  it('binds every company when he meant every company', async () => {
    const { checkKillSwitch } = await import('../../src/services/outbound/kill-switch.js');
    const id = await setBoundary({ productId: null, subject: 'publish',
      statement: 'Do not publish anything anywhere' });
    const both = await Promise.all([boundariesFor(A), boundariesFor(B)]);
    for (const list of both) {
      expect(list.some((b) => b.id === id && b.everywhere)).toBe(true);
    }
    // `publish` has no door today, so nothing is refused by it — and the
    // record says so rather than implying an enforcement that is not there.
    expect((await checkKillSwitch(B, 'send_email')).blocked).toBe(false);
    expect(both[0].find((b) => b.id === id)?.door).toBeNull();
  });

  it('is one boundary however many times he says it', async () => {
    const first = await setBoundary({ productId: A, subject: 'contact_people',
      statement: 'Do not contact anyone at Alpha' });
    const again = await setBoundary({ productId: A, subject: 'contact_people',
      statement: 'seriously, no contacting anyone' });
    expect(again).toBe(first);
    const kept = (await boundariesFor(A)).find((b) => b.id === first);
    // The words that survive are the ones he used when it bound.
    expect(kept?.statement).toBe('Do not contact anyone at Alpha');
  });

  it('lifts in one act, and the record stays true', async () => {
    const live = (await boundariesFor(A)).find((b) => b.subject === 'contact_people');
    if (!live) throw new Error('expected a boundary');
    await liftBoundary(live.id, 'the owner lifted it');

    const { checkKillSwitch } = await import('../../src/services/outbound/kill-switch.js');
    expect((await checkKillSwitch(A, 'send_email')).blocked).toBe(false);

    // A lifted boundary cannot be re-armed in place: the record would then say
    // it was in force during a period when it was not.
    await expect(query(
      'UPDATE owner_boundaries SET lifted_at = NULL WHERE id = ?', [live.id]))
      .rejects.toThrow(/already_lifted/);
    // And it cannot be erased.
    await expect(query('DELETE FROM owner_boundaries WHERE id = ?', [live.id]))
      .rejects.toThrow(/immutable/);
  });

  it('refuses a vocabulary nobody agreed to', async () => {
    // check-vocabulary:expected-refusal
    await expect(setBoundary({
      productId: A, subject: 'do_whatever_it_takes', statement: 'anything',
    })).rejects.toThrow();
    await expect(query(
      `INSERT INTO owner_boundary_subjects (subject,owner_words,refusal,sort_order)
       VALUES ('x','x','x',9)`)).rejects.toThrow(/constitutional/);
  });
});

describe('an objective that actually steers', () => {
  it('replaces rather than accumulates, because two directions is none', async () => {
    await setObjective({ productId: A, statement: 'Get the first ten paying customers',
      channels: ['new_mrr_cents'] });
    await setObjective({ productId: A, statement: 'Retention matters more right now',
      channels: ['day_30_retention', 'churn_rate'] });
    const live = await objectiveFor(A);
    expect(live?.statement).toBe('Retention matters more right now');
    const all = (await query(
      'SELECT COUNT(*) AS n FROM owner_objectives WHERE product_id = ? AND retired_at IS NULL',
      [A])).rows[0] as Record<string, unknown>;
    expect(Number(all.n)).toBe(1);
  });

  it('raises the bar for what it was told not to focus on', async () => {
    const { MATERIAL_MOVEMENT, OFF_FOCUS_MULTIPLIER, noticeWhatTheNumbersAreDoing } =
      await import('../../src/services/institution/noticing.js');
    // A 30% adverse move: material on its own, not material once he has said
    // to look elsewhere. Twice the threshold is roughly what a person means by
    // "that matters more than this right now".
    expect(0.30).toBeGreaterThan(MATERIAL_MOVEMENT);
    expect(0.30).toBeLessThan(MATERIAL_MOVEMENT * OFF_FOCUS_MULTIPLIER);

    const C = 'os_c';
    await query("INSERT INTO products (id,name,owner_id,status) VALUES (?,'Gamma',?,'active')",
      [C, OWNER]);
    for (const [id, back, support, retention] of [
      ['os_then', '-40 day', 20, 0.70], ['os_now', '0 day', 26, 0.49],
    ] as const) {
      await query(
        `INSERT INTO metric_snapshots (id,product_id,snapshot_date,support_volume_7d,day_30_retention)
         VALUES (?,?,date('now',?),?,?)`, [id, C, back, support, retention]);
    }
    for (const [id, field, direction] of [
      ['os_o1', 'support_volume_7d', 'rose'], ['os_o2', 'day_30_retention', 'fell'],
    ] as const) {
      await query(
        `INSERT INTO signal_events (id,product_id,source,event_type,severity,payload_json,summary)
         VALUES (?,?,'external_metric_ingest',?,'low',?,'x')`,
        [id, C, `external_metric:${field}:${direction}`, JSON.stringify({
          origin: 'test', field, direction, observed_value: 1, previous_value: 2 })]);
    }

    // Unsteered: support (+30%) is worth raising.
    const unsteered = await noticeWhatTheNumbersAreDoing(C);
    expect(unsteered.map((n) => n.channel)).toContain('support_volume_7d');

    // Steered at retention: a fresh company, same numbers, and support no
    // longer clears the bar — while retention (-30%) still does.
    const D = 'os_d';
    await query("INSERT INTO products (id,name,owner_id,status) VALUES (?,'Delta',?,'active')",
      [D, OWNER]);
    for (const [id, back, support, retention] of [
      ['os_dthen', '-40 day', 20, 0.70], ['os_dnow', '0 day', 26, 0.49],
    ] as const) {
      await query(
        `INSERT INTO metric_snapshots (id,product_id,snapshot_date,support_volume_7d,day_30_retention)
         VALUES (?,?,date('now',?),?,?)`, [id, D, back, support, retention]);
    }
    for (const [id, field, direction] of [
      ['os_d1', 'support_volume_7d', 'rose'], ['os_d2', 'day_30_retention', 'fell'],
    ] as const) {
      await query(
        `INSERT INTO signal_events (id,product_id,source,event_type,severity,payload_json,summary)
         VALUES (?,?,'external_metric_ingest',?,'low',?,'x')`,
        [id, D, `external_metric:${field}:${direction}`, JSON.stringify({
          origin: 'test', field, direction, observed_value: 1, previous_value: 2 })]);
    }
    await setObjective({ productId: D, statement: 'Retention matters more than anything',
      channels: ['day_30_retention', 'churn_rate'] });

    const steered = await noticeWhatTheNumbersAreDoing(D);
    const channels = steered.map((n) => n.channel);
    expect(channels).toContain('day_30_retention');
    expect(channels).not.toContain('support_volume_7d');
  });

  it('never goes silent about something falling off a cliff', async () => {
    // The instruction "focus on retention" does not mean "stop telling me about
    // a revenue collapse". Obeying the letter of that would be obeying nobody.
    const { noticeWhatTheNumbersAreDoing } = await import(
      '../../src/services/institution/noticing.js');
    const E = 'os_e';
    await query("INSERT INTO products (id,name,owner_id,status) VALUES (?,'Epsilon',?,'active')",
      [E, OWNER]);
    for (const [id, back, mrr] of [['os_ethen', '-40 day', 500000], ['os_enow', '0 day', 50000]] as const) {
      await query(
        `INSERT INTO metric_snapshots (id,product_id,snapshot_date,new_mrr_cents)
         VALUES (?,?,date('now',?),?)`, [id, E, back, mrr]);
    }
    await query(
      `INSERT INTO signal_events (id,product_id,source,event_type,severity,payload_json,summary)
       VALUES ('os_e1',?,'external_metric_ingest','external_metric:new_mrr_cents:fell','low',?,'x')`,
      [E, JSON.stringify({ origin: 'test', field: 'new_mrr_cents', direction: 'fell',
        observed_value: 1, previous_value: 2 })]);
    await setObjective({ productId: E, statement: 'Only retention matters',
      channels: ['day_30_retention'] });

    const noticed = await noticeWhatTheNumbersAreDoing(E);
    expect(noticed.map((n) => n.channel)).toContain('new_mrr_cents');
    const raised = (await query(
      "SELECT rationale FROM responsibility_candidates WHERE product_id = ?", [E]))
      .rows[0] as Record<string, unknown>;
    // And it explains why it spoke anyway.
    expect(String(raised.rationale)).toContain('You told me to focus on something else');
  });
});

describe('the owner surface', () => {
  const asOwner = async (path: string, body?: string): Promise<{
    status: number; text: string; location: string | null;
  }> => {
    const { foundryShellRoutes } = await import('../../src/routes/dashboard/foundry-shell.js');
    const app = new Hono();
    app.use('*', async (c, next) => {
      c.set('founder' as never,
        { id: OWNER, email: 'owner@example.com', name: 'Owner' } as never);
      c.set('csrfToken' as never, 'test' as never);
      await next();
    });
    app.route('/', foundryShellRoutes as never);
    const res = await app.request(path, body == null ? undefined : {
      method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body,
    });
    return { status: res.status, text: await res.text(), location: res.headers.get('location') };
  };

  it('says what it will do before anything binds', async () => {
    const shown = await asOwner(`/foundry/companies/${B}/said`,
      'said=' + encodeURIComponent('Do not change pricing without asking'));
    expect(shown.status).toBe(200);
    expect(shown.text).toContain('I will not change what a company charges');
    // Predictable consequence, in the words the owner set as the standard.
    expect(shown.text).toContain('until you lift it');
    expect(shown.text).toContain('I have no way to do that today');
    // And NOTHING is bound yet.
    const none = (await boundariesFor(B)).filter((b) => b.subject === 'set_prices');
    expect(none).toEqual([]);
  });

  it('binds only on confirmation, and re-reads his words rather than the form', async () => {
    const done = await asOwner(`/foundry/companies/${B}/said/confirm`,
      'said=' + encodeURIComponent('Do not change pricing without asking'));
    expect(done.location).toBe(`/foundry/companies/${B}?done=bound`);
    expect((await boundariesFor(B)).some((b) => b.subject === 'set_prices')).toBe(true);

    // A forged subject in the form changes nothing: the subject is derived
    // again, server-side, from the sentence.
    const forged = await asOwner(`/foundry/companies/${B}/said/confirm`,
      'said=' + encodeURIComponent('Retention matters most') + '&subject=contact_people');
    expect(forged.location).toBe(`/foundry/companies/${B}?done=steered`);
    expect((await boundariesFor(B)).some((b) => b.subject === 'contact_people')).toBe(false);
  });

  it('teaches the vocabulary at the moment he needed it', async () => {
    const lost = await asOwner(`/foundry/companies/${B}/said`,
      'said=' + encodeURIComponent('Do not do anything weird'));
    expect(lost.status).toBe(200);
    expect(lost.text).toContain('What I can hold you to');
    expect(lost.text).toContain('change what a company charges');
  });

  it('shows what is held on the company, and lifts it in one tap', async () => {
    const page = await asOwner(`/foundry/companies/${B}`);
    expect(page.text).toContain('Do not change pricing without asking');

    const held = (await boundariesFor(B)).find((b) => b.subject === 'set_prices');
    if (!held) throw new Error('expected a boundary');
    const lifted = await asOwner(`/foundry/companies/${B}/boundaries/${held.id}/lift`, '');
    expect(lifted.location).toBe(`/foundry/companies/${B}?done=lifted`);
    expect((await boundariesFor(B)).some((b) => b.id === held.id)).toBe(false);
  });

  it('offers back what he lifted, because changing your mind runs both ways', async () => {
    // The same defect migration 109 fixed for a declined candidate: the record
    // kept everything and no surface offered it back, so "lift" read as
    // "forget". He should not have to remember the sentence he used.
    const page = await asOwner(`/foundry/companies/${B}`);
    expect(page.text).toContain('What you lifted');
    expect(page.text).toContain('Do not change pricing without asking');
    expect(page.text).toContain('the owner lifted it');
    expect(page.text).toContain('Hold me to this again');

    const again = await asOwner(`/foundry/companies/${B}/said/confirm`,
      'said=' + encodeURIComponent('Do not change pricing without asking'));
    expect(again.location).toBe(`/foundry/companies/${B}?done=bound`);
    expect((await boundariesFor(B)).some((b) => b.subject === 'set_prices')).toBe(true);

    // And once it is back in force it stops being offered, rather than sitting
    // there inviting him to set something he already has.
    const now = await asOwner(`/foundry/companies/${B}`);
    expect(now.text).not.toContain('Hold me to this again');
  });

  it('remembers what a company used to be for', async () => {
    await setObjective({ productId: B, statement: 'First ten paying customers', channels: [] });
    await setObjective({ productId: B, statement: 'Now it is retention', channels: [] });
    const page = await asOwner(`/foundry/companies/${B}`);
    expect(page.text).toContain('Now it is retention');
    expect(page.text).toContain('First ten paying customers');
    expect(page.text).toContain('the owner said something else');
  });

  it('will not carry a decision about someone else\'s company', async () => {
    await query('INSERT INTO founders (id,clerk_user_id,email) VALUES (?,?,?)',
      ['os_str', 'clerk_str', 'str@example.com']);
    await query("INSERT INTO products (id,name,owner_id,status) VALUES (?,?,?,'active')",
      ['os_theirs', 'Theirs', 'os_str']);
    const refused = await asOwner('/foundry/companies/os_theirs/said',
      'said=' + encodeURIComponent("Don't contact anyone"));
    expect(refused.status).toBe(404);
  });
});

describe('the rest of what he can say', () => {
  const asOwner = async (path: string, body?: string): Promise<{
    status: number; text: string; location: string | null;
  }> => {
    const { foundryShellRoutes } = await import('../../src/routes/dashboard/foundry-shell.js');
    const app = new Hono();
    app.use('*', async (c, next) => {
      c.set('founder' as never,
        { id: OWNER, email: 'owner@example.com', name: 'Owner' } as never);
      c.set('csrfToken' as never, 'test' as never);
      await next();
    });
    app.route('/', foundryShellRoutes as never);
    const res = await app.request(path, body == null ? undefined : {
      method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body,
    });
    return { status: res.status, text: await res.text(), location: res.headers.get('location') };
  };

  it('hears the eight kinds as the eight things they are', () => {
    const kinds = [
      ['Get the first ten paying customers', 'objective'],
      ['Retention matters more than acquisition', 'objective'],
      ["Don't contact anyone", 'boundary'],
      ['Never change pricing without asking me', 'boundary'],
      ['Spend no more than $25 testing this', 'allowance'],
      ['I would rather grow organically than buy ads', 'preference'],
      ['Stop working on that', 'stop'],
    ] as const;
    for (const [said, kind] of kinds) expect(interpret(said).kind, said).toBe(kind);
    // And the two boundary kinds are distinguished.
    const asked = interpret('Never change pricing without asking me');
    if (asked.kind === 'boundary') expect(asked.mode).toBe('ask_first');
  });

  it('reads a budget as a ceiling, in cents so nothing rounds', () => {
    const read = interpret('Spend up to $12.50 testing this idea');
    expect(read.kind).toBe('allowance');
    if (read.kind === 'allowance') {
      expect(read.amountCents).toBe(1250);
      // His sentence is the purpose. Categorising it would be Foundry deciding
      // what he meant the money was for.
      expect(read.purpose).toContain('testing this idea');
    }
  });

  it('does not read "spend nothing" as a budget', () => {
    // A refusal and a ceiling are opposite instructions and both mention money.
    const read = interpret('Do not spend anything');
    expect(read.kind).toBe('boundary');
  });

  it('enforces the ceiling at the money door, and says what is left', async () => {
    const { companyMayIncurCost } = await import('../../src/services/ai/client.js');
    expect(await companyMayIncurCost(ALLOW)).toBeNull();

    await asOwner(`/foundry/companies/${ALLOW}/said/confirm`,
      'said=' + encodeURIComponent('Spend up to $5 testing this'));
    const live = await allowanceFor(ALLOW);
    expect(live?.amountCents).toBe(500);
    expect(await companyMayIncurCost(ALLOW)).toBeNull();

    // Spend it, through the ledger the ceilings already use rather than a
    // second counter kept beside it.
    await query(
      `INSERT INTO ai_daily_spend (scope, scope_id, date, spent_cents, updated_at)
       VALUES ('product', ?, date('now'), 500, datetime('now'))`, [ALLOW]);
    expect(await allowanceFor(ALLOW)).toMatchObject({ remainingCents: 0 });
    expect(await companyMayIncurCost(ALLOW)).toBe('the $5.00 you allowed is spent');
  });

  it('lets an allowance carve an exception to a spend boundary', async () => {
    // "Don't spend anything — except up to $25 testing this" is what a person
    // means when they say both, and it has to work in that order.
    const { companyMayIncurCost } = await import('../../src/services/ai/client.js');
    await setBoundary({ productId: EXCEPT, subject: 'spend_money',
      statement: 'Do not spend anything on this' });
    expect(await companyMayIncurCost(EXCEPT)).toContain('Do not spend anything on this');

    await setAllowance({ productId: EXCEPT, statement: 'except up to $9 testing this',
      amountCents: 900, purpose: 'testing this' });
    expect(await companyMayIncurCost(EXCEPT)).toBeNull();

    // Exhausted, the boundary is simply back.
    await query(
      `INSERT INTO ai_daily_spend (scope, scope_id, date, spent_cents, updated_at)
       VALUES ('product', ?, date('now'), 900, datetime('now'))`, [EXCEPT]);
    expect(await companyMayIncurCost(EXCEPT)).toContain('Do not spend anything on this');
  });

  it('says plainly that a preference refuses nothing', async () => {
    const shown = await asOwner(`/foundry/companies/${PREF}/said`,
      'said=' + encodeURIComponent('I would rather grow organically than buy ads'));
    expect(shown.text).toContain('I will not refuse anything because of this');
    expect(shown.text).toContain('difference between a preference and a boundary');

    await asOwner(`/foundry/companies/${PREF}/said/confirm`,
      'said=' + encodeURIComponent('I would rather grow organically than buy ads'));
    const page = await asOwner(`/foundry/companies/${PREF}`);
    expect(page.text).toContain('grow organically');
    expect(page.text).toContain('I refuse');
  });

  it('shows what it would stop before stopping it', async () => {
    await setObjective({ productId: PREF, statement: 'Ship the mobile app', channels: [] });
    const shown = await asOwner(`/foundry/companies/${PREF}/said`,
      'said=' + encodeURIComponent('Stop working on that'));
    // A stop aimed at the wrong thing is worse than no stop.
    expect(shown.text).toContain('Ship the mobile app');
    expect(shown.text).toContain('Nothing else changes');

    const done = await asOwner(`/foundry/companies/${PREF}/said/confirm`,
      'said=' + encodeURIComponent('Stop working on that'));
    expect(done.location).toBe(`/foundry/companies/${PREF}?done=stopped`);
    expect(await objectiveFor(PREF)).toBeNull();
  });

  it('says there was nothing to stop rather than reporting a silent success', async () => {
    const shown = await asOwner(`/foundry/companies/${PREF}/said`,
      'said=' + encodeURIComponent('Stop working on that'));
    expect(shown.text).toContain('There is nothing to stop');
  });
});
