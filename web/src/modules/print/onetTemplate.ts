// แบบกระดาษคำตอบ O-NET รุ่น ON1 (SPEC-ONET §5) — ตำแหน่งเป็นมิลลิเมตรจากมุมบนซ้ายของ A4 แนวตั้ง
// แหล่งความจริงเดียว: data/answer_sheet_template_on1.json — ตัววาด (onetSheetSvg) และตัวอ่าน (เฟส 3) ใช้ฟังก์ชันชุดนี้
// แยกจากแบบกระดาษระบบหลัก (template.ts / IB1 / IB2) ทั้งหมด ไม่กระทบของเดิม
import on1 from '../../../../data/answer_sheet_template_on1.json';

export type OnetTemplate = typeof on1;
export const ONET_TEMPLATES: Record<number, OnetTemplate> = { 1: on1 };
export const ONET_CURRENT_TEMPLATE = 1;

export function getOnetTemplate(version: number): OnetTemplate {
  const t = ONET_TEMPLATES[version];
  if (!t) throw new Error(`ไม่รู้จักแบบกระดาษคำตอบ O-NET รุ่น ${version}`);
  return t;
}

export interface Pt { x: number; y: number }

/** จุดศูนย์กลางมุมดำ 4 มุม เรียง tl, tr, bl, br */
export function on1CornerCenters(t: OnetTemplate): Pt[] {
  const h = t.corner_marks.size / 2;
  return t.corner_marks.top_left.map(([x, y]) => ({ x: x + h, y: y + h }));
}

/** ความกว้างช่องรหัสชุดข้อสอบ 1 ช่อง */
export const setCodeCellW = (t: OnetTemplate) => t.set_code.w / t.set_code.codes.length;

/** วงรหัสชุดข้อสอบช่องที่ k (0–5 = 100–600) */
export function on1SetCodeCenter(t: OnetTemplate, k: number): Pt {
  const s = t.set_code;
  if (k < 0 || k >= s.codes.length) throw new Error(`ช่องรหัสชุด ${k} ไม่มีในแบบกระดาษ`);
  return { x: s.x + k * setCodeCellW(t) + s.bubble_dx, y: s.bubble_y };
}

/** ตำแหน่ง (คอลัมน์, แถว) ของข้อปรนัยที่ n — เรียงลงทีละคอลัมน์ */
export function on1McqSlot(t: OnetTemplate, n: number) {
  const m = t.mcq;
  if (n < m.first_item || n > m.last_item) throw new Error(`ข้อ ${n} ไม่ใช่ข้อปรนัยของแบบ ON1`);
  const i = n - m.first_item;
  return { col: Math.floor(i / m.rows), row: i % m.rows };
}

/** วงตัวเลือก c (1–4) ของข้อปรนัยที่ n */
export function on1McqCenter(t: OnetTemplate, n: number, c: number): Pt {
  const m = t.mcq;
  if (c < 1 || c > m.choices) throw new Error(`ตัวเลือก ${c} เกิน ${m.choices}`);
  const { col, row } = on1McqSlot(t, n);
  return { x: m.column_x[col] + m.first_bubble_dx + (c - 1) * m.bubble_pitch_x, y: m.first_row_y + row * m.row_pitch_y };
}

/** ตำแหน่งเลขข้อ (ชิดขวา) ของข้อปรนัยที่ n */
export function on1McqNumberPos(t: OnetTemplate, n: number): Pt {
  const m = t.mcq;
  const { col, row } = on1McqSlot(t, n);
  return { x: m.column_x[col] + m.number_dx, y: m.first_row_y + row * m.row_pitch_y };
}

/** บล็อกระบายตัวเลข: 'seat' = เลขที่ 2 หลัก หรือเลขข้อตอนที่ 2 (12–15) */
export type DigitBlockId = 'seat' | number;

export function on1DigitBlock(t: OnetTemplate, id: DigitBlockId) {
  if (id === 'seat') {
    const s = t.seat;
    return { x: s.x, y: s.y, w: s.w, colDx: s.col_dx, labels: s.labels, title: s.title };
  }
  const nm = t.numeric;
  const i = nm.items.indexOf(id);
  if (i < 0) throw new Error(`ข้อ ${id} ไม่ใช่ข้อระบายตัวเลขของแบบ ON1`);
  return { x: nm.block_x[i], y: nm.block_y, w: nm.block_w, colDx: nm.col_dx, labels: nm.labels, title: `ข้อ ${id}` };
}

/** วงตัวเลข d (0–9) ในคอลัมน์ col ของบล็อก (เลขที่: col 0 = หลักสิบ · ตอนที่ 2: col 0 = หลักร้อย) */
export function on1DigitCenter(t: OnetTemplate, id: DigitBlockId, col: number, d: number): Pt {
  const b = on1DigitBlock(t, id);
  if (col < 0 || col >= b.colDx.length) throw new Error(`คอลัมน์ ${col} ไม่มีในบล็อก ${id}`);
  if (d < 0 || d > 9 || !Number.isInteger(d)) throw new Error(`ตัวเลข ${d} ต้องเป็น 0–9`);
  const db = t.digit_block;
  return { x: b.x + b.colDx[col], y: b.y + db.first_bubble_dy + d * db.pitch_y };
}

/** รายการวงกลมทั้งหมดบนแผ่น (ใช้ตรวจว่าไม่ซ้อนกัน และให้ตัวอ่านเฟส 3 วนอ่าน) */
export function on1AllBubbles(t: OnetTemplate): { key: string; p: Pt; r: number }[] {
  const out: { key: string; p: Pt; r: number }[] = [];
  t.set_code.codes.forEach((code, k) => out.push({ key: `set:${code}`, p: on1SetCodeCenter(t, k), r: t.set_code.radius }));
  for (let n = t.mcq.first_item; n <= t.mcq.last_item; n++)
    for (let c = 1; c <= t.mcq.choices; c++) out.push({ key: `q${n}:${c}`, p: on1McqCenter(t, n, c), r: t.mcq.radius });
  const blocks: DigitBlockId[] = ['seat', ...t.numeric.items];
  for (const id of blocks) {
    const cols = on1DigitBlock(t, id).colDx.length;
    for (let col = 0; col < cols; col++)
      for (let d = 0; d <= 9; d++) out.push({ key: `${id === 'seat' ? 'seat' : `q${id}`}:c${col}:${d}`, p: on1DigitCenter(t, id, col, d), r: t.digit_block.radius });
  }
  return out;
}

export interface OnetQrData { setCode: string; template: number }

/** รหัสชุดติว: S01–S99 (ตัวอักษรใหญ่+ตัวเลข → QR โหมด alphanumeric) */
const SET_CODE_RE = /^S\d{2}$/;

/** ข้อความใน QR ของแบบ ON1: `ON1:S01:1` — ไม่มีเลขที่ ไม่มีเฉลย */
export function onetQrPayload(d: OnetQrData): string {
  if (!SET_CODE_RE.test(d.setCode)) throw new Error(`รหัสชุด ${d.setCode} ต้องเป็นรูปแบบ S01`);
  if (!Number.isInteger(d.template) || d.template < 1) throw new Error('รุ่นแบบกระดาษไม่ถูกต้อง');
  return `ON1:${d.setCode}:${d.template}`;
}

export function parseOnetQrPayload(s: string): OnetQrData | null {
  const m = /^ON1:(S\d{2}):(\d+)$/.exec(s.trim());
  return m ? { setCode: m[1], template: Number(m[2]) } : null;
}

/** รหัสชุด S0x → รหัสชุดข้อสอบที่เด็กระบาย (ชุดที่ 1 = 100 … ชุดที่ 6 = 600) */
export function setCodeNumber(setCode: string): number {
  const n = Number(setCode.slice(1));
  return n * 100;
}
