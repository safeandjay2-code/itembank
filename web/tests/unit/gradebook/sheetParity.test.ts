// โหมดสาธิต = ฐานข้อมูลจริง: ผล gb_sheet จาก PostgreSQL (สถานการณ์ test_phase8.sql ถึงหัวข้อ ง + สอบซ่อมแบบครูเลือก)
// เก็บเป็น fixture แล้วเทียบกับ computeSheet ที่คิดจากข้อมูลดิบชุดเดียวกัน · ตรวจตัวแปลง toGbSheet ของ supabaseRepo ไปพร้อมกัน
// สร้าง fixture ใหม่: รัน test_phase8.sql ถึงบรรทัดคะแนนที่ปรับ แล้วบันทึก gb_sheet / gb_attempts / gb_retake_choices / ข้อมูลดิบ
import { describe, expect, it } from 'vitest';
import fx from './fixtures/gb_sheet_phase8.json';
import { toGbSheet } from '../../../src/data/supabaseRepo';
import { computeSheet } from '../../../src/modules/gradebook/sheet';

describe('computeSheet ตรงกับ gb_sheet ของฐานข้อมูลจริง', () => {
  it('ทุกช่อง ทุกเลขที่ ทุกค่า', () => {
    const db = toGbSheet(fx.sheet, fx.attempts, fx.choices);
    const inp = fx.input as any;
    const mine = computeSheet({
      classroom: db.classroom,
      columns: inp.columns.map((c: any) => ({ id: c.id, kind: c.kind, indicatorId: c.indicator_id, label: c.label,
        maxScore: c.max_score === null ? null : Number(c.max_score), sort: c.sort })),
      indicator: (id) => inp.ind[id],
      exams: inp.exams.map((e: any) => ({ id: e.id, title: e.title, purpose: e.purpose, retakeOf: e.retake_of, status: e.status,
        createdAt: new Date(e.created_at).toISOString(), itemIndicators: e.items })),
      attempts: db.attempts,
      overrides: inp.overrides.map((o: any) => ({ columnId: o.column_id, seatNo: o.seat_no, score: Number(o.score), reason: o.reason })),
      retakeChoices: db.retakeChoices,
    });
    // วันที่ของชุดเทียบเป็นเวลาเดียวกัน (รูปแบบข้อความต่างกันได้)
    const norm = (s: typeof db) => ({ ...s, exams: s.exams.map((e) => ({ ...e, createdAt: Date.parse(e.createdAt) })) });
    expect(norm(mine)).toEqual(norm(db));
    // ค่าที่รู้ล่วงหน้า (ครูเลือก E1 ให้เลขที่ 3 · เลขที่ 4 ปรับให้ผ่าน 5)
    const a = db.columns.findIndex((c) => c.indicatorId === 'MATH-2560-P5-01');
    expect(db.rows.map((r) => r.cells[a].value)).toEqual([10, 8, 0, 5, 4]);
    expect(db.rows[3].cells[a]).toMatchObject({ real: 4, adjusted: 5, reason: 'pass' });
  });
});
