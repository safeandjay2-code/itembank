// ขั้นตอนสแกนห้อง O-NET (ไม่มี UI — ทดสอบหน่วยได้)
//   ผลอ่าน ON1 → ตรวจว่าชุดใช้ได้ → ตีความ (interpretOnet) → ตัดสินว่า "ส่งได้เลย" หรือ "ต้องถามครู" (เลขที่ไม่ชัด/อ่านไม่ได้)
import { FAIL_TH, type OnetReadResult } from '../scan/omr';
import { interpretOnet, type OnetInterpretation, type OnetRemark } from '../scan/onetGrade';
import { DEFAULT_SCAN, type ScanConfig } from '../scan/grade';
import { getOnetTemplate } from '../print/onetTemplate';
import type { OnetSetSummary, OnetSubmitInput } from './types';

export type OnetRead =
  | { kind: 'fail'; message: string }
  | { kind: 'read'; setCode: string; setNo: number; interp: OnetInterpretation };

export function processRead(r: OnetReadResult | null, sets: OnetSetSummary[], cfg: ScanConfig = DEFAULT_SCAN): OnetRead {
  if (!r) return { kind: 'fail', message: FAIL_TH.no_qr };
  if (!r.ok) return { kind: 'fail', message: r.message };
  const set = sets.find((s) => s.code === r.qr.setCode);
  if (!set) return { kind: 'fail', message: `ไม่รู้จักชุด ${r.qr.setCode} ในห้อง O-NET` };
  if (!set.usable) return { kind: 'fail', message: `ชุดที่ ${set.setNo} ยังไม่ได้ปลดล็อก — สแกนไม่ได้` };
  const interp = interpretOnet(getOnetTemplate(r.qr.template), r.darkness, set.code, cfg);
  return { kind: 'read', setCode: set.code, setNo: set.setNo, interp };
}

/** ค่าที่ต้องเหมือนกัน 2 เฟรมติดกันก่อนรับ (กันเฟรมเบลอ) */
export function readKey(r: Extract<OnetRead, { kind: 'read' }>): string {
  const s = r.interp.seat;
  return `${r.setCode}|${s.status}|${s.value ?? s.suggested ?? '-'}|${r.interp.answers.map((a) => a ?? '_').join(',')}`;
}

/** remark เรื่องเลขที่ — ครูพิมพ์/ยืนยันเลขที่แล้วถือว่าแก้แล้ว ไม่ต้องเก็บ */
const SEAT_CODES = new Set(['seat_unreadable', 'seat_confirm', 'seat_zero']);

export function submitInput(roomId: string, r: Extract<OnetRead, { kind: 'read' }>, seatNo: number, replace = false): OnetSubmitInput {
  const remarks: OnetRemark[] = r.interp.remarks.filter((m) => !SEAT_CODES.has(m.code));
  return { roomId, setCode: r.setCode, seatNo, answers: r.interp.answers, bubbledSet: r.interp.bubbledSet, remarks, replace };
}

/** กล้อง: รับผลเมื่อได้ค่าเดียวกัน need เฟรมติดกัน · แผ่นที่รับแล้วไม่รับซ้ำจนกว่าจะหายจากกล้องเกิน forgetMs */
export class OnetStabilizer {
  private cand: { key: string; count: number } | null = null;
  private accepted: { key: string; lastSeen: number } | null = null;
  constructor(private need = 2, private forgetMs = 1500) {}

  push(r: Extract<OnetRead, { kind: 'read' }> | null, now: number): Extract<OnetRead, { kind: 'read' }> | null {
    if (this.accepted && now - this.accepted.lastSeen > this.forgetMs) this.accepted = null;
    if (!r) { this.cand = null; return null; }
    const k = readKey(r);
    if (this.accepted && this.accepted.key === k) { this.accepted.lastSeen = now; this.cand = null; return null; }
    this.cand = this.cand?.key === k ? { key: k, count: this.cand.count + 1 } : { key: k, count: 1 };
    if (this.cand.count < this.need) return null;
    this.cand = null;
    this.accepted = { key: k, lastSeen: now };
    return r;
  }
  reset() { this.cand = null; this.accepted = null; }
}

export function scoreText(score: number) { return `${Math.round(score * 100) / 100}`; }
