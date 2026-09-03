process.env.TURSO_DATABASE_URL = 'file::memory:';
process.env.ENCRYPTION_KEY = '0'.repeat(64);
process.env.FOUNDRY_INSTANCE_POSTURE = 'private_owner';
process.env.FOUNDRY_OWNER_EMAIL = 'owner@example.com';

import { beforeAll, describe, expect, it, vi } from 'vitest';
import { runMigrations } from '../../src/db/migrate.js';
import { query } from '../../src/db/client.js';
import { formClaim, standingOf } from '../../src/services/venture/market-evidence.js';
import { relevanceOf } from '../../src/services/venture/sources/npm-registry.js';
import { askWhatAlreadyExists } from '../../src/services/venture/sources/index.js';
import { capability, recordMaturity } from '../../src/services/institution/capabilities.js';

// =============================================================================
// THE FIRST REAL WAY OF LOOKING.
//
// A public package registry — read-only, no credential, no cost — answering the
// question that decides a digital venture before anything is built: does a
// solution to this already exist, is anybody maintaining it, how used is it.
//
// THE DEFECT THIS FILE EXISTS AROUND. Asked what already existed for "licence
// renewal deadline reminder", the registry returned fifteen maintained
// packages — CodeMirror extensions, a clipboard helper, a markdown previewer —
// and the first version filed all fifteen as substitutes and let them
// contradict the claim. Fluent, sourced, dated, and completely false. Relevance
// is now decided here rather than taken from the registry's ranking.
//
// The network is stubbed: what is being tested is what Foundry MAKES of an
// answer, and a test that depended on a live registry would fail for reasons
// that have nothing to do with that.
// =============================================================================

const OWNER = 'npm_owner';

function reply(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200, headers: { 'content-type': 'application/json' } });
}

beforeAll(async () => {
  await runMigrations();
  await query('INSERT INTO founders (id,clerk_user_id,email,name) VALUES (?,?,?,?)',
    [OWNER, 'clerk_npm', 'owner@example.com', 'Owner']);
});

describe('deciding relevance ourselves', () => {
  it('refuses a result that shares nothing but a ranking', () => {
    // The exact result the registry actually returned for that query.
    const how = relevanceOf('licence renewal deadline reminder',
      '@uiw/react-codemirror', 'CodeMirror component for React');
    expect(how.relevant).toBe(false);
    expect(how.shared).toEqual([]);
  });

  it('accepts one that is actually about the thing', () => {
    const how = relevanceOf('cron expression parser',
      'cron-expression-parser', 'Parse a cron expression into its fields');
    expect(how.relevant).toBe(true);
    expect(how.shared).toContain('cron');
    expect(how.shared).toContain('parser');
  });

  it('needs two shared words, because one is a coincidence', () => {
    expect(relevanceOf('veterinary shift handover', 'shift', 'A tiny array helper').relevant)
      .toBe(false);
    expect(relevanceOf('veterinary shift handover', 'vet-shift', 'Veterinary shift notes').relevant)
      .toBe(true);
  });
});

describe('a real look that finds nothing on the subject', () => {
  it('says so, says the search is a weak instrument, and supports the claim', async () => {
    const search = {
      total: 14920,
      objects: [
        { package: { name: '@uiw/react-codemirror', version: '4.0.0', date: '2026-07-08',
          description: 'CodeMirror component for React', links: { npm: 'https://npm/x' } } },
        { package: { name: '@uiw/copy-to-clipboard', version: '1.0.0', date: '2026-05-21',
          description: 'Copy text to clipboard', links: { npm: 'https://npm/y' } } },
      ],
    };
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(reply(search));

    const claimId = await formClaim({ founderId: OWNER, evidenceMode: 'real',
      claim: 'Nobody maintains a package for licence renewal deadline data' });
    const found = await askWhatAlreadyExists({
      founderId: OWNER, claimId, query: 'licence renewal deadline reminder',
      supportsIf: 'nothing_maintained_exists' });

    expect(found.looked).toBe(2);
    expect(found.relevant).toBe(0);
    expect(found.maintained).toBe(0);
    expect(found.bearing).toBe('supports');
    expect(found.sentence).toContain('none of them is about this');
    expect(found.sentence).toContain('weak instrument');
    // The registry's own count is kept as what it is, and is not a count of
    // substitutes.
    expect(found.matchedWords).toBe(14920);

    // AND THE STANDING IS HONEST ABOUT WHAT KIND OF SUPPORT THAT IS: an absence
    // is worked out, never seen.
    const how = await standingOf(claimId);
    expect(how?.howItStands).toContain('worked out rather than seen');
    vi.restoreAllMocks();
  });
});

describe('a real look that finds something', () => {
  it('contradicts the claim, and names what it found so it can be checked', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(reply({
      total: 400,
      objects: [
        { package: { name: 'cron-expression-parser', version: '1.0.0', date: '2026-05-13',
          description: 'Parse a cron expression', links: { npm: 'https://npm/cron1' } } },
        { package: { name: 'old-cron-parser', version: '0.1.0', date: '2019-02-01',
          description: 'A cron expression parser, unmaintained',
          links: { npm: 'https://npm/cron2' } } },
      ],
    }));

    const claimId = await formClaim({ founderId: OWNER, evidenceMode: 'real',
      claim: 'No maintained cron expression parser exists' });
    const found = await askWhatAlreadyExists({
      founderId: OWNER, claimId, query: 'cron expression parser',
      supportsIf: 'nothing_maintained_exists' });

    expect(found.relevant).toBe(2);
    // Relevant, and one of them abandoned — which is a different fact.
    expect(found.maintained).toBe(1);
    expect(found.bearing).toBe('contradicts');
    expect(found.named[0]?.name).toBe('cron-expression-parser');

    // Each named one is filed with the words it shares, so the relevance
    // judgement can be argued with rather than trusted.
    const seen = (await query(
      `SELECT saw, source_type FROM market_observations WHERE claim_id = ?`, [claimId]))
      .rows as unknown as Array<Record<string, unknown>>;
    expect(seen.some((o) => String(o.saw).includes('shares: cron, expression, parser'))).toBe(true);
    // THREE KINDS OF KNOWING, KEPT APART: the listing is what the registry
    // observed; the package's own words are self-reported.
    expect(seen.map((o) => String(o.source_type))).toContain('directory');
    expect(seen.map((o) => String(o.source_type))).toContain('vendor_site');
    vi.restoreAllMocks();
  });
});

describe('looking raises what looking cannot settle', () => {
  it('files the questions a registry cannot answer, with what would', async () => {
    const open = (await query(
      `SELECT question, cheapest_test FROM market_unknowns WHERE founder_id = ?`, [OWNER]))
      .rows as unknown as Array<Record<string, unknown>>;
    const questions = open.map((u) => String(u.question));
    expect(questions).toContain('whether anybody pays for any of this');
    expect(questions).toContain('whether the downloads are people or automated builds');
    const pays = open.find((u) => String(u.question).includes('pays'));
    expect(String(pays?.cheapest_test)).toContain('asking somebody who has the problem');
  });
});

describe('maturity is not granted by connecting', () => {
  it('arrives declared, and reality-proof takes real evidence with a name on it', async () => {
    const c = await capability('read_package_registry');
    expect(c?.providers[0]?.maturity).toBe('declared');
    await expect(recordMaturity({
      providerId: 'cp_npm_registry', to: 'reality_proven',
      evidence: 'it is wired up', evidenceMode: 'reference', witnessedBy: 'me' }))
      .rejects.toThrow(/reality_proven_needs_real_evidence/);
  });
});
