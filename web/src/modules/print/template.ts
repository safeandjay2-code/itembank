// แบบกระดาษคำตอบ (template) มีเวอร์ชัน — ตำแหน่งทุกอย่างเป็นมิลลิเมตรจากมุมบนซ้ายของกระดาษ A5 (SPEC §3.7, §7.2)
// แหล่งความจริงเดียว: data/answer_sheet_template_v1.json (ฐานข้อมูลเก็บสำเนาใน answer_sheet_templates.spec)
// เครื่องตรวจ (เฟส 5) ใช้ฟังก์ชันชุดเดียวกันนี้หาตำแหน่งวงกลม
import v1 from '../../../../data/answer_sheet_template_v1.json';

export type SheetTemplate = typeof v1;
export const TEMPLATES: Record<number, SheetTemplate> = { 1: v1 };
export const CURRENT_TEMPLATE = 1;

export function getTemplate(version: number): SheetTemplate {
  const t = TEMPLATES[version];
  if (!t) throw new Error(`ไม่รู้จักแบบกระดาษคำตอบรุ่น ${version}`);
  return t;
}

/** ตำแหน่ง (คอลัมน์, แถว) ของข้อที่ n (เริ่ม 1) — เรียงลงทีละคอลัมน์ */
export function itemSlot(t: SheetTemplate, n: number) {
  const b = t.bubbles;
  if (n < 1 || n > b.capacity) throw new Error(`ข้อที่ ${n} เกินความจุกระดาษคำตอบ (${b.capacity} ข้อ)`);
  return { col: Math.floor((n - 1) / b.rows), row: (n - 1) % b.rows };
}

/** จุดศูนย์กลางวงกลมของข้อที่ n ตัวเลือก c (1–4) หน่วย มม. */
export function bubbleCenter(t: SheetTemplate, n: number, c: number) {
  const b = t.bubbles;
  const { col, row } = itemSlot(t, n);
  return { x: b.column_x[col] + b.first_bubble_offset_x + (c - 1) * b.bubble_pitch_x, y: b.first_row_y + row * b.row_pitch_y };
}

export function numberPos(t: SheetTemplate, n: number) {
  const b = t.bubbles;
  const { col, row } = itemSlot(t, n);
  return { x: b.column_x[col] + b.number_offset_x, y: b.first_row_y + row * b.row_pitch_y };
}

export interface QrData { examId: string; setNo: number; seatNo: number; template: number }

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const B32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

/** uuid (16 ไบต์) → base32 26 ตัวอักษร (A–Z, 2–7) */
export function uuidToB32(u: string): string {
  const hex = u.replace(/-/g, '');
  let bits = '';
  for (let i = 0; i < 32; i++) bits += parseInt(hex[i], 16).toString(2).padStart(4, '0');
  bits = bits.padEnd(130, '0');
  let out = '';
  for (let i = 0; i < 130; i += 5) out += B32[parseInt(bits.slice(i, i + 5), 2)];
  return out;
}

export function b32ToUuid(s: string): string | null {
  if (!/^[A-Z2-7]{26}$/.test(s)) return null;
  let bits = '';
  for (const ch of s) bits += B32.indexOf(ch).toString(2).padStart(5, '0');
  if (/1/.test(bits.slice(128))) return null;
  let hex = '';
  for (let i = 0; i < 128; i += 4) hex += parseInt(bits.slice(i, i + 4), 2).toString(16);
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

/**
 * ข้อความใน QR: รหัสชุดข้อสอบ ชุด เลขที่ รุ่นแบบกระดาษ — ไม่มีเฉลยหรือรหัสข้อ (SPEC §7.2)
 *   IB2:<uuid เป็น base32>:<ชุด>:<เลขที่>:<รุ่น>  ตัวอักษรชุด QR แบบ alphanumeric → QR เล็กลง 2 รุ่น โมดูลใหญ่ขึ้น อ่านง่ายเมื่อภาพเบลอ/ไกล
 *   IB1|<exam_id>|<ชุด>|<เลขที่>|<รุ่น>        รูปแบบเดิม (ใช้เมื่อรหัสชุดไม่ใช่ uuid เช่น โหมดสาธิต) — เครื่องตรวจอ่านได้ทั้งสองแบบ
 */
export function qrPayload(d: QrData): string {
  if (UUID_RE.test(d.examId)) return `IB2:${uuidToB32(d.examId.toLowerCase())}:${d.setNo}:${d.seatNo}:${d.template}`;
  return `IB1|${d.examId}|${d.setNo}|${d.seatNo}|${d.template}`;
}

export function parseQrPayload(s: string): QrData | null {
  const t = s.trim();
  const m2 = /^IB2:([A-Z2-7]{26}):(\d+):(\d+):(\d+)$/.exec(t);
  if (m2) {
    const examId = b32ToUuid(m2[1]);
    return examId ? { examId, setNo: Number(m2[2]), seatNo: Number(m2[3]), template: Number(m2[4]) } : null;
  }
  const m = /^IB1\|([^|]+)\|(\d+)\|(\d+)\|(\d+)$/.exec(t);
  return m ? { examId: m[1], setNo: Number(m[2]), seatNo: Number(m[3]), template: Number(m[4]) } : null;
}
