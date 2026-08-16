process.env.TURSO_DATABASE_URL = 'file::memory:';

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import { runMigrations } from '../../src/db/migrate.js';
import { query } from '../../src/db/client.js';
import {
  OBLIGATION_LABELS, REPORTABLE_OBLIGATIONS, reportCompanyObligation,
} from '../../src/services/founder/company-report.js';
import {
  recordFounderEvidenceAnswer, selectFounderEvidenceQuestion,
} from '../../src/services/institution/founder-evidence.js';
import { earnResponsibilityUnderstanding } from '../../src/services/institution/responsibility-understanding.js';

// =============================================================================
// The institution's evidence intake.
//
// Two audit findings sit behind this. `emitSignalEvent` — the only function
// that records a company signal and runs responsibility discovery — had no
// caller anywhere in src/, so nothing in production ever produced company
// evidence. And discovery admitted four signal kinds named after
// software-company events, so a company unlike a SaaS could only be recognised
// when its reality happened to fit a software company's words.
//
// The founder now reports an obligation directly, choosing its kind from a
// closed generic set. Nothing is inferred from prose.
// =============================================================================

const OWNER = 'fr_owner';
const STRANGER = 'fr_stranger';

async function countOf(sql: string, args: unknown[] = []): Promise<number> {
  return Number(((await query(sql, args)).rows[0] as Record<string, unknown>).n);
}

beforeAll(async () => {
  await runMigrations();
  await query(`INSERT INTO founders (id,clerk_user_id,email) VALUES
    (?,'fr_clerk','owner@example.com'),(?,'fr_stranger_clerk','stranger@example.com')`, [OWNER, STRANGER]);
  await query(`INSERT INTO products (id,name,owner_id) VALUES
    ('fr_forge','Halloway Blacksmith & Forge',?),('fr_neighbour','Neighbour Co',?)`, [OWNER, STRANGER]);
});

describe('founder-reported company obligations', () => {
  it('gives the institution an evidence intake that production actually calls', () => {
    // The defect was an unfed intake: emitSignalEvent existed, ran discovery,
    // and nothing called it. The wiring is therefore part of the contract.
    const service = readFileSync(
      resolve(process.cwd(), 'src/services/founder/company-report.ts'), 'utf8');
    expect(service).toMatch(/emitSignalEvent/);
    const routes = readFileSync(resolve(process.cwd(), 'src/routes/dashboard/letter.ts'), 'utf8');
    expect(routes).toMatch(/reportCompanyObligation/);
    expect(routes).toMatch(/letter\/company\/report/);
  });

  it('recognises a company that looks nothing like a software business', async () => {
    // A blacksmith. No deployment, no churn, no activation — and it reaches the
    // first rung anyway, because the founder said what kind of obligation it is
    // rather than having to phrase it as a SaaS event.
    const reported = await reportCompanyObligation({
      productId: 'fr_forge', founderId: OWNER, obligationKind: 'delivery',
      what: 'Finish the gate commission for the Ashcroft house by the end of the month',
    });
    expect(reported!.responsibility).toMatchObject({
      title: 'Finish the gate commission for the Ashcroft house by the end of the month',
      state: 'visible', authorityRef: null,
    });

    // Titled in the founder's own words — Foundry does not paraphrase the
    // company back to itself.
    expect(reported!.responsibility!.title).not.toMatch(/Restore|Investigate|Respond to/);
  });

  it('reporting an obligation grants nothing', async () => {
    expect(await countOf("SELECT COUNT(*) n FROM autonomy_consents WHERE product_id='fr_forge'")).toBe(0);
    expect(await countOf("SELECT COUNT(*) n FROM action_executions WHERE product_id='fr_forge'")).toBe(0);
    expect(await countOf(
      "SELECT COUNT(*) n FROM institutional_responsibilities WHERE product_id='fr_forge' AND state<>'visible'")).toBe(0);
  });

  it('carries a reported obligation the whole way to Understood', async () => {
    // The intake and the evidence bridge compose: the founder says what must be
    // handled, then answers what Foundry cannot observe, and the responsibility
    // becomes understood through the ordinary path.
    const responsibilityId = String(((await query(
      "SELECT id FROM institutional_responsibilities WHERE product_id='fr_forge'", [])).rows[0] as Record<string, unknown>).id);
    for (let i = 0; i < 20; i++) {
      const question = await selectFounderEvidenceQuestion('fr_forge');
      if (!question) break;
      await recordFounderEvidenceAnswer({
        requestId: question.requestId, founderId: OWNER, statement: `How the forge handles this (${i})`,
      });
    }
    expect(await earnResponsibilityUnderstanding('fr_forge', responsibilityId))
      .toMatchObject({ state: 'understood', authorityRef: null });

    // Understanding it still does not permit acting on it.
    expect(await countOf("SELECT COUNT(*) n FROM autonomy_consents WHERE product_id='fr_forge'")).toBe(0);
  });

  it('refuses to invent ontology from an unrecognised kind or empty words', async () => {
    // Ambiguity stays conversation. A kind Foundry does not have generic
    // semantics for never becomes a responsibility.
    expect(await reportCompanyObligation({
      productId: 'fr_forge', founderId: OWNER, obligationKind: 'blacksmithing', what: 'Something',
    })).toBeNull();
    expect(await reportCompanyObligation({
      productId: 'fr_forge', founderId: OWNER, obligationKind: 'delivery', what: '   ',
    })).toBeNull();
    // And the database refuses it too, not just the service.
    await expect(query(
      `INSERT INTO signal_events (id,product_id,source,event_type,severity,payload_json,summary)
       VALUES ('fr_bad','fr_forge','founder_report','founder_reported:blacksmithing','medium',?,'x')`,
      [JSON.stringify({ obligation_kind: 'blacksmithing', what: 'Forge a gate', founder_id: OWNER })],
    )).rejects.toThrow(/obligation_kind_invalid/);
  });

  it('keeps the reportable set generic and free of industry names', () => {
    // The whole point is generic operational semantics. A sector enum here
    // would be the thing the owner ruled out.
    for (const kind of REPORTABLE_OBLIGATIONS) {
      expect(kind).not.toMatch(/saas|software|restaurant|clinic|farm|retail|agency|marina/i);
      expect(OBLIGATION_LABELS[kind].length).toBeGreaterThan(10);
    }
    // The service and migration 126 hold the same closed set.
    const migration = readFileSync(
      resolve(process.cwd(), 'src/db/migrations/126_founder_reported_obligations.sql'), 'utf8');
    for (const kind of REPORTABLE_OBLIGATIONS) expect(migration).toContain(`'${kind}'`);
  });

  it('refuses a foreign tenant and a forged founder', async () => {
    expect(await reportCompanyObligation({
      productId: 'fr_neighbour', founderId: OWNER, obligationKind: 'delivery', what: 'Not my company',
    })).toBeNull();
    expect(await reportCompanyObligation({
      productId: 'fr_forge', founderId: STRANGER, obligationKind: 'delivery', what: 'Not my company',
    })).toBeNull();
    await expect(query(
      `INSERT INTO signal_events (id,product_id,source,event_type,severity,payload_json,summary)
       VALUES ('fr_forged','fr_forge','founder_report','founder_reported:delivery','medium',?,'x')`,
      [JSON.stringify({ obligation_kind: 'delivery', what: 'Forge a gate', founder_id: STRANGER })],
    )).rejects.toThrow(/founder_invalid/);
    expect(await countOf("SELECT COUNT(*) n FROM institutional_responsibilities WHERE product_id='fr_neighbour'")).toBe(0);
  });

  it('refuses a report that tries to carry authority with it', async () => {
    const base = { obligation_kind: 'delivery', what: 'Forge a gate', founder_id: OWNER };
    for (const smuggled of [
      { consent: true }, { capability: 'operations' }, { to_mode: 'act' }, { state: 'operating' },
    ]) {
      await expect(query(
        `INSERT INTO signal_events (id,product_id,source,event_type,severity,payload_json,summary)
         VALUES (?,'fr_forge','founder_report','founder_reported:delivery','medium',?,'x')`,
        [`fr_smuggle_${Object.keys(smuggled)[0]}`, JSON.stringify({ ...base, ...smuggled })],
      )).rejects.toThrow(/authority_smuggled/);
    }
  });

  it('still admits the original four signal kinds unchanged', async () => {
    // Generalising the intake must not quietly change what integration
    // evidence means. The historical contract is untouched.
    const discovery = readFileSync(
      resolve(process.cwd(), 'src/services/institution/discovery.ts'), 'utf8');
    const admitted = [...discovery.matchAll(/^ {2}([a-z_]+): \{ title:/gm)].map((m) => m[1]);
    expect(admitted.sort()).toEqual(
      ['activation_failure', 'churn_detected', 'payment_failed', 'support_spike']);
  });
});
