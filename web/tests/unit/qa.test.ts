import { describe, it, expect } from 'vitest';
import { evaluate, parseOptionValue, Rational } from '../../src/modules/bank/rational';
import { runQa } from '../../src/modules/bank/qa';
import { classifyEdit, digitSignature, statusAfterSave, statusChangeBlocked, stableJson, emptyContent } from '../../src/modules/bank/rules';
import type { ItemContent } from '../../src/core/types';

describe('เลขเศษส่วนแม่นยำ', () => {
  it('ไม่มีทศนิยมคลาดเคลื่อน', () => {
    expect(evaluate('0.1 + 0.2').eq(Rational.of('0.3'))).toBe(true);
    expect(evaluate('3/4 + 1/8').toString()).toBe('0.875');
    expect(evaluate('1/3 + 1/3').toString()).toBe('2/3');
  });
  it('ลำดับการคำนวณ วงเล็บ เครื่องหมาย × ÷ ยกกำลัง ร้อยละ หลักพัน', () => {
    expect(evaluate('2 + 3 × 4').toString()).toBe('14');
    expect(evaluate('(2 + 3) × 4').toString()).toBe('20');
    expect(evaluate('48 ÷ 6 ÷ 2').toString()).toBe('4');
    expect(evaluate('2^3 + -1').toString()).toBe('7');
    expect(evaluate('25% × 1,200').toString()).toBe('300');
    expect(evaluate('-(3 - 5)').toString()).toBe('2');
  });
  it('นิพจน์ผิดแจ้งเตือน', () => {
    expect(() => evaluate('2 +')).toThrow();
    expect(() => evaluate('(1 + 2')).toThrow(/วงเล็บ/);
    expect(() => evaluate('1 / 0')).toThrow(/ศูนย์/);
    expect(() => evaluate('alert(1)')).toThrow(/อักขระ/);
  });
  it('อ่านค่าจากตัวเลือก', () => {
    expect(parseOptionValue('3/4')!.toString()).toBe('0.75');
    expect(parseOptionValue('2 1/4')!.toString()).toBe('2.25');
    expect(parseOptionValue('1,250 บาท')!.toString()).toBe('1250');
    expect(parseOptionValue('25%')!.toString()).toBe('0.25');
    expect(parseOptionValue('−3 องศา')!.toString()).toBe('-3');
    expect(parseOptionValue('48 ตารางเซนติเมตร')!.toString()).toBe('48');
    expect(parseOptionValue('สามเหลี่ยมมุมฉาก')).toBeNull();
    expect(parseOptionValue('3 และ 5')).toBeNull();
  });
});

const base = (over: Partial<ItemContent> = {}): ItemContent => ({
  stem: 'ผลบวกของ 3/4 กับ 1/8 เท่ากับเท่าใด',
  options: ['7/8', '4/12', '1 1/8', '5/8'],
  figure: null,
  explanation: 'ทำส่วนให้เท่ากัน 6/8 + 1/8 = 7/8',
  distractor_rationale: [null, 'บวกเศษกับเศษ ส่วนกับส่วน', 'บวกเกิน', 'ลบแทนบวก'],
  check: '3/4 + 1/8',
  ...over,
});

describe('ตรวจคุณภาพอัตโนมัติ (SPEC §5.6)', () => {
  it('ข้อสมบูรณ์ผ่าน ไม่มีข้อสังเกต', () => {
    const r = runQa(base(), { choice: 1 });
    expect(r.errors).toEqual([]);
    expect(r.warnings).toEqual([]);
    expect(r.passed).toBe(true);
  });
  it('เฉลยไม่ตรงผลคำนวณ', () => {
    const r = runQa(base(), { choice: 3 });
    expect(r.passed).toBe(false);
    expect(r.errors.map((e) => e.code)).toContain('check_wrong_answer');
  });
  it('ผลคำนวณไม่ตรงตัวเลือกใด', () => {
    expect(runQa(base({ check: '3/4 + 1/4' }), { choice: 1 }).errors.map((e) => e.code)).toContain('check_no_match');
  });
  it('ถูกได้มากกว่า 1 ข้อ (ค่าเท่ากันต่างรูปแบบ)', () => {
    const r = runQa(base({ options: ['7/8', '0.875', '1 1/8', '5/8'] }), { choice: 1 });
    const codes = r.errors.map((e) => e.code);
    expect(codes).toContain('check_multi_match');
    expect(codes).toContain('option_same_value');
  });
  it('ตัวเลือกซ้ำ / ว่าง / ไม่ครบ / ไม่มีโจทย์ / ไม่มีเฉลย', () => {
    expect(runQa(base({ options: ['ก', 'ก ', 'ข', 'ค'], check: null }), { choice: 1 }).errors.map((e) => e.code)).toContain('option_duplicate');
    expect(runQa(base({ options: ['1', '', '3', '4'], check: null }), { choice: 1 }).errors.map((e) => e.code)).toContain('option_empty');
    expect(runQa(base({ options: ['1', '2', '3'], check: null }), { choice: 1 }).errors.map((e) => e.code)).toContain('options_count');
    expect(runQa(base({ stem: '  ' }), { choice: 1 }).errors.map((e) => e.code)).toContain('stem_empty');
    expect(runQa(base(), { choice: 0 }).errors.map((e) => e.code)).toContain('answer_invalid');
  });
  it('ไม่มีนิพจน์ = ข้อสังเกต; ถ้าตั้งค่าบังคับ = ข้อผิดพลาด', () => {
    const c = base({ check: null });
    expect(runQa(c, { choice: 1 }).passed).toBe(true);
    expect(runQa(c, { choice: 1 }).warnings.map((w) => w.code)).toContain('no_check');
    expect(runQa(c, { choice: 1 }, { requireCheck: true }).errors.map((e) => e.code)).toContain('check_required');
  });
  it('นิพจน์เขียนผิด', () => {
    expect(runQa(base({ check: '3/4 +' }), { choice: 1 }).errors.map((e) => e.code)).toContain('check_error');
  });
  it('รูปผิด (สร้างไม่ได้) เป็นข้อผิดพลาด, รูปถูกผ่าน', () => {
    const bad = runQa(base({ figure: { kind: 'triangle', mode: 'SSS', ab: 1, bc: 2, ca: 5 } }), { choice: 1 });
    expect(bad.errors.map((e) => e.code)).toContain('figure_invalid');
    const ok = runQa(base({ figure: { kind: 'rectangle', w: 4, h: 3 } }), { choice: 1 });
    expect(ok.passed).toBe(true);
  });
  it('ข้อสังเกต: อ้างรูปแต่ไม่มีรูป, ไม่มีวิธีคิด, ตัวลวงไม่มีเหตุผล, ตัวเลือกอ้างตัวเลือกอื่น', () => {
    const r = runQa(base({ stem: 'จากรูป พื้นที่เท่าใด', explanation: '', distractor_rationale: [null, null, 'x', 'y'],
      options: ['7/8', 'ถูกทุกข้อ', '1 1/8', '5/8'] }), { choice: 1 });
    const codes = r.warnings.map((w) => w.code);
    expect(codes).toEqual(expect.arrayContaining(['figure_missing', 'no_explanation', 'no_rationale', 'needs_no_shuffle']));
    expect(runQa(base({ options: ['7/8', 'ถูกทุกข้อ', '1 1/8', '5/8'] }), { choice: 1 }, { noShuffle: true })
      .warnings.map((w) => w.code)).not.toContain('needs_no_shuffle');
  });
});

describe('กฎเวอร์ชัน (SPEC §5.4)', () => {
  const a = base();
  it('แก้คำผิดในโจทย์/วิธีคิด = เวอร์ชันเดิมได้', () => {
    const e = classifyEdit(a, { choice: 1 }, { ...a, stem: 'ผลบวกของ 3/4 และ 1/8 มีค่าเท่าใด', explanation: 'แก้คำอธิบาย' }, { choice: 1 });
    expect(e.changed).toBe(true);
    expect(e.minorAllowed).toBe(true);
    expect(e.suggestMajor).toBe(false);
  });
  it('เปลี่ยนตัวเลข/เฉลย/รูป/จำนวนตัวเลือก = ต้องขึ้นเวอร์ชันใหม่', () => {
    expect(classifyEdit(a, { choice: 1 }, { ...a, stem: 'ผลบวกของ 3/4 กับ 1/6' }, { choice: 1 }).minorAllowed).toBe(false);
    expect(classifyEdit(a, { choice: 1 }, a, { choice: 2 }).majorReasons).toContain('เปลี่ยนเฉลย');
    expect(classifyEdit(a, { choice: 1 }, { ...a, options: ['7/8', '4/12', '1 1/8', '3/8'] }, { choice: 1 }).majorReasons)
      .toContain('ตัวเลขในตัวเลือก 4 เปลี่ยน');
    expect(classifyEdit(a, { choice: 1 }, { ...a, figure: { kind: 'square', s: 2 } }, { choice: 1 }).majorReasons).toContain('รูปเปลี่ยน');
  });
  it('แก้ข้อความตัวเลือก (ไม่มีตัวเลข) = ทำได้ทั้งสองแบบ แต่แนะนำเวอร์ชันใหม่', () => {
    const c = { ...emptyContent(), stem: 'ข้อใดถูก', options: ['สามเหลี่ยม', 'วงกลม', 'สี่เหลี่ยม', 'ห้าเหลี่ยม'] };
    const e = classifyEdit(c, { choice: 1 }, { ...c, options: ['สามเหลี่ยม', 'วงรี', 'สี่เหลี่ยม', 'ห้าเหลี่ยม'] }, { choice: 1 });
    expect(e.minorAllowed).toBe(true);
    expect(e.suggestMajor).toBe(true);
  });
  it('ไม่ได้แก้อะไร', () => {
    expect(classifyEdit(a, { choice: 1 }, structuredClone(a), { choice: 1 }).changed).toBe(false);
  });
  it('ลายเซ็นตัวเลขแยกจำนวนกัน', () => {
    expect(digitSignature('12 3')).not.toBe(digitSignature('1 23'));
    expect(digitSignature('1,250.5 บาท')).toBe('1,250.5');
  });
  it('JSON เรียงคีย์ เทียบรูปได้ไม่ขึ้นกับลำดับคีย์', () => {
    expect(stableJson({ b: 1, a: { d: 2, c: 3 } })).toBe(stableJson({ a: { c: 3, d: 2 }, b: 1 }));
  });
});

describe('กฎสถานะ', () => {
  it('ข้อใหม่และเวอร์ชันใหม่เริ่มเป็นร่าง', () => {
    expect(statusAfterSave(null, 'new', true)).toBe('draft');
    expect(statusAfterSave('active', 'major', true)).toBe('draft');
  });
  it('แก้คำผิดแล้วไม่ผ่านการตรวจ → ต้องแก้', () => {
    expect(statusAfterSave('reviewed', 'minor', false)).toBe('needs_fix');
    expect(statusAfterSave('reviewed', 'minor', true)).toBe('reviewed');
    expect(statusAfterSave('draft', 'minor', false)).toBe('draft');
  });
  it('ยืนยันตรวจแล้วได้เมื่อผ่านการตรวจอัตโนมัติเท่านั้น', () => {
    expect(statusChangeBlocked('reviewed', false)).not.toBeNull();
    expect(statusChangeBlocked('reviewed', null)).not.toBeNull();
    expect(statusChangeBlocked('reviewed', true)).toBeNull();
    expect(statusChangeBlocked('retired', false)).toBeNull();
  });
});
