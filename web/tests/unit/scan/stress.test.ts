// ทดสอบหนัก (ไม่รันใน CI ตามปกติ): SCAN_STRESS=200 npx vitest run tests/unit/scan/stress.test.ts
import { test, expect } from 'vitest';
import { photograph, randomMarks, renderSheet } from './synth';
import { readSheet } from '../../../src/modules/scan/omr';
import { interpret } from '../../../src/modules/scan/grade';
import { makeRng } from '../../../src/modules/assembly/rng';

const N = Number(process.env.SCAN_STRESS ?? 0);
test.skipIf(!N)('stress: ภาพสุ่มเงื่อนไข — ไม่มีคำตอบผิดแบบเงียบ', () => {
  const rnd = makeRng(2026);
  let fails = 0, silentWrong = 0, spurious = 0, items = 0;
  const uuid = () => 'xxxxxxxx-xxxx-4xxx-8xxx-xxxxxxxxxxxx'.replace(/x/g, () => Math.floor(rnd() * 16).toString(16));
  for (let k = 0; k < N; k++) {
    const itemCount = 10 + Math.floor(rnd() * 36);
    const { marks, expected } = randomMarks(itemCount, 1000 + k, { blank: 0.08, multi: 0.06 });
    const spec = {
      rotateDeg: (rnd() - 0.5) * 30 + (rnd() < 0.15 ? 180 : 0), perspective: rnd() * 0.05, fill: 0.6 + rnd() * 0.25,
      light: rnd() < 0.3 ? 0.35 + rnd() * 0.3 : 1, shadow: rnd() < 0.4 ? rnd() * 0.6 : 0, gradient: rnd() * 0.4,
      noise: rnd() * 6, blur: rnd() < 0.3 ? 1 + Math.floor(rnd() * 2) : 0, curl: rnd() < 0.3 ? rnd() * 1.5 : 0, seed: 5000 + k,
    };
    const exam = uuid();
    const r = readSheet(photograph(renderSheet({ examId: exam, setNo: 1 + (k % 5), seatNo: 1 + (k % 50), itemCount, marks, seed: k }), spec));
    if (!r.ok) { fails++; console.log('FAIL', k, r.reason, JSON.stringify(spec)); continue; }
    expect(r.qr.examId).toBe(exam);
    const it = interpret(r.darkness, itemCount);
    expected.forEach((e, i) => {
      items++;
      const a = it.answers[i], amb = it.ambiguous.includes(i + 1);
      if (e === 'multi' ? a !== 'multi' && !amb : a !== e && !amb) { silentWrong++; console.log('WRONG', k, i + 1, e, a, JSON.stringify(spec)); }
      if (e !== 'multi' && amb) spurious++;
    });
  }
  console.log(`STRESS ${N} แผ่น: อ่านไม่ได้ ${fails}, ข้อทั้งหมด ${items}, ผิดเงียบ ${silentWrong}, remark เกิน ${spurious}`);
  expect(silentWrong).toBe(0);
}, 3_600_000);
