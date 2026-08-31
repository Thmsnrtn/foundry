process.env.TURSO_DATABASE_URL = 'file::memory:';
process.env.ENCRYPTION_KEY = '0'.repeat(64);

import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { runMigrations } from '../../src/db/migrate.js';
import { query } from '../../src/db/client.js';
import {
  AUTO_PRINCIPAL, describePrincipal, isPrincipalRef, parsePrincipal, principalRef,
} from '../../src/services/outbound/acting-principal.js';
import { createExecution, approveAndExecute } from '../../src/services/scp/actions/executor.js';
import { registerToolHandler } from '../../src/services/outbound/gateway.js';
import { SEND_EMAIL_POLICY } from '../../src/services/integration/resend.js';

// =============================================================================
// `approved_by` IS WHAT MAKES AN AUTHORISATION ATTRIBUTABLE, AND IT HELD FOUR
// SPELLINGS OF ONE IDEA.
//
//   outbound_actions    `founder:<id>`, `institution:assisting`, `auto`
//   action_executions   `voice:<id>`, `system:playbook`,
//                       `autopilot:<category>` — and, from the dashboard
//                       approval, a BARE founder id
//
// Nothing misread a founder as an autopilot, because both readers that
// interpret the field happen to key on the `autopilot:` prefix. That is a
// property of which two readers exist today, not of the data — the same shape
// as a live-grant predicate copied seven times, and two retention jobs deleting
// from one table on different horizons.
//
// AND THE ONE READER THAT TURNS IT INTO ENGLISH LIVED ON ONE LEDGER'S PAGE. It
// knew `founder:`, `auto` and `institution:` and nothing about the three kinds
// the OTHER ledger writes. That page never rendered `approved_by` at all: an
// action that reached outside the company recorded who allowed it, and no
// surface read it. An authority a founder cannot see is one they cannot
// withdraw.
// =============================================================================

const P = 'ovp_product';
const OWNER = 'ovp_owner';

beforeAll(async () => {
  await runMigrations();
  await query(`INSERT INTO founders (id,clerk_user_id,email,tier) VALUES (?,'ovp_c','o@example.com','growth')`, [OWNER]);
  await query(`INSERT INTO products (id,name,owner_id,status) VALUES (?,'Vocab Co',?,'active')`, [P, OWNER]);
});

beforeEach(async () => {
  await query('DELETE FROM idempotency_keys');
  registerToolHandler('send_email', async () => ({ message_id: 'm1' }), SEND_EMAIL_POLICY);
});

describe('a principal reference', () => {
  it('is a kind and an id, never a bare id', () => {
    expect(principalRef('founder', OWNER)).toBe(`founder:${OWNER}`);
    expect(parsePrincipal(OWNER), 'a bare id names no kind').toBeNull();
    expect(parsePrincipal('ceo'), 'a role is not a principal').toBeNull();
    expect(parsePrincipal('wizard:merlin'), 'and the kinds are a closed set').toBeNull();
    expect(parsePrincipal(''), '').toBeNull();
    expect(parsePrincipal('founder:'), 'a kind with nobody behind it').toBeNull();
  });

  it('refuses to be built from an id that would forge a kind', () => {
    expect(() => principalRef('founder', 'x:y')).toThrow();
    expect(() => principalRef('founder', '  ')).toThrow();
  });

  it('has exactly one member that carries no id, and it is not a person', () => {
    expect(isPrincipalRef(AUTO_PRINCIPAL)).toBe(true);
    expect(parsePrincipal(AUTO_PRINCIPAL)).toEqual({ kind: 'auto', id: null });
    // Still not a person — and no longer a claim about a window. This read
    // 'automatically, after the notice window' until the two writers of the
    // value were examined: one stamped it an hour before its own timestamp on a
    // proposal nothing would execute, the other used it as the default for an
    // action nobody was ever asked about. Nothing writes it now; the sentence
    // exists for the rows that already carry it.
    expect(describePrincipal(AUTO_PRINCIPAL, OWNER),
      '"nobody stopped it" is not "somebody chose it"')
      .toBe('automatically, with no approver recorded');
  });
});

describe('the sentence a founder reads', () => {
  it('tells them apart from another owner', () => {
    expect(describePrincipal(principalRef('founder', OWNER), OWNER)).toBe('you');
    expect(describePrincipal(principalRef('founder', 'someone_else'), OWNER))
      .toBe('another owner');
  });

  it('knows the kinds the OTHER ledger writes, which the old reader did not', () => {
    // These three were written by `action_executions` and rendered by nothing.
    expect(describePrincipal(principalRef('voice', OWNER), OWNER)).toBe('you, by voice');
    expect(describePrincipal('autopilot:customer_success', OWNER))
      .toContain('autopilot for customer success');
    expect(describePrincipal('system:playbook', OWNER)).toContain('internal mechanism');
  });

  it('shows an unrecognised value rather than guessing at it', () => {
    // A principal nothing knows about is exactly what somebody should see.
    expect(describePrincipal('something_nobody_defined', OWNER))
      .toBe('something_nobody_defined');
    expect(describePrincipal(null, OWNER)).toBe('-');
  });
});

describe('the approval doors', () => {
  const execute = async (approver: string) => {
    const execId = await createExecution(P, null, {
      action_type: 'send_email', integration: 'resend',
      to_email: 'reader@example.com', subject: 's', body: 'b',
    });
    const result = await approveAndExecute(execId, approver);
    const row = (await query(
      'SELECT status, approved_by FROM action_executions WHERE id = ?', [execId],
    )).rows[0] as Record<string, unknown>;
    return { result, row };
  };

  it('refuse a bare founder id — which is what the dashboard used to send', async () => {
    const { result, row } = await execute(OWNER);
    expect(result.success).toBe(false);
    expect(String(result.error)).toContain('not a principal reference');
    expect(row.status, 'nothing was approved').toBe('pending');
    expect(row.approved_by).toBeFalsy();
  });

  it('accept the same person named properly', async () => {
    const { result, row } = await execute(principalRef('founder', OWNER));
    expect(result.success).toBe(true);
    expect(row.approved_by).toBe(`founder:${OWNER}`);
  });

  it('refuse on the other ledger too', async () => {
    const { approveAction, rejectAction } = await import('../../src/services/outbound/executor.js');
    await expect(approveAction('ovp_missing', 'ceo')).rejects.toThrow(/principal reference/);
    await expect(rejectAction('ovp_missing', OWNER)).rejects.toThrow(/principal reference/);
  });
});
