// ส่งออกชีทคะแนนปลายเทอม (One Stop เฟส 5 · SPEC-OneStop.md หัวข้อ 6.1) — ฟังก์ชันบริสุทธิ์ ทำงานในเบราว์เซอร์ทั้งหมด
//   * แผ่นงาน "คะแนน": หัว 3 แถว (สาระ/มาตรฐาน · ตัวชี้วัด · คะแนนเต็ม) → ตัวชี้วัดตามแผนการสอน → รวม → สอบ → รวม (สูตร SUM)
//   * แผ่นงาน "บันทึก": คะแนนที่ปรับ + ขาดสอบ (เก็บไว้เป็นหลักฐาน เพราะปิดเทอมแล้วข้อมูลรายเลขที่ถูกลบ)
//   * รายชื่อนักเรียน: ครูวางในหน้าเว็บ → รวมลงไฟล์บนเครื่องครูเอง ไม่ส่งขึ้นเซิร์ฟเวอร์
import type { GbSheet, GbSheetColumn } from '../../core/types';
import { ABSENT_TH, AGGREGATION_TH, RETAKE_TH, ROUNDING_TH } from './plan';
import { buildXlsx, colName, S, type Cell, type Row, type Sheet } from '../analysis/xlsx';

// ---------- รายชื่อ ----------
export interface ParsedNames {
  /** เลขที่ → ชื่อ */
  names: Map<number, string>;
  warnings: string[];
}

/** แยกรายชื่อที่ครูวาง: บรรทัดละ 1 คน · ขึ้นต้นด้วยเลขที่ได้ ("5 ด.ญ.มะลิ ใจดี", "5. …", "5<Tab>…") ·
 *  ไม่มีเลขที่ = ต่อจากบรรทัดก่อนหน้า (บรรทัดแรก = 1) · คัดลอกหลายคอลัมน์จาก Excel ได้ (Tab รวมเป็นช่องว่าง) */
export function parseNames(text: string, seatCount: number): ParsedNames {
  const names = new Map<number, string>();
  const warnings: string[] = [];
  let next = 1;
  const lines = text.split(/\r?\n/);
  lines.forEach((raw, i) => {
    const line = raw.replace(/\t+/g, ' ').replace(/\s+/g, ' ').trim();
    if (!line) return;
    let seat = next;
    let name = line;
    const m = /^(\d{1,3})(?:\s*[.)\-:]\s*|\s+)(.+)$/.exec(line);
    if (m) { seat = Number(m[1]); name = m[2].trim(); }
    else if (/^\d{1,3}$/.test(line)) { warnings.push(`บรรทัด ${i + 1}: มีแต่เลขที่ ไม่มีชื่อ — ข้าม`); next = Number(line) + 1; return; }
    next = seat + 1;
    if (seat < 1 || seat > seatCount) { warnings.push(`บรรทัด ${i + 1}: เลขที่ ${seat} ไม่มีในห้องนี้ (มี 1–${seatCount}) — ข้าม`); return; }
    if (names.has(seat)) warnings.push(`เลขที่ ${seat} ซ้ำ — ใช้ชื่อบรรทัด ${i + 1}`);
    names.set(seat, name.slice(0, 120));
  });
  return { names, warnings };
}

// ---------- ช่องที่ส่งออก ----------
/** ช่องตามลำดับในชีท: ตัวชี้วัด/ช่องอื่น (ช่องอื่นเฉพาะเมื่อเปิดแสดง) ตามแผนการสอน แล้วปลายภาค */
export function exportColumns(sheet: GbSheet): { plan: Array<{ col: GbSheetColumn; index: number }>; final: { col: GbSheetColumn; index: number } | null } {
  const all = sheet.columns.map((col, index) => ({ col, index }))
    .filter(({ col }) => col.kind !== 'other' || sheet.classroom.settings.show_other_columns);
  return { plan: all.filter(({ col }) => col.kind !== 'final'), final: all.find(({ col }) => col.kind === 'final') ?? null };
}

const sumOf = (xs: Array<number | null>) => {
  const v = xs.filter((x): x is number => x !== null);
  return v.length ? Math.round(v.reduce((a, b) => a + b, 0) * 100) / 100 : null;
};

export interface ExportLayout {
  /** คอลัมน์ (ดัชนีเริ่ม 0) ของแต่ละส่วน */
  seatCol: number; nameCol: number; firstPlanCol: number; sumCol: number; finalCol: number; totalCol: number;
}

export function layoutOf(planCount: number): ExportLayout {
  const firstPlanCol = 2;
  const sumCol = firstPlanCol + planCount;
  return { seatCol: 0, nameCol: 1, firstPlanCol, sumCol, finalCol: sumCol + 1, totalCol: sumCol + 2 };
}

/** แผ่นงานคะแนนตามหัวข้อ 6.1 (แถว 1–3 = หัว · แถว 4 เป็นต้นไป = เลขที่ 1..n) */
export function scoreSheet(sheet: GbSheet, names: Map<number, string> = new Map()): Sheet {
  const { plan, final } = exportColumns(sheet);
  const L = layoutOf(plan.length);
  const P = (k: number) => colName(L.firstPlanCol + k);
  const SUMC = colName(L.sumCol), FIN = colName(L.finalCol);
  const sumFormula = (r: number) => (plan.length ? `SUM(${P(0)}${r}:${P(plan.length - 1)}${r})` : '0');
  const totalFormula = (r: number) => `SUM(${SUMC}${r},${FIN}${r})`;
  const h = (v: string | null): Cell => ({ v: v ?? '', s: S.header });

  const r1: Row = [h('ที่'), h('ชื่อ - สกุล')];
  const r2: Row = [h(null), h(null)];
  const r3: Row = [h(null), h(null)];
  const merges = ['A1:A3', 'B1:B3'];
  plan.forEach(({ col }, k) => {
    if (col.kind === 'other') { r1.push(h(col.label ?? 'ช่องอื่น')); r2.push(h(null)); merges.push(`${P(k)}1:${P(k)}2`); }
    else { r1.push(h(col.standardCode ?? col.code)); r2.push(h(col.indicatorCode)); }
    r3.push({ v: col.maxScore, s: S.header });
  });
  const collectMax = sumOf(plan.map(({ col }) => col.maxScore));
  const finalMax = final?.col.maxScore ?? null;
  r1.push(h('รวม'), h('สอบ'), h('รวม'));
  r2.push(h(null), h(null), h(null));
  r3.push({ v: collectMax ?? 0, f: sumFormula(3), s: S.header }, { v: finalMax, s: S.header },
    { v: (collectMax ?? 0) + (finalMax ?? 0), f: totalFormula(3), s: S.header });
  merges.push(`${SUMC}1:${SUMC}2`, `${FIN}1:${FIN}2`, `${colName(L.totalCol)}1:${colName(L.totalCol)}2`);

  const rows: Row[] = [r1, r2, r3];
  sheet.rows.forEach((row, i) => {
    const r = i + 4;
    const vals = plan.map(({ index }) => row.cells[index].value);
    const collect = sumOf(vals);
    const fin = final ? row.cells[final.index].value : null;
    rows.push([
      { v: row.seatNo, s: S.boxNum },
      { v: names.get(row.seatNo) ?? '', s: S.boxText },
      ...vals.map((v): Cell => ({ v, s: S.boxNum })),
      { v: collect ?? 0, f: sumFormula(r), s: S.boxSum },
      { v: fin, s: S.boxNum },
      { v: (collect ?? 0) + (fin ?? 0), f: totalFormula(r), s: S.boxSum },
    ]);
  });
  return {
    name: sheet.classroom.name.replace(/\//g, '-'),   // ชื่อแผ่นงานใช้ / ไม่ได้
    rows,
    merges,
    widths: [5, 28, ...plan.map(() => 8), 8, 8, 8],
    freezeRows: 3,
    freezeCols: 2,
  };
}

/** แผ่นงานบันทึก: คะแนนที่ปรับ (คะแนนจริงเท่าไร ปรับเป็นเท่าไร) + ขาดสอบ */
export function noteSheet(sheet: GbSheet, examTitle: (id: string) => string = (id) => sheet.exams.find((e) => e.id === id)?.title ?? 'ชุดที่ลบแล้ว'): Sheet {
  const { plan, final } = exportColumns(sheet);
  const cols = final ? [...plan, final] : plan;
  const name = (col: GbSheetColumn) => (col.kind === 'final' ? 'สอบปลายภาค' : col.kind === 'other' ? col.label ?? 'ช่องอื่น' : col.code ?? '');
  const c = sheet.classroom;
  const rows: Row[] = [
    [{ v: `บันทึกสมุดคะแนน ${c.name} ภาคเรียนที่ ${c.term}/${c.academicYear}`, s: S.title }],
    [],
    [{ v: 'คะแนนที่ปรับ', s: S.bold }],
    ['เลขที่', 'ช่อง', 'คะแนนจริง', 'ปรับเป็น', 'เหตุผล'].map((v): Cell => ({ v, s: S.header })),
  ];
  let nAdj = 0;
  for (const r of sheet.rows) for (const { col, index } of cols) {
    const cell = r.cells[index];
    if (cell.adjusted === null) continue;
    nAdj++;
    rows.push([r.seatNo, name(col), cell.real, cell.adjusted, cell.reason === 'pass' ? 'ปรับให้ผ่าน' : 'ครูแก้เอง']);
  }
  if (!nAdj) rows.push(['ไม่มี']);
  rows.push([], [{ v: 'ขาดสอบ', s: S.bold }], ['เลขที่', 'ช่อง', 'ชุดที่ขาด'].map((v): Cell => ({ v, s: S.header })));
  let nAbs = 0;
  for (const r of sheet.rows) for (const { col, index } of cols) {
    const cell = r.cells[index];
    if (!cell.missing.length) continue;
    nAbs++;
    rows.push([r.seatNo, name(col), cell.missing.map(examTitle).join(', ')]);
  }
  if (!nAbs) rows.push(['ไม่มี']);
  rows.push([], [`วิธีคิด: รวมคะแนน ${AGGREGATION_TH[c.settings.aggregation]} · สอบซ่อม ${RETAKE_TH[c.settings.retake_policy]} · ขาดสอบ ${ABSENT_TH[c.settings.absent_policy]} · ปัด ${ROUNDING_TH[c.settings.rounding]}`]);
  return { name: 'บันทึก', rows, widths: [10, 16, 12, 12, 40] };
}

export async function buildGradebookXlsx(sheet: GbSheet, names: Map<number, string> = new Map()): Promise<Uint8Array> {
  return buildXlsx([scoreSheet(sheet, names), noteSheet(sheet)]);
}

/** ชื่อไฟล์ เช่น "คะแนน ป.5-1 ภาค 1-2569.xlsx" */
export function exportFileName(sheet: GbSheet): string {
  const c = sheet.classroom;
  return `คะแนน ${c.name} ภาค ${c.term}-${c.academicYear}.xlsx`.replace(/[\\/:*?"<>|]/g, '-');
}
