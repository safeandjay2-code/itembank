// One Stop เฟส 5: ส่งออกชีท (หัวข้อ 6.1) + รายชื่อในเบราว์เซอร์ + ปิดเทอมในโหมดสาธิต (เลียนแบบ gb_classroom_close)
// ถ้าตั้ง XLSX_OUT=<โฟลเดอร์> จะเขียนไฟล์ไว้ให้ตรวจด้วย LibreOffice/openpyxl (สูตรคำนวณได้จริงไหม)
import { describe, expect, it } from 'vitest';
import JSZip from 'jszip';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { MemoryRepo, DEMO_EMAIL, DEMO_PASSWORD } from '../../../src/data/memoryRepo';
import type { ExamLink, GbSheet } from '../../../src/core/types';
import { buildPlan, configFromSettings, makeOrdering } from '../../../src/modules/assembly/assemble';
import { planToCreateInput } from '../../../src/modules/assembly/payload';
import { buildGradebookXlsx, exportFileName, noteSheet, parseNames, scoreSheet } from '../../../src/modules/gradebook/exportSheet';
import { splitIndicatorCode } from '../../../src/modules/gradebook/plan';

/** ห้อง ป.5/1 3 คน: ช่อง ind0 (เต็ม 10) → ind1 (เต็ม 4, เพิ่มทีหลัง) → ปลายภาค 20
 *  เก็บ 1: เลขที่ 1 ถูกหมด · เลขที่ 2 ถูก ind0 ข้อเดียว · เลขที่ 3 ขาด · ปลายภาค: เลขที่ 1 ถูก 3/4 · ปรับเลขที่ 2 ช่อง ind1 ให้ผ่าน (= 2)
 *  ค่าที่คำนวณมือ: ind0 [10, 5, 0] · ind1 [4, 2, 0] · ปลายภาค [15, 0, 0] · รวมเก็บ [14, 7, 0] · รวม [29, 7, 0] */
async function setup() {
  const repo = new MemoryRepo(3);
  await repo.signIn(DEMO_EMAIL, DEMO_PASSWORD);
  const [grades, diffs, settings] = await Promise.all([repo.getGrades(), repo.getDifficultyLevels(), repo.getSettings()]);
  const all = await repo.getIndicators('MATH');
  const inds = all.filter((i) => i.gradeId === 'P5');
  const pool = await repo.getAssemblyPool('MATH');
  const cfg = configFromSettings(settings);
  const ordering = makeOrdering(all, grades, diffs);
  const make = (studentCount: number, title: string) => {
    const req = { gradeId: 'P5', itemCount: 4, setCount: 1, studentCount,
      rows: [{ indicatorId: inds[0].id, difficulty: 1, count: 2 }, { indicatorId: inds[1].id, difficulty: 1, count: 2 }] };
    return planToCreateInput(buildPlan(req, pool, cfg, ordering, 7), req, { title, subjectId: 'MATH' });
  };
  const roomId = await repo.createClassroom({ gradeId: 'P5', academicYear: 2569, term: 2, name: 'ป.5/1', studentCount: 3, finalMax: 20,
    indicators: [{ indicatorId: inds[0].id, maxScore: 10 }] });
  const scan = async (examId: string, seat: number, pick: number[] | ((order: string[]) => number[])) => {
    const d = (await repo.getExam(examId))!;
    const setNo = d.seats.find((x) => x.seatNo === seat)!.setNo;
    const entries = d.sets.find((x) => x.setNo === setNo)!.entries;
    const right = typeof pick === 'function' ? pick(entries.map((e) => d.items.find((i) => i.itemId === e.itemId)!.indicatorId)) : pick;
    await repo.saveScan({ examId, seatNo: seat, setNo, answers: entries.map((e, k) => (right.includes(k + 1) ? e.key : (e.key % 4) + 1) as 1 | 2 | 3 | 4),
      ambiguous: [], source: 'manual', replace: true });
  };
  const link: ExamLink = { classroomId: roomId, purpose: 'collect', retakeOf: null };
  const e1 = await repo.createExam({ ...make(3, 'เก็บ 1'), link });
  await scan(e1, 1, [1, 2, 3, 4]);
  await scan(e1, 2, (order) => [order.indexOf(inds[0].id) + 1]);
  const ind1Col = await repo.addColumn(roomId, 'indicator', inds[1].id, null, 4);
  const f1 = await repo.createExam({ ...make(3, 'ปลายภาค'), link: { ...link, purpose: 'final' } });
  await scan(f1, 1, [1, 2, 3]);
  await repo.setOverride(ind1Col, 2, 2, 'pass');
  const unused = await repo.createExam({ ...make(3, 'ยังไม่สอบ'), link });
  return { repo, roomId, inds, e1, f1, unused, ind1Col };
}

/** อ่านเซลล์จาก XML ของแผ่นงาน → { A1: { v, f } } */
function cells(xml: string): Record<string, { v?: string | number; f?: string }> {
  const out: Record<string, { v?: string | number; f?: string }> = {};
  for (const m of xml.matchAll(/<c r="([A-Z]+\d+)"[^>]*?(?:\/>|>(.*?)<\/c>)/g)) {
    const body = m[2] ?? '';
    const t = /<t[^>]*>(.*?)<\/t>/.exec(body);
    const v = /<v>(.*?)<\/v>/.exec(body);
    const f = /<f>(.*?)<\/f>/.exec(body);
    out[m[1]] = { ...(t ? { v: t[1] } : v ? { v: Number(v[1]) } : {}), ...(f ? { f: f[1] } : {}) };
  }
  return out;
}
const flat = (sh: ReturnType<typeof scoreSheet>, r: number) => sh.rows[r].map((x) => (typeof x === 'object' && x !== null ? x.v : x));

describe('แยกรายชื่อที่วาง', () => {
  it('มีเลขที่ / ไม่มีเลขที่ / คัดลอกจาก Excel (Tab) / เลขที่เกินห้อง / ซ้ำ', () => {
    const p = parseNames('1 ด.ช.ก ใจดี\n2. ด.ญ.ข รักเรียน\n\n3\tด.ช.ค\tมีสุข\nด.ญ.ง ต่อจากบรรทัดก่อน\n9 ด.ช.เกิน\n2) ด.ญ.ข ใหม่', 5);
    expect([...p.names.entries()]).toEqual([[1, 'ด.ช.ก ใจดี'], [2, 'ด.ญ.ข ใหม่'], [3, 'ด.ช.ค มีสุข'], [4, 'ด.ญ.ง ต่อจากบรรทัดก่อน']]);
    expect(p.warnings).toEqual(['บรรทัด 6: เลขที่ 9 ไม่มีในห้องนี้ (มี 1–5) — ข้าม', 'เลขที่ 2 ซ้ำ — ใช้ชื่อบรรทัด 7']);
  });
  it('ไม่มีเลขที่เลย = เรียง 1, 2, 3 · บรรทัดที่มีแต่เลข = ข้าม', () => {
    const p = parseNames('สมชาย\nสมหญิง\n5\nสมศรี', 10);
    expect([...p.names.entries()]).toEqual([[1, 'สมชาย'], [2, 'สมหญิง'], [6, 'สมศรี']]);
    expect(p.warnings).toEqual(['บรรทัด 3: มีแต่เลขที่ ไม่มีชื่อ — ข้าม']);
    expect(parseNames('', 3).names.size).toBe(0);
  });
});

describe('ชีทส่งออก (หัวข้อ 6.1)', () => {
  it('หัว 3 แถว · ตัวชี้วัดตามแผนการสอน → รวม → สอบ → รวม · สูตร SUM · ชื่อจากที่วาง · ผสานเซลล์', async () => {
    const { repo, roomId, inds } = await setup();
    const s = await repo.getGradebook(roomId);
    const sh = scoreSheet(s, new Map([[1, 'ด.ช.ก ใจดี'], [3, 'ด.ญ.ค']]));
    const c0 = splitIndicatorCode(inds[0].code)!, c1 = splitIndicatorCode(inds[1].code)!;
    expect(sh.name).toBe('ป.5-1');
    expect(flat(sh, 0)).toEqual(['ที่', 'ชื่อ - สกุล', c0.standard, c1.standard, 'รวม', 'สอบ', 'รวม']);
    expect(flat(sh, 1)).toEqual(['', '', c0.indicator, c1.indicator, '', '', '']);
    expect(flat(sh, 2)).toEqual(['', '', 10, 4, 14, 20, 34]);
    expect(flat(sh, 3)).toEqual([1, 'ด.ช.ก ใจดี', 10, 4, 14, 15, 29]);
    expect(flat(sh, 4)).toEqual([2, '', 5, 2, 7, 0, 7]);      // ind1 ปรับให้ผ่าน = 2 · ขาดปลายภาค = 0
    expect(flat(sh, 5)).toEqual([3, 'ด.ญ.ค', 0, 0, 0, 0, 0]);
    expect(sh.merges).toEqual(['A1:A3', 'B1:B3', 'E1:E2', 'F1:F2', 'G1:G2']);
    expect(sh.freezeRows).toBe(3);

    const bytes = await buildGradebookXlsx(s, new Map([[1, 'ด.ช.ก ใจดี']]));
    if (process.env.XLSX_OUT) writeFileSync(join(process.env.XLSX_OUT, 'gradebook-export.xlsx'), bytes);
    const zip = await JSZip.loadAsync(bytes);
    const wb = await zip.file('xl/workbook.xml')!.async('string');
    expect([...wb.matchAll(/<sheet name="([^"]+)"/g)].map((m) => m[1])).toEqual(['ป.5-1', 'บันทึก']);
    expect(wb).toContain('fullCalcOnLoad="1"');
    const xml = await zip.file('xl/worksheets/sheet1.xml')!.async('string');
    const x = cells(xml);
    expect(x.E3).toEqual({ v: 14, f: 'SUM(C3:D3)' });
    expect(x.G3).toEqual({ v: 34, f: 'SUM(E3,F3)' });
    expect(x.E4).toEqual({ v: 14, f: 'SUM(C4:D4)' });
    expect(x.G6).toEqual({ v: 0, f: 'SUM(E6,F6)' });
    expect(x.B4.v).toBe('ด.ช.ก ใจดี');
    expect(xml).toContain('<mergeCells count="5"><mergeCell ref="A1:A3"/>');
  });

  it('แผ่นงานบันทึก: คะแนนที่ปรับ + ขาดสอบ', async () => {
    const { repo, roomId, inds } = await setup();
    const n = noteSheet(await repo.getGradebook(roomId));
    const rows = n.rows.map((r) => r.map((x) => (typeof x === 'object' && x !== null ? x.v : x)));
    const i = rows.findIndex((r) => r[0] === 'คะแนนที่ปรับ');
    expect(rows[i + 2]).toEqual([2, inds[1].code, 0, 2, 'ปรับให้ผ่าน']);
    const j = rows.findIndex((r) => r[0] === 'ขาดสอบ');
    expect(rows.slice(j + 2, j + 6)).toEqual([
      [2, 'สอบปลายภาค', 'ปลายภาค'],
      [3, inds[0].code, 'เก็บ 1'], [3, inds[1].code, 'เก็บ 1'], [3, 'สอบปลายภาค', 'ปลายภาค'],
    ]);
  });

  it('ช่องอื่นที่ซ่อน ไม่ส่งออก · เปิดแสดงแล้วส่งออก (หัวผสาน 2 แถว) · ห้องไม่มีตัวชี้วัด รวม = 0', async () => {
    const { repo, roomId } = await setup();
    await repo.addColumn(roomId, 'other', null, 'ส่งงาน', 5);
    let s = await repo.getGradebook(roomId);
    expect(flat(scoreSheet(s), 0)).toHaveLength(7);
    await repo.updateClassroom(roomId, { settings: { show_other_columns: true } });
    s = await repo.getGradebook(roomId);
    const sh = scoreSheet(s);
    expect(flat(sh, 0)[4]).toBe('ส่งงาน');
    expect(sh.merges).toContain('E1:E2');
    expect(flat(sh, 2)).toEqual(['', '', 10, 4, 5, 19, 20, 39]);

    const empty: GbSheet = { ...s, columns: s.columns.filter((c) => c.kind === 'final'), rows: s.rows.map((r) => ({ ...r, cells: [r.cells[s.columns.findIndex((c) => c.kind === 'final')]] })) };
    const e = scoreSheet(empty);
    expect(flat(e, 2)).toEqual(['', '', 0, 20, 20]);
    expect((e.rows[3][2] as { f: string }).f).toBe('0');
    expect(exportFileName(s)).toBe('คะแนน ป.5-1 ภาค 2-2569.xlsx');
  });
});

describe('ปิดเทอมในโหมดสาธิต (เลียนแบบ gb_classroom_close)', () => {
  it('ปิดชุดที่ยังเปิด → ลบคะแนนรายเลขที่/ที่ปรับ → เหลือค่ารวมห้อง · ชุดยังไม่สอบกลับเป็นชุดฝึก · ลบห้องได้', async () => {
    const { repo, roomId, inds, e1, f1, unused, ind1Col } = await setup();
    const sum = await repo.closeClassroom(roomId);
    expect(sum).toMatchObject({ seatCount: 3, totalMean: 12, examsClosed: 2, attemptsDeleted: 6, overridesDeleted: 1 });   // (29+7+0)/3
    expect(sum.columns.map((c) => [c.indicatorId ?? c.kind, c.mean, c.min, c.max])).toEqual([
      [inds[0].id, 5, 0, 10], [inds[1].id, 2, 0, 4], ['final', 5, 0, 15],
    ]);
    const room = (await repo.getClassroom(roomId))!;
    expect(room.status).toBe('closed');
    expect(room.closedSummary).toEqual(sum);
    expect((await repo.getExam(e1))!.status).toBe('closed');
    expect((await repo.getExam(f1))!.status).toBe('closed');
    expect((await repo.getExam(unused))!).toMatchObject({ classroomId: null, purpose: 'practice' });

    const s = await repo.getGradebook(roomId);
    expect(s.classroom.status).toBe('closed');
    expect(s.attempts).toEqual([]);
    expect(s.rows.every((r) => r.cells.every((c) => c.value === null && c.adjusted === null))).toBe(true);

    await expect(repo.setOverride(ind1Col, 1, 1, 'manual')).rejects.toThrow('ปิดเทอมแล้ว');
    await expect(repo.closeClassroom(roomId)).rejects.toThrow('ปิดเทอมแล้ว');
    await expect(repo.updateClassroom(roomId, { name: 'x' })).rejects.toThrow('ปิดเทอมแล้ว');
    // เปิดห้องชื่อเดิมในเทอมเดียวกันใหม่ได้ (ห้องที่ปิดไม่นับซ้ำ) แล้วลบห้องเก่าได้
    await repo.createClassroom({ gradeId: 'P5', academicYear: 2569, term: 2, name: 'ป.5/1', studentCount: 3, finalMax: 20, indicators: [] });
    await repo.deleteClassroom(roomId);
    expect((await repo.listClassrooms()).map((c) => c.status)).toEqual(['open']);
  });
});
