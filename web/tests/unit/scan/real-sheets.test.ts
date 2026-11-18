// กระดาษคำตอบจริง 20 แผ่น (ป.5 พ.ย. 2569) — เด็กฝนดินสอเบา รอยฝน 0.13–0.44 · วงว่าง ~0.02
// กติกาเดิม (เกณฑ์ตายตัว 0.34) ขึ้น remark 155 ข้อ และอ่านผิด 9 ข้อ (ฝนหลายช่องถูกเลือกช่องเดียว / ฝนจางกลายเป็นไม่ฝน)
import { describe, expect, test } from 'vitest';
import { interpret } from '../../../src/modules/scan/grade';
import data from './fixtures/real-p5-2569-11.json';

type Sheet = { seat: number; set: number; darkness: number[][]; truth: Array<number | null | 'multi'> };
const sheets = data.sheets as Sheet[];
const results = sheets.map((s) => ({ s, it: interpret(s.darkness, 20) }));

describe('กระดาษคำตอบจริง ป.5 (20 แผ่น)', () => {
  test('อ่านคำตอบตรงกับที่ตรวจด้วยตาทุกข้อ', () => {
    const wrong = results.flatMap(({ s, it }) =>
      it.answers.flatMap((a, i) => (a === s.truth[i] ? [] : [`เลขที่ ${s.seat} ข้อ ${i + 1}: อ่านได้ ${a} ที่ถูก ${s.truth[i]}`])));
    expect(wrong).toEqual([]);
  });
  test('ฝนหลายช่อง = multi (0 คะแนน) ไม่เลือกช่องใดช่องหนึ่งเอง', () => {
    const multi = results.flatMap(({ s, it }) => it.answers.flatMap((a, i) => (a === 'multi' ? [`${s.seat}-${i + 1}`] : [])));
    expect(multi.sort()).toEqual(['1-3', '1-5', '1-6', '12-6', '4-6'].sort());
  });
  test('remark ขึ้นเฉพาะรอยจางจริง และไม่เกิน 6 ข้อทั้งห้อง', () => {
    const amb = results.flatMap(({ s, it }) => it.ambiguous.map((q) => `${s.seat}-${q}`));
    expect(amb.length).toBeLessThanOrEqual(6);
    for (const [seat, q] of data.faint_items as number[][]) expect(amb, `เลขที่ ${seat} ข้อ ${q}`).toContain(`${seat}-${q}`);
  });
  test('แผ่นที่ฝนชัดทุกข้อไม่มี remark', () => {
    for (const seat of [3, 5, 9, 10, 14, 19, 20]) expect(results.find((r) => r.s.seat === seat)!.it.ambiguous, `เลขที่ ${seat}`).toEqual([]);
  });
});
