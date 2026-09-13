process.env.TURSO_DATABASE_URL = 'file::memory:';
process.env.ENCRYPTION_KEY = '4'.repeat(64);
process.env.FOUNDRY_INSTANCE_POSTURE = 'private_owner';
process.env.FOUNDRY_OWNER_EMAIL = 'owner@example.com';

import { beforeAll, describe, expect, it } from 'vitest';
import { runMigrations } from '../../src/db/migrate.js';
import { query } from '../../src/db/client.js';
import { consequenceOfAct, isCannotSay, labelFor } from '../../src/services/founder/what-it-would-do.js';

// =============================================================================
// AN ACT SAYS WHERE IT LANDS.
//
// On 10 September nine buttons read "Go ahead" and one of them wrote to
// strangers. The consequence ladder already placed every proposed act on a rung
// — observe, prepare, reversible, public, financial, legal, destructive — and
// nothing turned the rung into the five facts a decision needs: what happens,
// where it lands, what it can cost, whether it can be undone, what it does not
// authorise. These hold that derivation to the ladder, and hold the one case
// where no button may exist: an act that was never placed on it.
// =============================================================================

const OWNER = 'lands_owner';
async function act(id: string, rung: string | null, subject: string, cents: number | null = 0, summary = `do the ${id} thing`): Promise<void> {
  // AN ACT NEEDS A STANDING ASK-FIRST ON ITS SUBJECT, or the row guard refuses
  // it as noise: the owner asked to be consulted about these subjects.
  await query(`INSERT INTO owner_boundaries (id, product_id, subject, statement, mode)
    VALUES (?, 'lands_p', ?, ?, 'ask_first') ON CONFLICT(id) DO NOTHING`, [`b_${subject}`, subject, `ask me before you ${subject.replaceAll('_', ' ')}`]);
  await query(
    `INSERT INTO proposed_acts (id, product_id, subject, action_type, params_fingerprint, summary, why, expected_effect,
        risk, consequence, proposed_by, expires_at, rung, cost_cents)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,datetime('now','+3 day'),?,?)`,
    [id, 'lands_p', subject, 'workshop_change', `fp_${id}`, summary, 'because', 'an effect', 'a risk', 'low', 'hand:test', rung, cents]);
}

beforeAll(async () => {
  await runMigrations();
  await query('INSERT INTO founders (id,clerk_user_id,email,name) VALUES (?,?,?,?)', [OWNER, 'clerk_lands', 'owner@example.com', 'Owner']);
  await query(`INSERT INTO products (id,name,owner_id,status) VALUES ('lands_p','Tidewater',?,'active')`, [OWNER]);
  await act('observe', 'observe', 'change_software', 0, 'read the checkout funnel logs');
  await act('prepare', 'prepare', 'change_software', 0, 'draft the pricing page on a branch');
  await act('public', 'public', 'publish', 0, 'publish the pricing page');
  await act('person', 'public', 'contact_people', 0, 'email sales@example.com asking for a quote');
  await act('financial', 'financial', 'spend_money', 4000, 'buy a month of Stripe Radar');
  await act('legal', 'legal', 'commit_on_my_behalf', 0, 'accept the data processing agreement');
  await act('destructive', 'destructive', 'change_software', 0, 'delete the old staging server');
  await act('unplaced', null, 'change_software', 0, 'something with no rung');
});

describe('the five facts, from the rung and the subject', () => {
  it('looking, drafting and reversible changes land inside Foundry and touch nobody', async () => {
    for (const id of ['observe', 'prepare']) {
      const c = await consequenceOfAct(id);
      expect(isCannotSay(c)).toBe(false);
      if (isCannotSay(c)) return;
      expect(c.effect).toBe('internal');
      expect(c.touches).toBe('nobody');
      expect(c.reversibility).toBe('reversible');
      expect(c.doesNotAuthorise).toContain('contacting anybody');
      expect(labelFor(c)).toContain('nobody contacted');
    }
  });

  it('a public act is a person when somebody is named, and a page when nobody is', async () => {
    const page = await consequenceOfAct('public');
    const person = await consequenceOfAct('person');
    if (isCannotSay(page) || isCannotSay(person)) throw new Error('both should be stateable');
    expect(page.effect).toBe('public');
    expect(page.touches).toBe('anybody who reads it');
    expect(person.effect).toBe('person');
    expect(person.touches).toContain('sales@example.com');
    expect(person.reversibility).toBe('partly_reversible');
    // THE LABEL CARRIES THE CLASS. "do the person thing · person-facing · $0"
    // cannot be mistaken for "do the observe thing · $0 · nobody contacted".
    expect(labelFor(person)).toContain('person-facing');
  });

  it('spending lands at a provider on the company\'s account, and the cost never stands alone', async () => {
    const c = await consequenceOfAct('financial');
    if (isCannotSay(c)) throw new Error('should be stateable');
    expect(c.effect).toBe('provider');
    expect(c.touches).toContain("Tidewater's account");
    expect(c.maxCents).toBe(4000);
    expect(labelFor(c)).toMatch(/provider-facing .* \$40\.00/);
  });

  it('a commitment or a destruction is not reversible, and changes something he holds elsewhere', async () => {
    for (const id of ['legal', 'destructive']) {
      const c = await consequenceOfAct(id);
      if (isCannotSay(c)) throw new Error('should be stateable');
      expect(c.effect).toBe('account');
      expect(c.reversibility).toBe('irreversible');
    }
  });

  it('an act never placed on the ladder gets no button', async () => {
    const c = await consequenceOfAct('unplaced');
    expect(isCannotSay(c)).toBe(true);
    if (isCannotSay(c)) expect(c.cannotSay).toContain('consequence ladder');
  });

  it('and neither does an act that does not exist', async () => {
    expect(isCannotSay(await consequenceOfAct('nope'))).toBe(true);
  });
});
