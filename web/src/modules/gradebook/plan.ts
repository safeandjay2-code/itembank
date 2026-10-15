// ตรรกะหน้าตั้งค่าห้อง (One Stop เฟส 2) — ฟังก์ชันบริสุทธิ์ ทดสอบได้โดยไม่ต้องมีหน้าจอ
// อ้างอิง SPEC-OneStop.md §3 (ค่าเริ่มต้น 70-30, ไม่บังคับรวม 100) และ §6.1 (เรียงตามแผนการสอน)
import type { GbAbsentPolicy, GbAggregation, GbColumn, GbRetakePolicy, GbRounding, GbSettings, Settings } from '../../core/types';

/** ค่าเริ่มต้นของระบบ — ตรงกับ app_settings ใน migration 0011 (ฐานข้อมูลจริงอ่านจาก app_settings) */
export const GRADEBOOK_DEFAULT_SETTINGS: Record<string, unknown> = {
  'gradebook.default_indicator_total': 70,
  'gradebook.default_final': 30,
  'gradebook.rounding': 'int',
  'gradebook.aggregation': 'sum',
  'gradebook.retake_policy': 'max',
  'gradebook.absent_policy': 'zero',
  'gradebook.show_other_columns': false,
  'gradebook.max_students': 60,
};

export interface GradebookDefaults {
  indicatorTotal: number;
  finalMax: number;
  maxStudents: number;
  rounding: GbRounding;
  aggregation: GbAggregation;
  retakePolicy: GbRetakePolicy;
  absentPolicy: GbAbsentPolicy;
  showOtherColumns: boolean;
}

export function gradebookDefaults(settings: Settings | null | undefined): GradebookDefaults {
  const g = (k: string) => (settings?.[`gradebook.${k}`] ?? GRADEBOOK_DEFAULT_SETTINGS[`gradebook.${k}`]);
  return {
    indicatorTotal: Number(g('default_indicator_total')),
    finalMax: Number(g('default_final')),
    maxStudents: Number(g('max_students')),
    rounding: g('rounding') as GbRounding,
    aggregation: g('aggregation') as GbAggregation,
    retakePolicy: g('retake_policy') as GbRetakePolicy,
    absentPolicy: g('absent_policy') as GbAbsentPolicy,
    showOtherColumns: Boolean(g('show_other_columns')),
  };
}

/** ค่าที่ใช้จริงของห้อง = ค่าที่ห้องตั้งเอง ถ้าไม่ตั้งใช้ค่าเริ่มต้นของระบบ */
export function effectiveSettings(room: GbSettings, d: GradebookDefaults): Required<GbSettings> {
  return {
    rounding: room.rounding ?? d.rounding,
    aggregation: room.aggregation ?? d.aggregation,
    retake_policy: room.retake_policy ?? d.retakePolicy,
    absent_policy: room.absent_policy ?? d.absentPolicy,
    show_other_columns: room.show_other_columns ?? d.showOtherColumns,
  };
}

/**
 * แบ่งคะแนนรวมให้ n ตัวชี้วัดเป็นจำนวนเต็ม ให้รวมได้เท่าเดิมพอดี — เศษให้ตัวแรก ๆ ก่อน
 * เช่น 70 แบ่ง 8 ตัว → 9,9,9,9,9,9,8,8
 */
export function splitTotal(total: number, n: number): number[] {
  if (n <= 0) return [];
  const t = Math.max(0, Math.round(total));
  const base = Math.floor(t / n), extra = t - base * n;
  return Array.from({ length: n }, (_, k) => base + (k < extra ? 1 : 0));
}

export interface ScoreTotals {
  /** รวมคะแนนเต็มของช่องตัวชี้วัด (+ ช่องอื่นถ้ามี) ที่ตั้งแล้ว */
  collect: number;
  final: number;
  total: number;
  /** จำนวนช่องที่ยังไม่ตั้งคะแนนเต็ม (ไม่รวมปลายภาค) */
  unset: number;
}

export function scoreTotals(columns: Array<Pick<GbColumn, 'kind' | 'maxScore'>>, includeOther = true): ScoreTotals {
  let collect = 0, final = 0, unset = 0;
  for (const c of columns) {
    if (c.kind === 'final') { final += c.maxScore ?? 0; continue; }
    if (c.kind === 'other' && !includeOther) continue;
    if (c.maxScore === null) unset += 1; else collect += c.maxScore;
  }
  const r = (x: number) => Math.round(x * 100) / 100;
  return { collect: r(collect), final: r(final), total: r(collect + final), unset };
}

/** ย้ายสมาชิกตำแหน่ง from ไปตำแหน่ง to (ใช้ทั้งลากวางและปุ่มขึ้น/ลง) */
export function moveItem<T>(list: readonly T[], from: number, to: number): T[] {
  const out = [...list];
  if (from < 0 || from >= out.length || to < 0 || to >= out.length || from === to) return out;
  const [x] = out.splice(from, 1);
  out.splice(to, 0, x);
  return out;
}

/**
 * ปีการศึกษา/ภาคเรียนปัจจุบัน (ไทย): ภาค 1 = พ.ค.–ต.ค. · ภาค 2 = พ.ย.–มี.ค. (ม.ค.–เม.ย. เป็นปีการศึกษาก่อนหน้า)
 * เม.ย. (ปิดเทอมใหญ่) ถือเป็นภาค 2 ของปีที่กำลังจบ
 */
export function currentTerm(date = new Date()): { academicYear: number; term: number } {
  const m = date.getMonth() + 1, be = date.getFullYear() + 543;
  if (m >= 5 && m <= 10) return { academicYear: be, term: 1 };
  if (m >= 11) return { academicYear: be, term: 2 };
  return { academicYear: be - 1, term: 2 };
}

/** ตรวจคะแนนเต็มที่ครูพิมพ์: '' = ยังไม่ตั้ง (null) · ต้องเป็นตัวเลข ≥ 0 ทศนิยมไม่เกิน 2 ตำแหน่ง ไม่เกิน 9999.99 */
export function parseMaxScore(text: string): { ok: true; value: number | null } | { ok: false; error: string } {
  const s = text.trim();
  if (s === '') return { ok: true, value: null };
  if (!/^\d+(\.\d{1,2})?$/.test(s)) return { ok: false, error: 'คะแนนต้องเป็นตัวเลข 0 ขึ้นไป (ทศนิยมไม่เกิน 2 ตำแหน่ง)' };
  const v = Number(s);
  if (v > 9999.99) return { ok: false, error: 'คะแนนเต็มมากเกินไป' };
  return { ok: true, value: v };
}

export const ROUNDING_TH: Record<GbRounding, string> = { int: 'จำนวนเต็ม (ปัดครึ่งขึ้น)', '1dp': 'ทศนิยม 1 ตำแหน่ง' };
export const AGGREGATION_TH: Record<GbAggregation, string> = { sum: 'บวกตรง (คะแนนดิบรวม ÷ เต็มรวม)', mean: 'เฉลี่ยแต่ละครั้งเท่ากัน' };
export const RETAKE_TH: Record<GbRetakePolicy, string> = { max: 'ครั้งที่ได้สูงสุด', latest: 'ครั้งล่าสุด', mean: 'ค่าเฉลี่ยทุกครั้ง', manual: 'ครูเลือกเองรายคน' };
export const ABSENT_TH: Record<GbAbsentPolicy, string> = { zero: 'นับ 0 และขึ้นเตือน "ขาดสอบ"', skip: 'ไม่นับครั้งที่ขาด' };

/** แยกรหัสตัวชี้วัด 'ค 1.1 ป.4/2' → สาระ/มาตรฐาน 'ค 1.1' (แถว 1 ของชีท) + ตัวชี้วัด 'ป.4/2' (แถว 2) */
export function splitIndicatorCode(code: string): { standard: string; indicator: string } {
  const m = /^(.*?)\s+(ป\.\s*\d+\/\d+)\s*$/.exec(code.trim());
  return m ? { standard: m[1].trim(), indicator: m[2].replace(/\s+/g, '') } : { standard: code.trim(), indicator: '' };
}

/** แสดงคะแนน: จำนวนเต็มไม่มีทศนิยม · ไม่ตั้ง = '–' */
export function fmtScore(v: number | null): string {
  if (v === null) return '–';
  return Number.isInteger(v) ? String(v) : String(Math.round(v * 100) / 100);
}
