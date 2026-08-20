process.env.TURSO_DATABASE_URL = 'file::memory:';
process.env.ENCRYPTION_KEY = '0'.repeat(64);

import { beforeAll, describe, expect, it } from 'vitest';
import { runMigrations } from '../../src/db/migrate.js';
import { query } from '../../src/db/client.js';
import {
  exportFounderData, founderDataSources, FOUNDER_SCOPED_REASONS,
  EXCLUDED_FROM_EXPORT_REASONS,
} from '../../src/services/privacy/consent.js';

// =============================================================================
// A PERSON COULD BE ERASED AND COULD NOT ASK WHAT WAS HELD.
//
// Every export on the privacy page answered for a COMPANY. `FOUNDER_SCOPED`
// names twelve tables that are the PERSON'S rather than any company's — their
// voice, their devices, their peer profile, their referral history — and
// `PERSON_ACROSS_COMPANIES` names their own activity inside companies they do
// not own. Both maps existed only so an erasure could clear them; nothing read
// either to answer "what do you have about me?"
//
// And the erasure fires from the identity provider's `user.deleted` webhook, so
// there was no Foundry surface where a person asks to be erased, and therefore
// no moment at which they could be offered their data first.
//
// Derived from the same two maps, so a table cannot be erasable and unaskable
// at once.
// =============================================================================

const ME = 'wfh_me';
const SOMEBODY_ELSE = 'wfh_other';

beforeAll(async () => {
  await runMigrations();
  for (const [id, email] of [[ME, 'me@example.com'], [SOMEBODY_ELSE, 'other@example.com']]) {
    await query(`INSERT INTO founders (id,clerk_user_id,email,name) VALUES (?,?,?,?)`,
      [id, `clerk_${id}`, email, `Name ${id}`]);
  }
  // A table that is the person's, not any company's.
  await query(
    `INSERT INTO push_subscriptions (id, founder_id, endpoint, apns_device_token, platform)
     VALUES ('wfh_ps', ?, 'https://push.example/abc', 'a-real-device-token', 'ios')`, [ME]);
  await query(
    `INSERT INTO push_subscriptions (id, founder_id, endpoint, apns_device_token, platform)
     VALUES ('wfh_ps2', ?, 'https://push.example/zzz', 'another-token', 'ios')`, [SOMEBODY_ELSE]);
});

describe('a person asking what Foundry holds about them', () => {
  it('receives their own rows', async () => {
    const out = await exportFounderData(ME);
    expect(out.founders, 'the account row is theirs').toHaveLength(1);
    expect(out.push_subscriptions).toHaveLength(1);
    expect(JSON.stringify(out.push_subscriptions)).toContain('push.example/abc');
  });

  it('receives nobody else’s', async () => {
    const out = await exportFounderData(ME);
    expect(JSON.stringify(out)).not.toContain('push.example/zzz');
    expect(JSON.stringify(out)).not.toContain('other@example.com');
  });

  it('is told a credential exists without being handed it', async () => {
    const out = await exportFounderData(ME);
    const [row] = out.push_subscriptions as Array<Record<string, unknown>>;
    expect(row.apns_device_token, 'a subject access request is not a key extraction')
      .toBe('[redacted]');
    expect(row.endpoint, 'and the row still shows that the device exists')
      .toContain('push.example/abc');
  });
});

describe('the export and the account erasure agree', () => {
  it('asks about every table the erasure would clear or sever', () => {
    const sources = new Set(founderDataSources().map((s) => s.table));
    const unanswerable = Object.keys(FOUNDER_SCOPED_REASONS)
      .filter((t) => !(t in EXCLUDED_FROM_EXPORT_REASONS))
      .filter((t) => !sources.has(t));
    expect(unanswerable,
      'a table an account erasure clears must be one the person can ask about')
      .toEqual([]);
  });

  it('reaches beyond the founder-scoped tables into other people’s companies', () => {
    // Guards the assertion above from passing on the easy half. A person's own
    // activity inside a company they do not own is theirs too.
    const sources = founderDataSources().map((s) => s.table);
    const beyond = sources.filter((t) => !(t in FOUNDER_SCOPED_REASONS));
    expect(beyond.length).toBeGreaterThan(3);
  });

  it('can actually run every query it claims to make', async () => {
    // The export skips a table whose query throws, so a wrong column name would
    // make the file quietly incomplete rather than wrong — silence looking like
    // success, which is the failure this campaign keeps finding. Asked here
    // directly: every predicate executes against the live schema.
    const broken: string[] = [];
    for (const source of founderDataSources()) {
      const args = [
        ...Array<string>(source.binds).fill(ME),
        ...Array<string>(source.emailBinds).fill('me@example.com'),
      ];
      try {
        await query(`SELECT COUNT(*) FROM ${source.table} WHERE ${source.predicate}`, args);
      } catch (err) {
        broken.push(`${source.table}: ${String(err)}`);
      }
    }
    expect(broken, 'a predicate that throws is a table silently omitted').toEqual([]);
  });

  it('binds every placeholder it declares', () => {
    // The predicate and the bind count are built together and used apart; a
    // mismatch is a silent wrong-row query rather than an error.
    for (const source of founderDataSources()) {
      const placeholders = (source.predicate.match(/\?/g) ?? []).length;
      expect(placeholders, `${source.table} declares its own binds`)
        .toBe(source.binds + source.emailBinds);
    }
  });
});
