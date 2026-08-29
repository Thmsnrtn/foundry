process.env.TURSO_DATABASE_URL = 'file::memory:';

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import { runMigrations } from '../../src/db/migrate.js';
import { query } from '../../src/db/client.js';
import { csvCell, csvRow } from '../../src/lib/csv.js';
import { exportProductData } from '../../src/services/privacy/consent.js';

// =============================================================================
// A MESSAGE THAT RUNS WHEN YOU OPEN IT.
//
// A CSV cell beginning with `=`, `+`, `-`, `@`, a tab or a carriage return is
// treated as a FORMULA by Excel, LibreOffice and Google Sheets. The product
// export is `SELECT *` over every table carrying a `product_id`, which includes
// the bodies of messages customers wrote — so a customer can put a formula in a
// support message and have it evaluate when the founder opens their own data
// export.
//
// Two escapers existed, in the privacy export and the audit-log export. Both
// quoted correctly for RFC 4180 and neither neutralised a formula. One escaper
// now, and a test that compares the two call sites against it.
//
// Neutralised in CSV, exact in JSON: an export is meant to be the data, so the
// fidelity format keeps its fidelity and the spreadsheet format gets
// spreadsheet-safe escaping. `/privacy/export` already defaults to JSON.
// =============================================================================

const P = 'csv_product';
const OWNER = 'csv_owner';
const ATTACK = '=HYPERLINK("http://example.invalid","click me")';

beforeAll(async () => {
  await runMigrations();
  await query('INSERT INTO founders (id,clerk_user_id,email) VALUES (?,?,?)', [OWNER, 'csv_c', 'o@test.local']);
  await query('INSERT INTO products (id,name,owner_id) VALUES (?,?,?)', [P, 'Exporting Co', OWNER]);
});

describe('a cell a spreadsheet would execute', () => {
  it('neutralises every leading character that starts a formula', () => {
    for (const lead of ['=', '+', '@', '\t', '\r']) {
      expect(csvCell(`${lead}SUM(A1)`).replace(/^"|"$/g, '').startsWith("'")).toBe(true);
    }
    expect(csvCell('-SUM(A1)').startsWith("'")).toBe(true);
  });

  it('leaves a number alone, because a number is not a formula', () => {
    // Turning a company's own figures into `'-42` would corrupt the export to
    // prevent nothing.
    expect(csvCell(-42)).toBe('-42');
    expect(csvCell('-42')).toBe('-42');
    expect(csvCell('-42.5')).toBe('-42.5');
  });

  it('still quotes for RFC 4180, which both copies already did', () => {
    expect(csvCell('a,b')).toBe('"a,b"');
    expect(csvCell('say "hi"')).toBe('"say ""hi"""');
    expect(csvCell('two\nlines')).toBe('"two\nlines"');
    expect(csvCell(null)).toBe('');
    expect(csvCell(undefined)).toBe('');
  });

  it('quotes a neutralised cell that also needs quoting', () => {
    expect(csvCell('=A1,B1')).toBe('"\'=A1,B1"');
  });

  it('writes a row in the header order given', () => {
    expect(csvRow(['b', 'a'], { a: '1', b: '2' })).toBe('2,1');
  });
});

describe('the export a customer can write into', () => {
  it('carries what somebody outside wrote, exactly, in the fidelity format', async () => {
    // The real population: content from outside the company, reaching the
    // founder's own export. `exportProductData` is `SELECT *` over every table
    // carrying a `product_id`.
    await query(`INSERT INTO signal_events (id,product_id,source,event_type,severity,payload_json,summary)
      VALUES ('csv_sig',?,'external_observation','company_observation','low','{}',?)`, [P, ATTACK]);

    const data = await exportProductData(P, 'json');
    const events = data.signal_events as Array<Record<string, unknown>>;
    expect(events?.length).toBeGreaterThan(0);
    // Untouched: an export is meant to be the data, and JSON is the format that
    // keeps it.
    expect(events.some((e) => e.summary === ATTACK)).toBe(true);
  });

  it('neutralises that same value on the way into a spreadsheet', () => {
    const cell = csvCell(ATTACK);
    // Quoted because it contains commas and quotes, with the payload's own
    // quotes doubled per RFC 4180 — and led by an apostrophe, so a spreadsheet
    // reads it as text.
    expect(cell.startsWith('"\'=')).toBe(true);
    expect(cell).toContain('""http://example.invalid""');
    // The formula no longer begins the cell, which is the whole mechanism.
    expect(cell.replace(/^"/, '').startsWith('=')).toBe(false);
  });
});

describe('one escaper, and both exports use it', () => {
  it('has no second copy left behind', () => {
    // Two copies of one rule is a defect unless something compares them. The
    // comparison is that there is only one.
    for (const file of ['src/routes/dashboard/privacy.ts', 'src/routes/dashboard/audit-log.ts']) {
      const src = readFileSync(resolve(__dirname, '../..', file), 'utf8');
      expect(src, `${file} still hand-rolls CSV quoting`).not.toContain(".replace(/\"/g, '\"\"')");
      expect(src).toContain("from '../../lib/csv.js'");
    }
  });
});
