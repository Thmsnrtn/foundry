process.env.TURSO_DATABASE_URL = 'file::memory:';
process.env.ENCRYPTION_KEY = '0'.repeat(64);
process.env.FOUNDRY_INSTANCE_POSTURE = 'private_owner';
process.env.FOUNDRY_OWNER_EMAIL = 'owner@example.com';

import { beforeAll, describe, expect, it } from 'vitest';
import { Hono } from 'hono';
import { runMigrations } from '../../src/db/migrate.js';
import { query } from '../../src/db/client.js';

// =============================================================================
// THE FIRST SCREEN IS THE INSTITUTION'S, NOT ONE COMPANY'S.
//
// THE BREAK THIS FILE EXISTS FOR. `/foundry` resolved its company with
// `selectedProductId`, whose rule is "exactly one company, so the choice is
// unambiguous". True while the owner had one. The Companies page now invites
// him to add another — and the moment he did, that returned null, the context
// returned null, and the sacred first screen REDIRECTED HIM TO ONBOARDING.
// One tap from gone, with nothing to say why.
//
// Foundry is a specific row, named once in `system_identities`. Asking that
// question instead removes the dependency on how many companies he owns. And
// once the screen survives more than one company, it has to actually ANSWER for
// more than one: a question about a company that the first screen does not
// surface is a question he will not answer.
// =============================================================================

const OWNER = 'fs_owner';
const FOUNDRY = 'fs_foundry';
const OTHER = 'fs_other';

async function open(path: string): Promise<{ status: number; text: string; location: string | null }> {
  const { foundryShellRoutes } = await import('../../src/routes/dashboard/foundry-shell.js');
  const app = new Hono();
  app.use('*', async (c, next) => {
    c.set('founder' as never,
      { id: OWNER, email: 'owner@example.com', name: 'Thomas Norton' } as never);
    c.set('csrfToken' as never, 'test' as never);
    await next();
  });
  app.route('/', foundryShellRoutes as never);
  const res = await app.request(path);
  return { status: res.status, text: await res.text(), location: res.headers.get('location') };
}

beforeAll(async () => {
  await runMigrations();
  await query('INSERT INTO founders (id,clerk_user_id,email,name) VALUES (?,?,?,?)',
    [OWNER, 'clerk_fs', 'owner@example.com', 'Thomas Norton']);
  await query("INSERT INTO products (id,name,owner_id,status) VALUES (?,'Foundry',?,'active')",
    [FOUNDRY, OWNER]);
  await query(`INSERT INTO system_identities (identity_key,product_id,established_reason)
    VALUES ('foundry',?,'the institution operating itself')`, [FOUNDRY]);
  // One routine that has run, so the fixture reaches the state the owner
  // actually meets — an institution with something to report about itself —
  // rather than the honest but different "I have not learned anything yet".
  await query(`INSERT INTO job_health (job_name,last_success_at,consecutive_failures)
    VALUES ('institutional_judgment_tick', datetime('now'), 0)`);
});

describe('it survives the owner owning more than one company', () => {
  it('opens on one company', async () => {
    const home = await open('/foundry');
    expect(home.status).toBe(200);
    expect(home.text).toContain('Thomas');
  });

  it('still opens on two, which is where it used to disappear', async () => {
    await query("INSERT INTO products (id,name,owner_id,status) VALUES (?,'AcreOS',?,'active')",
      [OTHER, OWNER]);
    const home = await open('/foundry');
    expect(home.status).toBe(200);
    expect(home.location).toBeNull();
    expect(home.text).toContain('Everything is fine');
  });

  it('still opens on five', async () => {
    for (const n of [1, 2, 3]) {
      await query("INSERT INTO products (id,name,owner_id,status) VALUES (?,?,?,'active')",
        [`fs_more_${String(n)}`, `Company ${String(n)}`, OWNER]);
    }
    expect((await open('/foundry')).status).toBe(200);
  });
});

describe('it answers for the whole institution', () => {
  it('surfaces a question about another company, and names it', async () => {
    // A question the institution is holding about AcreOS. Before this, the
    // first screen read "Everything is fine. Nothing needs you." while an
    // unanswered question sat on a page he had no reason to open.
    await query(
      `INSERT INTO signal_events (id,product_id,source,event_type,severity,payload_json,summary)
       VALUES ('fs_sig',?,'support','support_queue_observed','low','{}','x')`, [OTHER]);
    await query(
      `INSERT INTO responsibility_candidates
         (id,product_id,convergence_key,proposed_responsibility,evidence_refs_json,
          derivation_method,rationale,epistemic_status,observed_at)
       VALUES ('fs_cand',?,'company_observation:keep_the_support_queue_answered',
               'keep the support queue answered',
               '[{"kind":"signal_event","id":"fs_sig"}]',
               'observed movement over thirty days on an independent channel',
               'more is arriving than was arriving a month ago — up about 43% on a month ago.',
               'known', datetime('now'))`, [OTHER]);

    const home = await open('/foundry');
    expect(home.text).toContain('Is this worth looking after at AcreOS?');
    expect(home.text).toContain('keep the support queue answered');
    expect(home.text).toContain('up about 43%');
    // THE CONSEQUENCE, STATED WHERE HE DECIDES. Recognition is not authority.
    expect(home.text).toContain('I cannot change anything');
    expect(home.text).not.toContain('Everything is fine');
  });

  it('sends the answer back to where he answered it', async () => {
    // He decided from the first screen; he should land back on the first
    // screen, not on a company page he was not looking at.
    const { foundryShellRoutes } = await import('../../src/routes/dashboard/foundry-shell.js');
    const { letterRoutes } = await import('../../src/routes/dashboard/letter.js');
    const app = new Hono();
    app.use('*', async (c, next) => {
      c.set('founder' as never, { id: OWNER, email: 'owner@example.com' } as never);
      c.set('csrfToken' as never, 'test' as never);
      await next();
    });
    app.route('/', foundryShellRoutes as never);
    app.route('/', letterRoutes as never);
    const res = await app.request('/letter/responsibility-candidates/fs_cand/promote', {
      method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: 'return_to=foundry',
    });
    expect(res.headers.get('location')).toBe('/foundry?done=recognised');

    const held = (await query(
      'SELECT title FROM institutional_responsibilities WHERE product_id = ?', [OTHER]))
      .rows as unknown as Array<Record<string, unknown>>;
    expect(held.map((r) => String(r.title))).toContain('keep the support queue answered');
  });

  it('never spends his attention on a company that does not exist', async () => {
    // The reference world is there to be watched, and its questions are real
    // questions about real machinery. But nothing is at stake in one, so
    // nothing about it NEEDS him — which is the only question this screen
    // answers. They wait on the company's own page, where he goes to look.
    const { establishReferenceCompany, advanceReferenceWorld } = await import(
      '../../src/services/reference/world.js');
    const { noticeWhatTheNumbersAreDoing } = await import(
      '../../src/services/institution/noticing.js');
    const ref = await establishReferenceCompany({
      scenarioKey: 'revenue_quietly_falling', ownerId: OWNER,
    });
    if (!ref) throw new Error('no reference company');
    await advanceReferenceWorld(ref.productId);
    const raised = await noticeWhatTheNumbersAreDoing(ref.productId);
    expect(raised.length).toBeGreaterThan(0);

    const home = await open('/foundry');
    expect(home.text).not.toContain('Northgate Reference Co');
    expect(home.text).toContain('Everything is fine');

    // And it is waiting where he would go to look.
    const { foundryShellRoutes } = await import('../../src/routes/dashboard/foundry-shell.js');
    const app = new Hono();
    app.use('*', async (c, next) => {
      c.set('founder' as never, { id: OWNER, email: 'owner@example.com' } as never);
      c.set('csrfToken' as never, 'test' as never);
      await next();
    });
    app.route('/', foundryShellRoutes as never);
    const company = await (await app.request(`/foundry/companies/${ref.productId}`)).text();
    expect(company).toContain('Is this worth me looking after?');
  });

  it('goes quiet again once nothing is waiting', async () => {
    // A quiet institution saying so is the success state, not an empty product.
    const home = await open('/foundry');
    expect(home.text).toContain('Everything is fine');
    expect(home.text).toContain('Nothing needs you');
  });
});

describe('asking about a company by name', () => {
  const ask = async (q: string): Promise<string> =>
    (await open(`/foundry?q=${encodeURIComponent(q)}`)).text;

  it('answers about the company he named, not about Foundry', async () => {
    // THE FAILURE THIS PREVENTS. Every question used to be answered about
    // Foundry itself, whichever business he named — a confident answer about
    // the wrong thing, which is worse than no answer.
    await query(
      `INSERT INTO metric_snapshots (id,product_id,snapshot_date,mrr_cents,new_mrr_cents)
       VALUES ('fs_then',?,date('now','-40 day'),5000000,400000)`, [OTHER]);
    await query(
      `INSERT INTO metric_snapshots (id,product_id,snapshot_date,mrr_cents,new_mrr_cents)
       VALUES ('fs_now',?,date('now'),4000000,300000)`, [OTHER]);

    const answer = await ask('How is AcreOS doing?');
    expect(answer).toContain('At AcreOS');
    expect(answer).toContain('$40.0k');
    // It reports movement and refuses to judge it.
    expect(answer).toContain('yours to say');
  });

  it('shows numbers as numbers rather than a wall of prose', async () => {
    const answer = await ask('Show me the numbers for AcreOS');
    expect(answer).toContain('$40.0k');
    expect(answer).toContain('down about 20% on a month ago');
    expect(answer).toContain('Open AcreOS');
    // The health paragraph is not what he asked for.
    expect(answer).not.toContain('of the numbers I can see are down');
  });

  it('answers what it is holding at that company', async () => {
    const answer = await ask('What are you working on at AcreOS?');
    expect(answer).toContain('At AcreOS I look after');
    expect(answer).toContain('keep the support queue answered');
  });

  it('answers what he has told it not to do there', async () => {
    const { setBoundary } = await import('../../src/services/institution/standing-intent.js');
    await setBoundary({ productId: OTHER, subject: 'contact_people',
      statement: 'Do not contact anyone at AcreOS' });
    const answer = await ask('What are you allowed to do at AcreOS?');
    expect(answer).toContain('Do not contact anyone at AcreOS');
  });

  it('says a company is invented before it says anything about it', async () => {
    const answer = await ask('How is Northgate Reference Co doing?');
    expect(answer).toContain('does not exist');
    expect(answer.indexOf('does not exist')).toBeLessThan(answer.indexOf('Open Northgate'));
  });

  it('still answers about Foundry when he named no company', async () => {
    const answer = await ask('Are you okay?');
    expect(answer).not.toContain('At AcreOS');
  });
});
