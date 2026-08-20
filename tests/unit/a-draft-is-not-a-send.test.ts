process.env.TURSO_DATABASE_URL = 'file::memory:';
process.env.ENCRYPTION_KEY = '0'.repeat(64);

import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { runMigrations } from '../../src/db/migrate.js';
import { query } from '../../src/db/client.js';
import { createExecution, approveAndExecute } from '../../src/services/scp/actions/executor.js';
import { registerToolHandler } from '../../src/services/outbound/gateway.js';
import { SEND_EMAIL_POLICY } from '../../src/services/integration/resend.js';
import { recordContactConstraint } from '../../src/services/institution/contact-constraint.js';

// =============================================================================
// TWO REGIMES, AND THE SECOND ONE CLAIMED A SEND IT HAD NOT MADE.
//
// `ARCHITECTURE.md`: "Consequential mutations enter one governed execution
// boundary." There were two. `outbound_actions` went through the gateway — kill
// switch, entitlement pause, classification, idempotency, sender of record,
// receipts, effect certainty. `action_executions` had its own switch, and its
// `send_email` arm returned:
//
//     success: true, note: 'Email draft stored. Email provider integration
//     pending.'
//
// Nothing was sent. The caller marked the execution 'completed'; the
// customer-success department counted it as `sent` and wrote an attribution
// entry reading "Foundry sent a check-in on the founder's behalf under consent
// <id>". A live send path existed the whole time — the note was describing a
// gap that had been closed elsewhere and never re-read.
//
// THE SYSTEM MUST NOT CLAIM AN OUTCOME ITS EXECUTION PATH CANNOT SUPPORT. The
// second regime now enters the first, so there is one place where a send is
// decided and one place where it is recorded.
// =============================================================================

const P = 'dns_product';
const OWNER = 'dns_owner';

let dispatched = 0;
const provider = (behaviour: 'accept' | 'throw') => registerToolHandler(
  'send_email',
  async () => {
    if (behaviour === 'throw') throw new Error('provider down');
    dispatched += 1;
    return { message_id: 'provider-1' };
  },
  SEND_EMAIL_POLICY,
);

const send = async (to: string, key: string) => {
  const execId = await createExecution(P, null, {
    action_type: 'send_email', integration: 'resend',
    to_email: to, subject: `Hello ${key}`, body: 'How is it going?',
  });
  const result = await approveAndExecute(execId, `founder:${OWNER}`);
  const row = (await query(
    'SELECT status, effect_certainty, reconcile_after FROM action_executions WHERE id = ?',
    [execId],
  )).rows[0] as Record<string, unknown>;
  return { result, row };
};

beforeAll(async () => {
  await runMigrations();
  await query(`INSERT INTO founders (id,clerk_user_id,email,tier) VALUES (?,'dns_c','o@example.com','growth')`, [OWNER]);
  await query(`INSERT INTO products (id,name,owner_id,status) VALUES (?,'Drafthouse',?,'active')`, [P, OWNER]);
});

beforeEach(async () => {
  dispatched = 0;
  await query('DELETE FROM outreach_suppressions');
  await query('DELETE FROM idempotency_keys');
});

describe('the second regime', () => {
  it('no longer has a send arm of its own', () => {
    const src = readFileSync('src/services/scp/actions/executor.ts', 'utf8');
    // The comment above the case quotes the old note on purpose; what must be
    // gone is a RETURN of success from a path that contacted nobody. The whole
    // file has exactly one send, and it is the gateway call.
    expect(src).toContain('executeGovernedEmail');
    expect(src.match(/invoke\(\{/g) ?? [], 'one send, in one place').toHaveLength(1);
  });

  it('reaches the provider through the governed boundary', async () => {
    provider('accept');
    const { result, row } = await send('reader@example.com', 'a');
    expect(result.success).toBe(true);
    expect(dispatched, 'something actually left the building').toBe(1);
    expect(row.status).toBe('completed');
    expect(row.effect_certainty).toBe('provider_acknowledged');
  });

  it('records not_attempted when the boundary refuses, and books no reconciliation', async () => {
    provider('throw');
    const { result, row } = await send('reader@example.com', 'b');
    expect(result.success).toBe(false);
    expect(row.status).toBe('failed');
    // The handler threw before anything was acknowledged. The gateway calls
    // that phase 'execution' — the one case where the outcome is genuinely
    // unknown — so it is ambiguous and IS worth reconciling.
    expect(row.effect_certainty).toBe('ambiguous');
    expect(row.reconcile_after, 'an unknown outcome is chased').toBeTruthy();
  });
});

describe('the affected-party term binds both regimes', () => {
  it('refuses a customer who asked this company to stop, on this path too', async () => {
    provider('accept');
    expect(await recordContactConstraint({
      productId: P, founderId: OWNER, email: 'quiet@example.com', reason: 'they_asked',
    })).toEqual({ recorded: true });

    const { result, row } = await send('quiet@example.com', 'c');
    expect(result.success).toBe(false);
    expect(dispatched, 'nothing reached the provider').toBe(0);
    expect(String(result.error)).toContain('contact_refused');
    // Definitively nothing was attempted, so there is nothing to reconcile.
    expect(row.effect_certainty).toBe('not_attempted');
    expect(row.reconcile_after).toBeFalsy();
  });
});
