// แปลงแผนชุดข้อสอบเป็นข้อมูลที่ส่งให้ฐานข้อมูลบันทึก (exam_create) — ใช้ร่วมกันระหว่างหน้าเว็บ ชั้นข้อมูล และชุดทดสอบ
import type { ExamCreateInput } from '../../core/types';
import { mergeRows, type AssemblyRequest, type ExamPlan } from './assemble';

export function planToCreateInput(plan: ExamPlan, req: AssemblyRequest, meta: { title: string; subjectId: string }): ExamCreateInput {
  return {
    title: meta.title.trim(), subjectId: meta.subjectId, gradeId: req.gradeId,
    setCount: req.setCount, studentCount: req.studentCount, rows: mergeRows(req.rows),
    items: plan.items.map((x) => ({ itemId: x.item.id, version: x.item.version, basePosition: x.basePosition })),
    sets: plan.sets.map((s) => ({ setNo: s.setNo, entries: s.entries.map((e) => ({ itemId: e.itemId, optionOrder: e.optionOrder })) })),
    build: { algorithm: plan.algorithm, seed: plan.seed, warnings: plan.warnings, infos: plan.infos,
      anchorCount: plan.anchorCount, anchorTarget: plan.anchorTarget },
  };
}

/** รูปแบบ JSON ของฟังก์ชัน exam_create ในฐานข้อมูล */
export function toDbPayload(x: ExamCreateInput) {
  return {
    title: x.title, subject_id: x.subjectId, grade_id: x.gradeId, set_count: x.setCount, student_count: x.studentCount,
    rows: x.rows.map((r) => ({ indicator_id: r.indicatorId, difficulty: r.difficulty, count: r.count })),
    items: x.items.map((i) => ({ item_id: i.itemId, version: i.version, base_position: i.basePosition })),
    sets: x.sets.map((s) => ({ set_no: s.setNo, entries: s.entries.map((e) => ({ item_id: e.itemId, option_order: e.optionOrder })) })),
    build: x.build,
  };
}
