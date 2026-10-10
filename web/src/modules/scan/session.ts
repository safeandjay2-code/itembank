// ตรรกะการตรวจที่ไม่ผูกกับหน้าจอ: แปลงผลอ่านกระดาษ → ข้อเสนอบันทึก, กันอ่านพลาดจากเฟรมเบลอ (ต้องได้ผลเดิมติดกัน)
import type { ExamDetail, ScanAnswer } from '../../core/types';
import { interpret, score, type ScanConfig } from './grade';
import type { SheetReading } from './omr';

export interface Proposal {
  examId: string;
  seatNo: number;
  setNo: number;
  answers: ScanAnswer[];
  ambiguous: number[];
  /** คะแนนที่คำนวณในเครื่อง (แสดงทันที — ฐานข้อมูลคำนวณซ้ำเป็นค่าจริง) */
  localScore: number;
  itemCount: number;
}

export type ProposalError = { error: 'other_exam' | 'unknown_seat' | 'set_mismatch'; message: string; seatNo?: number };

export function toProposal(r: SheetReading, exam: ExamDetail, cfg: ScanConfig): Proposal | ProposalError {
  if (r.qr.examId !== exam.id) return { error: 'other_exam', message: 'กระดาษแผ่นนี้เป็นของชุดข้อสอบอื่น' };
  const seat = exam.seats.find((s) => s.seatNo === r.qr.seatNo);
  if (!seat) return { error: 'unknown_seat', message: `ไม่มีเลขที่ ${r.qr.seatNo} ในชุดข้อสอบนี้`, seatNo: r.qr.seatNo };
  if (seat.setNo !== r.qr.setNo) return { error: 'set_mismatch', message: `กระดาษระบุชุดที่ ${r.qr.setNo} แต่เลขที่ ${seat.seatNo} ได้ชุดที่ ${seat.setNo}`, seatNo: seat.seatNo };
  const it = interpret(r.darkness, exam.itemCount, cfg);
  const keys = exam.sets.find((s) => s.setNo === r.qr.setNo)?.entries.map((e) => e.key) ?? [];
  return { examId: exam.id, seatNo: seat.seatNo, setNo: r.qr.setNo, answers: it.answers, ambiguous: it.ambiguous,
    localScore: score(it.answers, keys), itemCount: exam.itemCount };
}

export function isProposal(p: Proposal | ProposalError | null): p is Proposal {
  return !!p && !('error' in p);
}

const keyOf = (p: Proposal) => `${p.seatNo}|${p.setNo}|${p.answers.join(',')}|${p.ambiguous.join(',')}`;

/**
 * โหมดกล้อง: รับผลอ่านทีละเฟรม คืนข้อเสนอเมื่อได้ผลเหมือนกัน `need` เฟรมติดกัน (กันเฟรมเบลอ/มือสั่น)
 * แผ่นที่รับไปแล้วจะไม่ถูกรับซ้ำขณะยังอยู่หน้ากล้อง — ต้องหายจากกล้องเกิน `forgetMs` ก่อนจึงสแกนซ้ำได้
 */
export class Stabilizer {
  private candidate: { key: string; count: number } | null = null;
  private accepted: { seatNo: number; lastSeen: number } | null = null;
  constructor(private need = 2, private forgetMs = 1500) {}

  push(p: Proposal | null, now: number): Proposal | null {
    if (this.accepted && now - this.accepted.lastSeen > this.forgetMs) this.accepted = null;
    if (!p) { this.candidate = null; return null; }
    if (this.accepted && this.accepted.seatNo === p.seatNo) { this.accepted.lastSeen = now; this.candidate = null; return null; }
    const k = keyOf(p);
    this.candidate = this.candidate && this.candidate.key === k ? { key: k, count: this.candidate.count + 1 } : { key: k, count: 1 };
    if (this.candidate.count >= this.need) {
      this.candidate = null;
      this.accepted = { seatNo: p.seatNo, lastSeen: now };
      return p;
    }
    return null;
  }

  /** ลืมแผ่นที่รับล่าสุด (เช่น ครูกด "สแกนแผ่นนี้ใหม่") */
  reset() { this.candidate = null; this.accepted = null; }
}
