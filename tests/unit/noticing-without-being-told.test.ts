process.env.TURSO_DATABASE_URL = 'file::memory:';
process.env.ENCRYPTION_KEY = '0'.repeat(64);
// WHO THE PRINCIPAL IS, SAID OUT LOUD.
//
// These drove the owner's own pages without ever declaring that the session
// belonged to the owner, and passed — because four of those pages carried no
// ownership guard at all. The guard is now registered for the whole /foundry
// prefix, so the fixture has to say what it always meant.
process.env.FOUNDRY_INSTANCE_POSTURE = 'private_owner';
process.env.FOUNDRY_OWNER_EMAIL = 'owner@example.com';

import { beforeAll, describe, expect, it } from 'vitest';
import { Hono } from 'hono';
import { runMigrations } from '../../src/db/migrate.js';
import { query } from '../../src/db/client.js';
import {
  MATERIAL_MOVEMENT, noticeWhatTheNumbersAreDoing,
} from '../../src/services/institution/noticing.js';
import {
  advanceReferenceWorld, establishReferenceCompany,
} from '../../src/services/reference/world.js';

// =============================================================================
// NOTICING, WITHOUT BEING TOLD.
//
// The reference world proved this missing: a company visibly coming apart, ten
// live channels, and the institution holding zero responsibilities, because the
// ladder could only be entered through a door the owner opened first.
//
// Two failure modes bound this, and both are worse than doing nothing. Asking
// about weather teaches an owner to stop reading — which is why "a business
// that is doing fine" is a scenario and is asserted here. And DIAGNOSING rather
// than asking would be the institution inventing evidence: "support volume is
// up 45%" is arithmetic on two outside readings, "support is not being handled"
// is a claim about the world nobody observed.
// =============================================================================

const OWNER = 'nt_owner';
const QUIET = 'nt_quiet';
let falling = '';
let steady = '';

beforeAll(async () => {
  await runMigrations();
  await query('INSERT INTO founders (id,clerk_user_id,email,name) VALUES (?,?,?,?)',
    [OWNER, 'clerk_nt', 'owner@example.com', 'Owner']);
  await query("INSERT INTO products (id,name,owner_id,status) VALUES (?,'Quiet Co',?,'active')",
    [QUIET, OWNER]);

  for (const key of ['revenue_quietly_falling', 'steady_and_unremarkable'] as const) {
    const c = await establishReferenceCompany({ scenarioKey: key, ownerId: OWNER });
    if (!c) throw new Error('no reference company');
    await advanceReferenceWorld(c.productId);
    if (key === 'revenue_quietly_falling') falling = c.productId;
    else steady = c.productId;
  }
});

describe('a company coming apart', () => {
  it('is noticed, and every ask is grounded in a reading from outside', async () => {
    const noticed = await noticeWhatTheNumbersAreDoing(falling);
    expect(noticed.length).toBeGreaterThan(2);
    expect(noticed.map((n) => n.channel)).toContain('support_volume_7d');

    for (const one of noticed) {
      expect(Math.abs(one.movement)).toBeGreaterThanOrEqual(MATERIAL_MOVEMENT);
      const candidate = (await query(
        'SELECT evidence_refs_json, epistemic_status, authority_required, status '
        + 'FROM responsibility_candidates WHERE id = ?', [one.candidateId]))
        .rows[0] as Record<string, unknown>;
      const refs = JSON.parse(String(candidate.evidence_refs_json)) as Array<{ id: string }>;
      expect(refs).toHaveLength(1);

      // The evidence is a real observation on the company's own channel, which
      // migration 223's guard already validated. Nothing here is self-authored.
      const evidence = (await query(
        'SELECT source FROM signal_events WHERE id = ? AND product_id = ?',
        [refs[0].id, falling])).rows[0] as Record<string, unknown>;
      expect(String(evidence.source)).toBe('reference_metric_ingest');

      // RECOGNITION GRANTS NOTHING, and a candidate is not a responsibility.
      expect(Number(candidate.authority_required)).toBe(0);
      expect(String(candidate.status)).toBe('pending');
    }

    // And still nothing has climbed the ladder: that is the owner's act.
    const responsibilities = (await query(
      'SELECT COUNT(*) AS n FROM institutional_responsibilities WHERE product_id = ?',
      [falling])).rows[0] as Record<string, unknown>;
    expect(Number(responsibilities.n)).toBe(0);
  });

  it('asks a question rather than stating a diagnosis', async () => {
    const rows = (await query(
      'SELECT rationale, derivation_method FROM responsibility_candidates WHERE product_id = ?',
      [falling])).rows as unknown as Array<Record<string, unknown>>;
    expect(rows.length).toBeGreaterThan(0);
    for (const r of rows) {
      // The rationale is the specific thing observed, and only that.
      expect(String(r.rationale)).toMatch(/about \d+% on a month ago/);
      // WHAT KIND OF INFERENCE THIS IS belongs to the derivation, not repeated
      // under every question — where forty identical words become noise the
      // reader skips, which is the opposite of what the caveat is for.
      expect(String(r.derivation_method)).toContain('a movement, not a diagnosis');
      expect(String(r.derivation_method)).toContain('asserts nothing about why it moved');
    }
  });

  it('asks each question once, however many numbers say it', async () => {
    // Churned revenue rising and churn rate rising are two readings of one
    // thing. The convergence key is the job, so the second converges on the
    // candidate the first raised rather than asking again.
    const before = (await query(
      'SELECT COUNT(*) AS n FROM responsibility_candidates WHERE product_id = ?',
      [falling])).rows[0] as Record<string, unknown>;

    const noticed = await noticeWhatTheNumbersAreDoing(falling);
    const distinct = new Set(noticed.map((n) => n.responsibility));
    expect(distinct.size).toBeLessThan(noticed.length);

    // Running it again adds nothing at all.
    const after = (await query(
      'SELECT COUNT(*) AS n FROM responsibility_candidates WHERE product_id = ?',
      [falling])).rows[0] as Record<string, unknown>;
    expect(Number(after.n)).toBe(Number(before.n));
    expect(Number(after.n)).toBe(distinct.size);
  });
});

describe('a company that is doing fine', () => {
  it('is left alone, which is the harder half', async () => {
    // An institution that finds something urgent every day is one the owner
    // stops reading. Saying nothing is a result.
    expect(await noticeWhatTheNumbersAreDoing(steady)).toEqual([]);
    const n = (await query(
      'SELECT COUNT(*) AS n FROM responsibility_candidates WHERE product_id = ?',
      [steady])).rows[0] as Record<string, unknown>;
    expect(Number(n.n)).toBe(0);
  });
});

describe('a company it cannot see', () => {
  it('is not guessed about', async () => {
    // No snapshots, no observations, nothing to compare — and therefore no
    // proposal. Silence rather than a guess.
    expect(await noticeWhatTheNumbersAreDoing(QUIET)).toEqual([]);
  });

  it('is not noticed from its own reports alone', async () => {
    // A metric snapshot is the company's own account of itself. The ladder is
    // built on evidence that arrived from OUTSIDE, so movement with no
    // independent observation behind it proposes nothing.
    await query(
      `INSERT INTO metric_snapshots (id,product_id,snapshot_date,support_volume_7d)
       VALUES ('nt_then',?,date('now','-40 day'),10)`, [QUIET]);
    await query(
      `INSERT INTO metric_snapshots (id,product_id,snapshot_date,support_volume_7d)
       VALUES ('nt_now',?,date('now'),90)`, [QUIET]);
    expect(await noticeWhatTheNumbersAreDoing(QUIET)).toEqual([]);
  });
});

describe('the loop the owner actually walks', () => {
  const asOwner = async (path: string, init?: RequestInit): Promise<{
    status: number; body: string; location: string | null;
  }> => {
    const { foundryShellRoutes } = await import('../../src/routes/dashboard/foundry-shell.js');
    const { letterRoutes } = await import('../../src/routes/dashboard/letter.js');
    const app = new Hono();
    app.use('*', async (c, next) => {
      c.set('founder' as never,
        { id: OWNER, email: 'owner@example.com', name: 'Owner' } as never);
      c.set('csrfToken' as never, 'test' as never);
      await next();
    });
    app.route('/', foundryShellRoutes as never);
    app.route('/', letterRoutes as never);
    const res = await app.request(path, init);
    return { status: res.status, body: await res.text(), location: res.headers.get('location') };
  };

  it('shows the question on the company it is about, and answering it holds', async () => {
    await noticeWhatTheNumbersAreDoing(falling);

    const page = await asOwner(`/foundry/companies/${falling}`);
    expect(page.status).toBe(200);
    expect(page.body).toContain('Is this worth me looking after?');
    expect(page.body).toContain('keep the support queue answered');
    // RECOGNITION IS NOT AUTHORITY, and the page has to say so where he decides.
    expect(page.body).toContain('it does not let me change, spend or contact anything');
    // And the caveat is said once, above all of them, rather than under each.
    expect(page.body).toContain('a movement, not a diagnosis');
    expect(page.body.split('movement, not a diagnosis')).toHaveLength(2);

    const candidate = (await query(
      `SELECT id FROM responsibility_candidates
        WHERE product_id = ? AND status = 'pending'
          AND proposed_responsibility = 'keep the support queue answered'`, [falling]))
      .rows[0] as Record<string, unknown>;

    const answered = await asOwner(
      `/letter/responsibility-candidates/${String(candidate.id)}/promote`,
      { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body: 'return_to=company' });
    // BACK TO THE COMPANY HE WAS LOOKING AT, built from the id the route
    // resolved server-side — never from the form.
    expect(answered.location).toBe(`/foundry/companies/${falling}?done=recognised`);

    const held = (await query(
      `SELECT title, state FROM institutional_responsibilities WHERE product_id = ?`,
      [falling])).rows as unknown as Array<Record<string, unknown>>;
    expect(held.map((r) => String(r.title))).toContain('keep the support queue answered');
    // Five rungs below anything that touches the world.
    expect(held.every((r) => String(r.state) === 'visible')).toBe(true);
  });

  it('will not carry a decision about someone else\'s company', async () => {
    await query('INSERT INTO founders (id,clerk_user_id,email) VALUES (?,?,?)',
      ['nt_stranger', 'clerk_str', 'stranger@example.com']);
    await query("INSERT INTO products (id,name,owner_id,status) VALUES (?,?,?,'active')",
      ['nt_theirs', 'Theirs', 'nt_stranger']);
    // Real evidence, because the schema insists on it — a candidate grounded in
    // nothing is refused before ownership is even considered.
    await query(
      `INSERT INTO signal_events (id,product_id,source,event_type,severity,payload_json,summary)
       VALUES ('nt_foreign_sig','nt_theirs','support','support_queue_observed','low','{}','x')`);
    await query(
      `INSERT INTO responsibility_candidates
         (id,product_id,convergence_key,proposed_responsibility,evidence_refs_json,
          derivation_method,rationale,epistemic_status,observed_at)
       VALUES ('nt_foreign','nt_theirs','k','anything',
               '[{"kind":"signal_event","id":"nt_foreign_sig"}]','m','r','known',datetime('now'))`);
    const refused = await asOwner('/letter/responsibility-candidates/nt_foreign/promote',
      { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body: 'return_to=company' });
    expect(refused.status).toBe(403);
  });
});
