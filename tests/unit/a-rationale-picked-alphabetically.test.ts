process.env.TURSO_DATABASE_URL = 'file::memory:';
process.env.ENCRYPTION_KEY = '0'.repeat(64);

import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

// =============================================================================
// A RATIONALE PICKED ALPHABETICALLY, BESIDE THE DATE OF A DIFFERENT SIGNAL.
//
// `getTopAcquirerCandidates` selected `MAX(strategic_rationale)` — over strings
// that returns the one sorting last — and put it in the same row as
// `MAX(detected_at)`, headed "Latest". A reader takes the sentence beside the
// latest date to be the latest sentence. It was whichever one began with the
// highest character.
//
// The card is read as the current thinking on an acquirer, and it is also fed
// to the model that writes the acquisition thesis.
//
// The same function's thesis prompt described the company with four labels,
// three of them wrong: "Product:" was the nanoid, "Current phase:" was the
// founder's market insight, "Key differentiator:" was the positioning
// statement, and an absent field read "Unknown" — a statement about the
// company rather than about Foundry's records.
// =============================================================================

const behaviour: { lastUserPrompt: string } = { lastUserPrompt: '' };

vi.mock('../../src/services/ai/client.js', async (orig) => {
  const actual = await orig<typeof import('../../src/services/ai/client.js')>();
  return {
    ...actual,
    callSonnet: async (_system: string, user: string) => {
      behaviour.lastUserPrompt = user;
      return { content: 'thesis', input_tokens: 1, output_tokens: 1 };
    },
  };
});

const { runMigrations } = await import('../../src/db/migrate.js');
const { query } = await import('../../src/db/client.js');
const { getTopAcquirerCandidates, generateAcquirerThesis } =
  await import('../../src/services/scp/exit/acquirer-tracker.js');

const P = 'p_aq';

beforeAll(async () => {
  await runMigrations();
  await query("INSERT INTO founders (id, clerk_user_id, email) VALUES ('f_aq','c_aq','aq@example.com')");
  await query("INSERT INTO products (id, name, owner_id, status) VALUES (?,'Harbourmaster','f_aq','active')", [P]);
});

beforeEach(async () => {
  await query('DELETE FROM acquirer_signals');
  await query('DELETE FROM product_dna');
  behaviour.lastUserPrompt = '';
});

async function signal(id: string, detectedAt: string, rationale: string | null) {
  await query(
    `INSERT INTO acquirer_signals
       (id, product_id, acquirer_name, acquirer_type, signal_type,
        signal_description, fit_score, strategic_rationale, detected_at)
     VALUES (?, ?, 'Northwind', 'strategic', 'manual', 'a signal', 0.8, ?, ?)`,
    [id, P, rationale, detectedAt],
  );
}

describe('the rationale on the acquirer card', () => {
  it('is the latest one, not the one that sorts last', async () => {
    await signal('s_old', '2026-01-01', 'They need our ingestion pipeline.');
    await signal('s_new', '2026-06-01', 'Acquired our nearest competitor last quarter.');

    const [candidate] = await getTopAcquirerCandidates(P);
    expect(candidate.latest_signal).toBe('2026-06-01');
    expect(candidate.strategic_rationale).toBe('Acquired our nearest competitor last quarter.');
    // 'T' > 'A': the old code returned the January sentence, next to the June date.
    expect(candidate.strategic_rationale).not.toBe('They need our ingestion pipeline.');
  });

  it('skips a later signal that recorded no rationale', async () => {
    await signal('s_a', '2026-01-01', 'They need our ingestion pipeline.');
    await signal('s_b', '2026-06-01', null);

    const [candidate] = await getTopAcquirerCandidates(P);
    expect(candidate.latest_signal).toBe('2026-06-01');
    expect(candidate.strategic_rationale).toBe('They need our ingestion pipeline.');
  });

  it('breaks a same-second tie by id rather than by chance', async () => {
    await signal('s_1', '2026-06-01T09:00:00Z', 'First rationale.');
    await signal('s_2', '2026-06-01T09:00:00Z', 'Second rationale.');
    const first = await getTopAcquirerCandidates(P);
    const second = await getTopAcquirerCandidates(P);
    expect(first[0].strategic_rationale).toBe(second[0].strategic_rationale);
    expect(first[0].strategic_rationale).toBe('Second rationale.'); // s_2 > s_1
  });

  it('says nothing when no signal recorded a rationale', async () => {
    await signal('s_x', '2026-06-01', null);
    const [candidate] = await getTopAcquirerCandidates(P);
    expect(candidate.strategic_rationale).toBeNull();
  });
});

describe('the acquisition thesis prompt', () => {
  it('names the company rather than handing the model its id', async () => {
    await generateAcquirerThesis(P);
    expect(behaviour.lastUserPrompt).toContain('Company: Harbourmaster');
    expect(behaviour.lastUserPrompt).not.toContain(P);
  });

  it('labels the founder’s market insight as what it is', async () => {
    await query(
      `INSERT INTO product_dna (id, product_id, market_insight, icp_pain)
       VALUES ('dna_1', ?, 'Ports are consolidating.', 'Manifests arrive as PDFs.')`,
      [P],
    );
    await generateAcquirerThesis(P);
    expect(behaviour.lastUserPrompt).toContain("The founder's market insight: Ports are consolidating.");
    expect(behaviour.lastUserPrompt).not.toContain('Current phase: Ports are consolidating.');
  });

  it('states an absent field as absent from Foundry, not as unknown about the company', async () => {
    await query(
      `INSERT INTO product_dna (id, product_id, icp_pain)
       VALUES ('dna_2', ?, 'Manifests arrive as PDFs.')`,
      [P],
    );
    await generateAcquirerThesis(P);
    expect(behaviour.lastUserPrompt).toContain('Target customer: not recorded in Foundry');
    expect(behaviour.lastUserPrompt).not.toMatch(/Target customer: Unknown/);
  });

  it('tells the model not to infer a DNA that was never recorded', async () => {
    await generateAcquirerThesis(P);
    expect(behaviour.lastUserPrompt).toContain('No Product DNA has been recorded');
    expect(behaviour.lastUserPrompt).toContain('Do not infer them.');
  });
});
