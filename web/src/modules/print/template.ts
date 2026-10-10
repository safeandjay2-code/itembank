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

/** ข้อความใน QR: รหัสชุดข้อสอบ ชุด เลขที่ รุ่นแบบกระดาษ — ไม่มีเฉลยหรือรหัสข้อ */
export function qrPayload(d: QrData): string {
  return `IB1|${d.examId}|${d.setNo}|${d.seatNo}|${d.template}`;
}

export function parseQrPayload(s: string): QrData | null {
  const m = /^IB1\|([^|]+)\|(\d+)\|(\d+)\|(\d+)$/.exec(s.trim());
  return m ? { examId: m[1], setNo: Number(m[2]), seatNo: Number(m[3]), template: Number(m[4]) } : null;
}
