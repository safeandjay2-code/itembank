// เฟส 5: โหมดกล้อง — รับผลเมื่อได้ผลเดิม 2 เฟรมติดกัน, ไม่รับแผ่นเดิมซ้ำขณะยังอยู่หน้ากล้อง
import { expect, test } from 'vitest';
import { Stabilizer, type Proposal } from '../../../src/modules/scan/session';

const P = (seat: number, a: Array<1 | 2 | 3 | 4 | null> = [1, 2, 3]): Proposal =>
  ({ examId: 'e', seatNo: seat, setNo: 1, answers: a, ambiguous: [], localScore: 0, itemCount: a.length });

test('ต้องได้ผลเหมือนกัน 2 เฟรมติดกันจึงรับ', () => {
  const s = new Stabilizer(2, 1500);
  expect(s.push(P(1, [1, 2, 3]), 0)).toBeNull();
  expect(s.push(P(1, [1, 2, 4]), 100)).toBeNull();      // เฟรมเบลออ่านต่าง → เริ่มนับใหม่
  expect(s.push(P(1, [1, 2, 4]), 200)?.seatNo).toBe(1);
});

test('แผ่นเดิมค้างหน้ากล้องไม่ถูกรับซ้ำ · หายไปเกิน 1.5 วินาทีแล้วกลับมา = สแกนซ้ำ (ให้ระบบเตือน)', () => {
  const s = new Stabilizer(2, 1500);
  s.push(P(1), 0); expect(s.push(P(1), 100)).not.toBeNull();
  for (let t = 200; t < 3000; t += 100) expect(s.push(P(1), t)).toBeNull();
  expect(s.push(null, 3100)).toBeNull();
  s.push(P(1), 4700);
  expect(s.push(P(1), 4800)).not.toBeNull();
});

test('พลิกแผ่นถัดไปรับได้ทันที', () => {
  const s = new Stabilizer(2, 1500);
  s.push(P(1), 0); s.push(P(1), 100);
  expect(s.push(P(2), 200)).toBeNull();
  expect(s.push(P(2), 300)?.seatNo).toBe(2);
});
