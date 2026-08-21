process.env.TURSO_DATABASE_URL = 'file::memory:';
process.env.ENCRYPTION_KEY = '0'.repeat(64);

import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { nanoid } from 'nanoid';
import { stripComments } from '../../scripts/lib/strip-comments.mjs';
import { runMigrations } from '../../src/db/migrate.js';
import { query } from '../../src/db/client.js';
import { composeLetter } from '../../src/services/letter/composer.js';

// =============================================================================
// WHAT FOUNDRY MADE, AND WHETHER IT ASKED.
//
// `action_drafts` is a second execution path beside `action_executions`:
// pricing copy, landing copy, an onboarding flow, a remediation PR. When one
// executed, the result was written TWICE — `execution_result` on the draft, and
// a whole row in `auto_execution_log` carrying the draft id, the action type, a
// trigger of 'auto_gate_0' or 'founder_approved', the output and a success
// flag.
//
// Nothing read either. So the one path where Foundry produces something BY
// ITSELF was the one path a founder could not see it had: the Letter's "what
// ran without you" reads `action_executions` and gate-0 `decisions`, and this
// appeared in neither.
//
// Every field of the log was already on the draft — including the one that
// carries accountability, which is `approved_at IS NULL`. A second table added
// a second place to look and a second chance for the two to disagree. Migration
// 185 retires it and the Letter reads the survivor.
//
// The distinction is the point. "Made you a pricing page" and "made you a
// pricing page without asking" are different sentences, and only one of them is
// the founder's own decision coming back to them.
// =============================================================================

beforeAll(async () => { await runMigrations(); });
beforeEach(async () => {
  await query('DELETE FROM action_drafts');
  await query('DELETE FROM products');
  await query('DELETE FROM founders');
});

async function company(): Promise<{ productId: string; ownerId: string }> {
  const ownerId = `f_${nanoid(8)}`;
  await query('INSERT INTO founders (id, clerk_user_id, email) VALUES (?,?,?)',
    [ownerId, `c_${ownerId}`, `${ownerId}@example.com`]);
  const productId = `p_${nanoid(8)}`;
  await query("INSERT INTO products (id, name, owner_id, status) VALUES (?,?,?,'active')",
    [productId, 'Acme', ownerId]);
  return { productId, ownerId };
}

async function executedDraft(
  productId: string, ownerId: string,
  opts: { title: string; gate: number; approved: boolean; result: string },
) {
  await query(
    `INSERT INTO action_drafts
       (id, product_id, owner_id, action_type, title, draft_content, artifact_type,
        gate, status, approved_at, executed_at, execution_result)
     VALUES (?,?,?, 'pricing_page_copy', ?, 'body', 'pricing_page_copy', ?, 'executed', ?, datetime('now'), ?)`,
    [nanoid(), productId, ownerId, opts.title, opts.gate,
      opts.approved ? new Date().toISOString() : null, opts.result]);
}

describe('the Letter says what Foundry made', () => {
  it('names an artifact the founder approved', async () => {
    const { productId, ownerId } = await company();
    await executedDraft(productId, ownerId, {
      title: 'New pricing page', gate: 2, approved: true, result: 'Copy provided in the draft content.',
    });

    const letter = await composeLetter(productId, 'plain');
    expect(letter.handled.join(' | ')).toMatch(/Made this after you approved it: New pricing page/);
    expect(letter.handled.join(' | '), 'the result travels with it')
      .toMatch(/Copy provided in the draft content/);
  });

  it('says when it did not ask', async () => {
    const { productId, ownerId } = await company();
    await executedDraft(productId, ownerId, {
      title: 'Onboarding tweak', gate: 0, approved: false, result: 'ready for deployment',
    });

    const letter = await composeLetter(productId, 'plain');
    expect(letter.handled.join(' | '),
      'the founder trusted the category, which is not the same as approving this')
      .toMatch(/without asking, because you had trusted it with the category: Onboarding tweak/);
  });

  it('tells the two apart in the same letter', async () => {
    const { productId, ownerId } = await company();
    await executedDraft(productId, ownerId, { title: 'Approved thing', gate: 2, approved: true, result: 'x' });
    await executedDraft(productId, ownerId, { title: 'Unasked thing', gate: 0, approved: false, result: 'y' });

    const joined = (await composeLetter(productId, 'technical')).handled.join(' | ');
    expect(joined).toMatch(/Executed on approval: Approved thing/);
    expect(joined).toMatch(/Auto-executed \(gate 0\): Unasked thing/);
  });

  it('does not report a draft that never executed', async () => {
    const { productId, ownerId } = await company();
    await query(
      `INSERT INTO action_drafts
         (id, product_id, owner_id, action_type, title, draft_content, artifact_type, gate, status)
       VALUES (?,?,?, 'pricing_page_copy', 'Still a draft', 'body', 'pricing_page_copy', 0, 'draft')`,
      [nanoid(), productId, ownerId]);

    const letter = await composeLetter(productId, 'plain');
    expect(letter.handled.join(' | ')).not.toMatch(/Still a draft/);
  });

  it('does not report one from last week', async () => {
    const { productId, ownerId } = await company();
    await query(
      `INSERT INTO action_drafts
         (id, product_id, owner_id, action_type, title, draft_content, artifact_type,
          gate, status, executed_at, execution_result)
       VALUES (?,?,?, 'pricing_page_copy', 'Old thing', 'body', 'pricing_page_copy', 0,
               'executed', datetime('now','-8 days'), 'x')`,
      [nanoid(), productId, ownerId]);

    const letter = await composeLetter(productId, 'plain');
    expect(letter.handled.join(' | '), 'the Letter is a day, not an archive')
      .not.toMatch(/Old thing/);
  });
});

describe('one record, not two', () => {
  it('has retired the duplicate log', async () => {
    const rows = await query(
      "SELECT name FROM sqlite_master WHERE type='table' AND name='auto_execution_log'");
    expect(rows.rows.length).toBe(0);

    const src = stripComments(
      readFileSync('src/services/decisions/actions.ts', 'utf8'), { lineComments: true });
    expect(src).not.toMatch(/auto_execution_log/);
  });

  it('kept the field that carries accountability', async () => {
    // `approved_at IS NULL` is what "Foundry did this alone" means, and it was
    // the only thing the retired log's `trigger` column recorded.
    const cols = (await query('PRAGMA table_info(action_drafts)')).rows as unknown as
      Array<Record<string, unknown>>;
    const names = cols.map((c) => String(c.name));
    expect(names).toContain('approved_at');
    expect(names).toContain('execution_result');
  });

  it('shrank both ratchets rather than moving the problem', () => {
    expect(readFileSync('docs/db/unread-tables-baseline.txt', 'utf8'))
      .not.toMatch(/auto_execution_log/);
    expect(readFileSync('docs/db/write-only-columns-baseline.txt', 'utf8'),
      'the surviving record now has a reader')
      .not.toMatch(/action_drafts\.execution_result/);
  });
});
