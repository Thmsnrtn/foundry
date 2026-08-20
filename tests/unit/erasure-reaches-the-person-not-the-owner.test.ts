// =============================================================================
// Tests: erasing a PERSON, in companies they do not own.
//
// `eraseFounderAccount` begins:
//
//   SELECT id FROM products WHERE owner_id = ?
//
// and everything it does after that is scoped to those companies, plus the
// sixteen tables named founder-scoped. Team membership is not a vestigial
// feature — `getVisibleProducts` unions owned products with `team_members`
// rows, so a member works inside a company somebody else owns, and everything
// they do there carries their founder id.
//
// So an account erasure left the person's id, their email, their written
// words and their conversations sitting in other people's companies, and the
// end-to-end sweep could not see any of it: every row it seeds belongs to a
// product the erased founder owns, which is the one case the by-product plan
// already handles.
//
// This is the harder half of the problem, because the rows are not only
// theirs. A vote on another company's decision is part of that company's
// decision record; the words in it are the person's. The rule established for
// introductions and referral conversions applies — sever the person, keep the
// other party's record — and where nothing of the other party's survives the
// removal, delete.
// =============================================================================

process.env.TURSO_DATABASE_URL = 'file::memory:';
process.env.ENCRYPTION_KEY = '0'.repeat(64);

import { beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { runMigrations } from '../../src/db/migrate.js';
import { query } from '../../src/db/client.js';
import { eraseFounderAccount } from '../../src/services/privacy/consent.js';

const LEAVING = 'ZZLEAVINGZZ';        // the person being erased
const HOST = 'ZZHOSTZZ';              // owns the company they are a member of
const HOSTCO = 'ZZHOSTCOZZ';
const LEAVING_EMAIL = 'ZZLEAVINGMAILZZ@example.com';

beforeAll(async () => {
  await runMigrations();
});

beforeEach(async () => {
  for (const t of ['decision_votes', 'decisions', 'chat_messages', 'chat_sessions',
    'team_invitations', 'team_members', 'products', 'founders']) {
    await query(`DELETE FROM ${t}`);
  }
  await query(`INSERT INTO founders (id, clerk_user_id, email) VALUES (?,?,?)`,
    [LEAVING, 'clerk_leaving', LEAVING_EMAIL]);
  await query(`INSERT INTO founders (id, clerk_user_id, email) VALUES (?,?,?)`,
    [HOST, 'clerk_host', 'host@example.com']);
  await query(
    `INSERT INTO products (id, name, owner_id, status, scp_status)
     VALUES (?, 'Host Co', ?, 'active', 'active')`, [HOSTCO, HOST]);
  // The leaving person is a MEMBER here. They own nothing.
  await query(
    `INSERT INTO team_members (id, product_id, founder_id, role, status, invited_by)
     VALUES ('tm1', ?, ?, 'advisor', 'active', ?)`, [HOSTCO, LEAVING, HOST]);
  await query(
    `INSERT INTO team_invitations (id, product_id, email, role, token, invited_by, expires_at)
     VALUES ('ti1', ?, ?, 'advisor', 'tok_zz', ?, datetime('now','+7 days'))`,
    [HOSTCO, LEAVING_EMAIL, HOST]);
  await query(
    `INSERT INTO chat_sessions (id, product_id, founder_id, title, status)
     VALUES ('cs1', ?, ?, 'What should we do', 'active')`, [HOSTCO, LEAVING]);
  await query(
    `INSERT INTO chat_messages (id, session_id, role, content)
     VALUES ('cm1', 'cs1', 'founder', 'Something I said in confidence')`);
});

describe('erasing a person reaches the companies they do not own', () => {
  it('removes their membership of somebody else\'s company', async () => {
    const out = await eraseFounderAccount(LEAVING);
    expect(out.founderRedacted).toBe(true);
    const left = await query(
      `SELECT id FROM team_members WHERE founder_id = ?`, [LEAVING]);
    expect(left.rows, 'an erased person still has access to a live company')
      .toHaveLength(0);
  });

  it('removes their email from an invitation in somebody else\'s company', async () => {
    await eraseFounderAccount(LEAVING);
    const left = await query(
      `SELECT id FROM team_invitations WHERE email = ?`, [LEAVING_EMAIL]);
    expect(left.rows, 'their email address survived verbatim').toHaveLength(0);
  });

  it('removes the conversations they had there', async () => {
    await eraseFounderAccount(LEAVING);
    const sessions = await query(
      `SELECT id FROM chat_sessions WHERE founder_id = ?`, [LEAVING]);
    expect(sessions.rows).toHaveLength(0);
    const messages = await query(
      `SELECT id FROM chat_messages WHERE session_id = 'cs1'`, []);
    expect(messages.rows, 'the session went and its messages were orphaned, not erased')
      .toHaveLength(0);
  });

  it('does not take the host company down with them', async () => {
    // The other side of the rule. Erasing a member must not erase the company
    // they were a member of, or anything of the owner's.
    await eraseFounderAccount(LEAVING);
    const co = await query(`SELECT status FROM products WHERE id = ?`, [HOSTCO]);
    expect(co.rows, 'the host company was erased along with its member').toHaveLength(1);
    expect((co.rows[0] as Record<string, unknown>).status).toBe('active');
    const host = await query(`SELECT email FROM founders WHERE id = ?`, [HOST]);
    expect((host.rows[0] as Record<string, unknown>).email).toBe('host@example.com');
  });
});

describe('the cross-company map is total', () => {
  it('names every table where a person can appear inside a company', async () => {
    // Same rule as the by-product classification: a table nobody decided about
    // is a table the erasure steps around in silence. Derived from the live
    // schema so a table added next year joins this list by failing, not by
    // being forgotten.
    const { PERSON_ACROSS_COMPANIES_DISPOSITIONS } = await import(
      '../../src/services/privacy/consent.js');
    const ACTOR = ['founder_id', 'actor_id', 'invited_by', 'created_by',
      'decided_by_founder_id', 'reviewer_id', 'requested_by', 'user_id'];

    const tables = ((await query(
      `SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'`, []))
      .rows as unknown as Array<Record<string, unknown>>).map((r) => String(r.name));

    const unclassified: string[] = [];
    for (const t of tables) {
      const cols = ((await query(`SELECT name FROM pragma_table_info('${t}')`, []))
        .rows as unknown as Array<Record<string, unknown>>).map((r) => String(r.name));
      if (!cols.includes('product_id')) continue;
      if (!cols.some((c) => ACTOR.includes(c))) continue;
      if (!(t in PERSON_ACROSS_COMPANIES_DISPOSITIONS)) unclassified.push(t);
    }
    expect(unclassified,
      `these hold a person inside a company and nobody decided what happens to them: ${unclassified.join(', ')}`)
      .toEqual([]);
  });

  it('states a reason for every disposition, and none is deferred any more', async () => {
    const { PERSON_ACROSS_COMPANIES_DISPOSITIONS } = await import(
      '../../src/services/privacy/consent.js');
    for (const [table, d] of Object.entries(PERSON_ACROSS_COMPANIES_DISPOSITIONS)) {
      expect(d.reason.length, `${table} must say why`).toBeGreaterThan(15);
      // `owner_decision` is gone: the owner answered §10 with split-by-kind —
      // authority revoked, artefact preserved and its author severed. A
      // disposition that means "nobody has decided" must not come back without
      // somebody putting it there on purpose.
      expect(d.op, `${table}`).toMatch(/^(delete|sever|revoke)$/);
    }
  });

  it('never claims a redacted shell is anonymous', async () => {
    // OWNER INTERIM POSITION (pending counsel on §9): a redacted `products` or
    // `founders` row is TOMBSTONED AND REDACTED, not proven anonymous. What is
    // true is what was done to it — columns cleared, email replaced, the
    // identity-provider handle severed. Whether that satisfies a deletion
    // request is a legal question about the row, and software must not answer
    // it in a comment. Held here so the claim cannot drift back in.
    const { RETAINED_ON_ERASURE_DISPOSITIONS, FOUNDER_SCOPED_REASONS } = await import(
      '../../src/services/privacy/consent.js');
    const claims = [
      ...Object.values(RETAINED_ON_ERASURE_DISPOSITIONS).map((d) => d.basis ?? ''),
      ...Object.values(FOUNDER_SCOPED_REASONS),
    ];
    for (const claim of claims) {
      expect(claim.toLowerCase(), 'a legal conclusion software may not draw')
        .not.toMatch(/anonymi[sz]|identifies nobody|no longer identifiable/);
    }
  });

  it('severs rather than deleting the company\'s own record of a decision', async () => {
    // The other half of the rule. A decision the leaving person made is the
    // COMPANY'S decision; deleting it because they left would destroy the
    // company's record. It stays and stops naming them.
    await query(
      `INSERT INTO decisions (id, product_id, what, why_now, category, gate, status, decided_by_founder_id)
       VALUES ('d1', ?, 'Ship it', 'Now', 'strategic', 1, 'pending', ?)`, [HOSTCO, LEAVING]);
    await eraseFounderAccount(LEAVING);
    const row = (await query(
      `SELECT decided_by_founder_id FROM decisions WHERE id='d1'`, []))
      .rows[0] as Record<string, unknown>;
    expect(row, 'the company lost its decision because a member left').toBeDefined();
    expect(row.decided_by_founder_id).toBeNull();
  });
});
