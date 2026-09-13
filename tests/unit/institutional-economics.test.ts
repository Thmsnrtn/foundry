process.env.TURSO_DATABASE_URL = 'file::memory:';

import { beforeAll, describe, expect, it } from 'vitest';
import { runMigrations } from '../../src/db/migrate.js';
import { query } from '../../src/db/client.js';
import { logCost } from '../../src/services/financial/economics.js';

// =============================================================================
// Cost attaches to institutional truth, and attribution is evidence.
//
// THE READ SIDE IS GONE. `financial/institutional-economics.ts` — which answered
// what a responsibility or a capability had cost, and named the components
// nobody measures instead of folding them into the sum — was reachable from no
// entry point and has been deleted, and the five cases here that exercised it
// went with it. Nothing about those rules was fixed; the code that carried them
// is simply no longer in the product.
//
// What survives is the WRITE side, which is still live: `logCost` and the
// `cost_events` triggers. They decide what may be booked at all — never against
// another company's responsibility, never under a capability the responsibility
// disagrees with, never a negative or absent amount — and, once booked, they
// refuse to let the attribution be rewritten. Those are the rules that make a
// cost row evidence rather than an editable opinion.
// =============================================================================

const P = 'ie_prod';
const OTHER = 'ie_other';

beforeAll(async () => {
  await runMigrations();
  await query(`INSERT INTO founders (id,clerk_user_id,email) VALUES
    ('ie_owner','ie_c1','o@example.com'),('ie_other_owner','ie_c2','x@example.com')`, []);
  await query(`INSERT INTO products (id,name,owner_id) VALUES
    ('${P}','Co','ie_owner'),('${OTHER}','Other Co','ie_other_owner')`, []);
  await query(`INSERT INTO signal_events (id,product_id,source,event_type,severity,payload_json,summary) VALUES
    ('ie_sig','${P}','repository','development_need_observed','low','{}','s'),
    ('ie_sig2','${OTHER}','repository','development_need_observed','low','{}','s')`, []);
  await query(`INSERT INTO institutional_responsibilities (id,product_id,title,capability,state,discovery_evidence_ref) VALUES
    ('ie_resp','${P}','Answer customers','customer_support','visible','signal_event:ie_sig'),
    ('ie_foreign','${OTHER}','Answer customers','customer_support','visible','signal_event:ie_sig2')`, []);

  // Two booked rows against ie_resp. They were written by the first case here,
  // which read them back through the deleted reader; the rows themselves are
  // still what the immutability case below needs something to try to rewrite.
  await logCost({
    productId: P, costType: 'llm_tokens', amountUsd: 0.02,
    responsibilityId: 'ie_resp', capability: 'customer_support',
  });
  await logCost({
    productId: P, costType: 'email_send', amountUsd: 0.001,
    responsibilityId: 'ie_resp', capability: 'customer_support',
  });
});

describe('institutional cost attribution', () => {
  it('refuses to book cost against another company\'s responsibility', async () => {
    // The failure mode this prevents reads as a rounding difference and is
    // actually a cross-tenant leak in both directions at once.
    await expect(logCost({
      productId: P, costType: 'llm_tokens', amountUsd: 1,
      responsibilityId: 'ie_foreign', capability: 'customer_support',
    })).rejects.toThrow(/responsibility_foreign/);
  });

  it('refuses a capability that disagrees with the responsibility', async () => {
    await expect(logCost({
      productId: P, costType: 'llm_tokens', amountUsd: 1,
      responsibilityId: 'ie_resp', capability: 'billing_recovery',
    })).rejects.toThrow(/capability_mismatch/);
  });

  it('refuses negative and missing amounts, including via NULL', async () => {
    await expect(logCost({
      productId: P, costType: 'other', amountUsd: -5, responsibilityId: 'ie_resp',
    })).rejects.toThrow(/amount_invalid/);
    // NULL is the one that slips past a naive guard: `NEW.amount_usd < 0` is
    // NULL, not true, so the RAISE never fires unless the absence is coalesced.
    await expect(query(
      `INSERT INTO cost_events (id,product_id,cost_type,amount_usd) VALUES ('ie_null','${P}','other',NULL)`,
    )).rejects.toThrow();
  });

  it('will not let attribution be rewritten after the fact', async () => {
    // Cost is evidence about what already happened. Re-attributing it later
    // would let an expensive responsibility be made cheap retroactively, which
    // is exactly the number someone would want to change.
    await expect(query(
      "UPDATE cost_events SET responsibility_id=NULL WHERE product_id=? AND responsibility_id='ie_resp'", [P],
    )).rejects.toThrow(/attribution_immutable/);
    await expect(query(
      "UPDATE cost_events SET amount_usd=0 WHERE product_id=? AND responsibility_id='ie_resp'", [P],
    )).rejects.toThrow(/attribution_immutable/);
  });
});
