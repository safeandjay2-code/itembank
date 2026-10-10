// เฟส 5: กฎการให้คะแนน SPEC §8.3 + ตรวจจับแจกผิดชุด
import { describe, expect, test } from 'vitest';
import { DEFAULT_SCAN, detectWrongSet, interpret, score, scanConfigFromSettings, type Answer } from '../../../src/modules/scan/grade';
import { makeRng } from '../../../src/modules/assembly/rng';

// ความเข้มตัวอย่าง: วงว่าง ~0.05 (ตัวเลขเทาในวง), ฝนชัด 0.7, จาง 0.25
const E = 0.05;
const row = (...v: number[]) => v;

describe('ตีความรอยฝน (§8.3)', () => {
  const sheet = [
    row(0.72, E, E, E),       // 1 ฝนชัด → 1
    row(E, E, E, E),          // 2 ไม่ฝน → null
    row(E, 0.7, 0.68, E),     // 3 ฝน 2 ช่อง → multi
    row(E, E, 0.27, E),       // 4 จาง → 3 + remark
    row(0.8, 0.2, E, E),      // 5 ฝนชัด + ลบไม่สะอาด → 1 + remark
    row(0.9, E, 0.4, E),      // 6 ฝน 2 ช่องแต่ต่างกันมาก → 1 + remark (น่าจะลบไม่สะอาด)
    row(E, E, E, 0.55),       // 7 → 4
    row(0.7, 0.7, 0.7, 0.7),  // 8 ฝนทุกช่อง → multi
  ];
  const it = interpret(sheet, sheet.length);
  test('คำตอบ', () => expect(it.answers).toEqual([1, null, 'multi', 3, 1, 1, 4, 'multi']));
  test('ข้อกำกวมขึ้น remark เท่านั้น', () => expect(it.ambiguous).toEqual([4, 5, 6]));
  test('ระดับพื้นหลังมาจากวงว่าง', () => expect(it.baseline).toBeCloseTo(E, 2));
  test('อ่านเฉพาะข้อ 1..จำนวนข้อ', () => expect(interpret(sheet, 3).answers).toEqual([1, null, 'multi']));
  test('ฝน 2 ช่อง/ไม่ฝน = 0 คะแนน', () => {
    expect(score([null, 'multi', 2], [1, 2, 2])).toBe(1);
    expect(score(it.answers, [1, 1, 2, 3, 1, 1, 4, 1])).toBe(5);
  });
  test('ค่าเกณฑ์อ่านจากตารางตั้งค่าได้', () => {
    const c = scanConfigFromSettings({ 'scan.fill_threshold': 0.5, 'scan.wrong_set_min_items': 5 });
    expect(c.fill).toBe(0.5);
    expect(c.wrongSetMinItems).toBe(5);
    expect(c.blank).toBe(DEFAULT_SCAN.blank);
  });
});

describe('ตรวจจับแจกผิดชุด', () => {
  // ชุด 1 กับชุด 2 เฉลยต่างกัน (ข้อสลับกันในกลุ่ม/ตัวเลือกสลับ)
  const k1 = [1, 2, 3, 4, 1, 2, 3, 4, 1, 2, 3, 4, 1, 2, 3, 4, 1, 2, 3, 4];
  const k2 = [3, 4, 1, 2, 2, 1, 4, 3, 4, 3, 2, 1, 3, 4, 1, 2, 2, 1, 4, 3];
  const keys = { 1: k1, 2: k2 };

  test('นักเรียนเก่งที่ได้ชุด 2 แต่กระดาษคำตอบเป็นชุด 1 → แจ้งครู', () => {
    const ans: Answer[] = k2.map((k, i) => (i < 17 ? k : ((k % 4) + 1) as Answer));
    expect(score(ans, k1)).toBeLessThan(8);
    expect(detectWrongSet(ans, keys, 1)).toEqual({ suggestedSet: 2, scoreAlt: 17 });
  });
  test('ทำถูกตามชุดตัวเอง → ไม่แจ้ง', () => {
    expect(detectWrongSet(k1 as Answer[], keys, 1)).toBeNull();
  });
  test('ชุดเดียว หรือข้อน้อยกว่าเกณฑ์ → ไม่ตรวจ', () => {
    expect(detectWrongSet(k2 as Answer[], { 1: k1 }, 1)).toBeNull();
    expect(detectWrongSet(k2.slice(0, 5) as Answer[], { 1: k1.slice(0, 5), 2: k2.slice(0, 5) }, 1)).toBeNull();
  });
  test('เด็กเดาสุ่ม 2,000 คน แจ้งผิดพลาดน้อยกว่า 1%', () => {
    const rnd = makeRng(9);
    let flagged = 0;
    for (let s = 0; s < 2000; s++) {
      const n = 10 + Math.floor(rnd() * 36);
      const ks: Record<number, number[]> = {};
      for (let set = 1; set <= 4; set++) ks[set] = Array.from({ length: n }, () => 1 + Math.floor(rnd() * 4));
      const ans = Array.from({ length: n }, () => (1 + Math.floor(rnd() * 4)) as Answer);
      if (detectWrongSet(ans, ks, 1)) flagged++;
    }
    expect(flagged / 2000).toBeLessThan(0.01);
  });
});
