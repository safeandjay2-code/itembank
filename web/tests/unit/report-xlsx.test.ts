// ทดสอบเฟส 6: ไฟล์ Excel รายงานผล — โครงสร้าง OOXML และค่าในเซลล์ (กรณีคำนวณมือ)
// ถ้าตั้ง XLSX_OUT=<โฟลเดอร์> จะเขียนไฟล์ไว้ให้ตรวจด้วยโปรแกรมอื่น (openpyxl / LibreOffice)
import { describe, expect, it } from 'vitest';
import JSZip from 'jszip';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import levels from '../../../data/levels.json';
import curriculum from '../../../data/curriculum/math_2560_terminal_p4_p6.json';
import { buildIndicators } from '../../src/data/memoryRepo';
import { analyze } from '../../src/modules/analysis/analyze';
import { buildReportXlsx, compactSeats, itemStatsFromRounds, makeNames, reportFileName, reportSheets } from '../../src/modules/analysis/report';
import { buildXlsx, colName, sheetName } from '../../src/modules/analysis/xlsx';
import { knownCase, randomCase, RANDOM_SPECS, toExam, toResponses } from './analysisCases';

const diffs = levels.difficulty.map((d) => ({ id: d.id, key: d.key, nameTh: d.name_th, pLower: d.p_lower, pUpper: d.p_upper }));
const grades = curriculum.grades.map((g: any) => ({ id: g.id, nameTh: g.name_th, shortTh: g.short_th, sort: g.sort }));
const names = makeNames(buildIndicators(), diffs, grades);

/** อ่านค่าในเซลล์จาก XML ของแผ่นงาน → { A1: 'ข้อความ' | number } */
function cells(xml: string): Record<string, string | number> {
  const out: Record<string, string | number> = {};
  for (const m of xml.matchAll(/<c r="([A-Z]+\d+)"[^>]*?(?:\/>|>(.*?)<\/c>)/g)) {
    const body = m[2] ?? '';
    const t = /<t[^>]*>(.*?)<\/t>/.exec(body);
    const v = /<v>(.*?)<\/v>/.exec(body);
    if (t) out[m[1]] = t[1].replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&amp;/g, '&');
    else if (v) out[m[1]] = Number(v[1]);
  }
  return out;
}

describe('ไฟล์ Excel รายงานผล', () => {
  const c = knownCase();
  const exam = toExam(c);
  const a = analyze(exam, toResponses(c));

  it('มี 5 แผ่นงานตามลำดับ และเป็นไฟล์ OOXML ที่ครบส่วน', async () => {
    const bytes = await buildReportXlsx(exam, a, names, new Date('2026-10-10'));
    if (process.env.XLSX_OUT) writeFileSync(join(process.env.XLSX_OUT, 'report-known.xlsx'), bytes);
    const zip = await JSZip.loadAsync(bytes);
    for (const f of ['[Content_Types].xml', '_rels/.rels', 'xl/workbook.xml', 'xl/_rels/workbook.xml.rels', 'xl/styles.xml'])
      expect(zip.file(f), f).not.toBeNull();
    const wb = await zip.file('xl/workbook.xml')!.async('string');
    expect([...wb.matchAll(/<sheet name="([^"]+)"/g)].map((m) => m[1])).toEqual(['สรุป', 'คะแนนรายเลขที่', 'รายตัวชี้วัด', 'วิเคราะห์รายข้อ', 'คำตอบรายเลขที่']);
    expect(await zip.file('xl/styles.xml')!.async('string')).toContain('TH Sarabun New');
  });

  it('คะแนนรายเลขที่: ครบเลขที่ 1–12 (ที่ยังไม่ตรวจมีแถวว่าง) ผ่าน/ไม่ผ่านรายตัวชี้วัด', async () => {
    const zip = await JSZip.loadAsync(await buildReportXlsx(exam, a, names));
    const x = cells(await zip.file('xl/worksheets/sheet2.xml')!.async('string'));
    expect(x.A1).toBe('เลขที่');
    expect(x.C1).toBe('คะแนน (เต็ม 5)');
    expect(x.E1).toBe('ค 1.1 ป.4/2 (ถูก/2)');
    // แถว 2 = เลขที่ 1: 4 คะแนน · A 2/2 ผ่าน · B 2/3 ผ่าน · ผ่าน 2 ตัวชี้วัด
    expect([x.A2, x.B2, x.C2, x.D2, x.E2, x.F2, x.G2, x.H2, x.I2]).toEqual([1, 1, 4, 80, 2, 'ผ่าน', 2, 'ผ่าน', 2]);
    // เลขที่ 3: B 1/3 ไม่ผ่าน
    expect([x.A4, x.G4, x.H4]).toEqual([3, 1, 'ไม่ผ่าน']);
    // เลขที่ 5 มี remark ค้าง
    expect(x.J6).toContain('remark');
    expect([x.A12, x.C12, x.J12]).toEqual([11, undefined, 'ยังไม่ตรวจ/ขาดสอบ']);
    expect(x.A13).toBe(12);
  });

  it('วิเคราะห์รายข้อ: p r ตำแหน่งในแต่ละชุด ร้อยละการเลือก ข้อสังเกต', async () => {
    const sh = reportSheets(exam, a, names).find((s) => s.name === 'วิเคราะห์รายข้อ')!;
    const head = sh.rows[0].map((h: any) => h.v);
    const col = (name: string) => head.indexOf(name);
    const val = (r: number, name: string) => { const v = sh.rows[r][col(name)] as any; return v && typeof v === 'object' ? v.v : v; };
    expect(head.slice(0, 3)).toEqual(['ข้อ', 'ชุด 1', 'ชุด 2']);
    expect([1, 2, 3, 4, 5].map((r) => val(r, 'p'))).toEqual([0.7, 0.5, 0.4, 0.2, 0.3]);
    expect([1, 2, 3, 4, 5].map((r) => val(r, 'r'))).toEqual([1, 0.667, 1, 0.667, -0.667]);
    expect([1, 2, 3, 4, 5].map((r) => val(r, 'ชุด 2'))).toEqual([5, 4, 3, 2, 1]);    // ชุด 2 เรียงข้อกลับด้าน
    expect(val(4, 'เลือก 1 (%)')).toBe(40);
    expect(val(4, 'ไม่ฝน (%)')).toBe(10);
    expect(val(5, 'แปลผล r')).toContain('ติดลบ');
    expect(val(3, 'ข้อสังเกต / ตัวลวงที่เด็กหลงมาก')).toContain('บวกเศษกับเศษ ส่วนกับส่วน');
    expect(val(5, 'ข้อสังเกต / ตัวลวงที่เด็กหลงมาก')).toContain('ตรวจเฉลย/โจทย์ด่วน');
  });

  it('คำตอบรายเลขที่: ✓ = ถูก, ตัวเลือกที่ตอบผิด, - = ไม่ฝน', () => {
    const sh = reportSheets(exam, a, names).find((s) => s.name === 'คำตอบรายเลขที่')!;
    const row5 = sh.rows[5].map((v: any) => (v && typeof v === 'object' ? v.v : v));    // เลขที่ 5: 1 3 3 b 2
    expect(row5).toEqual([5, 1, '✓', '3', '✓', '-', '2']);
  });

  it('สรุป: ค่าเฉลี่ย S.D. เลขที่ขาด ตัวชี้วัดที่ควรสอนซ่อม', () => {
    const sh = reportSheets(exam, a, names).find((s) => s.name === 'สรุป')!;
    const flat = sh.rows.map((r) => r.map((v: any) => (v && typeof v === 'object' ? v.v : v)));
    const get = (label: string) => flat.find((r) => r[0] === label)?.[1];
    expect(get('คะแนนเฉลี่ย')).toBe(2.1);
    expect(get('ส่วนเบี่ยงเบนมาตรฐาน (S.D.)')).toBe(1.2);
    expect(get('ยังไม่ตรวจ / ขาดสอบ (เลขที่)')).toBe('11, 12');
    expect(flat.some((r) => r[0] === 'ค 1.1 ป.4/11' && String(r[1]).includes('ผ่าน 2/10'))).toBe(true);
  });

  it('ชุดใหญ่ (45 ข้อ 4 ชุด 60 คน) สร้างได้ ขนาดไฟล์เล็ก', async () => {
    const big = randomCase(12, RANDOM_SPECS[1]);
    const bytes = await buildReportXlsx(toExam(big), analyze(toExam(big), toResponses(big)), names);
    if (process.env.XLSX_OUT) writeFileSync(join(process.env.XLSX_OUT, 'report-big.xlsx'), bytes);
    expect(bytes.length).toBeLessThan(200_000);
  });
});

describe('ตัวช่วย', () => {
  it('ชื่อคอลัมน์ / ชื่อแผ่นงาน / ช่วงเลขที่ / ชื่อไฟล์', async () => {
    expect([0, 25, 26, 51, 52, 701, 702].map(colName)).toEqual(['A', 'Z', 'AA', 'AZ', 'BA', 'ZZ', 'AAA']);
    expect(sheetName('ก/ข:ค?[ง]*'.repeat(5)).length).toBeLessThanOrEqual(31);
    expect(compactSeats([7, 1, 2, 3, 5, 9, 10])).toBe('1–3, 5, 7, 9, 10');
    expect(reportFileName(toExam(knownCase()), names)).toBe('รายงานผล กรณีคำนวณมือ ป.4.xlsx');
    const z = await JSZip.loadAsync(await buildXlsx([{ name: 'a', rows: [['<&>"', 1.5, null]] }]));
    expect(await z.file('xl/worksheets/sheet1.xml')!.async('string')).toContain('&lt;&amp;&gt;&quot;');
  });

  it('สถิติของชุดที่ปิดแล้ว (จากคลัง) แสดงรายข้อได้', () => {
    const exam = toExam(knownCase());
    exam.status = 'closed';
    exam.roundStats = [{ itemId: exam.items[2].itemId, version: 1, n: 10, nCorrect: 4, r: 1, optionCounts: { 1: 4, 2: 1, 3: 4, 4: 1, blank: 0, multi: 0 } }];
    const its = itemStatsFromRounds(exam);
    expect(its[2]).toMatchObject({ n: 10, nCorrect: 4, p: 0.4, r: 1 });
    expect(its[2].distractors.find((d) => d.option === 1)).toMatchObject({ strong: true, rationale: 'บวกเศษกับเศษ ส่วนกับส่วน' });
    expect(its[0]).toMatchObject({ n: 0, p: null, r: null });
  });
});
