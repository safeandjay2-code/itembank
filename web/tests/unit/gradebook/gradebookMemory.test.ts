// One Stop เฟส 4: โหมดสาธิตทั้งเส้น — สร้างห้อง → ชุดผูกห้อง → ตรวจ → สมุดคะแนน → ปรับให้ผ่าน → สอบซ่อม → ปิดชุด → ลบช่อง
import { describe, expect, it } from 'vitest';
import { MemoryRepo, DEMO_EMAIL, DEMO_PASSWORD } from '../../../src/data/memoryRepo';
import type { ExamLink, GbSheet } from '../../../src/core/types';
import { buildPlan, configFromSettings, makeOrdering } from '../../../src/modules/assembly/assemble';
import { planToCreateInput } from '../../../src/modules/assembly/payload';

async function setup() {
  const repo = new MemoryRepo(3);
  await repo.signIn(DEMO_EMAIL, DEMO_PASSWORD);
  const [grades, diffs, settings] = await Promise.all([repo.getGrades(), repo.getDifficultyLevels(), repo.getSettings()]);
  const all = await repo.getIndicators('MATH');
  const inds = all.filter((i) => i.gradeId === 'P5');
  const pool = await repo.getAssemblyPool('MATH');
  const cfg = configFromSettings(settings);
  const ordering = makeOrdering(all, grades, diffs);
  /** ชุด 4 ข้อ: 2 ข้อ ind[0] + 2 ข้อ ind[1] · 1 ชุด (ไม่สลับข้อ เลขที่ทุกคนชุดเดียวกัน) */
  const make = (studentCount: number, title: string) => {
    const req = { gradeId: 'P5', itemCount: 4, setCount: 1, studentCount,
      rows: [{ indicatorId: inds[0].id, difficulty: 1, count: 2 }, { indicatorId: inds[1].id, difficulty: 1, count: 2 }] };
    return planToCreateInput(buildPlan(req, pool, cfg, ordering, 7), req, { title, subjectId: 'MATH' });
  };
  const roomId = await repo.createClassroom({ gradeId: 'P5', academicYear: 2569, term: 2, name: 'ป.5/1', studentCount: 3, finalMax: 20,
    indicators: [{ indicatorId: inds[0].id, maxScore: 10 }] });
  /** ตรวจเลขที่ seat: ตอบถูกตามลำดับข้อบนกระดาษที่ระบุ (1-based) หรือฟังก์ชันเลือกจากตัวชี้วัดของแต่ละข้อ */
  const scan = async (examId: string, seat: number, pick: number[] | ((order: string[]) => number[])) => {
    const d = (await repo.getExam(examId))!;
    const setNo = d.seats.find((x) => x.seatNo === seat)!.setNo;
    const entries = d.sets.find((x) => x.setNo === setNo)!.entries;
    const right = typeof pick === 'function' ? pick(entries.map((e) => d.items.find((i) => i.itemId === e.itemId)!.indicatorId)) : pick;
    await repo.saveScan({ examId, seatNo: seat, setNo, answers: entries.map((e, k) => (right.includes(k + 1) ? e.key : (e.key % 4) + 1) as 1 | 2 | 3 | 4),
      ambiguous: [], source: 'manual', replace: true });
    return entries.map((e) => d.items.find((i) => i.itemId === e.itemId)!.indicatorId);
  };
  return { repo, make, roomId, inds, scan };
}
const col = (s: GbSheet, ind: string | 'final') => s.columns.findIndex((c) => (ind === 'final' ? c.kind === 'final' : c.indicatorId === ind));
const vals = (s: GbSheet, ind: string | 'final') => s.rows.map((r) => r.cells[col(s, ind)].value);

describe('สมุดคะแนนในโหมดสาธิต', () => {
  it('ผลตรวจ → คะแนนแปลง · ตัวชี้วัดที่ยังไม่มีช่อง · ปลายภาค · ขาดสอบ', async () => {
    const { repo, make, roomId, inds, scan } = await setup();
    const link: ExamLink = { classroomId: roomId, purpose: 'collect', retakeOf: null };
    const e1 = await repo.createExam({ ...make(3, 'เก็บ 1'), link });
    let s = await repo.getGradebook(roomId);
    expect(s.rows.every((r) => r.total === null)).toBe(true);
    expect(s.columns[col(s, inds[0].id)].collected).toBe(false);

    await scan(e1, 1, [1, 2, 3, 4]);
    await scan(e1, 2, (order) => [order.indexOf(inds[0].id) + 1]);   // ถูกข้อแรกของ ind[0] ข้อเดียว
    s = await repo.getGradebook(roomId);
    expect(vals(s, inds[0].id)).toEqual([10, 5, 0]);           // 2/2 → 10 · 1/2 → 5 · ขาดสอบ → 0
    expect(s.rows[2].cells[col(s, inds[0].id)].missing).toEqual([e1]);
    expect(s.unplannedIndicators).toEqual([inds[1].id]);       // ind[1] มีคะแนนแต่ยังไม่มีช่อง
    expect(s.attempts.filter((a) => a.seatNo === 1).map((a) => `${a.correct}/${a.total}`)).toEqual(['2/2', '2/2']);

    await repo.addColumn(roomId, 'indicator', inds[1].id, null, 4);
    s = await repo.getGradebook(roomId);
    expect(vals(s, inds[1].id)).toEqual([4, 0, 0]);
    expect(s.unplannedIndicators).toEqual([]);

    const f1 = await repo.createExam({ ...make(3, 'ปลายภาค'), link: { ...link, purpose: 'final' } });
    await scan(f1, 1, [1, 2, 3]);
    s = await repo.getGradebook(roomId);
    expect(vals(s, 'final')).toEqual([15, 0, 0]);              // 3/4 × 20 = 15
    expect(s.rows[0]).toMatchObject({ totalCollect: 14, totalFinal: 15, total: 29 });
  });

  it('ปรับให้ผ่าน: คะแนนจริงยังอยู่ · ตรวจซ้ำแล้วค่าที่ปรับไม่หาย · ยกเลิกได้ · ลบช่องแล้วค่าที่ปรับหาย', async () => {
    const { repo, make, roomId, inds, scan } = await setup();
    const e1 = await repo.createExam({ ...make(3, 'เก็บ 1'), link: { classroomId: roomId, purpose: 'collect', retakeOf: null } });
    await scan(e1, 1, []);
    let s = await repo.getGradebook(roomId);
    const cid = s.columns[col(s, inds[0].id)].id;
    await expect(repo.setOverride(cid, 1, 11, 'pass')).rejects.toThrow('ระหว่าง 0 ถึง 10');
    await expect(repo.setOverride(cid, 4, 5, 'pass')).rejects.toThrow('ไม่มีเลขที่ 4');
    await repo.setOverride(cid, 1, 5, 'pass');
    s = await repo.getGradebook(roomId);
    expect(s.rows[0].cells[col(s, inds[0].id)]).toMatchObject({ value: 5, real: 0, adjusted: 5, reason: 'pass' });
    await scan(e1, 1, [1]);
    s = await repo.getGradebook(roomId);
    expect(s.rows[0].cells[col(s, inds[0].id)].adjusted).toBe(5);
    await repo.setOverride(cid, 1, null, 'manual');
    s = await repo.getGradebook(roomId);
    expect(s.rows[0].cells[col(s, inds[0].id)].adjusted).toBeNull();
    await repo.setOverride(cid, 2, 6, 'manual');
    await repo.deleteColumn(cid);
    await repo.addColumn(roomId, 'indicator', inds[0].id, null, 10);
    s = await repo.getGradebook(roomId);
    expect(s.rows[1].cells[col(s, inds[0].id)].adjusted).toBeNull();   // คะแนนจริงกลับมา แต่ค่าที่ปรับของช่องเดิมหาย
    expect(s.rows[0].cells[col(s, inds[0].id)].real).not.toBeNull();
  });

  it('สอบซ่อม: สูงสุด / ครูเลือก · ปิดชุดแล้วคะแนนยังอยู่', async () => {
    const { repo, make, roomId, inds, scan } = await setup();
    const link: ExamLink = { classroomId: roomId, purpose: 'collect', retakeOf: null };
    const e1 = await repo.createExam({ ...make(3, 'เก็บ 1'), link });
    await scan(e1, 1, []);                                            // 0/2
    const r1 = await repo.createExam({ ...make(1, 'ซ่อม 1'), link: { ...link, retakeOf: e1 } });
    await scan(r1, 1, (order) => [order.indexOf(inds[0].id) + 1]);    // 1/2
    let s = await repo.getGradebook(roomId);
    expect(vals(s, inds[0].id)[0]).toBe(5);                           // max(0, 1/2) × 10
    await expect(repo.chooseRetake(r1, 1, e1)).rejects.toThrow('ชุดแรกของกลุ่ม');
    await expect(repo.chooseRetake(e1, 2, e1)).rejects.toThrow('ไม่มีผลสอบ');
    await repo.chooseRetake(e1, 1, e1);
    s = await repo.getGradebook(roomId);
    expect(vals(s, inds[0].id)[0]).toBe(5);                           // ยังเป็นสูงสุด (วิธีนับไม่ใช่ครูเลือก)
    await repo.updateClassroom(roomId, { settings: { retake_policy: 'manual' } });
    s = await repo.getGradebook(roomId);
    expect(vals(s, inds[0].id)[0]).toBe(0);                           // ครูเลือกครั้งแรก
    expect(s.retakeChoices).toEqual([{ rootExamId: e1, seatNo: 1, chosenExamId: e1 }]);
    await repo.chooseRetake(e1, 1, null);
    await repo.closeExam(e1);
    await repo.closeExam(r1);
    s = await repo.getGradebook(roomId);
    expect(vals(s, inds[0].id)[0]).toBe(5);
    await repo.deleteExam(r1);                                        // ลบสอบซ่อม → คะแนนชุดนั้นหาย
    s = await repo.getGradebook(roomId);
    expect(vals(s, inds[0].id)[0]).toBe(0);
  });
});

