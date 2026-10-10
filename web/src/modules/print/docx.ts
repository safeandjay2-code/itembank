// ส่งออก Word (.docx) — A4 เสมอ, TH Sarabun New 16pt, ข้อสอบสองคอลัมน์, เศษส่วนเป็นสมการ Word (แก้ต่อใน Word ได้)
// ไฟล์ละชุด + เฉลยครูรวมทุกชุด (SPEC §7.1)
import {
  AlignmentType, BorderStyle, Document, Footer, ImageRun, Math as DocMath, MathFraction, MathRun, Packer, PageNumber, Paragraph,
  SectionType, Tab, Table, TableCell, TableRow, TabStopType, TextRun, WidthType, type ParagraphChild,
} from 'docx';
import { tryRenderFigure } from '../bank/figure/svg';
import { splitMath } from './math';
import { headerLine, INSTRUCTION, type PrintDoc, type PrintItem, type PrintSet } from './model';

export const FONT = 'TH Sarabun New';
export const A4 = { width: 11906, height: 16838 };      // twip (ห้าม Letter)
const MARGIN = { top: 720, bottom: 720, left: 792, right: 792, header: 400, footer: 400 };
const COL_SPACE = 454;
const COL_WIDTH = (A4.width - MARGIN.left - MARGIN.right - COL_SPACE) / 2;
const INDENT = 360;

/** แปลง SVG เป็น PNG (เบราว์เซอร์ใช้ canvas; ชุดทดสอบส่งตัวจำลองมาแทน) */
export type Rasterize = (svg: string, width: number, height: number) => Promise<Uint8Array>;

const tab = () => new TextRun({ font: FONT, size: 32, children: [new Tab()] });
const run = (text: string, o: { bold?: boolean; size?: number } = {}) =>
  new TextRun({ text, font: FONT, size: o.size ?? 32, bold: o.bold });

/** ข้อความ + เศษส่วน (สมการ Word แบบซ้อนบน-ล่าง) */
export function mathRuns(text: string, o: { bold?: boolean; size?: number } = {}): ParagraphChild[] {
  return splitMath(text).map((s) => (s.t === 'text' ? run(s.v, o) : new DocMath({
    children: [
      ...(s.whole ? [new MathRun(s.whole)] : []),
      new MathFraction({ numerator: [new MathRun(s.num)], denominator: [new MathRun(s.den)] }),
    ],
  })));
}

async function figureParagraph(item: PrintItem, note: string, rasterize: Rasterize): Promise<Paragraph | null> {
  if (!item.figure) return null;
  const r = tryRenderFigure(item.figure, { note });
  if (!r.ok) return new Paragraph({ children: [run(`[รูปผิดพลาด: ${r.error}]`)], indent: { left: INDENT } });
  // ไม่เกินความกว้างคอลัมน์ (พิกเซล 96 dpi)
  const maxPx = (COL_WIDTH - INDENT) / 15;
  const scale = Math.min(1, maxPx / r.result.width);
  const w = Math.round(r.result.width * scale), h = Math.round(r.result.height * scale);
  const png = await rasterize(r.result.svg, r.result.width, r.result.height);
  return new Paragraph({ keepNext: true, keepLines: true, indent: { left: INDENT }, spacing: { before: 40, after: 40 },
    children: [new ImageRun({ type: 'png', data: png, transformation: { width: w, height: h } })] });
}

async function questionParagraphs(item: PrintItem, note: string, rasterize: Rasterize): Promise<Paragraph[]> {
  const out: Paragraph[] = [];
  out.push(new Paragraph({ keepNext: true, keepLines: true, indent: { left: INDENT, hanging: INDENT }, spacing: { before: 60 },
    children: [run(`${item.no}.`, { bold: true }), tab(), ...mathRuns(item.stem)],
    tabStops: [{ type: TabStopType.LEFT, position: INDENT }] }));
  const fig = await figureParagraph(item, note, rasterize);
  if (fig) out.push(fig);
  const opt = (i: number) => [run(`${i + 1}) `), ...mathRuns(item.options[i])];
  if (item.layout === 'grid') {
    const half = INDENT + Math.round((COL_WIDTH - INDENT) / 2);
    for (const pair of [[0, 1], [2, 3]]) {
      out.push(new Paragraph({ keepNext: pair[0] === 0, keepLines: true, indent: { left: INDENT },
        tabStops: [{ type: TabStopType.LEFT, position: half }],
        children: [...opt(pair[0]), tab(), ...opt(pair[1])] }));
    }
  } else {
    item.options.forEach((_, i) => out.push(new Paragraph({ keepNext: i < 3, keepLines: true,
      indent: { left: INDENT + 340, hanging: 340 }, children: opt(i) })));
  }
  return out;
}

const NO_BORDER = { style: BorderStyle.NONE, size: 0, color: 'FFFFFF' };
const NO_BORDERS = { top: NO_BORDER, bottom: NO_BORDER, left: NO_BORDER, right: NO_BORDER, insideHorizontal: NO_BORDER, insideVertical: NO_BORDER };
const LINE = { style: BorderStyle.SINGLE, size: 12, color: '000000' };

function footer(label: string) {
  return new Footer({ children: [new Paragraph({ alignment: AlignmentType.RIGHT, children: [
    new TextRun({ font: FONT, size: 26, children: [`${label}   หน้า `, PageNumber.CURRENT, '/', PageNumber.TOTAL_PAGES] }),
  ] })] });
}

const page = { size: { width: A4.width, height: A4.height }, margin: MARGIN };

export async function buildExamDocx(doc: PrintDoc, set: PrintSet, rasterize: Rasterize): Promise<Document> {
  const badge = new TableCell({ width: { size: 1500, type: WidthType.DXA },
    borders: { top: LINE, bottom: LINE, left: LINE, right: LINE },
    children: [new Paragraph({ alignment: AlignmentType.CENTER, children: [run('ชุดที่', { size: 28 })] }),
      new Paragraph({ alignment: AlignmentType.CENTER, children: [run(String(set.setNo), { bold: true, size: 68 })] })] });
  const head = new Table({ width: { size: A4.width - MARGIN.left - MARGIN.right, type: WidthType.DXA }, borders: NO_BORDERS,
    columnWidths: [A4.width - MARGIN.left - MARGIN.right - 1500, 1500],
    rows: [new TableRow({ children: [
      new TableCell({ borders: { top: NO_BORDER, bottom: NO_BORDER, left: NO_BORDER, right: NO_BORDER },
        children: [new Paragraph({ alignment: AlignmentType.CENTER, children: [run(doc.title, { bold: true, size: 40 })] }),
          new Paragraph({ alignment: AlignmentType.CENTER, children: [run(headerLine(doc))] })] }),
      badge,
    ] })] });
  const body: Paragraph[] = [];
  for (const it of set.items) body.push(...await questionParagraphs(it, doc.figureNote, rasterize));
  body.push(new Paragraph({ alignment: AlignmentType.CENTER, spacing: { before: 200 }, children: [run('— หมดข้อสอบ —', { size: 28 })] }));
  const label = `${doc.gradeShort} · ชุดที่ ${set.setNo}`;
  return new Document({
    creator: 'ระบบคลังข้อสอบ', title: `${doc.title} ชุดที่ ${set.setNo}`,
    styles: { default: { document: { run: { font: FONT, size: 32 } } } },
    sections: [
      { properties: { page }, footers: { default: footer(label) },
        children: [head, new Paragraph({ border: { bottom: LINE }, spacing: { before: 80, after: 120 }, children: [run(INSTRUCTION, { size: 30 })] })] },
      { properties: { page, type: SectionType.CONTINUOUS, column: { count: 2, space: COL_SPACE, separate: true } },
        footers: { default: footer(label) }, children: body },
    ],
  });
}

export function buildKeyDocx(doc: PrintDoc): Document {
  const width = A4.width - MARGIN.left - MARGIN.right;
  const cell = (text: string, o: { bold?: boolean; w: number }) => new TableCell({ width: { size: o.w, type: WidthType.DXA },
    children: [new Paragraph({ children: [run(text, { bold: o.bold, size: 26 })] })] });
  const children: Array<Paragraph | Table> = [
    new Paragraph({ children: [run(`เฉลยสำหรับครู — ${doc.title}`, { bold: true, size: 40 })] }),
    new Paragraph({ children: [run(`${headerLine(doc)} · ${doc.sets.length} ชุด · ห้ามแจกนักเรียน`)] }),
  ];
  const perRow = 5, w = Math.floor(width / perRow);
  for (const s of doc.sets) {
    children.push(new Paragraph({ spacing: { before: 200 }, keepNext: true, children: [run(`ชุดที่ ${s.setNo}`, { bold: true, size: 34 })] }));
    const rows: TableRow[] = [];
    for (let i = 0; i < s.items.length; i += perRow) {
      const chunk = s.items.slice(i, i + perRow);
      rows.push(new TableRow({ cantSplit: true, children: Array.from({ length: perRow }, (_, k) => {
        const it = chunk[k];
        return new TableCell({ width: { size: w, type: WidthType.DXA }, children: it
          ? [new Paragraph({ children: [run(`${it.no}. ตอบ ${it.key}`, { bold: true, size: 30 })] }),
             new Paragraph({ children: [run(it.itemCode, { size: 22 })] })]
          : [new Paragraph({ children: [] })] });
      }) }));
    }
    children.push(new Table({ width: { size: width, type: WidthType.DXA }, columnWidths: Array(perRow).fill(w), rows }));
  }
  children.push(new Paragraph({ spacing: { before: 200 }, children: [run('เลขที่ → ชุด', { bold: true, size: 34 })] }));
  for (const s of doc.sets) {
    const seats = doc.seats.filter((x) => x.setNo === s.setNo).map((x) => x.seatNo);
    children.push(new Paragraph({ children: [run(`ชุดที่ ${s.setNo}: `, { bold: true }), run(`เลขที่ ${seats.length ? seats.join(', ') : '—'}`)] }));
  }
  children.push(new Paragraph({ spacing: { before: 200 }, children: [run('ข้อในชุด (รหัสประจำข้อ) และตำแหน่ง/เฉลยในแต่ละชุด', { bold: true, size: 34 })] }));
  const base = doc.sets[0].items.slice().sort((a, b) => a.itemCode.localeCompare(b.itemCode));
  const fixedW = [1750, 1750, 1150];
  const sw = Math.floor((width - fixedW.reduce((a, b) => a + b, 0)) / doc.sets.length);
  children.push(new Table({ width: { size: width, type: WidthType.DXA }, columnWidths: [...fixedW, ...Array(doc.sets.length).fill(sw)],
    rows: [
      new TableRow({ tableHeader: true, children: [cell('รหัสข้อ', { bold: true, w: fixedW[0] }), cell('ตัวชี้วัด', { bold: true, w: fixedW[1] }),
        cell('ระดับ', { bold: true, w: fixedW[2] }), ...doc.sets.map((s) => cell(`ชุด ${s.setNo}`, { bold: true, w: sw }))] }),
      ...base.map((it) => new TableRow({ children: [cell(it.itemCode, { w: fixedW[0] }), cell(it.indicatorCode, { w: fixedW[1] }),
        cell(it.difficultyName, { w: fixedW[2] }),
        ...doc.sets.map((s) => { const p = s.items.find((x) => x.itemCode === it.itemCode)!; return cell(`ข้อ ${p.no} ตอบ ${p.key}`, { w: sw }); })] })),
    ] }));
  return new Document({ creator: 'ระบบคลังข้อสอบ', title: `เฉลย ${doc.title}`,
    styles: { default: { document: { run: { font: FONT, size: 32 } } } },
    sections: [{ properties: { page }, footers: { default: footer('เฉลยครู') }, children }] });
}

export const toBlob = (d: Document) => Packer.toBlob(d);
export const toBuffer = (d: Document) => Packer.toBuffer(d);

/** ชื่อไฟล์ที่ปลอดภัยบน Windows */
export function safeName(s: string) { return s.replace(/[\\/:*?"<>|]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 80) || 'แบบทดสอบ'; }
