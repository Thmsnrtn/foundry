process.env.TURSO_DATABASE_URL = 'file::memory:';

import { beforeAll, describe, expect, it } from 'vitest';
import { runMigrations } from '../../src/db/migrate.js';
import { query } from '../../src/db/client.js';
import { establishSystemIdentity, resolveFoundryProductId } from '../../src/services/system-identity.js';

// =============================================================================
// Fail-closed semantics under SQLite three-valued logic.
//
// A `SELECT RAISE(ABORT,…) WHERE <predicate>` fires only when the predicate is
// TRUE. A missing JSON key or a NULL column makes it NULL, and a NULL predicate
// does not fire — so the guard accepts exactly the input it was written to
// refuse. Migrations 127 and 128 each fixed one instance; migration 130 fixes
// the two the systematic audit found.
//
// Each case below uses the exact missing/NULL shape that defeated the original
// guard, and each is paired with a legitimate insert proving the repair did not
// simply close the door on everything.
// =============================================================================

const OWNER = 'ns_owner';

async function countOf(sql: string, args: unknown[] = []): Promise<number> {
  return Number(((await query(sql, args)).rows[0] as Record<string, unknown>).n);
}

beforeAll(async () => {
  await runMigrations();
  await query("INSERT INTO founders (id,clerk_user_id,email) VALUES (?,'ns_clerk','owner@example.com')", [OWNER]);
  await query(`INSERT INTO products (id,name,owner_id) VALUES
    ('ns_co','Nullsafe Co',?),('ns_other','Other Co',?)`, [OWNER, OWNER]);
  await query(`INSERT INTO signal_events (id,product_id,source,event_type,severity,payload_json,summary)
    VALUES ('ns_sig','ns_co','company_observation_baseline','company_observation_baseline:observed','low','{}','Evidence')`, []);
  await query(`INSERT INTO institutional_responsibilities (id,product_id,title,capability,state) VALUES
    ('ns_a','ns_co','A','customer_support','visible'),('ns_b','ns_co','B','development','visible')`, []);
});

describe('guards fail closed when values are absent', () => {
  it('refuses an institutional judgment carrying no evidence at all', async () => {
    // The exact shape that slipped through: real responsibilities, real
    // tenancy, and `evidence_refs_json` left NULL. `json_valid(NULL)=0 OR
    // json_array_length(NULL)=0` is NULL, so the provenance refusal never fired
    // — while every downstream guard treats `responsibility_refs_json IS NOT
    // NULL` as the mark of an institutional judgment. An owner could have
    // directed a judgment with nothing behind it.
    await expect(query(
      `INSERT INTO strategic_decisions_log
         (id,product_id,decision_title,decision_description,responsibility_refs_json)
       VALUES ('ns_j1','ns_co','No evidence','None','["ns_a","ns_b"]')`, []))
      .rejects.toThrow(/provenance_required/);

    await expect(query(
      `INSERT INTO strategic_decisions_log
         (id,product_id,decision_title,decision_description,responsibility_refs_json,evidence_refs_json)
       VALUES ('ns_j2','ns_co','Explicit null','None','["ns_a","ns_b"]',NULL)`, []))
      .rejects.toThrow(/provenance_required/);

    // An empty array was already refused, and still is.
    await expect(query(
      `INSERT INTO strategic_decisions_log
         (id,product_id,decision_title,decision_description,responsibility_refs_json,evidence_refs_json)
       VALUES ('ns_j3','ns_co','Empty','None','["ns_a","ns_b"]','[]')`, []))
      .rejects.toThrow(/provenance_required/);

    expect(await countOf("SELECT COUNT(*) n FROM strategic_decisions_log WHERE product_id='ns_co'")).toBe(0);
  });

  it('still accepts a properly grounded judgment', async () => {
    // The repair must refuse the absent case without refusing the real one.
    await query(
      `INSERT INTO strategic_decisions_log
         (id,product_id,decision_title,decision_description,responsibility_refs_json,evidence_refs_json)
       VALUES ('ns_ok','ns_co','Grounded','Real','["ns_a","ns_b"]','["signal_event:ns_sig"]')`, []);
    expect(await countOf("SELECT COUNT(*) n FROM strategic_decisions_log WHERE id='ns_ok'")).toBe(1);

    // And the tenant check it sits beside is untouched.
    await expect(query(
      `INSERT INTO strategic_decisions_log
         (id,product_id,decision_title,decision_description,responsibility_refs_json,evidence_refs_json)
       VALUES ('ns_cross','ns_other','Cross','Real','["ns_a","ns_b"]','["signal_event:ns_sig"]')`, []))
      .rejects.toThrow(/tenant_invalid/);
  });

  it('refuses a NULL-keyed system identity that would squat the canonical slot', async () => {
    // SQLite permits NULL in a TEXT PRIMARY KEY. That defeated two checks at
    // once: `NULL NOT IN ('foundry')` is NULL, and `s.identity_key=NULL`
    // matches nothing. The resulting row is not junk — `product_id` is UNIQUE,
    // so it would occupy the canonical product's slot forever and make the real
    // identity permanently unclaimable.
    await expect(query(
      'INSERT INTO system_identities (identity_key,product_id,established_reason) VALUES (NULL,?,?)',
      ['ns_co', 'squat the slot'],
    )).rejects.toThrow(/unknown_identity/);
    expect(await countOf('SELECT COUNT(*) n FROM system_identities')).toBe(0);

    // The real claim still works, and is still the only one that can be made.
    expect(await establishSystemIdentity('foundry', 'ns_co', 'test: the Foundry company'))
      .toEqual({ established: true, productId: 'ns_co' });
    expect(await resolveFoundryProductId()).toBe('ns_co');
    await expect(query(
      'INSERT INTO system_identities (identity_key,product_id,established_reason) VALUES (?,?,?)',
      ['foundry', 'ns_other', 'take it'],
    )).rejects.toThrow(/already_claimed/);
    await expect(query(
      'INSERT INTO system_identities (identity_key,product_id,established_reason) VALUES (?,?,?)',
      ['platform', 'ns_other', 'invent a key'],
    )).rejects.toThrow(/unknown_identity/);
  });

  it('refuses an identity with a missing reason', async () => {
    // `trim(NULL)=''` is NULL too, so the reason requirement had the same shape.
    await expect(query(
      'INSERT INTO system_identities (identity_key,product_id,established_reason) VALUES (?,?,NULL)',
      ['foundry', 'ns_other'],
    )).rejects.toThrow(/unknown_identity|already_claimed|reason_required|NOT NULL/);
  });
});
