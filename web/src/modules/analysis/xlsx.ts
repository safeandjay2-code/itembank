// เขียนไฟล์ Excel (.xlsx) ในเบราว์เซอร์ — ตัวเขียนขนาดเล็กใช้ JSZip ที่มีอยู่แล้ว (ไม่เพิ่มไลบรารีหนัก ๆ)
// รองรับ: หลายแผ่นงาน ข้อความไทย ตัวเลข ความกว้างคอลัมน์ ตรึงแถวหัวตาราง และรูปแบบเซลล์ไม่กี่แบบ
import JSZip from 'jszip';

/** รูปแบบเซลล์ (ดัชนีใน styles.xml) */
export const S = {
  normal: 0,
  header: 1,   // หัวตาราง ตัวหนา พื้นเทา มีเส้นขอบ
  dec2: 2,     // ทศนิยม 2 ตำแหน่ง
  dec3: 3,     // ทศนิยม 3 ตำแหน่ง
  title: 4,    // หัวเรื่อง ตัวหนาใหญ่
  good: 5,     // ข้อความสีเขียว (ผ่าน)
  bad: 6,      // ข้อความสีแดง (ไม่ผ่าน/ต้องแก้)
  bold: 7,
  pct: 8,      // ทศนิยม 1 ตำแหน่ง (ร้อยละ)
} as const;
export type Style = (typeof S)[keyof typeof S];

export type CellValue = string | number | null | undefined;
export interface Cell { v: CellValue; s?: Style }
export type Row = Array<CellValue | Cell>;

export interface Sheet {
  name: string;
  rows: Row[];
  /** ความกว้างคอลัมน์ (หน่วยตัวอักษร) */
  widths?: number[];
  /** ตรึงแถวบนสุดกี่แถว */
  freezeRows?: number;
  /** ตรึงคอลัมน์ซ้ายกี่คอลัมน์ */
  freezeCols?: number;
}

const esc = (t: string) => t.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
  // อักขระควบคุมที่ XML ไม่รับ
  // eslint-disable-next-line no-control-regex
  .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '');

export function colName(i: number): string {
  let s = '';
  let n = i + 1;
  while (n > 0) { const m = (n - 1) % 26; s = String.fromCharCode(65 + m) + s; n = Math.floor((n - 1) / 26); }
  return s;
}

/** ชื่อแผ่นงาน: ไม่เกิน 31 ตัว ห้าม : \ / ? * [ ] */
export function sheetName(name: string): string {
  return name.replace(/[:\\/?*[\]]/g, ' ').slice(0, 31) || 'Sheet';
}

function cellXml(ref: string, c: Cell): string {
  const st = c.s ? ` s="${c.s}"` : '';
  if (c.v === null || c.v === undefined || c.v === '') return c.s ? `<c r="${ref}"${st}/>` : '';
  if (typeof c.v === 'number') return Number.isFinite(c.v) ? `<c r="${ref}"${st}><v>${c.v}</v></c>` : '';
  return `<c r="${ref}"${st} t="inlineStr"><is><t xml:space="preserve">${esc(c.v)}</t></is></c>`;
}

function sheetXml(sh: Sheet): string {
  const rows = sh.rows.map((row, r) => {
    const cells = row.map((x, c) => cellXml(`${colName(c)}${r + 1}`, typeof x === 'object' && x !== null ? x : { v: x })).join('');
    return `<row r="${r + 1}">${cells}</row>`;
  }).join('');
  const fr = sh.freezeRows ?? 0, fc = sh.freezeCols ?? 0;
  const pane = fr || fc
    ? `<pane${fc ? ` xSplit="${fc}"` : ''}${fr ? ` ySplit="${fr}"` : ''} topLeftCell="${colName(fc)}${fr + 1}" activePane="${fr && fc ? 'bottomRight' : fr ? 'bottomLeft' : 'topRight'}" state="frozen"/>`
    : '';
  const cols = sh.widths?.length ? `<cols>${sh.widths.map((w, i) => `<col min="${i + 1}" max="${i + 1}" width="${w}" customWidth="1"/>`).join('')}</cols>` : '';
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">`
    + `<sheetViews><sheetView workbookViewId="0">${pane}</sheetView></sheetViews><sheetFormatPr defaultRowHeight="20"/>${cols}<sheetData>${rows}</sheetData>`
    + `<pageMargins left="0.5" right="0.5" top="0.6" bottom="0.6" header="0.3" footer="0.3"/><pageSetup paperSize="9" orientation="landscape"/></worksheet>`;
}

const FONT = 'TH Sarabun New';
const STYLES = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
<numFmts count="3"><numFmt numFmtId="164" formatCode="0.00"/><numFmt numFmtId="165" formatCode="0.000"/><numFmt numFmtId="166" formatCode="0.0"/></numFmts>
<fonts count="5">
<font><sz val="14"/><name val="${FONT}"/><family val="2"/></font>
<font><b/><sz val="14"/><name val="${FONT}"/><family val="2"/></font>
<font><b/><sz val="18"/><name val="${FONT}"/><family val="2"/></font>
<font><sz val="14"/><color rgb="FF1B7F3B"/><name val="${FONT}"/><family val="2"/></font>
<font><sz val="14"/><color rgb="FFC0392B"/><name val="${FONT}"/><family val="2"/></font>
</fonts>
<fills count="3"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill>
<fill><patternFill patternType="solid"><fgColor rgb="FFE8ECF2"/><bgColor indexed="64"/></patternFill></fill></fills>
<borders count="2"><border><left/><right/><top/><bottom/><diagonal/></border>
<border><left style="thin"><color rgb="FFB0B7C3"/></left><right style="thin"><color rgb="FFB0B7C3"/></right><top style="thin"><color rgb="FFB0B7C3"/></top><bottom style="thin"><color rgb="FFB0B7C3"/></bottom><diagonal/></border></borders>
<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>
<cellXfs count="9">
<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>
<xf numFmtId="0" fontId="1" fillId="2" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="center" vertical="center" wrapText="1"/></xf>
<xf numFmtId="164" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>
<xf numFmtId="165" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>
<xf numFmtId="0" fontId="2" fillId="0" borderId="0" xfId="0" applyFont="1"/>
<xf numFmtId="0" fontId="3" fillId="0" borderId="0" xfId="0" applyFont="1"/>
<xf numFmtId="0" fontId="4" fillId="0" borderId="0" xfId="0" applyFont="1"/>
<xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1"/>
<xf numFmtId="166" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>
</cellXfs>
<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>
</styleSheet>`;

/** สร้างไฟล์ .xlsx (คืนเป็น Uint8Array — หน้าเว็บแปลงเป็น Blob ไปดาวน์โหลด) */
export async function buildXlsx(sheets: Sheet[]): Promise<Uint8Array> {
  const zip = new JSZip();
  const names: string[] = [];
  for (const sh of sheets) {
    let n = sheetName(sh.name), k = 2;
    while (names.includes(n)) n = sheetName(`${sh.name.slice(0, 27)} (${k++})`);
    names.push(n);
  }
  zip.file('[Content_Types].xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/>`
    + `<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>`
    + `<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>`
    + sheets.map((_, i) => `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join('')
    + `</Types>`);
  zip.file('_rels/.rels', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>`);
  zip.file('xl/workbook.xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><bookViews><workbookView/></bookViews><sheets>`
    + names.map((n, i) => `<sheet name="${esc(n)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join('') + `</sheets></workbook>`);
  zip.file('xl/_rels/workbook.xml.rels', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">`
    + sheets.map((_, i) => `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`).join('')
    + `<Relationship Id="rId${sheets.length + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`);
  zip.file('xl/styles.xml', STYLES);
  sheets.forEach((sh, i) => zip.file(`xl/worksheets/sheet${i + 1}.xml`, sheetXml(sh)));
  return zip.generateAsync({ type: 'uint8array', compression: 'DEFLATE' });
}

export const XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
