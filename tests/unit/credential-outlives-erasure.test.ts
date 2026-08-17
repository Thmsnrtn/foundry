// =============================================================================
// Tests: a credential must not outlive the company it belongs to
//
// Erasure archives the product, severs the operating relationship and clears
// the GitHub token. It did not clear `ingest_token` or `share_token`, and
// neither surface checks the company's state:
//
//   POST /ingest/metrics   resolves the product FROM the token, then writes
//   GET  /share/:token     resolves the product FROM the token, then renders
//
// So after a founder's data was erased, the token their monitoring script
// posts with still worked — writing fresh rows into the company that had just
// been deleted — and a share link handed out months earlier still rendered its
// name and metrics to anyone holding the URL.
//
// The credential names the subject correctly. What was missing is the other
// half of the same question: is that subject still one Foundry acts for?
// =============================================================================

process.env.TURSO_DATABASE_URL = 'file::memory:';
process.env.ENCRYPTION_KEY = '0'.repeat(64);

import { beforeAll, describe, expect, it } from 'vitest';

import { runMigrations } from '../../src/db/migrate.js';
import { query } from '../../src/db/client.js';

const F = 'cr_founder';
const LIVE = 'cr_live';
const GONE = 'cr_gone';

beforeAll(async () => {
  await runMigrations();
  await query(`INSERT INTO founders (id, clerk_user_id, email) VALUES (?,?,?)`,
    [F, 'cr_clerk', 'cr@example.com']);
  await query(
    `INSERT INTO products (id, name, owner_id, status, scp_status, ingest_token, share_token)
     VALUES (?,'Live Co',?, 'active','active','cr_live_ingest','cr_live_share')`, [LIVE, F]);
  await query(
    `INSERT INTO products (id, name, owner_id, status, scp_status, ingest_token, share_token)
     VALUES (?,'Gone Co',?, 'active','active','cr_gone_ingest','cr_gone_share')`, [GONE, F]);
});

describe('erasure clears the credentials it leaves behind', () => {
  it('removes the ingest and share tokens with everything else', async () => {
    const { processScheduledDeletions, scheduleDataDeletion } = await import(
      '../../src/services/privacy/consent.js');
    await scheduleDataDeletion(GONE, 0);
    await processScheduledDeletions();

    const row = (await query(
      `SELECT ingest_token, share_token, status FROM products WHERE id = ?`, [GONE]))
      .rows[0] as Record<string, string | null>;
    expect(row.status).toBe('archived');
    expect(row.ingest_token, 'a live write credential for a deleted company').toBeNull();
    expect(row.share_token, 'a public link to a deleted company').toBeNull();
  });

  it('leaves a live company alone', async () => {
    const row = (await query(
      `SELECT ingest_token, share_token FROM products WHERE id = ?`, [LIVE]))
      .rows[0] as Record<string, string | null>;
    expect(row.ingest_token).toBe('cr_live_ingest');
    expect(row.share_token).toBe('cr_live_share');
  });
});

describe('the surfaces ask whether the company still exists', () => {
  it('resolves an ingest token only for a company that is not archived', async () => {
    // Belt as well as braces: clearing the token is the fix, and a surface that
    // would have written into an archived company if the token survived is a
    // surface that will do it again the next time a column is missed.
    await query(
      `UPDATE products SET ingest_token = 'cr_zombie', status = 'archived' WHERE id = ?`, [GONE]);
    const { resolveIngestProduct } = await import('../../src/routes/ingest/index.js');
    expect(await resolveIngestProduct('cr_zombie')).toBeNull();
  });

  it('still resolves it for a live company', async () => {
    const { resolveIngestProduct } = await import('../../src/routes/ingest/index.js');
    expect(await resolveIngestProduct('cr_live_ingest')).toBe(LIVE);
  });

  it('resolves it for a paused company, which is not a deleted one', async () => {
    // A paused company still owns its data and may still be receiving metrics
    // from its own systems; pausing Foundry's action is not closing the
    // account. Only the archive axis closes the door.
    await query(`UPDATE products SET scp_status = 'paused' WHERE id = ?`, [LIVE]);
    const { resolveIngestProduct } = await import('../../src/routes/ingest/index.js');
    expect(await resolveIngestProduct('cr_live_ingest')).toBe(LIVE);
    await query(`UPDATE products SET scp_status = 'active' WHERE id = ?`, [LIVE]);
  });
});
