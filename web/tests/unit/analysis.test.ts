// ทดสอบเฟส 6: การวิเคราะห์ผลสอบ (SPEC §9) — ค่าที่คาดไว้คำนวณด้วยมือล่วงหน้า ไม่ได้มาจากโปรแกรม
//
// กรณีคำนวณมือ (knownCase): คำตอบตัวเลือกต้นฉบับ  เฉลย 1,2,3,4,1  (b = ไม่ฝน, m = ฝนหลายช่อง)
//   เลขที่  ข้อ1 ข้อ2 ข้อ3 ข้อ4 ข้อ5 | คะแนน
//     1      1    2    3    4    2  |  4
//     2      1    2    3    4    2  |  4
//     3      1    2    3    1    2  |  3
//     4      1    2    4    2    2  |  2
//     5      1    3    3    b    2  |  2
//     6      1    3    1    m    2  |  1
//     7      2    2    1    1    2  |  1
//     8      1    3    1    1    1  |  2
//     9      2    3    2    1    1  |  1
//    10      3    1    1    2    1  |  1
//   n = 10, g = ปัด(0.27×10) = 3
//   เรียงคะแนน (เท่ากันเลขที่น้อยก่อน): 1,2,3,4,5,8,6,7,9,10 → กลุ่มสูง {1,2,3} กลุ่มต่ำ {7,9,10}
//   ข้อ1 ถูก 7 → p .700  สูง 3 ต่ำ 0 → r 1.000
//   ข้อ2 ถูก 5 → p .500  สูง 3 ต่ำ 1 (เลขที่ 7) → r .667
//   ข้อ3 ถูก 4 → p .400  สูง 3 ต่ำ 0 → r 1.000  ตัวลวง 1) มีคนเลือก 4 = 40% → เด็กหลงมาก
//   ข้อ4 ถูก 2 → p .200  สูง 2 ต่ำ 0 → r .667   ตัวลวง 1) 4 คน > ตอบถูก · ตัวลวง 3) 0 คน → ไม่มีใครเลือก
//   ข้อ5 ถูก 3 → p .300  สูง 0 ต่ำ 2 (เลขที่ 9,10) → r −.667
//   ตัวชี้วัด A (ข้อ 1–2) ผ่าน = ถูก ≥ 1: เลขที่ 1–8 → 8/10 · ตัวชี้วัด B (ข้อ 3–5) ผ่าน = ถูก ≥ 1.5: เลขที่ 1,2 → 2/10 (อ่อน)
//   คะแนน 4,4,3,2,2,1,1,2,1,1 → เฉลี่ย 2.10 · มัธยฐาน 2 · S.D. (n−1) = √(12.9/9) = 1.20 · ต่ำสุด 1 สูงสุด 4
import { describe, expect, it } from 'vitest';
import { analyze, analysisConfigFromSettings, DEFAULT_ANALYSIS, difficultyOfP, groupSize, rLabel, toOriginal } from '../../src/modules/analysis/analyze';
import levels from '../../../data/levels.json';
import { knownCase, randomCase, RANDOM_SPECS, toExam, toResponses } from './analysisCases';

const diffs = levels.difficulty.map((d) => ({ id: d.id, key: d.key, nameTh: d.name_th, pLower: d.p_lower, pUpper: d.p_upper }));

describe('วิเคราะห์ผล: กรณีคำนวณมือ', () => {
  const c = knownCase();
  const a = analyze(toExam(c), toResponses(c));

  it('คะแนนรายเลขที่ (แปลงจากชุดที่สลับข้อ/ตัวเลือกกลับเป็นตัวเลือกต้นฉบับถูกต้อง)', () => {
    expect(a.students.map((s) => [s.seatNo, s.setNo, s.score])).toEqual([
      [1, 1, 4], [2, 2, 4], [3, 1, 3], [4, 2, 2], [5, 1, 2], [6, 2, 1], [7, 1, 1], [8, 2, 2], [9, 1, 1], [10, 2, 1]]);
    // คะแนนที่คำนวณได้ต้องตรงกับคะแนนที่ฐานข้อมูลคำนวณจากเฉลยของชุด
    expect(a.students.map((s) => s.score)).toEqual(toResponses(c).map((r) => r.score));
    expect(a.students[3].percent).toBe(40);
  });

  it('p และ r (เทคนิค 27%) ตรงกับที่คำนวณมือ', () => {
    expect(a.items.map((i) => i.nCorrect)).toEqual([7, 5, 4, 2, 3]);
    expect(a.items.map((i) => i.p)).toEqual([0.7, 0.5, 0.4, 0.2, 0.3]);
    expect(a.items.map((i) => i.groupSize)).toEqual([3, 3, 3, 3, 3]);
    expect(a.items.map((i) => [i.upperCorrect, i.lowerCorrect])).toEqual([[3, 0], [3, 1], [3, 0], [2, 0], [0, 2]]);
    expect(a.items.map((i) => i.r)).toEqual([1, 0.667, 1, 0.667, -0.667]);
  });

  it('สัดส่วนการเลือกแต่ละตัวเลือก (ไม่ฝน/ฝนหลายช่องแยกนับ)', () => {
    expect(a.items[0].counts).toEqual({ 1: 7, 2: 2, 3: 1, 4: 0, blank: 0, multi: 0 });
    expect(a.items[3].counts).toEqual({ 1: 4, 2: 2, 3: 0, 4: 2, blank: 1, multi: 1 });
    expect(a.items[4].counts).toEqual({ 1: 3, 2: 7, 3: 0, 4: 0, blank: 0, multi: 0 });
  });

  it('ตัวลวงที่เด็กหลงมาก + เหตุผลจากคลัง · ตัวลวงที่ไม่มีใครเลือก', () => {
    const d3 = a.items[2].distractors.find((d) => d.option === 1)!;
    expect(d3).toMatchObject({ count: 4, ratio: 0.4, strong: true, rationale: 'บวกเศษกับเศษ ส่วนกับส่วน' });
    const d4 = a.items[3].distractors;
    expect(d4.find((d) => d.option === 1)).toMatchObject({ count: 4, strong: true, rationale: 'สับสนหน่วย' });
    expect(d4.find((d) => d.option === 3)).toMatchObject({ count: 0, dead: true, strong: false });
    expect(d4.find((d) => d.option === 2)).toMatchObject({ count: 2, strong: false, dead: false });
    // ข้อ 5: ตัวลวง 2) ถูกเลือกโดยกลุ่มสูงทั้งหมด → ดึงเด็กเก่ง
    expect(a.items[4].distractors.find((d) => d.option === 2)).toMatchObject({ count: 7, strong: true, attractsUpper: true });
  });

  it('ผ่าน/ไม่ผ่านรายตัวชี้วัด และตัวชี้วัดที่อ่อน', () => {
    expect(a.indicators.map((i) => [i.itemCount, i.passCount, i.passRate, i.weak])).toEqual([[2, 8, 0.8, false], [3, 2, 0.2, true]]);
    expect(a.indicators[0].meanRatio).toBe(0.6);       // ถูก 12 จาก 20
    expect(a.indicators[1].meanRatio).toBe(0.3);       // ถูก 9 จาก 30
    expect(a.students.find((s) => s.seatNo === 3)!.indicators.map((x) => [x.correct, x.total, x.pass])).toEqual([[2, 2, true], [1, 3, false]]);
    expect(a.students.map((s) => s.passedIndicators)).toEqual([2, 2, 1, 1, 1, 1, 1, 1, 0, 0]);
  });

  it('ภาพรวมห้อง: ค่าเฉลี่ย S.D. มัธยฐาน เลขที่ขาด remark ค้าง', () => {
    expect(a.summary).toMatchObject({ n: 10, studentCount: 12, mean: 2.1, sd: 1.2, median: 2, min: 1, max: 4, meanPercent: 42,
      missingSeats: [11, 12], unresolvedSeats: [5] });
    expect(a.summary.histogram).toEqual([0, 0, 4, 0, 3, 0, 1, 0, 2, 0]);   // ร้อยละ 20 ×4, 40 ×3, 60 ×1, 80 ×2
  });

  it('เกณฑ์ผ่านตัวชี้วัดปรับได้จากตั้งค่า', () => {
    const strict = analyze(toExam(c), toResponses(c), { ...DEFAULT_ANALYSIS, passRatio: 1 });
    expect(strict.indicators.map((i) => i.passCount)).toEqual([4, 0]);         // ต้องถูกทุกข้อ: A = เลขที่ 1–4
    expect(analysisConfigFromSettings({ 'report.indicator_pass_ratio': 0.6, 'analysis.r_min_n': 20 })).toMatchObject({ passRatio: 0.6, rMinN: 20 });
  });
});

describe('วิเคราะห์ผล: กรณีขอบ', () => {
  it('ยังไม่มีผลตรวจ → ไม่มีค่า p r ไม่ล้ม', () => {
    const c = randomCase(16, RANDOM_SPECS[5]);
    const a = analyze(toExam(c), toResponses(c));
    expect(a.summary).toMatchObject({ n: 0, mean: null, sd: null, median: null, missingSeats: [1, 2, 3, 4] });
    expect(a.items.every((i) => i.p === null && i.r === null)).toBe(true);
  });
  it('n น้อยกว่าเกณฑ์ → p มีค่า แต่ r ว่าง', () => {
    const c = randomCase(14, RANDOM_SPECS[3]);
    const a = analyze(toExam(c), toResponses(c));
    expect(a.summary.n).toBe(5);
    expect(a.items.every((i) => i.p !== null && i.r === null)).toBe(true);
  });
  it('ขนาดกลุ่ม 27%', () => {
    expect([6, 10, 11, 20, 35, 50, 60].map((n) => groupSize(n, 0.27))).toEqual([2, 3, 3, 5, 9, 14, 16]);
  });
  it('แปลงคำตอบบนกระดาษ → ตัวเลือกต้นฉบับ', () => {
    expect(toOriginal(1, [3, 1, 4, 2])).toBe(3);
    expect(toOriginal(4, [3, 1, 4, 2])).toBe(2);
    expect(toOriginal(null, [1, 2, 3, 4])).toBe('blank');
    expect(toOriginal('multi', [1, 2, 3, 4])).toBe('multi');
  });
  it('คำอธิบายค่า p / r', () => {
    expect(difficultyOfP(0.85, diffs)!.nameTh).toBe('ง่าย');
    expect(difficultyOfP(0.8, diffs)!.nameTh).toBe('ง่าย');
    expect(difficultyOfP(0.5, diffs)!.nameTh).toBe('ปานกลาง');
    expect(difficultyOfP(0.1, diffs)!.nameTh).toBe('ท้าทาย');
    expect(rLabel(-0.1).level).toBe('bad');
    expect(rLabel(0.15).text).toBe('ควรปรับปรุง');
    expect(rLabel(0.25).text).toBe('พอใช้');
    expect(rLabel(0.45).text).toBe('ดีมาก');
    expect(rLabel(null).level).toBe('none');
  });
});

describe('วิเคราะห์ผล: ข้อมูลสุ่ม (ความสอดคล้องภายใน)', () => {
  for (const spec of RANDOM_SPECS) {
    it(`ชุดสุ่ม ${spec.seed}: ${spec.items} ข้อ ${spec.sets} ชุด ตรวจ ${spec.scanned}/${spec.students}`, () => {
      const c = randomCase(spec.seed, spec);
      const resp = toResponses(c);
      const a = analyze(toExam(c), resp);
      expect(a.summary.n).toBe(spec.scanned);
      // คะแนนจากการแปลงกลับ = คะแนนตามเฉลยของชุด
      expect(a.students.map((s) => s.score)).toEqual(resp.slice().sort((x, y) => x.seatNo - y.seatNo).map((r) => r.score));
      for (const it of a.items) {
        const total = Object.values(it.counts).reduce((x, y) => x + y, 0);
        expect(total).toBe(spec.scanned);
        if (it.p !== null) expect(it.p).toBeCloseTo(it.nCorrect / it.n, 3);
        if (it.r !== null) { expect(it.r).toBeGreaterThanOrEqual(-1); expect(it.r).toBeLessThanOrEqual(1); }
        expect(Object.keys(it.positions)).toHaveLength(spec.sets);
      }
      const sumScores = a.students.reduce((x, s) => x + s.score, 0);
      expect(a.items.reduce((x, i) => x + i.nCorrect, 0)).toBe(sumScores);
      expect(a.summary.histogram.reduce((x, y) => x + y, 0)).toBe(spec.scanned);
      expect(a.summary.missingSeats.length + spec.scanned).toBe(spec.students);
    });
  }
  it('ข้อมูลสุ่มขนาดใหญ่: ข้อที่ง่ายกว่ามีค่า r เฉลี่ยเป็นบวก (นักเรียนเก่งตอบถูกมากกว่า)', () => {
    const a = analyze(toExam(randomCase(12, RANDOM_SPECS[1])), toResponses(randomCase(12, RANDOM_SPECS[1])));
    const rs = a.items.map((i) => i.r!).filter((r) => r !== null);
    expect(rs.reduce((x, y) => x + y, 0) / rs.length).toBeGreaterThan(0.2);
  });
});
