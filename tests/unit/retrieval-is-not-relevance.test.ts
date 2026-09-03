process.env.TURSO_DATABASE_URL = 'file::memory:';
process.env.ENCRYPTION_KEY = '0'.repeat(64);
process.env.FOUNDRY_INSTANCE_POSTURE = 'private_owner';
process.env.FOUNDRY_OWNER_EMAIL = 'owner@example.com';

import { beforeAll, describe, expect, it, vi } from 'vitest';
import { runMigrations } from '../../src/db/migrate.js';
import { query } from '../../src/db/client.js';
import { formClaim, standingOf } from '../../src/services/venture/market-evidence.js';
import { askWhatAlreadyExists, askWhatPeopleSay } from '../../src/services/venture/sources/index.js';

// =============================================================================
// RETRIEVAL IS NOT RELEVANCE, AND RELEVANCE IS NOT SUPPORT.
//
// A real source, a real URL and a real date do not make valid evidence. Three
// things are kept and each transition between them is inspectable: what the
// source returned, what was judged on-subject and on what words, and what a
// claim may therefore rest on.
//
// AND A SECOND WAY OF KNOWING CHANGES WHAT IS BELIEVED. A registry answers
// "what exists". A discussion archive answers "what hurts". When they disagree,
// the institution refuses to average them — which is the whole reason to have
// more than one.
// =============================================================================

const OWNER = 'ret_owner';

function reply(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200, headers: { 'content-type': 'application/json' } });
}

beforeAll(async () => {
  await runMigrations();
  await query('INSERT INTO founders (id,clerk_user_id,email,name) VALUES (?,?,?,?)',
    [OWNER, 'clerk_ret', 'owner@example.com', 'Owner']);
});

describe('what the source returned is kept, believed or not', () => {
  it('keeps the rejected items, which are how the judgement is checked', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(reply({
      total: 14920,
      objects: [
        { package: { name: 'deadline-reminder-cli', version: '1.0.0', date: '2026-06-01',
          description: 'Reminders before a licence renewal deadline',
          links: { npm: 'https://npm/good' } } },
        { package: { name: '@uiw/react-codemirror', version: '4.0.0', date: '2026-07-08',
          description: 'CodeMirror component for React', links: { npm: 'https://npm/bad' } } },
      ],
    }));
    const claimId = await formClaim({ founderId: OWNER, evidenceMode: 'real',
      claim: 'Nobody maintains a licence renewal deadline reminder' });
    const found = await askWhatAlreadyExists({
      founderId: OWNER, claimId, query: 'licence renewal deadline reminder',
      supportsIf: 'nothing_maintained_exists',
      alsoCouldBeCalled: ['expiry', 'certificate expiration'] });

    const items = (await query(
      `SELECT label, relevant, shared_terms FROM retrieval_items
        WHERE retrieval_id = ? ORDER BY rowid`, [found.retrievalId]))
      .rows as unknown as Array<Record<string, unknown>>;
    expect(items).toHaveLength(2);
    // BOTH KEPT. The rejected one is the important half.
    const rejected = items.find((i) => String(i.label) === '@uiw/react-codemirror');
    expect(Number(rejected?.relevant)).toBe(0);
    const accepted = items.find((i) => String(i.label) === 'deadline-reminder-cli');
    expect(Number(accepted?.relevant)).toBe(1);
    expect(String(accepted?.shared_terms)).toContain('deadline');
    vi.restoreAllMocks();
  });

  it('separates what the source had from what was examined from what was relevant', async () => {
    const r = (await query(
      `SELECT terms, returned_count, examined_count, relevant_count, not_also_tried,
              would_most_help, cannot_see FROM market_retrievals ORDER BY rowid DESC LIMIT 1`, []))
      .rows[0] as Record<string, unknown>;
    expect(Number(r.returned_count)).toBe(14920);
    expect(Number(r.examined_count)).toBe(2);
    expect(Number(r.relevant_count)).toBe(1);
    // The words nobody tried are part of the finding, not a footnote.
    expect(String(r.not_also_tried)).toContain('certificate expiration');
    expect(String(r.cannot_see)).toContain('whether anybody pays');
    expect(String(r.would_most_help).length).toBeGreaterThan(10);
  });

  it('never lets a retrieval or its items be rewritten afterwards', async () => {
    const r = (await query('SELECT id FROM market_retrievals LIMIT 1', []))
      .rows[0] as Record<string, unknown>;
    await expect(query(
      'UPDATE market_retrievals SET relevant_count = 99 WHERE id = ?', [String(r.id)]))
      .rejects.toThrow(/immutable/);
    await expect(query(
      'UPDATE retrieval_items SET relevant = 1 WHERE retrieval_id = ?', [String(r.id)]))
      .rejects.toThrow(/immutable/);
  });
});

describe('absence is not presence', () => {
  it('marks a finding that rests on nothing being found', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(reply({
      total: 500,
      objects: [{ package: { name: 'unrelated-thing', version: '1.0.0', date: '2026-01-01',
        description: 'Something else entirely', links: { npm: 'https://npm/z' } } }],
    }));
    const claimId = await formClaim({ founderId: OWNER, evidenceMode: 'real',
      claim: 'Nothing exists for veterinary shift handover' });
    await askWhatAlreadyExists({ founderId: OWNER, claimId,
      query: 'veterinary shift handover', supportsIf: 'nothing_maintained_exists' });

    const obs = (await query(
      `SELECT from_absence, retrieval_id, directness FROM market_observations
        WHERE claim_id = ?`, [claimId])).rows as unknown as Array<Record<string, unknown>>;
    expect(obs).toHaveLength(1);
    expect(Number(obs[0]?.from_absence)).toBe(1);
    // And it points back at the coverage that produced it.
    expect(obs[0]?.retrieval_id).not.toBeNull();
    // An absence is always worked out, never seen.
    expect(String(obs[0]?.directness)).toBe('inferred');

    const how = await standingOf(claimId);
    expect(how?.howItStands).toContain('worked out rather than seen');
    vi.restoreAllMocks();
  });

  it('will not let provenance be attached after the fact', async () => {
    const o = (await query('SELECT id FROM market_observations LIMIT 1', []))
      .rows[0] as Record<string, unknown>;
    // The guard that caught this design: an observation whose provenance could
    // be edited later is an observation whose provenance means nothing.
    await expect(query(
      "UPDATE market_observations SET retrieval_id = 'forged' WHERE id = ?", [String(o.id)]))
      .rejects.toThrow(/immutable/);
  });
});

describe('the machine collapses into judgment', () => {
  it('gives one paragraph, and keeps everything under it inspectable', async () => {
    const { howItWasResearched, whatItLookedAt } = await import(
      '../../src/services/venture/market-evidence.js');
    const claim = (await query(
      `SELECT id FROM market_claims WHERE claim LIKE 'Nobody maintains a licence%'`, []))
      .rows[0] as Record<string, unknown>;
    const done = await howItWasResearched(String(claim.id));

    // WHAT THE OWNER MEETS: how much, how many ways, what weakens it, what is
    // still unknown. Not sources, not crawling, not tool calls.
    expect(done?.judgment).toContain('real observation');
    expect(done?.judgment).toContain('kind');
    expect(done?.judgment).toContain('largest unknown');
    expect(done?.judgment).not.toMatch(/registry\.npmjs|http|api\./);

    // AND THE COVERAGE UNDER IT, which is the honest half of any negative.
    const cov = done?.coverage[0];
    expect(cov?.had).toBe(14920);
    expect(cov?.examined).toBe(2);
    expect(cov?.onSubject).toBe(1);
    expect(cov?.cannotSee).toContain('whether anybody pays');
    expect(cov?.notAlsoTried).toContain('certificate expiration');

    // AND THE DEEPEST LAYER: everything it looked at, believed or not, with the
    // words that decided — so a relevance call can be argued with.
    const items = await whatItLookedAt(cov?.retrievalId ?? '');
    expect(items).toHaveLength(2);
    const rejected = items.find((i) => !i.believed);
    expect(rejected?.label).toBe('@uiw/react-codemirror');
    expect(rejected?.sharedTerms).toEqual([]);
    const kept = items.find((i) => i.believed);
    expect(kept?.sharedTerms).toContain('deadline');
    expect(kept?.writtenAt).toBe('2026-06-01');
  });
});

describe('a second way of knowing', () => {
  it('judges relevance in free text too, because an archive matches words', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(reply({
      nbHits: 2,
      hits: [
        { objectID: '1', created_at: '2026-01-04T00:00:00Z',
          comment_text: 'Where cron expression parsing gets hard is time zones and '
            + 'daylight saving. Every parser I have tried gets it subtly wrong.' },
        { objectID: '2', created_at: '2025-06-01T00:00:00Z',
          comment_text: 'A sibling and me constructed a con-lang and wrote a parser '
            + 'for it in reverse polish order. It failed badly.' },
      ],
    }));
    const claimId = await formClaim({ founderId: OWNER, evidenceMode: 'real',
      claim: 'Cron scheduling is a solved problem' });
    const said = await askWhatPeopleSay({
      founderId: OWNER, claimId, terms: 'cron expression parser',
      supportsIf: 'nobody_mentions_it' });

    // The con-lang comment shares "parser" and nothing else. An earlier version
    // of this file claimed archive results were on-subject by construction;
    // running it against the real archive proved that false in one go.
    expect(said.said).toBe(1);
    expect(said.bearing).toBe('contradicts');
    expect(said.voices[0]?.text).toContain('time zones');

    const items = (await query(
      `SELECT relevant FROM retrieval_items WHERE retrieval_id = ?`, [said.retrievalId]))
      .rows as unknown as Array<Record<string, unknown>>;
    expect(items.filter((i) => Number(i.relevant) === 1)).toHaveLength(1);
    vi.restoreAllMocks();
  });

  it('changes what is believed, and refuses to average the disagreement', async () => {
    const claimId = (await query(
      `SELECT id FROM market_claims WHERE claim = 'Cron scheduling is a solved problem'`, []))
      .rows[0] as Record<string, unknown>;

    // The registry says solved. The community says people are still describing
    // where it hurts. Both are real, dated and attributed.
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(reply({
      total: 400,
      objects: [{ package: { name: 'cron-expression-parser', version: '2.0.0',
        date: '2026-05-13', description: 'Parse a cron expression',
        links: { npm: 'https://npm/cron' } } }],
    }));
    await askWhatAlreadyExists({ founderId: OWNER, claimId: String(claimId.id),
      query: 'cron expression parser', supportsIf: 'something_maintained_exists' });
    vi.restoreAllMocks();

    const how = await standingOf(String(claimId.id));
    expect(how?.supports).toBeGreaterThan(0);
    expect(how?.contradicts).toBeGreaterThan(0);
    expect(how?.howItStands).toContain('not going to average that into a verdict');
    expect(how?.howItStands).toContain('the question is open');
  });
});
