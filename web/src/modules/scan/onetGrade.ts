// ตีความรอยฝนกระดาษคำตอบ O-NET (ON1) — SPEC-ONET §6
//   ปรนัย 11 ข้อ: กฎเดียวกับระบบหลัก (grade.ts) · ฝนหลายช่อง/ไม่ฝน = ไม่มีคำตอบ · จาง/ลบไม่สะอาด = ใช้ช่องเข้มสุด + remark
//   ระบายตัวเลข 3 หลัก (ข้อ 12–15): ทุกคอลัมน์ต้องฝน 1 วง · คอลัมน์ว่าง/ฝนเกิน = ไม่มีคำตอบ (ผิด) + remark ให้ครูดู
//   เลขที่ 2 หลัก: อ่านไม่ได้/ฝนเกิน/จาง → ต้องให้ครูพิมพ์หรือยืนยัน (ไม่บันทึกเงียบ) · 00 ไม่ใช่เลขที่
//   รหัสชุด 100–600: ระบบเชื่อ QR · ระบายไม่ตรง/ไม่ระบาย → เตือนอย่างเดียว ไม่หักคะแนน
// เกณฑ์ "ฝนแล้ว" ปรับตามความเข้มรอยฝนของแผ่นนั้นทั้งแผ่น (ทุกส่วนรวมกัน) แบบเดียวกับ grade.interpret
// คำตอบส่งให้ RPC onet_submit เป็นข้อความ: "1"–"4" (ปรนัย) · "034" (ตัวเลข) · null = ไม่มีคำตอบ — ตรวจคะแนนบนเซิร์ฟเวอร์
import { DEFAULT_SCAN, type ItemCall, type ScanConfig } from './grade';
import { on1DigitBlock, setCodeNumber, type DigitBlockId, type OnetTemplate } from '../print/onetTemplate';

export type OnetRemarkCode =
  | 'faint' | 'residue' | 'multi'                       // ปรนัย
  | 'digit_blank' | 'digit_multi' | 'digit_faint'        // ระบายตัวเลข (ระบุคอลัมน์)
  | 'seat_unreadable' | 'seat_confirm' | 'seat_zero'      // เลขที่
  | 'set_not_bubbled' | 'set_multi' | 'set_mismatch';    // รหัสชุด

export interface OnetRemark {
  code: OnetRemarkCode;
  /** ข้อที่ (1–15) · ไม่มี = เรื่องของทั้งแผ่น (เลขที่/รหัสชุด) */
  item?: number;
  /** คอลัมน์หลัก (ตอนที่ 2: 0 = หลักร้อย · เลขที่: 0 = หลักสิบ) */
  col?: number;
  message: string;
}

export interface OnetItemReading {
  item: number;
  kind: 'mcq4' | 'numeric3';
  /** คำตอบที่ส่งตรวจ — null = ไม่มีคำตอบ (ไม่ฝน/ฝนหลายช่อง/ระบายไม่ครบ) */
  answer: string | null;
  /** ผลรายคอลัมน์ (ปรนัย 1 ค่า · ตัวเลข 3 ค่า) */
  calls: ItemCall[];
  /** กำกวม — ครูควรดู (ใช้ค่าที่อ่านได้ดีที่สุดไปก่อน) */
  ambiguous: boolean;
}

export type SeatStatus = 'ok' | 'confirm' | 'missing';

export interface OnetInterpretation {
  seat: {
    /** เลขที่ที่ใช้บันทึกได้ทันที (เฉพาะ status = ok) */
    value: number | null;
    /** ok = อ่านชัด · confirm = อ่านได้แต่ไม่ชัด ครูต้องยืนยัน · missing = อ่านไม่ได้ ครูต้องพิมพ์ */
    status: SeatStatus;
    /** ค่าที่ระบบเดาให้ครูดู (confirm/missing) */
    suggested: number | null;
    /** เลขรายหลัก (null = อ่านไม่ได้) */
    digits: Array<number | null>;
    calls: ItemCall[];
  };
  items: OnetItemReading[];
  /** คำตอบ 15 ข้อเรียงตามข้อ สำหรับ onet_submit */
  answers: Array<string | null>;
  /** ข้อที่กำกวม (ครูควรตรวจ) */
  ambiguous: number[];
  /** รหัสชุดที่เด็กระบาย ("100"…"600") · null = ไม่ระบาย/ระบายหลายช่อง */
  bubbledSet: string | null;
  setMismatch: boolean;
  remarks: OnetRemark[];
  calibration: { baseline: number; markLevel: number; threshold: number };
}

interface Row { values: number[]; labels: number[] }
interface RowCall { call: ItemCall; value: number | null }

/** ตีความ 1 แถว (วงที่เลือกได้ 1 วง) ด้วยเกณฑ์ของแผ่น — กฎเดียวกับ grade.interpret */
function callRow(adj: number[], labels: number[], T: number, cfg: ScanConfig): RowCall {
  const order = adj.map((v, i) => ({ v, label: labels[i] })).sort((a, b) => b.v - a.v);
  const top = order[0], second = order[1];
  if (top.v < T) return { call: 'blank', value: null };
  if (second.v >= T && second.v >= cfg.multiRatio * top.v) return { call: 'multi', value: null };
  if (second.v >= T && second.v >= cfg.residueRatio * top.v) return { call: 'residue', value: top.label };
  if (top.v < cfg.faintBand * T) return { call: 'faint', value: top.label };
  return { call: 'clean', value: top.label };
}

const DIGITS = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9];
const COL_TH = ['หลักร้อย', 'หลักสิบ', 'หลักหน่วย'];
const SEAT_COL_TH = ['หลักสิบ', 'หลักหน่วย'];

function digitRows(t: OnetTemplate, d: Record<string, number>, id: DigitBlockId): Row[] {
  const prefix = id === 'seat' ? 'seat' : `q${id}`;
  const cols = on1DigitBlock(t, id).colDx.length;
  return Array.from({ length: cols }, (_, col) => ({ values: DIGITS.map((n) => d[`${prefix}:c${col}:${n}`] ?? 0), labels: DIGITS }));
}

/** ตีความผลอ่านกระดาษ ON1 · setCode = รหัสชุดจาก QR (S01…) */
export function interpretOnet(t: OnetTemplate, darkness: Record<string, number>, setCode: string, cfg: ScanConfig = DEFAULT_SCAN): OnetInterpretation {
  const mcqRows: Row[] = [];
  for (let n = t.mcq.first_item; n <= t.mcq.last_item; n++)
    mcqRows.push({ values: Array.from({ length: t.mcq.choices }, (_, c) => darkness[`q${n}:${c + 1}`] ?? 0), labels: [1, 2, 3, 4].slice(0, t.mcq.choices) });
  const seatRows = digitRows(t, darkness, 'seat');
  const numRows = t.numeric.items.map((n) => digitRows(t, darkness, n));
  const setRow: Row = { values: t.set_code.codes.map((c) => darkness[`set:${c}`] ?? 0), labels: t.set_code.codes };

  const all: Row[] = [...mcqRows, ...seatRows, ...numRows.flat(), setRow];
  // พื้นหลัง: วงส่วนใหญ่ว่าง (ปรนัย 3/4 · ตัวเลข 9/10) → เปอร์เซ็นไทล์ล่างคือระดับวงว่าง
  const vals = all.flatMap((r) => r.values).sort((a, b) => a - b);
  const baseline = vals.length ? Math.min(0.25, vals[Math.floor(vals.length * 0.35)]) : 0;
  const maxima = all.map((r) => Math.max(...r.values) - baseline).filter((m) => m >= 2 * cfg.markFloor).sort((a, b) => a - b);
  const markLevel = maxima.length ? maxima[Math.floor((maxima.length - 1) / 2)] : 0.3;
  const T = Math.max(cfg.markFloor, cfg.markRatio * markLevel);
  const call = (r: Row) => callRow(r.values.map((v) => v - baseline), r.labels, T, cfg);

  const remarks: OnetRemark[] = [];
  const items: OnetItemReading[] = [];

  // ตอนที่ 1 ปรนัย
  mcqRows.forEach((r, i) => {
    const item = t.mcq.first_item + i;
    const c = call(r);
    const ambiguous = c.call === 'faint' || c.call === 'residue';
    if (c.call === 'multi') remarks.push({ code: 'multi', item, message: `ข้อ ${item}: ฝนหลายช่อง (ไม่ได้คะแนน)` });
    if (c.call === 'faint') remarks.push({ code: 'faint', item, message: `ข้อ ${item}: รอยฝนจาง อ่านได้ ${c.value} — ครูควรตรวจ` });
    if (c.call === 'residue') remarks.push({ code: 'residue', item, message: `ข้อ ${item}: ลบไม่สะอาด อ่านได้ ${c.value} — ครูควรตรวจ` });
    items.push({ item, kind: 'mcq4', answer: c.value === null ? null : String(c.value), calls: [c.call], ambiguous });
  });

  // ตอนที่ 2 ระบายตัวเลข 3 หลัก
  numRows.forEach((rows, k) => {
    const item = t.numeric.items[k];
    const cs = rows.map(call);
    const allBlank = cs.every((c) => c.call === 'blank');
    let ambiguous = false;
    if (!allBlank) cs.forEach((c, col) => {
      if (c.call === 'blank') remarks.push({ code: 'digit_blank', item, col, message: `ข้อ ${item}: ${COL_TH[col]}ไม่ได้ระบาย (ไม่ได้คะแนน — คำตอบไม่ถึง 3 หลักต้องระบาย 0 ข้างหน้า)` });
      if (c.call === 'multi') remarks.push({ code: 'digit_multi', item, col, message: `ข้อ ${item}: ${COL_TH[col]}ระบายเกิน 1 วง (ไม่ได้คะแนน)` });
      if (c.call === 'faint' || c.call === 'residue') {
        ambiguous = true;
        remarks.push({ code: 'digit_faint', item, col, message: `ข้อ ${item}: ${COL_TH[col]}${c.call === 'faint' ? 'รอยฝนจาง' : 'ลบไม่สะอาด'} อ่านได้ ${c.value} — ครูควรตรวจ` });
      }
    });
    const complete = cs.every((c) => c.value !== null);
    items.push({ item, kind: 'numeric3', answer: complete ? cs.map((c) => c.value).join('') : null, calls: cs.map((c) => c.call), ambiguous });
  });

  // เลขที่
  const seatCalls = seatRows.map(call);
  const digits = seatCalls.map((c) => c.value);
  const seatAmb = seatCalls.some((c) => c.call === 'faint' || c.call === 'residue');
  const seatComplete = digits.every((d) => d !== null);
  const seatNum = seatComplete ? digits[0]! * 10 + digits[1]! : null;
  let seatStatus: SeatStatus;
  let suggested: number | null = null;
  if (!seatComplete) {
    seatStatus = 'missing';
    // เดาให้ครูดู: ระบายเฉพาะหลักหน่วย (ลืมระบาย 0 หลักสิบ)
    if (seatCalls[0].call === 'blank' && digits[1] !== null && digits[1] !== 0) suggested = digits[1];
    const why = seatCalls.map((c, i) => c.call === 'blank' ? `${SEAT_COL_TH[i]}ไม่ได้ระบาย` : c.call === 'multi' ? `${SEAT_COL_TH[i]}ระบายเกิน 1 วง` : '').filter(Boolean).join(', ');
    remarks.push({ code: 'seat_unreadable', message: `อ่านเลขที่ไม่ได้ (${why}) — ครูต้องพิมพ์เลขที่` });
  } else if (seatNum === 0) {
    seatStatus = 'missing';
    remarks.push({ code: 'seat_zero', message: 'ระบายเลขที่ 00 — ครูต้องพิมพ์เลขที่' });
  } else if (seatAmb) {
    seatStatus = 'confirm';
    suggested = seatNum;
    remarks.push({ code: 'seat_confirm', message: `เลขที่ระบายไม่ชัด อ่านได้ ${seatNum} — ครูต้องยืนยัน` });
  } else seatStatus = 'ok';

  // รหัสชุด (เตือนอย่างเดียว)
  const sc = call(setRow);
  const expected = String(setCodeNumber(setCode));
  const bubbledSet = sc.call === 'multi' || sc.value === null ? null : String(sc.value);
  if (sc.call === 'blank') remarks.push({ code: 'set_not_bubbled', message: `ไม่ได้ระบายรหัสชุดข้อสอบ (ชุดนี้คือ ${expected})` });
  else if (sc.call === 'multi') remarks.push({ code: 'set_multi', message: `ระบายรหัสชุดข้อสอบเกิน 1 ช่อง (ชุดนี้คือ ${expected})` });
  else if (bubbledSet !== expected) remarks.push({ code: 'set_mismatch', message: `ระบายรหัสชุดผิด: ระบาย ${bubbledSet} แต่ชุดนี้คือ ${expected}` });
  const setMismatch = bubbledSet !== expected;

  items.sort((a, b) => a.item - b.item);
  return {
    seat: { value: seatStatus === 'ok' ? seatNum : null, status: seatStatus, suggested, digits, calls: seatCalls.map((c) => c.call) },
    items,
    answers: items.map((i) => i.answer),
    ambiguous: items.filter((i) => i.ambiguous).map((i) => i.item),
    bubbledSet,
    setMismatch,
    remarks,
    calibration: { baseline, markLevel, threshold: T },
  };
}

