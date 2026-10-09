// ตรวจคุณภาพข้อสอบอัตโนมัติก่อนเข้าคลัง (SPEC §5.6)
//   ข้อผิดพลาด (errors) = ต้องแก้ก่อน จึงยืนยัน "ตรวจแล้ว" ได้
//   ข้อสังเกต (warnings) = ไม่บังคับ แต่ครูควรดู
import type { ItemAnswer, ItemContent, QaIssue, QaReport } from '../../core/types';
import { evaluate, parseOptionValue, type Rational } from './rational';
import { renderFigure } from './figure/svg';
import { FigureError } from './figure/layout';

export const QA_CHECKER_VERSION = 1;

export interface QaOptions {
  /** จำนวนตัวเลือกของประเภทข้อ (mcq4 = 4) */
  optionCount?: number;
  /** บังคับให้มีนิพจน์คำนวณเฉลย (ตั้งค่า qa.require_answer_check) */
  requireCheck?: boolean;
  noShuffle?: boolean;
  now?: Date;
}

const norm = (s: string) => s.normalize('NFC').replace(/\s+/g, ' ').trim().toLowerCase();

const REFERS_OTHER = /(ถูกทุกข้อ|ผิดทุกข้อ|ถูกทั้งหมด|ไม่มีข้อใดถูก|ข้อ\s*[1-4๑-๔]\s*(และ|หรือ)|ทุกข้อที่กล่าวมา)/;
const MENTIONS_FIGURE = /(ดังรูป|จากรูป|ในรูป|รูปที่กำหนด|แผนภูมิ|กราฟ|ตาราง|เส้นจำนวน)/;

export function runQa(content: ItemContent, answer: ItemAnswer, opts: QaOptions = {}): QaReport {
  const errors: QaIssue[] = [];
  const warnings: QaIssue[] = [];
  const E = (code: string, message: string) => errors.push({ code, message });
  const W = (code: string, message: string) => warnings.push({ code, message });
  const count = opts.optionCount ?? 4;
  const options = Array.isArray(content?.options) ? content.options : [];

  // 1) โครงสร้างพื้นฐาน
  if (!content?.stem?.trim()) E('stem_empty', 'ยังไม่มีโจทย์');
  if (options.length !== count) E('options_count', `ต้องมีตัวเลือก ${count} ตัว (ตอนนี้มี ${options.length})`);
  options.forEach((o, i) => { if (!String(o ?? '').trim()) E('option_empty', `ตัวเลือก ${i + 1} ว่าง`); });
  const choice = answer?.choice;
  const answerOk = Number.isInteger(choice) && choice >= 1 && choice <= count;
  if (!answerOk) E('answer_invalid', 'ยังไม่ได้เลือกเฉลย');

  // 2) ตัวเลือกซ้ำ (ข้อความเดียวกัน หรือค่าตัวเลขเท่ากัน เช่น 0.5 กับ 1/2)
  const values: Array<Rational | null> = options.map((o) => parseOptionValue(String(o ?? '')));
  for (let i = 0; i < options.length; i++) for (let j = i + 1; j < options.length; j++) {
    const a = String(options[i] ?? ''), b = String(options[j] ?? '');
    if (!a.trim() || !b.trim()) continue;
    if (norm(a) === norm(b)) E('option_duplicate', `ตัวเลือก ${i + 1} และ ${j + 1} ซ้ำกัน`);
    else if (values[i] && values[j] && values[i]!.eq(values[j]!))
      E('option_same_value', `ตัวเลือก ${i + 1} และ ${j + 1} มีค่าเท่ากัน (${values[i]!.toString()})`);
  }

  // 3) คำนวณเฉลยซ้ำด้วยโค้ด และต้องมีคำตอบถูกข้อเดียว
  const check = content?.check?.trim();
  if (check) {
    let v: Rational | null = null;
    try { v = evaluate(check); } catch (e) { E('check_error', `นิพจน์คำนวณเฉลยผิด: ${(e as Error).message}`); }
    if (v) {
      const hits = values.map((x, i) => (x && x.eq(v!) ? i + 1 : 0)).filter(Boolean);
      const unreadable = values.map((x, i) => (x ? 0 : i + 1)).filter(Boolean);
      if (hits.length === 0) E('check_no_match', `ผลคำนวณได้ ${v.toString()} ไม่ตรงกับตัวเลือกใดเลย`);
      else if (hits.length > 1) E('check_multi_match', `ผลคำนวณ ${v.toString()} ตรงกับตัวเลือก ${hits.join(', ')} (ถูกได้มากกว่า 1 ข้อ)`);
      else if (answerOk && hits[0] !== choice) E('check_wrong_answer', `เฉลยเป็นตัวเลือก ${choice} แต่ผลคำนวณตรงกับตัวเลือก ${hits[0]}`);
      if (hits.length === 1 && unreadable.length)
        W('check_partial', `ตัวเลือก ${unreadable.join(', ')} อ่านเป็นตัวเลขไม่ได้ จึงตรวจไม่ได้ว่าถูกซ้ำหรือไม่`);
    }
  } else if (opts.requireCheck) {
    E('check_required', 'ต้องใส่นิพจน์คำนวณเฉลย (ตั้งค่าระบบบังคับไว้)');
  } else {
    W('no_check', 'ไม่มีนิพจน์คำนวณเฉลย — ครูต้องตรวจคำตอบเอง');
  }

  // 4) รูปตรงกับตัวเลข
  if (content?.figure) {
    try {
      const r = renderFigure(content.figure);
      if (!r.verify.ok) r.verify.problems.forEach((p) => E('figure_mismatch', `รูปไม่ตรงกับตัวเลข: ${p}`));
    } catch (e) {
      E('figure_invalid', e instanceof FigureError ? `รูป: ${e.message}` : `รูปผิดพลาด: ${(e as Error).message}`);
    }
  } else if (content?.stem && MENTIONS_FIGURE.test(content.stem)) {
    W('figure_missing', 'โจทย์อ้างถึงรูป/แผนภูมิ/ตาราง แต่ยังไม่มีรูป');
  }

  // 5) ความครบของข้อมูลประกอบ
  if (!content?.explanation?.trim()) W('no_explanation', 'ยังไม่มีวิธีคิด/คำอธิบายเฉลย');
  if (answerOk) {
    const missing = options.map((_, i) => i + 1)
      .filter((k) => k !== choice && !String(content?.distractor_rationale?.[k - 1] ?? '').trim());
    if (missing.length) W('no_rationale', `ตัวลวงที่ยังไม่มีเหตุผล: ตัวเลือก ${missing.join(', ')}`);
  }
  if (!opts.noShuffle && options.some((o) => REFERS_OTHER.test(String(o ?? ''))))
    W('needs_no_shuffle', 'มีตัวเลือกที่อ้างถึงตัวเลือกอื่น ควรติ๊ก "ห้ามสลับตัวเลือก"');

  return {
    passed: errors.length === 0, errors, warnings,
    checkedAt: (opts.now ?? new Date()).toISOString(), checker: QA_CHECKER_VERSION,
  };
}
