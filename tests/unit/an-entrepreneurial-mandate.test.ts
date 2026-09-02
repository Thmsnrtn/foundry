process.env.TURSO_DATABASE_URL = 'file::memory:';
process.env.ENCRYPTION_KEY = '0'.repeat(64);
process.env.FOUNDRY_INSTANCE_POSTURE = 'private_owner';
process.env.FOUNDRY_OWNER_EMAIL = 'owner@example.com';

import { beforeAll, describe, expect, it } from 'vitest';
import { Hono } from 'hono';
import { runMigrations } from '../../src/db/migrate.js';
import { query } from '../../src/db/client.js';
import {
  absorbGuidance, currentMandate, mandateProgress, openMandate,
  readVentureSentence, scepticismLevel, stopMandate, survivesGuidance,
} from '../../src/services/venture/mandate.js';

// =============================================================================
// THE VENTURE ORIGINATION ACCEPTANCE TEST.
//
// The owner set this as a primary acceptance test for the mature Private
// Foundry, and it is preserved in the constitution. This file is the executable
// half of it: the sentences he named, the steering he named, and the two
// refusals that make the whole thing honest rather than impressive.
//
//   "I'd like you to add a new micro-SaaS venture to my portfolio."
//
// must be heard as an ENTREPRENEURIAL MANDATE, not an instruction to build
// software. Everything he says afterwards must be ABSORBED INTO IT rather than
// treated as chat.
//
// AND IT MUST PRODUCE NOTHING UNTIL IT CAN SEE. Foundry has no market sense, so
// there is nowhere for a claim about the world to come from. A fluent list of
// opportunities assembled from a model's recollection would read exactly like
// research and be invented evidence — laundered into owner truth the moment a
// company was created on the strength of it.
// =============================================================================

const OWNER = 'vm_owner';

beforeAll(async () => {
  await runMigrations();
  await query('INSERT INTO founders (id,clerk_user_id,email,name) VALUES (?,?,?,?)',
    [OWNER, 'clerk_vm', 'owner@example.com', 'Owner']);
});

describe('hearing the mandate', () => {
  it('hears the owner\'s own sentence as a mandate, and names the shape', () => {
    const read = readVentureSentence(
      "I'd like you to add a new micro-SaaS venture to my portfolio");
    expect(read.kind).toBe('mandate');
    if (read.kind === 'mandate') expect(read.shape).toBe('micro_saas');
  });

  it('does not hear it as an instruction to build software', () => {
    // THE FAILURE THIS EXISTS TO PREVENT. Nothing in the reading produces a
    // product, a repository or a plan — it produces a search.
    const read = readVentureSentence('add a new SaaS business to my portfolio');
    expect(read.kind).toBe('mandate');
    expect(JSON.stringify(read)).not.toMatch(/build|repository|product|code/i);
  });

  it('accepts a mandate with no shape, because that is a real mandate', () => {
    const read = readVentureSentence('find me another business');
    expect(read.kind).toBe('mandate');
    if (read.kind === 'mandate') expect(read.shape).toBeNull();
  });

  it('hears every piece of steering the owner named', () => {
    const cases = [
      ["I don't want paid acquisition", 'avoid', 'paid acquisition'],
      ['Look for higher-ticket opportunities', 'prefer', 'higher ticket'],
      ['Target healthcare logistics instead', 'industry', null],
      ['Spend no more than $20 validating it', 'budget', '20'],
      ['Try harder to disprove it', 'harder', null],
      ['Research this more deeply', 'deeper', null],
      ['I like this one', 'favour', null],
      ['Show me another option', 'another', null],
    ] as const;
    for (const [said, kind, subject] of cases) {
      const read = readVentureSentence(said);
      expect(read.kind, said).toBe('guidance');
      if (read.kind === 'guidance') {
        expect(read.guidance, said).toBe(kind);
        if (subject !== null) expect(read.subject, said).toContain(subject);
      }
    }
  });

  it('hears "stop"', () => {
    expect(readVentureSentence('Stop looking').kind).toBe('stop_mandate');
  });

  it('refuses to guess at a sentence it does not recognise', () => {
    expect(readVentureSentence('do something clever about ventures').kind)
      .toBe('not_venture');
  });
});

describe('steering is absorbed, not acknowledged', () => {
  it('holds one search at a time', async () => {
    const first = await openMandate({
      founderId: OWNER, statement: 'add a new micro-SaaS venture', shape: 'micro_saas' });
    expect('refused' in first).toBe(false);
    const second = await openMandate({
      founderId: OWNER, statement: 'find me another business', shape: null });
    // Two searches compete for the same attention and the same budget, and
    // deciding which wins is exactly the judgement that is his.
    expect('refused' in second).toBe(true);
  });

  it('filters every candidate by what he said to avoid', async () => {
    const open = await currentMandate(OWNER);
    if (!open) throw new Error('expected a mandate');
    await absorbGuidance({
      mandateId: open.id, statement: "I don't want paid acquisition",
      kind: 'avoid', subject: 'paid acquisition' });

    const steered = await currentMandate(OWNER);
    if (!steered) throw new Error('expected a mandate');
    // THE POINT OF THE WHOLE THING: it is applied to candidates, not filed.
    const rejected = survivesGuidance({
      headline: 'A scheduling tool for clinics',
      why: 'reached entirely through paid acquisition on search ads',
    }, steered.guidance);
    expect(rejected.survives).toBe(false);
    expect(rejected.because).toContain('you told me not to');

    const kept = survivesGuidance({
      headline: 'A scheduling tool for clinics',
      why: 'reached through referrals from existing practice software',
    }, steered.guidance);
    expect(kept.survives).toBe(true);
  });

  it('raises the bar when he says to try harder', async () => {
    const before = await currentMandate(OWNER);
    if (!before) throw new Error('expected a mandate');
    expect(scepticismLevel(before.guidance)).toBe(1);
    await absorbGuidance({
      mandateId: before.id, statement: 'Try harder to disprove it',
      kind: 'harder', subject: null });
    const after = await currentMandate(OWNER);
    expect(scepticismLevel(after?.guidance ?? [])).toBe(2);
  });

  it('replaces an industry rather than widening the search', async () => {
    const open = await currentMandate(OWNER);
    if (!open) throw new Error('expected a mandate');
    await absorbGuidance({ mandateId: open.id, statement: 'Target dentistry',
      kind: 'industry', subject: 'dentistry' });
    await absorbGuidance({ mandateId: open.id, statement: 'Target logistics instead',
      kind: 'industry', subject: 'logistics' });

    const now = await currentMandate(OWNER);
    const industries = (now?.guidance ?? []).filter((g) => g.kind === 'industry');
    // Two industries is a wider search, not a redirected one.
    expect(industries).toHaveLength(1);
    expect(industries[0]?.subject).toBe('logistics');

    // And the record still says he changed his mind, rather than only knowing
    // where the search currently points.
    const all = (await query(
      `SELECT COUNT(*) AS n FROM venture_guidance
        WHERE mandate_id = ? AND kind = 'industry'`, [open.id]))
      .rows[0] as Record<string, unknown>;
    expect(Number(all.n)).toBe(2);
  });

  it('never rewrites what he said', async () => {
    const row = (await query(
      'SELECT id FROM venture_guidance ORDER BY rowid LIMIT 1', []))
      .rows[0] as Record<string, unknown>;
    await expect(query(
      "UPDATE venture_guidance SET statement = 'something else' WHERE id = ?",
      [String(row.id)])).rejects.toThrow(/immutable/);
  });
});

describe('what it can honestly report', () => {
  it('says it cannot see the market, rather than producing candidates', async () => {
    // THE REFUSAL THAT MAKES THIS HONEST. A language model can produce a fluent
    // market analysis from recollection with no source anyone could check. That
    // is invented evidence wearing a research report's clothes.
    const progress = await mandateProgress(OWNER);
    expect(progress?.looked).toBe(0);
    expect(progress?.blocked).toContain('cannot see what is happening outside');
    expect(progress?.blocked).toContain('not going to describe opportunities from');
    expect(progress?.wouldNeed).toContain('rather say so than hand you a');
  });

  it('models that gap as a sense, so it unblocks itself when one exists', async () => {
    const sense = (await query(
      "SELECT cannot_see, never_grants FROM senses WHERE sense_key = 'market'", []))
      .rows[0] as Record<string, unknown>;
    expect(String(sense.cannot_see)).toContain('outside your companies');
    // And what seeing the market would still never permit.
    expect(String(sense.never_grants)).toContain('create a\ncompany on my own'.replace('\n', ' '));
  });

  it('offers no provider for it, rather than a button that would fail', async () => {
    const n = (await query(
      "SELECT COUNT(*) AS n FROM sense_providers WHERE sense_key = 'market'", []))
      .rows[0] as Record<string, unknown>;
    expect(Number(n.n)).toBe(0);
  });
});

describe('the candidate discipline', () => {
  it('refuses a candidate with no stated way to die', async () => {
    const open = await currentMandate(OWNER);
    if (!open) throw new Error('expected a mandate');
    await expect(query(
      `INSERT INTO venture_opportunities
         (id,mandate_id,founder_id,headline,who_has_it,the_problem,why_it_might,
          kill_thesis,evidence_mode)
       VALUES ('vm_o1',?,?,'A thing','someone','a problem','it might work','','real')`,
      [open.id, OWNER])).rejects.toThrow(/incomplete/);
  });

  it('refuses to advance a candidate nothing could be checked against', async () => {
    const open = await currentMandate(OWNER);
    if (!open) throw new Error('expected a mandate');
    await query(
      `INSERT INTO venture_opportunities
         (id,mandate_id,founder_id,headline,who_has_it,the_problem,why_it_might,
          kill_thesis,evidence_mode)
       VALUES ('vm_o2',?,?,'A thing','clinics','scheduling is manual',
               'they already pay for worse','they will not switch','real')`,
      [open.id, OWNER]);
    await expect(query(
      `UPDATE venture_opportunities SET verdict = 'advanced', verdict_why = 'looks good',
              decided_at = datetime('now') WHERE id = 'vm_o2'`))
      .rejects.toThrow(/advanced_without_sources/);

    // Rejecting it needs no sources — refusing to pursue something is always
    // available, and rejection is the valuable half.
    await expect(query(
      `UPDATE venture_opportunities SET verdict = 'rejected',
              verdict_why = 'nothing I could check', decided_at = datetime('now')
        WHERE id = 'vm_o2'`)).resolves.toBeDefined();
  });

  it('keeps what it rejected, and why', async () => {
    const row = (await query(
      "SELECT verdict, verdict_why FROM venture_opportunities WHERE id = 'vm_o2'", []))
      .rows[0] as Record<string, unknown>;
    expect(String(row.verdict)).toBe('rejected');
    expect(String(row.verdict_why)).toContain('nothing I could check');
    // NO DELETE GUARD, DELIBERATELY. A mandate belongs to a founder and there
    // is no marker for a person on their way out to key one on — so an
    // unconditional guard would block the one deletion that must work. What
    // must not change is enforced above: the verdict cannot be re-decided.
    await expect(query(
      `UPDATE venture_opportunities SET verdict = 'advanced',
              verdict_why = 'changed my mind' WHERE id = 'vm_o2'`))
      .rejects.toThrow(/already_decided/);
  });
});

describe('the reference world exercises the discipline', () => {
  it('puts candidates in front of a reference mandate, and none in front of a real one', async () => {
    // Foundry cannot see a real market, so a real mandate honestly finds
    // nothing. The machinery around a candidate still has to be exercised
    // somewhere, and it is the same reference world everything else is proven
    // in — marked, and unable to walk out.
    await stopMandate(OWNER, 'making room');
    const real = await openMandate({
      founderId: OWNER, statement: 'find me a business', shape: null });
    if ('refused' in real) throw new Error(real.refused);
    expect((await mandateProgress(OWNER))?.looked).toBe(0);

    await stopMandate(OWNER, 'making room');
    const ref = await openMandate({
      founderId: OWNER, statement: 'find me a business', shape: null,
      evidenceMode: 'reference' });
    if ('refused' in ref) throw new Error(ref.refused);
    const progress = await mandateProgress(OWNER);
    expect(progress?.looked).toBe(3);
  });

  it('kills the one its own thesis destroys, and keeps why', async () => {
    const open = await currentMandate(OWNER);
    if (!open) throw new Error('expected a mandate');
    const doomed = (await query(
      `SELECT id, kill_thesis FROM venture_opportunities
        WHERE mandate_id = ? AND headline LIKE '%unifies every tool%'`, [open.id]))
      .rows[0] as Record<string, unknown>;
    expect(String(doomed.kill_thesis)).toContain('dies every time');

    await query(
      `UPDATE venture_opportunities SET verdict = 'rejected',
              verdict_why = 'its own kill thesis lands: this has been built and died before',
              decided_at = datetime('now') WHERE id = ?`, [String(doomed.id)]);
    expect((await mandateProgress(OWNER))?.rejected).toBe(1);
  });

  it('rejects the one that fails what the owner said, by name', async () => {
    const open = await currentMandate(OWNER);
    if (!open) throw new Error('expected a mandate');
    await absorbGuidance({
      mandateId: open.id, statement: "I don't want paid acquisition",
      kind: 'avoid', subject: 'paid acquisition' });
    const steered = await currentMandate(OWNER);
    const candidate = (await query(
      `SELECT headline, why_it_might FROM venture_opportunities
        WHERE mandate_id = ? AND headline LIKE '%arbitrage%'`, [open.id]))
      .rows[0] as Record<string, unknown>;

    const verdict = survivesGuidance({
      headline: String(candidate.headline), why: String(candidate.why_it_might),
    }, steered?.guidance ?? []);
    expect(verdict.survives).toBe(false);
    expect(verdict.because).toContain('paid acquisition');
  });

  it('will not advance one whose unknowns include whether anyone pays', async () => {
    // The unknowns are not a caveat section. They are what decides whether a
    // candidate has earned a company.
    const open = await currentMandate(OWNER);
    if (!open) throw new Error('expected a mandate');
    const survivor = (await query(
      `SELECT id, unknowns_json FROM venture_opportunities
        WHERE mandate_id = ? AND headline LIKE '%veterinary%'`, [open.id]))
      .rows[0] as Record<string, unknown>;
    const unknowns = JSON.parse(String(survivor.unknowns_json)) as string[];
    expect(unknowns.some((u) => u.includes('would pay'))).toBe(true);
  });
});

describe('a reference mandate may never create a real company', () => {
  it('is refused by the database, not by a procedure', async () => {
    await stopMandate(OWNER, 'making room for the reference case');
    const ref = await openMandate({
      founderId: OWNER, statement: 'add a new micro-SaaS venture',
      shape: 'micro_saas', evidenceMode: 'reference' });
    if ('refused' in ref) throw new Error(ref.refused);

    await query("INSERT INTO products (id,name,owner_id,status) VALUES ('vm_real','Real Co',?,'active')",
      [OWNER]);
    await expect(query(
      'UPDATE venture_mandates SET became_product = ? WHERE id = ?',
      ['vm_real', ref.id])).rejects.toThrow(/reference_cannot_make_a_real_company/);
  });
});

describe('the owner walks it', () => {
  const asOwner = async (path: string, body?: string): Promise<{
    status: number; text: string; location: string | null;
  }> => {
    const { foundryShellRoutes } = await import('../../src/routes/dashboard/foundry-shell.js');
    const app = new Hono();
    app.use('*', async (c, next) => {
      c.set('founder' as never,
        { id: OWNER, email: 'owner@example.com', name: 'Owner' } as never);
      c.set('csrfToken' as never, 'test' as never);
      await next();
    });
    app.route('/', foundryShellRoutes as never);
    const res = await app.request(path, body == null ? undefined : {
      method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body,
    });
    return { status: res.status, text: await res.text(), location: res.headers.get('location') };
  };

  it('says what it would do before anything binds', async () => {
    const shown = await asOwner('/foundry/venture',
      'said=' + encodeURIComponent("I'd like you to add a new micro-SaaS venture to my portfolio"));
    expect(shown.status).toBe(200);
    expect(shown.text).toContain('Go and look?');
    expect(shown.text).toContain('not an instruction to build one');
    // Predictable consequence, in the grammar every binding act here uses.
    expect(shown.text).toContain('I cannot create a');
    expect(shown.text).toContain('Telling you\n        none of them are worth it is a real');
  });

  it('shows the search on the first screen, and says where it honestly is', async () => {
    await stopMandate(OWNER, 'clearing for the walk');
    const bound = await asOwner('/foundry/venture/confirm',
      'said=' + encodeURIComponent('add a new micro-SaaS venture to my portfolio'));
    expect(bound.location).toBe('/foundry?done=looking');

    const home = await asOwner('/foundry?done=looking');
    expect(home.text).toContain('What I am looking for');
    expect(home.text).toContain('cannot see what is happening outside');
  });

  it('absorbs steering typed into the ask box', async () => {
    const asked = await asOwner(
      `/foundry?q=${encodeURIComponent("I don't want paid acquisition")}`);
    // An instruction, not a question — offered as something to do.
    expect(asked.text).toContain('something for me to go and do');

    const shown = await asOwner('/foundry/venture',
      'said=' + encodeURIComponent("I don't want paid acquisition"));
    expect(shown.text).toContain('Hold the search to this?');
    expect(shown.text).toContain('reject any candidate that depends on paid acquisition');

    const bound = await asOwner('/foundry/venture/confirm',
      'said=' + encodeURIComponent("I don't want paid acquisition"));
    expect(bound.location).toBe('/foundry?done=steeredsearch');
    const open = await currentMandate(OWNER);
    expect(open?.guidance.some((g) => g.subject === 'paid acquisition')).toBe(true);
  });

  it('presents candidates as options, not as a pitch', async () => {
    // "Present me with a small number of serious options in plain owner
    // language" — who has the problem, what it is, why it might matter, the
    // strongest reason it fails, what is verified, what is unknown. No score.
    await stopMandate(OWNER, 'clearing');
    const ref = await openMandate({
      founderId: OWNER, statement: 'add a new micro-SaaS venture', shape: 'micro_saas',
      evidenceMode: 'reference' });
    if ('refused' in ref) throw new Error(ref.refused);

    const home = await asOwner('/foundry');
    expect(home.text).toContain('Who has it');
    expect(home.text).toContain('Strongest reason it fails');
    expect(home.text).toContain('What is still unknown');
    expect(home.text).toContain('What I checked it against');
    // AND WHY IT CANNOT EARN A COMPANY YET, on the card rather than a footnote.
    expect(home.text).toContain('cannot earn a company yet');
    // Invented, said before anything about it.
    expect(home.text).toContain('This came from a');
    // No score anywhere.
    expect(home.text).not.toMatch(/score|rating|\b\d+\/10\b/i);
  });

  it('remembers what he looked for before', async () => {
    await stopMandate(OWNER, 'the owner said to stop');
    const home = await asOwner('/foundry');
    expect(home.text).toContain('What you have looked for before');
    expect(home.text).toContain('not starting from nothing');
  });

  it('stops when he says stop, and keeps what it learned', async () => {
    await openMandate({ founderId: OWNER, statement: 'find me a business', shape: null });
    const shown = await asOwner('/foundry/venture',
      'said=' + encodeURIComponent('Stop looking'));
    expect(shown.text).toContain('Stop looking?');
    expect(shown.text).toContain('Everything I have already found stays on the');

    const done = await asOwner('/foundry/venture/confirm',
      'said=' + encodeURIComponent('Stop looking'));
    expect(done.location).toBe('/foundry?done=searchstopped');
    expect(await currentMandate(OWNER)).toBeNull();
  });
});
