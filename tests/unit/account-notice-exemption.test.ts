// =============================================================================
// Tests: the one thing a paused company may still send
//
// Making the pause total silenced the account completely — including the mail
// that would explain the pause. No subscription product behaves that way:
// operational mail stops, account mail continues, because account mail is
// ABOUT the lapse.
//
// An exemption is the dangerous kind of fix, so this file spends most of its
// length trying to widen it:
//
//   • the flag lives on the REGISTERED policy, not the request (§4)
//   • naming the exempt tool does not buy arbitrary content — the handler
//     renders from a closed set of kinds
//   • the exemption covers 'paused' only; an archived company is gone and
//     there is no relationship left to write to
//   • every other tool, including plain send_email, stays blocked
// =============================================================================

import { describe, it, expect, beforeAll, beforeEach, vi } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import { nanoid } from 'nanoid';

import { query, executeRaw } from '../../src/db/client.js';
import { invoke, registerToolHandler, clearToolHandlers } from '../../src/services/outbound/gateway.js';
import { ACCOUNT_NOTICE_POLICY } from '../../src/services/billing/account-notice.js';

let founderId: string;
let productId: string;

beforeAll(async () => {
  await executeRaw(`
    CREATE TABLE IF NOT EXISTS founders (
      id TEXT PRIMARY KEY, clerk_user_id TEXT UNIQUE NOT NULL,
      email TEXT UNIQUE NOT NULL, name TEXT, tier TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE IF NOT EXISTS products (
      id TEXT PRIMARY KEY, name TEXT NOT NULL,
      owner_id TEXT NOT NULL REFERENCES founders(id),
      status TEXT DEFAULT 'active',
      scp_status TEXT DEFAULT 'active'
        CHECK(scp_status IN ('provisioning','active','paused','archived')),
      entitlement_paused_at TEXT,
      disabled_tools TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE IF NOT EXISTS agent_instances (
      id TEXT PRIMARY KEY, product_id TEXT NOT NULL,
      agent_name TEXT NOT NULL, status TEXT DEFAULT 'active'
    );
    CREATE TABLE IF NOT EXISTS audit_log (
      id TEXT PRIMARY KEY, product_id TEXT NOT NULL, action_type TEXT NOT NULL,
      gate INTEGER NOT NULL, trigger TEXT NOT NULL, reasoning TEXT NOT NULL,
      input_context TEXT, output TEXT, outcome TEXT, confidence_score REAL,
      risk_state_at_action TEXT, created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
  `);
  for (const m of ['065_idempotency_keys', '066_data_classifications', '067_communication_budgets']) {
    await executeRaw(readFileSync(resolve(__dirname, `../../src/db/migrations/${m}.sql`), 'utf-8'));
  }
});

beforeEach(async () => {
  founderId = nanoid();
  productId = nanoid();
  await query(`INSERT INTO founders (id, clerk_user_id, email, tier) VALUES (?,?,?,NULL)`,
    [founderId, `clerk_${founderId}`, `${founderId}@test.local`]);
  await query(`INSERT INTO products (id, name, owner_id, status, scp_status) VALUES (?,?,?,'active','paused')`,
    [productId, 'Paused Co', founderId]);
  await executeRaw(`DELETE FROM idempotency_keys`);
  await executeRaw(`DELETE FROM data_classifications`);
  await executeRaw(`DELETE FROM communication_budgets`);
  clearToolHandlers();
});

/** Register the notice tool with a stub transport, keeping the real policy. */
function stubNoticeTool(): ReturnType<typeof vi.fn> {
  const handler = vi.fn(async () => ({ message_id: 'em_notice' }));
  registerToolHandler('send_account_notice', handler, ACCOUNT_NOTICE_POLICY);
  return handler;
}

function noticeReq(overrides: Record<string, unknown> = {}) {
  return {
    productId, tool: 'send_account_notice', action: 'account notice',
    params: { to: ['f@example.com'], notice: { kind: 'read_only_started', companyName: 'Paused Co' } },
    dedupKey: `n-${nanoid()}`, customerExternalId: 'f@example.com',
    ...overrides,
  } as Parameters<typeof invoke>[0];
}

describe('the notice reaches a paused company', () => {
  it('is delivered where every other effect is refused', async () => {
    const handler = stubNoticeTool();
    const r = await invoke(noticeReq());
    expect(r.ok ? 'ok' : `${r.phase}: ${r.reason}`,
      'the mail explaining the pause cannot be blocked by the pause').toBe('ok');
    expect(handler).toHaveBeenCalledOnce();
  });

  it('does not exempt anything else, including ordinary email', async () => {
    const email = vi.fn(async () => ({ id: 'em_1' }));
    registerToolHandler('send_email', email, {
      actor: 'email_delivery', surface: 'email_outbound', dataClass: 'customer',
      requireDedupKey: false, requireCustomerExternalId: false,
    });
    const r = await invoke({
      productId, tool: 'send_email', action: 'digest',
      params: { to: ['f@example.com'], subject: 'weekly' },
      dedupKey: `d-${nanoid()}`, customerExternalId: 'f@example.com',
    });
    expect(r.ok).toBe(false);
    expect(email).not.toHaveBeenCalled();
  });

  it('stops at archived — there is no relationship left to write to', async () => {
    await query(`UPDATE products SET scp_status='archived' WHERE id=?`, [productId]);
    const handler = stubNoticeTool();
    const r = await invoke(noticeReq());
    expect(r.ok).toBe(false);
    expect(handler).not.toHaveBeenCalled();
  });

  it('stops when the record itself is archived', async () => {
    await query(`UPDATE products SET status='archived' WHERE id=?`, [productId]);
    stubNoticeTool();
    expect((await invoke(noticeReq())).ok).toBe(false);
  });

  it('is still subject to the per-tool kill switch', async () => {
    await query(`UPDATE products SET disabled_tools='["send_account_notice"]' WHERE id=?`, [productId]);
    const handler = stubNoticeTool();
    expect((await invoke(noticeReq())).ok).toBe(false);
    expect(handler).not.toHaveBeenCalled();
  });
});

describe('the exemption cannot be claimed by a caller', () => {
  it('ignores a request that declares itself deliverable while paused', async () => {
    const email = vi.fn(async () => ({ id: 'em_1' }));
    registerToolHandler('send_email', email, {
      actor: 'email_delivery', surface: 'email_outbound', dataClass: 'customer',
      requireDedupKey: false, requireCustomerExternalId: false,
    });
    const r = await invoke({
      productId, tool: 'send_email', action: 'definitely a notice',
      params: {
        to: ['f@example.com'], subject: 'hi',
        deliverableWhilePaused: true, notice: { kind: 'read_only_started' },
      },
      dedupKey: `d-${nanoid()}`, customerExternalId: 'f@example.com',
    } as Parameters<typeof invoke>[0]);
    expect(r.ok).toBe(false);
    expect(email).not.toHaveBeenCalled();
  });

  it('registers the flag on exactly one tool', () => {
    const src = readFileSync(
      resolve(__dirname, '../../src/services/billing/account-notice.ts'), 'utf8');
    expect(src).toMatch(/deliverableWhilePaused:\s*true/);

    // Nowhere else. A second exempt capability is a decision, not a copy-paste.
    const walk = (dir: string): string[] => require('fs').readdirSync(dir, { withFileTypes: true })
      .flatMap((e: { name: string; isDirectory(): boolean }) => {
        const p = resolve(dir, e.name);
        return e.isDirectory() ? walk(p) : p.endsWith('.ts') ? [p] : [];
      });
    const declaring = walk(resolve(__dirname, '../../src'))
      .filter((f) => /deliverableWhilePaused:\s*true/.test(readFileSync(f, 'utf8')))
      .map((f) => f.split('/src/')[1]);
    expect(declaring).toEqual(['services/billing/account-notice.ts']);
  });
});

describe('naming the exempt tool does not buy arbitrary content', () => {
  it('refuses a kind it does not have a template for', async () => {
    // The real handler, not a stub: this is the content boundary.
    const { default: _ } = { default: null };
    void _;
    const r = await invoke(noticeReq({
      params: { to: ['f@example.com'], notice: { kind: 'marketing_blast', companyName: 'X' } },
    }));
    expect(r.ok).toBe(false);
  });

  it('refuses a request with no notice at all', async () => {
    const r = await invoke(noticeReq({ params: { to: ['f@example.com'], html: '<p>buy now</p>' } }));
    expect(r.ok).toBe(false);
  });

  it('renders the body itself rather than taking one', async () => {
    const src = readFileSync(
      resolve(__dirname, '../../src/services/billing/account-notice.ts'), 'utf8');
    // The handler must build subject/html from render(), never pass through
    // caller-supplied ones.
    expect(src).toMatch(/const \{ subject, html \} = render\(notice\)/);
    expect(src).toMatch(/params: \{ to: params\.to, subject, html \}/);
  });

  it('escapes the one caller-supplied string that reaches the body', async () => {
    const src = readFileSync(
      resolve(__dirname, '../../src/services/billing/account-notice.ts'), 'utf8');
    const interpolations = src.match(/\$\{notice\.companyName\}/g) ?? [];
    expect(interpolations, 'company name must go through escapeHtml').toEqual([]);
    expect(src).toMatch(/escapeHtml\(notice\.companyName\)/);
  });
});
