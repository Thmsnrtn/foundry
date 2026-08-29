// =============================================================================
// FOUNDRY — One CSV cell escaper
//
// There were two, in `routes/dashboard/privacy.ts` and
// `routes/dashboard/audit-log.ts`. Both quoted correctly for RFC 4180 and
// neither neutralised a formula, which is the defect that matters here: these
// exports carry content people outside the company wrote.
//
// A CSV cell beginning with `=`, `+`, `-`, `@`, a tab or a carriage return is
// treated as a FORMULA by Excel, LibreOffice and Google Sheets. The product
// export is `SELECT *` over every table carrying a `product_id`, which includes
// the bodies of messages customers wrote — so a customer can put a formula in a
// support message and have it evaluate when the founder opens their own data
// export. Nothing about that requires a mistake by the founder beyond opening a
// spreadsheet in a spreadsheet program.
//
// NEUTRALISED IN CSV, EXACT IN JSON. Prefixing with an apostrophe changes the
// bytes, and an export is meant to be the data — so the fidelity format keeps
// its fidelity. CSV is the spreadsheet format and gets spreadsheet-safe
// escaping; `/privacy/export` already defaults to JSON and treats CSV as the
// opt-in, which is the right way round.
//
// A NUMBER IS NOT A FORMULA. `-42` leads with a dangerous character and is
// plainly numeric, and turning a company's own figures into `'-42` would
// corrupt the export to prevent nothing.
// =============================================================================

/** Leading characters a spreadsheet reads as the start of a formula. */
const FORMULA_LEAD = /^[=+\-@\t\r]/;

/** A plain decimal number, which cannot be a formula however it begins. */
const PLAIN_NUMBER = /^-?\d+(?:\.\d+)?$/;

/**
 * One value, escaped for a CSV cell: quoted per RFC 4180, and neutralised if a
 * spreadsheet would otherwise evaluate it.
 */
export function csvCell(value: unknown): string {
  const raw = value === null || value === undefined ? ''
    : typeof value === 'string' ? value
      : typeof value === 'number' || typeof value === 'boolean' ? String(value)
        : JSON.stringify(value) ?? '';

  const safe = FORMULA_LEAD.test(raw) && !PLAIN_NUMBER.test(raw) ? `'${raw}` : raw;

  return safe.includes(',') || safe.includes('"') || safe.includes('\n') || safe.includes('\r')
    ? `"${safe.replace(/"/g, '""')}"`
    : safe;
}

/** A whole row, in the column order given. */
export function csvRow(headers: readonly string[], row: Record<string, unknown>): string {
  return headers.map((h) => csvCell(row[h])).join(',');
}
