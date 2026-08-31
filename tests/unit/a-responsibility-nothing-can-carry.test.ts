process.env.TURSO_DATABASE_URL = 'file::memory:';
process.env.ENCRYPTION_KEY = '0'.repeat(64);

import { Hono } from 'hono';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { runMigrations } from '../../src/db/migrate.js';
import { query } from '../../src/db/client.js';
import {
  GRANTABLE_CAPABILITIES, getAssistingCandidates, getUncarriableResponsibilities,
} from '../../src/services/institution/assisting-admission.js';
import { REPORTABLE_OBLIGATIONS } from '../../src/services/founder/company-report.js';

// =============================================================================
// A RESPONSIBILITY NOTHING CAN CARRY, AND NOTHING SAID SO.
//
// The founder intake takes eight kinds of obligation. `discovery.ts` maps them
// onto four capabilities. `GRANTABLE_CAPABILITIES` holds two, and development
// has its own authority path — so `billing_recovery`, which is what "money owed
// to us that needs collecting" becomes, has none.
//
// A founder could therefore report it, be asked by
// `responsibility-understanding.ts` to explain its failure conditions, its
// stakeholder obligations and its financial consequence, watch it reach
// Shadowing — and then wait for an offer that cannot come, because
// `getAssistingCandidates` filters it out on exactly that list and no surface
// said so.
//
// THE SILENCE READS AS "NOT YET". The truth is "there is no path", and the two
// are different facts about Foundry. The second is the one that decides whether
// the founder keeps waiting or goes and does it themselves — the same principle
// that makes an unobserved metric say so rather than report zero.
// =============================================================================

const P = 'p_uncarriable';
const OWNER = 'f_unc';

beforeAll(async () => {
  await runMigrations();
  await query('INSERT INTO founders (id,clerk_user_id,email) VALUES (?,?,?)',
    [OWNER, 'c_unc', 'unc@example.com']);
  await query("INSERT INTO products (id,name,owner_id,status) VALUES (?,'Acme',?,'active')",
    [P, OWNER]);
});

beforeEach(async () => {
  await query('DELETE FROM institutional_responsibilities WHERE product_id=?', [P]);
  await query('DELETE FROM signal_events WHERE product_id=?', [P]);
});

async function responsibility(
  id: string, capability: string, state: string, title = 'Chase the Fenwick invoice',
): Promise<void> {
  await query(
    `INSERT INTO signal_events (id,product_id,source,event_type,severity,payload_json,summary)
     VALUES (?,?,'company_observation_baseline','company_observation_baseline:observed','low','{}','seed')`,
    [`sig_${id}`, P]);
  await query(
    `INSERT INTO institutional_responsibilities
       (id,product_id,title,capability,state,discovery_evidence_ref)
     VALUES (?,?,?,?,?,?)`,
    [id, P, title, capability, state, `signal_event:sig_${id}`]);
}

describe('the gap is real and derived, not asserted', () => {
  it('every reportable obligation maps to a capability, and the map is closed', async () => {
    // The eight kinds a founder can choose from, and the four capabilities they
    // become. If a kind ever mapped to nothing, the responsibility would carry
    // an empty capability and this surface would be the least of the problems.
    const { readFileSync } = await import('node:fs');
    const src = readFileSync('src/services/institution/discovery.ts', 'utf8');
    const map = src.slice(src.indexOf('OBLIGATION_CAPABILITIES'), src.indexOf('};', src.indexOf('OBLIGATION_CAPABILITIES')));
    for (const kind of REPORTABLE_OBLIGATIONS) {
      expect(map, `${kind} maps to no capability`).toMatch(new RegExp(`${kind}:\\s*'`));
    }
  });

  it('billing_recovery has no grantable effect, which is why this exists', () => {
    expect(Object.keys(GRANTABLE_CAPABILITIES).sort()).toEqual(['customer_support', 'operations']);
    expect(GRANTABLE_CAPABILITIES.billing_recovery).toBeUndefined();
  });

  it('names a responsibility no capability can carry', async () => {
    await responsibility('r_bill', 'billing_recovery', 'shadowing');
    const uncarriable = await getUncarriableResponsibilities(P);
    expect(uncarriable).toHaveLength(1);
    expect(uncarriable[0]).toMatchObject({
      responsibilityId: 'r_bill', capability: 'billing_recovery', state: 'shadowing',
    });
  });

  it('and that same responsibility is invisible to the permission surface', async () => {
    // The two halves of the same fact: it will never be offered, and until now
    // nothing said why.
    await responsibility('r_bill', 'billing_recovery', 'shadowing');
    expect(await getAssistingCandidates(P)).toEqual([]);
  });

  it('says nothing about a capability Foundry CAN carry', async () => {
    await responsibility('r_sup', 'customer_support', 'shadowing');
    await responsibility('r_ops', 'operations', 'understood');
    expect(await getUncarriableResponsibilities(P)).toEqual([]);
  });

  it('says nothing about development, whose authority is a different door', async () => {
    // Governed elsewhere is not ungoverned, and calling it uncarriable would be
    // telling the founder something false in the other direction.
    await responsibility('r_dev', 'development', 'shadowing');
    expect(await getUncarriableResponsibilities(P)).toEqual([]);
  });

  it('drops off by construction the moment a capability gains an effect', async () => {
    // Derived, never listed. This is the property that keeps the surface true
    // without anybody remembering to edit it.
    await responsibility('r_new', 'a_capability_with_no_effect', 'shadowing');
    expect(await getUncarriableResponsibilities(P)).toHaveLength(1);

    (GRANTABLE_CAPABILITIES as Record<string, unknown>).a_capability_with_no_effect = {
      scope: 'x', may: 'y', mayNot: 'z',
    };
    try {
      expect(await getUncarriableResponsibilities(P)).toEqual([]);
    } finally {
      delete (GRANTABLE_CAPABILITIES as Record<string, unknown>).a_capability_with_no_effect;
    }
  });

  it('ignores what is not being watched yet, and what has been set aside', async () => {
    await responsibility('r_early', 'billing_recovery', 'visible');
    expect(await getUncarriableResponsibilities(P)).toEqual([]);
  });
});

describe('the founder is told, on the page', () => {
  async function letter(): Promise<string> {
    const { letterRoutes } = await import('../../src/routes/dashboard/letter.js');
    const app = new Hono();
    app.use('*', async (c, next) => {
      c.set('founder' as never,
        { id: OWNER, email: 'unc@example.com', preferences: {} } as never);
      c.set('csrfToken' as never, 't' as never);
      await next();
    });
    app.route('/', letterRoutes as unknown as Hono);
    return (await app.request('/letter')).text();
  }

  it('names it, and says the waiting is not worth doing', async () => {
    await responsibility('r_bill', 'billing_recovery', 'shadowing');
    const page = await letter();
    expect(page).toContain('What I cannot carry');
    expect(page).toContain('Chase the Fenwick invoice');
    expect(page).toMatch(/should not wait for me/i);
  });

  it('promises nothing about when, because Foundry does not know', async () => {
    await responsibility('r_bill', 'billing_recovery', 'shadowing');
    const page = await letter();
    expect(page).toMatch(/cannot tell you when/i);
    expect(page.toLowerCase()).not.toMatch(/coming soon|we are working on|in a future/);
  });

  it('is absent entirely when there is nothing to say', async () => {
    await responsibility('r_sup', 'customer_support', 'shadowing');
    expect(await letter()).not.toContain('What I cannot carry');
  });
});
