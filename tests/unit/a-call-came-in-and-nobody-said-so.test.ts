process.env.TURSO_DATABASE_URL = 'file::memory:';
process.env.ENCRYPTION_KEY = '0'.repeat(64);

import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { nanoid } from 'nanoid';
import { stripComments } from '../../scripts/lib/strip-comments.mjs';
import { runMigrations } from '../../src/db/migrate.js';
import { query } from '../../src/db/client.js';

// The analysis is a model call; this test is about what happens around it.
vi.mock('../../src/services/ai/client.js', async (orig) => ({
  ...(await orig<Record<string, unknown>>()),
  callSonnet: vi.fn(async () => ({
    content: JSON.stringify({
      sentiment: 0.4, key_topics: ['pricing'], competitor_mentions: [],
      objections: [], commitments: [], summary: 'They want annual billing.',
    }),
    tokensUsed: 10, costUsd: 0,
  })),
}));

const { analyzeTranscript } = await import('../../src/services/integrations/transcripts.js');

// =============================================================================
// A CALL CAME IN, AND NOBODY SAID SO.
//
// A customer call arrives by webhook from Fathom or Fireflies, is stored,
// analysed, and rendered on `/signals/multimodal` — and nothing told the
// founder it had happened. They had to navigate there and think to look.
//
// The frontier carried this as an open question for several cycles: "whether a
// founder is told a transcript arrived at all, or must navigate to the page to
// find out. That is a 'where does a person read this' question about NOTICE."
// The sense reached a page. It did not reach a person.
//
// It stayed open because telling the founder meant choosing how loudly, and
// until migration 182 the quiet rungs of `ux/interruption.ts` wrote nothing —
// so a founder who preferred to read it tomorrow would have lost it entirely.
// With that fixed the answer is ordinary: `attention`, which the policy puts in
// the Letter unless the founder says otherwise.
//
// NOT FOR A TRANSCRIPT THE FOUNDER PASTED IN. They already know. Reporting
// somebody's own action back to them as news is how a notification stream
// becomes something people stop reading.
// =============================================================================

beforeAll(async () => { await runMigrations(); });
beforeEach(async () => {
  await query('DELETE FROM quieted_events');
  await query('DELETE FROM notifications');
  await query('DELETE FROM call_transcripts');
  await query('DELETE FROM products');
  await query('DELETE FROM founders');
});

async function transcript(source: string): Promise<{ id: string; productId: string; founderId: string }> {
  const founderId = `f_${nanoid(8)}`;
  await query('INSERT INTO founders (id, clerk_user_id, email) VALUES (?,?,?)',
    [founderId, `c_${founderId}`, `${founderId}@example.com`]);
  const productId = `p_${nanoid(8)}`;
  await query("INSERT INTO products (id, name, owner_id, status) VALUES (?,?,?,'active')",
    [productId, 'Acme', founderId]);
  const id = nanoid();
  await query(
    `INSERT INTO call_transcripts (id, product_id, source, call_type, transcript_text, call_date)
     VALUES (?,?,?, 'customer', 'We talked about pricing.', date('now'))`,
    [id, productId, source]);
  return { id, productId, founderId };
}

/** Everywhere a notice could have landed: the bell, or the Letter's quiet rung. */
async function noticesFor(productId: string): Promise<number> {
  const bells = await query('SELECT id FROM notifications WHERE product_id = ?', [productId]);
  const quiet = await query('SELECT id FROM quieted_events WHERE product_id = ?', [productId]);
  return bells.rows.length + quiet.rows.length;
}

describe('a call that arrived on its own', () => {
  it('reaches the founder, not just the page', async () => {
    const { id, productId } = await transcript('fathom');
    await analyzeTranscript(id);
    expect(await noticesFor(productId), 'the sense reached a page and stopped')
      .toBeGreaterThan(0);
  });

  it('says what was heard, and where to read it', async () => {
    const { id, productId } = await transcript('fireflies');
    await analyzeTranscript(id);
    const rows = await query(
      'SELECT title, body FROM quieted_events WHERE product_id = ?', [productId]);
    const row = rows.rows[0] as unknown as Record<string, string>;
    expect(row.title).toMatch(/customer call came in from fireflies/);
    expect(row.body, "the model's reading of customer speech, shown as such")
      .toMatch(/What I heard: They want annual billing\./);
  });

  it('goes to the Letter rather than ringing a bell', async () => {
    const { id, productId } = await transcript('fathom');
    await analyzeTranscript(id);
    const quiet = await query(
      "SELECT importance, channel FROM quieted_events WHERE product_id = ?", [productId]);
    const row = quiet.rows[0] as unknown as Record<string, string>;
    expect(row.importance).toBe('attention');
    expect(row.channel, 'a call came in — read it tomorrow').toBe('letter');
  });
});

describe('a transcript the founder pasted in', () => {
  it('is not reported back to them as news', async () => {
    const { id, productId } = await transcript('manual');
    await analyzeTranscript(id);
    expect(await noticesFor(productId),
      "they already know; it is how a notification stream stops being read").toBe(0);
  });
});

describe('the notice never costs the analysis', () => {
  it('still stores the analysis when there is no owner to tell', async () => {
    // A product whose owner row is missing: the notice cannot be delivered.
    const id = nanoid();
    const productId = `p_${nanoid(8)}`;
    const founderId = `f_${nanoid(8)}`;
    await query('INSERT INTO founders (id, clerk_user_id, email) VALUES (?,?,?)',
      [founderId, `c_${founderId}`, `${founderId}@example.com`]);
    await query("INSERT INTO products (id, name, owner_id, status) VALUES (?,?,?,'active')",
      [productId, 'Acme', founderId]);
    await query('DELETE FROM founders WHERE id = ?', [founderId]).catch(() => {});
    await query(
      `INSERT INTO call_transcripts (id, product_id, source, call_type, transcript_text, call_date)
       VALUES (?,?, 'fathom', 'customer', 'text', date('now'))`, [id, productId]);

    await analyzeTranscript(id);
    const rows = await query('SELECT summary, processed_at FROM call_transcripts WHERE id = ?', [id]);
    const row = rows.rows[0] as unknown as Record<string, unknown>;
    expect(row.summary, 'the transcript is the fact; the notice is not').toBeTruthy();
    expect(row.processed_at).toBeTruthy();
  });

  it('is written so a failure cannot swallow the result', () => {
    const src = stripComments(
      readFileSync('src/services/integrations/transcripts.ts', 'utf8'), { lineComments: true });
    const idx = src.indexOf('transcript arrival notice failed');
    expect(idx, 'the notice has its own catch').toBeGreaterThan(-1);
  });
});
