process.env.TURSO_DATABASE_URL = 'file::memory:';
process.env.ENCRYPTION_KEY = '0'.repeat(64);
process.env.FOUNDRY_INSTANCE_POSTURE = 'private_owner';
process.env.FOUNDRY_OWNER_EMAIL = 'owner@example.com';

import { beforeAll, describe, expect, it } from 'vitest';
import { runMigrations } from '../../src/db/migrate.js';
import { query } from '../../src/db/client.js';
import { placeOf } from '../../src/services/founder/place.js';
import { ANCHOR_CENTS } from '../../src/services/founder/portfolio.js';

// =============================================================================
// THE MAP MAY NOT INVENT THE TERRITORY.
//
// A page that shows the institution to its owner is read as the institution. So
// every label on it has to be a projection of something the institution
// actually holds, and where it is arithmetic it has to be the SAME arithmetic,
// drawn in one place. Three ways that failed here, each caught before he saw
// it:
//
//   A SECOND COPY OF THE LINE. The asset page carried its own thousand-dollar
//   figure. The number was right; the duplication was the defect, because the
//   day the canonical line moves the two pages disagree about one company.
//
//   A BRACKET WEARING AN IDENTITY. Anchor and tributary are River layers —
//   membership by what a company earns. Posture is what the institution DOES
//   with an asset, and it is set by decision. A chip that reads like a role
//   invites him to think a revenue threshold changed what the thing is.
//
//   GEOGRAPHY THAT MOVES WHEN THE NEWS IS BAD. The Customers place existed only
//   while a provider answered, so it vanished at the moment it had something
//   worth saying.
// =============================================================================

const OWNER = 'map_owner';

beforeAll(async () => {
  await runMigrations();
  await query('INSERT INTO founders (id,clerk_user_id,email,name) VALUES (?,?,?,?)',
    [OWNER, 'clerk_map', 'owner@example.com', 'Owner']);
  await query(
    `INSERT INTO products (id,name,owner_id,status,scp_status,posture)
     VALUES (?,?,?,'active','active','hold')`, ['map_p', 'Steady Co', OWNER]);
});

async function earning(cents: number): Promise<void> {
  await query('DELETE FROM metric_snapshots WHERE product_id = ?', ['map_p']);
  await query(
    `INSERT INTO metric_snapshots (id, product_id, snapshot_date, mrr_cents)
     VALUES (?,?,date('now'),?)`, [`ms_${String(cents)}`, 'map_p', cents]);
}

describe('a revenue bracket is not an identity', () => {
  it('draws the line where the portfolio draws it, not from its own copy', async () => {
    // If this file ever restates the figure, moving the canonical one leaves
    // the asset page disagreeing with the portfolio page about one company.
    const src = await import('node:fs/promises')
      .then((fs) => fs.readFile('src/services/founder/place.ts', 'utf8'));
    expect(src).toContain('ANCHOR_CENTS');
    expect(src).not.toMatch(/\b100_000\b|\b100000\b/);
  });

  it('does not change what the asset IS when it crosses the line', async () => {
    // $999.99 and $1,000.00 either side of the canonical figure.
    await earning(ANCHOR_CENTS - 1);
    const below = await placeOf(OWNER, 'map_p');
    await earning(ANCHOR_CENTS);
    const onIt = await placeOf(OWNER, 'map_p');

    // The layer it falls in changes, because that is arithmetic and he is meant
    // to be able to argue with it.
    expect(below!.chips.some((c) => c.includes('tributaries'))).toBe(true);
    expect(onIt!.chips.some((c) => c.includes('anchors'))).toBe(true);
    // And it says it is arithmetic rather than asserting a role.
    expect(onIt!.chips.some((c) => c.includes('by what it earns'))).toBe(true);

    // NOTHING THE INSTITUTION DECIDES MOVED. Posture is the role, and one more
    // cent of revenue is not a decision about what to do with an asset.
    const posture = (await query('SELECT posture, standing FROM products WHERE id = ?', ['map_p']))
      .rows[0] as Record<string, unknown>;
    expect(String(posture.posture)).toBe('hold');
    expect(String(posture.standing)).toBe('earned');
    // The dimensions he can navigate to are the same on both sides of it.
    expect(onIt!.dimensions.map((d) => d.key)).toEqual(below!.dimensions.map((d) => d.key));
  });

  it('says it cannot see, rather than filing it as small', async () => {
    await query('DELETE FROM metric_snapshots WHERE product_id = ?', ['map_p']);
    const blind = await placeOf(OWNER, 'map_p');
    expect(blind!.chips).toContain('not reporting revenue');
    expect(blind!.chips.some((c) => c.includes('tributaries'))).toBe(false);
  });
});

describe('a place does not disappear because the news is bad', () => {
  it('keeps Customers through connected to disconnected, as a transition', async () => {
    // NOT TWO SNAPSHOTS. The failure was in the change: the address existed,
    // then a provider went dark, and the address he had learned was gone.
    await query(
      `INSERT INTO company_senses
         (id, product_id, sense_key, provider, mode, disclosure, connected_at)
       VALUES ('cs_map','map_p','customers','stripe','real',
               'I will read who is paying you and how much.', datetime('now'))`);
    const connected = await placeOf(OWNER, 'map_p');
    expect(connected!.dimensions.map((d) => d.key)).toContain('customers');

    await query(
      `UPDATE company_senses SET disconnected_at = datetime('now'),
         disconnect_reason = 'the provider stopped answering' WHERE id = 'cs_map'`);
    const afterwards = await placeOf(OWNER, 'map_p');
    expect(afterwards!.dimensions.map((d) => d.key)).toContain('customers');
  });

  it('still draws no Customers place for an asset that never had one', async () => {
    // The other way to be lost is six empty addresses on everything.
    await query(
      `INSERT INTO products (id,name,owner_id,status,scp_status)
       VALUES ('map_q','Never Saw Anyone',?, 'active','active')`, [OWNER]);
    const bare = await placeOf(OWNER, 'map_q');
    expect(bare!.dimensions.map((d) => d.key)).not.toContain('customers');
    // Overview and Work are always there: "is anything happening here" must
    // have an address even when the answer is no.
    expect(bare!.dimensions.map((d) => d.key)).toEqual(['overview', 'work']);
  });
});

describe('the page that explains authority does not contradict the thing that holds it', () => {
  it('does not tell him every act waits for his yes when he has delegated one',
    async () => {
      // THE FALSE REASSURANCE RAN THE OTHER WAY. This read boundaries and
      // allowances only, and with both empty asserted that nothing happens
      // without him — on an asset where he had put the institution in charge of
      // something, with a purpose and a ceiling and an expiry.
      const { whyOf } = await import('../../src/services/founder/why.js');
      await query(
        `INSERT INTO business_actors (id, founder_id, product_id, kind, display_name)
         VALUES ('act_map', ?, 'map_p', 'company', 'Steady Co')`, [OWNER]);
      await query(
        `INSERT INTO delegations
           (id, founder_id, actor_id, product_id, class, responsibility, act_class,
            content_scope, purpose, audience, excludes, ceiling, granted_by, expires_at)
         VALUES ('del_map', ?, 'act_map', 'map_p', 'standing', 'keep the listing current',
                 'publish', 'own_facts', 'keep the listing current', 'public',
                 'nothing about a named person', 'public', ?, datetime('now','+30 days'))`,
        [OWNER, `founder:${OWNER}`]);

      const why = await whyOf(OWNER, 'company', 'map_p');
      const said = (why?.authority ?? []).join(' ');
      expect(said).toContain('keep the listing current');
      expect(said).toContain('I do that without asking');
      expect(said).not.toContain('every act is proposed and waits for your yes');
    });

  it('distinguishes being accountable from being allowed', async () => {
    // Responsibility without action authority is its own sentence. Collapsing
    // it into "nothing is granted" loses the thing he is actually being told.
    const { whyOf } = await import('../../src/services/founder/why.js');
    await query(
      `INSERT INTO products (id,name,owner_id,status,scp_status)
       VALUES ('map_r','Watched Co',?, 'active','active')`, [OWNER]);
    await query(
      `INSERT INTO institutional_responsibilities (id, product_id, title, state)
       VALUES ('resp_map', 'map_r', 'keep the dependency list honest', 'understood')`);

    const why = await whyOf(OWNER, 'company', 'map_r');
    const said = (why?.authority ?? []).join(' ');
    expect(said).toContain('accountable');
    expect(said).toContain('not the same as being allowed');
  });

  it('does not present a reconstruction as a remembered deliberation', async () => {
    // "Assumptions" and "alternatives" claimed the institution had weighed
    // premises and other courses at judgement time. It had not: the page was
    // assembling them today, and one "alternative" was a generic "not doing it"
    // appended to every act.
    const src = await import('node:fs/promises')
      .then((fs) => fs.readFile('src/routes/dashboard/places.ts', 'utf8'));
    expect(src).toContain('What this rests on');
    expect(src).not.toContain("level('Assumptions'");
    expect(src).not.toContain("level('Alternatives'");
    const why = await import('node:fs/promises')
      .then((fs) => fs.readFile('src/services/founder/why.js'.replace('.js', '.ts'), 'utf8'));
    expect(why).not.toContain('Not doing it. Nothing happens');
  });
});
