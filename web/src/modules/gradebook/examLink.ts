// ตรรกะการผูกชุดข้อสอบกับห้อง + ประเภทการสอบ (One Stop เฟส 3 · SPEC-OneStop §4)
// กติกาเดียวกับฐานข้อมูล (gb_exam_link ใน 0011 + exams_classroom_fit ใน 0012) — หน้าเว็บเช็กก่อนเพื่อบอกครูทันที
import type { ClassroomSummary, ExamLink, ExamPurpose, ExamSummary, GbColumn } from '../../core/types';

export const PURPOSE_HINT: Record<ExamPurpose, string> = {
  collect: 'คะแนนแยกลงช่องตัวชี้วัดของห้องอัตโนมัติตามตัวชี้วัดของแต่ละข้อ',
  final: 'คะแนนรวมลงช่องปลายภาคช่องเดียว (ดูผลรายตัวชี้วัดได้ แต่ไม่นับคะแนนตัวชี้วัด)',
  practice: 'ไม่นับคะแนน — ดูผลวิเคราะห์อย่างเดียว',
};

export const PRACTICE_LINK: ExamLink = { classroomId: null, purpose: 'practice', retakeOf: null };

/** ชุดที่เป็น "ชุดแรก" ให้สอบซ่อมได้: ห้องเดียวกัน ประเภทเดียวกัน ตัวเองไม่ใช่สอบซ่อม และไม่ใช่ชุดนี้ */
export function retakeCandidates(exams: ExamSummary[], classroomId: string | null, purpose: ExamPurpose, selfId?: string): ExamSummary[] {
  if (!classroomId || purpose === 'practice') return [];
  return exams.filter((e) => e.classroomId === classroomId && e.purpose === purpose && !e.retakeOf && e.id !== selfId);
}

/** ปัญหาที่ทำให้ฐานข้อมูลปฏิเสธ (ข้อความเดียวกับฐานข้อมูลเท่าที่ทำได้) — ว่าง = ผ่าน */
export function linkProblems(link: ExamLink, exam: { gradeId: string; studentCount: number }, room: ClassroomSummary | undefined): string[] {
  const out: string[] = [];
  if (link.purpose === 'practice') return out;
  if (!link.classroomId || !room) { out.push('ชุดเก็บคะแนน/ปลายภาคต้องเลือกห้องเรียน'); return out; }
  if (room.status !== 'open') out.push('ห้องนี้ปิดเทอมแล้ว');
  if (exam.gradeId !== room.gradeId) out.push(`ชั้นของชุดข้อสอบไม่ตรงกับชั้นของห้อง ${room.name}`);
  if (!link.retakeOf && Number.isInteger(exam.studentCount) && exam.studentCount < room.studentCount) {
    out.push(`ห้อง ${room.name} มีนักเรียน ${room.studentCount} คน แต่ชุดข้อสอบมีเลขที่ถึง ${exam.studentCount} — ตั้งจำนวนนักเรียนของชุดให้ครบทั้งห้อง`);
  }
  return out;
}

/** ตัวชี้วัดในชุดที่ห้องยังไม่มีช่อง — คะแนนเก็บไว้แล้ว แต่ยังไม่ลงสมุดจนกว่าจะเพิ่มช่อง (เพิ่มเมื่อไรคะแนนก็มา) */
export function unplannedIndicators(indicatorIds: string[], columns: GbColumn[]): string[] {
  const have = new Set(columns.filter((c) => c.kind === 'indicator').map((c) => c.indicatorId));
  return [...new Set(indicatorIds.filter((id) => id && !have.has(id)))];
}

/** ข้อความสั้นสำหรับรายการ/หัวชุด เช่น "เก็บคะแนน · ป.5/1" หรือ "สอบซ่อม · ป.5/1" */
export function linkLabel(e: Pick<ExamSummary, 'purpose' | 'classroomId' | 'retakeOf'>, roomName: (id: string) => string | undefined): string {
  const kind = e.retakeOf ? `สอบซ่อม (${e.purpose === 'final' ? 'ปลายภาค' : 'เก็บคะแนน'})` : { collect: 'เก็บคะแนน', final: 'ปลายภาค', practice: 'ฝึก/วินิจฉัย' }[e.purpose];
  const room = e.classroomId ? roomName(e.classroomId) ?? 'ห้องที่ลบแล้ว' : null;
  return room ? `${kind} · ${room}` : kind;
}
