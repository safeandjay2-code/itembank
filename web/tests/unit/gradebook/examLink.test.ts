// One Stop เฟส 3: ผูกชุดข้อสอบกับห้อง — ตรรกะหน้าเว็บ (examLink.ts) + โหมดสาธิต (memoryRepo เลียนแบบ 0011/0012)
import { describe, expect, it } from 'vitest';
import { MemoryRepo, DEMO_EMAIL, DEMO_PASSWORD } from '../../../src/data/memoryRepo';
import type { ClassroomSummary, ExamLink, ExamSummary, GbColumn } from '../../../src/core/types';
import { linkLabel, linkProblems, retakeCandidates, unplannedIndicators } from '../../../src/modules/gradebook/examLink';
import { buildPlan, configFromSettings, makeOrdering } from '../../../src/modules/assembly/assemble';
import { planToCreateInput } from '../../../src/modules/assembly/payload';

const room = (o: Partial<ClassroomSummary> = {}): ClassroomSummary => ({ id: 'r1', name: 'ป.5/1', gradeId: 'P5', academicYear: 2569, term: 2,
  studentCount: 30, status: 'open', createdAt: '', closedAt: null, columnCount: 0, examCount: 0, ...o });
const ex = (o: Partial<ExamSummary>): ExamSummary => ({ id: 'e', title: 't', gradeId: 'P5', itemCount: 5, setCount: 1, studentCount: 30,
  status: 'draft', createdAt: '', durationMin: null, expiresAt: null, closedAt: null, classroomId: null, purpose: 'practice', retakeOf: null, ...o });

describe('examLink (ตรรกะหน้าเว็บ)', () => {
  it('ชุดฝึกผ่านเสมอ · เก็บคะแนนต้องมีห้อง ชั้นตรง เลขที่ครบห้อง (สอบซ่อมไม่บังคับเลขที่)', () => {
    expect(linkProblems({ classroomId: null, purpose: 'practice', retakeOf: null }, { gradeId: 'P4', studentCount: 1 }, undefined)).toEqual([]);
    expect(linkProblems({ classroomId: null, purpose: 'collect', retakeOf: null }, { gradeId: 'P5', studentCount: 30 }, undefined))
      .toEqual(['ชุดเก็บคะแนน/ปลายภาคต้องเลือกห้องเรียน']);
    const link: ExamLink = { classroomId: 'r1', purpose: 'collect', retakeOf: null };
    expect(linkProblems(link, { gradeId: 'P5', studentCount: 30 }, room())).toEqual([]);
    expect(linkProblems(link, { gradeId: 'P4', studentCount: 30 }, room())[0]).toContain('ชั้นของชุดข้อสอบไม่ตรง');
    expect(linkProblems(link, { gradeId: 'P5', studentCount: 29 }, room())[0]).toContain('ตั้งจำนวนนักเรียนของชุดให้ครบทั้งห้อง');
    expect(linkProblems({ ...link, retakeOf: 'e1' }, { gradeId: 'P5', studentCount: 3 }, room())).toEqual([]);
    expect(linkProblems(link, { gradeId: 'P5', studentCount: 30 }, room({ status: 'closed' }))).toEqual(['ห้องนี้ปิดเทอมแล้ว']);
  });
  it('ตัวเลือกสอบซ่อม = ชุดแรกของห้องเดียวกัน ประเภทเดียวกัน ไม่รวมสอบซ่อมและตัวเอง', () => {
    const exams = [ex({ id: 'a', classroomId: 'r1', purpose: 'collect' }), ex({ id: 'b', classroomId: 'r1', purpose: 'collect', retakeOf: 'a' }),
      ex({ id: 'c', classroomId: 'r1', purpose: 'final' }), ex({ id: 'd', classroomId: 'r2', purpose: 'collect' }), ex({ id: 'e', purpose: 'practice' })];
    expect(retakeCandidates(exams, 'r1', 'collect').map((e) => e.id)).toEqual(['a']);
    expect(retakeCandidates(exams, 'r1', 'collect', 'a')).toEqual([]);
    expect(retakeCandidates(exams, 'r1', 'final').map((e) => e.id)).toEqual(['c']);
    expect(retakeCandidates(exams, null, 'collect')).toEqual([]);
  });
  it('ตัวชี้วัดที่ห้องยังไม่มีช่อง · ป้ายประเภท', () => {
    const cols: GbColumn[] = [{ id: 1, kind: 'indicator', indicatorId: 'I1', label: null, maxScore: 10, sort: 1 },
      { id: 2, kind: 'final', indicatorId: null, label: null, maxScore: 30, sort: 0 }];
    expect(unplannedIndicators(['I1', 'I2', '', 'I2'], cols)).toEqual(['I2']);
    const name = (id: string) => (id === 'r1' ? 'ป.5/1' : undefined);
    expect(linkLabel({ purpose: 'collect', classroomId: 'r1', retakeOf: null }, name)).toBe('เก็บคะแนน · ป.5/1');
    expect(linkLabel({ purpose: 'collect', classroomId: 'r1', retakeOf: 'x' }, name)).toBe('สอบซ่อม (เก็บคะแนน) · ป.5/1');
    expect(linkLabel({ purpose: 'final', classroomId: 'gone', retakeOf: null }, name)).toBe('ปลายภาค · ห้องที่ลบแล้ว');
    expect(linkLabel({ purpose: 'practice', classroomId: null, retakeOf: null }, name)).toBe('ฝึก/วินิจฉัย');
  });
});

describe('โหมดสาธิต: สร้างชุดผูกห้อง → ตรวจ → คะแนนในสมุด → ปิดชุด/ลบ', () => {
  async function setup() {
    const repo = new MemoryRepo(3);
    await repo.signIn(DEMO_EMAIL, DEMO_PASSWORD);
    const [grades, diffs, settings] = await Promise.all([repo.getGrades(), repo.getDifficultyLevels(), repo.getSettings()]);
    const inds = (await repo.getIndicators('MATH')).filter((i) => i.gradeId === 'P5');
    const pool = await repo.getAssemblyPool('MATH');
    const cfg = configFromSettings(settings);
    const ordering = makeOrdering(await repo.getIndicators('MATH'), grades, diffs);
    const make = (studentCount: number, gradeId = 'P5', indId = inds[0].id) => {
      const req = { gradeId, itemCount: 3, setCount: 1, studentCount, rows: [{ indicatorId: indId, difficulty: 1, count: 3 }] };
      return planToCreateInput(buildPlan(req, pool, cfg, ordering, 7), req, { title: 'ชุด', subjectId: 'MATH' });
    };
    const roomId = await repo.createClassroom({ gradeId: 'P5', academicYear: 2569, term: 2, name: 'ป.5/1', studentCount: 4, finalMax: null,
      indicators: [{ indicatorId: inds[0].id, maxScore: 10 }] });
    return { repo, make, roomId, inds };
  }

  it('กติกาเดียวกับฐานข้อมูล และผิดแล้วไม่สร้างชุด', async () => {
    const { repo, make, roomId } = await setup();
    const link: ExamLink = { classroomId: roomId, purpose: 'collect', retakeOf: null };
    await expect(repo.createExam({ ...make(3), link })).rejects.toThrow('ตั้งจำนวนนักเรียนของชุดให้ครบทั้งห้อง');
    await expect(repo.createExam({ ...make(4), link: { ...link, classroomId: null } })).rejects.toThrow('ต้องเลือกห้องเรียน');
    expect(await repo.listExams('MATH')).toHaveLength(0);
    const e1 = await repo.createExam({ ...make(4), link });
    const r1 = await repo.createExam({ ...make(2), link: { ...link, retakeOf: e1 } });
    const r2 = await repo.createExam({ ...make(2), link: { ...link, retakeOf: r1 } });
    const list = await repo.listExams('MATH');
    expect(list.find((e) => e.id === r2)!.retakeOf).toBe(e1);   // สอบซ่อมของสอบซ่อม → ชี้ชุดแรก
    expect((await repo.listClassrooms())[0].examCount).toBe(3);
    await expect(repo.createExam({ ...make(4), link: { ...link, purpose: 'final', retakeOf: e1 } })).rejects.toThrow('ประเภทการสอบเดียวกับชุดเดิม');
  });

  it('ตรวจแล้วคะแนนนับในสมุด · เปลี่ยนห้องไม่ได้ · ปิดชุดคะแนนยังอยู่ · ลบห้องไม่ได้ · ลบชุดได้', async () => {
    const { repo, make, roomId } = await setup();
    const id = await repo.createExam({ ...make(4), link: { classroomId: roomId, purpose: 'collect', retakeOf: null } });
    const d = (await repo.getExam(id))!;
    expect(d.scoredSeats).toBe(0);
    await repo.linkExam(id, { classroomId: null, purpose: 'practice', retakeOf: null });   // ก่อนตรวจเปลี่ยนได้
    await repo.linkExam(id, { classroomId: roomId, purpose: 'collect', retakeOf: null });
    for (const seat of [1, 2]) {
      await repo.saveScan({ examId: id, seatNo: seat, setNo: 1, answers: d.sets[0].entries.map((e) => e.key), ambiguous: [], source: 'camera', replace: false });
    }
    expect((await repo.getExam(id))!.scoredSeats).toBe(2);
    expect((await repo.getExam(id))!.expiresAt).toBeNull();   // ชุดผูกห้องไม่หมดอายุ 60 วัน
    await expect(repo.linkExam(id, { classroomId: null, purpose: 'practice', retakeOf: null })).rejects.toThrow('มีผลตรวจแล้ว');
    await repo.closeExam(id);
    expect((await repo.getExam(id))!.scoredSeats).toBe(2);
    await expect(repo.deleteClassroom(roomId)).rejects.toThrow('ปิดเทอมก่อน');
    await repo.deleteExam(id);
    await repo.deleteClassroom(roomId);
    expect(await repo.listClassrooms()).toHaveLength(0);
  });
});
