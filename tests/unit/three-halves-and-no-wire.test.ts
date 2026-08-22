process.env.TURSO_DATABASE_URL = 'file::memory:';
process.env.ENCRYPTION_KEY = '0'.repeat(64);

import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { stripComments } from '../../scripts/lib/strip-comments.mjs';
import { runMigrations } from '../../src/db/migrate.js';
import { query } from '../../src/db/client.js';

// =============================================================================
// THREE HALVES AND NO WIRE.
//
// Scribe's prompt has always asked the model for `wiki_contributions` — title,
// body, tags — and `ScribeClaudeResponse` has always declared the field.
// Nothing read it. The agent paid for those tokens on every weekly cycle and
// threw the articles away.
//
// At step 4 it READS `agent_wiki_entries` to see what the company already
// knows. The only module that could write that table, `services/scp/wiki.ts`,
// was imported by nothing at all — 231 lines on the unreachable-modules
// baseline. So the wiki was permanently empty, `wikiSummary` was permanently
// 'No wiki entries yet', and the sentence in this agent's own header — "queries
// agent_wiki_entries table for knowledge gaps" — could not be served.
//
// A producer, a store and a reader, all present, with no wire between them.
// This is the wire. It is not a new capability: every part of it already
// existed and one of them was already being paid for.
//
// WHAT IS DELIBERATELY NOT CLAIMED. `confidence_score` is written as the
// store's default. The model is not asked to rate its own articles and does
// not, so reading that number as a confidence would be reading a judgement
// nobody made.
// =============================================================================

const SCRIBE = 'src/services/scp/agents/scribe.ts';

let contributions: unknown = [];
vi.mock('../../src/services/ai/client.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../src/services/ai/client.js')>()),
  callSonnet: async () => ({
    content: JSON.stringify({
      observations: ['ok'], content_briefs: [], knowledge_gaps: [],
      document_proposals: [], wiki_contributions: contributions,
      briefing_contribution: 'Reviewed.', briefing_priority: 'normal',
    }),
    model: 'stub', usage: { input_tokens: 0, output_tokens: 0 }, stop_reason: null,
  }),
}));

beforeAll(async () => {
  await runMigrations();
  await query("INSERT INTO founders (id, clerk_user_id, email) VALUES ('f_w','c_w','w@example.com')");
  await query("INSERT INTO products (id, name, owner_id, status) VALUES ('p_w','Acme','f_w','active')");
  // Something for the agent to analyse, so it does not take its no-data path.
  await query(
    `INSERT INTO founding_story_artifacts (id, product_id, phase, artifact_type, title, content, published)
     VALUES ('ca_w','p_w','build','milestone','First hundred customers','Body',1)`);
});
beforeEach(async () => { await query('DELETE FROM agent_wiki_entries'); });

async function runScribe(): Promise<{ result: { actionsTaken: Array<{ description: string; result?: string }> } }> {
  const { default: ScribeAgent } = await import('../../src/services/scp/agents/scribe.js');
  const agent = new ScribeAgent();
  // `analyzeAndAct` is protected and takes the query function BaseAgent hands
  // it, so the run is driven exactly as production drives it.
  const result = await (agent as unknown as {
    analyzeAndAct(ctx: unknown, db: typeof query): Promise<unknown>;
  }).analyzeAndAct({
    productId: 'p_w', ownerId: 'f_w', agentName: 'scribe', authorityLevel: 0,
    lifecycleState: 'learning', integrationEvents: [], unreadMessages: [],
  }, query);
  return { result: result as never };
}

describe('what the model wrote is kept', () => {
  it('stores an article', async () => {
    contributions = [{
      title: 'How our customers describe the problem',
      content: 'They call it "chasing paper", not "workflow automation".',
      tags: ['positioning'], section: 'customers',
    }];

    await runScribe();

    const row = (await query('SELECT * FROM agent_wiki_entries')).rows[0] as Record<string, unknown>;
    expect(row.title).toBe('How our customers describe the problem');
    expect(row.section).toBe('customers');
    expect(row.author).toBe('scribe');
    expect(JSON.parse(String(row.tags))).toEqual(['positioning']);
  });

  it('does not store an article with no body', async () => {
    contributions = [{ title: 'A title alone', content: '   ', tags: [] }];
    await runScribe();
    expect((await query('SELECT id FROM agent_wiki_entries')).rows.length,
      'an empty row is something the next reader has to discount').toBe(0);
  });

  it('does not store an article with no title', async () => {
    contributions = [{ title: '', content: 'Some knowledge', tags: [] }];
    await runScribe();
    expect((await query('SELECT id FROM agent_wiki_entries')).rows.length).toBe(0);
  });

  it('puts an unstated or invented section in "other" rather than raising', async () => {
    contributions = [
      { title: 'No section given', content: 'body', tags: [] },
      { title: 'Invented section', content: 'body', tags: [], section: 'vibes' },
    ];
    await runScribe();
    const rows = (await query('SELECT section FROM agent_wiki_entries')).rows as unknown as
      Array<Record<string, unknown>>;
    expect(rows.length).toBe(2);
    expect(rows.every((r) => r.section === 'other')).toBe(true);
  });

  it('revises rather than duplicating on a later run', async () => {
    contributions = [{ title: 'Positioning', content: 'first pass', tags: [], section: 'market' }];
    await runScribe();
    contributions = [{ title: 'Positioning', content: 'second pass', tags: [], section: 'market' }];
    await runScribe();

    const rows = (await query('SELECT content, version FROM agent_wiki_entries')).rows as unknown as
      Array<Record<string, unknown>>;
    expect(rows.length, 'a weekly agent would otherwise accumulate near-duplicates').toBe(1);
    expect(rows[0]!.content).toBe('second pass');
    expect(Number(rows[0]!.version)).toBe(2);
  });

  it('says how many it wrote in the action it records', async () => {
    contributions = [
      { title: 'One', content: 'body', tags: [], section: 'product' },
      { title: 'Two', content: 'body', tags: [], section: 'product' },
    ];
    const { result } = await runScribe();
    const action = result.actionsTaken[0]!;
    expect(action.description).toMatch(/2 wiki articles written/);
    expect(action.result).toMatch(/Wiki: One; Two/);
  });

  it('and says nothing about a wiki when it wrote none', async () => {
    contributions = [];
    const { result } = await runScribe();
    expect(result.actionsTaken[0]!.result).toBe('Analysis stored in session');
  });
});

describe('the reader now has something to read', () => {
  it('scribe reads the table it writes', () => {
    const code = stripComments(readFileSync(SCRIBE, 'utf8'), { lineComments: true });
    // Through the wiki module, not a second copy of the query. This used to
    // assert the raw `SELECT title, section AS category FROM agent_wiki_entries`
    // that lived here — ordered by `created_at`, which froze the list on the
    // first five titles ever written once five existed, so Scribe could not see
    // its own revisions. `listWikiEntries` orders by `updated_at` and returns
    // the total, and there is now one definition of what the wiki says.
    expect(code).toMatch(/listWikiEntries/);
    expect(code).toMatch(/createWikiEntry/);
  });

  it('the store is no longer a module nothing can reach', () => {
    expect(readFileSync('docs/db/unreachable-modules-baseline.txt', 'utf8'))
      .not.toMatch(/scp\/wiki\.ts/);
  });
});

describe('nothing is claimed that nobody said', () => {
  it('confidence is the store default, not a rating the model gave', () => {
    const code = readFileSync(SCRIBE, 'utf8');
    expect(code).toMatch(/confidence_score: 0,/);
    // The prompt does not ask for one, so there is none to carry.
    const prompt = code.slice(code.indexOf('"wiki_contributions"'), code.indexOf('"briefing_contribution"'));
    expect(prompt).not.toMatch(/confidence/);
  });

  it('a failed wiki write does not cost the rest of the run', async () => {
    contributions = [{ title: 'Fine', content: 'body', tags: [], section: 'product' }];
    const { result } = await runScribe();
    expect(result.actionsTaken.length).toBeGreaterThan(0);
    const code = readFileSync(SCRIBE, 'utf8');
    expect(code).toMatch(/could not store a wiki contribution/);
  });
});
