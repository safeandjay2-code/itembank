// แปลงชุดข้อสอบ (ExamDetail) เป็นข้อมูลเอกสารพิมพ์รายชุด — ใช้ร่วมกันทั้งหน้าพิมพ์/PDF และไฟล์ Word
import type { ExamDetail, Grade, Indicator, DifficultyLevel } from '../../core/types';
import type { FigureSpec } from '../bank/figure/spec';
import { visualLength } from './math';

export interface PrintItem {
  no: number;
  itemId: string;
  itemCode: string;
  stem: string;
  /** ตัวเลือกตามลำดับที่แสดงในชุดนี้ (สลับแล้ว) */
  options: string[];
  /** เฉลยที่แสดง 1–4 */
  key: number;
  figure: FigureSpec | null;
  indicatorCode: string;
  difficultyName: string;
  layout: OptionLayout;
}

export type OptionLayout = 'grid' | 'list';

export interface PrintSet { setNo: number; items: PrintItem[] }

export interface PrintDoc {
  examId: string;
  title: string;
  subjectName: string;
  gradeName: string;
  gradeShort: string;
  itemCount: number;
  durationMin: number | null;
  templateVersion: number;
  sets: PrintSet[];
  seats: Array<{ seatNo: number; setNo: number }>;
  figureNote: string;
}

/** ตัวเลือกสั้นทุกตัว → จัด 2×2 (เหมือนข้อสอบย่อยของครู) ยาวกว่านั้นเรียงทีละบรรทัด */
export const GRID_MAX_LENGTH = 15;
export function optionLayout(options: string[]): OptionLayout {
  return options.every((o) => visualLength(o) <= GRID_MAX_LENGTH) ? 'grid' : 'list';
}

export function buildPrintDoc(exam: ExamDetail, ref: { grades: Grade[]; indicators: Indicator[]; difficulties: DifficultyLevel[] },
  opts: { subjectName?: string; figureNote?: string } = {}): PrintDoc {
  const grade = ref.grades.find((g) => g.id === exam.gradeId);
  const ind = new Map(ref.indicators.map((i) => [i.id, i.code]));
  const diff = new Map(ref.difficulties.map((d) => [d.id, d.nameTh]));
  const items = new Map(exam.items.map((i) => [i.itemId, i]));
  const sets = exam.sets.slice().sort((a, b) => a.setNo - b.setNo).map((s) => ({
    setNo: s.setNo,
    items: s.entries.slice().sort((a, b) => a.position - b.position).map((e) => {
      const it = items.get(e.itemId);
      if (!it) throw new Error(`ไม่พบข้อ ${e.itemId} ในชุดข้อสอบ`);
      const options = e.optionOrder.map((o) => it.content.options[o - 1] ?? '');
      if (options[e.key - 1] !== it.content.options[it.answer - 1]) throw new Error(`เฉลยชุดที่ ${s.setNo} ข้อ ${e.position} ไม่ตรงกับตัวเลือกที่ถูก`);
      return {
        no: e.position, itemId: it.itemId, itemCode: it.itemCode, stem: it.content.stem, options, key: e.key,
        figure: (it.content.figure ?? null) as FigureSpec | null,
        indicatorCode: ind.get(it.indicatorId) ?? it.indicatorId, difficultyName: diff.get(it.difficulty) ?? String(it.difficulty),
        layout: optionLayout(options),
      };
    }),
  }));
  return {
    examId: exam.id, title: exam.title, subjectName: opts.subjectName ?? 'คณิตศาสตร์',
    gradeName: grade?.nameTh ?? exam.gradeId, gradeShort: grade?.shortTh ?? exam.gradeId,
    itemCount: exam.itemCount, durationMin: exam.durationMin, templateVersion: exam.templateVersion,
    sets, seats: exam.seats.slice().sort((a, b) => a.seatNo - b.seatNo),
    figureNote: opts.figureNote ?? 'รูปอาจไม่ได้วาดตามมาตราส่วน ให้ใช้ขนาดที่กำหนดให้',
  };
}

/** บรรทัดรายละเอียดใต้ชื่อแบบทดสอบ */
export function headerLine(d: PrintDoc): string {
  return [`วิชา${d.subjectName}`, `ชั้น${d.gradeName}`, `จำนวน ${d.itemCount} ข้อ`, d.durationMin ? `เวลา ${d.durationMin} นาที` : null]
    .filter(Boolean).join('   ');
}

export const INSTRUCTION = 'คำชี้แจง ให้นักเรียนเลือกคำตอบที่ถูกที่สุดเพียงข้อเดียว แล้วฝนวงกลมในกระดาษคำตอบให้เต็มวง '
  + 'ตรวจดูให้แน่ใจว่า "ชุดที่" ในกระดาษคำตอบตรงกับชุดที่ของแบบทดสอบ';
