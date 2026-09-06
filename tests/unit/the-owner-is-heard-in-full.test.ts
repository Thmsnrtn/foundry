// =============================================================================
// THE OWNER IS HEARD IN FULL, AND WHAT HE SAID REACHES THE SEARCH.
//
// The paragraph he will actually type:
//
//   "Make the river stronger. Find another small digital income stream that
//    would make the portfolio more resilient, keep legal risk low and require
//    almost none of my attention. Spend no more than $25 proving anything
//    before reality earns more."
//
// Read against the tip before this change, that paragraph produced two mandate
// readings (the second dropped on the floor), one legal preference, and no
// attention preference at all: "require almost none of my attention" was
// folded into "keep legal risk low" because "require" did not open a clause
// and "none" was not a word the reader knew. And whatever was heard reached
// the candidates only after they were found; the search itself looked exactly
// as if he had said nothing.
//
// This file falsifies each of those, and holds the line that matters most:
// nothing he said may become a product form the search filters by.
// =============================================================================

process.env.TURSO_DATABASE_URL = 'file::memory:';
process.env.ENCRYPTION_KEY = '0'.repeat(64);
process.env.FOUNDRY_INSTANCE_POSTURE = 'private_owner';
process.env.FOUNDRY_OWNER_EMAIL = 'owner@example.com';

import { beforeAll, describe, expect, it, vi } from 'vitest';

const prompts: string[] = [];
vi.mock('../../src/services/ai/client.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../src/services/ai/client.js')>()),
  callSonnet: async (_system: string, user: string) => {
    prompts.push(user);
    return { content: JSON.stringify({ abstain: 'nothing here is about work' }), model: 'stub',
      usage: { input_tokens: 0, output_tokens: 0 }, stop_reason: null };
  },
}));

import { query } from '../../src/db/client.js';
import { runMigrations } from '../../src/db/migrate.js';
import { absorbParagraph, currentMandate, readVentureParagraph } from '../../src/services/venture/mandate.js';
import { briefFor } from '../../src/services/venture/discovery.js';
import { formClaim, observe } from '../../src/services/venture/market-evidence.js';
import { interpret } from '../../src/services/venture/interpretation.js';

const OWNER = 'heard_owner';
const PARAGRAPH = 'Make the river stronger. Find another small digital income stream that would make '
  + 'the portfolio more resilient, keep legal risk low and require almost none of my attention. '
  + 'Spend no more than $25 proving anything before reality earns more.';

/** Words that name a product form. None of them may appear in a search term
 * that came from what he said. ("no tool does this" is a gap somebody named,
 * from the portfolio vocabulary, and stays.) */
const FORM_WORDS = /\b(saas|app|plugin|newsletter|course|template|ebook|api|marketplace|agency|extension|bot|dashboard)\b/i;
const FORM_WORDS_STRICT = /\b(saas|app|plugin|newsletter|course|template|ebook|api|marketplace|agency|extension|bot|dashboard|tool)\b/i;

beforeAll(async () => {
  await runMigrations();
  await query('INSERT INTO founders (id,clerk_user_id,email,name) VALUES (?,?,?,?)',
    [OWNER, 'clerk_heard', 'owner@example.com', 'Owner']);
  await query('INSERT INTO products (id, owner_id, name, status) VALUES (?,?,?,?)',
    ['heard_co', OWNER, 'Tidewater', 'active']);
});

describe('reading the paragraph', () => {
  it('hears every clause, including the one about his attention', () => {
    const readings = readVentureParagraph(PARAGRAPH);
    const kinds = readings.map((r) => r.kind === 'guidance' ? `${r.guidance}:${r.dimension ?? ''}` : r.kind);
    expect(kinds.filter((k) => k === 'mandate')).toHaveLength(2);
    expect(kinds).toContain('prefer:legal_exposure');
    expect(kinds).toContain('prefer:owner_attention');
    expect(kinds).toContain('budget:');
    expect(kinds).not.toContain('not_venture');
    const attention = readings.find((r) => r.kind === 'guidance' && r.dimension === 'owner_attention');
    expect(attention?.statement).toBe('require almost none of my attention.');
    const budget = readings.find((r) => r.kind === 'guidance' && r.guidance === 'budget');
    expect(budget && budget.kind === 'guidance' ? budget.subject : null).toBe('25');
    // His words are never rewritten: no reading names a shape he did not.
    for (const r of readings) if (r.kind === 'mandate') expect(r.shape).toBeNull();
  });

  it('does not hear the opposite the same way: "a little of my time" is not "almost none"', () => {
    for (const s of ['it can have a little of my time', 'it will take nothing but my time',
      'find me another business, be it a newsletter or a course']) {
      const r = readVentureParagraph(s);
      expect(r.some((x) => x.kind === 'guidance' && x.dimension === 'owner_attention')).toBe(false);
    }
    // A named shape survives a sentence that also says "be it".
    const shaped = readVentureParagraph('find me another business, be it a newsletter or a course');
    expect(shaped.filter((x) => x.kind === 'not_venture')).toHaveLength(0);
  });

  it('hears "needs none of my time" and "takes almost nothing of my attention" the same way', () => {
    for (const s of ['it needs none of my time', 'something that takes almost nothing of my attention',
      'demand very little of my attention']) {
      const r = readVentureParagraph(s)[0];
      expect(r?.kind === 'guidance' ? r.dimension : r?.kind).toBe('owner_attention');
    }
  });
});

describe('a sentence that asks and steers in one breath', () => {
  it('opens the search and steers it, rather than refusing the steering for want of a search', async () => {
    const ONE = 'heard_one';
    await query('INSERT INTO founders (id,clerk_user_id,email,name) VALUES (?,?,?,?)',
      [ONE, 'clerk_heard_one', 'one@example.com', 'One']);
    const readings = readVentureParagraph('Find another income stream that needs none of my time.');
    expect(readings[0]?.kind).toBe('guidance');
    const result = await absorbParagraph({ founderId: ONE, readings });
    expect(result.opened).toBe(true);
    expect(result.refused).toEqual([]);
    expect(result.absorbed).toBe(1);
    const m = await currentMandate(ONE);
    expect(m?.statement).toBe('Find another income stream that needs none of my time.');
    expect(m?.shape).toBeNull();
    expect(m?.guidance[0]?.dimension).toBe('owner_attention');
  });
});

describe('absorbing it', () => {
  it('opens one search carrying both of his sentences, and absorbs all three pieces of steering', async () => {
    const result = await absorbParagraph({ founderId: OWNER, readings: readVentureParagraph(PARAGRAPH) });
    expect(result.opened).toBe(true);
    expect(result.refused).toEqual([]);
    expect(result.notHeard).toEqual([]);
    expect(result.absorbed).toBe(3);
    const mandate = await currentMandate(OWNER);
    expect(mandate?.statement).toBe('Make the river stronger. Find another small digital income stream that '
      + 'would make the portfolio more resilient');
    expect(mandate?.shape).toBeNull();
    expect(mandate?.guidance.map((g) => g.dimension).sort()).toEqual(['legal_exposure', 'owner_attention', null].sort());
  });
});

describe('the search hears him', () => {
  it('holds the brief to his words, adds terms from what he said, records where each came from, and names no form', async () => {
    const mandate = await currentMandate(OWNER);
    if (!mandate) throw new Error('no mandate');
    const brief = await briefFor({ founderId: OWNER, mandateId: mandate.id, world: 'real' });
    if (!brief) throw new Error('no brief');
    expect(brief.heldTo).toContain('keep legal risk low');
    expect(brief.heldTo).toContain('require almost none of my attention');
    expect(brief.shapeNamed).toBeNull();
    expect(brief.terms.length).toBeGreaterThan(5);
    expect(brief.terms).toContain('runs itself without me');
    expect(brief.terms).toContain('pay once and download');
    expect(brief.termsFrom).toHaveLength(brief.terms.length);
    expect(brief.termsFrom.some((f) => f.startsWith('he said: require almost none of my attention'))).toBe(true);
    expect(brief.termsFrom.some((f) => f.startsWith('he said: keep legal risk low'))).toBe(true);
    for (const t of brief.terms) expect(t).not.toMatch(FORM_WORDS);
    const stored = (await query('SELECT terms_from, terms_tried FROM search_briefs WHERE id = ?', [brief.id]))
      .rows[0] as Record<string, unknown>;
    expect(JSON.parse(String(stored.terms_from))).toEqual(brief.termsFrom);
    expect(String(stored.terms_tried)).toContain('runs itself without me');
  });

  it('the vocabulary itself names no product form and cannot be edited', async () => {
    const rows = (await query('SELECT phrase FROM search_emphasis', [])).rows as unknown as Array<Record<string, unknown>>;
    expect(rows.length).toBeGreaterThan(10);
    for (const r of rows) expect(String(r.phrase)).not.toMatch(FORM_WORDS_STRICT);
    await expect(query(`INSERT INTO search_emphasis (id, dimension, guidance_kind, phrase, why, sort_order) VALUES ('x','owner_attention','prefer','a saas for','y',99)`, []))
      .rejects.toThrow(/constitutional/);
  });

  it('the reader is told what he holds the search to, as relevance and not as a shape', async () => {
    const claimId = await formClaim({ founderId: OWNER, evidenceMode: 'real',
      claim: 'somebody wrote: "we keep a spreadsheet for this"' });
    const observationId = await observe({ founderId: OWNER, claimId, sourceType: 'community',
      source: 'https://forum.example/1', saw: 'we keep a spreadsheet for this and it breaks every month',
      bearing: 'supports', directness: 'direct', observedAt: new Date(), evidenceMode: 'real' });
    prompts.length = 0;
    await interpret({ founderId: OWNER, observationId, lookingFor: 'anything that earns',
      heldTo: 'keep legal risk low; require almost none of my attention', world: 'real' });
    expect(prompts).toHaveLength(1);
    expect(prompts[0]).toContain('holds the search to this, in his words: keep legal risk low; require almost none of my attention');
    expect(prompts[0]).toContain('not a fact about the');
  });
});
