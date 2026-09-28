// =============================================================================
// FOUNDRY — a deterministic XLSX writer, with no dependency.
//
// The handoff of 28 September asks for "a deterministic file renderer and
// immutable artifact digest/version": the same inputs must give the same
// bytes, so a digest can bind a listing, a preview and every sold order to one
// file. An .xlsx is a zip of XML parts. This writes the parts itself and
// stores them uncompressed, with fixed timestamps and a fixed order, so
// nothing about the moment of building leaks into the bytes.
//
// Deliberately small: inline strings, numbers, formulas without cached values
// (the workbook asks the spreadsheet to calculate everything on open), four
// cell styles, sheet protection, and "a number at least zero" validation.
// Nothing here claims Excel or Google Sheets compatibility; that is a separate
// check, recorded where it has or has not been made.
// =============================================================================

import { crc32 } from 'node:zlib';

export type CellValue =
  | { kind: 'text'; text: string }
  | { kind: 'number'; value: number }
  | { kind: 'formula'; formula: string }
  | { kind: 'blank' };

/** How a cell looks and whether the buyer may type in it. */
export type CellStyle = 'plain' | 'heading' | 'input' | 'money_input' | 'money' | 'percent';

export interface Cell { ref: string; value: CellValue; style?: CellStyle }

export interface Sheet {
  name: string;
  cells: Cell[];
  /** Formula and label cells locked; only input-styled cells can be typed in. */
  protect: boolean;
  columnWidths?: number[];
  /** Ranges that accept only a number at or above zero. */
  nonNegative?: string[];
}

const STYLE_INDEX: Record<CellStyle, number> = { plain: 0, heading: 1, input: 2, money_input: 3, money: 4, percent: 5 };

const esc = (s: string): string => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;').replace(/'/g, '&apos;');

/** "B12" → [12, 2]. */
export function cellAt(ref: string): [number, number] {
  const m = /^([A-Z]+)(\d+)$/.exec(ref);
  if (!m) throw new Error(`xlsx: not a cell reference: ${ref}`);
  let col = 0;
  for (const ch of m[1]) col = col * 26 + (ch.charCodeAt(0) - 64);
  return [Number(m[2]), col];
}

function cellXml(c: Cell): string {
  const s = STYLE_INDEX[c.style ?? 'plain'];
  const attrs = `r="${c.ref}"${s ? ` s="${String(s)}"` : ''}`;
  switch (c.value.kind) {
    case 'text': return `<c ${attrs} t="inlineStr"><is><t xml:space="preserve">${esc(c.value.text)}</t></is></c>`;
    case 'number':
      if (!Number.isFinite(c.value.value)) throw new Error(`xlsx: ${c.ref} is not a finite number`);
      return `<c ${attrs}><v>${String(c.value.value)}</v></c>`;
    case 'formula': return `<c ${attrs}><f>${esc(c.value.formula)}</f></c>`;
    case 'blank': return `<c ${attrs}/>`;
  }
}

function sheetXml(sheet: Sheet): string {
  const byRow = new Map<number, Cell[]>();
  const seen = new Set<string>();
  for (const c of sheet.cells) {
    if (seen.has(c.ref)) throw new Error(`xlsx: ${c.ref} written twice on ${sheet.name}`);
    seen.add(c.ref);
    const [r] = cellAt(c.ref);
    byRow.set(r, [...(byRow.get(r) ?? []), c]);
  }
  const rows = [...byRow.keys()].sort((a, b) => a - b).map((r) => {
    const cells = byRow.get(r)!.sort((a, b) => cellAt(a.ref)[1] - cellAt(b.ref)[1]);
    return `<row r="${String(r)}">${cells.map(cellXml).join('')}</row>`;
  }).join('');
  const cols = sheet.columnWidths?.length
    ? `<cols>${sheet.columnWidths.map((w, i) => `<col min="${String(i + 1)}" max="${String(i + 1)}" width="${String(w)}" customWidth="1"/>`).join('')}</cols>`
    : '';
  const protect = sheet.protect ? '<sheetProtection sheet="1" objects="1" scenarios="1"/>' : '';
  const validations = sheet.nonNegative?.length
    ? `<dataValidations count="${String(sheet.nonNegative.length)}">${sheet.nonNegative.map((sq) =>
      `<dataValidation type="decimal" operator="greaterThanOrEqual" allowBlank="1" showErrorMessage="1" errorTitle="A number" error="Enter a number, 0 or more, or leave it blank if it is not known." sqref="${sq}"><formula1>0</formula1></dataValidation>`).join('')}</dataValidations>`
    : '';
  return '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n'
    + '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" '
    + 'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">'
    + `${cols}<sheetData>${rows}</sheetData>${protect}${validations}</worksheet>`;
}

const STYLES = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n'
  + '<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">'
  + '<numFmts count="2"><numFmt numFmtId="164" formatCode="&quot;$&quot;#,##0.00"/><numFmt numFmtId="165" formatCode="0.0%"/></numFmts>'
  + '<fonts count="2"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><name val="Calibri"/></font></fonts>'
  + '<fills count="3"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill>'
  + '<fill><patternFill patternType="solid"><fgColor rgb="FFFFF6D5"/><bgColor indexed="64"/></patternFill></fill></fills>'
  + '<borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders>'
  + '<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>'
  + '<cellXfs count="6">'
  + '<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>'
  + '<xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1"/>'
  + '<xf numFmtId="0" fontId="0" fillId="2" borderId="0" xfId="0" applyFill="1" applyProtection="1"><protection locked="0"/></xf>'
  + '<xf numFmtId="164" fontId="0" fillId="2" borderId="0" xfId="0" applyNumberFormat="1" applyFill="1" applyProtection="1"><protection locked="0"/></xf>'
  + '<xf numFmtId="164" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>'
  + '<xf numFmtId="165" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>'
  + '</cellXfs><cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>';

function parts(sheets: Sheet[]): Array<[string, string]> {
  const ws = sheets.map((_, i) => `xl/worksheets/sheet${String(i + 1)}.xml`);
  return [
    ['[Content_Types].xml', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n'
      + '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">'
      + '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>'
      + '<Default Extension="xml" ContentType="application/xml"/>'
      + '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>'
      + '<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>'
      + ws.map((p) => `<Override PartName="/${p}" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join('')
      + '</Types>'],
    ['_rels/.rels', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n'
      + '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
      + '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>'
      + '</Relationships>'],
    ['xl/workbook.xml', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n'
      + '<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" '
      + 'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>'
      + sheets.map((s, i) => `<sheet name="${esc(s.name)}" sheetId="${String(i + 1)}" r:id="rId${String(i + 1)}"/>`).join('')
      + '</sheets><calcPr calcId="0" fullCalcOnLoad="1"/></workbook>'],
    ['xl/_rels/workbook.xml.rels', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n'
      + '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
      + ws.map((p, i) => `<Relationship Id="rId${String(i + 1)}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="${p.slice(3)}"/>`).join('')
      + `<Relationship Id="rId${String(ws.length + 1)}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>`
      + '</Relationships>'],
    ['xl/styles.xml', STYLES],
    ...sheets.map((s, i): [string, string] => [ws[i], sheetXml(s)]),
  ];
}

/** 1980-01-01 00:00, the earliest a zip can say: nothing about when it was built. */
const DOS_TIME = 0;
const DOS_DATE = (0 << 9) | (1 << 5) | 1;

/** A stored (uncompressed) zip of the parts, in the order given. */
export function storedZip(files: Array<[string, Buffer]>): Buffer {
  const locals: Buffer[] = [];
  const centrals: Buffer[] = [];
  let offset = 0;
  for (const [name, data] of files) {
    const n = Buffer.from(name, 'utf8');
    const crc = crc32(data) >>> 0;
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0); local.writeUInt16LE(20, 4); local.writeUInt16LE(0x0800, 6);
    local.writeUInt16LE(0, 8); local.writeUInt16LE(DOS_TIME, 10); local.writeUInt16LE(DOS_DATE, 12);
    local.writeUInt32LE(crc, 14); local.writeUInt32LE(data.length, 18); local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(n.length, 26); local.writeUInt16LE(0, 28);
    locals.push(local, n, data);
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0); central.writeUInt16LE(20, 4); central.writeUInt16LE(20, 6);
    central.writeUInt16LE(0x0800, 8); central.writeUInt16LE(0, 10); central.writeUInt16LE(DOS_TIME, 12);
    central.writeUInt16LE(DOS_DATE, 14); central.writeUInt32LE(crc, 16); central.writeUInt32LE(data.length, 20);
    central.writeUInt32LE(data.length, 24); central.writeUInt16LE(n.length, 28); central.writeUInt16LE(0, 30);
    central.writeUInt16LE(0, 32); central.writeUInt16LE(0, 34); central.writeUInt16LE(0, 36);
    central.writeUInt32LE(0, 38); central.writeUInt32LE(offset, 42);
    centrals.push(central, n);
    offset += 30 + n.length + data.length;
  }
  const cd = Buffer.concat(centrals);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(0, 4); end.writeUInt16LE(0, 6);
  end.writeUInt16LE(files.length, 8); end.writeUInt16LE(files.length, 10);
  end.writeUInt32LE(cd.length, 12); end.writeUInt32LE(offset, 16); end.writeUInt16LE(0, 20);
  return Buffer.concat([...locals, cd, end]);
}

/** The workbook's bytes. The same sheets always give the same bytes. */
export function buildXlsx(sheets: Sheet[]): Buffer {
  if (sheets.length === 0) throw new Error('xlsx: a workbook needs at least one sheet');
  return storedZip(parts(sheets).map(([name, xml]) => [name, Buffer.from(xml, 'utf8')]));
}

/** Read the parts of a stored zip back: for tests and readbacks, never for buyers' files. */
export function readStoredZip(zip: Buffer): Map<string, Buffer> {
  const out = new Map<string, Buffer>();
  let p = 0;
  while (p + 4 <= zip.length && zip.readUInt32LE(p) === 0x04034b50) {
    const method = zip.readUInt16LE(p + 8);
    if (method !== 0) throw new Error('xlsx: only stored entries are read here');
    const size = zip.readUInt32LE(p + 18);
    const nameLen = zip.readUInt16LE(p + 26);
    const extraLen = zip.readUInt16LE(p + 28);
    const name = zip.subarray(p + 30, p + 30 + nameLen).toString('utf8');
    const start = p + 30 + nameLen + extraLen;
    out.set(name, zip.subarray(start, start + size));
    p = start + size;
  }
  return out;
}
