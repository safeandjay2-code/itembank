// One Stop เฟส 2: ตรรกะหน้าตั้งค่าห้อง + ห้องเรียนในโหมดสาธิต (เลียนแบบ gb_* ใน migration 0011)
import { describe, it, expect } from 'vitest';
import {
  currentTerm, effectiveSettings, gradebookDefaults, moveItem, parseMaxScore, scoreTotals, splitIndicatorCode, splitTotal,
  GRADEBOOK_DEFAULT_SETTINGS,
} from '../../../src/modules/gradebook/plan';
import { MemoryRepo, DEMO_EMAIL, DEMO_PASSWORD } from '../../../src/data/memoryRepo';
import { sortColumns, toClassroomDetail, toClassroomSummary, toGbColumn } from '../../../src/data/supabaseRepo';
import { readFileSync } from 'node:fs';

describe('แบ่งคะแนนรวมให้ตัวชี้วัด', () => {
  it('70 แบ่ง 8 ตัว = 9×6 + 8×2 รวม 70 พอดี เศษให้ตัวแรก ๆ', () => {
    expect(splitTotal(70, 8)).toEqual([9, 9, 9, 9, 9, 9, 8, 8]);
  });
  it('หารลงตัว / ตัวเดียว / ไม่มีตัวชี้วัด / คะแนนน้อยกว่าจำนวนตัว', () => {
    expect(splitTotal(70, 7)).toEqual([10, 10, 10, 10, 10, 10, 10]);
    expect(splitTotal(70, 1)).toEqual([70]);
    expect(splitTotal(70, 0)).toEqual([]);
    expect(splitTotal(3, 5)).toEqual([1, 1, 1, 0, 0]);
  });
  it('ผลรวมเท่าคะแนนรวมเสมอ (1–20 ตัว, 0–100 คะแนน)', () => {
    for (let n = 1; n <= 20; n++) for (let t = 0; t <= 100; t++) {
      const s = splitTotal(t, n);
      expect(s.reduce((a, b) => a + b, 0)).toBe(t);
      expect(Math.max(...s) - Math.min(...s)).toBeLessThanOrEqual(1);
    }
  });
});

describe('ยอดรวมคะแนนเต็ม (ไม่บังคับ 100)', () => {
  it('ตัวชี้วัด + ปลายภาค · ช่องที่ยังไม่ตั้งนับแยก · ช่องอื่นนับเมื่อแสดง', () => {
    const cols = [
      { kind: 'final' as const, maxScore: 30 }, { kind: 'indicator' as const, maxScore: 10 },
      { kind: 'indicator' as const, maxScore: 12.5 }, { kind: 'indicator' as const, maxScore: null }, { kind: 'other' as const, maxScore: 5 },
    ];
    expect(scoreTotals(cols)).toEqual({ collect: 27.5, final: 30, total: 57.5, unset: 1 });
    expect(scoreTotals(cols, false)).toEqual({ collect: 22.5, final: 30, total: 52.5, unset: 1 });
    expect(scoreTotals([{ kind: 'final', maxScore: 20 }])).toEqual({ collect: 0, final: 20, total: 20, unset: 0 });
  });
});

describe('ตัวช่วยอื่น', () => {
  it('ย้ายลำดับ (ลากวาง/ปุ่มขึ้นลง)', () => {
    expect(moveItem([1, 2, 3, 4], 0, 2)).toEqual([2, 3, 1, 4]);
    expect(moveItem([1, 2, 3, 4], 3, 0)).toEqual([4, 1, 2, 3]);
    expect(moveItem([1, 2, 3], 1, 1)).toEqual([1, 2, 3]);
    expect(moveItem([1, 2, 3], 0, 5)).toEqual([1, 2, 3]);
  });
  it('ปีการศึกษา/ภาคเรียนปัจจุบัน', () => {
    expect(currentTerm(new Date(2026, 9, 15))).toEqual({ academicYear: 2569, term: 1 });   // 15 ต.ค. 2569
    expect(currentTerm(new Date(2026, 4, 16))).toEqual({ academicYear: 2569, term: 1 });
    expect(currentTerm(new Date(2026, 10, 1))).toEqual({ academicYear: 2569, term: 2 });
    expect(currentTerm(new Date(2027, 1, 10))).toEqual({ academicYear: 2569, term: 2 });  // ก.พ. 2570 ยังเป็นปีการศึกษา 2569
    expect(currentTerm(new Date(2027, 3, 20))).toEqual({ academicYear: 2569, term: 2 });
  });
  it('ตรวจคะแนนเต็มที่พิมพ์', () => {
    expect(parseMaxScore('')).toEqual({ ok: true, value: null });
    expect(parseMaxScore(' 10 ')).toEqual({ ok: true, value: 10 });
    expect(parseMaxScore('7.5')).toEqual({ ok: true, value: 7.5 });
    expect(parseMaxScore('0')).toEqual({ ok: true, value: 0 });
    for (const bad of ['-1', 'abc', '1.234', '10000', '1e3']) expect(parseMaxScore(bad).ok).toBe(false);
  });
  it('แยกรหัสตัวชี้วัดเป็นแถว 1 (สาระ/มาตรฐาน) และแถว 2 (ตัวชี้วัด) ของชีท', () => {
    expect(splitIndicatorCode('ค 1.1 ป.5/8')).toEqual({ standard: 'ค 1.1', indicator: 'ป.5/8' });
    expect(splitIndicatorCode('ค 2.2 ป.6/3')).toEqual({ standard: 'ค 2.2', indicator: 'ป.6/3' });
  });
  it('ค่าเริ่มต้น 70-30 ตรงกับ migration 0011 · ห้องทับค่าเริ่มต้นได้', () => {
    const sql = readFileSync(new URL('../../../../supabase/migrations/0011_gradebook.sql', import.meta.url), 'utf8');
    for (const [k, v] of Object.entries(GRADEBOOK_DEFAULT_SETTINGS))
      expect(sql, k).toContain(`('${k}', '${JSON.stringify(v)}'::jsonb`);
    const d = gradebookDefaults({});
    expect([d.indicatorTotal, d.finalMax, d.maxStudents]).toEqual([70, 30, 60]);
    expect(gradebookDefaults({ 'gradebook.default_final': 20 }).finalMax).toBe(20);
    expect(effectiveSettings({ rounding: '1dp' }, d)).toEqual({ rounding: '1dp', aggregation: 'sum', retake_policy: 'max', absent_policy: 'zero', show_other_columns: false });
  });
});

describe('แปลงข้อมูลจากฐานข้อมูล (Supabase)', () => {
  it('ห้อง + ช่อง: ตัวเลขเป็น number · ปลายภาคอยู่ท้าย · เรียงตาม sort แล้ว id', () => {
    const cols = [
      { id: '5', kind: 'final', indicator_id: null, label: null, max_score: '30.00', sort: 0 },
      { id: '7', kind: 'indicator', indicator_id: 'B', label: null, max_score: null, sort: 1 },
      { id: '6', kind: 'indicator', indicator_id: 'A', label: null, max_score: '12.50', sort: 1 },
      { id: '8', kind: 'other', indicator_id: null, label: 'ส่งงาน', max_score: '5', sort: 0 },
    ].map(toGbColumn);
    expect(sortColumns(cols).map((c) => c.id)).toEqual([8, 6, 7, 5]);
    const d = toClassroomDetail({ id: 'r', name: 'ป.5/1', grade_id: 'P5', subject_id: 'MATH', academic_year: 2569, term: 1, student_count: 30,
      status: 'open', created_at: 't', closed_at: null, settings: { rounding: '1dp' } }, cols, 2);
    expect(d).toMatchObject({ columnCount: 3, examCount: 2, settings: { rounding: '1dp' } });
    expect(d.columns.find((c) => c.id === 6)!.maxScore).toBe(12.5);
    expect(d.columns.find((c) => c.id === 7)!.maxScore).toBeNull();
    expect(toClassroomSummary({ id: 'x', name: 'n', grade_id: 'P4', academic_year: '2569', term: '2', student_count: '25', status: 'closed',
      created_at: 't', closed_at: 'c', column_count: '4', exam_count: '0' })).toMatchObject({ academicYear: 2569, term: 2, studentCount: 25, columnCount: 4 });
  });
});

describe('ห้องเรียนในโหมดสาธิต (ต้องทำงานเหมือนฐานข้อมูลจริง)', () => {
  async function repo() { const r = new MemoryRepo(0); await r.signIn(DEMO_EMAIL, DEMO_PASSWORD); return r; }
  const base = { gradeId: 'P5', academicYear: 2569, term: 1, name: 'ป.5/1', studentCount: 30, finalMax: null,
    indicators: [{ indicatorId: 'MATH-2560-P5-03', maxScore: 10 }, { indicatorId: 'MATH-2560-P5-01', maxScore: null }] };

  it('สร้างห้อง: ปลายภาคค่าเริ่มต้น 30 + ตัวชี้วัดตามลำดับที่ส่ง', async () => {
    const r = await repo();
    const id = await r.createClassroom(base);
    const c = (await r.getClassroom(id))!;
    expect(c.columns.map((x) => [x.kind, x.indicatorId, x.maxScore])).toEqual([
      ['indicator', 'MATH-2560-P5-03', 10], ['indicator', 'MATH-2560-P5-01', null], ['final', null, 30]]);
    expect((await r.listClassrooms())[0]).toMatchObject({ name: 'ป.5/1', columnCount: 2, status: 'open' });
  });
  it('กันข้อมูลผิด: ชื่อห้องซ้ำในเทอมเดียวกัน · นักเรียนเกิน 60 · ตัวชี้วัดซ้ำ · ตั้งค่าผิด · ลบปลายภาค', async () => {
    const r = await repo();
    const id = await r.createClassroom(base);
    await expect(r.createClassroom({ ...base, name: ' ป.5/1 ' })).rejects.toThrow('มีห้อง ป.5/1');
    await r.createClassroom({ ...base, term: 2 });    // ต่างเทอม สร้างได้
    await expect(r.createClassroom({ ...base, name: 'ป.5/2', studentCount: 61 })).rejects.toThrow('ไม่เกิน 60');
    await expect(r.createClassroom({ ...base, name: 'ป.5/2', indicators: [base.indicators[0], base.indicators[0]] })).rejects.toThrow('มีในห้องแล้ว');
    expect((await r.listClassrooms()).length).toBe(2);   // สร้างไม่สำเร็จ = ไม่มีห้องค้าง
    await expect(r.addColumn(id, 'indicator', 'MATH-2560-P5-03', null, 5)).rejects.toThrow('มีในห้องแล้ว');
    await expect(r.updateClassroom(id, { settings: { rounding: 'x' as any } })).rejects.toThrow('int หรือ 1dp');
    const fin = (await r.getClassroom(id))!.columns.find((c) => c.kind === 'final')!;
    await expect(r.deleteColumn(fin.id)).rejects.toThrow('ลบช่องปลายภาคไม่ได้');
  });
  it('เพิ่ม/แก้/เรียง/ลบช่อง + ตั้งค่ารายห้อง (null = กลับค่าเริ่มต้น)', async () => {
    const r = await repo();
    const id = await r.createClassroom(base);
    const other = await r.addColumn(id, 'other', null, 'ส่งงาน', 5);
    const ind = await r.addColumn(id, 'indicator', 'MATH-2560-P4-01', null, null);  // ชั้นอื่นได้ (ทบทวน)
    let c = (await r.getClassroom(id))!;
    const ids = c.columns.filter((x) => x.kind !== 'final').map((x) => x.id);
    expect(ids.slice(2)).toEqual([other, ind]);
    await expect(r.reorderColumns(id, ids.slice(1))).rejects.toThrow('ไม่ครบ');
    await r.reorderColumns(id, [ind, ...ids.slice(0, 3)]);
    await r.updateColumn(ind, 8);
    await r.updateColumn(other, null, 'ส่งงานตรงเวลา');
    c = (await r.getClassroom(id))!;
    expect(c.columns.map((x) => x.id).slice(0, 4)).toEqual([ind, ...ids.slice(0, 3)]);
    expect(c.columns[0].maxScore).toBe(8);
    expect(c.columns.find((x) => x.id === other)).toMatchObject({ maxScore: null, label: 'ส่งงานตรงเวลา' });
    await r.deleteColumn(ind);
    expect((await r.getClassroom(id))!.columns.length).toBe(4);
    await r.updateClassroom(id, { name: 'ป.5/1 ห้องเช้า', studentCount: 28, settings: { rounding: '1dp', absent_policy: 'skip' } });
    await r.updateClassroom(id, { settings: { rounding: null } });
    c = (await r.getClassroom(id))!;
    expect(c).toMatchObject({ name: 'ป.5/1 ห้องเช้า', studentCount: 28, settings: { absent_policy: 'skip' } });
    expect(c.settings.rounding).toBeUndefined();
    await r.deleteClassroom(id);
    expect(await r.getClassroom(id)).toBeNull();
  });
});
